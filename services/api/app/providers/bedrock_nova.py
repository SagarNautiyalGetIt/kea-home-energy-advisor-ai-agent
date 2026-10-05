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


def _wire(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from app.agent.loop import tool_result_to_text

    out: list[dict[str, Any]] = []
    for message in messages:
        role = message["role"]
        if role == "tool":
            result = {
                "toolResult": {
                    "toolUseId": message["tool_call_id"],
                    "content": [{"text": tool_result_to_text(message["content"])}],
                }
            }
            if (
                out
                and out[-1]["role"] == "user"
                and any("toolResult" in block for block in out[-1]["content"])
            ):
                out[-1]["content"].append(result)
            else:
                out.append({"role": "user", "content": [result]})
            continue

        blocks: list[dict[str, Any]] = []
        if message.get("content"):
            blocks.append({"text": str(message["content"])})
        if role == "assistant":
            blocks.extend(
                {
                    "toolUse": {
                        "toolUseId": call.id,
                        "name": call.name,
                        "input": call.arguments,
                    }
                }
                for call in message.get("tool_calls", ())
            )
        if blocks:
            out.append({"role": role, "content": blocks})
    return out


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
            "messages": _wire(messages),
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
                    if "text" in delta:
                        text_parts.append(delta["text"])
                        yield TextDelta(delta["text"])
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
