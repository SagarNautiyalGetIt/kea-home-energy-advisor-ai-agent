from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient

from app.analytics.account import AccountContext, ConnectionFacts, DataQuality, DayUsage
from app.analytics.annual_demand import from_context
from app.analytics.engine import UsageWindow
from app.analytics.repository import UsageContext
from app.api import routes
from app.main import app


def context(
    rows: list[DayUsage], *, has_solar: bool = False, estimated_read_pct: float = 0
) -> UsageContext:
    return UsageContext(
        window=UsageWindow("C-1", "latest cycle", [row.import_kwh for row in rows[-31:]]),
        baseline=8,
        label="Customer one",
        hdd=[],
        normal_hdd=0,
        account=AccountContext(
            account_ref="C-1",
            connection=ConnectionFacts(icp_number="ICP-1", has_solar=has_solar),
            quality=DataQuality(estimated_read_pct=estimated_read_pct),
            days=rows,
        ),
    )


def days(count: int, *, export_kwh: float = 0) -> list[DayUsage]:
    start = dt.date(2025, 1, 1)
    return [
        DayUsage(
            date=start + dt.timedelta(days=index),
            import_kwh=8 + index / 100,
            export_kwh=export_kwh,
        )
        for index in range(count)
    ]


def test_annual_demand_uses_the_latest_complete_365_days() -> None:
    rows = days(397)
    result = from_context(context(rows, estimated_read_pct=2.5))

    assert result.available
    assert result.annual_kwh == round(sum(row.import_kwh for row in rows[-365:]), 2)
    assert result.period_start == rows[-365].date
    assert result.period_end == rows[-1].date
    assert result.estimated_read_pct == 2.5


def test_annual_demand_annualises_partial_account_history() -> None:
    rows = days(31)
    result = from_context(context(rows))

    assert result.available
    assert result.annual_kwh == round(sum(row.import_kwh for row in rows) / 31 * 365, 2)
    assert "Estimated from 31 complete days" in result.note
    assert "seasonal changes" in result.note


def test_annual_demand_annualises_fixture_window_without_account_rows() -> None:
    values = [8.0] * 31
    ctx = UsageContext(
        window=UsageWindow("H-JUL", "latest cycle", values),
        baseline=8,
        label="Sarah",
        hdd=[],
        normal_hdd=0,
        account=None,
    )

    result = from_context(ctx)

    assert result.available
    assert result.annual_kwh == 2920
    assert result.period_start is None
    assert result.source == "account billing-period usage"


def test_annual_demand_requires_at_least_28_complete_days() -> None:
    result = from_context(context(days(27)))

    assert not result.available
    assert result.annual_kwh is None
    assert "at least 28 days" in result.note


def test_annual_demand_marks_existing_solar_estimate_as_lower_bound() -> None:
    result = from_context(context(days(31, export_kwh=0.4), has_solar=True))

    assert result.available
    assert result.annual_kwh is not None
    assert "lower-bound grid-import estimate" in result.note
    assert "excludes solar electricity used directly" in result.note


def test_annual_demand_uses_estimate_when_latest_year_has_a_gap() -> None:
    rows = days(366)
    rows.pop(-20)
    result = from_context(context(rows))

    assert result.available
    assert result.annual_kwh is not None
    assert "Estimated from 365 complete days" in result.note


def test_annual_demand_endpoint_returns_the_computed_account_value(monkeypatch) -> None:
    expected_context = context(days(365))

    class Repository:
        async def context(self, customer_id: str) -> UsageContext:
            assert customer_id == "C-1"
            return expected_context

    monkeypatch.setattr(routes, "get_repository", lambda: Repository())
    with TestClient(app) as client:
        response = client.get("/api/households/C-1/annual-demand")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    assert body["annual_kwh"] == round(sum(row.import_kwh for row in days(365)), 2)
    assert body["period_start"] == "2025-01-01"
    assert body["period_end"] == "2025-12-31"
