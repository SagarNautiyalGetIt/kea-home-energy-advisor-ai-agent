"""Exercise deployed HTTP boundaries without cloud credentials or paid providers."""

from dataclasses import asdict
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.config import settings
from app.main import app


@pytest.fixture
def scoped_production(monkeypatch):
    config = SimpleNamespace(**asdict(settings))
    config.production = True
    config.persist = False
    config.demo_logins = False
    config.outage_ingestion_secret = "local-outage-fixture-" * 3
    config.reward_receipt_secret = "local-reward-fixture-" * 3
    config.delivery_receipt_secret = "local-delivery-fixture-" * 3
    for module in ("app.main", "app.security", "app.api.experience", "app.experience"):
        monkeypatch.setattr(module + ".settings", config)

    def verified_identity(header):
        if header != "Bearer local-verified-fixture":
            raise HTTPException(401, "Sign in to continue.")
        return {"customer_id": "household-a"}

    monkeypatch.setattr("app.security.identity", verified_identity)
    return {"Authorization": "Bearer local-verified-fixture"}


async def test_customer_routes_require_authentication_and_household_scope(scoped_production):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        route = "/api/households/household-a/scheduled-outages"
        assert (await client.get(route)).status_code == 401
        response = await client.get(route, headers=scoped_production)
        assert response.status_code == 200
        assert response.json()["status"] == "not_linked"
        response = await client.get(
            "/api/households/household-b/scheduled-outages", headers=scoped_production
        )
        assert response.status_code == 403
        for path in ("/api/households", "/api/auth/demo-accounts", "/api/vapi/anything"):
            assert (await client.get(path, headers=scoped_production)).status_code == 403


async def test_chat_body_and_integration_receipts_cannot_bypass_scope(scoped_production):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        for path in ("/api/chat", "/api/chat/stream"):
            response = await client.post(
                path,
                json={"customer_id": "household-b", "question": "Hello"},
                headers=scoped_production,
            )
            assert response.status_code == 403
            assert (await client.post(path, json=[], headers=scoped_production)).status_code == 400
        response = await client.post("/api/internal/clash/receipts", json={})
        assert response.status_code == 401
        assert (await client.get("/api/auth/config")).status_code == 200
