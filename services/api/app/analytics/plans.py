"""Would a different plan be cheaper, and how would you know?

`engine.compare_tariffs` answers the first half: two flat plans, one period, one number.
That was enough while the only comparison in the product was Low Fixed Charge against
Standard, and it is not enough to *explain* — which is the whole job here. A customer told
"you would save $94 a year" and nothing else has been given a claim to take on trust, from
a system whose entire pitch is that it never asks for trust.

So this module computes the comparison and the reasoning together. Every field on
`PlanComparison` exists because it answers a question a sceptical customer actually asks:

    "how much?"                  usage_saving_nzd_per_year, on their own metered usage
    "on what?"                   days, total_kwh, and the period they cover
    "would it last?"             winter and summer priced separately
    "what would change it?"      the band shares, and how far they are from the flip
    "is it worth the bother?"    `material`, and a plain reason when it is not
    "what aren't you telling me?" caveats, generated from the data rather than fixed

## Where the rates come from

The three plans below are Kea's Sprint 3 products, specified in
`docs/sprints/sprint-3/plans-and-terms.md` and taken from the product screenshots
`plans-1.png` and `plans-2.png`. They are not invented and they are not illustrative.
An earlier version of this module priced four plausible-looking New Zealand retail shapes
and disclosed them as illustrative, because at the time Kea's plans genuinely were not
specified anywhere in the repo. They have been since 8 September 2026, and a comparison
that keeps quoting invented rates beside a spec that defines the real ones is worse than
one that never had them: the disclosure makes it *look* handled.

Rates here are the customer-facing, GST-inclusive figures — the ones printed on the
screenshots and the ones a customer can check. `data/design` stores the ex-GST components
with the line-loss factor unwound; that representation is the loader's business, and
recombining it has to reproduce exactly these numbers (`02_catalogue.sql` asserts it).

## The four ways a plan comparison lies, and what stops each one here

**Pricing the wrong period.** A month of winter usage annualised twelve times says a
household uses as much power in January as in July, which no New Zealand household does.
`annualise()` is therefore never a bare x12 — it scales by the winter share the household
actually shows, and refuses to project at all from fewer than `MIN_DAYS_TO_COMPARE` days.

**Ignoring the shape of the day.** Two of the three plans price by *when* the power is
used, and a comparison that only has a daily total cannot tell. So banded plans are priced
from the household's own hour-of-day shape in `kea.mart_hourly_profile`, and are skipped
entirely — with the reason — for an account that has no profile. Pricing a banded plan at
its headline rate on a total is not an approximation, it is a different number.

Note what this deliberately does *not* use: `mart_daily_usage.peak_kwh`. Those columns are
populated for the nine Sprint 2 fixtures and left null by the warehouse export that loads
the LCL cohort (`data/pipeline/export/kea.mart_daily_usage.sql` says so in as many words).
Pricing off them would work all the way through fixture testing and then quietly report
"no time-of-use price available" for every real household in the demo.

**Reporting a rounding difference as a recommendation.** Two plans within a few dollars a
year are the same plan. `MATERIAL_SAVING_NZD_PER_YEAR` is the floor under a suggestion, and
below it the comparison says so rather than ranking noise.

**Quoting a saving with no error bars.** The thresholds here are exact arithmetic; the
*usage* they are applied to is one billing period of a household whose life changes.
`free_window_share_headroom` and the seasonal split are how far this household sits from
the point where the answer flips, and they are the most useful numbers in this module for
anyone deciding whether to act.

## Terms are not savings

A commitment term pays a monthly credit, and the temptation is to add it to the usage
difference and quote one big number. This module refuses to: `usage_saving` is the
unconditional difference between two pricing styles, `term_credit` is money conditional on
completing a commitment, and only their sum is `annual_saving`. A switch is recommended on
`usage_saving` alone, so a term credit can never turn a more expensive plan into a "saving"
— which is exactly the move that makes a comparison tool an upsell.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterable
from dataclasses import dataclass, field

from app.analytics.account import DayUsage

# ---------------------------------------------------------------------------
# Bands
# ---------------------------------------------------------------------------

#: The named periods a plan can charge differently for. Strings rather than an enum because
#: they travel to the model inside the tool result and are read there as labels.
ANYTIME = "anytime"
PEAK = "peak"
OFF_PEAK = "off_peak"
NIGHT = "night"
FREE = "free"
OUTSIDE_FREE = "outside_free"

#: Time-of-use boundaries, exactly as the screenshot states them, applied on every day of
#: the week. Held as hour sets rather than ranges because the peak is two separate blocks —
#: morning and evening — and a range would need special-casing that a set does not.
_TOU_PEAK_HOURS = frozenset(range(7, 11)) | frozenset(range(17, 21))
_TOU_OFF_PEAK_HOURS = frozenset(range(11, 17)) | frozenset(range(21, 23))
#: Everything else: 23:00-07:00. Derived rather than written out so the three cannot drift
#: apart into a gap or an overlap.
_TOU_NIGHT_HOURS = frozenset(range(24)) - _TOU_PEAK_HOURS - _TOU_OFF_PEAK_HOURS

#: Free Weekends: Saturday and Sunday, 09:00-17:00. "Free" means every per-kWh import
#: charge is zero; the daily fixed charge still applies, which is the whole reason this
#: plan is not simply better than the others.
_FREE_WINDOW_HOURS = frozenset(range(9, 17))


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PlanShape:
    """One Kea pricing style.

    A single class rather than a hierarchy because the differences are all data: a flat
    plan is a banded plan with one band, and modelling that as two types buys an isinstance
    check and costs the ability to price them in one loop.
    """

    code: str
    name: str
    daily_fixed_nzd: float
    rates_nzd: dict[str, float]
    """Per-kWh price for each band this plan can charge in, GST-inclusive."""

    weekend_free_window: bool = False
    """Whether `_FREE_WINDOW_HOURS` on Saturday and Sunday is charged at the FREE rate."""

    time_of_use: bool = False
    """Whether the day is split into peak / off-peak / night."""

    export_rate_nzd: float = 0.08
    """Buy-back for exported solar. The screenshots do not define one, so all three carry
    the same assumed 8c credit — holding it constant keeps solar households billable
    without letting an invented buy-back difference drive the recommendation."""

    suits: str = ""
    """One clause on who this plan is for, from the screenshot's own "best suited to"
    column. A description of the plan's shape, not a sales line."""

    @property
    def is_banded(self) -> bool:
        """Whether pricing this plan needs to know when the power was used."""
        return self.time_of_use or self.weekend_free_window

    def band_of(self, hour: int, *, is_weekend: bool) -> str:
        """Which band an hour falls in. The single definition both pricing and the
        household's reported shares go through, so the two cannot disagree."""
        if self.weekend_free_window:
            if is_weekend and hour in _FREE_WINDOW_HOURS:
                return FREE
            return OUTSIDE_FREE
        if self.time_of_use:
            if hour in _TOU_PEAK_HOURS:
                return PEAK
            if hour in _TOU_OFF_PEAK_HOURS:
                return OFF_PEAK
            return NIGHT
        return ANYTIME


