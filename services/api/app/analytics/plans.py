"""Would a different plan be cheaper, and how would you know?

`engine.compare_tariffs` answers the first half: two flat plans, one period, one number.
That was enough while the only comparison in the product was Low Fixed Charge against
Standard, and it is not enough to *explain* — which is the whole job here. A customer told
"you would save $94 a year" and nothing else has been given a claim to take on trust, from
a system whose entire pitch is that it never asks for trust.

So this module computes the comparison and the reasoning together. Every field on
`PlanComparison` exists because it answers a question a sceptical customer actually asks:

    "how much?"                  saving_nzd_per_year, on their own metered usage
    "on what?"                   days, total_kwh, and the period they cover
    "would it last?"             winter and summer priced separately
    "what would change it?"      break_even_kwh_per_day and headroom_kwh_per_day
    "is it worth the bother?"    `material`, and a plain reason when it is not
    "what aren't you telling me?" caveats, generated from the data rather than fixed

## The four ways a plan comparison lies, and what stops each one here

**Pricing the wrong period.** A month of winter usage annualised twelve times says a
household uses as much power in January as in July, which no New Zealand household does.
`annualise()` is therefore never a bare x12 — it scales by the winter share the household
actually shows, and refuses to project at all from fewer than `MIN_DAYS_TO_COMPARE` days.

**Ignoring the shape of the day.** A time-of-use plan is cheaper or more expensive
depending on *when* the power is used, and a comparison that only has a monthly total
cannot tell. So TOU plans are priced from the peak/off-peak split on the daily rows and
are skipped entirely — `available: false`, with the reason — for an account that has no
such split. Pricing a TOU plan at its headline rate on a total is not an approximation, it
is a different number.

**Reporting a rounding difference as a recommendation.** Two plans within a few dollars a
year are the same plan. `MATERIAL_SAVING_NZD_PER_YEAR` is the floor under a suggestion, and
below it the comparison says so rather than ranking noise.

**Quoting a saving with no error bars.** The break-even is exact arithmetic; the *usage* it
is applied to is one billing period of a household whose life changes. `headroom_kwh_per_day`
is how far their average sits from the point where the answer flips, and it is the single
most useful number in this whole module for anyone deciding whether to act.

## Where the rates come from

Every rate below is Kea's own published price, GST-inclusive, as printed on the plans
page — recorded in docs/sprints/sprint-3/plans-and-terms.md and rendered by
`services/web/src/data/mockData.ts`.

They used to be invented. This module carried a plausible-looking New Zealand retail
shape and labelled it "illustrative" in every direction it could leave by, which was the
honest thing to do while there was no published tariff. There is one now, on a page the
customer can open in the next tab — so an assistant still quoting invented rates was
giving prices that disagreed with the app around it, and hedging them with a disclaimer
that had stopped being true.

What has not changed is the discipline: the usage is the household's own, the arithmetic
is stated, and a plan that cannot be priced from this household's data is declined rather
than estimated.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from app.analytics.account import DayUsage

# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PlanShape:
    """One illustrative plan. Flat, time-of-use, or controlled-load aware.

    A single class rather than a hierarchy because the differences are all data: a flat
    plan is a time-of-use plan whose peak and off-peak rates are equal, and modelling that
    as two types buys an isinstance check and costs the ability to price them in one loop.
    """

    code: str
    name: str
    daily_fixed_nzd: float
    unit_rate_nzd: float
    """The all-hours rate for a flat plan, and the peak rate for a TOU one."""

    off_peak_rate_nzd: float | None = None
    """Set only on time-of-use plans. Requires a band split on the meter."""

    night_rate_nzd: float | None = None
    """The 23:00-07:00 rate. Kea's published Time of Use plan has three bands, not two,
    and the night rate is less than half the peak one — pricing night usage at the
    off-peak rate overstates the plan by 9c on every one of those units and biases the
    recommendation against the plan that suits people who run appliances overnight."""

    free_weekend_window: tuple[int, int] | None = None
    """Local hours, half-open, during which weekend import is free. `(9, 17)` on Free
    Weekends. The fixed daily charge still applies inside it — "free" is a per-kWh
    statement, and a plan page that let somebody read it as a free day would be
    promising something the invoice then contradicts."""

    controlled_rate_nzd: float | None = None
    """Rate for the separately switched circuit, where one exists."""

    user_type: str = "standard"
    """`low_user` or `standard` — the New Zealand regulated categories. A low-user plan is
    required by regulation to carry a daily fixed charge at or under a set cap, which is
    the entire reason the Low Fixed Charge option exists and suits small households."""

    export_rate_nzd: float | None = None
    """Buy-back for exported solar. Only relevant to a household with a solar connection,
    and priced at zero rather than ignored for one without — so the comparison never
    quietly credits a household for generation it does not have."""

    suits: str = ""
    """One clause on who this plan is for. Written for the model to reason about, not to
    quote — it is a description of the plan's shape, not a sales line."""

    @property
    def is_time_of_use(self) -> bool:
        return self.off_peak_rate_nzd is not None


