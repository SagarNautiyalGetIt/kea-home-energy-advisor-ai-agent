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

import json
import logging
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
    """
    messages: list[dict[str, Any]] = list(history or [])
    messages.append({"role": "user", "content": build_user_turn(question)})

    invocations: list[ToolInvocation] = []
    usage = TokenUsage()
    answer = ""

    for round_number in range(1, MAX_ROUNDS + 1):
        # The last round is answered without tools. A model that has spent five rounds
        # fetching has everything it is going to get, and offering the catalogue again
        # invites a sixth lookup instead of a reply.
        final_round = round_number == MAX_ROUNDS
        turn: TurnComplete | None = None

        try:
            async for event in provider.converse(
                system=SYSTEM,
                messages=messages,
                tools=None if final_round else TOOL_SCHEMAS,
                max_tokens=MAX_ANSWER_TOKENS,
                temperature=TEMPERATURE,
            ):
                if isinstance(event, TextDelta):
                    if event.text:
                        yield Thinking(event.text)
                elif isinstance(event, TurnComplete):
                    turn = event
        except Exception as exc:  # noqa: BLE001 - one class of failure, one message
            log.error("provider %s failed on round %d: %s", provider.name, round_number, exc)
            raise AgentUnavailable(str(exc)) from exc

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
