"""The device and EV paths must remain household scoped and evidence bounded."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.analytics.account import DayUsage
from app.analytics.repository import FixtureRepository
from app.api import routes
from app.clarify.night import sustained_night_rise
from app.clarify.store import MemoryContextStore
from app.homelink.store import MemoryObservationStore
from app.main import app


@pytest.fixture
def client(monkeypatch):
    store = MemoryObservationStore()
    context_store = MemoryContextStore()
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    monkeypatch.setattr(routes, "get_repository", FixtureRepository)
    monkeypatch.setattr(routes, "get_observation_store", lambda: store)
    monkeypatch.setattr(routes, "get_context_store", lambda: context_store)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def _observation(day: dt.date, kwh: float = 3.5) -> dict[str, object]:
    return {
        "device_id": "sensor.ev_energy",
        "provider": "home_assistant",
        "device_class": "ev_charger",
        "label": "Garage charger",
        "day": day.isoformat(),
        "energy_kwh": kwh,
        "confidence": "measured",
        "always_on": False,
    }


def test_demo_token_scopes_device_sync_and_dated_home_readings(client):
    nz_yesterday = dt.datetime.now(ZoneInfo("Pacific/Auckland")).date() - dt.timedelta(days=1)
    login = client.post(
        "/api/auth/login", json={"email": "july@kea.example", "password": "julyhouse24"}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/session", headers=headers).json() == {"customer_id": "H-JUL"}

    path = "/api/households/H-JUL/device-observations"
    payload = {"timezone": "Pacific/Auckland", "observations": [_observation(nz_yesterday)]}
    assert client.post(path, json=payload).status_code == 401
    assert (
        client.post(
            "/api/households/H-COLD/device-observations", headers=headers, json=payload
        ).status_code
        == 403
    )
    assert (
        client.post(path, headers=headers, json={**payload, "timezone": "Invalid/Zone"}).status_code
        == 422
    )
    assert client.post(path, headers=headers, json=payload).json() == {"saved": 1}

    payload["observations"] = [_observation(nz_yesterday, 4.2)]
    assert client.post(path, headers=headers, json=payload).json() == {"saved": 1}
    appliances = client.get("/api/households/H-JUL/appliances", headers=headers)
    assert appliances.status_code == 200
    assert len(appliances.json()["devices"]) == 1
    assert appliances.json()["devices"][0]["total_kwh"] == 4.2
    assert appliances.json()["devices"][0]["confidence"] == "measured"

    home = client.get("/api/households/H-JUL/home-energy", headers=headers)
    assert home.status_code == 200
    assert home.json()["date_source"] == "demo"
    assert home.json()["device_day"] == nz_yesterday.isoformat()
    assert home.json()["device_observations"][0]["energy_kwh"] == 4.2
    assert home.json()["live_power_available"] is False
    assert client.get("/api/households/H-COLD/appliances", headers=headers).status_code == 403


def test_device_sync_rejects_unmeasured_or_incomplete_day(client):
    token = auth.issue_demo_token("H-JUL")
    path = "/api/households/H-JUL/device-observations"
    headers = {"Authorization": f"Bearer {token}"}
    today = dt.datetime.now(ZoneInfo("Pacific/Auckland")).date()
    for observation in [
        _observation(today),
        {**_observation(today - dt.timedelta(days=1)), "confidence": "rated"},
        {**_observation(today - dt.timedelta(days=1)), "energy_kwh": None, "rated_watts": 700},
    ]:
        response = client.post(
            path,
            headers=headers,
            json={"timezone": "Pacific/Auckland", "observations": [observation]},
        )
        assert response.status_code == 422


def test_ev_answer_is_typed_and_scoped_to_the_signed_in_household(client):
    headers = {"Authorization": f"Bearer {auth.issue_demo_token('H-JUL')}"}
    path = "/api/households/H-JUL/context/ev"
    assert client.put(path, json={"has_ev": True}).status_code == 401
    assert (
        client.put("/api/households/H-COLD/context/ev", headers=headers, json={"has_ev": True})
        .status_code
        == 403
    )
    assert client.put(path, headers=headers, json={"has_ev": "maybe"}).status_code == 422
    saved = client.put(path, headers=headers, json={"has_ev": False})
    assert saved.status_code == 200
    assert saved.json()["has_ev"] is False
    assert "night_load_pattern:ev_charging" in saved.json()["asked"]
    assert client.get("/api/households/H-JUL/context").json()["has_ev"] is False
    assert client.get("/api/households/H-COLD/context").json()["has_ev"] is None


def test_fixture_daily_totals_do_not_fabricate_time_band_usage(client):
    summary = client.get("/api/households/H-JUL")
    assert summary.status_code == 200
    body = summary.json()
    assert body["band_data_source"] is None
    assert all(value is None for value in body["daily_peak_kwh"])
    assert all(value is None for value in body["daily_off_peak_kwh"])
    assert all(value is None for value in body["daily_night_kwh"])


def test_ev_prompt_detector_needs_sustained_contiguous_night_readings():
    first = dt.date(2026, 7, 1)
    days = [
        DayUsage(date=first + dt.timedelta(days=i), import_kwh=12, night_kwh=2 if i < 7 else 4.5)
        for i in range(12)
    ]
    assert sustained_night_rise(days) == 2.5
    assert (
        sustained_night_rise(
            [
                *days[:7],
                replace(days[7], night_kwh=4.5),
                *[replace(day, night_kwh=2) for day in days[8:]],
            ]
        )
        is None
    )
    assert (
        sustained_night_rise([*days[:11], replace(days[11], date=first + dt.timedelta(days=13))])
        is None
    )
    assert sustained_night_rise([*days[:11], replace(days[11], night_kwh=None)]) is None