# ---------------------------------------------------------------------------
# Kea's three published pricing styles.
#
# Rates and daily charges are the customer-facing, GST-inclusive figures from
# docs/sprints/sprint-3/plans-and-terms.md, which records the plan-page screenshots.
# They are the same numbers `services/web/src/data/mockData.ts` renders, and that is the
# point of this block: the assistant used to answer out of a different, older catalogue
# — "Kea Standard", "Low Fixed Charge", "Kea Day & Night" — so a customer could ask
# which plans were available, be told two names, and then find three different ones on
# the plans page with different prices on them.
#
# Whenever these change, they change in both places. There is no import between a
# Python service and a TypeScript bundle that would keep them honest, so the guard is
# `tests/test_plans.py::test_the_catalogue_matches_the_published_plan_page`.
#
# Solar buy-back is a flat 8c across all three. The screenshots do not price it, and
# holding it constant keeps a solar household billable without inventing a buy-back
# difference that would then drive the recommendation.
# ---------------------------------------------------------------------------

ANYTIME = PlanShape(
    code="anytime",
    name="Anytime Rate",
    daily_fixed_nzd=1.45,
    unit_rate_nzd=0.325,
    controlled_rate_nzd=0.22,
    export_rate_nzd=0.08,
    suits="customers who want one rate all day and a bill they can predict",
)

#: Three bands, and deliberately not a free win: peak is 6.5c above the Anytime rate, so
#: a household that cannot move its evening load pays more. A catalogue where the
#: interesting plan always wins would make the comparison decorative.
TIME_OF_USE = PlanShape(
    code="time_of_use",
    name="Time of Use",
    daily_fixed_nzd=1.50,
    unit_rate_nzd=0.390,
    off_peak_rate_nzd=0.270,
    night_rate_nzd=0.180,
    controlled_rate_nzd=0.16,
    export_rate_nzd=0.08,
    suits=(
        "households that can shift heavy use — hot water, laundry, an EV — out of the "
        "7-11am and 5-9pm peak"
    ),
)

#: Free from 9am to 5pm on Saturday and Sunday, paid for with the highest unit rate and
#: daily charge of the three. Worth it only for a household that actually uses the
#: window, which is a question about their own shape rather than about the plan.
FREE_WEEKENDS = PlanShape(
    code="free_weekends",
    name="Free Weekends",
    daily_fixed_nzd=1.55,
    unit_rate_nzd=0.365,
    controlled_rate_nzd=0.22,
    export_rate_nzd=0.08,
    free_weekend_window=(9, 17),
    suits="households that can move laundry and big appliances to weekend daytimes",
)

CATALOGUE: tuple[PlanShape, ...] = (ANYTIME, TIME_OF_USE, FREE_WEEKENDS)

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

#: Below this, a switch is not a recommendation. $30 a year is about $2.50 a month, which
#: is inside the month-to-month variation of almost any household's usage — so a plan that
#: wins by less than this has not been shown to win at all.
MATERIAL_SAVING_NZD_PER_YEAR = 30.0

#: Days of usage needed before a comparison is offered. Under a fortnight the average is
#: dominated by whatever happened that week, and the break-even comparison is a comparison
#: against that week rather than against how they live.
MIN_DAYS_TO_COMPARE = 14

#: How close to the break-even counts as "it depends". Inside this band the honest answer
#: is that the two plans cost about the same for this household and a normal month could
#: land either side.
HEADROOM_MARGIN_KWH_PER_DAY = 2.0

#: Heating degree days per day above which a day counts as a winter day, for the seasonal
#: robustness check. Matches `hardship.signals.COLD_PERIOD_HDD` in spirit — roughly a 12°C
#: mean — but is a separate constant because the two answer different questions and should
#: be tunable apart.
WINTER_HDD_PER_DAY = 6.0

