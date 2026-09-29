"""Date-filtered household usage for mobile charts, with explicit provenance."""

from __future__ import annotations

import datetime as dt

from app.analytics.repository import UsageContext
from app.schemas import HouseholdUsageSeries


def from_context(
    customer_id: str, ctx: UsageContext, start: dt.date, end: dt.date
) -> HouseholdUsageSeries:
    """Use stored mart dates when present; otherwise expose the labelled demo period.

    A daily aggregate cannot reveal time-of-use bands. Missing values stay null so a
    chart cannot turn an assumed percentage into a customer energy fact.
    """
    account_days = (
        sorted((day for day in ctx.account.days if day.is_complete), key=lambda day: day.date)
        if ctx.account
        else []
    )
    if ctx.account and ctx.account.days:
        rows = [
            (
                day.date,
                day.import_kwh,
                day.peak_kwh if day.estimated_count == 0 else None,
                day.off_peak_kwh if day.estimated_count == 0 else None,
                day.night_kwh if day.estimated_count == 0 else None,
                "estimated" if day.estimated_count > 0 else "measured",
            )
            for day in account_days
        ]
        date_source = "mart"
    elif isinstance(ctx.period_start, dt.date):
        rows = [
            (ctx.period_start + dt.timedelta(days=index), kwh, None, None, None, "demo")
            for index, kwh in enumerate(ctx.window.daily_kwh)
        ]
        date_source = "demo"
    else:
        rows = []
        date_source = "demo"

    selected = [row for row in rows if start <= row[0] <= end]
    peak = [row[2] for row in selected]
    off_peak = [row[3] for row in selected]
    night = [row[4] for row in selected]
    total_kwh = round(sum(row[1] for row in selected), 2)
    return HouseholdUsageSeries(
        customer_id=customer_id,
        daily_dates=[row[0] for row in selected],
        daily_kwh=[row[1] for row in selected],
        daily_quality=[row[5] for row in selected],
        daily_peak_kwh=peak,
        daily_off_peak_kwh=off_peak,
        daily_night_kwh=night,
        band_data_source=(
            "measured" if any(value is not None for value in peak + off_peak + night) else None
        ),
        date_source=date_source,
        total_kwh=total_kwh,
        estimated_cost_nzd=round(total_kwh * ctx.window.unit_price_nzd, 2),
        available_from=rows[0][0] if rows else None,
        available_to=rows[-1][0] if rows else None,
    )
