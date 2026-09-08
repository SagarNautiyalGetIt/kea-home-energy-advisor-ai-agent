"""The deployment provider — Claude on Amazon Bedrock.

This is now the default. Sprint 2 ran a local model because there was no cloud account
and the demo had to work on a laptop; that is no longer the constraint, and a 4B model
sized to whatever hardware happens to be present is the wrong thing to build a product
on. `app/providers/ollama.py` remains, for local development and as the *server's* last
resort — see `resolver.py` for the narrow circumstances in which it is chosen and why
that choice is always disclosed.

**On-device models are a separate story and not this file.** A farmer with no
connectivity cannot reach this API at all, so a server-side fallback does nothing for
them. That case is handled by `app/offline.py`, which ships pre-computed fact bundles to
the phone while it still has a connection, and by an on-device model that narrates them
later. See `docs/adr/0008-offline-first-narration.md`.

## Things that will bite whoever changes this

* Model ids on Bedrock carry an `anthropic.` prefix — `anthropic.claude-sonnet-5`. A
  first-party id (`claude-sonnet-5`) returns 400 with a message that does not obviously
  say why.
* Model access is opt-in **per account and per region**. Enable it in the Bedrock console
  before the first call, and check what is actually served in `ap-southeast-2` (Sydney) —
  NZ data residency is a pitch point and regional availability varies. A model that works
  in `us-east-1` and not in Sydney is the failure to expect.
* Prompt caching works on Bedrock, but *automatic* caching does not — breakpoints go in
  by hand. The system prompt is stable across every customer and the facts are not, so
  the breakpoint sits between them. That is both the cache boundary and the privacy
  boundary, and they coincide on purpose: nothing customer-specific is ever inside a
  cached prefix that another customer's request could share.
* Do not disable thinking outright on Sonnet 5. Set a low effort instead.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from app.providers.base import (
    TextDelta,
    TokenUsage,
    ToolCall,
    TurnComplete,
    TurnEvent,
)

log = logging.getLogger(__name__)

#: Only `narrate()` uses this now — the offline pack builder and the warm-up path, both
#: of which really do want three sentences. The agent sets its own ceiling; see
#: `app/agent/loop.py`, where the old 300-token cap is discussed as one of the reasons
#: every answer read like a headline with no reasoning under it.
DEFAULT_MAX_TOKENS = 300


class BedrockProvider:
    """Streams narration from Claude on Bedrock.

    The client is built lazily and once. Constructing it at import time makes every test
    that touches `config` require AWS credentials, and building one per request opens a
    fresh TLS connection for each chat turn.
    """

    name = "bedrock"

    def __init__(
        self,
        model: str = "anthropic.claude-sonnet-5",
        aws_region: str = "ap-southeast-2",
    ) -> None:
        self.model = model
        self.aws_region = aws_region
        self.last_usage = TokenUsage()
        self._client = None

    def _anthropic(self):
        if self._client is None:
            # Imported here rather than at module scope so the package is only required
            # when this provider is actually selected. A local-only checkout should not
            # need the AWS SDK installed to run the test suite.
            from anthropic import AsyncAnthropicBedrock

            self._client = AsyncAnthropicBedrock(aws_region=self.aws_region)
        return self._client

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        """Yield text chunks as they are generated.

        The cache breakpoint goes on the system block and nowhere else. Everything before
        it is identical for every customer; everything after it is that customer's facts.
        Moving the breakpoint past the facts would cache one household's figures into a
        prefix another household's request could hit.
        """
        client = self._anthropic()
        self.last_usage = TokenUsage()

        async with client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=[
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user}],
        ) as stream:
            async for chunk in stream.text_stream:
                yield chunk

            final = await stream.get_final_message()
            usage = getattr(final, "usage", None)
            if usage is not None:
                # Cache reads are billed at a fraction of input tokens but they are still
                # input tokens, and the cost projection in the pitch is measured from
                # this counter. Dropping them understates what a real deployment costs.
                self.last_usage = TokenUsage(
                    prompt_tokens=(
                        getattr(usage, "input_tokens", 0)
                        + getattr(usage, "cache_read_input_tokens", 0)
                        + getattr(usage, "cache_creation_input_tokens", 0)
                    ),
                    completion_tokens=getattr(usage, "output_tokens", 0),
                )

    # ---- tool-using conversation ------------------------------------------------

    @staticmethod
    def _wire(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Neutral history -> Anthropic content blocks.

        The shape that surprises people: a tool *result* is a `user` message, not a
        `tool` one. Anthropic models the exchange as the assistant asking and the caller
        answering, so results ride in a user turn carrying `tool_result` blocks. Sending
        them with `role: "tool"` is a 400 that does not obviously say why.

        Consecutive tool results are merged into a single user turn. The API rejects two
        adjacent messages with the same role, and the agent loop appends one message per
        call, so a round where the model asked for two tools at once would otherwise fail
        on the next request rather than at the point the mistake was made.
        """
        from app.agent.loop import tool_result_to_text

        out: list[dict[str, Any]] = []
        for message in messages:
            role = message["role"]

            if role == "tool":
                block = {
                    "type": "tool_result",
                    "tool_use_id": message["tool_call_id"],
                    "content": tool_result_to_text(message["content"]),
                }
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                    out[-1]["content"].append(block)
                else:
                    out.append({"role": "user", "content": [block]})
                continue

            if role == "assistant" and message.get("tool_calls"):
                blocks: list[dict[str, Any]] = []
                if message.get("content"):
                    blocks.append({"type": "text", "text": message["content"]})
                blocks += [
                    {
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": call.arguments,
                    }
                    for call in message["tool_calls"]
                ]
                out.append({"role": "assistant", "content": blocks})
                continue

            out.append({"role": role, "content": message["content"]})
        return out

    async def converse(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> AsyncIterator[TurnEvent]:
        """One turn, streamed, with tools.

        The cache breakpoint stays on the system block and nowhere else — see `narrate`.
        The tool catalogue is stable across every customer too, so it sits inside the
        cached prefix; the messages, which are not, sit outside it.
        """
        client = self._anthropic()
        self.last_usage = TokenUsage()

        request: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
            ],
            "messages": self._wire(messages),
        }
        if tools:
            request["tools"] = [
                {
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["input_schema"],
                }
                for t in tools
            ]

        async with client.messages.stream(**request) as stream:
            async for chunk in stream.text_stream:
                yield TextDelta(chunk)

            final = await stream.get_final_message()

        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for block in final.content:
            kind = getattr(block, "type", None)
            if kind == "text":
                text_parts.append(block.text)
            elif kind == "tool_use":
                calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        arguments=dict(block.input or {}),
                    )
                )

        usage = getattr(final, "usage", None)
        if usage is not None:
            # Cache reads are billed at a fraction of input tokens but they are still
            # input tokens, and the cost projection in the pitch is measured from this
            # counter. Dropping them understates what a real deployment costs.
            self.last_usage = TokenUsage(
                prompt_tokens=(
                    getattr(usage, "input_tokens", 0)
                    + getattr(usage, "cache_read_input_tokens", 0)
                    + getattr(usage, "cache_creation_input_tokens", 0)
                ),
                completion_tokens=getattr(usage, "output_tokens", 0),
            )

        yield TurnComplete(
            text="".join(text_parts),
            tool_calls=tuple(calls),
            usage=self.last_usage,
        )

    async def health(self) -> bool:
        """One-token round trip. Used for the UI ready-state and by the resolver.

        A real call rather than a credential check: valid credentials with no model access
        in this region is the most likely misconfiguration, and it only shows up when
        something is actually invoked.
        """
        try:
            client = self._anthropic()
            await client.messages.create(
                model=self.model,
                max_tokens=1,
                messages=[{"role": "user", "content": "ok"}],
            )
        except Exception as exc:  # noqa: BLE001 - health must never raise
            log.warning("bedrock health check failed: %s", exc)
            return False
        return True
