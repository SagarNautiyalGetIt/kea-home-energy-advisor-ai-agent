"""AWS client mutations must be authenticated, durable and truthful about external actions."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import auth, security
from app.account import client_state
from app.api import account_actions
from app.config import get_change_store
from app.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(security, "settings", replace(security.settings, demo_logins=True))
    monkeypatch.setattr(
        account_actions, "settings", replace(account_actions.settings, persist=False)
    )
    client_state._memory.clear()
    get_change_store.cache_clear()
    yield TestClient(app)
    client_state._memory.clear()
    get_change_store.cache_clear()


def headers(account="H-JUL"):
    return {"Authorization": "Bearer " + auth.issue_demo_token(account)}


@pytest.mark.asyncio
async def test_late_push_response_cannot_restore_old_account():
    await client_state.put("__devices__", "push:test", {"account": "H-COLD", "enabled": True})
    assert not await client_state.claim_period("__devices__", "push:test", "2026-08", "H-JUL")
    assert not await client_state.update_device("push:test", "H-JUL", {"status": "accepted"})
    assert not await client_state.update_device("push:test", "H-JUL", None)
    assert (await client_state.get("__devices__", "push:test"))["account"] == "H-COLD"


@pytest.mark.parametrize(
    "path,body",
    [
        (
            "/api/assistant/feedback",
            {"customer_id": "H-COLD", "message_id": "2", "feedback": "like"},
        ),
        (
            "/api/households/H-COLD/plan-change-requests",
            {"customer_id": "H-COLD", "pricing_style": "anytime", "commitment_term": "flexible"},
        ),
        (
            "/api/households/H-COLD/payments",
            {"customer_id": "H-COLD", "invoice_id": "x", "payment_method_id": "x"},
        ),
        ("/api/households/H-COLD/push-tokens", {"token": "ExpoPushToken[test]"}),
    ],
)
def test_write_scope_cannot_switch_accounts(client, path, body):
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, json=body, headers=headers()).status_code == 403


def test_profile_edits_reappear_without_overwriting_supply_details(client):
    body = {"name": "Kea Test", "email": "test@kea.example", "phone": "+64211234567"}
    response = client.put("/api/households/H-JUL/profile", json=body, headers=headers())
    assert response.status_code == 200
    assert response.json()["name"] == body["name"]
    assert client.get("/api/households/H-JUL/profile").json()["phone"] == body["phone"]
    assert (
        client.put(
            "/api/households/H-JUL/profile",
            json={**body, "account_number": "OTHER"},
            headers=headers(),
        ).status_code
        == 422
    )


def test_feedback_and_plan_request_are_records_not_fulfilment(client):
    result = client.post(
        "/api/assistant/feedback",
        json={"customer_id": "H-JUL", "message_id": "2", "feedback": "like"},
        headers=headers(),
    )
    assert result.status_code == 201
    result = client.post(
        "/api/households/H-JUL/plan-change-requests",
        json={
            "customer_id": "H-JUL",
            "pricing_style": "time-of-use",
            "commitment_term": "6-months",
        },
        headers=headers(),
    )
    assert result.status_code == 201
    assert result.json()["status"] == "pending_review"
    assert client.get("/api/households/H-JUL/plans").json()["current_plan"]["pricing_style"] is None


def test_attachment_limits_and_private_reference(client):
    path = "/api/households/H-JUL/assistant/attachments"
    assert (
        client.post(
            path, files={"file": ("a.pdf", b"bad", "application/pdf")}, headers=headers()
        ).status_code
        == 415
    )
    assert (
        client.post(
            path,
            files={"file": ("a.pdf", b"%PDF-" + b"x" * 524288, "application/pdf")},
            headers=headers(),
        ).status_code
        == 413
    )
    response = client.post(
        path, files={"file": ("a.pdf", b"%PDF-test", "application/pdf")}, headers=headers()
    )
    assert response.status_code == 201
    assert set(response.json()) == {"attachment_id", "status", "analysis"}
    identifier = response.json()["attachment_id"]
    assert client.delete(path + "/" + identifier, headers=headers("H-COLD")).status_code == 403
    assert client.delete(path + "/" + identifier, headers=headers()).status_code == 204


def test_payments_do_not_claim_a_charge_or_collect_raw_cards(client):
    body = {"customer_id": "H-JUL", "invoice_id": "test", "payment_method_id": "test"}
    response = client.post("/api/households/H-JUL/payments", json=body, headers=headers())
    assert response.status_code == 501
    assert "No payment was taken" in response.json()["detail"]
    assert (
        client.post(
            "/api/households/H-JUL/payments",
            json={**body, "card_number": "4242"},
            headers=headers(),
        ).status_code
        == 422
    )


async def test_device_registration_reassignment_and_revocation(client):
    token = "ExpoPushToken[testdevice]"
    for account in ("H-JUL", "H-COLD"):
        assert (
            client.post(
                f"/api/households/{account}/push-tokens",
                json={"token": token},
                headers=headers(account),
            ).status_code
            == 200
        )
    rows = await client_state.records("push:", "__devices__")
    assert len(rows) == 1 and rows[0][2]["account"] == "H-COLD"
    client.post(
        "/api/households/H-JUL/push-tokens",
        json={"token": token, "enabled": False},
        headers=headers(),
    )
    assert len(await client_state.records("push:", "__devices__")) == 1
    client.post(
        "/api/households/H-COLD/push-tokens",
        json={"token": token, "enabled": False},
        headers=headers("H-COLD"),
    )
    assert not await client_state.records("push:", "__devices__")


async def test_evaluator_filter_and_limit_never_release_other_deliveries(monkeypatch):
    from app.jobs import evaluate_bill_shock as evaluator

    called = []

    async def one(account, summary):
        called.append(account)

    monkeypatch.setattr(evaluator, "evaluate_one", one)
    monkeypatch.setenv("KEA_ALERT_ACCOUNTS", "H-JUL,H-COLD,H-JUL")
    monkeypatch.setenv("KEA_ALERT_LIMIT", "1")
    await evaluator.run()
    assert called == ["H-JUL"]


def test_invoice_history_uses_actual_period_and_due_dates_and_excludes_future_payments():
    import datetime as dt

    from app.account.invoices import invoice_from_record

    row = {
        "invoice_number": "INV-JUN",
        "issue_date": dt.date(2026, 6, 30),
        "period_start": dt.date(2026, 6, 1),
        "period_end": dt.date(2026, 6, 30),
        "period_days": 30,
        "due_date": dt.date(2026, 7, 14),
        "total_charges": 115,
        "gst_amount": 15,
        "charges_excl_gst": 100,
        "available_to": dt.date(2026, 8, 17),
        "payments": [
            {"paid_on": "2026-07-01", "amount": 50},
            {"paid_on": "2026-09-01", "amount": 65},
        ],
    }
    invoice = invoice_from_record(row, dt.date(2026, 8, 17))
    assert invoice.amount_due == 65 and invoice.status == "Due"
    assert invoice.due == dt.date(2026, 7, 14) and "2026-06-01" in invoice.period


async def test_push_consent_acceptance_deduplication_and_invalid_device_cleanup(monkeypatch):
    from datetime import UTC, datetime, timedelta

    from app.alerts import push

    client_state._memory.clear()
    monkeypatch.setenv("KEA_EXPO_PUSH_ENABLED", "1")
    registration = {
        "token": "ExpoPushToken[test]",
        "enabled": True,
        "account": "H-JUL",
        "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
    }
    await client_state.put("__devices__", "push:test", registration)
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"data": {"status": "ok", "id": "ticket"}}

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            calls.append(kwargs["json"])
            return Response()

    monkeypatch.setattr(push.httpx, "AsyncClient", Client)
    assert await push.notify("H-JUL", "July", False) == 0 and not calls
    assert await push.notify("H-COLD", "July", True) == 0 and not calls
    assert await push.notify("H-JUL", "July", True) == 1
    assert calls[0]["data"]["screen"] == "dashboard" and "kWh" not in calls[0]["body"]
    assert await push.notify("H-JUL", "July", True) == 0
    monkeypatch.setattr(
        Response,
        "json",
        lambda self: {"data": {"status": "error", "details": {"error": "DeviceNotRegistered"}}},
    )
    await push.notify("H-JUL", "August", True)
    assert not await client_state.records("push:", "__devices__")


def test_aws_attachments_require_private_bucket_and_encryption(client, monkeypatch):
    monkeypatch.setattr(
        account_actions, "settings", replace(account_actions.settings, persist=True)
    )
    monkeypatch.setenv("KEA_ATTACHMENT_BUCKET", "kea-private-test")
    from app.alerts import aws_channels

    requests = []

    class S3:
        def get_public_access_block(self, **kwargs):
            return {
                "PublicAccessBlockConfiguration": dict.fromkeys(
                    [
                        "BlockPublicAcls",
                        "IgnorePublicAcls",
                        "BlockPublicPolicy",
                        "RestrictPublicBuckets",
                    ],
                    True,
                )
            }

        def put_object(self, **kwargs):
            requests.append(kwargs)

    monkeypatch.setattr(aws_channels, "aws_client", lambda *args: S3())
    response = client.post(
        "/api/households/H-JUL/assistant/attachments",
        files={"file": ("test.pdf", b"%PDF-test", "application/pdf")},
        headers=headers(),
    )
    assert response.status_code == 201
    assert requests[0]["ServerSideEncryption"] == "AES256" and "ACL" not in requests[0]
    assert "kea-private-test" not in response.text and "http" not in response.text
