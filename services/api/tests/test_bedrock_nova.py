"""Nova transport preserves the agent's tool history and streamed answer contract."""

from __future__ import annotations

import pytest

from app.providers.base import TextDelta, ToolCall, TurnComplete
from app.providers.bedrock_nova import BedrockNovaProvider, _wire
from app.providers.resolver import build_provider


def test_resolver_selects_nova_only_for_nova_model():
    provider = build_provider(
        "bedrock",
        bedrock_model="amazon.nova-lite-v1:0",
        aws_region="ap-southeast-2",
        ollama_model="unused",
        ollama_url="http://localhost:11434",
        gcp_model="unused",
    )
    assert isinstance(provider, BedrockNovaProvider)
    assert provider.model == "amazon.nova-lite-v1:0"


def test_tool_history_round_trips_without_mutating_messages():
    call = ToolCall("tool-1", "read_bill", {"period": "July"})
    original = [
        {"role": "user", "content": "What changed?"},
        {"role": "assistant", "content": "", "tool_calls": [call]},
        {"role": "tool", "tool_call_id": "tool-1", "content": {"kwh": 42}},
    ]
    result = _wire(original)
    assert result[1]["content"][0]["toolUse"]["toolUseId"] == "tool-1"
    assert result[2]["content"][0]["toolResult"]["toolUseId"] == "tool-1"
    assert original[1]["tool_calls"][0] is call


class FakeRuntime:
    def __init__(self, events):
        self.events = events
        self.request = None

    def converse_stream(self, **request):
        self.request = request
        return {"stream": iter(self.events)}


async def test_streamed_text_and_tool_use_preserve_usage():
    client = FakeRuntime(
        [
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Checking "}}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "usage."}}},
            {
                "contentBlockStart": {
                    "contentBlockIndex": 1,
                    "start": {"toolUse": {"toolUseId": "id-7", "name": "read_usage"}},
                }
            },
            {
                "contentBlockDelta": {
                    "contentBlockIndex": 1,
                    "delta": {"toolUse": {"input": '{"month":'}},
                }
            },
            {
                "contentBlockDelta": {
                    "contentBlockIndex": 1,
                    "delta": {"toolUse": {"input": '"July"}'}},
                }
            },
            {"contentBlockStop": {"contentBlockIndex": 1}},
            {"messageStop": {"stopReason": "tool_use"}},
            {"metadata": {"usage": {"inputTokens": 8, "outputTokens": 5}}},
        ]
    )
    provider = BedrockNovaProvider("amazon.nova-lite-v1:0")
    provider._client = client
    events = [
        event
        async for event in provider.converse(
            system="Read facts before answering",
            messages=[{"role": "user", "content": "What changed?"}],
            tools=[
                {
                    "name": "read_usage",
                    "description": "Read usage",
                    "input_schema": {"type": "object", "properties": {"month": {"type": "string"}}},
                }
            ],
        )
    ]
    assert [event.text for event in events if isinstance(event, TextDelta)] == [
        "Checking ",
        "usage.",
    ]
    end = events[-1]
    assert isinstance(end, TurnComplete)
    assert end.text == "Checking usage."
    assert end.tool_calls == (ToolCall("id-7", "read_usage", {"month": "July"}),)
    assert end.usage.total == 13
    assert client.request["modelId"] == "amazon.nova-lite-v1:0"
    assert client.request["toolConfig"]["tools"][0]["toolSpec"]["name"] == "read_usage"


async def test_plain_narration_uses_the_same_verified_stream():
    client = FakeRuntime(
        [
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Hello"}}},
            {"messageStop": {"stopReason": "end_turn"}},
        ]
    )
    provider = BedrockNovaProvider("amazon.nova-lite-v1:0")
    provider._client = client
    assert [part async for part in provider.narrate(system="Greet", user="Hi")] == ["Hello"]
    assert "toolConfig" not in client.request


@pytest.mark.parametrize("stop_reason", [None, "max_tokens", "guardrail_intervened"])
async def test_incomplete_response_never_reports_success(stop_reason):
    events = [{"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Partial"}}}]
    if stop_reason:
        events.append({"messageStop": {"stopReason": stop_reason}})
    provider = BedrockNovaProvider("amazon.nova-lite-v1:0")
    provider._client = FakeRuntime(events)
    with pytest.raises(RuntimeError, match="did not complete"):
        async for event in provider.converse(
            system="Test", messages=[{"role": "user", "content": "Hi"}]
        ):
            assert not isinstance(event, TurnComplete)


def test_tool_free_round_carries_tool_history_as_text():
    # Converse rejects toolUse/toolResult blocks without a toolConfig, which the
    # agent's final round never sends.
    call = ToolCall("tool-1", "read_bill", {"period": "July"})
    result = _wire(
        [
            {"role": "user", "content": "What changed?"},
            {"role": "assistant", "content": "", "tool_calls": [call]},
            {
                "role": "tool",
                "tool_call_id": "tool-1",
                "name": "read_bill",
                "content": {"kwh": 42},
            },
        ],
        tools_offered=False,
    )
    blocks = [block for message in result for block in message["content"]]
    assert all(set(block) == {"text"} for block in blocks)
    assert [message["role"] for message in result] == ["user", "assistant", "user"]
    assert "read_bill" in result[1]["content"][0]["text"]
    assert '"kwh":42' in result[2]["content"][0]["text"]


async def test_tool_free_request_sends_no_tool_blocks():
    client = FakeRuntime(
        [
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Done"}}},
            {"messageStop": {"stopReason": "end_turn"}},
        ]
    )
    provider = BedrockNovaProvider("amazon.nova-pro-v1:0")
    provider._client = client
    call = ToolCall("tool-1", "read_bill", {})
    messages = [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "", "tool_calls": [call]},
        {"role": "tool", "tool_call_id": "tool-1", "name": "read_bill", "content": {}},
    ]
    async for _ in provider.converse(system="Test", messages=messages, tools=None):
        pass
    assert "toolConfig" not in client.request
    assert "toolUse" not in str(client.request["messages"])


async def test_inline_thinking_is_hidden_even_when_tags_split_across_deltas():
    pieces = ["<thinking", ">", " I should", " check.", " </think", "ing>", "\n\n", "The ", "plan."]
    client = FakeRuntime(
        [
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": piece}}}
            for piece in pieces
        ]
        + [{"messageStop": {"stopReason": "end_turn"}}]
    )
    provider = BedrockNovaProvider("amazon.nova-pro-v1:0")
    provider._client = client
    events = [
        event
        async for event in provider.converse(
            system="Test", messages=[{"role": "user", "content": "Which plan?"}]
        )
    ]
    streamed = "".join(event.text for event in events if isinstance(event, TextDelta))
    assert streamed == "The plan."
    assert events[-1].text == "The plan."


async def test_text_that_merely_looks_like_a_tag_is_kept():
    client = FakeRuntime(
        [
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Usage <"}}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": " 5 kWh"}}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": " <thin"}}},
            {"messageStop": {"stopReason": "end_turn"}},
        ]
    )
    provider = BedrockNovaProvider("amazon.nova-pro-v1:0")
    provider._client = client
    events = [
        event
        async for event in provider.converse(
            system="Test", messages=[{"role": "user", "content": "Hi"}]
        )
    ]
    assert events[-1].text == "Usage < 5 kWh <thin"
