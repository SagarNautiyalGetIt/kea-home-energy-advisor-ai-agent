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


def overshoot_attribution(window: UsageWindow) -> tuple[float, float]:
    """Split consumption above the standing load into (spike_kwh, sustained_kwh).

    This is the finding the pitch turns on: the spike everyone stares at is small,
    and the sustained load nobody shows you is where the money actually goes.
    """
    base = standing_load_kwh_per_day(window)
    above_base = [max(0.0, v - base) for v in window.daily_kwh]
    median_above = statistics.median(above_base)
    spike_kwh = sum(max(0.0, v - median_above) for v in above_base)
    sustained_kwh = sum(above_base) - spike_kwh
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


def build_why_high(window: UsageWindow) -> FactBundle:
    base = standing_load_kwh_per_day(window)
    spike_kwh, sustained_kwh = overshoot_attribution(window)
    price = window.unit_price_nzd
    total_overshoot = spike_kwh + sustained_kwh
    spike_share = (spike_kwh / total_overshoot * 100) if total_overshoot else 0.0

    return FactBundle(
        customer_id=window.customer_id,
        intent=Intent.WHY_HIGH,
        period=window.period,
        facts=[
            Fact.energy("standing_load", base, "Load running every day", per_day=True),
            Fact.money("standing_load_annual_cost", base * 365 * price,
                       "What that daily load costs over a year", per_year=True),
            Fact.money("spike_cost", spike_kwh * price, "Cost of the one-off spikes"),
            Fact.percent("spike_share_of_overshoot", spike_share,
                         "Share of the extra usage the spikes explain"),
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
