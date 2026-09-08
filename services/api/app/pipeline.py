"""The one path from a customer question to an answer.

`/chat`, `/chat/stream`, the Vapi adapter and the voice WebSocket all come through here.
That is not tidiness — it is ADR-0003's acceptance criterion made structural. "Voice
cannot produce an answer chat wouldn't" is easy to assert in a document and easy to break
in code six days later, when somebody adds a voice-only shortcut because the model was
slow in a rehearsal. There is one function that turns a question into prose, so the
channels cannot drift without deleting this module.

## What this used to be

Four layers, in order, every time:

    route()                 free text -> one of 26 intents      (keyword matching)
    bundle_from_context()   intent    -> a fixed list of facts  (pure Python)
    narrate_verified()      facts     -> 2-4 sentences          (model)
    verify()                prose     -> accept or template     (Python)

The model owned layer 2 and nothing else. It never chose what to compute, never saw a
meter reading, and was forbidden from doing arithmetic — which was coherent, because it
was a sentence-formatter over figures Python had already worked out.

It is gone, and the two symptoms that killed it were both structural rather than
prompt-level:

**Every answer read the same.** Layer 0 was keyword matching over a closed set. Anything
it did not recognise landed on an empty bundle whose caveat told the model to say it
could not help and offer the team — so questions the data could answer perfectly well
came back as a handoff, and the ones that did route produced near-identical restatements
of a fixed fact list.

**Nothing could be explained in depth.** The system prompt capped answers at two to four
sentences and banned comparison, inference and arithmetic. A customer asking why their
bill jumped eighty dollars got a headline. Asking for more got the handoff sentence,
because there was no mechanism for more.

## What it is now

    build_context()   fetch this household's data once      (I/O, scoped server-side)
    run_agent()       model reads, calls tools, answers      (app/agent/)

The model decides what it needs and goes and gets it. Python still owns scoping,
retrieval and the fitted forecast — see `app/agent/tools.py` for why those three are not
the middleman that was removed.

## The seam that had to survive the rewrite

**Evidence recording.** It lives in `answer()` rather than in the transports, because it
used to live in the `/chat` handlers and a voice conversation therefore produced no
evidence row at all — a demo driven over the microphone reported zero answers. Every
channel records, and `channel` on the row says which one it was.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from app import hardship
from app.agent.loop import (
    AgentResult,
    AgentUnavailable,
    Finished,
    ToolInvocation,
    run_agent,
)
from app.agent.tools import ToolContext
from app.analytics.account import AccountContext
from app.analytics.repository import UsageContext
from app.clarify import conversation as clarify_conversation
from app.config import get_context_store, get_provider, get_recorder, get_repository
from app.db.recorder import TurnRecord

log = logging.getLogger(__name__)

DAYS_IN_JULY = 31
"""The demo cohort's cycle length. **A fallback, not a fact about any real account.**

Retailers stagger billing cycle days across the month precisely so that mid-cycle
alerting does not all fire on the same day — `billing.account.billing_cycle_day` exists
for that, and `mart_account_context` carries the resulting period dates. A real cohort
therefore has cycles of 28 to 33 days that start on different dates, and assuming 31 for
all of them puts a straight-line month-end projection out by up to 10% in the direction
that matters: it *understates* the bill for a household on a longer cycle, which is the
one group a bill-shock warning exists to reach.

