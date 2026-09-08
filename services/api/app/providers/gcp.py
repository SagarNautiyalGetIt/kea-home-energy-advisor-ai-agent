"""The default provider — Gemini on Google Cloud / Google AI, via `google-genai`.

## Two shapes that differ from every other provider here

**Roles are `user` and `model`, not `user` and `assistant`.** Sending `assistant` is
rejected, and the message is not obviously about the role name.

**A function response is a `user` turn.** Gemini models the exchange the same way
Anthropic does — the model asks, the caller answers — so results ride back in a user
Content carrying `function_response` parts rather than in a role of their own.

One more trap worth knowing before editing: a `FunctionDeclaration` whose `parameters`
declare an empty `properties` object is rejected. Several of our tools genuinely take no
arguments, so `_declaration` omits `parameters` entirely rather than sending `{}`.
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

DEFAULT_MAX_TOKENS = 300


class GCPProvider:
    """Streams from Gemini using google-genai.

    The client is built lazily and once so that importing this module doesn't mandate the
    google-genai dependency for local development environments that only use ollama.
    """

    name = "gcp"

    def __init__(self, model: str = "gemini-2.5-flash") -> None:
        self.model = model
        self.last_usage = TokenUsage()
        self._client = None

    def _genai(self):
        if self._client is None:
            # Imported here rather than at module scope so the package is only required
            # when this provider is actually selected.
            from google import genai

            # ADC handles credentials.
            self._client = genai.Client()
        return self._client

    def _record_usage(self, metadata: object) -> None:
        if metadata is None:
            return
        self.last_usage = TokenUsage(
            prompt_tokens=getattr(metadata, "prompt_token_count", 0) or 0,
            completion_tokens=getattr(metadata, "candidates_token_count", 0) or 0,
        )

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        """Yield text chunks as they are generated. No tools, no history."""
        client = self._genai()
        self.last_usage = TokenUsage()

        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=temperature,
        )

        response_stream = await client.aio.models.generate_content_stream(
            model=self.model,
            contents=user,
            config=config,
        )

        async for chunk in response_stream:
            if chunk.text:
                yield chunk.text
            if chunk.usage_metadata:
                self._record_usage(chunk.usage_metadata)

    # ---- tool-using conversation ------------------------------------------------

    @staticmethod
    def _declaration(tool: dict[str, Any]):
        from google.genai import types

        schema = tool.get("input_schema") or {}
        properties = schema.get("properties") or {}
        # Omitted, not empty. Gemini rejects a declaration carrying `properties: {}`,
        # and several tools here genuinely take no arguments.
        parameters = (
            types.Schema(
                type="OBJECT",
                properties={
                    name: types.Schema(
                        type=str(spec.get("type", "string")).upper(),
                        description=spec.get("description"),
                    )
                    for name, spec in properties.items()
                },
                required=list(schema.get("required") or []),
            )
            if properties
            else None
        )
        return types.FunctionDeclaration(
            name=tool["name"],
            description=tool["description"],
            parameters=parameters,
        )

    @staticmethod
    def _wire(messages: list[dict[str, Any]]):
        """Neutral history -> Gemini `Content` list."""
        from google.genai import types

        out = []
        for message in messages:
            role = message["role"]

            if role == "tool":
                part = types.Part.from_function_response(
                    name=message["name"],
                    # The SDK requires a dict here, not a string. Wrapping keeps a
                    # top-level list result (which a tool could legitimately return)
                    # from failing validation.
                    response={"result": message["content"]},
                )
                if out and out[-1].role == "user":
                    out[-1].parts.append(part)
                else:
                    out.append(types.Content(role="user", parts=[part]))
                continue

            if role == "assistant":
                parts = []
                if message.get("content"):
                    parts.append(types.Part.from_text(text=message["content"]))
                parts += [
                    types.Part.from_function_call(name=call.name, args=call.arguments)
                    for call in message.get("tool_calls") or []
                ]
                if parts:
                    out.append(types.Content(role="model", parts=parts))
                continue

            out.append(
                types.Content(
                    role="user", parts=[types.Part.from_text(text=message["content"])]
                )
            )
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
        client = self._genai()
        self.last_usage = TokenUsage()

        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=temperature,
            tools=(
                [types.Tool(function_declarations=[self._declaration(t) for t in tools])]
                if tools
                else None
            ),
            # Manual function calling. Without this the SDK will run resolvable functions
            # itself, which would take the loop — and the tool trace the transparency
            # panel is built from — out of our hands.
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

        text_parts: list[str] = []
        calls: list[ToolCall] = []

        stream = await client.aio.models.generate_content_stream(
            model=self.model,
            contents=self._wire(messages),
            config=config,
        )

        async for chunk in stream:
            # The parts are walked directly rather than read off `chunk.text`, which
            # warns and returns None on a chunk carrying only a function call.
            for candidate in chunk.candidates or []:
                for part in getattr(candidate.content, "parts", None) or []:
                    if getattr(part, "text", None):
                        text_parts.append(part.text)
                        yield TextDelta(part.text)
                    call = getattr(part, "function_call", None)
                    if call is not None and call.name:
                        calls.append(
                            ToolCall(
                                # Gemini correlates function responses by name rather
                                # than by id, so this is ours — it keeps the agent loop's
                                # trace keyed the same way across all three providers.
                                id=f"{call.name}-{len(calls)}",
                                name=call.name,
                                arguments=dict(call.args or {}),
                            )
                        )
            if chunk.usage_metadata:
                self._record_usage(chunk.usage_metadata)

        yield TurnComplete(
            text="".join(text_parts),
            tool_calls=tuple(calls),
            usage=self.last_usage,
        )

    async def health(self) -> bool:
        """One-token round trip. Used for the UI ready-state and by the resolver."""
        try:
            client = self._genai()
            from google.genai import types

            await client.aio.models.generate_content(
                model=self.model,
                contents="ok",
                config=types.GenerateContentConfig(max_output_tokens=1),
            )
        except Exception as exc:  # noqa: BLE001 - health must never raise
            log.warning("gcp health check failed: %s", exc)
            return False
        return True
