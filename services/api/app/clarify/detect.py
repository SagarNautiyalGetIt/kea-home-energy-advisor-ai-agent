"""Finding the gap that a question could close. Pure arithmetic, no model.

## The decision this module exists to take away from the model

"Ask the customer a question when you are not sure" sounds like a job for the model, and
it is not. A model asked to judge its own confidence will do it fluently and wrongly, and
worse, it would be *choosing what to ask* — which is a decision about the customer's data,
made by the component that is not allowed to make decisions about the customer's data.

So the trigger is computed. Layer 1 already knows what it cannot explain: the weather
regression reports whether it is usable, the attribution reports how much of the overshoot
is unaccounted for, and the residuals carry a step change if one happened. A question is
asked when there is a **specific, quantified gap** and a hypothesis that would close it.

The model's only job stays what it always was: writing the sentence.

## The rule that keeps this from becoming a survey

**A question that cannot change the answer is never asked.** Each gap below names the
dollar amount it would explain, and the catalogue maps each one to a hypothesis whose
confirmation actually re-attributes that amount. If nothing is unexplained, nothing is
asked — an agent that opens with "tell me about your household" before it has looked at
the data is doing an intake form, not an explanation.

## Why the step detector is the good one

"Has anything changed?" is a weak question. "Your everyday load stepped up around 12 July
and costs about $27 a month — did something arrive around then?" is a question somebody
can actually answer, because it hands them a date to think about.

That comes from a change-point search: split the cycle at every candidate day, fit the
baseline on each side, and take the split with the largest step. It is the simplest
detector that produces a *date*, and a date is the whole difference between the two
questions above.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from app.analytics.forecast import WeatherResponse
from app.clarify.schemas import Gap

#: Each side of a candidate split needs enough days for its mean to mean anything. Five is
#: the floor at which a step stops being "one unusual day next to four ordinary ones".
MIN_SIDE_DAYS = 5

#: A step counts when it clears this many pooled standard deviations. 1.5 is deliberately
#: permissive: the cost of asking a question nobody needed is one ignored prompt, and the
#: cost of missing a new heat pump is the customer never finding out why their bill moved.
#: The asymmetry runs the other way from the alerting thresholds, and it should.
STEP_SIGMA = 1.5

#: Below this the step is real but not worth a conversation.
MIN_STEP_KWH_PER_DAY = 0.8

#: How much of the overshoot has to be unattributed before it is worth asking about.
#: Below this the weather and behaviour terms have done their job.
MIN_UNEXPLAINED_SHARE = 0.30



@dataclass(frozen=True)
class StepChange:
    """A dated jump in the everyday floor."""

    #: 1-based day within the cycle. The first day at the *new* level.
    day_index: int
    before_kwh_per_day: float
    after_kwh_per_day: float
    step_kwh_per_day: float
    #: How many pooled standard deviations the step clears. Reported so a caller can be
    #: stricter than STEP_SIGMA without re-running the search.
    sigma: float

    def monthly_cost_nzd(self, unit_price_nzd: float, days: int = 30) -> float:
        return round(self.step_kwh_per_day * days * unit_price_nzd, 2)


@dataclass(frozen=True)
class DetectedGap:
    """One gap, with the amount it would explain if the hypothesis is confirmed."""

    gap: Gap
    #: What confirming a cause here would re-attribute. The number that makes the question
    #: worth asking, and the one the narrator is allowed to quote when it asks.
    explains_nzd: float
    step: StepChange | None = None
    detail: str | None = None


def find_step_change(
    daily_kwh: list[float],
    *,
    response: WeatherResponse | None = None,
    daily_hdd: list[float] | None = None,
) -> StepChange | None:
    """Search for the day the everyday floor moved.

    Runs on **weather-adjusted** daily use when the regression is usable — otherwise a
    cold snap looks exactly like a new appliance, which is the single most likely way this
    detector produces a wrong question. With the weather removed, what is left is the part
    a customer can actually tell us about.

    Falls back to raw daily totals when there is no usable fit. That is weaker and the
    caller is told so through `NO_WEATHER_FIT`, but a household with an unfittable series
    is exactly the one with nothing else to go on.
    """
    if len(daily_kwh) < MIN_SIDE_DAYS * 2:
        return None

    if response is not None and response.usable and daily_hdd:
        # Residuals plus the intercept: daily use with the temperature response taken out,
        # still on a kWh scale so the step is quotable in kWh and dollars.
        series = [
            y - response.heating_kwh_per_hdd * x
            for y, x in zip(daily_kwh, daily_hdd, strict=False)
        ]
    else:
        series = list(daily_kwh)

    best: StepChange | None = None
    for split in range(MIN_SIDE_DAYS, len(series) - MIN_SIDE_DAYS + 1):
        before, after = series[:split], series[split:]
        step = statistics.fmean(after) - statistics.fmean(before)
        if step < MIN_STEP_KWH_PER_DAY:
            continue

        # Pooled spread. A step of 2 kWh means nothing in a series that swings by 5.
        spread = statistics.pstdev(before) + statistics.pstdev(after)
        sigma = step / (spread / 2) if spread > 0 else float("inf")
        if sigma < STEP_SIGMA:
            continue

        if best is None or sigma > best.sigma:
            best = StepChange(
                day_index=split + 1,
                before_kwh_per_day=round(statistics.fmean(before), 2),
                after_kwh_per_day=round(statistics.fmean(after), 2),
                step_kwh_per_day=round(step, 2),
                sigma=round(sigma, 2),
            )
    return best


def find_gaps(
    *,
    daily_kwh: list[float],
    daily_hdd: list[float],
    response: WeatherResponse,
    unit_price_nzd: float,
    overshoot_nzd: float,
    unexplained_nzd: float,
    attribution_explained: bool,
) -> list[DetectedGap]:
    """Every gap worth a question, strongest first.

    Ordered by how much each would explain, because the caller asks at most one or two and
    the one worth asking is the one that accounts for the most money.
    """
    gaps: list[DetectedGap] = []

    step = find_step_change(daily_kwh, response=response, daily_hdd=daily_hdd)
    if step is not None:
        gaps.append(
            DetectedGap(
                gap=Gap.BASE_LOAD_STEP,
                explains_nzd=step.monthly_cost_nzd(unit_price_nzd),
                step=step,
                detail=(
                    f"everyday use rose {step.step_kwh_per_day:.1f} kWh/day from day "
                    f"{step.day_index} and stayed there"
                ),
            )
        )

    if not attribution_explained and overshoot_nzd > 0:
        gaps.append(
            DetectedGap(
                gap=Gap.NO_WEATHER_FIT,
                explains_nzd=round(overshoot_nzd, 2),
                detail=response.unusable_because,
            )
        )
    elif overshoot_nzd > 0 and unexplained_nzd / overshoot_nzd >= MIN_UNEXPLAINED_SHARE:
        gaps.append(
            DetectedGap(
                gap=Gap.UNEXPLAINED_REMAINDER,
                explains_nzd=round(unexplained_nzd, 2),
                detail=(
                    f"${unexplained_nzd:,.0f} of the increase is not explained by the "
                    f"weather or by particular busy days"
                ),
            )
        )

    return sorted(gaps, key=lambda g: -g.explains_nzd)