#: Minimum days on each side before the seasonal check is reported. Fewer than this and
#: "cheaper in winter" is a statement about four days.
SEASON_MIN_DAYS = 5

#: Exported kWh per day below which the solar plan is not offered at all. A household with
#: a solar connection that exports almost nothing pays the higher daily charge for a
#: buy-back rate it never earns, and offering it would be an upsell dressed as advice.
MIN_EXPORT_KWH_PER_DAY = 1.0


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PlanCost:
    """What one plan would have cost over the days we actually have.

    Every component is kept rather than only the total, because "your daily charges would
    drop $37 but your units would cost $52 more" is the explanation, and a total cannot be
    decomposed back into it.
    """

    plan: PlanShape
    days: int
    total_nzd: float
    fixed_nzd: float
    energy_nzd: float
    controlled_nzd: float = 0.0
    export_credit_nzd: float = 0.0
    priced_from: str = "daily totals"
    """What resolution this was priced at. A TOU plan priced from a peak/off-peak split is
    a different quality of answer from a flat plan priced off a monthly total, and the
    difference has to survive into the explanation."""

    @property
    def per_day_nzd(self) -> float:
        return self.total_nzd / self.days if self.days else 0.0


def _sum(days: list[DayUsage], attr: str) -> float:
    return sum(getattr(d, attr, 0.0) or 0.0 for d in days)


def price(
    plan: PlanShape,
    days: list[DayUsage],
    *,
    has_solar: bool,
    weekend_free_share: float | None = None,
) -> PlanCost | None:
    """Cost this plan over these days. Returns None when the data cannot support it.

    None, not a best guess. A time-of-use plan needs to know when the power was used, and
    an account with no band split cannot answer that — pricing it at the peak rate would
    overstate it and at a blended rate would understate it, and both would be presented
    with the same confidence as a plan we can actually price.

    `weekend_free_share` is the fraction of this household's weekend import that falls
    inside 09:00-17:00, measured from its own hourly profile. Free Weekends cannot be
    priced without it for the same reason.
    """
    if not days:
        return None

    total_kwh = _sum(days, "import_kwh")
    controlled_kwh = _sum(days, "controlled_kwh")
    # The controlled circuit is metered separately, so it must come OUT of the general
    # energy total before that total is priced. Leaving it in charges the hot water twice —
    # once at the controlled rate and once at the general one — which quietly inflates
    # every plan that has a controlled rate and does so unevenly, since the plans do not
    # share a controlled rate.
    general_kwh = max(total_kwh - controlled_kwh, 0.0)
    export_kwh = _sum(days, "export_kwh")

    fixed = plan.daily_fixed_nzd * len(days)
    controlled = controlled_kwh * (plan.controlled_rate_nzd or plan.unit_rate_nzd)

    if plan.is_time_of_use:
        peak = _sum(days, "peak_kwh")
        off_peak = _sum(days, "off_peak_kwh")
        night = _sum(days, "night_kwh")
        banded = peak + off_peak + night
        if banded <= 0:
            return None
        # The bands are measured over the whole import including the controlled circuit,
        # so scale them down to the general portion rather than double-counting it.
        share = general_kwh / banded
        energy = (
            peak * share * plan.unit_rate_nzd
            + off_peak * share * (plan.off_peak_rate_nzd or plan.unit_rate_nzd)
            + night * share * (plan.night_rate_nzd or plan.off_peak_rate_nzd or plan.unit_rate_nzd)
        )
        priced_from = "the household's own peak / off-peak / night split"
    elif plan.free_weekend_window is not None:
        # Free weekend daytime. Which of this household's units fall inside the window
        # is a fact about their own shape, and the daily totals cannot answer it — a
        # weekend total says nothing about the hours it landed in. Without the shape,
        # decline: pricing it as though none of the usage were free understates the
        # plan, and as though all weekend usage were free overstates it, and both would
        # be presented with the same confidence as a plan we can actually price.
        if weekend_free_share is None:
            return None
        weekend_kwh = sum(d.import_kwh for d in days if d.is_weekend)
        free_kwh = weekend_kwh * weekend_free_share
        charged = max(total_kwh - free_kwh, 0.0)
        # Scale to the general portion, as above, so the controlled circuit is not
        # charged twice.
        share = general_kwh / total_kwh if total_kwh else 0.0
        energy = charged * share * plan.unit_rate_nzd
        priced_from = (
            f"the household's own weekend shape — {round(weekend_free_share * 100)}% of "
            f"weekend use falls in the free window"
        )
    else:
        energy = general_kwh * plan.unit_rate_nzd
        priced_from = "daily totals"

    credit = export_kwh * (plan.export_rate_nzd or 0.0) if has_solar else 0.0

    return PlanCost(
        plan=plan,
        days=len(days),
        total_nzd=round(fixed + energy + controlled - credit, 2),
        fixed_nzd=round(fixed, 2),
        energy_nzd=round(energy, 2),
        controlled_nzd=round(controlled, 2),
        export_credit_nzd=round(credit, 2),
        priced_from=priced_from,
    )


