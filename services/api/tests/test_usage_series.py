"""Historical usage API contract and provenance boundaries."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace

from fastapi.testclient import TestClient

from app import auth
from app.analytics.account import AccountContext, DayUsage
from app.analytics.engine import UsageWindow
from app.analytics.repository import UsageContext
from app.analytics.usage_series import from_context
from app.api import routes
from app.main import app


def _headers(customer_id: str = "H-JUL") -> dict[str, str]:
    return {"Authorization": f"Bearer {auth.issue_demo_token(customer_id)}"}


def test_fixture_range_labels_illustrative_bands_and_reconciles_hourly_shape(monkeypatch) -> None:
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    with TestClient(app) as client:
        result = client.get(
            "/api/households/H-JUL/usage-series",
            params={"start": "2026-07-03", "end": "2026-07-04"},
            headers=_headers(),
        )
    assert result.status_code == 200
    series = result.json()
    assert series["date_source"] == "demo"
    assert series["daily_dates"] == ["2026-07-03", "2026-07-04"]
    assert len(series["daily_kwh"]) == 2
    assert series["daily_quality"] == ["demo", "demo"]
    assert all(value is not None for value in series["daily_peak_kwh"])
    assert series["band_data_source"] == "demo"
    assert series["available_from"] == "2026-07-01"
    assert series["available_to"] == "2026-07-31"

    with TestClient(app) as client:
        summary = client.get("/api/households/H-JUL").json()
        hours = client.get(
            "/api/households/H-JUL/hourly-usage?day=2026-07-03", headers=_headers()
        ).json()
    assert summary["date_source"] == "demo"
    assert round(sum(hour["kwh"] for hour in hours["hours"]), 4) == series["daily_kwh"][0]
    for index, total in enumerate(series["daily_kwh"]):
        bands = [
            series[field][index]
            for field in ("daily_peak_kwh", "daily_off_peak_kwh", "daily_night_kwh")
        ]
        assert round(sum(bands), 4) == total


def test_missing_production_context_is_not_given_a_demo_interval_profile() -> None:
    ctx = UsageContext(
        window=UsageWindow("C-1", "July 2026", [3.0]),
        baseline=3,
        label="Customer",
        hdd=[],
        normal_hdd=0,
        period_start=dt.date(2026, 7, 1),
    )
    result = from_context("C-1", ctx, dt.date(2026, 7, 1), dt.date(2026, 7, 1))
    assert result.daily_peak_kwh == [None]
    assert result.band_data_source is None


def test_empty_range_preserves_availability_without_fabricating_points(monkeypatch) -> None:
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    with TestClient(app) as client:
        result = client.get(
            "/api/households/H-JUL/usage-series",
            params={"start": "2026-08-01", "end": "2026-08-31"},
            headers=_headers(),
        )
    assert result.status_code == 200
    series = result.json()
    assert series["daily_dates"] == []
    assert series["daily_kwh"] == []
    assert series["total_kwh"] == 0
    assert series["estimated_cost_nzd"] == 0
    assert series["available_to"] == "2026-07-31"


def test_history_uses_dated_mart_rows_beyond_the_current_bill() -> None:
    ctx = UsageContext(
        window=UsageWindow("C-1", "June 2026", [3.0], unit_price_nzd=0.4),
        baseline=3,
        label="Customer",
        hdd=[],
        normal_hdd=0,
        account=AccountContext(
            account_ref="C-1",
            days=[
                DayUsage(date=dt.date(2026, 5, 31), import_kwh=2.0),
                DayUsage(
                    date=dt.date(2026, 6, 1),
                    import_kwh=99.0,
                    interval_count=2,
                    expected_intervals=48,
                ),
                DayUsage(
                    date=dt.date(2026, 6, 2),
                    import_kwh=3.0,
                    peak_kwh=1.0,
                    off_peak_kwh=1.5,
                    night_kwh=0.5,
                ),
                DayUsage(
                    date=dt.date(2026, 6, 3),
                    import_kwh=4.0,
                    peak_kwh=1.0,
                    off_peak_kwh=2.0,
                    night_kwh=1.0,
                    estimated_count=2,
                ),
            ],
        ),
    )
    result = from_context("C-1", ctx, dt.date(2026, 5, 1), dt.date(2026, 6, 3))
    assert result.date_source == "mart"
    assert result.daily_dates == [dt.date(2026, 5, 31), dt.date(2026, 6, 2), dt.date(2026, 6, 3)]
    assert result.daily_peak_kwh == [None, 1.0, None]
    assert result.daily_quality == ["measured", "measured", "estimated"]
    assert result.band_data_source == "measured"
    assert result.total_kwh == 9.0
    assert result.estimated_cost_nzd == 3.6


def test_invalid_range_and_unknown_household_are_explicit(monkeypatch) -> None:
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    with TestClient(app) as client:
        params = {"start": "2026-07-04", "end": "2026-07-03"}
        assert (
            client.get(
                "/api/households/H-JUL/usage-series", params=params, headers=_headers()
            ).status_code
            == 422
        )
        assert (
            client.get(
                "/api/households/H-NOPE/usage-series",
                params={"start": "2026-07-01", "end": "2026-07-31"},
                headers=_headers("H-NOPE"),
            ).status_code
            == 404
        )


def test_usage_history_requires_matching_household_token(monkeypatch) -> None:
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    path = "/api/households/H-JUL/usage-series"
    params = {"start": "2026-07-01", "end": "2026-07-31"}
    with TestClient(app) as client:
        assert client.get(path, params=params).status_code == 401
        assert client.get(path, params=params, headers=_headers("H-COLD")).status_code == 403
        assert client.get(path, params=params, headers=_headers()).status_code == 200
