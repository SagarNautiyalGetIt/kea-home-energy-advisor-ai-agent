"""Sydney-local Bedrock Converse transport for Amazon Nova models.

The agent's neutral history and verification remain unchanged. Only the wire
format differs from the Anthropic Bedrock SDK transport.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from app.providers.base import TextDelta, TokenUsage, ToolCall, TurnComplete, TurnEvent

log = logging.getLogger(__name__)
_END = object()


def _next_event(stream: Any) -> Any:
    # StopIteration cannot be raised through asyncio.to_thread's Future.
    return next(stream, _END)


def _wire(messages: list[dict[str, Any]], *, tools_offered: bool = True) -> list[dict[str, Any]]:
    """Translate the neutral history into Converse messages.

    Converse rejects toolUse and toolResult blocks in a request without a toolConfig,
    and the agent's final round offers no tools. On that round the earlier calls and
    results travel as plain text, so the model still sees what it looked up.
    """
    from app.agent.loop import tool_result_to_text

    out: list[dict[str, Any]] = []
    merging_results = False
    for message in messages:
        role = message["role"]
        if role == "tool":
            text = tool_result_to_text(message["content"])
            if tools_offered:
                result = {
                    "toolResult": {
                        "toolUseId": message["tool_call_id"],
                        "content": [{"text": text}],
                    }
                }
            else:
                result = {"text": f"Result of {message.get('name', 'tool')}: {text}"}
            if merging_results:
                out[-1]["content"].append(result)
            else:
                out.append({"role": "user", "content": [result]})
                merging_results = True
            continue

        merging_results = False
        blocks: list[dict[str, Any]] = []
        if message.get("content"):
            blocks.append({"text": str(message["content"])})
        if role == "assistant":
            for call in message.get("tool_calls", ()):
                if tools_offered:
                    blocks.append(
                        {
                            "toolUse": {
                                "toolUseId": call.id,
                                "name": call.name,
                                "input": call.arguments,
                            }
                        }
                    )
                else:
                    arguments = json.dumps(call.arguments, default=str)
                    blocks.append({"text": f"Called {call.name} with {arguments}"})
        if blocks:
            out.append({"role": role, "content": blocks})
    return out


_OPEN = "<thinking>"
_CLOSE = "</thinking>"


def _partial_tag(text: str, tag: str) -> int:
    """Length of the longest end of `text` that could be the start of `tag`."""
    for size in range(min(len(tag) - 1, len(text)), 0, -1):
        if text.endswith(tag[:size]):
            return size
    return 0


class _ThinkingFilter:
    """Drop the `<thinking>…</thinking>` reasoning Nova writes inline before an answer.

    Nova emits it as ordinary text whenever tools are offered, so without this the
    customer reads the model talking to itself. Tags arrive split across deltas
    ("<thinking", ">"), so a possible partial tag is held back until the next delta
    settles it.
    """

    def __init__(self) -> None:
        self.buffer = ""
        self.inside = False
        self.after_close = False

    def feed(self, text: str) -> str:
        self.buffer += text
        visible: list[str] = []
        while True:
            if self.inside:
                end = self.buffer.find(_CLOSE)
                if end < 0:
                    self.buffer = self.buffer[-(len(_CLOSE) - 1) :]
                    break
                self.buffer = self.buffer[end + len(_CLOSE) :]
                self.inside = False
                self.after_close = True
                continue
            if self.after_close:
                # The answer follows the closing tag after a blank line.
                self.buffer = self.buffer.lstrip()
                if not self.buffer:
                    break
                self.after_close = False
            start = self.buffer.find(_OPEN)
            if start >= 0:
                visible.append(self.buffer[:start])
                self.buffer = self.buffer[start + len(_OPEN) :]
                self.inside = True
                continue
            held = _partial_tag(self.buffer, _OPEN)
            visible.append(self.buffer[: len(self.buffer) - held])
            self.buffer = self.buffer[len(self.buffer) - held :]
            break
        return "".join(visible)

    def flush(self) -> str:
        # Unclosed reasoning is still reasoning, not answer text.
        text = "" if self.inside else self.buffer
        self.buffer = ""
        return text


class BedrockNovaProvider:
    name = "bedrock"

    def __init__(self, model: str, aws_region: str = "ap-southeast-2") -> None:
        if not model.startswith("amazon.nova-"):
            raise ValueError("Nova provider requires an amazon.nova-* model")
        if aws_region != "ap-southeast-2":
            raise ValueError("This deployment requires Sydney-local Bedrock inference")
        self.model = model
        self.aws_region = aws_region
        self.last_usage = TokenUsage()
        self._client: Any = None

    def _runtime(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.client(
                "bedrock-runtime",
                region_name=self.aws_region,
                config=Config(connect_timeout=10, read_timeout=300),
            )
        return self._client

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 300,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        async for event in self.converse(
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=max_tokens,
            temperature=temperature,
        ):
            if isinstance(event, TextDelta):
                yield event.text

    async def converse(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> AsyncIterator[TurnEvent]:
        self.last_usage = TokenUsage()
        request: dict[str, Any] = {
            "modelId": self.model,
            "system": [{"text": system}],
            "messages": _wire(messages, tools_offered=bool(tools)),
            "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
        }
        if tools:
            request["toolConfig"] = {
                "tools": [
                    {
                        "toolSpec": {
                            "name": tool["name"],
                            "description": tool["description"],
                            "inputSchema": {"json": tool["input_schema"]},
                        }
                    }
                    for tool in tools
                ]
            }

        response = await asyncio.to_thread(self._runtime().converse_stream, **request)
        event_stream = response["stream"]
        stream = iter(event_stream)
        text_parts: list[str] = []
        thinking = _ThinkingFilter()
        pending: dict[int, dict[str, str]] = {}
        completed: list[ToolCall] = []

        stop_reason = None
        try:
            while (event := await asyncio.to_thread(_next_event, stream)) is not _END:
                if "contentBlockStart" in event:
                    block = event["contentBlockStart"]
                    if "toolUse" in block["start"]:
                        tool = block["start"]["toolUse"]
                        pending[block["contentBlockIndex"]] = {
                            "id": tool["toolUseId"],
                            "name": tool["name"],
                            "input": "",
                        }
                elif "contentBlockDelta" in event:
                    block = event["contentBlockDelta"]
                    delta = block["delta"]
                    if "text" in delta and (visible := thinking.feed(delta["text"])):
                        text_parts.append(visible)
                        yield TextDelta(visible)
                    if "toolUse" in delta:
                        pending[block["contentBlockIndex"]]["input"] += delta["toolUse"].get(
                            "input", ""
                        )
                elif "contentBlockStop" in event:
                    index = event["contentBlockStop"]["contentBlockIndex"]
                    if index in pending:
                        tool = pending.pop(index)
                        arguments = json.loads(tool["input"] or "{}")
                        if not isinstance(arguments, dict):
                            raise ValueError("Nova tool input must be a JSON object")
                        completed.append(ToolCall(tool["id"], tool["name"], arguments))
                elif "messageStop" in event:
                    stop_reason = event["messageStop"]["stopReason"]
                elif "metadata" in event and "usage" in event["metadata"]:
                    usage = event["metadata"]["usage"]
                    self.last_usage = TokenUsage(
                        prompt_tokens=usage.get("inputTokens", 0),
                        completion_tokens=usage.get("outputTokens", 0),
                    )
                elif any(
                    key in event
                    for key in (
                        "internalServerException",
                        "modelStreamErrorException",
                        "validationException",
                        "throttlingException",
                    )
                ):
                    raise RuntimeError("Bedrock Nova streaming request failed")
            if tail := thinking.flush():
                text_parts.append(tail)
                yield TextDelta(tail)

        finally:
            close = getattr(event_stream, "close", None)
            if close is not None:
                await asyncio.to_thread(close)

        if stop_reason not in {"end_turn", "tool_use"}:
            raise RuntimeError("Bedrock Nova did not complete its response")
        if pending:
            raise RuntimeError("Bedrock Nova stream ended with incomplete tool input")
        yield TurnComplete("".join(text_parts), tuple(completed), self.last_usage)

    async def health(self) -> bool:
        try:
            await asyncio.to_thread(
                self._runtime().converse,
                modelId=self.model,
                messages=[{"role": "user", "content": [{"text": "Reply OK"}]}],
                inferenceConfig={"maxTokens": 4, "temperature": 0},
            )
        except Exception as exc:  # noqa: BLE001 - health must not raise
            log.warning("Bedrock Nova health check failed: %s", exc)
            return False
        return True