def break_even_kwh_per_day(a: PlanShape, b: PlanShape) -> float | None:
    """Daily usage at which two flat plans cost the same.

    (fixed_a - fixed_b) / (rate_b - rate_a). None when the rates are equal — parallel
    lines never cross, and the cheaper plan is simply cheaper at every level of use, which
    is a better answer than a division by zero or a very large number presented as a
    threshold.

    Returns None for a time-of-use plan too. A TOU plan does not have *a* break-even in
    kWh/day: it has a surface in (usage, share-of-use-at-peak), and collapsing that to one
    number would produce a threshold that is wrong for every household except one whose
    peak share happens to match whatever was assumed.
    """
    if a.is_time_of_use or b.is_time_of_use:
        return None
    if abs(b.unit_rate_nzd - a.unit_rate_nzd) < 1e-9:
        return None
    crossing = (a.daily_fixed_nzd - b.daily_fixed_nzd) / (b.unit_rate_nzd - a.unit_rate_nzd)
    return crossing if crossing > 0 else None


def annualise(period_nzd: float, days: int, winter_share: float | None = None) -> float:
    """Scale a period's cost to a year, without pretending every month is July.

    A bare `x 12` on a winter month is the classic mistake and it overstates an annual
    figure by 20-40% for a New Zealand household — which matters enormously here, because
    the *saving* is a difference of two annual figures and both are inflated. The plan with
    the higher unit rate is inflated more, so the error does not cancel: it exaggerates
    every recommendation in the direction of switching.

    `winter_share` is how much of this household's own year the period resembles, derived
    from their heating degree days rather than assumed. Without it this falls back to a
    flat scale and says so through `PlanComparison.caveats`.
    """
    if days <= 0:
        return 0.0
    daily = period_nzd / days
    if winter_share is None:
        return round(daily * 365, 2)
    # A winter period over-represents the cold half of the year. `winter_share` of 1.0 is
    # a period that is entirely winter days, so it is scaled back towards the annual mix;
    # 0.0 is entirely mild and is scaled up.
    seasonal_factor = 1.0 - 0.22 * (winter_share - 0.5) * 2
    return round(daily * 365 * seasonal_factor, 2)


def winter_share(days: list[DayUsage]) -> float | None:
    """Fraction of these days that were cold ones. None when nothing carries HDD.

    None rather than 0.0: a period with no temperature data is a period we cannot place in
    the year, and treating it as entirely mild would scale every annual figure up.
    """
    hdds = [d.heating_degree_days for d in days if d.heating_degree_days is not None]
    if len(hdds) < SEASON_MIN_DAYS:
        return None
    return round(sum(1 for h in hdds if h >= WINTER_HDD_PER_DAY) / len(hdds), 3)


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------


