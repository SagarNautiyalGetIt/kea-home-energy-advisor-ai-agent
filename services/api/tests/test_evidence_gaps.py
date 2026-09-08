"""Failure modes that report success, pinned so they cannot come back.

This repository's recurring defect is not a crash — it is a system that degrades and
still looks fine. A recorder that dropped nine of fourteen accounts while `/health` said
`recording: database`. A `.env` nothing read. A `_citation` method referenced and never
written, so every evidence write raised, was caught, was logged, and was swallowed while
the tables stayed empty.

The agent adds one more shape of it, and it is the worst one available: a model that
cannot reach the data but answers anyway. A fluent paragraph about a bill nobody looked
up is indistinguishable from a good answer until somebody checks the figures, which is
the one thing a customer cannot do. So the tests below draw the line in both directions —
a dead model must produce no answer at all, and a dead *tool* must not stop the turn,
because those two need opposite handling and conflating them costs either honesty or
robustness.
"""

from __future__ import annotations

import pytest
from fakes import DeadProvider, EchoProvider, ScriptedProvider

from app.agent.loop import AgentUnavailable, ToolInvocation, answer_once
from app.db.recorder import DatabaseRecorder, TurnRecord
from app.pipeline import build_context


def _record(tools: list[ToolInvocation], **kwargs) -> TurnRecord:
    return TurnRecord(
        customer_ref="H-JUL",
        conversation_id=None,
        question="Why is my bill so high?",
        answer="Your standing load is 7.1 kWh a day.",
        tools=tools,
        escalate=False,
        **kwargs,
    )


def _ok(name: str = "get_daily_usage", source: str = "meter data") -> ToolInvocation:
    return ToolInvocation(name=name, arguments={}, result={"available": True, "source": source})


# ---------- the transparency panel ----------


def test_the_recorder_can_build_a_citation() -> None:
    """`DatabaseRecorder._citation` was once referenced and never written, so every
    evidence write raised AttributeError — caught, logged, and swallowed. The tables
    stayed empty while `/health` cheerfully reported `recording: database`."""
    citation = DatabaseRecorder._citation(
        _record([_ok("get_account_summary", "kea.mart_account_context"), _ok()])
    )

    assert citation is not None
    assert citation["household"] == "H-JUL"
    assert citation["tools"] == ["get_account_summary", "get_daily_usage"]
    assert citation["sources"], "a citation naming no source cites nothing"


def test_the_citation_carries_sources_but_never_values() -> None:
    """`agent_tool_call` is the full receipt; this is the panel the customer sees.
    Duplicating the figures here means two places to keep correct."""
    citation = DatabaseRecorder._citation(_record([_ok()]))

    assert set(citation) == {"household", "tools", "sources", "basis"}
    assert all(isinstance(s, str) for s in citation["sources"])


def test_a_turn_that_looked_nothing_up_cites_nothing_rather_than_empty() -> None:
    """A greeting or a straight handoff consults no data. `{}` renders as a transparency
    panel asserting we cited nothing; None renders as no panel."""
    assert DatabaseRecorder._citation(_record([])) is None


def test_a_failed_lookup_is_not_cited_as_a_source() -> None:
    """The panel says what backed the answer. A lookup that errored backed nothing, and
    listing it would turn a gap into apparent evidence."""
    broken = ToolInvocation(
        name="get_bill_comparison", arguments={}, result={"error": "mart unreachable"}
    )
    assert DatabaseRecorder._citation(_record([broken])) is None
    assert DatabaseRecorder._citation(_record([broken, _ok()]))["tools"] == ["get_daily_usage"]


# ---------- a dead model must not produce an answer ----------


async def test_an_unreachable_model_raises_rather_than_inventing_prose() -> None:
    """The distinction the whole evidence claim turns on.

    The old architecture served a template here, and that was correct *for it*: the model
    was formatting figures Python had already computed, so a deterministic renderer of
    the same figures was a genuine substitute. There is no equivalent now — the answer
    was going to be reasoning over data the model reads itself, and nothing stands in for
    that. A day the provider was down must surface as no answers, never as answers with
    no data behind them.
    """
    ctx = await build_context("H-JUL")

    with pytest.raises(AgentUnavailable):
        await answer_once(DeadProvider(), ctx, "why is my bill high?")


