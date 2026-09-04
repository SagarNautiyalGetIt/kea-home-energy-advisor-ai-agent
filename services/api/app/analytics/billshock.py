"""The bill-shock assessment — forecast, expectation, cause, and whether to say so.

One module composing four pure pieces from `forecast.py` into the answer the product is
named for. Nothing here does I/O and nothing here touches a model.

## What changed, and why the old version had to go

`engine.assess_bill_shock` asked one question: is the straight-line projection more than
15% and $20 above what a comparable home would spend? That is a *detector*. This is an
*assessment*, and the difference is what the customer gets:

    detector   "You are on track to spend $68 more than similar homes."
    assessment "You are on track for $312, which is $68 more than your recent bills.
                About $41 of that is the cold snap; the rest is a higher everyday
                load. There are 17 days left. We are 84% confident this lands above
                the level you asked to hear about."

Every clause in the second one is a computed figure. Not one of them is a judgement the
narration layer gets to make.

## Triggering against the customer's own threshold

The trigger is `P(final cost > expectation x (1 + their threshold)) >= confidence floor`.
Three consequences worth stating because they are the point:

* **A threshold means something.** Set 25% and you hear about it when we are actually
  confident you will land 25% over — not when a noisy midpoint wobbles across the line.
* **Early cycles go quiet on their own.** On day 4 the interval is wide, so the
  probability of clearing any meaningful threshold is low and nothing fires. The old
  `EARLY_CYCLE_DAYS` constant existed to ask the *narrator* to hedge about a warning we
  had already decided to send; the hedge is now in the decision.
* **The ladder gains a second axis.** Escalating to a phone call needs both a big
  overshoot and a tight interval. See `alerts/policy.py` for the floors.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.alerts.preferences import CONFIDENCE_FLOORS, AlertPreferences
from app.analytics.engine import NO_APPLIANCE, UsageWindow
from app.analytics.forecast import (
    Attribution,
    CycleForecast,
    Expectation,
    ExpectationBasis,
    ForecastMethod,
    attribute_with_residuals,
    choose_expectation,
    forecast_cycle,
    recent_trend_pct,
)
from app.clarify import apply, questions
from app.clarify.detect import StepChange, find_step_change
from app.clarify.schemas import ClarifyingQuestion, HouseholdContext
from app.schemas import Fact, FactBundle, Intent

_ILLUSTRATIVE_PRICE = "Dollar figures use an illustrative 30c/kWh; say so if you quote one."

#: A cause is only worth naming if it is a meaningful share of the overshoot. Below this
#: the narration says there is no single cause rather than picking the largest of three
#: small numbers and presenting it as the explanation.
MIN_ATTRIBUTION_SHARE = 0.35


@dataclass(frozen=True)
class BillShockAssessment:
    """Everything the warning needs, computed.

    `triggered` is the only field a caller should branch on. The figures are populated
    either way so the dashboard can render a calm "on track" state without a second
    request — that was true of the previous version and is worth keeping.
    """

    account_ref: str
    period: str
    forecast: CycleForecast
    expectation: Expectation
    attribution: Attribution

    overshoot_nzd: float
    overshoot_pct: float

    #: A dated jump in the everyday floor, if there was one. Carried on the assessment
    #: rather than recomputed by callers because it is what both the clarifying
    #: question and the confirmed-cause facts are built from — two derivations of the
    #: same step would eventually disagree about the date.
    step: StepChange | None

    #: Opening third of the cycle against the closing third. Not a trigger — see
    #: `forecast.recent_trend_pct` for why — but the dashboard shows it, and a figure on
    #: a dashboard comes from layer 1 like every other one.
    recent_trend_pct: float

    triggered: bool
    reasons: list[str]

    #: P(final cost clears this tier's threshold), for each of the customer's three
    #: thresholds. Carried on the assessment so the policy layer does no arithmetic —
    #: it compares probabilities to floors and nothing else.
    tier_probabilities: dict[int, float]

    #: The thresholds these probabilities were computed against, in dollars. Recorded on
    #: the alert row so a warning can be re-checked months later against the settings
    #: that were live when it fired, not against whatever they are now.
    tier_thresholds_nzd: dict[int, float]

    @property
    def days_elapsed(self) -> int:
        return self.forecast.days_elapsed

    @property
    def days_in_cycle(self) -> int:
        return self.forecast.days_in_cycle

    @property
    def days_remaining(self) -> int:
        return self.forecast.days_remaining

    @property
    def projected_cost_nzd(self) -> float:
        return self.forecast.projected_cost_nzd

    @property
    def expected_cost_nzd(self) -> float:
        return self.expectation.cost_nzd

    @property
    def dominant_cause(self) -> str | None:
        """The one cause worth naming, or None when no single one dominates.

        Returning None is a real answer here. "Mostly the cold snap" is useful; "31%
        weather, 34% everyday load, 35% behaviour" is a pie chart pretending to be
        advice, and the narration is better off saying the increase is spread out.
        """
        if not self.attribution.explained or self.overshoot_nzd <= 0:
            return None
        largest = self.attribution.largest
        share = {
            "weather": self.attribution.weather_nzd,
            "behaviour": self.attribution.behaviour_nzd,
            "everyday_load": self.attribution.everyday_load_nzd,
        }[largest] / self.overshoot_nzd
        return largest if share >= MIN_ATTRIBUTION_SHARE else None


def assess(
    window: UsageWindow,
    *,
    days_in_cycle: int,
    daily_hdd: list[float],
    normal_hdd_per_day: float,
    comparable_home_kwh_per_day: float,
    preferences: AlertPreferences,
    same_period_last_year_nzd: float | None = None,
    recent_cycle_costs_nzd: list[float] | None = None,
    cycle_start: date | None = None,
) -> BillShockAssessment:
    """The whole assessment, in one pure call.

    `preferences` is an argument rather than a lookup for the same reason the comparison
    baseline is: the thresholds decide whether a customer's phone rings, and a function
    that fetches them itself cannot be tested against a table of settings without a
    database. Pass them in, and the trigger becomes a pure function of data and settings.
    """
    forecast = forecast_cycle(
        window,
        days_in_cycle=days_in_cycle,
        daily_hdd=daily_hdd,
        normal_hdd_per_day=normal_hdd_per_day,
        cycle_start=cycle_start,
    )

    expectation = choose_expectation(
        days_in_cycle=days_in_cycle,
        unit_price_nzd=window.unit_price_nzd,
        comparable_home_kwh_per_day=comparable_home_kwh_per_day,
        same_period_last_year_nzd=same_period_last_year_nzd,
        recent_cycle_costs_nzd=recent_cycle_costs_nzd,
    )

    overshoot = forecast.projected_cost_nzd - expectation.cost_nzd
    overshoot_pct = (
        (overshoot / expectation.cost_nzd * 100) if expectation.cost_nzd > 0 else 0.0
    )

    attribution = attribute_with_residuals(
        overshoot_nzd=overshoot,
        response=forecast.response,
        daily_kwh=window.daily_kwh,
        daily_hdd=daily_hdd,
        normal_hdd_per_day=normal_hdd_per_day,
        unit_price_nzd=window.unit_price_nzd,
    )

    # The customer's thresholds, converted from percent into the dollar figure the
    # forecast's distribution is expressed in. The dollar floor is applied here rather
    # than as a separate test later, so there is exactly one number per tier that the
    # forecast is asked about.
    thresholds_nzd: dict[int, float] = {}
    probabilities: dict[int, float] = {}
    for tier, pct in preferences.thresholds.items():
        pct_threshold = expectation.cost_nzd * (1 + pct / 100)
        floor_threshold = expectation.cost_nzd + preferences.min_overshoot_nzd
        threshold = max(pct_threshold, floor_threshold)
        thresholds_nzd[tier] = round(threshold, 2)
        probabilities[tier] = forecast.probability_above(threshold)

    reasons: list[str] = []
    if overshoot > 0 and overshoot_pct >= preferences.tier1_pct:
        reasons.append("above_expectation")
    if forecast.response.usable and attribution.weather_nzd > 0:
        reasons.append("colder_than_normal")
    if attribution.explained and attribution.behaviour_nzd > attribution.weather_nzd:
        reasons.append("higher_daily_use")

    # `triggered` is deliberately the tier-1 probability test and nothing else. Whether
    # anything is *sent* is the policy layer's call — it knows about channels, quiet
    # hours and consent, none of which belong in an analytics module.
    triggered = bool(reasons) and probabilities[1] >= CONFIDENCE_FLOORS[1]

    return BillShockAssessment(
        account_ref=window.customer_id,
        period=window.period,
        forecast=forecast,
        expectation=expectation,
        attribution=attribution,
        overshoot_nzd=round(overshoot, 2),
        overshoot_pct=round(overshoot_pct, 1),
        step=find_step_change(
            window.daily_kwh, response=forecast.response, daily_hdd=daily_hdd
        ),
        recent_trend_pct=recent_trend_pct(window.daily_kwh),
        triggered=triggered,
        reasons=reasons,
        tier_probabilities=probabilities,
        tier_thresholds_nzd=thresholds_nzd,
    )


# ───────────────────────── narration bundle ─────────────────────────

_CAUSE_PHRASING: dict[str, str] = {
    "weather": (
        "Most of the increase tracks the weather — it has been colder than normal for "
        "this time of year. You may say so."
    ),
    "behaviour": (
        "Most of the increase is on days that used more than the weather accounts for. "
        "Say that plainly and do NOT guess what was running."
    ),
    "everyday_load": (
        "Most of the increase is in the everyday background load rather than particular "
        "busy days. Say that plainly and do NOT guess what is drawing it."
    ),
}


def build_bill_shock(
    assessment: BillShockAssessment,
    *,
    context: HouseholdContext | None = None,
    question: ClarifyingQuestion | None = None,
) -> FactBundle:
    """Facts for narrating a warning, and the claims that are forbidden with them.

    Only figures that survived the assessment go in — a bundle carrying a fact the
    narration has no reason to mention is an invitation to mention it. The attribution
    figures in particular are omitted entirely when the regression was not usable, so
    there is no cause number on the page for the model to reach for.

    `context` and `question` are the clarifying-question path (see `app/clarify/`). A
    confirmed cause adds *facts* naming and costing the step; an open question adds the
    exact wording the narrator must deliver. Both default to None, and with both absent
    this behaves exactly as it did before the feature existed — which is what keeps the
    golden set meaningful across the change.
    """
    f = assessment.forecast
    facts = [
        Fact.money("projected_cycle_cost", f.projected_cost_nzd,
                   "What this cycle is on track to cost"),
        Fact.money("cost_so_far", f.cost_so_far_nzd, "What you have used so far"),
        Fact.money("expected_cost", assessment.expected_cost_nzd,
                   "What this cycle would normally come to"),
        Fact.money("overshoot_nzd", assessment.overshoot_nzd, "The difference"),
        Fact.percent("overshoot_pct", assessment.overshoot_pct, "How far above normal"),
        Fact.money("cost_range_low", f.cost_p10_nzd, "The low end of the likely range"),
        Fact.money("cost_range_high", f.cost_p90_nzd, "The high end of the likely range"),
    ]

    if assessment.attribution.explained:
        if assessment.attribution.weather_nzd > 0:
            facts.append(
                Fact.money("weather_share_nzd", assessment.attribution.weather_nzd,
                           "How much of the difference the cold weather accounts for")
            )
        if assessment.attribution.behaviour_nzd > 0:
            facts.append(
                Fact.money("higher_use_share_nzd", assessment.attribution.behaviour_nzd,
                           "How much comes from days that used more than the weather explains")
            )
        if assessment.attribution.everyday_load_nzd > 0:
            facts.append(
                Fact.money("everyday_load_share_nzd", assessment.attribution.everyday_load_nzd,
                           "How much comes from the everyday background load")
            )

    caveats = [
        _ILLUSTRATIVE_PRICE,
        NO_APPLIANCE,
        # The basis rule is the honesty control — it is the difference between "more than
        # similar homes" and "more than you usually pay", and only one of those is true
        # for any given household. See forecast.BASIS_CLAIM_RULES.
        assessment.expectation.claim_rule,
        "This is a projection from usage so far, not a guarantee. Call it an estimate, "
        "and if you give a range, give the low and high figures you were provided.",
        f"There are {assessment.days_remaining} days left in the cycle. Lead with that, "
        f"because it is what makes this worth telling them now rather than after the "
        f"bill arrives.",
    ]

    cause = assessment.dominant_cause
    if cause:
        caveats.append(_CAUSE_PHRASING[cause])
    elif assessment.attribution.explained:
        caveats.append(
            "No single cause accounts for most of the increase — it is spread across the "
            "weather, everyday load and busier days. Say that rather than picking one."
        )
    else:
        caveats.append(
            "You have NO breakdown of what caused this increase. Do not offer a cause, "
            "not even a hedged one — not 'possibly the weather', not 'perhaps heating'. "
            "Say what the figures are and that Sparky cannot yet say what is behind them."
        )

    if f.method is ForecastMethod.STRAIGHT_LINE:
        caveats.append(
            "This projection assumes the rest of the cycle looks like the days so far. "
            "It is not weather-adjusted. Do not attribute any of it to temperature."
        )

    if f.confidence_width_pct >= 25:
        caveats.append(
            "The range around this estimate is wide because only part of the cycle has "
            "happened. Lead with the range rather than the single figure."
        )

    # The clarifying-question path. A confirmed cause turns the step from an unexplained
    # remainder into a named, costed fact; an open question adds the exact wording to
    # deliver. Ordered so that a confirmed cause wins — a household that has already told
    # us what happened must not be asked again in the same breath.
    if context is not None and assessment.step is not None:
        step_facts, step_caveats = apply.explain_step(
            context,
            assessment.step,
            unit_price_nzd=f.unit_price_nzd,
            period=assessment.period,
        )
        if step_facts:
            facts.extend(step_facts)
            caveats.extend(step_caveats)
        else:
            caveats.append(apply.unexplained_caveat(question is not None))

    if question is not None:
        caveats.extend(questions.caveats_for(question))

    return FactBundle(
        customer_id=assessment.account_ref,
        intent=Intent.WHAT_WILL_I_PAY,
        period=assessment.period,
        facts=facts,
        caveats=caveats,
    )


__all__ = [
    "BillShockAssessment",
    "ExpectationBasis",
    "assess",
    "build_bill_shock",
]
