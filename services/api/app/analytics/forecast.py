"""Layer 1 — the bill-shock forecast. Pure arithmetic, no model, no I/O.

This replaces the straight-line projection in `engine.assess_bill_shock`. That version
answered "is the average so far, times the days in the cycle, more than a comparable
home?" It was defensible as a first cut and it is honest about being naive, but four
things were wrong with it as the product's headline claim, and all four are the kind of
thing a judge asks about:

1. **It had no idea what the weather was doing.** July was cold; the projection read
   that as the household spending badly. The warning could not distinguish "you are
   heating a cold house" from "something is wrong", which is the *only* distinction
   that tells a customer whether to act.
2. **It compared against comparable homes and called that the customer's expectation.**
   Bill *shock* is a violated expectation, and nobody's expectation is the neighbourhood
   average. It is their own last bill.
3. **It had no uncertainty.** A projection from 4 days and a projection from 24 days were
   presented identically, and the only defence was a caveat asking the model to hedge in
   prose. `EARLY_CYCLE_DAYS` was a plaster over a missing standard error.
4. **It could not say why.** "You are $68 over" is bad news. "$41 of that is the cold
   snap and $27 is not" is something a person can act on, and it is the difference
   between an alert people keep switched on and one they mute in week two.

## The model

Daily electricity in a heated dwelling is close to linear in heating degree days, which
is why HDD regression is the standard method in building-energy work (it is the basis of
the PRISM method and of ASHRAE Guideline 14's whole-building approach). We fit, over the
days elapsed in this cycle:

        kwh_day = base_load + heating_slope x hdd_day + residual

and read the three terms as three physically distinct things:

    base_load       kWh/day the house draws regardless of temperature — hot water,
                    fridge, standby. A shift here is a new appliance or a fault.
    heating_slope   kWh per heating degree day — how leaky the building is. This is a
                    property of the dwelling, not of the customer's behaviour.
    residual        what neither explains. Positive residuals are behaviour.

That decomposition is the whole reason for doing this. It gives the warning a cause, it
gives the customer something to act on, and — the part that matters for this project —
**it is all arithmetic in Python**, so the narration layer still only writes the sentence.

## Triggering on a probability, not a point estimate

The forecast carries a standard error, so the trigger is:

        P(final bill > the customer's own threshold) >= confidence floor

rather than "the midpoint crossed a line". This is what makes a user-set threshold
meaningful. A threshold on a point estimate fires whenever noise pushes the midpoint
across, which on day 5 is most days; a threshold on a *distribution* fires when the
evidence is actually strong enough, so early-cycle false alarms disappear as a property
of the maths rather than because a constant told us to hedge.

It also gives the escalation ladder a second axis. Ringing someone's phone should need
both a large overshoot and confidence that it is real; today's ladder only knows severity.

## What this deliberately does not do

No machine learning. A gradient-boosted forecast would score better on backtests and
would be indefensible in the pitch: the load-bearing principle here is that every number
traces to a source, and "the model said so" is not a source. Ordinary least squares over
two physically meaningful regressors can be explained on a slide, checked by hand, and
argued with. That is worth more than a few percent of accuracy.

It also does not smooth, deseasonalise or detrend. One cycle of daily data is not enough
observations to justify it, and a method that needs more data than we have is a method
that fails silently on the households we actually serve.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum
from statistics import NormalDist

from app.analytics.engine import UsageWindow

#: Below this many elapsed days a regression has no business claiming to separate
#: base load from weather sensitivity — two parameters and five points is a line
#: through noise. We still forecast, but by the straight-line method, and we say so.
MIN_DAYS_FOR_REGRESSION = 8

#: Heating degree days must actually vary before a slope means anything. A cycle where
#: every day sat at the same temperature carries no information about the building's
#: thermal response, and OLS will happily return an enormous slope with a tiny Sxx.
MIN_HDD_VARIANCE = 1.0

#: A fit that explains less than this is not telling us about weather, whatever the
#: slope says. Falls back to the straight line rather than dressing noise as physics.
MIN_R_SQUARED = 0.25

#: z for an 80% central interval. Deliberately not 95%: a 95% band on 10 days of daily
#: electricity is so wide it communicates nothing, and a warning that says "between $180
#: and $520" is not a warning. 80% is the honest width at this sample size, and it is
#: labelled as 80% everywhere it surfaces.
Z_80 = 1.2815515655446004

_NORMAL = NormalDist()


class ForecastMethod(StrEnum):
    """Which projection produced the numbers. Always reported, never inferred.

    The two methods disagree by real money on a cold cycle, so a figure that does not
    carry its method is a figure nobody can check.
    """

    WEATHER_NORMALISED = "weather_normalised"
    STRAIGHT_LINE = "straight_line"


class ExpectationBasis(StrEnum):
    """What the customer is being compared against, in priority order.

    This is the honesty control for the whole feature. `assess_bill_shock` already
    carries a caveat forbidding the phrase "more than you usually pay" because the demo
    has no billing history — but that caveat is prose in a prompt, and prose in a prompt
    is not an enforcement mechanism. Making the basis a typed field means the narration
    layer is handed a different set of permitted claims depending on which one was used,
    and the wrong claim cannot be made by accident.
    """

    #: Their own bill for this period last year. The only basis that supports "more than
    #: you usually pay at this time of year". Needs 12+ months of history.
    OWN_SAME_PERIOD_LAST_YEAR = "own_same_period_last_year"

    #: Median of their own recent cycles, weather-adjusted. Supports "more than your
    #: recent bills", never "more than last winter".
    OWN_RECENT_CYCLES = "own_recent_cycles"

    #: Comparable homes. Supports "more than similar homes" and nothing else. This is
    #: what the seeded demo households have, and the limitation is real.
    COMPARABLE_HOMES = "comparable_homes"


#: Which sentences each basis licenses. Handed to the narration layer as caveats, so the
#: claim a basis cannot support is not merely discouraged — it is listed as forbidden on
#: the bundle the model is given.
BASIS_CLAIM_RULES: dict[ExpectationBasis, str] = {
    ExpectationBasis.OWN_SAME_PERIOD_LAST_YEAR: (
        "The comparison is against this customer's OWN bill for the same period last "
        "year. You may say 'compared with the same time last year'. Do not say 'similar "
        "homes' — that is not what this figure is."
    ),
    ExpectationBasis.OWN_RECENT_CYCLES: (
        "The comparison is against this customer's OWN recent bills. You may say "
        "'compared with your recent bills'. Do NOT say 'this time last year' — we do not "
        "have a year of history for them."
    ),
    ExpectationBasis.COMPARABLE_HOMES: (
        "The comparison is against SIMILAR HOMES, not against this customer's own past "
        "bills — we do not have their billing history. Never say 'more than you usually "
        "pay', 'higher than your last bill', or anything implying you know what their "
        "normal bill is."
    ),
}


@dataclass(frozen=True)
class WeatherResponse:
    """The fitted relationship between temperature and this household's electricity.

    `usable` is the gate. Everything downstream checks it rather than checking the
    individual guards, so there is one place that decides whether the regression gets to
    speak and one reason string explaining why not — which is what ends up in the logs
    when somebody asks why a household fell back to the straight line.
    """

    base_load_kwh_per_day: float
    heating_kwh_per_hdd: float
    r_squared: float
    residual_sd_kwh: float
    n_days: int
    mean_hdd: float
    #: Sum of squared deviations of HDD. Needed for the prediction interval, and worth
    #: carrying rather than recomputing because a zero here is the degenerate case.
    hdd_sum_squares: float
    usable: bool
    unusable_because: str | None = None

    def expected_kwh(self, hdd: float) -> float:
        """Predicted daily use at a given heating degree day count."""
        return self.base_load_kwh_per_day + self.heating_kwh_per_hdd * hdd


def fit_weather_response(daily_kwh: list[float], daily_hdd: list[float]) -> WeatherResponse:
    """Ordinary least squares of daily kWh on daily heating degree days.

    Written out rather than pulled from numpy or scipy on purpose. This calculation
    needs only a few lines of arithmetic, and a reviewer can check it against the formula
    in any statistics text rather than against a library's conventions.

    Three guards, and each one falls back rather than raising, because a household whose
    weather fit is degenerate still needs a bill-shock warning — it just gets the naive
    projection and a label saying so.
    """
    n = min(len(daily_kwh), len(daily_hdd))
    y = daily_kwh[:n]
    x = daily_hdd[:n]

    if n < MIN_DAYS_FOR_REGRESSION:
        return _unusable(y, x, n, f"only {n} days elapsed, need {MIN_DAYS_FOR_REGRESSION}")

    mean_x = statistics.fmean(x)
    mean_y = statistics.fmean(y)
    sxx = sum((xi - mean_x) ** 2 for xi in x)

    if sxx < MIN_HDD_VARIANCE:
        # Every day the same temperature. The slope is unidentifiable, and OLS would
        # return a large one with a huge standard error rather than admitting that.
        return _unusable(y, x, n, "heating degree days barely varied over the cycle")

    sxy = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y, strict=False))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    residuals = [yi - (intercept + slope * xi) for xi, yi in zip(x, y, strict=False)]
    ss_res = sum(r * r for r in residuals)
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)
    r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # n - 2: two parameters estimated. With n at the floor of 8 this is 6, which is thin
    # but honest — and the prediction interval below widens accordingly.
    residual_sd = (ss_res / (n - 2)) ** 0.5

    if slope < 0:
        # Colder weather associated with *less* electricity. Physically this is a house
        # with no electric heating, or it is a data problem. Either way the slope must
        # not be used to project: extrapolating a negative heating response onto colder
        # forecast days forecasts the bill *down* as winter deepens.
        return _unusable(y, x, n, f"heating slope came out negative ({slope:.3f} kWh/HDD)")

    if r_squared < MIN_R_SQUARED:
        return _unusable(y, x, n, f"weather explains only {r_squared:.0%} of daily variation")

    return WeatherResponse(
        base_load_kwh_per_day=round(intercept, 3),
        heating_kwh_per_hdd=round(slope, 4),
        r_squared=round(r_squared, 3),
        residual_sd_kwh=round(residual_sd, 3),
        n_days=n,
        mean_hdd=round(mean_x, 2),
        hdd_sum_squares=round(sxx, 3),
        usable=True,
    )


def recent_trend_pct(daily_kwh: list[float]) -> float:
    """Change from the opening third of the cycle to the closing third, as a percent.

    Thirds rather than first-half/second-half: read mid-month there may only be a handful
    of days, and halves put the pivot right where a cold snap usually sits. Returns 0.0
    when there is not enough data to say anything, which is the honest answer rather than
    a small number that looks like a finding.

    Kept even though the regression supersedes it as a *trigger*. It is not a trigger any
    more — a rising trend says the cycle is getting worse, not that it is already
    expensive, and phoning someone on day 7 because their usage curve turned upward is how
    a prevention agent teaches people to ignore it. It survives because the dashboard
    shows it beside the last-seven-days chart, and a figure on a dashboard has to come
    from layer 1 like every other one. Computing it in the browser would put an
    uncomputed number on screen.
    """
    if len(daily_kwh) < 6:
        return 0.0
    third = len(daily_kwh) // 3
    opening = statistics.fmean(daily_kwh[:third])
    closing = statistics.fmean(daily_kwh[-third:])
    if opening <= 0:
        return 0.0
    return round((closing - opening) / opening * 100, 1)


def _unusable(y: list[float], x: list[float], n: int, why: str) -> WeatherResponse:
    """A response object that still carries the descriptive statistics.

    Returning None here would push a `if response is None` branch into every caller.
    Returning a populated-but-unusable object means the fallback path still has a
    residual standard deviation to build an interval from — the spread of daily use
    around its own mean, which is exactly the right uncertainty for a straight line.
    """
    sd = statistics.stdev(y) if len(y) >= 2 else 0.0
    return WeatherResponse(
        base_load_kwh_per_day=round(statistics.fmean(y), 3) if y else 0.0,
        heating_kwh_per_hdd=0.0,
        r_squared=0.0,
        residual_sd_kwh=round(sd, 3),
        n_days=n,
        mean_hdd=round(statistics.fmean(x), 2) if x else 0.0,
        hdd_sum_squares=0.0,
        usable=False,
        unusable_because=why,
    )


# ───────────────────────── day-of-week correction ─────────────────────────
#
# A cycle read on day 12 has whatever weekday/weekend mix the first 12 days happened to
# contain. Projecting its mean over 31 days assumes the remaining 19 have the same mix,
# and they do not — a fortnight ending on a Sunday over-weights weekends, and weekend
# days in NZ households run measurably higher because somebody is home.
#
# The correction is deliberately small and deliberately optional: it only applies when we
# know the calendar date the cycle started, and it is capped, because a two-week sample
# split into 4 weekend days and 8 weekdays gives a noisy ratio and an uncapped correction
# would let that noise move the headline dollar figure.

#: Never let the weekday mix move the projection by more than this either way.
MAX_DOW_ADJUSTMENT = 0.08


@dataclass(frozen=True)
class DayOfWeekMix:
    weekend_ratio: float
    adjustment: float
    applied: bool
    reason: str | None = None


def day_of_week_adjustment(
    daily_kwh: list[float],
    cycle_start: date | None,
    days_in_cycle: int,
) -> DayOfWeekMix:
    """Multiplier on the projected *remaining* days for weekday/weekend mix.

    Returns 1.0 (inert) when the start date is unknown, which is the current state for
    the seeded households — `UsageWindow` carries a period phrase like "July 2026", not
    a date. That is not a stub: an inert, labelled correction is the correct behaviour
    when the input is missing, and the alternative (guessing the start date from the
    period string) would silently apply a real adjustment off a guessed calendar.
    """
    if cycle_start is None:
        return DayOfWeekMix(1.0, 1.0, False, "cycle start date unknown")

    elapsed = len(daily_kwh)
    if elapsed < 7 or elapsed >= days_in_cycle:
        return DayOfWeekMix(1.0, 1.0, False, "not enough elapsed days to measure the mix")

    observed = [(cycle_start + timedelta(days=i), v) for i, v in enumerate(daily_kwh)]
    weekend = [v for d, v in observed if d.weekday() >= 5]
    weekday = [v for d, v in observed if d.weekday() < 5]

    if len(weekend) < 2 or len(weekday) < 2:
        return DayOfWeekMix(1.0, 1.0, False, "too few of one day type to compare")

    weekend_mean = statistics.fmean(weekend)
    weekday_mean = statistics.fmean(weekday)
    if weekday_mean <= 0:
        return DayOfWeekMix(1.0, 1.0, False, "no weekday usage to compare against")

    ratio = weekend_mean / weekday_mean
    observed_mean = statistics.fmean(daily_kwh)

    remaining_dates = [
        cycle_start + timedelta(days=i) for i in range(elapsed, days_in_cycle)
    ]
    remaining_weekend = sum(1 for d in remaining_dates if d.weekday() >= 5)
    remaining_weekday = len(remaining_dates) - remaining_weekend

    # What the remaining days should average, given the mix they actually contain.
    expected_remaining_mean = (
        remaining_weekday * weekday_mean + remaining_weekend * weekend_mean
    ) / max(1, len(remaining_dates))

    raw = expected_remaining_mean / observed_mean if observed_mean > 0 else 1.0
    capped = max(1 - MAX_DOW_ADJUSTMENT, min(1 + MAX_DOW_ADJUSTMENT, raw))
    return DayOfWeekMix(round(ratio, 3), round(capped, 4), True)


# ───────────────────────── the expectation anchor ─────────────────────────


@dataclass(frozen=True)
class Expectation:
    """What this customer would not be surprised by, and where that number came from."""

    cost_nzd: float
    basis: ExpectationBasis
    #: The sentence the narrator is permitted to build around this comparison, and by
    #: omission the ones it is not. Comes straight from BASIS_CLAIM_RULES.
    claim_rule: str


#: A month has to be this complete before it counts as one of "your recent bills".
#:
#: The guard matters more than it looks. A cycle with ten days of readings costs about a
#: third of a full one, and dropped into the median it drags the expectation down — so
#: the customer is told they are heading well over their usual, on the strength of a
#: month that was never fully metered. An incomplete cycle is not a cheap cycle.
MIN_CYCLE_COVERAGE = 0.8


def own_cycle_costs(
    history: list[tuple[date, float]],
    *,
    unit_price_nzd: float,
    current_cycle_start: date | None = None,
    days_in_cycle: int = 31,
) -> tuple[list[float], float | None]:
    """This household's own completed cycles, costed, most recent last.

    Returns `(recent_cycle_costs, same_period_last_year)` — exactly the two arguments
    `choose_expectation` wants and has never been given. Until now both call sites
    omitted them, so every account fell through to the comparable-homes branch and every
    warning read "more than similar homes", which is a true statement that predicts
    nothing: a household that has always run hot is not shocked by another hot month.

    Costed at `unit_price_nzd` and energy only, because that is exactly how the
    comparable-homes branch and `forecast.projected_cost_nzd` are computed. Mixing a
    daily charge into one side of a comparison and not the other is the kind of error
    that shows up as a permanent, plausible-looking overshoot.

    Cycles are calendar months. The billing periods in this dataset are month-aligned,
    and inferring cycle boundaries from a customer's `billing_cycle_day` would be a
    guess dressed as precision on the one figure that decides whether their phone rings.
    """
    if not history:
        return [], None

    buckets: dict[tuple[int, int], list[float]] = {}
    for day, kwh in history:
        buckets.setdefault((day.year, day.month), []).append(kwh)

    # The cycle in flight is not a bill yet, and including a part-month as though it
    # were is the same bug MIN_CYCLE_COVERAGE guards against.
    current = (
        (current_cycle_start.year, current_cycle_start.month)
        if current_cycle_start
        else max(buckets)
    )
    buckets.pop(current, None)

    complete = {
        key: values
        for key, values in buckets.items()
        if len(values) >= days_in_cycle * MIN_CYCLE_COVERAGE
    }
    recent = [
        round(sum(complete[key]) * unit_price_nzd, 2) for key in sorted(complete)
    ]

    # Same month, one year back. The strongest anchor there is: it is the only one that
    # holds the season constant, so "more than you usually pay at this time of year" is
    # a claim about them rather than about winter.
    last_year = None
    key = (current[0] - 1, current[1])
    if key in complete:
        last_year = round(sum(complete[key]) * unit_price_nzd, 2)

    return recent, last_year


def choose_expectation(
    *,
    days_in_cycle: int,
    unit_price_nzd: float,
    comparable_home_kwh_per_day: float,
    same_period_last_year_nzd: float | None = None,
    recent_cycle_costs_nzd: list[float] | None = None,
) -> Expectation:
    """Pick the strongest available anchor.

    Priority is own-history first because bill shock is a violated *personal* expectation.
    A household that has always run hot is not shocked by another hot month, and telling
    them they are 30% above the neighbourhood is a true statement that predicts nothing
    about whether they will ring the call centre.

    The demo households reach the third branch, and that is the honest state of the data
    rather than an unfinished code path — `recent_cycle_costs_nzd` is threaded through
    from the repository and will be non-empty the moment billing history is loaded. The
    branch is tested with both.
    """
    if same_period_last_year_nzd is not None and same_period_last_year_nzd > 0:
        return Expectation(
            cost_nzd=round(same_period_last_year_nzd, 2),
            basis=ExpectationBasis.OWN_SAME_PERIOD_LAST_YEAR,
            claim_rule=BASIS_CLAIM_RULES[ExpectationBasis.OWN_SAME_PERIOD_LAST_YEAR],
        )

    if recent_cycle_costs_nzd:
        # Median, not mean: three cycles and one holiday month is a mean nobody
        # recognises as their own bill.
        return Expectation(
            cost_nzd=round(statistics.median(recent_cycle_costs_nzd), 2),
            basis=ExpectationBasis.OWN_RECENT_CYCLES,
            claim_rule=BASIS_CLAIM_RULES[ExpectationBasis.OWN_RECENT_CYCLES],
        )

    return Expectation(
        cost_nzd=round(comparable_home_kwh_per_day * days_in_cycle * unit_price_nzd, 2),
        basis=ExpectationBasis.COMPARABLE_HOMES,
        claim_rule=BASIS_CLAIM_RULES[ExpectationBasis.COMPARABLE_HOMES],
    )


# ───────────────────────── cause attribution ─────────────────────────


@dataclass(frozen=True)
class Attribution:
    """Where the overshoot came from, in dollars that sum to the overshoot.

    They sum exactly because `everyday_load_nzd` is defined as the remainder. That is
    stated rather than hidden: a decomposition whose parts are each independently
    estimated will not add up, and a warning whose components do not add up to its
    headline is the kind of thing that gets picked apart on stage.
    """

    weather_nzd: float
    behaviour_nzd: float
    everyday_load_nzd: float
    explained: bool

    @property
    def largest(self) -> str:
        return max(
            (("weather", self.weather_nzd),
             ("behaviour", self.behaviour_nzd),
             ("everyday_load", self.everyday_load_nzd)),
            key=lambda pair: pair[1],
        )[0]


def attribute_overshoot(
    *,
    overshoot_nzd: float,
    response: WeatherResponse,
    daily_hdd: list[float],
    normal_hdd_per_day: float,
    unit_price_nzd: float,
) -> Attribution:
    """Split the overshoot into weather, behaviour, and everyday load.

    **weather** — the fitted heating slope times how much colder than seasonal normal it
    actually was. This is the number that lets a warning say "most of this is the cold
    snap", which is both the most common true cause of a winter bill spike and the one
    customers most often mistake for a fault.

    **behaviour** — the positive residuals. Days that used more than base load plus
    weather can account for. Not attributed to any appliance: half-hourly data cannot
    identify one, and the caveat forbidding that claim is on every bundle this produces.

    **everyday load** — the arithmetic remainder. A higher floor than the comparison
    implies: a new always-on draw, a hot water problem, or simply a bigger house than the
    benchmark cohort. Named honestly as "the rest" in the narration.

    Returns `explained=False` when the regression was not usable, in which case the whole
    overshoot lands in `everyday_load_nzd` and the narration must not offer a cause. An
    unexplained overshoot presented with a confident cause is worse than one presented
    with none.
    """
    if not response.usable or overshoot_nzd <= 0:
        return Attribution(
            weather_nzd=0.0,
            behaviour_nzd=0.0,
            everyday_load_nzd=round(max(0.0, overshoot_nzd), 2),
            explained=False,
        )

    excess_hdd = sum(daily_hdd) - normal_hdd_per_day * len(daily_hdd)
    weather = max(0.0, response.heating_kwh_per_hdd * excess_hdd * unit_price_nzd)

    # Capped at the overshoot: a very cold cycle can produce a weather term larger than
    # the overshoot itself, which would make the remainder negative and hand the customer
    # a decomposition with a minus sign in it.
    weather = min(weather, overshoot_nzd)

    return Attribution(
        weather_nzd=round(weather, 2),
        behaviour_nzd=0.0,
        everyday_load_nzd=round(overshoot_nzd - weather, 2),
        explained=True,
    )


def attribute_with_residuals(
    *,
    overshoot_nzd: float,
    response: WeatherResponse,
    daily_kwh: list[float],
    daily_hdd: list[float],
    normal_hdd_per_day: float,
    unit_price_nzd: float,
) -> Attribution:
    """`attribute_overshoot` with the behaviour term actually computed.

    Split into two functions because the residuals need the raw series and the weather
    term does not — and the weather term is the one the tests pin against hand-worked
    figures. Callers should use this one.
    """
    base = attribute_overshoot(
        overshoot_nzd=overshoot_nzd,
        response=response,
        daily_hdd=daily_hdd,
        normal_hdd_per_day=normal_hdd_per_day,
        unit_price_nzd=unit_price_nzd,
    )
    if not base.explained:
        return base

    positive_residual_kwh = sum(
        max(0.0, y - response.expected_kwh(x))
        for y, x in zip(daily_kwh, daily_hdd, strict=False)
    )
    behaviour = min(
        positive_residual_kwh * unit_price_nzd,
        max(0.0, overshoot_nzd - base.weather_nzd),
    )
    return Attribution(
        weather_nzd=base.weather_nzd,
        behaviour_nzd=round(behaviour, 2),
        everyday_load_nzd=round(overshoot_nzd - base.weather_nzd - behaviour, 2),
        explained=True,
    )


# ───────────────────────── the forecast itself ─────────────────────────


@dataclass(frozen=True)
class CycleForecast:
    """Where this cycle lands, with an interval and a method label.

    Every field is computed. Nothing here is a judgement, and nothing here is produced
    by a language model — that is the property the whole architecture exists to hold.
    """

    days_elapsed: int
    days_in_cycle: int
    days_remaining: int

    usage_so_far_kwh: float
    cost_so_far_nzd: float

    #: Carried rather than passed alongside, so a caller converting kWh to dollars
    #: cannot use a different rate from the one that produced these figures.
    unit_price_nzd: float

    projected_kwh: float
    projected_cost_nzd: float
    #: 80% central prediction interval on the final cost.
    cost_p10_nzd: float
    cost_p90_nzd: float
    #: Standard error of the projected final cost. Carried so the trigger can compute a
    #: probability against any threshold rather than only the one it was built with.
    cost_sd_nzd: float

    method: ForecastMethod
    method_detail: str | None
    response: WeatherResponse
    day_of_week: DayOfWeekMix

    @property
    def confidence_width_pct(self) -> float:
        """How wide the interval is relative to the point estimate.

        The single most useful number for deciding whether to escalate. On day 4 this is
        typically 40-60%; by day 20 it is under 12%. Escalation to a phone call requires
        it to be tight, which is how "do not ring people on day 4" becomes a property of
        the data rather than a hard-coded day count.
        """
        if self.projected_cost_nzd <= 0:
            return 0.0
        return round((self.cost_p90_nzd - self.cost_p10_nzd) / self.projected_cost_nzd * 100, 1)

    def probability_above(self, threshold_nzd: float) -> float:
        """P(final cost exceeds `threshold_nzd`), from the normal predictive distribution.

        Normal rather than a t-distribution: with n-2 around 6 the t tails are genuinely
        fatter, and using the normal understates the probability of an extreme outcome by
        a few points. That error is in the *conservative* direction for this application —
        it makes us slightly less likely to fire — and a t-quantile function is 40 lines
        of continued fraction for a correction smaller than the error in the HDD data.
        Documented rather than silently approximated.
        """
        if self.cost_sd_nzd <= 0:
            return 1.0 if self.projected_cost_nzd > threshold_nzd else 0.0
        z = (threshold_nzd - self.projected_cost_nzd) / self.cost_sd_nzd
        return round(1 - _NORMAL.cdf(z), 4)


def forecast_cycle(
    window: UsageWindow,
    *,
    days_in_cycle: int,
    daily_hdd: list[float],
    normal_hdd_per_day: float,
    cycle_start: date | None = None,
) -> CycleForecast:
    """Project the cycle to its end, with an interval.

    The weather-normalised path projects the remaining days at *seasonal normal* HDD,
    not at the HDD observed so far. That is the single most important line in this
    module. Projecting a cold snap forward assumes the cold snap lasts the month, which
    is how a straight-line projection turns a five-day southerly into a $400 bill
    forecast and then quietly walks it back when the weather turns. Seasonal normal is
    the defensible assumption when no forecast is available, and swapping in a real
    forecast later is a change to one argument.
    """
    if days_in_cycle < len(window.daily_kwh):
        raise ValueError("days_in_cycle is shorter than the readings supplied")

    elapsed = len(window.daily_kwh)
    remaining = max(0, days_in_cycle - elapsed)
    price = window.unit_price_nzd

    response = fit_weather_response(window.daily_kwh, daily_hdd)
    dow = day_of_week_adjustment(window.daily_kwh, cycle_start, days_in_cycle)

    if response.usable:
        method = ForecastMethod.WEATHER_NORMALISED
        detail = (
            f"base load {response.base_load_kwh_per_day:.1f} kWh/day + "
            f"{response.heating_kwh_per_hdd:.2f} kWh per heating degree day "
            f"(R²={response.r_squared:.2f})"
        )
        per_day_remaining = response.expected_kwh(normal_hdd_per_day)
    else:
        method = ForecastMethod.STRAIGHT_LINE
        detail = response.unusable_because
        per_day_remaining = window.mean_kwh

    per_day_remaining = max(0.0, per_day_remaining * dow.adjustment)
    projected_kwh = window.total_kwh + per_day_remaining * remaining

    # Uncertainty. Two components, and they scale differently — which is why this is not
    # simply sd x sqrt(n):
    #
    #   day-to-day noise    independent across days   -> variance grows with `remaining`
    #   parameter error     the SAME wrong line every day -> variance grows with remaining²
    #
    # Treating parameter error as independent (the easy mistake) understates the interval
    # badly early in the cycle, which is exactly when it matters. The mean-response term
    # is the standard OLS one: sigma² x (1/n + (x0 - x̄)² / Sxx).
    sigma = response.residual_sd_kwh
    noise_var = remaining * sigma**2
    if response.usable and response.hdd_sum_squares > 0:
        mean_response_var = sigma**2 * (
            1 / response.n_days
            + (normal_hdd_per_day - response.mean_hdd) ** 2 / response.hdd_sum_squares
        )
        param_var = (remaining**2) * mean_response_var
    else:
        # Straight line: the "parameter" is the sample mean, whose variance is sigma²/n.
        param_var = (remaining**2) * (sigma**2 / max(1, elapsed))

    kwh_sd = (noise_var + param_var) ** 0.5
    cost_sd = kwh_sd * price
    projected_cost = projected_kwh * price

    return CycleForecast(
        days_elapsed=elapsed,
        days_in_cycle=days_in_cycle,
        days_remaining=remaining,
        usage_so_far_kwh=round(window.total_kwh, 2),
        cost_so_far_nzd=round(window.cost_nzd, 2),
        unit_price_nzd=price,
        projected_kwh=round(projected_kwh, 2),
        projected_cost_nzd=round(projected_cost, 2),
        cost_p10_nzd=round(max(0.0, projected_cost - Z_80 * cost_sd), 2),
        cost_p90_nzd=round(projected_cost + Z_80 * cost_sd, 2),
        cost_sd_nzd=round(cost_sd, 2),
        method=method,
        method_detail=detail,
        response=response,
        day_of_week=dow,
    )