ANYTIME_RATE = PlanShape(
    code="KEA_ANY_VECT_STA",
    name="Anytime Rate",
    daily_fixed_nzd=1.45,
    rates_nzd={ANYTIME: 0.325},
    suits="customers wanting simplicity and predictable pricing",
)

TIME_OF_USE = PlanShape(
    code="KEA_TOU_VECT_STA",
    name="Time of Use",
    daily_fixed_nzd=1.50,
    rates_nzd={PEAK: 0.390, OFF_PEAK: 0.270, NIGHT: 0.180},
    time_of_use=True,
    suits="customers able to shift usage away from peak",
)

FREE_WEEKENDS = PlanShape(
    code="KEA_WKND_VECT_STA",
    name="Free Weekends",
    daily_fixed_nzd=1.55,
    rates_nzd={FREE: 0.0, OUTSIDE_FREE: 0.365},
    weekend_free_window=True,
    suits="households using more electricity on weekends",
)

CATALOGUE: tuple[PlanShape, ...] = (ANYTIME_RATE, TIME_OF_USE, FREE_WEEKENDS)


# ---------------------------------------------------------------------------
# Commitment terms
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Term:
    """A commitment length and the credit it pays.

    Independent of the pricing style, so three styles and three terms give the nine
    selectable combinations the spec describes.
    """

    code: str
    name: str
    months: int
    monthly_credit_nzd: float
    total_credit_nzd: float
    early_exit_wording: str
    """The screenshot's own words. Displayed, never arithmetic: the screenshots state a
    maximum early-exit charge but define no schedule for it, and the demo has no early-exit
    event, so subtracting it anywhere would be inventing a customer transaction."""

    @property
    def annual_credit_nzd(self) -> float:
        """Credit earned within one year. A 12-month term pays its whole $300; a 6-month
        term pays its $60 once, not twice — nothing says it renews."""
        return min(self.total_credit_nzd, self.monthly_credit_nzd * 12) or 0.0