@dataclass
class PlanComparison:
    """Every plan priced on this household's own usage, with the reasoning attached."""

    available: bool
    reason: str | None = None

    period: str = ""
    days: int = 0
    total_kwh: float = 0.0
    mean_daily_kwh: float = 0.0

    costs: list[PlanCost] = field(default_factory=list)
    current_plan_code: str | None = None
    """Which catalogue entry the account is actually on, when it can be matched. None
    means the account has no plan on file or one this catalogue does not contain — the
    comparison is still useful, but there is no 'saving' to quote against it, only a
    ranking."""

    best_code: str | None = None
    saving_nzd_per_period: float = 0.0
    saving_nzd_per_year: float = 0.0
    material: bool | None = False
    """Whether the best plan beats the current one by enough to be worth acting on.

    Three states, not two. `False` means the comparison ran and the difference is not
    worth acting on — a genuinely useful answer most comparison tools never give. `None`
    means the account's plan could not be matched to the catalogue, so there is nothing to
    beat and the question has not been answered. Collapsing those to one `False` is how a
    model ends up telling somebody "you're on the right plan" when nobody has any idea
    what plan they are on."""

    break_even_kwh_per_day: float | None = None
    headroom_kwh_per_day: float | None = None
    """How far this household's average sits from the break-even. Signed: positive means
    above it. The most useful number here for anyone deciding whether to act — a household
    0.4 kWh/day above the line is one warm week from the other side of it."""

    break_even_between: tuple[str, str] | None = None
    """Which two plans the break-even is between. Never left implicit: with four plans in
    the catalogue there are six possible break-evens, and an unlabelled threshold is one
    the model will attach to whichever pair it was thinking about."""

    winter_cost: dict[str, float] = field(default_factory=dict)
    summer_cost: dict[str, float] = field(default_factory=dict)
    """Per-plan cost per day over the cold and mild days separately, when there are enough
    of each. This is the check that catches a plan that wins in July and loses in January,
    which a single-period comparison cannot see and which is the commonest way a
    well-meaning switch costs somebody money."""

    caveats: list[str] = field(default_factory=list)

    def ranked(self) -> list[PlanCost]:
        return sorted(self.costs, key=lambda c: c.total_nzd)


def _match_current(plan_name: str | None, plan_code: str | None) -> str | None:
    """Which catalogue entry this account is on, if any.

    Matched on the account's own plan name and code rather than assumed. An earlier
    version of the tool defaulted to Standard when it could not tell, which meant a
    household already on Low Fixed Charge was told it could save by moving to the plan it
    was already on — the single most damaging kind of wrong answer this feature can give,
    because it is confidently actionable.
    """
    haystack = f"{plan_name or ''} {plan_code or ''}".lower()
    if not haystack.strip():
        return None
    if "free" in haystack and "weekend" in haystack:
        return FREE_WEEKENDS.code
    if any(
        token in haystack
        for token in ("tou", "time of use", "time_of_use", "day & night", "day and night")
    ):
        return TIME_OF_USE.code
    # The accounts loaded from the platform carry Sprint 2 plan names — "Demo Standard
    # Fixed TOU", "Zero Standard Fixed TOU". "Fixed" here means a fixed daily charge,
    # not a fixed term, and none of them is a Kea pricing style. They are matched last
    # and to Anytime, the flat plan, which is what a single all-day rate is.
    if any(token in haystack for token in ("anytime", "standard", "low", "fixed")):
        return ANYTIME.code
    return None


