"""Tiered alerting — policy, rendering, and the file-backed sender.

Everything here runs without a database, a mail server or a model, which is the point
of keeping `policy` and `render` pure. The database-level guarantee — that polling the
endpoint does not re-send — is a unique constraint and is asserted in
`test_alert_is_idempotent_per_cycle_and_tier` against real PostgreSQL when it is
available.
"""

from __future__ import annotations

import email
import email.policy
from pathlib import Path

import pytest

from app.alerts import decide, tier_for
from app.alerts.email import FileSender, build_sender
from app.alerts.policy import TIER_3_NZD, TIER_CHANNELS
from app.alerts.render import BASIS, EARLY_CYCLE_HEDGE, body_for, subject_for
from app.analytics.engine import BillShockAssessment


def _assessment(
    *,
    overshoot_nzd: float,
    overshoot_pct: float,
    triggered: bool = True,
    days_elapsed: int = 15,
    reasons: list[str] | None = None,
    trend: float = 0.0,
) -> BillShockAssessment:
    return BillShockAssessment(
        days_elapsed=days_elapsed,
        days_in_cycle=31,
        usage_so_far_kwh=180.0,
        cost_so_far_nzd=54.0,
        projected_cost_nzd=200.0 + overshoot_nzd,
        expected_cost_nzd=200.0,
        overshoot_nzd=overshoot_nzd,
        overshoot_pct=overshoot_pct,
        recent_trend_pct=trend,
        triggered=triggered,
        reasons=(
            reasons if reasons is not None
            else (["above_comparable_homes"] if triggered else [])
        ),
    )


# ── the ladder ──────────────────────────────────────────────────────────────


def test_an_untriggered_assessment_is_tier_zero() -> None:
    """Nothing escalates off an assessment that did not fire. The tier ladder is how
    loudly to say it, never whether there is anything to say."""
    assert tier_for(_assessment(overshoot_nzd=200.0, overshoot_pct=99.0, triggered=False)) == 0


@pytest.mark.parametrize(
    ("overshoot_nzd", "overshoot_pct", "expected"),
    [
        (25.0, 16.0, 1),
        (59.9, 39.9, 1),  # just under both tier-2 gates
        (60.0, 20.0, 2),  # dollars alone
        (25.0, 40.0, 2),  # percent alone
        (119.0, 50.0, 2),
        (120.0, 20.0, 3),  # dollars alone
        (30.0, 75.0, 3),  # percent alone — the low-user case
    ],
)
def test_tier_takes_dollars_or_percent(
    overshoot_nzd: float, overshoot_pct: float, expected: int
) -> None:
    """Either gate is enough, unlike the trigger itself which needs both.

    The percent-only row is the one that matters: a low-user household 75% over is a
    real emergency for that household even when the dollar figure is modest, and low
    fixed charge customers are exactly the shape this product is aimed at.
    """
    assessment = _assessment(overshoot_nzd=overshoot_nzd, overshoot_pct=overshoot_pct)
    assert tier_for(assessment) == expected


def test_a_rising_trend_alone_does_not_raise_the_tier() -> None:
    """"Getting worse" is not "already expensive". Phoning someone on day 7 because
    their curve turned upward is how a prevention agent teaches people to ignore it."""
    modest_but_climbing = _assessment(
        overshoot_nzd=22.0,
        overshoot_pct=16.0,
        reasons=["above_comparable_homes", "rising_within_cycle"],
        trend=90.0,
    )
    assert tier_for(modest_but_climbing) == 1


def test_escalating_tiers_stack_rather_than_replace() -> None:
    """A tier-3 customer gets the call *and* the email. A failed call leaves no record;
    the written one is what the Consumer Care Obligations expect us to produce."""
    decision = decide(_assessment(overshoot_nzd=TIER_3_NZD, overshoot_pct=80.0))
    assert decision.tier == 3
    assert decision.channels == ("email", "sms", "voice")


def test_only_tier_one_has_a_gateway_behind_it() -> None:
    decision = decide(_assessment(overshoot_nzd=TIER_3_NZD, overshoot_pct=80.0))
    assert decision.deliverable_channels() == ("email",)


def test_hardship_suppresses_the_alert_but_still_records_the_tier() -> None:
    """An automated "you are about to spend $340" at someone who has just said they
    cannot pay is at best useless. The tier is still computed, so the fact that we knew
    and chose not to send is on the record rather than absent from it."""
    decision = decide(
        _assessment(overshoot_nzd=TIER_3_NZD, overshoot_pct=80.0), hardship_detected=True
    )
    assert decision.tier == 3
    assert decision.suppressed is True
    assert decision.should_send is False
    assert "person" in (decision.suppressed_because or "")


