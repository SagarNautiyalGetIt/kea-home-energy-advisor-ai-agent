"""KEA-35 / KEA-36 — the evidence path.

What these tests can and cannot cover, stated plainly because it matters for how much
weight to put on a green run:

* **Covered here:** recorder selection, the `/health` disclosure, conversation-id
  plumbing through both chat paths, and — the important one —
  `test_database_recorder_survives_an_unreachable_database`, which is a real assertion
  about the failure policy rather than a mock. There is no PostgreSQL in CI, so calling
  `DatabaseRecorder.record()` genuinely fails to connect, and the test proves the answer
  still comes back.

* **Not covered here:** that the rows written are correct. That needs a live database
  and is verified by `make db && make api-migrate && make api-seed && KEA_PERSIST=1`.
  Nothing in this file should be read as evidence that the SQL is right.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_recorder, settings
from app.db.recorder import DatabaseRecorder, NullRecorder, TurnRecord, build_recorder
from app.main import app
from app.schemas import FactBundle, Intent, VerificationReport


@pytest.fixture(autouse=True)
def _reset_recorder_cache():
    get_recorder.cache_clear()
    yield
    get_recorder.cache_clear()


def _record(conversation_id: int | None = None) -> TurnRecord:
    return TurnRecord(
        customer_ref="H-JUL",
        conversation_id=conversation_id,
        question="Why is my bill so high?",
        answer="Your standing load is 7.1 kWh a day.",
        intent=Intent.WHY_HIGH,
        bundle=FactBundle(customer_id="H-JUL", intent=Intent.WHY_HIGH, period="July 2026"),
        report=VerificationReport(passed=True),
        escalate=False,
    )


def test_build_recorder_honours_the_flag() -> None:
    assert isinstance(build_recorder(persist=False), NullRecorder)
    assert isinstance(build_recorder(persist=True), DatabaseRecorder)


async def test_null_recorder_records_nothing_and_returns_no_conversation() -> None:
    assert await NullRecorder().record(_record()) is None


async def test_database_recorder_survives_an_unreachable_database() -> None:
    """The failure policy, tested for real rather than mocked.

    There is no PostgreSQL in CI, so this genuinely cannot connect. A customer asking
    why their bill is high must still get an answer when the evidence write fails —
    trading a working product for a metric is the wrong way round.
    """
    returned = await DatabaseRecorder().record(_record(conversation_id=41))
    assert returned == 41, "a failed write should hand back the caller's conversation id"


async def test_database_recorder_failure_returns_none_when_there_was_no_conversation() -> None:
    assert await DatabaseRecorder().record(_record(conversation_id=None)) is None


def test_health_discloses_which_recorder_is_live() -> None:
    """Rehearsing all afternoon and then finding the evidence tables empty is the
    failure this endpoint exists to prevent."""
    with TestClient(app) as client:
        body = client.get("/api/health").json()
    assert body["recording"] == "none", (
        "default is not to persist, so /health must say so rather than implying "
        "the run was recorded"
    )
    assert settings.persist is False


def test_chat_returns_a_null_conversation_id_when_not_persisting() -> None:
    with TestClient(app) as client:
        body = client.post(
            "/api/chat", json={"customer_id": "H-JUL", "message": "why is my bill so high"}
        ).json()
    assert body["conversation_id"] is None


def test_chat_accepts_a_conversation_id_without_persistence() -> None:
    """The field is optional and inert when persistence is off. The frontend should not
    need to know which mode the backend is in."""
    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={
                "customer_id": "H-JUL",
                "message": "why is my bill so high",
                "conversation_id": 7,
            },
        )
    assert response.status_code == 200
    assert response.json()["conversation_id"] is None


def test_stream_done_event_carries_the_conversation_id_field() -> None:
    """The UI reads `conversation_id` off the `done` event to thread the next question.

    Asserting the key exists even when null keeps the contract stable across the
    persistence flag — the frontend reads the same shape either way.
    """
    import json

    with TestClient(app) as client, client.stream(
        "POST", "/api/chat/stream", json={"customer_id": "H-JUL", "message": "why so high"}
    ) as response:
        assert response.status_code == 200
        payload = "".join(response.iter_text())

    done = [ln for ln in payload.splitlines() if ln.startswith("data: ") and "passed" in ln]
    assert done, f"no done event in stream: {payload[:300]}"
    assert "conversation_id" in json.loads(done[-1].removeprefix("data: "))