FLEXIBLE = Term(
    code="flexible",
    name="Flexible",
    months=0,
    monthly_credit_nzd=0.0,
    total_credit_nzd=0.0,
    early_exit_wording="no exit fee",
)

SIX_MONTH = Term(
    code="term_6m",
    name="6 months",
    months=6,
    monthly_credit_nzd=10.0,
    total_credit_nzd=60.0,
    early_exit_wording="up to $50",
)

TWELVE_MONTH = Term(
    code="term_12m",
    name="12 months",
    months=12,
    monthly_credit_nzd=25.0,
    total_credit_nzd=300.0,
    early_exit_wording="up to $100",
)

TERMS: tuple[Term, ...] = (FLEXIBLE, SIX_MONTH, TWELVE_MONTH)


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

#: Below this, a switch is not a recommendation. $30 a year is about $2.50 a month, which
#: is inside the month-to-month variation of almost any household's usage — so a plan that
#: wins by less than this has not been shown to win at all.
MATERIAL_SAVING_NZD_PER_YEAR = 30.0

#: Days of usage needed before a comparison is offered. Under a fortnight the average is
#: dominated by whatever happened that week, and the comparison is a comparison against
#: that week rather than against how they live.
MIN_DAYS_TO_COMPARE = 14

#: How close to the free-window threshold counts as "it depends", in share-of-usage points.
#: Inside this band a normal month could land either side.
FREE_WINDOW_MARGIN = 0.03

#: Heating degree days per day above which a day counts as a winter day, for the seasonal
#: robustness check. Matches `hardship.signals.COLD_PERIOD_HDD` in spirit — roughly a 12°C
#: mean — but is a separate constant because the two answer different questions and should
#: be tunable apart.
WINTER_HDD_PER_DAY = 6.0

#: Minimum days on each side before the seasonal check is reported. Fewer than this and
#: "cheaper in winter" is a statement about four days.
SEASON_MIN_DAYS = 5

#: Sample days behind an hourly profile below which its band shares are not trusted enough
#: to price a banded plan from. A shape averaged over three days is one week's habits.
MIN_PROFILE_SAMPLE_DAYS = 14