def compare(
    days: list[DayUsage],
    *,
    period: str,
    plan_name: str | None = None,
    plan_code: str | None = None,
    plan_user_type: str | None = None,
    has_solar: bool = False,
    has_controlled_load: bool = False,
    weekend_free_share: float | None = None,
) -> PlanComparison:
    """Price the catalogue against this household. Pure — no I/O, no model, no database.

    Everything the answer needs is computed here so the explanation and the number cannot
    disagree: a model that is handed a saving and a break-even and asked to reason about
    them will occasionally derive a third figure that contradicts both, and this is the one
    tool in the product where a wrong derived figure ends with somebody switching plan.
    """
    if len(days) < MIN_DAYS_TO_COMPARE:
        return PlanComparison(
            available=False,
            reason=(
                f"only {len(days)} days of usage are available for this account, and a "
                f"plan comparison needs at least {MIN_DAYS_TO_COMPARE}. Under a fortnight "
                "the average is dominated by whatever happened that week, so the answer "
                "would be about that week rather than about how this household lives."
            ),
        )

    total_kwh = _sum(days, "import_kwh")
    mean_daily = total_kwh / len(days)
    share_winter = winter_share(days)

    candidates = [p for p in CATALOGUE if _offerable(p, days, has_solar=has_solar)]
    costs = [
        c
        for p in candidates
        if (
            c := price(
                p, days, has_solar=has_solar, weekend_free_share=weekend_free_share
            )
        )
    ]

    if not costs:
        return PlanComparison(
            available=False,
            reason="none of the illustrative plans could be priced against this account",
        )

    current_code = _match_current(plan_name, plan_code)
    # `plan_user_type` used to fall back to Low Fixed Charge for a `low_user` account.
    # There is no low-fixed-charge style in Kea's published catalogue — the regulated
    # category describes the daily charge cap, not which of the three pricing styles the
    # customer chose, and guessing one from it would tell somebody they are on a plan
    # they have never heard of.
    del plan_user_type

    comparison = PlanComparison(
        available=True,
        period=period,
        days=len(days),
        total_kwh=round(total_kwh, 2),
        mean_daily_kwh=round(mean_daily, 2),
        costs=costs,
        current_plan_code=current_code,
    )

    ranked = comparison.ranked()
    best = ranked[0]
    comparison.best_code = best.plan.code

    current = next((c for c in costs if c.plan.code == current_code), None)
    if current is not None:
        comparison.saving_nzd_per_period = round(current.total_nzd - best.total_nzd, 2)
        comparison.saving_nzd_per_year = round(
            annualise(current.total_nzd, len(days), share_winter)
            - annualise(best.total_nzd, len(days), share_winter),
            2,
        )
        comparison.material = (
            comparison.saving_nzd_per_year >= MATERIAL_SAVING_NZD_PER_YEAR
        )
    else:
        # Nothing to beat, so the question "should I switch" has not been answered — as
        # opposed to answered "no". See `PlanComparison.material`.
        comparison.material = None

    # The break-even is worth having whether or not we know their current plan.
    #
    # Against the current plan when there is one, and otherwise against the runner-up —
    # which is the number that says how *close* the recommendation is, and is the thing a
    # customer with no plan on file most wants: "you sit on this side of the line, by
    # this much". An earlier version computed it only against a matched current plan, so
    # every fixture household and every account with no plan row got a null here and the
    # model had nothing to reason about beyond a ranking.
    # Falls through to the runner-up when the current plan IS the best one, which is both
    # the happy case and the one where the threshold is most worth knowing: "you are on
    # the right plan, and you would have to get to 20 kWh a day before that changed" is a
    # better answer than "you are on the right plan".
    against = current.plan if current is not None else None
    if against is None or against.code == best.plan.code:
        against = ranked[1].plan if len(ranked) > 1 else None

    if against is not None:
        crossing = break_even_kwh_per_day(against, best.plan)
        if crossing is not None:
            comparison.break_even_kwh_per_day = round(crossing, 1)
            comparison.headroom_kwh_per_day = round(mean_daily - crossing, 1)
            comparison.break_even_between = (against.code, best.plan.code)

    comparison.winter_cost, comparison.summer_cost = _seasonal(
        days, candidates, has_solar=has_solar
    )
    # Everything the catalogue holds that this household did not get a price for, for
    # either reason: filtered out by `_offerable` as irrelevant, or dropped by `price` as
    # unpriceable on this account's data. An earlier version built this list from
    # `candidates` alone, so the time-of-use plan — which is never filtered, only
    # unpriceable — vanished from the result with no caveat at all, and the customer was
    # shown three plans with no indication a fourth existed.
    priced = {c.plan.code for c in costs}
    comparison.caveats = _caveats(
        comparison,
        share_winter=share_winter,
        has_controlled_load=has_controlled_load,
        has_solar=has_solar,
        skipped=[p for p in CATALOGUE if p.code not in priced],
    )
    return comparison


def _offerable(plan: PlanShape, days: list[DayUsage], *, has_solar: bool) -> bool:
    """Whether this plan should be in the comparison at all for this household.

    All three of Kea's published styles are offered to everybody. The filter stays
    because the reason for it does: a plan that cannot help this household is not a
    worse option, it is a distraction with a price attached, and the model has no way to
    know that. The catalogue this replaced carried a solar-only plan that was strictly
    worse for a house with no panels, and it was dropped here rather than ranked.

    Solar buy-back is a flat 8c on all three now, so there is nothing to exclude — but a
    style aimed at one kind of connection would belong here and not in the ranking.
    """
    del plan, days, has_solar
    return True


