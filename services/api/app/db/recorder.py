"""KEA-36 — write the evidence, at the moment it exists.

Two of this project's deliverables are counts, not features:

    "N answers, 0 fabricated figures"
    "this costs $X per conversation"

Neither can be reconstructed afterwards. A verification verdict that was never written
down is not evidence, and tokens that were never recorded cannot be re-counted once the
process exits. Every rehearsal run that happens before this code is wired in produces no
evidence at all — which is the whole reason the card says it cannot be backfilled.

## Why there are two implementations

`NullRecorder` is not a testing convenience with no purpose in production. It is what
runs when the API is started without a database, which is the normal state for frontend
work and for CI. The alternative — making `/chat` require PostgreSQL — would mean the
four people building the UI cannot run the backend at all without Docker.

The important property is that choosing the null path is **visible**: `/health` reports
which recorder is live, so nobody demos off a run that recorded nothing and then goes
looking for the numbers afterwards.

## Failure policy

Recording must never break an answer. A customer asking why their bill is high should
get their answer even if the evidence write fails; the alternative trades a working
product for a metric. Failures are logged at ERROR — loudly, because a silent recorder
is worse than no recorder: it produces a number that is confidently wrong.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Protocol

from sqlalchemy import select

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
from app.schemas import FactBundle, Intent, VerificationReport

log = logging.getLogger(__name__)


class TurnRecord:
    """Everything worth keeping about one exchange, gathered at the call site.

    A plain object rather than kwargs so that adding a field is a compile-time-ish
    change in one place instead of six call sites drifting apart.
    """

    __slots__ = (
        "customer_ref",
        "conversation_id",
        "question",
        "answer",
        "intent",
        "bundle",
        "report",
        "escalate",
        "channel",
        "provider",
        "model",
        "prompt_tokens",
        "completion_tokens",
        "latency_ms",
    )

    def __init__(
        self,
        *,
        customer_ref: str,
        conversation_id: int | None,
        question: str,
        answer: str,
        intent: Intent,
        bundle: FactBundle,
        report: VerificationReport,
        escalate: bool,
        channel: str = "chat",
        provider: str | None = None,
        model: str | None = None,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        latency_ms: int | None = None,
    ) -> None:
        self.customer_ref = customer_ref
        self.conversation_id = conversation_id
        self.question = question
        self.answer = answer
        self.intent = intent
        self.bundle = bundle
        self.report = report
        self.escalate = escalate
        self.channel = channel
        self.provider = provider
        self.model = model
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.latency_ms = latency_ms


class Recorder(Protocol):
    name: str

    async def record(self, record: TurnRecord) -> int | None:
        """Persist one exchange. Returns the conversation id to continue, or None."""
        ...


class NullRecorder:
    """Records nothing, and says so."""

    name = "none"

    async def record(self, record: TurnRecord) -> int | None:  # noqa: ARG002
        return None


class DatabaseRecorder:
    """Writes conversation, turn, fact bundle, verification, tokens and escalation."""

    name = "database"

    #: How long conversation history is kept. Payment-difficulty disclosures are PII,
    #: so this is set explicitly on every row rather than left to a column default —
    #: an unset retention date should be visible, not silently mean "forever".
    RETENTION_DAYS = 365

    #: Marks a row created purely so a conversation had something to hang off. Real
    #: seeded households carry a real region; these carry this, which is what
    #: `/api/households` filters on so mart accounts do not appear twice in the picker.
    ANCHOR_REGION = "(conversation-anchor)"

    async def record(self, record: TurnRecord) -> int | None:
        try:
            async with get_sessionmaker()() as session, session.begin():
                customer = (
                    await session.execute(
                        select(Customer).where(Customer.external_ref == record.customer_ref)
                    )
                ).scalar_one_or_none()

                if customer is None:
                    # Not an error — the household simply has no row in `public.customer`.
                    #
                    # That is the normal state for the nine ELT accounts: their data lives
                    # in `kea.*` and `make api-seed` only creates rows for the five seeded
                    # households. Returning None here meant 9 of the 14 logins were
                    # answered and verified and then recorded NOTHING — and
                    # "N answers, 0 fabricated figures" is counted from `app.verification`,
                    # so the claim was quietly missing two thirds of its evidence.
                    #
                    # `conversation.customer_id` is a foreign key, so the spine needs a row
                    # to hang off. This provisions the bare identity anchor and nothing
                    # else: an external_ref and a region placeholder. It is not a customer
                    # record — the real account data stays in the marts, and `Customer`
                    # deliberately holds no personal details.
                    customer = await self._anchor(session, record.customer_ref)

                conversation = await self._conversation(session, customer, record)

                seq = await self._next_seq(session, conversation.id)

                # The customer's question and the agent's answer are two turns. Storing
                # only the answer would make the transcript unreadable and the intent
                # unattributable to what was actually asked.
                session.add(
                    Turn(
                        conversation_id=conversation.id,
                        seq=seq,
                        role="customer",
                        body=record.question,
                        intent=record.intent.value,
                    )
                )

                agent_turn = Turn(
                    conversation_id=conversation.id,
                    seq=seq + 1,
                    role="agent",
                    body=record.answer,
                    intent=record.intent.value,
                    cited_sources=self._citation(record.bundle),
                    model_version=record.model,
                    latency_ms=record.latency_ms,
                )
                session.add(agent_turn)
                await session.flush()  # need agent_turn.id for the child rows

                session.add(
                    FactBundleRow(
                        turn_id=agent_turn.id,
                        intent=record.bundle.intent.value,
                        period=record.bundle.period,
                        facts=[f.model_dump(mode="json") for f in record.bundle.facts],
                    )
                )
                session.add(
                    VerificationRow(
                        turn_id=agent_turn.id,
                        passed=record.report.passed,
                        checked=list(record.report.checked),
                        unverified=list(record.report.unverified),
                        regenerated=getattr(record.report, "regenerated", False),
                        fell_back_to_template=getattr(
                            record.report, "fell_back_to_template", False
                        ),
                        provider_error=getattr(record.report, "provider_error", False),
                    )
                )
                if record.provider:
                    session.add(
                        TokenUsageRow(
                            turn_id=agent_turn.id,
                            provider=record.provider,
                            model=record.model or "unknown",
                            prompt_tokens=record.prompt_tokens,
                            completion_tokens=record.completion_tokens,
                        )
                    )

                if record.escalate:
                    conversation.was_escalated = True
                    conversation.outcome = "escalated"
                    if record.intent is Intent.HARDSHIP:
                        conversation.hardship_detected = True
                    session.add(
                        Escalation(
                            conversation_id=conversation.id,
                            turn_id=agent_turn.id,
                            reason=record.intent.value
                            if record.intent is Intent.HARDSHIP
                            else "out_of_scope",
                        )
                    )

                # Two turns were added: the question and the answer.
                conversation.message_count = (conversation.message_count or 0) + 2
                return conversation.id

        except Exception:  # noqa: BLE001 - an answer must not fail because evidence did
            log.exception(
                "failed to record turn for customer=%s intent=%s — the answer was still "
                "delivered, but this conversation is missing from the evidence tables",
                record.customer_ref,
                record.intent.value,
            )
            return record.conversation_id

    @staticmethod
    def _citation(bundle: FactBundle) -> dict | None:
        """The short citation for `turn.cited_sources` (KEA-50, data-transparency panel).

        Adjacent to `fact_bundle`, not a duplicate of it. The bundle is the full receipt
        — every fact with its value, unit and label, kept so a disputed figure can be
        reconstructed. This is what the *customer* is shown: which figures backed the
        answer, over what period, for which household. Keys and provenance, no values.

        Returns None for a bundle with no facts — a hardship reply carries none by
        design, and an empty citation panel is better than one asserting we cited
        nothing. `{}` would render as a panel; None renders as no panel.
        """
        if not bundle.facts:
            return None
        return {
            "household": bundle.customer_id,
            "period": bundle.period,
            "intent": bundle.intent.value,
            "fact_keys": [f.key for f in bundle.facts],
            # Named rather than implied. Every figure in this project comes from the
            # customer's own half-hourly meter data plus a benchmark that is
            # deliberately not derived from them, and the panel should say so.
            "basis": "half-hourly meter data for this household, and a benchmark drawn "
            "from comparable homes rather than from this household",
        }

    async def _anchor(self, session, external_ref: str) -> Customer:
        """Get or create the identity anchor a conversation can hang off.

        `ON CONFLICT DO NOTHING` rather than catching IntegrityError: in PostgreSQL a
        statement that raises aborts the whole transaction, so a caught IntegrityError
        would poison the surrounding `session.begin()` and lose the turn we were trying
        to save. The conflict clause keeps the transaction usable when two workers race
        the same first turn.
        """
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        await session.execute(
            pg_insert(Customer)
            .values(external_ref=external_ref, region=self.ANCHOR_REGION)
            .on_conflict_do_nothing(index_elements=["external_ref"])
        )
        anchor = (
            await session.execute(
                select(Customer).where(Customer.external_ref == external_ref)
            )
        ).scalar_one()
        log.info("provisioned identity anchor for %s", external_ref)
        return anchor

    async def _conversation(self, session, customer: Customer, record: TurnRecord):
        """Continue the caller's conversation, or open one bound to this customer.

        KEA-35: the binding has to exist from the first turn. Retrofitting identity onto
        a transcript that never had it means guessing, and a guessed binding on a
        hardship disclosure is not something to be casual about.
        """
        if record.conversation_id is not None:
            existing = await session.get(Conversation, record.conversation_id)
            # Ownership check: a conversation id from the client must not be usable to
            # append to somebody else's transcript.
            if existing is not None and existing.customer_id == customer.id:
                return existing
            log.warning(
                "conversation_id=%s does not belong to customer=%s; starting a new one",
                record.conversation_id,
                record.customer_ref,
            )

        conversation = Conversation(
            customer_id=customer.id,
            channel=record.channel,
            outcome="ongoing",
            retain_until=dt.date.today() + dt.timedelta(days=self.RETENTION_DAYS),
        )
        session.add(conversation)
        await session.flush()
        return conversation

    async def _next_seq(self, session, conversation_id: int) -> int:
        from sqlalchemy import func

        current = (
            await session.execute(
                select(func.coalesce(func.max(Turn.seq), 0)).where(
                    Turn.conversation_id == conversation_id
                )
            )
        ).scalar_one()
        return int(current) + 1


def build_recorder(persist: bool) -> Recorder:
    return DatabaseRecorder() if persist else NullRecorder()
