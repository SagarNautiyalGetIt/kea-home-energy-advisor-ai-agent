"""Question in, answer out, with the model deciding what it needs along the way.

    user turn
      -> model: "call get_account_summary"        (round 1)
      -> model: "call get_bill_comparison"        (round 2)
      -> model: prose                             (round 3, done)

## Why this streams the way it does

Text deltas are yielded from *every* round, not only the last. Models routinely write a
line before reaching for a tool ("Let me pull up your bill for July"), and holding that
back until the turn resolves means the customer watches a spinner for the two seconds
that reads worst. So the loop streams as it goes and emits `TurnDiscarded` when a round
turns out to have been a tool-selection round — the client drops what it rendered for
that round and shows the tool activity instead. The answer is whatever the final round
writes.

## Failure policy

Same as the recorder's, and for the same reason: an infrastructure failure must not cost
the customer their answer, and where it must, the customer is told plainly rather than
served something invented.

* A **tool** that fails returns an error *result* and the model routes around it. It
  usually can — most questions have more than one path through the data.
* The **model** failing is different: there is nothing to route around. The loop raises
  `AgentUnavailable`, and the transport says the assistant cannot answer right now. It
  does not fall back to a canned paragraph. The old architecture's template fallback
  existed because the model was a sentence-formatter over figures Python had already
  computed, so a template could stand in for it. Nothing can stand in for reasoning, and
  a fluent guess with no data behind it is precisely what this product exists not to do.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from app.agent.prompts import SYSTEM, build_user_turn
from app.agent.tools import TOOL_SCHEMAS, ToolContext, dispatch
from app.providers.base import LLMProvider, TextDelta, TokenUsage, TurnComplete

log = logging.getLogger(__name__)

#: How many times the model may go back for more data before it has to answer.
#:
#: Six is comfortably above what real questions need — the deepest path observed is
#: summary -> bill comparison -> daily usage -> answer — and low enough that a model
#: stuck in a lookup loop costs four wasted calls rather than a hung request. The final
#: round is forced tool-free, so hitting the cap still produces an answer rather than an
#: error.
MAX_ROUNDS = 6

#: Room to actually explain. The old cap was 300, sized for "2 to 4 sentences" — which
#: was itself the constraint that made every bill explanation a headline with no
#: reasoning under it.
MAX_ANSWER_TOKENS = 2000

#: Warmer than the old 0.2. That was tuned for verbatim copying of pre-formatted figures,
#: where any creativity was a verification failure waiting to happen. The model is now
#: writing an explanation from data it read itself, and 0.2 makes it stilted.
TEMPERATURE = 0.3


#: How many times a *transient* provider failure is retried before the turn is lost.
#:
#: Hosted models return 503 ("this model is currently experiencing high demand") and 429
#: routinely, and both are usually over in a second or two. Without this a momentary
#: spike ends the turn — which is what "it sometimes doesn't respond" looks like from the
#: customer's side, and is indistinguishable from the assistant being broken.
#:
#: Two, not more: a real outage should surface quickly rather than after a minute of
#: silent retrying, and the transports already say something honest when it does.
TRANSIENT_RETRIES = 2

#: Status codes worth retrying. 429 is rate limiting, 503/500/502/504 are the provider's
#: own capacity. Anything else — a bad request, a missing credential, a rejected tool
#: schema — is a bug that will fail identically on the second attempt, and retrying it
#: just delays the error.
_TRANSIENT_MARKERS = (
    "429", "RESOURCE_EXHAUSTED",
    "500", "502", "503", "504",
    "UNAVAILABLE", "INTERNAL",
    "overloaded_error", "ServiceUnavailable",
)


def _is_transient(exc: BaseException) -> bool:
    """Whether this failure is worth trying again.

    Matched on the message rather than on exception type, because the three providers
    raise three unrelated hierarchies (`google.genai.errors.ServerError`,
    `anthropic.APIStatusError`, `httpx.HTTPStatusError`) and importing all of them here
    would drag every SDK into a module that deliberately depends on none of them.
    Crude, but it fails in the safe direction: a mis-classified permanent error costs
    two extra calls, while a mis-classified transient one costs the customer their answer.
    """
    text = f"{type(exc).__name__}: {exc}"
    return any(marker in text for marker in _TRANSIENT_MARKERS)


#: Longest we will sit on a retry the provider explicitly asked for.
#:
#: Deliberately larger than the guessed-backoff cap. Sleeping *less* than the stated
#: `retryDelay` guarantees a second 429 — which is what happened with a 10s cap against
#: Gemini's 20s ask: both retries fired early, both failed, and the turn was lost anyway.
#: A 25-second wait is a bad experience; three failures in 12 seconds is a worse one.
RETRY_AFTER_CAP_S = 25.0

#: Cap for our own exponential guess, when the provider says nothing. Lower, because a
#: guess that long is more likely to be a stall than a recovery.
BACKOFF_CAP_S = 8.0


def _backoff(exc: BaseException, attempt: int) -> float:
    """Seconds to wait. Honours the provider's own `retryDelay` when it gives one.

    Gemini's 429 carries `'retryDelay': '20s'` and means it: the free tier is
    **5 requests per minute per model**, so the window genuinely has not reopened before
    then. Guessing shorter is not optimism, it is a wasted call.
    """
    match = re.search(r"retryDelay'?:\s*'?(\d+(?:\.\d+)?)s", str(exc))
    if match:
        return min(float(match.group(1)) + 0.5, RETRY_AFTER_CAP_S)
    return min(2.0**attempt, BACKOFF_CAP_S)


class AgentUnavailable(RuntimeError):
    """The model could not be reached. The transport says so; it does not invent prose."""


@dataclass(frozen=True)
class ToolInvocation:
    """One tool call and what it returned. The provenance record for one answer.

    This replaces the `FactBundle` as the evidence trail. It is a better one: the bundle
    recorded what Python decided to compute *before* the model saw the question, so it
    described the pipeline's intent rather than the answer's basis. This records what was
    actually read, in the order it was read, with the arguments that produced it.
    """

    name: str
    arguments: dict[str, Any]
    result: dict[str, Any]
    duration_ms: int = 0

    @property
    def failed(self) -> bool:
        return "error" in self.result

    @property
    def unavailable(self) -> bool:
        return self.result.get("available") is False

    def summary(self) -> dict[str, Any]:
        """What the customer-facing transparency panel shows: what was consulted, not
        every figure inside it."""
        return {
            "tool": self.name,
            "arguments": self.arguments or None,
            "source": self.result.get("source"),
            "ok": not self.failed and not self.unavailable,
        }


@dataclass
class AgentResult:
    """One completed turn."""

    text: str
    tools_used: list[ToolInvocation] = field(default_factory=list)
    escalate: bool = False
    escalation_reason: str | None = None
    usage: TokenUsage = field(default_factory=TokenUsage)
    rounds: int = 0
    hit_round_limit: bool = False

    @property
    def sources(self) -> list[dict[str, Any]]:
        return [t.summary() for t in self.tools_used]


# --- the events the loop yields -------------------------------------------------


@dataclass(frozen=True)
class Thinking:
    """Prose from the current round. Provisional until the round resolves."""

    text: str


@dataclass(frozen=True)
class TurnDiscarded:
    """The round just streamed was a tool-selection round. Drop its text."""


@dataclass(frozen=True)
class ToolStarted:
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolFinished:
    name: str
    ok: bool
    source: str | None = None


@dataclass(frozen=True)
class Finished:
    result: AgentResult


AgentEvent = Thinking | TurnDiscarded | ToolStarted | ToolFinished | Finished


async def run_agent(
    provider: LLMProvider,
    ctx: ToolContext,
    question: str,
    history: list[dict[str, Any]] | None = None,
    handling: str | None = None,
) -> AsyncIterator[AgentEvent]:
    """Drive one turn to completion, yielding progress as it happens.

    `history` is prior turns in the neutral shape below, so a follow-up question ("what
    about last month?") has the context to resolve against. The old pipeline had no such
    thing — every question was routed and answered in isolation, which is why a follow-up
    was usually re-answered as if it were the first thing asked.

    The neutral message shape, which every provider translates and none may mutate:

        {"role": "user",      "content": "why is my bill so high?"}
        {"role": "assistant", "content": "...", "tool_calls": [ToolCall, ...]}
        {"role": "tool",      "tool_call_id": "...", "name": "...", "content": {...}}

    `handling` is the hardship tier's guidance — see `app/hardship/tiers.py`. It is
    appended to the system prompt rather than the user turn, because it is an
    instruction about how to behave and not something the customer said. Python decides
    it; the model is told the outcome and cannot argue with it.
    """
    messages: list[dict[str, Any]] = list(history or [])
    invocations: list[ToolInvocation] = []
    usage = TokenUsage()
    answer = ""

    # The account summary is pre-loaded rather than fetched.
    #
    # The prompt used to open with "start by calling get_account_summary for almost any
    # question", and the model duly spent a whole round doing it — every turn, for every
    # question, fetching the same row. That is a third of the model calls in a typical
    # turn buying orientation we can simply hand over.
    #
    # It matters more than it looks on the current key. Gemini's free tier is FIVE
    # requests per minute per model, and a four-round turn is four of them; dropping to
    # three is the difference between roughly one question a minute and not quite one. It
    # also removes a round trip of pure latency from every answer, including voice.
    #
    # It rides on the *user* turn rather than as a synthetic assistant tool-call pair.
    # That was the first attempt and Gemini 3.x rejects it: every functionCall part in
    # history must carry a `thought_signature`, and a call the model never made has none
    # to carry. Context in the user turn is something all three providers handle
    # identically and no provider can object to.
    #
    # Still recorded as a real invocation, so the provenance panel and
    # `app.agent_tool_call` cannot tell the difference — the customer sees "looked up
    # your account", because that is exactly what happened.
    preamble = ""
    if not history:
        started = time.perf_counter()
        summary = await dispatch(ctx, "get_account_summary", {})
        invocations.append(
            ToolInvocation(
                name="get_account_summary",
                arguments={},
                result=summary,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )
        )
        preamble = (
            "Here is this customer's account summary, already looked up for you:\n"
            f"{tool_result_to_text(summary)}\n\n"
            "The customer asks:\n"
        )

    messages.append({"role": "user", "content": preamble + build_user_turn(question)})

    for round_number in range(1, MAX_ROUNDS + 1):
        # The last round is answered without tools. A model that has spent five rounds
        # fetching has everything it is going to get, and offering the catalogue again
        # invites a sixth lookup instead of a reply.
        final_round = round_number == MAX_ROUNDS
        turn: TurnComplete | None = None

        for attempt in range(1, TRANSIENT_RETRIES + 2):
            turn = None
            streamed = False
            try:
                async for event in provider.converse(
                    system=SYSTEM if not handling else f"{SYSTEM}\n\n{handling}",
                    messages=messages,
                    tools=None if final_round else TOOL_SCHEMAS,
                    max_tokens=MAX_ANSWER_TOKENS,
                    temperature=TEMPERATURE,
                ):
                    if isinstance(event, TextDelta):
                        if event.text:
                            streamed = True
                            yield Thinking(event.text)
                    elif isinstance(event, TurnComplete):
                        turn = event
                break
            except Exception as exc:  # noqa: BLE001 - classified below, never swallowed
                retryable = _is_transient(exc) and attempt <= TRANSIENT_RETRIES
                log.warning(
                    "provider %s failed on round %d attempt %d: %s",
                    provider.name, round_number, attempt, exc,
                )
                if not retryable:
                    raise AgentUnavailable(str(exc)) from exc
                if streamed:
                    # Bytes for this round are already on the wire. Retrying would
                    # append a second draft to the first, so tell the client to drop
                    # what it rendered before the replacement arrives.
                    yield TurnDiscarded()
                await asyncio.sleep(_backoff(exc, attempt))

        if turn is None:
            raise AgentUnavailable(f"{provider.name} produced no turn")

        if turn.usage is not None:
            usage = usage + turn.usage

        # On the final round any tool call is ignored rather than run. The catalogue was
        # not offered, so a call here means the model asked for something it was not
        # given — and there is no round left to hand the result back in. Falling through
        # to another iteration would end the loop with no answer at all, which is a
        # failed conversation caused by the model being over-eager rather than by
        # anything being wrong with the data.
        if not turn.wants_tools or final_round:
            if final_round and turn.wants_tools:
                log.warning(
                    "model asked for %s on the final round, when no tools were offered — "
                    "ignoring the calls and taking the text",
                    [c.name for c in turn.tool_calls],
                )
            answer = turn.text.strip()
            if not answer:
                # An empty bubble is not an answer, and it is the one output that looks
                # like a UI bug rather than a service problem — so the customer retries
                # the click instead of the question. Raising sends them the "try again
                # shortly" message the transports already handle.
                raise AgentUnavailable(
                    f"{provider.name} returned no text on round {round_number}"
                )
            messages.append({"role": "assistant", "content": answer})
            yield Finished(
                AgentResult(
                    text=answer,
                    tools_used=invocations,
                    escalate=ctx.escalated,
                    escalation_reason=ctx.escalation_reason,
                    usage=usage,
                    rounds=round_number,
                    hit_round_limit=final_round and bool(invocations),
                )
            )
            return

        # A tool-selection round. Whatever prose it produced was a preamble, not the
        # answer — tell the client to drop it.
        yield TurnDiscarded()

        messages.append(
            {
                "role": "assistant",
                "content": turn.text,
                "tool_calls": list(turn.tool_calls),
            }
        )

        for call in turn.tool_calls:
            yield ToolStarted(call.name, call.arguments)
            started = time.perf_counter()
            result = await dispatch(ctx, call.name, call.arguments)
            elapsed = int((time.perf_counter() - started) * 1000)

            invocation = ToolInvocation(
                name=call.name,
                arguments=call.arguments,
                result=result,
                duration_ms=elapsed,
            )
            invocations.append(invocation)
            log.info(
                "tool customer=%s name=%s ok=%s ms=%d",
                ctx.customer_id,
                call.name,
                not invocation.failed and not invocation.unavailable,
                elapsed,
            )
            yield ToolFinished(
                call.name,
                ok=not invocation.failed and not invocation.unavailable,
                source=result.get("source"),
            )

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.name,
                    "content": result,
                }
            )

    # Unreachable: the final round always takes the branch above, whether or not the
    # model asked for a tool. Kept as a loud failure rather than a silent empty answer in
    # case someone changes that.
    raise AgentUnavailable("agent loop ended without an answer")  # pragma: no cover


async def answer_once(
    provider: LLMProvider,
    ctx: ToolContext,
    question: str,
    history: list[dict[str, Any]] | None = None,
) -> AgentResult:
    """`run_agent` for callers that only want the result — /chat, the golden set, tests."""
    async for event in run_agent(provider, ctx, question, history):
        if isinstance(event, Finished):
            return event.result
    raise AgentUnavailable("agent loop produced no result")  # pragma: no cover


def tool_result_to_text(result: dict[str, Any]) -> str:
    """Serialise a tool result for providers whose wire format takes a string.

    Compact separators and no indentation: this goes into the prompt on every subsequent
    round, and pretty-printing a month of daily rows costs real tokens for whitespace no
    model needs. `default=str` catches dates and Decimals that escaped the boundary
    conversion rather than failing the turn over one column.
    """
    return json.dumps(result, separators=(",", ":"), default=str)
