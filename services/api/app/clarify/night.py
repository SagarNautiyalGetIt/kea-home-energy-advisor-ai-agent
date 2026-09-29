"""A conservative, question-only detector for a sustained rise in metered night use."""

from __future__ import annotations

import datetime as dt
import statistics

from app.analytics.account import DayUsage


def sustained_night_rise(days: list[DayUsage]) -> float | None:
    """Return the kWh/day rise, never an appliance attribution.

    Require seven complete baseline nights and five subsequent nights. This detects a
    persistent change; a one-night spike, a missing band, or estimated data stays silent.
    """
    recent = sorted(days, key=lambda day: day.date)[-12:]
    if len(recent) != 12 or any(day.night_kwh is None for day in recent):
        return None
    if any(
        later.date - earlier.date != dt.timedelta(days=1)
        for earlier, later in zip(recent, recent[1:], strict=False)
    ):
        return None
    baseline = statistics.median(float(day.night_kwh) for day in recent[:7])
    new = [float(day.night_kwh) for day in recent[7:]]
    rise = statistics.median(new) - baseline
    if rise < 1.5 or statistics.median(new) < baseline * 1.45:
        return None
    if sum(value >= baseline + 1.5 for value in new) < 4:
        return None
    return round(rise, 2)
