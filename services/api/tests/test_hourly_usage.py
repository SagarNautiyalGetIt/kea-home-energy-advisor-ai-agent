"""Hourly data preserves provenance, gaps, register scope and DST instants."""

import datetime as dt
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.analytics.hourly_usage import day_bounds, hourly_slots
from app.api import routes
from app.main import app


@pytest.mark.parametrize(
    ("day", "count"),
    [(dt.date(2026, 9, 27), 23), (dt.date(2026, 4, 5), 25), (dt.date(2026, 10, 3), 24)],
)
def test_hours_use_utc_instants_and_actual_nz_day_length(day, count):
    start, end = day_bounds(day)
    reads = [
        (1, start + dt.timedelta(minutes=30 * i), 0.5, "actual")
        for i in range(int((end - start).total_seconds() / 1800))
    ]
    result = hourly_slots(day, reads, {1})
    assert len(result) == count
    assert all(hour.kwh == 1 and hour.quality == "measured" for hour in result)
    assert len({hour.start for hour in result}) == count
    if count == 25:
        assert {hour.label for hour in result if hour.label.startswith("02:")} == {
            "02:00 NZST",
            "02:00 NZDT",
        }


def test_all_import_registers_needed_for_hour_and_estimated_reads_labelled():
    day = dt.date(2026, 10, 3)
    start, _ = day_bounds(day)
    reads = [
        (r, start + dt.timedelta(minutes=i * 30), 0.25, "estimated" if r == 2 else "actual")
        for r in (1, 2)
        for i in (0, 1)
    ]
    # Another household/register and yesterday's row must not fill missing coverage.
    reads += [(9, start, 99, "actual"), (1, start - dt.timedelta(minutes=30), 99, "actual")]
    result = hourly_slots(day, reads, {1, 2})
    assert result[0].kwh == 1 and result[0].quality == "estimated"
    assert result[1].kwh is None and result[1].expected_intervals == 4
    reads.pop(1)
    assert hourly_slots(day, reads, {1, 2})[0].kwh is None


@pytest.mark.parametrize("bad", [-1, float("nan"), float("inf")])
def test_invalid_read_does_not_become_complete_or_zero(bad):
    day = dt.date(2026, 10, 3)
    start, _ = day_bounds(day)
    rows = [(1, start, bad, "actual"), (1, start + dt.timedelta(minutes=30), 0, "actual")]
    assert hourly_slots(day, rows, {1})[0].kwh is None


def test_duplicate_read_marks_hour_missing_and_zero_is_real():
    day = dt.date(2026, 10, 3)
    start, _ = day_bounds(day)
    rows = [(1, start, 0, "actual"), (1, start + dt.timedelta(minutes=30), 0, "actual")]
    assert hourly_slots(day, rows, {1})[0].kwh == 0
    assert hourly_slots(day, rows + [rows[0]], {1})[0].kwh is None
    assert hourly_slots(day, rows, {1}, demo=True)[0].quality == "demo"
    validated = [(r, at, kwh, "validated") for r, at, kwh, _ in rows]
    assert hourly_slots(day, validated, {1})[0].quality == "measured"


def test_hourly_route_requires_own_household_and_returns_missing_fixture_hours(monkeypatch):
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    path = "/api/households/H-JUL/hourly-usage?day=2026-07-03"
    with TestClient(app) as client:
        assert client.get(path).status_code == 401
        assert (
            client.get(
                path, headers={"Authorization": f"Bearer {auth.issue_demo_token('H-JUN')}"}
            ).status_code
            == 403
        )
        response = client.get(
            path, headers={"Authorization": f"Bearer {auth.issue_demo_token('H-JUL')}"}
        )
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "unavailable"
    assert len(data["hours"]) == 24
    assert all(hour["kwh"] is None for hour in data["hours"])