async def test_the_stream_says_so_instead_of_half_answering() -> None:
    """The transport turns that into a message, and the message does not pretend."""
    import app.pipeline as pipeline
    from app.config import get_provider
    from app.pipeline import answer_stream

    original = pipeline.get_provider
    pipeline.get_provider = lambda: DeadProvider()
    try:
        events = [name async for name, _ in answer_stream("H-JUL", "why is my bill high?")]
    finally:
        pipeline.get_provider = original
        get_provider.cache_clear()

    assert events == ["error"], f"expected only an error frame, got {events}"


# ---------- a dead tool must NOT stop the turn ----------


async def test_a_failing_tool_returns_a_result_the_model_can_route_around() -> None:
    """Opposite policy to the one above, deliberately.

    Most questions have more than one path through the data — a bill comparison that
    cannot be read does not stop the daily series from answering "was it the cold snap".
    Raising here would turn one unavailable mart into a failed conversation.
    """
    from app.agent.tools import dispatch

    ctx = await build_context("H-JUL")
    result = await dispatch(ctx, "get_daily_usage", {"start_date": "not-a-date-at-all"})

    assert "error" not in result, "a bad date is a narrower window, not a failure"

    unknown = await dispatch(ctx, "get_the_customers_horoscope", {})
    assert "error" in unknown
    assert "available_tools" in unknown, "the model must be told what it can call instead"

    bad_args = await dispatch(ctx, "get_daily_usage", {"nonexistent_parameter": 3})
    assert "error" in bad_args
    assert "hint" in bad_args, "an error with no correction is one the model repeats"


async def test_the_turn_completes_when_a_tool_is_unavailable() -> None:
    """H-JUL has no billing history, so `get_bill_comparison` reports unavailable. That
    must produce an answer about what IS known, not a handoff."""
    ctx = await build_context("H-JUL")
    provider = ScriptedProvider(
        rounds=[[("get_bill_comparison", {})], [("get_daily_usage", {})]],
        answer="I can't see a previous bill for this account, but here is what the meter shows.",
    )

    result = await answer_once(provider, ctx, "why is my bill higher than last month?")

    assert result.text
    assert [t.name for t in result.tools_used] == ["get_bill_comparison", "get_daily_usage"]
    assert result.tools_used[0].unavailable
    assert not result.tools_used[0].failed, "unavailable data is not a broken tool"


# ---------- the tool result actually reaches the model ----------


async def test_a_tool_result_reaches_the_next_round() -> None:
    """The failure a fully scripted double cannot catch: tools dispatching into a void.

    Every event would look right — the trace records the call, the panel cites the
    source — while the model wrote its answer from the system prompt alone.
    """
    ctx = await build_context("H-JUL")
    provider = EchoProvider()

    result = await answer_once(provider, ctx, "how much did I use?")

    assert provider.saw_result, "the model was never handed the tool result"
    assert "300.0 kWh" in result.text, (
        f"the answer did not quote the figure the tool returned: {result.text!r}"
    )


async def test_the_final_round_is_offered_no_tools() -> None:
    """A model that has spent every round fetching has everything it is going to get.
    Offering the catalogue again invites another lookup instead of a reply."""
    from app.agent.loop import MAX_ROUNDS

    ctx = await build_context("H-JUL")
    # One more fetch round than the loop allows, so it is still asking when the cap hits.
    provider = ScriptedProvider(rounds=[[("get_daily_usage", {})]] * (MAX_ROUNDS + 2))

    result = await answer_once(provider, ctx, "why is my bill high?")

    assert result.text, "hitting the round cap must still produce an answer"
    assert result.hit_round_limit
    offered = [call["tools"] is not None for call in provider.calls]
    assert offered[-1] is False, "the last round must be answered without tools"
    assert all(offered[:-1]), "every earlier round should have had the catalogue"
