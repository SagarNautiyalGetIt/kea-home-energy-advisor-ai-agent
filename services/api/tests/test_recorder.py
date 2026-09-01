"""KEA-35 / KEA-36 — the evidence path.

What these tests can and cannot cover, stated plainly because it matters for how much
weight to put on a green run:

* **Covered here:** recorder selection, the `/health` disclosure, conversation-id
  plumbing through both chat paths, and — the important one —
  `test_database_recorder_survives_an_unreachable_database`, which is a real assertion
  about the failure policy. It forces the failure by pointing the recorder at an
  unroutable host rather than by assuming there is no PostgreSQL — that assumption held
  in CI and quietly broke the moment anyone ran the suite with `make db` up, and worse,
  it made the tests pass for a year while `DatabaseRecorder` had a missing method and
  could never have written a row at all.

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


@pytest.fixture
def _unreachable_database(monkeypatch: pytest.MonkeyPatch):
    """Point the recorder at a port nothing is listening on.

    Deterministic whether or not the developer has `make db` running. The previous
    version of these two tests relied on CI having no PostgreSQL, which meant they
    asserted nothing at all on a machine that did — and they were passing for the wrong
    reason regardless, because `DatabaseRecorder._citation` did not exist and every
    write raised before it reached the database.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    import app.db.recorder as recorder_module

    engine = create_async_engine(
        "postgresql+asyncpg://nobody:nobody@127.0.0.1:1/nothing",
        connect_args={"timeout": 1},
    )
    monkeypatch.setattr(
        recorder_module, "get_sessionmaker", lambda: async_sessionmaker(engine)
    )
    yield


async def test_database_recorder_survives_an_unreachable_database(
    _unreachable_database,
) -> None:
    """The failure policy. A customer asking why their bill is high must still get an
    answer when the evidence write fails — trading a working product for a metric is
    the wrong way round."""
    returned = await DatabaseRecorder().record(_record(conversation_id=41))
    assert returned == 41, "a failed write should hand back the caller's conversation id"


async def test_database_recorder_failure_returns_none_when_there_was_no_conversation(
    _unreachable_database,
) -> None:
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


# ── the mart accounts had no evidence at all ────────────────────────────────


async def _has_database() -> bool:
    try:
        from sqlalchemy import text
        from sqlalchemy.ext.asyncio import create_async_engine

        from app.config import settings

        engine = create_async_engine(settings.database_url)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        finally:
            await engine.dispose()
        return True
    except Exception:
        return False


@pytest.fixture
async def _fresh_engine():
    """Dispose the engine around every test that touches PostgreSQL.

    `get_sessionmaker()` is lru_cached, so the engine and its connection pool are built
    on whichever event loop happened to run first. pytest-asyncio gives each test a new
    loop, so the second database test in a file picks a pooled asyncpg connection bound
    to a loop that is already closed and fails with "attached to a different loop" —
    while passing in isolation, which is what makes it so easy to dismiss.
    """
    from app.db.session import dispose_engine

    await dispose_engine()
    yield
    await dispose_engine()


async def _purge(ref: str) -> None:
    """Remove an account and everything hanging off it, child-first.

    The design file documents ON DELETE CASCADE on the spine, but the live schema does
    not have it — 0001 created the FKs without it and 0003 only moved the tables with
    SET SCHEMA, which preserves them as they were. So the order here is load-bearing.
    """
    from sqlalchemy import delete, select

    from app.db.models import (
        Conversation,
        Customer,
        Escalation,
        FactBundleRow,
        TokenUsageRow,
        Turn,
        VerificationRow,
    )
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as s:
        ids = (
            await s.execute(select(Customer.id).where(Customer.external_ref == ref))
        ).scalars().all()
        if not ids:
            return
        convs = (
            await s.execute(select(Conversation.id).where(Conversation.customer_id.in_(ids)))
        ).scalars().all()
        if convs:
            turns = (
                await s.execute(select(Turn.id).where(Turn.conversation_id.in_(convs)))
            ).scalars().all()
            if turns:
                for model in (FactBundleRow, VerificationRow, TokenUsageRow):
                    await s.execute(delete(model).where(model.turn_id.in_(turns)))
                await s.execute(delete(Escalation).where(Escalation.turn_id.in_(turns)))
            await s.execute(delete(Escalation).where(Escalation.conversation_id.in_(convs)))
            await s.execute(delete(Turn).where(Turn.conversation_id.in_(convs)))
            await s.execute(delete(Conversation).where(Conversation.id.in_(convs)))
        await s.execute(delete(Customer).where(Customer.id.in_(ids)))
        await s.commit()


async def test_an_account_with_no_seeded_row_is_still_recorded(_fresh_engine) -> None:
    """The bug this pins: 9 of the 14 logins recorded nothing.

    `make api-seed` only creates `public.customer` rows for the five demo households.
    The nine ELT accounts live in `kea.*`, so the recorder's lookup missed, and it
    returned None — their turns were answered, verified, and then dropped. That matters
    beyond tidiness: "N answers, 0 fabricated figures" is counted from `app.verification`,
    so the headline claim was missing two thirds of its evidence and nothing said so.
    """
    if not await _has_database():
        pytest.skip("no PostgreSQL on KEA_DATABASE_URL")

    from sqlalchemy import select

    from app.db.models import Customer
    from app.db.session import get_sessionmaker

    ref = "TEST-NO-SEEDED-ROW"
    sessionmaker = get_sessionmaker()

    await _purge(ref)
    try:
        returned = await DatabaseRecorder().record(_record(conversation_id=None))
        assert returned is None or isinstance(returned, int)

        rec = _record(conversation_id=None)
        rec.customer_ref = ref
        conversation_id = await DatabaseRecorder().record(rec)
        assert conversation_id is not None, "the turn was dropped instead of recorded"

        async with sessionmaker() as s:
            anchor = (
                await s.execute(select(Customer).where(Customer.external_ref == ref))
            ).scalar_one()
            assert anchor.region == DatabaseRecorder.ANCHOR_REGION, (
                "the anchor must be marked, or /api/households cannot filter it out"
            )
    finally:
        await _purge(ref)


async def test_recording_the_same_account_twice_reuses_one_anchor(_fresh_engine) -> None:
    """Two turns must not create two anchors. The insert uses ON CONFLICT rather than
    catching IntegrityError, because in PostgreSQL a statement that raises aborts the
    whole transaction — a caught error would poison the session and lose the very turn
    it was trying to save."""
    if not await _has_database():
        pytest.skip("no PostgreSQL on KEA_DATABASE_URL")

    from sqlalchemy import func, select

    from app.db.models import Customer
    from app.db.session import get_sessionmaker

    ref = "TEST-ANCHOR-ONCE"
    sessionmaker = get_sessionmaker()

    await _purge(ref)
    try:
        for _ in range(2):
            rec = _record(conversation_id=None)
            rec.customer_ref = ref
            assert await DatabaseRecorder().record(rec) is not None

        async with sessionmaker() as s:
            n = (
                await s.execute(
                    select(func.count()).select_from(Customer).where(Customer.external_ref == ref)
                )
            ).scalar_one()
        assert n == 1, f"expected one anchor, got {n}"
    finally:
        await _purge(ref)
