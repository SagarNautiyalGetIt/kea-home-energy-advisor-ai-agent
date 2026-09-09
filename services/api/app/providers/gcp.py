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

## Key rotation

The free tier is 20 requests per day and 5 per minute per model per project, which is
roughly seven to ten customer questions a day — so this provider takes a *pool* of keys
and moves to the next when one is exhausted. See `app/providers/keypool.py` for what that
is and, more importantly, what it is not.

The rotation lives here rather than in `resolver.py` because it is one provider's quota
model, not a fallback between providers. A rotation is invisible to the caller and changes
nothing about the answer; a fallback serves a different model and is reported as degraded.
Conflating the two would make a key swap look like a downgrade on `/health`.
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
from app.providers.keypool import KeyPool, is_daily_quota_error, is_quota_error

log = logging.getLogger(__name__)

DEFAULT_MAX_TOKENS = 300


class AllKeysExhausted(RuntimeError):
    """Every key in the pool is resting. Distinct from a generic provider failure so the
    log and `/health` can say "out of quota until tomorrow" rather than "unavailable" —
    only one of those is fixed by waiting a minute."""


class GCPProvider:
    """Streams from Gemini using google-genai.

    The client is built lazily and cached **per key**, so that importing this module does
    not mandate the google-genai dependency for local development environments that only
    use ollama, and so that a rotation does not rebuild a client it has already made.
    """

    name = "gcp"

    def __init__(self, model: str = "gemini-2.5-flash", keys: KeyPool | None = None) -> None:
        self.model = model
        self.last_usage = TokenUsage()
        self._clients: dict[str, object] = {}
        self._keys = keys or KeyPool()
        self._adc_client = None

    @property
    def keys(self) -> KeyPool:
        return self._keys

    def _genai(self):
        """The client for whichever key is currently in play.

        With no keys configured this falls back to Application Default Credentials, which
        is how this provider worked before the pool existed and how it works on a
        deployment using a service account. An empty pool is therefore not an error — it
        means "no explicit keys, use ADC" — and that is why `build_pool` returning nothing
        does not raise.
        """
        if not self._keys.configured:
            if self._adc_client is None:
                # Imported here rather than at module scope so the package is only
                # required when this provider is actually selected.
                from google import genai

                self._adc_client = genai.Client()
            return self._adc_client

        key = self._keys.current()
        if key is None:
            raise AllKeysExhausted(
                f"all {self._keys.configured} Gemini keys are out of quota. "
                "Add another key to GEMINI_API_KEYS, switch KEA_GCP_MODEL (the cap is per "
                "model), or use a billed key."
            )

        if key.value not in self._clients:
            from google import genai

            self._clients[key.value] = genai.Client(api_key=key.value)
        key.uses += 1
        return self._clients[key.value]

    async def _stream(self, make_stream) -> AsyncIterator[Any]:
        """Open a stream, rotating keys until one answers, then yield every chunk.

        **The first chunk is pulled inside the retry loop, and that is the whole point.**
        `generate_content_stream` returns an async iterator without issuing anything —
        google-genai defers the HTTP request until the iterator is advanced — so a quota
        refusal arrives from `anext`, not from the call that created the stream. An earlier
        version wrapped only the creating call, which meant the 429 sailed straight past
        the rotation and up to the agent loop: four keys configured, four keys available,
        and every request failing on the first one. `/health` cheerfully reported
        `keys_available: 4` throughout, which is the exact shape of silent degradation this
        repository keeps being bitten by.

        Rotation stops at the first yielded chunk, the same boundary
        `resolver.FallbackProvider` draws: once bytes are on the wire, starting again on
        another key would splice two drafts of the answer together mid-sentence.
        """
        last: BaseException | None = None
        for _ in range(max(self._keys.configured, 1)):
            client = self._genai()
            try:
                stream = await make_stream(client)
                iterator = stream.__aiter__()
                first = await anext(iterator)
            except StopAsyncIteration:
                # An empty stream is not a failure to rotate over — the model had nothing
                # to say, and the loop above turns that into its own error.
                return
            except Exception as exc:  # noqa: BLE001 - classified by `_rotate`
                last = exc
                if not self._rotate(exc):
                    raise
                continue

            yield first
            async for chunk in iterator:
                yield chunk
            return

        raise AllKeysExhausted(
            f"all {self._keys.configured} Gemini keys are out of quota"
        ) from last

    def _rotate(self, exc: BaseException) -> bool:
        """Park the key that just failed. True when another is available to retry with.

        Only quota failures rotate. A bad request, a rejected tool schema or a missing
        model fails identically on every key in the pool, and retrying it four times turns
        one clear error into four confusing ones and burns the quota this exists to
        protect.
        """
        if not is_quota_error(exc):
            return False
        key = self._keys.current()
        if key is None:
            return False
        self._keys.rest(key, daily=is_daily_quota_error(exc))
        return self._keys.current() is not None

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
        # The client is resolved per attempt inside `_stream`, not here: a rotation has
        # to hand back a DIFFERENT client, and one captured up front would pin every
        # retry to the key that just failed.
        self.last_usage = TokenUsage()

        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=temperature,
        )

        # Same rotation as `converse`. See `_stream`.
        async def open_stream(active):
            return await active.aio.models.generate_content_stream(
                model=self.model, contents=user, config=config
            )

        async for chunk in self._stream(open_stream):
            if chunk.text:
                yield chunk.text
            if chunk.usage_metadata:
                self._record_usage(chunk.usage_metadata)

    # ---- tool-using conversation ------------------------------------------------

    @staticmethod
    def _declaration(tool: dict[str, Any]):
        from google.genai import types

        def _property(spec: dict[str, Any]):
            """One parameter, translated.

            `items` is carried through rather than dropped. Gemini rejects an ARRAY
            parameter that does not declare its element type — 400 INVALID_ARGUMENT,
            "parameters.properties[turn_on].items: missing field" — and it rejects the
            whole request, so one under-specified parameter takes every tool in the
            catalogue down with it. An earlier version of this translator mapped only
            `type` and `description`, which meant a correct JSON Schema was silently made
            invalid on the way out, and the error named a field that was present in the
            source. Anthropic and Ollama both accept the array without it, so it stayed
            invisible until the provider that does not was the one serving customers.
            """
            kind = str(spec.get("type", "string")).upper()
            if kind != "ARRAY":
                return types.Schema(type=kind, description=spec.get("description"))

            # An array with no `items` in the source is a schema bug — `test_agent.py`
            # fails the build on one — but defaulting to string is still better than
            # emitting the declaration Gemini refuses, because the cost of guessing wrong
            # is one bad tool call and the cost of the refusal is every tool call.
            items = spec.get("items") or {}
            return types.Schema(
                type=kind,
                description=spec.get("description"),
                items=types.Schema(type=str(items.get("type", "string")).upper()),
            )

        schema = tool.get("input_schema") or {}
        properties = schema.get("properties") or {}
        # Omitted, not empty. Gemini rejects a declaration carrying `properties: {}`,
        # and several tools here genuinely take no arguments.
        parameters = (
            types.Schema(
                type="OBJECT",
                properties={
                    name: _property(spec) for name, spec in properties.items()
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
                for call in message.get("tool_calls") or []:
                    # The original part, not a rebuilt one. Gemini 3.x attaches a
                    # `thought_signature` to each functionCall part and rejects the next
                    # request without it — 400 INVALID_ARGUMENT, "Function call is
                    # missing a thought_signature in functionCall parts". Reconstructing
                    # from name and args drops it, which failed every tool-using turn on
                    # round two. See `ToolCall.raw`.
                    parts.append(
                        call.raw
                        if call.raw is not None
                        else types.Part.from_function_call(
                            name=call.name, args=call.arguments
                        )
                    )
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
        # The client is resolved per attempt inside `_stream`, not here: a rotation has
        # to hand back a DIFFERENT client, and one captured up front would pin every
        # retry to the key that just failed.
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

        wired = self._wire(messages)

        async def open_stream(active):
            return await active.aio.models.generate_content_stream(
                model=self.model, contents=wired, config=config
            )

        async for chunk in self._stream(open_stream):
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
                                # Kept whole so `_wire` can send it back with its
                                # thought_signature intact. See `ToolCall.raw`.
                                raw=part,
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
        """One-token round trip. Used for the UI ready-state and by the resolver.

        Deliberately does NOT rotate. A health check that burned a fresh key every time it
        was polled would spend the pool on the dashboard rather than on customers — and
        `/health` is polled. A quota refusal here is an honest "not ready right now", and
        `describe()` alongside it says why.
        """
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

    def describe_keys(self) -> dict[str, object]:
        """Pool state for `/health`. Labels and counts, never a key value."""
        if not self._keys.configured:
            return {"source": "application default credentials", "keys_configured": 0}
        return {"source": "api keys", **self._keys.describe()}