# ---------------------------------------------------------------------------
# The household's shape
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HourlyShape:
    """A household's average hour-of-day import, weekdays and weekends apart.

    Built from `kea.mart_hourly_profile`, which is the only source of when-power-was-used
    that survives the warehouse export. Averages rather than actuals: the mart stores a
    monthly profile, so this gives the *shape* of a household's day, which is then applied
    to each day's real total. That is a genuinely different claim from having priced every
    half-hour, and `PlanCost.priced_from` carries the difference into the explanation.
    """

    weekday_kwh: tuple[float, ...]
    weekend_kwh: tuple[float, ...]
    sample_days: int
    months: int

    @classmethod
    def from_rows(cls, rows: Iterable) -> HourlyShape | None:
        """Fold `MartHourlyProfile` rows into one shape.

        Returns None rather than a partial shape when the profile does not cover the whole
        day. A shape missing its overnight hours would put the household's night usage at
        zero and make the time-of-use plan look expensive for a reason that is an artefact
        of the data.
        """
        weekday = [0.0] * 24
        weekend = [0.0] * 24
        seen_weekday: set[int] = set()
        seen_weekend: set[int] = set()
        sample = 0
        months: set = set()

        for row in rows:
            hour = int(row.hour_of_day)
            if not 0 <= hour <= 23:
                continue
            kwh = float(row.avg_import_kwh or 0.0)
            if getattr(row, "is_weekday", True):
                weekday[hour] += kwh
                seen_weekday.add(hour)
            else:
                weekend[hour] += kwh
                seen_weekend.add(hour)
            sample = max(sample, int(getattr(row, "sample_days", 0) or 0))
            month = getattr(row, "profile_month", None)
            if month is not None:
                months.add(month)

        if len(seen_weekday) < 24 or len(seen_weekend) < 24:
            return None
        if sum(weekday) <= 0 or sum(weekend) <= 0:
            return None

        return cls(
            weekday_kwh=tuple(weekday),
            weekend_kwh=tuple(weekend),
            sample_days=sample,
            months=len(months) or 1,
        )

    def shares_for(self, plan: PlanShape, *, is_weekend: bool) -> dict[str, float]:
        """What fraction of a weekday (or weekend) falls in each of this plan's bands.

        Normalised to sum to 1, so it can be applied to a day's real total without the
        profile's own magnitude — which is a monthly average and not this day — leaking
        into the price.
        """
        hours = self.weekend_kwh if is_weekend else self.weekday_kwh
        total = sum(hours)
        if total <= 0:
            return {}
        out: dict[str, float] = {}
        for hour, kwh in enumerate(hours):
            band = plan.band_of(hour, is_weekend=is_weekend)
            out[band] = out.get(band, 0.0) + kwh / total
        return out

    def free_window_share(self, days: list[DayUsage]) -> float | None:
        """Share of this household's total import falling in the free weekend window.

        Weighted by how many of the period's days are actually weekends, because a period
        that happens to hold five Saturdays is not the same as one holding four.
        """
        weekend_days = sum(1 for d in days if d.is_weekend)
        weekday_days = len(days) - weekend_days
        if not weekend_days:
            return 0.0

        mean_weekend = sum(self.weekend_kwh)
        mean_weekday = sum(self.weekday_kwh)
        total = mean_weekend * weekend_days + mean_weekday * weekday_days
        if total <= 0:
            return None
        in_window = sum(self.weekend_kwh[h] for h in _FREE_WINDOW_HOURS) * weekend_days
        return in_window / total


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
    export_credit_nzd: float = 0.0
    band_kwh: dict[str, float] = field(default_factory=dict)
    """How many kWh landed in each band. The working behind `energy_nzd`, and the thing a
    customer checks when they doubt the answer."""

    priced_from: str = "daily totals"
    """What resolution this was priced at. A banded plan priced from the household's own
    hour-of-day shape is a different quality of answer from a flat plan priced off a total,
    and the difference has to survive into the explanation."""

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
    shape: HourlyShape | None = None,
) -> PlanCost | None:
    """Cost this plan over these days. Returns None when the data cannot support it.

    None, not a best guess. A banded plan needs to know when the power was used, and an
    account with no hourly profile cannot answer that — pricing it at the peak rate would
    overstate it and at a blended rate would understate it, and both would be presented
    with the same confidence as a plan we can actually price.

    The whole import is priced through the bands, including any separately switched
    circuit. The screenshots define no controlled-load rate for these three plans, and
    inventing one would put a fabricated number underneath a real comparison.
    """
    if not days:
        return None

    fixed = plan.daily_fixed_nzd * len(days)
    export_kwh = _sum(days, "export_kwh")
    credit = export_kwh * plan.export_rate_nzd if has_solar else 0.0

    band_kwh: dict[str, float] = {}

    if not plan.is_banded:
        band_kwh[ANYTIME] = _sum(days, "import_kwh")
        priced_from = "daily totals"
    else:
        if shape is None or shape.sample_days < MIN_PROFILE_SAMPLE_DAYS:
            return None
        weekday_shares = shape.shares_for(plan, is_weekend=False)
        weekend_shares = shape.shares_for(plan, is_weekend=True)
        if not weekday_shares or not weekend_shares:
            return None
        for day in days:
            shares = weekend_shares if day.is_weekend else weekday_shares
            total = day.import_kwh or 0.0
            for band, share in shares.items():
                band_kwh[band] = band_kwh.get(band, 0.0) + total * share
        priced_from = (
            f"the household's own hour-of-day shape, averaged over {shape.sample_days} days"
        )

    energy = sum(kwh * plan.rates_nzd.get(band, 0.0) for band, kwh in band_kwh.items())

    return PlanCost(
        plan=plan,
        days=len(days),
        total_nzd=round(fixed + energy - credit, 2),
        fixed_nzd=round(fixed, 2),
        energy_nzd=round(energy, 2),
        export_credit_nzd=round(credit, 2),
        band_kwh={b: round(k, 2) for b, k in band_kwh.items()},
        priced_from=priced_from,
    )


