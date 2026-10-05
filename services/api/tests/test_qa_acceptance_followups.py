"""Observed #349 failures: account availability and misread peak-day tables."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.agent.tools import get_daily_usage
from app.analytics.repository import FixtureRepository
from app.api import routes
from app.main import app
from app.pipeline import build_context


@pytest.mark.parametrize(
    ("customer_id", "day", "kwh"),
    [("H-JUL", "2026-07-11", 17.6), ("H-COLD", "2026-07-05", 15.2)],
)
async def test_highest_day_is_computed_for_each_household(customer_id, day, kwh):
    result = get_daily_usage(await build_context(customer_id))
    assert result["totals"]["highest_import_dates"] == [day]
    assert result["totals"]["highest_import_kwh"] == pytest.approx(kwh)


async def test_highest_day_honours_requested_range_and_ties():
    context = await build_context("H-COLD")
    result = get_daily_usage(context, start_date="2026-07-06", end_date="2026-07-08")
    assert result["totals"]["highest_import_dates"] == ["2026-07-06"]
    # Missing calendar days must not shift the date, and all equal maxima survive.
    first = context.account.days[0]
    context.account = replace(context.account, days=[
        replace(first, date=dt.date(2026, 7, 1), import_kwh=12),
        replace(first, date=dt.date(2026, 7, 3), import_kwh=12),
    ])
    result = get_daily_usage(context)
    assert result["totals"]["highest_import_dates"] == ["2026-07-01", "2026-07-03"]
    assert result["totals"]["highest_import_kwh"] == 12


def test_picker_omits_unloaded_accounts_and_login_does_not_issue_token(monkeypatch):
    class PartialRepository(FixtureRepository):
        async def context(self, customer_id):
            if customer_id == "H-ZARA":
                raise KeyError(customer_id)
            return await super().context(customer_id)

    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=True))
    monkeypatch.setattr(routes, "get_repository", PartialRepository)
    issued = []
    monkeypatch.setattr(auth, "issue_demo_token", lambda customer: issued.append(customer))
    client = TestClient(app)
    cards = client.get("/api/auth/demo-accounts").json()
    ids = {card["customer_id"] for card in cards}
    assert "H-COLD" in ids
    assert "H-ZARA" not in ids
    assert "DEMO-ACCT-221001" not in ids
    response = client.post(
        "/api/auth/login", json={"email": "zara@kea.example", "password": "steady24"}
    )
    assert response.status_code == 503
    assert "no loaded data" in response.json()["detail"]
    assert issued == []


def test_generated_login_is_explicit_and_still_requires_loaded_data(monkeypatch):
    account = auth.GENERATED_DEMO_ACCOUNT
    assert auth.authenticate(account.email, account.password) is None
    assert auth.authenticate(account.email, account.password, include_generated=True) == account
    monkeypatch.setattr(routes, "settings", replace(
        routes.settings, demo_logins=True, generated_demo_login=True, persist=True
    ))
    monkeypatch.setattr(routes, "get_repository", FixtureRepository)
    client = TestClient(app)
    cards = client.get("/api/auth/demo-accounts").json()
    assert account.email not in {card["email"] for card in cards}
    assert client.post(
        "/api/auth/login", json={"email": account.email, "password": account.password}
    ).status_code == 503

    class LoadedRepository(FixtureRepository):
        async def context(self, customer_id):
            ref = "H-JUL" if customer_id == account.customer_id else customer_id
            return await super().context(ref)

    monkeypatch.setattr(routes, "get_repository", LoadedRepository)
    assert account.email in {card["email"] for card in client.get("/api/auth/demo-accounts").json()}
    response = client.post(
        "/api/auth/login", json={"email": account.email, "password": account.password}
    )
    assert response.status_code == 200
    assert response.json()["customer_id"] == account.customer_id
    assert auth.demo_token_customer(response.json()["access_token"]) == account.customer_id

    monkeypatch.setattr(routes, "settings", replace(routes.settings, persist=False))
    assert client.post(
        "/api/auth/login", json={"email": account.email, "password": account.password}
    ).status_code == 401


def test_demo_endpoints_remain_off_by_default(monkeypatch):
    monkeypatch.setattr(routes, "settings", replace(routes.settings, demo_logins=False))
    client = TestClient(app)
    assert client.get("/api/auth/demo-accounts").status_code == 503
    assert client.post(
        "/api/auth/login", json={"email": "july@kea.example", "password": "julyhouse24"}
    ).status_code == 503
