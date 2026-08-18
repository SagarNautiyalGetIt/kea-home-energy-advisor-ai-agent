"""Layer 1 — deterministic analytics. No model may ever reach these numbers.

This layer is the product. Everything here is a pure function over meter readings
returning typed facts, which makes it fully unit-testable with no model running —
so four people can work on it while inference is still being set up.

The July 2026 Genesis analysis is the reference case: it has a defended, published
answer (Saturday 11 July exactly 2.00x the other Saturdays; the visible spike is
only ~11% of the overshoot; the remaining ~2.4 kWh/day standing load costs roughly
$290/year against $2.60 for the spike). test_analytics_july.py locks those in.

Illustrative unit price is 30c/kWh because Kea's actual tariff is not public. Every
surface that shows a dollar figure must say so — same rule as the deck.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from app.schemas import Fact, FactBundle, Intent

#: Illustrative only — Kea's real tariff is not public. Label it wherever it shows.
DEFAULT_UNIT_PRICE_NZD = 0.30

#: Standing load is the floor a house never drops below. The lowest few days of a
#: month approximate it better than the true minimum, which catches holidays away.
BASELOAD_PERCENTILE = 0.10


@dataclass(frozen=True)
class UsageWindow:
    """A period of daily totals. Half-hourly data collapses to this for most analyses."""

    customer_id: str
    period: str
    daily_kwh: list[float]
    unit_price_nzd: float = DEFAULT_UNIT_PRICE_NZD

    def __post_init__(self) -> None:
        if not self.daily_kwh:
            raise ValueError("UsageWindow needs at least one day of readings")

    @property
    def total_kwh(self) -> float:
        return sum(self.daily_kwh)

    @property
    def mean_kwh(self) -> float:
        return statistics.fmean(self.daily_kwh)

    @property
    def cost_nzd(self) -> float:
        return self.total_kwh * self.unit_price_nzd


def standing_load_kwh_per_day(window: UsageWindow) -> float:
    """The load the house carries every day regardless of behaviour.

    Taken as a low percentile of daily totals rather than the minimum, so one day
    away from home doesn't define the baseline.
    """
    ordered = sorted(window.daily_kwh)
    idx = max(0, int(len(ordered) * BASELOAD_PERCENTILE) - 1)
    return ordered[idx]


def spike_days(window: UsageWindow, threshold: float = 1.5) -> list[tuple[int, float]]:
    """Days exceeding `threshold` x the median. Returns (day_index, kwh), 0-based."""
    median = statistics.median(window.daily_kwh)
    return [(i, v) for i, v in enumerate(window.daily_kwh) if v > median * threshold]


#: A day must be nearly double a normal day to count as a one-off spike.
#:
#: ⚠️ This threshold materially changes the headline claim. On the July household:
#:   1.8x -> only Sat 11 Jul qualifies; spike = 8.4 kWh, 10.4% of the overshoot, $2.52
#:   1.5x -> Fri 10 Jul (14.1 kWh) also qualifies; spike = 13.3 kWh, 16.4%, $3.99
#: The published analysis compared *Saturdays against each other* and identified 11 July
#: alone (8.8 kWh, 10.9%, $2.64), which 1.8x reproduces. 1.5x is arguably the better
#: detector — 10 July is genuinely anomalous — but it weakens "the spike is only 11%".
#: OPEN QUESTION for the team: which method do we defend? See docs/decision-log.md.
SPIKE_THRESHOLD = 1.8


def overshoot_attribution(
    window: UsageWindow,
    comparison_baseline_kwh_per_day: float,
    spike_threshold: float = SPIKE_THRESHOLD,
) -> tuple[float, float]:
    """Split the overshoot vs a comparison baseline into (spike_kwh, sustained_kwh).

    This is the finding the pitch turns on: the spike everyone stares at is small,
    and the sustained load nobody shows you is where the money actually goes.

    **The baseline must be supplied, not derived from the household itself.** The
    published 89/11 split is measured against what similar homes use, not against
    the house's own floor — a house whose every day sits just above its own minimum
    has almost no "sustained" component by that definition, which is an artefact of
    the maths rather than a fact about the house. Making the comparison explicit
    keeps the modelling assumption visible instead of buried.

    Calibrate against the real July measurements on Day 4; test_analytics_july.py
    holds the published targets.
    """
    daily = window.daily_kwh
    median_daily = statistics.median(daily)

    # A spike is an anomalous day. Its contribution is only the excess over a
    # normal day for this household — not the whole day's usage.
    spike_kwh = sum(v - median_daily for v in daily if v > median_daily * spike_threshold)

    total_overshoot = sum(max(0.0, v - comparison_baseline_kwh_per_day) for v in daily)
    sustained_kwh = max(0.0, total_overshoot - spike_kwh)
    return spike_kwh, sustained_kwh


def project_month_end(window: UsageWindow, days_in_month: int) -> float:
    """Straight-line projection of month-end cost from usage so far.

    Deliberately naive. 71.4% of surveyed customers asked for a dollar figure with
    a mid-month warning; a simple, explainable projection beats a clever one we
    cannot defend when asked how it works.
    """
    if days_in_month < len(window.daily_kwh):
        raise ValueError("days_in_month is shorter than the readings supplied")
    return window.mean_kwh * days_in_month * window.unit_price_nzd


# ---------- fact bundle builders, one per intent ----------

_NO_APPLIANCE = (
    "Do not name or guess which appliance caused any change — half-hourly meter "
    "data cannot identify appliances, and claiming otherwise is a fabrication."
)
_ILLUSTRATIVE_PRICE = (
    "Dollar figures use an illustrative 30c/kWh; say so if you quote one."
)


def sustained_overshoot_per_day(
    window: UsageWindow,
    comparison_baseline_kwh_per_day: float,
) -> float:
    """The everyday extra this house carries over a comparable home.

    **This — not `standing_load_kwh_per_day` — is the published "2.4 kWh a day".**
    The two are easy to confuse and mean different things: the standing load is the
    absolute floor (about 7.1 kWh/day for the July household), while this is the
    sustained amount *above the benchmark*. Getting them the wrong way round is what
    produced the first version of this module's headline figure.
    """
    spike_kwh, sustained_kwh = overshoot_attribution(window, comparison_baseline_kwh_per_day)
    spike_day_count = sum(
        1 for v in window.daily_kwh if v > statistics.median(window.daily_kwh) * SPIKE_THRESHOLD
    )
    ordinary_days = max(1, len(window.daily_kwh) - spike_day_count)
    return sustained_kwh / ordinary_days


def build_why_high(window: UsageWindow, comparison_baseline_kwh_per_day: float) -> FactBundle:
    """The flagship answer. `comparison_baseline_kwh_per_day` is what similar homes
    use — it comes from the retailer's benchmark, not from this household.

    The line that lands in the room: *the spike everyone stares at costs $2.60; the
    one nobody shows you costs $290 a year.* Note that the $290 is the **whole
    overshoot** annualised, per research/analysis.md — not the sustained portion
    alone. Label it that way or the arithmetic won't survive a judge checking it.
    """
    spike_kwh, sustained_kwh = overshoot_attribution(window, comparison_baseline_kwh_per_day)
    price = window.unit_price_nzd
    total_overshoot = spike_kwh + sustained_kwh
    spike_share = (spike_kwh / total_overshoot * 100) if total_overshoot else 0.0
    everyday_extra = sustained_overshoot_per_day(window, comparison_baseline_kwh_per_day)

    return FactBundle(
        customer_id=window.customer_id,
        intent=Intent.WHY_HIGH,
        period=window.period,
        facts=[
            Fact.energy("sustained_overshoot", everyday_extra,
                        "Extra you use every day compared with similar homes", per_day=True),
            Fact.money("overshoot_annual_cost", total_overshoot * price * 12,
                       "What that extra usage costs over a year", per_year=True),
            Fact.money("spike_cost", spike_kwh * price, "Cost of the one-off spike"),
            Fact.percent("spike_share_of_overshoot", spike_share,
                         "Share of the extra usage the spike explains"),
            Fact.money("period_cost", window.cost_nzd, f"Total cost for {window.period}"),
        ],
        caveats=[_NO_APPLIANCE, _ILLUSTRATIVE_PRICE],
    )


def build_what_will_i_pay(window: UsageWindow, days_in_month: int) -> FactBundle:
    projected = project_month_end(window, days_in_month)
    return FactBundle(
        customer_id=window.customer_id,
        intent=Intent.WHAT_WILL_I_PAY,
        period=window.period,
        facts=[
            Fact.money("projected_month_end_cost", projected, "Projected cost for the full month"),
            Fact.money("cost_so_far", window.cost_nzd, "Cost so far this month"),
            Fact.energy("mean_daily", window.mean_kwh, "Average daily use", per_day=True),
            Fact.percent("days_elapsed_pct", len(window.daily_kwh) / days_in_month * 100,
                         "How far through the month you are"),
        ],
        caveats=[
            _ILLUSTRATIVE_PRICE,
            "This is a straight-line projection from usage so far, not a guarantee. "
            "Say that it is an estimate.",
        ],
    )


# ───────────────────────────── weather ─────────────────────────────


def heating_degree_days(mean_temp_c: float, base_c: float = 18.0) -> float:
    """How much heating a day called for. NZ convention uses an 18 °C base."""
    return max(0.0, base_c - mean_temp_c)


def weather_attribution(
    window: UsageWindow,
    hdd_by_day: list[float],
    normal_hdd_per_day: float,
) -> tuple[float, float]:
    """Split usage into (weather_driven_kwh, everything_else_kwh).

    Answers the question that protects us from the worst possible mistake: telling a family
    they overspent when the weather did it. The brief flags this as able to undercut our
    headline finding if we skip it.

    Method: least-squares fit of daily kWh against heating degree days. The slope is how
    many kWh this house burns per degree-day — its heating sensitivity. Multiply that by
    how much colder than normal the period actually was, and you have the part of the bill
    the weather explains.

    Deliberately simple and explainable. A judge can follow "we measured how much extra you
    use per cold degree, then multiplied by how much colder than usual it was" — which
    matters more than squeezing out accuracy we can't defend.
    """
    if len(hdd_by_day) != len(window.daily_kwh):
        raise ValueError("need one heating-degree-day figure per day of readings")

    # A month with no temperature variation gives no signal to fit against.
    if len(set(hdd_by_day)) < 2:
        return 0.0, window.total_kwh

    fit = statistics.linear_regression(hdd_by_day, window.daily_kwh)
    kwh_per_degree_day = max(0.0, fit.slope)  # negative would mean cold days use less

    excess_hdd = sum(max(0.0, h - normal_hdd_per_day) for h in hdd_by_day)
    weather_kwh = min(window.total_kwh, kwh_per_degree_day * excess_hdd)
    return weather_kwh, window.total_kwh - weather_kwh


# ───────────────────────────── tariff ─────────────────────────────


@dataclass(frozen=True)
class TariffOption:
    name: str
    unit_price_nzd: float
    daily_fixed_nzd: float

    def cost_for(self, kwh: float, days: int) -> float:
        return kwh * self.unit_price_nzd + days * self.daily_fixed_nzd


def compare_tariffs(
    window: UsageWindow,
    current: TariffOption,
    alternative: TariffOption,
) -> tuple[float, float, float]:
    """Return (current_cost, alternative_cost, annual_saving). Saving is negative if
    switching would cost more — never present a loss as a gain.

    New Zealand's Low Fixed Charge plan trades a near-zero daily charge for a higher unit
    rate, so it suits low users and penalises high ones. The Consumer Care Obligations
    expect retailers to proactively surface a better-suited plan, which makes this closer
    to a requirement than a feature. The brief ranks it as job #1 of five.
    """
    days = len(window.daily_kwh)
    now = current.cost_for(window.total_kwh, days)
    alt = alternative.cost_for(window.total_kwh, days)
    monthly_saving = now - alt
    return now, alt, monthly_saving * 12


# ───────────────────────────── hardship ─────────────────────────────


@dataclass(frozen=True)
class CollapseSignal:
    """A usage collapse — often someone rationing heat they cannot afford."""

    detected: bool
    earlier_mean: float
    recent_mean: float
    drop_pct: float


def detect_usage_collapse(
    window: UsageWindow,
    tail_days: int = 7,
    threshold_pct: float = 40.0,
) -> CollapseSignal:
    """Compare the most recent week against the rest of the period.

    Consumer Care Obligations cl. 9.3(c) names "significant consumption changes" as a
    signal that puts a retailer on notice of possible payment difficulty. Detecting this
    is the premise of the whole product — and it raises Kea's obligations rather than
    lowering them, which we say ourselves rather than waiting to be asked.

    **This is a signal, never a diagnosis.** A collapse might be a holiday. It routes to a
    human; it must never produce an accusation, and the hardship reply carries no figures
    at all — nothing to get wrong.
    """
    daily = window.daily_kwh
    if len(daily) <= tail_days:
        return CollapseSignal(False, 0.0, 0.0, 0.0)

    earlier = statistics.fmean(daily[:-tail_days])
    recent = statistics.fmean(daily[-tail_days:])
    drop = (earlier - recent) / earlier * 100 if earlier else 0.0
    return CollapseSignal(drop >= threshold_pct, earlier, recent, drop)


def build_weather_check(
    window: UsageWindow,
    hdd_by_day: list[float],
    normal_hdd_per_day: float,
) -> FactBundle:
    """"Wasn't that just the cold snap?" — demo line 2.

    Telling a household they overspent when the weather did it is the fastest way to lose
    their trust, so this answer exists to give the weather its due before anything else.
    """
    weather_kwh, other_kwh = weather_attribution(window, hdd_by_day, normal_hdd_per_day)
    price = window.unit_price_nzd
    total = window.total_kwh
    weather_share = (weather_kwh / total * 100) if total else 0.0

    return FactBundle(
        customer_id=window.customer_id,
        intent=Intent.USING_MORE_THAN_USUAL,
        period=window.period,
        facts=[
            Fact.percent("weather_share", weather_share,
                         "Share of your usage the colder weather explains"),
            Fact.money("weather_cost", weather_kwh * price, "What the extra heating cost"),
            Fact.money("other_cost", other_kwh * price, "The rest of your usage"),
            Fact.energy("total_usage", total, f"Total used in {window.period}"),
        ],
        caveats=[
            _NO_APPLIANCE,
            _ILLUSTRATIVE_PRICE,
            "This compares against typical temperatures for the period, not against a "
            "forecast. Say it is an estimate of the weather's share.",
        ],
    )


def build_what_costs_most(
    window: UsageWindow,
    comparison_baseline_kwh_per_day: float,
) -> FactBundle:
    """"Which appliance caused it?" — demo line 4, and the honest refusal.

    Half-hourly meter data genuinely cannot identify an appliance. Other products guess.
    We say we can't, then give the thing we *do* know — which is where the money actually
    is. Two survey respondents asked exactly this question, so it will come up.
    """
    everyday_extra = sustained_overshoot_per_day(window, comparison_baseline_kwh_per_day)
    floor = standing_load_kwh_per_day(window)
    price = window.unit_price_nzd

    return FactBundle(
        customer_id=window.customer_id,
        intent=Intent.WHAT_COSTS_MOST,
        period=window.period,
        facts=[
            Fact.energy("standing_load", floor, "Running every day, even when you're out",
                        per_day=True),
            Fact.money("standing_load_annual", floor * 365 * price,
                       "What that costs over a year", per_year=True),
            Fact.energy("sustained_overshoot", everyday_extra,
                        "Extra you use daily versus similar homes", per_day=True),
        ],
        caveats=[
            "You MUST say plainly that you cannot identify which appliance is responsible, "
            "and that this is because a meter reads the whole house every half hour rather "
            "than each appliance. Do not hedge this and do not guess.",
            _ILLUSTRATIVE_PRICE,
        ],
    )


def build_tariff_check(
    window: UsageWindow,
    current: TariffOption,
    alternative: TariffOption,
) -> FactBundle:
    """Is there a plan that suits this household better?

    The Consumer Care Obligations expect retailers to proactively tell customers about
    plans that might cost less — so this sits closer to a requirement than a feature.
    """
    now, alt, annual_saving = compare_tariffs(window, current, alternative)
    better = annual_saving > 0

    facts = [
        Fact.money("current_plan_cost", now, f"Your plan for {window.period}"),
        Fact.money("alternative_plan_cost", alt, "The other plan would have been"),
    ]
    if better:
        facts.append(
            Fact.money("annual_saving", annual_saving, "You would save about", per_year=True)
        )

    return FactBundle(
        customer_id=window.customer_id,
        intent=Intent.TARIFF_CHECK,
        period=window.period,
        facts=facts,
        caveats=[
            _ILLUSTRATIVE_PRICE,
            "Based on one month of usage. Say that a full year would give a firmer answer."
            if better
            else "The other plan is NOT cheaper for this household. Say so plainly — never "
            "present a switch as a saving when it isn't.",
        ],
    )


def build_hardship() -> FactBundle:
    """Someone has said they're struggling to pay.

    Carries **no figures at all** — deliberately. There is nothing to get wrong, and a
    number has no place in this reply. The job is to acknowledge briefly and hand over to
    a person; under Consumer Care Obligations Part 6 that handoff is closer to a legal
    duty than a courtesy.
    """
    return FactBundle(
        customer_id="",
        intent=Intent.HARDSHIP,
        period="",
        facts=[],
        caveats=[
            "Acknowledge warmly and briefly. Do NOT quote any figure, do NOT give financial "
            "advice, do NOT suggest ways to cut usage. Say you are connecting them with "
            "someone who can help with payment options, and stop there.",
        ],
    )