def free_window_share_break_even(
    flat: PlanShape, free: PlanShape, mean_daily_kwh: float
) -> float | None:
    """What share of usage must fall in the free window for `free` to beat `flat`.

    The Sprint 3 catalogue has no two plans that cross at a usage level, so the kWh/day
    break-even the old two-plan catalogue turned on does not exist here. This is its
    replacement and it answers the same question — *what would have to be true for the
    other plan to win* — in the dimension that actually decides it.

    Setting the two daily costs equal, with `u` the mean daily kWh and `f` the free-window
    share:

        flat_fixed + flat_rate*u  =  free_fixed + free_rate*u*(1 - f)

    Returns None when `u` is zero, or when the answer is outside 0-1 — a share above 1 means
    the free plan cannot win at this usage level however the day is arranged, which is a
    real answer and not a threshold.
    """
    outside = free.rates_nzd.get(OUTSIDE_FREE)
    flat_rate = flat.rates_nzd.get(ANYTIME)
    if not outside or flat_rate is None or mean_daily_kwh <= 0:
        return None
    numerator = free.daily_fixed_nzd - flat.daily_fixed_nzd + (outside - flat_rate) * mean_daily_kwh
    share = numerator / (outside * mean_daily_kwh)
    return share if 0.0 <= share <= 1.0 else None


def annualise(period_nzd: float, days: int, winter_share: float | None = None) -> float:
    """Scale a period's cost to a year, without pretending every month is July.

    A bare `x 12` on a winter month is the classic mistake and it overstates an annual
    figure by enough to change a decision. When the period's winter share is known, the
    scale-up is damped toward the share a real year has.
    """
    if days <= 0:
        return 0.0
    per_day = period_nzd / days
    if winter_share is None:
        return round(per_day * 365, 2)
    # A New Zealand year is roughly a third cold days. A period that is 100% winter is
    # scaled down toward that; one that is already a third is left alone.
    year_winter_share = 1 / 3
    correction = 1.0 - 0.25 * (winter_share - year_winter_share)
    return round(per_day * 365 * correction, 2)


def winter_share(days: list[DayUsage]) -> float | None:
    """Fraction of these days that were cold ones. None when there is no weather data —
    which is a different thing from zero, and the caveats treat it as such."""
    known = [d for d in days if d.heating_degree_days is not None]
    if not known:
        return None
    cold = sum(1 for d in known if (d.heating_degree_days or 0) >= WINTER_HDD_PER_DAY)
    return cold / len(known)


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


