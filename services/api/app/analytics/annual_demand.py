"""A customer's measured or estimated annual electricity demand for solar scenarios."""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

from app.analytics.repository import UsageContext

ANNUAL_DAYS = 365
MIN_ESTIMATE_DAYS = 28


@dataclass(frozen=True)
class AnnualDemand:
    available: bool
    annual_kwh: float | None
    period_start: dt.date | None
    period_end: dt.date | None
    days_available: int
    days_required: int
    estimated_read_pct: float | None
    source: str
    note: str


def _unavailable(days_available: int, *, estimated_read_pct: float | None = None) -> AnnualDemand:
    return AnnualDemand(
        available=False,
        annual_kwh=None,
        period_start=None,
        period_end=None,
        days_available=days_available,
        days_required=MIN_ESTIMATE_DAYS,
        estimated_read_pct=estimated_read_pct,
        source="unavailable",
        note=(
            f"This account has {days_available} complete days of usage available; "
            f"at least {MIN_ESTIMATE_DAYS} days are needed for a reasonable annual estimate. "
            "Enter a representative annual value."
        ),
    )


def _estimate_note(days: int, daily_average: float, *, lower_bound: bool) -> str:
    note = (
        f"Estimated from {days} complete days of account usage: average "
        f"{daily_average:.2f} kWh/day × 365. This short history may not capture seasonal changes."
    )
    if lower_bound:
        note += (
            " Because this home has solar generation or exports, this is a lower-bound grid-import "
            "estimate and excludes solar electricity used directly in the home."
        )
    return note


def from_context(ctx: UsageContext) -> AnnualDemand:
    """Return an exact rolling year, or annualise at least 28 complete usage days."""

    account = ctx.account
    if account is None or not account.days:
        imports = list(ctx.window.daily_kwh)
        if any(not math.isfinite(value) or value < 0 for value in imports):
            return _unavailable(0)
        if len(imports) < MIN_ESTIMATE_DAYS:
            return _unavailable(len(imports))
        daily_average = sum(imports) / len(imports)
        return AnnualDemand(
            available=True,
            annual_kwh=round(daily_average * ANNUAL_DAYS, 2),
            period_start=None,
            period_end=None,
            days_available=len(imports),
            days_required=MIN_ESTIMATE_DAYS,
            estimated_read_pct=None,
            source="account billing-period usage",
            note=_estimate_note(len(imports), daily_average, lower_bound=False),
        )

    complete_rows = sorted(
        (row for row in account.days if row.is_complete), key=lambda row: row.date
    )
    estimated_pct = account.quality.estimated_read_pct
    if len(complete_rows) < MIN_ESTIMATE_DAYS:
        return _unavailable(len(complete_rows), estimated_read_pct=estimated_pct)

    imports = [row.import_kwh for row in complete_rows]
    if any(not math.isfinite(value) or value < 0 for value in imports):
        return AnnualDemand(
            available=False,
            annual_kwh=None,
            period_start=complete_rows[0].date,
            period_end=complete_rows[-1].date,
            days_available=len(complete_rows),
            days_required=MIN_ESTIMATE_DAYS,
            estimated_read_pct=estimated_pct,
            source="kea.mart_daily_usage",
            note="The meter history contains an invalid reading, so it cannot be used here.",
        )

    rows_by_date = {row.date: row for row in complete_rows}
    latest = complete_rows[-1].date
    start = latest - dt.timedelta(days=ANNUAL_DAYS - 1)
    annual_rows = [
        rows_by_date.get(start + dt.timedelta(days=offset)) for offset in range(ANNUAL_DAYS)
    ]
    exact_year = all(row is not None for row in annual_rows)
    has_generation = bool(account.connection and account.connection.has_solar) or any(
        row.export_kwh > 0 for row in complete_rows
    )

    if exact_year and not has_generation:
        exact_imports = [row.import_kwh for row in annual_rows if row is not None]
        estimated_note = (
            f" {estimated_pct:.1f}% of readings were estimated." if estimated_pct > 0 else ""
        )
        return AnnualDemand(
            available=True,
            annual_kwh=round(sum(exact_imports), 2),
            period_start=start,
            period_end=latest,
            days_available=len(complete_rows),
            days_required=ANNUAL_DAYS,
            estimated_read_pct=estimated_pct,
            source="kea.mart_daily_usage",
            note=(
                f"Loaded from this account's complete meter history for {start.isoformat()} to "
                f"{latest.isoformat()}.{estimated_note}"
            ),
        )

    estimate_rows = complete_rows[-ANNUAL_DAYS:]
    daily_average = sum(row.import_kwh for row in estimate_rows) / len(estimate_rows)
    return AnnualDemand(
        available=True,
        annual_kwh=round(daily_average * ANNUAL_DAYS, 2),
        period_start=estimate_rows[0].date,
        period_end=estimate_rows[-1].date,
        days_available=len(complete_rows),
        days_required=MIN_ESTIMATE_DAYS,
        estimated_read_pct=estimated_pct,
        source="kea.mart_daily_usage",
        note=_estimate_note(len(estimate_rows), daily_average, lower_bound=has_generation),
    )
