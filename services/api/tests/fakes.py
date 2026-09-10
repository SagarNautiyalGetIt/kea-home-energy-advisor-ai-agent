"""Test doubles for the agent, shared by the voice, recorder and evidence suites.

A real model here would take the suite from seconds to minutes, and a suite people stop
running is worse than no suite. These fakes exercise the loop, the tool dispatcher and
the transports for real — only the token generation is scripted.

Two of them, because two different things need testing:

* `ScriptedProvider` — a fixed plan of tool calls then an answer. Deterministic, so a
  test can assert exactly which tools ran and in what order.
* `EchoProvider` — calls one tool and quotes a real figure out of its result. Slightly
  less deterministic to assert against, but it proves the tool result actually reaches
  the model's context rather than being dispatched into a void, which is the failure a
  fully scripted double cannot catch.
"""

from __future__ import annotations

from typing import Any

from app.providers.base import TextDelta, TokenUsage, ToolCall, TurnComplete


class ScriptedProvider:
    """Runs a fixed list of tool rounds, then says `answer`.

    `rounds` is a list of lists: each inner list is the tool calls for one round, as
    `(name, arguments)` pairs. An empty `rounds` means it answers immediately.
    """

    name = "fake"
    model = "fake"

    def __init__(
        self,
        rounds: list[list[tuple[str, dict[str, Any]]]] | None = None,
        answer: str = "Your steady overnight load is what is driving this bill.",
    ) -> None:
        self.rounds = rounds if rounds is not None else [[("get_daily_usage", {})]]
        self.answer = answer
        self.last_usage = TokenUsage()
        #: Every (system, messages, tools) the loop handed over, so a test can assert
        #: what the model was actually shown — the tool catalogue on early rounds, and
        #: nothing on the last one.
        self.calls: list[dict[str, Any]] = []

    async def converse(
        self, *, system, messages, tools=None, max_tokens=2000, temperature=0.3
    ):
        index = len(self.calls)
        self.calls.append(
            {"system": system, "messages": list(messages), "tools": tools}
        )

        if index < len(self.rounds):
            calls = tuple(
                ToolCall(id=f"call-{index}-{i}", name=name, arguments=args)
                for i, (name, args) in enumerate(self.rounds[index])
            )
            # Text alongside the tool calls, because real models do that — they narrate
            # ("Let me pull up your July bill") and reach for a tool in the same turn.
            # A double that only ever emitted one or the other would not exercise the
            # loop's `TurnDiscarded` path at all.
            preamble = "Let me check that. "
            yield TextDelta(preamble)
            yield TurnComplete(
                text=preamble if index + 1 < len(self.rounds) else self.answer,
                tool_calls=calls,
                usage=TokenUsage(50, 10),
            )
            return

        for piece in self.answer.split(". "):
            yield TextDelta(piece + ". " if not piece.endswith(".") else piece)
        yield TurnComplete(text=self.answer, tool_calls=(), usage=TokenUsage(200, 40))

    async def narrate(self, *, system, user, max_tokens=300, temperature=0.2):
        yield self.answer

    async def health(self) -> bool:
        return True


class EchoProvider:
    """Calls one tool, then quotes a figure it actually found in the result.

    Proves the round trip: the dispatcher's output has to reach the next request's
    messages for this to produce a number at all.
    """

    name = "fake-echo"
    model = "fake-echo"

    def __init__(self, tool: str = "get_daily_usage") -> None:
        self.tool = tool
        self.last_usage = TokenUsage()
        self.saw_result: str | None = None

    async def converse(
        self, *, system, messages, tools=None, max_tokens=2000, temperature=0.3
    ):
        results = [m for m in messages if m["role"] == "tool"]
        if not results:
            yield TurnComplete(
                text="",
                tool_calls=(ToolCall(id="echo-0", name=self.tool, arguments={}),),
                usage=TokenUsage(50, 10),
            )
            return

        payload = results[-1]["content"]
        self.saw_result = str(payload)[:200]
        totals = payload.get("totals") or {}
        figure = totals.get("total_import_kwh") or totals.get("mean_daily_kwh")
        text = (
            f"You used {figure} kWh over that period, and most of it is a steady "
            f"overnight draw rather than anything you switched on."
            if figure is not None
            else "I could not read your usage for that period, so I would rather not guess."
        )
        yield TextDelta(text)
        yield TurnComplete(text=text, tool_calls=(), usage=TokenUsage(300, 60))

    async def narrate(self, *, system, user, max_tokens=300, temperature=0.2):
        yield ""

    async def health(self) -> bool:
        return True


class DeadProvider:
    """Never answers. Every call raises, on every round."""

    name = "dead"
    model = "dead"
    last_usage = TokenUsage()

    async def converse(self, **_kwargs):
        raise RuntimeError("model unreachable")
        yield  # pragma: no cover - unreachable, makes this an async generator

    async def narrate(self, **_kwargs):
        raise RuntimeError("model unreachable")
        yield  # pragma: no cover

    async def health(self) -> bool:
        return False