@dataclass
class TermOption:
    """One term, costed against a given annual usage difference."""

    code: str
    name: str
    months: int
    term_credit_nzd_per_year: float
    total_credit_nzd: float
    early_exit_wording: str


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

    usage_saving_nzd_per_period: float = 0.0
    usage_saving_nzd_per_year: float = 0.0
    """The unconditional difference between pricing styles. The only figure a switch
    recommendation is allowed to turn on — see the module header."""

    terms: list[TermOption] = field(default_factory=list)
    best_term_code: str | None = None
    term_credit_nzd_per_year: float = 0.0
    annual_saving_nzd_per_year: float = 0.0
    """usage_saving + term_credit. Conditional on completing the commitment, and labelled
    as such everywhere it is quoted."""

    material: bool | None = False
    """Whether the best plan beats the current one by enough to be worth acting on.

    Three states, not two. `False` means the comparison ran and the difference is not
    worth acting on — a genuinely useful answer most comparison tools never give. `None`
    means the account's plan could not be matched to the catalogue, so there is nothing to
    beat and the question has not been answered. Collapsing those to one `False` is how a
    model ends up telling somebody "you're on the right plan" when nobody has any idea
    what plan they are on."""

    free_window_share: float | None = None
    """How much of this household's power is already used in the free weekend window."""

    free_window_share_needed: float | None = None
    free_window_share_headroom: float | None = None
    """Signed distance from the threshold. Positive means they are already over it. The
    most useful number here for anyone deciding whether to act — a household 1 point over
    is one quiet weekend from the other side of it."""

    band_shares: dict[str, float] = field(default_factory=dict)
    """The household's own weekday time-of-use split, as shares. What makes the time-of-use
    number checkable rather than assertable."""

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
    for plan in CATALOGUE:
        if plan.code.lower() in haystack:
            return plan.code
    if "weekend" in haystack:
        return FREE_WEEKENDS.code
    if any(token in haystack for token in ("tou", "time of use", "time-of-use")):
        return TIME_OF_USE.code
    if "anytime" in haystack:
        return ANYTIME_RATE.code
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
    shape: HourlyShape | None = None,
) -> PlanComparison:
    """Price the catalogue against this household. Pure — no I/O, no model, no database.

    Everything the answer needs is computed here so the explanation and the number cannot
    disagree: a model that is handed a saving and a threshold and asked to reason about
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

    costs = [c for p in CATALOGUE if (c := price(p, days, has_solar=has_solar, shape=shape))]

    if not costs:
        return PlanComparison(
            available=False,
            reason=(
                "none of the Kea plans could be priced against this account: the flat plan "
                "needs daily totals and the banded plans need an hourly profile, and "
                "neither is available here."
            ),
        )

    current_code = _match_current(plan_name, plan_code)

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
        comparison.usage_saving_nzd_per_period = round(current.total_nzd - best.total_nzd, 2)
        comparison.usage_saving_nzd_per_year = round(
            annualise(current.total_nzd, len(days), share_winter)
            - annualise(best.total_nzd, len(days), share_winter),
            2,
        )
        comparison.material = (
            comparison.usage_saving_nzd_per_year >= MATERIAL_SAVING_NZD_PER_YEAR
        )
    else:
        # Nothing to beat, so the question "should I switch" has not been answered — as
        # opposed to answered "no". See `PlanComparison.material`.
        comparison.material = None

    # Terms are offered whatever the usage answer is, because the customer can take one on
    # their existing plan too. What they must never do is rescue a losing switch, which is
    # why the credit is added only after `material` has been decided above.
    comparison.terms = [
        TermOption(
            code=t.code,
            name=t.name,
            months=t.months,
            term_credit_nzd_per_year=round(t.annual_credit_nzd, 2),
            total_credit_nzd=t.total_credit_nzd,
            early_exit_wording=t.early_exit_wording,
        )
        for t in TERMS
    ]
    best_term = max(TERMS, key=lambda t: t.annual_credit_nzd)
    comparison.best_term_code = best_term.code
    comparison.term_credit_nzd_per_year = round(best_term.annual_credit_nzd, 2)
    comparison.annual_saving_nzd_per_year = round(
        comparison.usage_saving_nzd_per_year + comparison.term_credit_nzd_per_year, 2
    )

    # The free-window threshold, whether or not we know their current plan: it is the
    # number that says how *close* the recommendation is, and the thing a customer with no
    # plan on file most wants — "you sit on this side of the line, by this much".
    if shape is not None:
        actual = shape.free_window_share(days)
        needed = free_window_share_break_even(ANYTIME_RATE, FREE_WEEKENDS, mean_daily)
        comparison.free_window_share = round(actual, 4) if actual is not None else None
        comparison.free_window_share_needed = round(needed, 4) if needed is not None else None
        if actual is not None and needed is not None:
            comparison.free_window_share_headroom = round(actual - needed, 4)
        comparison.band_shares = {
            b: round(s, 4) for b, s in shape.shares_for(TIME_OF_USE, is_weekend=False).items()
        }

    comparison.winter_cost, comparison.summer_cost = _seasonal(
        days, list(CATALOGUE), has_solar=has_solar, shape=shape
    )
    # Everything the catalogue holds that this household did not get a price for. An
    # earlier version built this list from the offerable plans alone, so a plan that is
    # never filtered but only unpriceable vanished from the result with no caveat at all,
    # and the customer was shown two plans with no indication a third existed.
    priced = {c.plan.code for c in costs}
    comparison.caveats = _caveats(
        comparison,
        share_winter=share_winter,
        has_controlled_load=has_controlled_load,
        has_solar=has_solar,
        skipped=[p for p in CATALOGUE if p.code not in priced],
    )
    return comparison


def _seasonal(
    days: list[DayUsage],
    plans: list[PlanShape],
    *,
    has_solar: bool,
    shape: HourlyShape | None,
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
            cost = price(plan, subset, has_solar=has_solar, shape=shape)
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
        "These are Kea's published plan rates, GST-inclusive, priced on this household's "
        "own metered usage over the period named."
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

    headroom = comparison.free_window_share_headroom
    if headroom is not None and abs(headroom) <= FREE_WINDOW_MARGIN:
        out.append(
            f"This household uses {comparison.free_window_share:.0%} of its power in the "
            f"free weekend window and would need {comparison.free_window_share_needed:.0%} "
            "for Free Weekends to win. That is close enough that a normal month could land "
            "either side of it — the honest answer is that the two cost about the same."
        )

    if comparison.current_plan_code is None:
        out.append(
            "This account's plan could not be matched to the catalogue, so there is no "
            "'saving' to quote — only a ranking of what the three Kea plans would cost. "
            "Do not tell them they would save money by switching; tell them which shape of "
            "plan suits their usage and suggest they check their actual plan against it."
        )

    if has_controlled_load:
        out.append(
            "This connection has a separately switched circuit. These three plans do not "
            "price it differently from the rest of the house, so it is included at the "
            "same rate — do not describe it as being on a controlled rate."
        )

    if has_solar:
        out.append(
            "All three plans pay the same 8c/kWh for exported solar, so the buy-back does "
            "not favour any of them. It is assumed, not published — do not present it as a "
            "reason to switch."
        )

    banded = [p.name for p in skipped if p.is_banded]
    if banded:
        out.append(
            f"{' and '.join(banded)} could not be priced: this account has no hourly "
            "profile with enough sample days, so there is no way to tell when the power was "
            "used. Do not quote a figure for it and do not estimate one."
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
        "Lead with whether they should switch, then why. The 'why' is the trade-off: "
        "Anytime charges one rate around the clock, Time of Use charges by when the power "
        "is used, and Free Weekends buys a free Saturday and Sunday window with a higher "
        "rate the rest of the time. Which wins depends entirely on the shape of their week.",
        "Quote `usage_saving_nzd_per_year` rather than the period figure — a monthly saving "
        "of four dollars sounds like nothing and is fifty a year — but say which period it "
        "was worked out from.",
        "`usage_saving_nzd_per_year` and `term_credit_nzd_per_year` are different kinds of "
        "money and must not be merged into one figure. The usage saving is unconditional; "
        "the term credit is earned only by completing the commitment. Quote them apart, and "
        "if you quote `annual_saving_nzd_per_year` say what it assumes.",
        "Never recommend a switch on the term credit. If `usage_saving_nzd_per_year` is "
        "zero or negative, the honest answer is that the other plan costs more to run, "
        "whatever credit it carries.",
    ]

    if comparison.free_window_share is not None:
        lines.append(
            "`free_window_share` is how much of their power already falls in the free "
            "weekend window and `free_window_share_needed` is how much it would take. Use "
            "the gap: it is the difference between 'switch' and 'switch, but a quiet "
            "weekend would put you back the other way'."
        )

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
        "Every dollar figure here is priced on this household's OWN metered usage over the "
        "period named, at Kea's published GST-inclusive rates. Say which period."
    )
    return " ".join(lines)


def sensitivity(comparison: PlanComparison) -> dict[str, float | str] | None:
    """How much would have to change for the recommendation to flip.

    Separated from `compare` because it is the answer to a follow-up question rather than
    part of the comparison, and computing it inline would put a fourth kind of number in
    a result that is already dense.
    """
    if not comparison.available or comparison.free_window_share_needed is None:
        return None

    headroom = comparison.free_window_share_headroom or 0.0
    daily = [c.per_day_nzd for c in comparison.costs]
    spread = round(max(daily) - min(daily), 2) if len(daily) > 1 else 0.0

    return {
        "free_window_share_needed": comparison.free_window_share_needed,
        "current_free_window_share": comparison.free_window_share or 0.0,
        "share_points_until_it_flips": round(abs(headroom) * 100, 1),
        "direction": (
            "using less at the weekend would flip it"
            if headroom > 0
            else "moving more use into the free window would flip it"
        ),
        "spread_between_cheapest_and_dearest_nzd_per_day": spread,
        "note": (
            "A household's weekend share moves by more than this between seasons, so a "
            "small headroom means the answer is 'it depends', not 'switch'."
        )
        if abs(headroom) <= FREE_WINDOW_MARGIN
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