def test_every_tier_maps_to_a_channel() -> None:
    """A tier with no channel would compute, record, and silently never send."""
    assert set(TIER_CHANNELS) == {1, 2, 3}


# ── the message ─────────────────────────────────────────────────────────────


def test_the_basis_line_is_on_every_message() -> None:
    """The regression this repo has already had once, on the invoice PDF: an artefact
    leaving the app carrying real-looking dollar figures with no disclaimer."""
    body = body_for(
        _assessment(overshoot_nzd=30.0, overshoot_pct=18.0),
        decide(_assessment(overshoot_nzd=30.0, overshoot_pct=18.0)),
    )
    assert BASIS in body


def test_the_message_never_claims_a_comparison_with_past_bills() -> None:
    """There is no billing history behind this. "More than similar homes" is supported;
    "more than you usually pay" is not, and would be exactly the fabrication the product
    exists to prevent."""
    assessment = _assessment(overshoot_nzd=90.0, overshoot_pct=45.0)
    body = body_for(assessment, decide(assessment)).lower()

    for forbidden in ("than you usually", "your usual", "than last month", "more than normal"):
        assert forbidden not in body, forbidden
    assert "comparable home" in body


def test_early_cycle_warnings_are_hedged_not_suppressed() -> None:
    early = _assessment(overshoot_nzd=90.0, overshoot_pct=45.0, days_elapsed=6)
    assert EARLY_CYCLE_HEDGE in body_for(early, decide(early))

    settled = _assessment(overshoot_nzd=90.0, overshoot_pct=45.0, days_elapsed=20)
    assert EARLY_CYCLE_HEDGE not in body_for(settled, decide(settled))


def test_tier_one_subject_does_not_shout() -> None:
    """A subject that alarms someone whose bill is $22 over teaches them to ignore the
    one that matters. Escalation is the tier ladder's job, not the subject line's."""
    subject = subject_for(_assessment(overshoot_nzd=22.0, overshoot_pct=16.0), tier=1)
    assert "$" not in subject
    assert subject.isupper() is False


def test_tier_three_body_says_a_person_is_coming() -> None:
    assessment = _assessment(overshoot_nzd=TIER_3_NZD, overshoot_pct=80.0)
    body = body_for(assessment, decide(assessment))
    assert "reach you" in body


def test_the_trend_sentence_only_appears_when_the_trend_triggered() -> None:
    """A bundle carrying a fact the message has no reason to mention is an invitation to
    mention it."""
    flat = _assessment(overshoot_nzd=90.0, overshoot_pct=45.0, trend=3.0)
    assert "risen" not in body_for(flat, decide(flat))

    climbing = _assessment(
        overshoot_nzd=90.0,
        overshoot_pct=45.0,
        reasons=["above_comparable_homes", "rising_within_cycle"],
        trend=31.0,
    )
    assert "risen 31%" in body_for(climbing, decide(climbing))


# ── delivery ────────────────────────────────────────────────────────────────


def test_file_sender_writes_a_parseable_message(tmp_path: Path) -> None:
    """Not a mock — the bytes have to be a real message, or "here is the email" during
    the demo is a claim about a text file."""
    sender = FileSender(outbox=tmp_path, sender="Kea <no-reply@kea.example>")
    outcome = sender.send(to="someone@example.com", subject="Heads up", body="Body text")

    assert outcome.delivered is True
    written = list(tmp_path.glob("*.eml"))
    assert len(written) == 1

    parsed = email.message_from_bytes(written[0].read_bytes(), policy=email.policy.default)
    assert parsed["To"] == "someone@example.com"
    assert parsed["Subject"] == "Heads up"
    assert "Body text" in parsed.get_content()


def test_file_sender_keeps_the_address_inside_the_outbox(tmp_path: Path) -> None:
    """The address reaches a filename. One line of sanitising, and the failure it
    prevents is writing outside the outbox entirely."""
    sender = FileSender(outbox=tmp_path, sender="Kea <no-reply@kea.example>")
    outcome = sender.send(to="../../etc/passwd", subject="x", body="y")

    assert outcome.delivered is True
    assert list(tmp_path.glob("*.eml")), "nothing landed in the outbox"
    assert not (tmp_path.parent.parent / "etc").exists()


def test_an_unwritable_outbox_is_reported_not_raised(tmp_path: Path) -> None:
    """Dispatch failures are recorded on the alert row; they never take down the
    warning the customer can see on screen."""
    blocked = tmp_path / "afile"
    blocked.write_text("not a directory")

    outcome = FileSender(outbox=blocked / "outbox", sender="k@example.com").send(
        to="a@example.com", subject="s", body="b"
    )
    assert outcome.delivered is False
    assert "outbox" in (outcome.detail or "")