def _seasonal(
    days: list[DayUsage], plans: list[PlanShape], *, has_solar: bool
) -> tuple[dict[str, float], dict[str, float]]:
    """Cost per day on cold days and mild days, per plan.

    Two dicts rather than one nested structure because both are consumed the same way —
    "does the ranking hold in both" — and a flat shape survives JSON serialisation into
    the tool result without the model having to navigate it.
    """
    cold = [d for d in days if (d.heating_degree_days or 0) >= WINTER_HDD_PER_DAY]
    mild = [d for d in days if (d.heating_degree_days or 0) < WINTER_HDD_PER_DAY]
    if len(cold) < SEASON_MIN_DAYS or len(mild) < SEASON_MIN_DAYS:
        return {}, {}

    def per_day(subset: list[DayUsage]) -> dict[str, float]:
        out: dict[str, float] = {}
        for plan in plans:
            cost = price(plan, subset, has_solar=has_solar)
            if cost is not None:
                out[plan.code] = round(cost.per_day_nzd, 3)
        return out

    return per_day(cold), per_day(mild)


def _caveats(
    comparison: PlanComparison,
    *,
    share_winter: float | None,
    has_controlled_load: bool,
    has_solar: bool,
    skipped: list[PlanShape],
) -> list[str]:
    """What is true about THIS comparison that would otherwise be quietly assumed.

    Generated from the data rather than a fixed list, for the same reason
    `homelink.insights.appliance_caveats` is: a constant block of disclaimers is read past
    by everybody, including the model, and the one caveat that mattered on this account is
    lost in the four that did not.
    """
    out: list[str] = [
        "These are Kea's published plan rates, GST-inclusive, the same ones on the plans "
        "page. The usage is this household's own. You may quote the prices as real — do "
        "NOT call them illustrative. Costs are still estimates of what the period would "
        "have come to on each plan, not a quote."
    ]

    if share_winter is None:
        out.append(
            "This period has no temperature data, so the annual figures are this period "
            "scaled by 365 with no seasonal correction. For a winter period that "
            "overstates the year — say the annual figure is a rough scale-up."
        )
    elif share_winter >= 0.6:
        out.append(
            f"{share_winter * 100:.0f}% of these days were cold ones, so this period uses "
            "more power than an average month. The annual figures have been scaled down "
            "for that rather than multiplied by twelve, but they are still built on one "
            "season of data."
        )

    if not comparison.winter_cost:
        out.append(
            "There were not enough cold days and mild days in this period to check whether "
            "the cheaper plan stays cheaper across the year. Do not claim it does."
        )
    elif comparison.best_code and comparison.winter_cost and comparison.summer_cost:
        winter_best = min(comparison.winter_cost, key=comparison.winter_cost.get)
        summer_best = min(comparison.summer_cost, key=comparison.summer_cost.get)
        if winter_best != summer_best:
            out.append(
                f"The ranking flips with the season: {winter_best} is cheaper on cold days "
                f"and {summer_best} on mild ones. Say that plainly — a switch that wins in "
                "July can lose over a year."
            )

    if comparison.headroom_kwh_per_day is not None and abs(
        comparison.headroom_kwh_per_day
    ) <= HEADROOM_MARGIN_KWH_PER_DAY:
        out.append(
            f"This household averages {comparison.mean_daily_kwh} kWh a day and the two "
            f"plans cost the same at {comparison.break_even_kwh_per_day} kWh a day. That "
            "is close enough that a normal month could land either side of it — the honest "
            "answer is that the plans cost about the same for them."
        )

    if comparison.current_plan_code is None:
        out.append(
            "This account's plan could not be matched to the catalogue, so there is no "
            "'saving' to quote — only a ranking of what the illustrative plans would cost. "
            "Do not tell them they would save money by switching; tell them which shape of "
            "plan suits their usage and suggest they check their actual plan against it."
        )

    if has_controlled_load:
        out.append(
            "This connection has a separately switched circuit, priced at each plan's "
            "controlled rate rather than its general one. In New Zealand that circuit is "
            "usually the hot water cylinder — usually, not certainly, so do not assert it."
        )

    if any(p.code == FREE_WEEKENDS.code for p in skipped):
        out.append(
            "Free Weekends could not be priced for this household: it depends on how "
            "much of their weekend use falls between 9am and 5pm, and there is no "
            "hourly profile on this account to measure that from. Say it could not be "
            "compared — do not estimate it, and do not imply it would be worse."
        )
    if any(p.code == TIME_OF_USE.code for p in skipped):
        out.append(
            "Time of Use could not be priced: this account has no peak / off-peak / "
            "night split on its meter data. Say so rather than comparing it."
        )

    if any(p.is_time_of_use for p in skipped):
        out.append(
            "The time-of-use plan could not be priced: this account has no peak / off-peak "
            "split on its meter data. Do not quote a figure for it and do not estimate one."
        )

    return out