Still used by the bill-shock endpoint and the clarifying-question path, which are
proactive and run without a question to answer. The agent's own projection reads the
account's real period dates; see `agent/tools.py:project_this_bill`.
"""


def days_in_cycle(ctx: UsageContext) -> int:
    """How many days this account's current billing period actually covers.

    Read from the account's own period dates when the marts have them, so an account
    billed 15th-to-14th is projected over its real 30 or 31 days rather than a calendar
    month it does not use.
    """
    account = getattr(ctx, "account", None)
    billing = getattr(account, "billing", None) if account else None
    start = getattr(billing, "current_period_start", None)
    end = getattr(billing, "current_period_end", None)
    if start and end and end >= start:
        # Inclusive of both endpoints, matching `bill.period_days` on the platform side —
        # a period from the 1st to the 31st is 31 days, not 30.
        return (end - start).days + 1
    return DAYS_IN_JULY


class UnknownCustomerError(KeyError):
    """Raised before any transport has committed a response body."""


# A sentence ends at . ? or ! followed by whitespace and a capital or a quote. Splitting
# on the bare string ". " broke "e.g. roughly $24" into a chunk ending "e.g." — and the
# old code then appended a second full stop. It matters beyond cosmetics: ADR-0003 has
# voice speaking sentence one while sentence two generates, so a bad boundary becomes an
# audible one.
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“])')

#: Markdown the model may reach for. Voice reads the answer aloud, and "asterisk asterisk
#: your bill asterisk asterisk" is not a thing to say to a customer on the phone.
_MARKDOWN = re.compile(r"(\*\*|__|`|^#{1,6}\s*|^[-*]\s+)", re.MULTILINE)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


def _spoken(text: str) -> list[str]:
    """The answer as sentences a synthesiser should say.

    Markdown is stripped rather than forbidden in the prompt. Telling a model not to bold
    anything works most of the time, and "most of the time" is not good enough for
    something read aloud down a phone line — this cannot fail.
    """
    return _sentences(_MARKDOWN.sub("", text))


#: What the assistant says when a person is taking the conversation.
#:
#: Written down rather than generated, because tier 3 exists for the cases where the
#: model must not improvise: somebody in acute distress, or somebody who has just told
#: us they cannot pay. A model asked to be warm here will offer payment options it
#: cannot honour or reassurance it cannot support, and both are worse than one plain
#: sentence. See `app/hardship/tiers.py`.
HANDOVER_TEXT = (
    "Thank you for telling me — that sounds really hard, and you should be talking to a "
    "person rather than to me. I've passed this to our customer care team and someone "
    "will pick it up shortly. You won't have to explain it again."
)


@dataclass(frozen=True)
class Answer:
    """One reply, plus everything a transport needs to render it."""

    customer_id: str
    text: str
    tools_used: list[ToolInvocation] = field(default_factory=list)
    escalate: bool = False
    escalation_reason: str | None = None
    conversation_id: int | None = None
    latency_ms: int = 0

    tier: int = 1
    """Who handled this turn: 1 autonomous, 2 monitored, 3 human only.

    On the response rather than behind its own endpoint because the UI has to show the
    handover next to the message that caused it, and a second request could assess a
    different turn."""

    tier_reason: str | None = None
    hardship_evidence: list[str] = field(default_factory=list)
    """Why, in the assessor's words. Shown to the agent picking the conversation up —
    "flagged: 0.8" is not a handover."""

    @property
    def sentences(self) -> list[str]:
        """Computed here rather than by each caller because voice speaks sentence one
        while sentence two is still generating (ADR-0003's load-bearing latency
        optimisation) and SSE streams the same chunks. Two transports splitting prose two
        different ways is how the channels start to diverge."""
        return _spoken(self.text)

    @property
    def sources(self) -> list[dict[str, Any]]:
        """What backed this answer, for the transparency panel."""
        return [t.summary() for t in self.tools_used]


async def build_context(customer_id: str) -> ToolContext:
    """Fetch this household's data once, before the model is touched.

    Raises `UnknownCustomerError` here rather than inside a tool so an unknown id is a
    clean 404 before any transport has committed a response body. A tool reporting "I
    cannot find that household" would arrive as a 200 with an apologetic paragraph, which
    is a worse answer to a client bug.
    """
    try:
        usage = await get_repository().context(customer_id)
    except KeyError as exc:
        raise UnknownCustomerError(str(exc)) from exc

    account = getattr(usage, "account", None)
    if account is None:
        # The fixture and seeded paths have no plan, bill or account row, so the thin
        # context is built instead and the account lookups answer honestly that they
        # cannot see the detail. See analytics/account.py on why a placeholder is not
        # offered here.
        account = AccountContext.from_window(
            customer_id,
            usage.window,
            label=usage.label,
            hdd=usage.hdd,
            peer_baseline=usage.baseline,
        )

    ctx = ToolContext(customer_id=customer_id, usage=usage, account=account)

    # The question Sparky asked last turn, re-derived rather than stored. A question is a
    # pure function of the account's data and the household's recorded context, so this
    # returns the same one until an answer is recorded — see clarify/conversation.py.
    # Swallowed to None on failure: a household should never lose their answer because
    # the question could not be rebuilt.
    try:
        household = await get_context_store().get(customer_id)
        ctx.open_question = clarify_conversation.question_for(
            account, household, period=usage.window.period, hardship_detected=False
        )
    except Exception:  # noqa: BLE001
        log.warning("could not resolve an open question for %s", customer_id, exc_info=True)

    return ctx


async def _record(
    ctx: ToolContext,
    result: AgentResult,
    question: str,
    *,
    channel: str,
    conversation_id: int | None,
    latency_ms: int,
    tiering: hardship.TierDecision | None = None,
) -> int | None:
    """Write the evidence. Never raises — see recorder.py on why an evidence failure must
    not cost the customer their answer."""
    provider = get_provider()
    log.info(
        "answer channel=%s customer=%s tier=%s tools=%s rounds=%d tokens=%d latency_ms=%d",
        channel,
        ctx.customer_id,
        tiering.tier.label if tiering else "n/a",
        [t.name for t in result.tools_used],
        result.rounds,
        result.usage.total,
        latency_ms,
    )
    return await get_recorder().record(
        TurnRecord(
            customer_ref=ctx.customer_id,
            conversation_id=conversation_id,
            question=question,
            answer=result.text,
            tools=result.tools_used,
            escalate=(
                tiering.tier is not hardship.Tier.AUTONOMOUS
                if tiering is not None
                else result.escalate
            ),
            escalation_reason=(
                tiering.reason if tiering is not None else result.escalation_reason
            ),
            channel=channel,
            provider=getattr(provider, "name", None),
            model=getattr(provider, "model", None),
            prompt_tokens=result.usage.prompt_tokens,
            completion_tokens=result.usage.completion_tokens,
            latency_ms=latency_ms,
        )
    )



async def _settle_question(ctx: ToolContext) -> str | None:
    """Write any recorded answer, then return the question to append — verbatim.

    Two halves of one exchange, in this order on purpose. Recording first means the
    question we then select already reflects the answer just given, so a household that
    confirms a new appliance is asked about occupancy next rather than about the appliance
    again.

    Returns the exact `ClarifyingQuestion.prompt`. It is appended to the answer rather
    than handed to the model to phrase, because the property that makes multi-turn
    testable is that **Sparky bounds the reply space** — we only have to handle answers to
    a question we wrote. A model paraphrasing loses that on the first turn.
    """
    try:
        household = await get_context_store().get(ctx.customer_id)

        if ctx.answered_question is not None:
            question, response = ctx.answered_question
            household = clarify_conversation.record_answer(household, question, response)
            household = await get_context_store().put(household)
            log.info(
                "clarify answered customer=%s question=%s answer=%s",
                ctx.customer_id, question.id, response.answer.value,
            )
            # Re-derive against the updated context: the one just answered is settled.
            ctx.open_question = clarify_conversation.question_for(
                ctx.account, household,
                period=ctx.usage.window.period, hardship_detected=False,
            )

        return ctx.open_question.prompt if ctx.open_question else None
    except Exception:  # noqa: BLE001 - a question is an addition to the answer, never a
        # reason to lose it.
        log.warning(
            "could not settle the clarifying question for %s", ctx.customer_id, exc_info=True
        )
        return None


async def answer(
    customer_id: str,
    message: str,
    *,
    channel: str = "chat",
    conversation_id: int | None = None,
    history: list[dict[str, Any]] | None = None,
) -> Answer:
    """Question in, answer out. The non-streaming path."""
    ctx = await build_context(customer_id)
    started = time.perf_counter()

    # Assessed before the model runs, on every channel. Two reasons it is here rather
    # than inside the agent: a tier-3 turn must not spend a model call at all, and the
    # tier has to be decidable when the provider is down — a customer disclosing hardship
    # during an outage still needs a person.
    assessment = hardship.assess(message, ctx.account)
    tiering = hardship.decide(assessment)

    if tiering.tier is hardship.Tier.HUMAN_ONLY:
        return await _handover(
            ctx, message, tiering, channel=channel, conversation_id=conversation_id,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    result: AgentResult | None = None
    async for event in run_agent(
        get_provider(), ctx, message, history, handling=tiering.guidance
    ):
        if isinstance(event, Finished):
            result = event.result
    if result is None:  # pragma: no cover - run_agent raises rather than finishing empty
        raise AgentUnavailable("agent produced no result")

    # The model can still escalate from inside a tier-1 or tier-2 turn — it sees things
    # the phrase bank does not. It can only raise the tier, never lower it.
    tiering = hardship.decide(assessment, model_requested_handoff=result.escalate)

    # Appended after the model has finished, never composed by it. Skipped entirely on a
    # monitored turn for the same reason the alert path skips it: a household under
    # financial pressure gets an answer, not a questionnaire.
    question = (
        await _settle_question(ctx)
        if tiering.tier is hardship.Tier.AUTONOMOUS
        else None
    )
    text = f"{result.text}\n\n{question}" if question else result.text

    latency_ms = int((time.perf_counter() - started) * 1000)
    recorded_id = await _record(
        ctx,
        result,
        message,
        channel=channel,
        conversation_id=conversation_id,
        latency_ms=latency_ms,
        tiering=tiering,
    )

    return Answer(
        customer_id=customer_id,
        text=text,
        tools_used=result.tools_used,
        escalate=tiering.tier is not hardship.Tier.AUTONOMOUS,
        escalation_reason=result.escalation_reason or (
            tiering.reason if tiering.notify_agent else None
        ),
        conversation_id=recorded_id,
        latency_ms=latency_ms,
        tier=int(tiering.tier),
        tier_reason=tiering.reason,
        hardship_evidence=tiering.evidence,
    )


async def _handover(
    ctx: ToolContext,
    message: str,
    tiering: hardship.TierDecision,
    *,
    channel: str,
    conversation_id: int | None,
    latency_ms: int,
) -> Answer:
    """Tier 3: a person takes it, and the model is not asked to write anything.

    Recorded like any other turn so the conversation is in the evidence tables with its
    reason attached — a handover that leaves no row is one nobody can audit, and this is
    the class of turn most likely to be audited.
    """
    log.info(
        "hardship handover channel=%s customer=%s score=%.2f reason=%s",
        channel, ctx.customer_id, tiering.score, tiering.reason,
    )
    result = AgentResult(text=HANDOVER_TEXT, escalate=True, escalation_reason=tiering.reason)
    recorded_id = await _record(
        ctx, result, message,
        channel=channel, conversation_id=conversation_id,
        latency_ms=latency_ms, tiering=tiering,
    )
    return Answer(
        customer_id=ctx.customer_id,
        text=HANDOVER_TEXT,
        escalate=True,
        escalation_reason=tiering.reason,
        conversation_id=recorded_id,
        latency_ms=latency_ms,
        tier=int(tiering.tier),
        tier_reason=tiering.reason,
        hardship_evidence=tiering.evidence,
    )


async def answer_stream(
    customer_id: str,
    message: str,
    *,
    channel: str = "chat",
    conversation_id: int | None = None,
    history: list[dict[str, Any]] | None = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The streaming path, as `(event_name, payload)` pairs the transports format.

    Yields, in order:

        tool    {"name", "arguments"}          a lookup started
        result  {"name", "ok", "source"}       and what it found
        reset   {}                             discard the text streamed this round
        token   {"text"}                       prose, as it is written
        done    {"sources", "escalate", ...}

    `reset` is the one that needs explaining. Models routinely write a line before
    reaching for a tool ("Let me pull up your July bill"), and holding that back until
    the round resolves means the customer watches a spinner for the two seconds that
    read worst. So text streams as it arrives, and `reset` says the round it belonged to
    turned out to be a lookup — drop it and show the tool activity instead.

    The caller must have called `build_context` already, so an unknown customer is a 404
    before the SSE content-type is committed rather than a 500 with a half-open stream.
    """
    ctx = await build_context(customer_id)
    started = time.perf_counter()

    # Imported here rather than at module scope: the loop's event types are an internal
    # protocol between it and this function, and nothing else in the app matches on them.
    from app.agent.loop import Thinking, ToolFinished, ToolStarted, TurnDiscarded

    # Same assessment the non-streaming path runs, before the model is touched. A tier-3
    # turn streams the handover as one frame and spends no model call at all.
    assessment = hardship.assess(message, ctx.account)
    tiering = hardship.decide(assessment)

    if tiering.tier is hardship.Tier.HUMAN_ONLY:
        handover = await _handover(
            ctx, message, tiering, channel=channel, conversation_id=conversation_id,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
        yield "token", {"text": handover.text}
        yield "done", {
            "sources": [],
            "escalate_to_human": True,
            "escalation_reason": handover.escalation_reason,
            "conversation_id": handover.conversation_id,
            "latency_ms": handover.latency_ms,
            "tokens": 0,
            "tier": handover.tier,
            "tier_reason": handover.tier_reason,
        }
        return

    result: AgentResult | None = None
    try:
        async for event in run_agent(
            get_provider(), ctx, message, history, handling=tiering.guidance
        ):
            match event:
                case Thinking(text=text):
                    yield "token", {"text": text}
                case TurnDiscarded():
                    yield "reset", {}
                case ToolStarted(name=name, arguments=arguments):
                    yield "tool", {"name": name, "arguments": arguments or {}}
                case ToolFinished(name=name, ok=ok, source=source):
                    yield "result", {"name": name, "ok": ok, "source": source}
                case Finished(result=finished):
                    result = finished
    except AgentUnavailable as exc:
        # The model is unreachable and there is nothing to route around. Say so — do not
        # serve a canned paragraph. The old architecture's template fallback worked
        # because the model was formatting figures Python had already computed, so a
        # template could stand in for it. Nothing stands in for reasoning, and a fluent
        # guess with no data behind it is what this product exists not to do.
        log.error("agent unavailable customer=%s: %s", customer_id, exc)
        yield "error", {
            "message": (
                "Sparky can't reach your account data right now, so there's nothing "
                "reliable to tell you. Please try again shortly."
            ),
            "retryable": True,
        }
        return

    if result is None:  # pragma: no cover - run_agent raises rather than finishing empty
        return

    # The model may have escalated from inside the turn; re-decide so it can raise the
    # tier. `decide` never lowers one.
    tiering = hardship.decide(assessment, model_requested_handoff=result.escalate)

    # Same as the non-streaming path: appended verbatim, and never on a turn where
    # somebody is under financial pressure. Streamed as one more token frame so a client
    # that only implements `token` still shows it.
    question = (
        await _settle_question(ctx)
        if tiering.tier is hardship.Tier.AUTONOMOUS
        else None
    )
    if question:
        yield "token", {"text": f"\n\n{question}"}

    latency_ms = int((time.perf_counter() - started) * 1000)
    recorded_id = await _record(
        ctx,
        result,
        message,
        channel=channel,
        conversation_id=conversation_id,
        latency_ms=latency_ms,
        tiering=tiering,
    )

    yield "done", {
        "sources": result.sources,
        "escalate_to_human": tiering.tier is not hardship.Tier.AUTONOMOUS,
        "escalation_reason": result.escalation_reason or (
            tiering.reason if tiering.notify_agent else None
        ),
        "conversation_id": recorded_id,
        "latency_ms": latency_ms,
        "tokens": result.usage.total,
        "tier": int(tiering.tier),
        "tier_reason": tiering.reason,
    }