def test_smtp_backend_refuses_to_start_without_a_credential(tmp_path: Path) -> None:
    """Loud at construction rather than a silent no-op at send time. A mail path that
    quietly degrades to "no mail" is the failure this module exists to make visible."""
    with pytest.raises(RuntimeError, match="KEA_SMTP_PASSWORD"):
        build_sender(
            backend="smtp",
            outbox=tmp_path,
            sender="k@example.com",
            host="smtp.example.com",
            username="k",
            password="",
        )


def test_an_unknown_backend_falls_back_to_file(tmp_path: Path) -> None:
    """A typo in an env var should not take the API down — but it must not be silent
    either, which is what the warning in `build_sender` is for."""
    sender = build_sender(backend="carrier-pigeon", outbox=tmp_path, sender="k@example.com")
    assert sender.name == "file"


# ── idempotency, against a real database ────────────────────────────────────
#
# This is the property that keeps a polling dashboard from emailing the customer every
# few seconds, and it is a unique constraint rather than a Python check — a
# check-then-insert races itself the moment there are two workers. A constraint can
# only be tested against something that enforces it, so this needs PostgreSQL and
# skips without it.


async def _database_available() -> bool:
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


async def test_alert_is_idempotent_per_cycle_and_tier(tmp_path: Path) -> None:
    """Two dispatches for the same customer, cycle and tier — one email, not two."""
    if not await _database_available():
        pytest.skip("no PostgreSQL on KEA_DATABASE_URL")

    from sqlalchemy import delete

    from app.alerts.service import AlertDispatcher
    from app.db.models import Alert
    from app.db.session import get_sessionmaker

    sessionmaker = get_sessionmaker()
    dispatcher = AlertDispatcher(
        sender=FileSender(outbox=tmp_path, sender="Kea <no-reply@kea.example>"),
        sessionmaker=sessionmaker,
    )
    assessment = _assessment(overshoot_nzd=90.0, overshoot_pct=45.0)
    account = "H-TEST-IDEMPOTENT"

    async with sessionmaker() as session:
        await session.execute(delete(Alert).where(Alert.account_ref == account))
        await session.commit()

    try:
        first = await dispatcher.dispatch(
            account_ref=account,
            assessment=assessment,
            period="July 2026",
            recipient_email="someone@example.com",
        )
        second = await dispatcher.dispatch(
            account_ref=account,
            assessment=assessment,
            period="July 2026",
            recipient_email="someone@example.com",
        )

        assert first.sent == ("email",)
        assert first.already_sent is False

        assert second.sent == ()
        assert second.already_sent is True, "the second poll re-sent the alert"
        assert second.tier == first.tier, "the UI still needs the tier on a repeat poll"

        assert len(list(tmp_path.glob("*.eml"))) == 1
    finally:
        async with sessionmaker() as session:
            await session.execute(delete(Alert).where(Alert.account_ref == account))
            await session.commit()


def test_the_greeting_never_uses_the_household_label() -> None:
    """`ctx.label` describes the demo scenario — "Cold-snap driven, not behaviour" — and
    passing it as a name produced exactly that as a greeting.

    There is no name to substitute: `models.Customer` holds none, deliberately, because
    47.6% of surveyed customers said they would not trust an AI with their data and the
    schema is meant to back that up. A plain "Hi," is the honest greeting for a record
    that contains no person.
    """
    assessment = _assessment(overshoot_nzd=45.0, overshoot_pct=70.0)
    assert body_for(assessment, decide(assessment)).startswith("Hi,")


def test_the_recorded_channel_is_the_one_that_actually_carries_it() -> None:
    """A tier-2 row must not say `channel=sms delivered` when no SMS gateway exists.

    The table's whole purpose is answering "what was sent, through which channel, and
    did it land". Recording a delivery on a channel that cannot deliver is the
    flattering-but-false record this project refuses everywhere else.
    """
    decision = decide(_assessment(overshoot_nzd=90.0, overshoot_pct=45.0))
    assert decision.tier == 2
    assert decision.channels == ("email", "sms")

    # What the row's `channel` column is built from.
    assert (decision.deliverable_channels() or ("none",))[-1] == "email"


def test_the_ungated_rungs_are_recorded_rather_than_hidden() -> None:
    """Tiers 2 and 3 are real decisions with no gateway behind them yet. That gap
    belongs on the row, not only in a docstring."""
    decision = decide(_assessment(overshoot_nzd=TIER_3_NZD, overshoot_pct=80.0))
    not_wired = [c for c in decision.channels if c not in decision.deliverable_channels()]
    assert not_wired == ["sms", "voice"]