def explain(comparison: PlanComparison) -> str:
    """The guidance handed to the model with the numbers.

    Instructions about how to reason over this particular result, not a template of the
    answer — the answer is the model's, written to whatever the customer actually asked.
    Composed conditionally so a household on the best plan is not handed a paragraph about
    how to present a saving.
    """
    if not comparison.available:
        return (
            "There is no comparison to give. Say what is missing and why, and answer "
            "whatever else the question asked."
        )

    lines = [
        "Lead with whether they should switch, then why. The 'why' is the trade-off: one "
        "plan charges more per day and less per unit, the other the reverse, so which wins "
        "depends entirely on how much they use.",
        "Quote `saving_nzd_per_year` rather than the period figure — a monthly saving of "
        "four dollars sounds like nothing and is fifty a year — but say which period it "
        "was worked out from.",
        "`headroom_kwh_per_day` is how far their average sits from the point where the two "
        "plans cost the same. Use it: it is the difference between 'switch' and 'switch, "
        "but a quiet month would put you back the other way'.",
    ]

    if comparison.current_plan_code is None:
        lines.append(
            "This account's own plan is not in the catalogue, so there is NO saving to "
            "quote and `worth_switching` is null rather than false — the question has not "
            "been answered, not answered 'no'. Do not tell them they are on the right "
            "plan. Rank the shapes, say which suits their usage and why, and tell them "
            "what to check on their own bill."
        )
    elif not comparison.material:
        lines.append(
            "The best plan does not beat their current one by enough to act on. Say so "
            "directly — telling somebody to switch plan to save two dollars a month is "
            "not advice, and saying 'you're on the right plan' is a genuinely useful "
            "answer that most comparisons never give."
        )
    elif comparison.best_code == comparison.current_plan_code:
        lines.append(
            "They are already on the cheapest plan in the catalogue for their usage. Say "
            "so plainly and tell them what would have to change for that to stop being "
            "true."
        )

    if comparison.winter_cost and comparison.summer_cost:
        lines.append(
            "`winter_cost` and `summer_cost` are cost per day over the cold and mild days "
            "of this period. If the cheapest plan differs between them, that is the most "
            "important thing in this result and it goes near the top of your answer."
        )

    lines.append(
        "Every dollar figure here is priced on this household's OWN metered usage over "
        "the period named, at illustrative rates. Say which period, and say once that the "
        "rates are illustrative."
    )
    return " ".join(lines)


def sensitivity(comparison: PlanComparison) -> dict[str, float | str] | None:
    """How much would have to change for the recommendation to flip.

    Separated from `compare` because it is the answer to a follow-up question rather than
    part of the comparison, and computing it inline would put a fourth kind of number in
    a result that is already dense.
    """
    if not comparison.available or comparison.break_even_kwh_per_day is None:
        return None

    headroom = comparison.headroom_kwh_per_day or 0.0
    daily = [c.per_day_nzd for c in comparison.costs]
    spread = round(max(daily) - min(daily), 2) if len(daily) > 1 else 0.0

    return {
        "break_even_kwh_per_day": comparison.break_even_kwh_per_day,
        "current_mean_kwh_per_day": comparison.mean_daily_kwh,
        "kwh_per_day_until_it_flips": round(abs(headroom), 2),
        "direction": (
            "using less would flip it" if headroom > 0 else "using more would flip it"
        ),
        "spread_between_cheapest_and_dearest_nzd_per_day": spread,
        "note": (
            "A household's daily average moves by more than this between seasons, so a "
            "small headroom means the answer is 'it depends', not 'switch'."
        )
        if abs(headroom) <= HEADROOM_MARGIN_KWH_PER_DAY
        else (
            "The gap is wide enough that a normal month's variation would not change the "
            "answer."
        ),
    }


def variability_kwh_per_day(days: list[DayUsage]) -> float:
    """Standard deviation of daily use. Context for how solid the headroom is.

    A household whose daily usage swings by 8 kWh has no business being told a 2 kWh
    headroom means anything.
    """
    totals = [d.import_kwh for d in days if d.import_kwh is not None]
    if len(totals) < 2:
        return 0.0
    return round(statistics.stdev(totals), 2)
