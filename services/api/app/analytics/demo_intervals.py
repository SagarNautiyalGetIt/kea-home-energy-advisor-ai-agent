"""Illustrative intervals for demo charts and the seeder, never meter observations.

The published July daily totals remain unchanged. Their intraday shape is invented;
sharing it prevents fixture and seeded demos from telling different chart stories.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("Pacific/Auckland")
SHAPE = (
    *[0.55] * 12,
    1.35,
    1.70,
    1.85,
    1.60,
    1.30,
    1.05,
    *[0.70] * 14,
    1.25,
    1.65,
    2.05,
    2.30,
    2.20,
    1.95,
    1.60,
    1.35,
    1.15,
    1.00,
    0.85,
    0.75,
    0.65,
    0.60,
    0.58,
    0.56,
)


def intervals(day: dt.date, daily_kwh: float) -> list[tuple[dt.datetime, Decimal]]:
    """An explicit demo shape, conserving the total and actual NZ day length."""
    start = dt.datetime.combine(day, dt.time(), ZONE).astimezone(dt.UTC)
    end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), ZONE).astimezone(dt.UTC)
    moments = [
        start + dt.timedelta(minutes=30 * index)
        for index in range(int((end - start).total_seconds() / 1800))
    ]
    weights = [
        Decimal(str(SHAPE[at.astimezone(ZONE).hour * 2 + at.astimezone(ZONE).minute // 30]))
        for at in moments
    ]
    total = Decimal(str(daily_kwh))
    if not total.is_finite() or total < 0:
        raise ValueError("Demo daily usage must be finite and nonnegative")
    # Match public.reading Numeric(10, 3) so seeded and in-memory demos agree.
    quantum = Decimal("0.001")
    total = total.quantize(quantum)
    weight_sum = sum(weights)
    quotas = [total / quantum * weight / weight_sum for weight in weights]
    units = [int(quota) for quota in quotas]
    remaining = int(total / quantum) - sum(units)
    for index in sorted(
        range(len(units)), key=lambda index: quotas[index] - units[index], reverse=True
    )[:remaining]:
        units[index] += 1
    values = [quantum * value for value in units]
    return [(at.astimezone(ZONE), value) for at, value in zip(moments, values, strict=True)]


def bands(day: dt.date, daily_kwh: float) -> tuple[float, float, float]:
    """Peak/off-peak/night under the illustrative demo schedule, not a real tariff."""
    totals = [Decimal(0), Decimal(0), Decimal(0)]
    for at, value in intervals(day, daily_kwh):
        hour = at.hour
        index = 0 if 7 <= hour < 11 or 17 <= hour < 21 else 2 if hour < 7 or hour >= 23 else 1
        totals[index] += value
    return float(totals[0]), float(totals[1]), float(totals[2])
