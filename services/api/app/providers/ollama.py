"""Local development, and the server's declared last resort — a model served by Ollama.

Run Ollama NATIVELY on macOS, not in Docker. Docker Desktop on a Mac is a Linux VM
with no access to the Apple GPU, so a containerised model server silently drops to
CPU speed. If this app runs in a container, reach the host at
http://host.docker.internal:11434.

## Tool use here is real, but it is not free

`converse()` posts to `/api/chat` with a `tools` array, which Ollama supports for models
that were trained for it — `qwen3`, `llama3.1` and up, `mistral-nemo`. **`gemma3` is not
one of them**: it has no tool template, so it ignores the array and answers from the
system prompt alone. That produces a fluent reply with no data behind it, which is the
worst possible failure for this application, so `supports_tools` is checked before the
agent will use a local model and the answer is refused rather than faked.

The default is the measured, tool-capable qwen3:4b. A KEA_OLLAMA_MODEL override
must also support tools; readiness stays false otherwise.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.providers.base import (
    TextDelta,
    TokenUsage,
    ToolCall,
    TurnComplete,
    TurnEvent,
)

log = logging.getLogger(__name__)

#: Model families with a tool template in Ollama's library. Prefix match, so `qwen3:8b`
#: and `qwen3:30b-a3b` both resolve. Deliberately a short allowlist rather than a probe:
#: a model without a template does not error, it silently answers without calling
#: anything, and that is indistinguishable from a good answer until you check the figures.
TOOL_CAPABLE_PREFIXES = (
    "qwen3",
    "qwen2.5",
    "llama3.1",
    "llama3.2",
    "llama3.3",
    "mistral-nemo",
    "firefunction",
)


class OllamaProvider:
    name = "ollama"

    def __init__(
        self,
        model: str = "qwen3:4b",
        base_url: str = "http://localhost:11434",
        timeout: float = 120.0,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout
        self.last_usage = TokenUsage()
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        """One client, reused. It owns the connection pool.

        A client per request means a TCP handshake per chat turn. That is cheap on
        loopback and not free, and it stops being loopback the moment the model moves
        to Bedrock — so the shape should be right before then, not after.
        """
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def aclose(self) -> None:
        """Release the pool. Called from the app lifespan on shutdown."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 300,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "system": system,
            "prompt": user,
            "stream": True,
            "options": {
                # Low temperature: we want the facts restated, not embellished.
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        url = f"{self.base_url}/api/generate"
        async with self._http().stream("POST", url, json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    log.warning("ollama: unparseable line %r", line[:120])
                    continue
                if chunk.get("response"):
                    yield chunk["response"]
                if chunk.get("done"):
                    # Ollama reports usage on the final chunk. Capture it —
                    # this is the input to the cost projection.
                    self.last_usage = TokenUsage(
                        prompt_tokens=chunk.get("prompt_eval_count", 0),
                        completion_tokens=chunk.get("eval_count", 0),
                    )

    # ---- tool-using conversation ------------------------------------------------

    @property
    def supports_tools(self) -> bool:
        """Whether this model can actually call a tool, rather than silently not.

        Read by `app.pipeline` before it will run the agent on a local model. See the
        module docstring: the failure mode is a confident answer with nothing behind it.
        """
        family = self.model.split(":", 1)[0].lower()
        return any(family.startswith(prefix) for prefix in TOOL_CAPABLE_PREFIXES)

    @staticmethod
    def _wire(system: str, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Neutral history -> Ollama chat messages.

        Closest of the three to the neutral shape: `tool` is a real role here, and the
        system prompt is the first message rather than a separate field.
        """
        from app.agent.loop import tool_result_to_text

        out: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for message in messages:
            role = message["role"]
            if role == "tool":
                out.append(
                    {
                        "role": "tool",
                        "tool_name": message["name"],
                        "content": tool_result_to_text(message["content"]),
                    }
                )
            elif role == "assistant" and message.get("tool_calls"):
                out.append(
                    {
                        "role": "assistant",
                        "content": message.get("content") or "",
                        "tool_calls": [
                            {"function": {"name": c.name, "arguments": c.arguments}}
                            for c in message["tool_calls"]
                        ],
                    }
                )
            else:
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
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": self._wire(system, messages),
            "stream": True,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["input_schema"],
                    },
                }
                for t in tools
            ]

        self.last_usage = TokenUsage()
        text_parts: list[str] = []
        calls: list[ToolCall] = []

        async with self._http().stream(
            "POST", f"{self.base_url}/api/chat", json=payload
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    log.warning("ollama: unparseable line %r", line[:120])
                    continue

                message = chunk.get("message") or {}
                if content := message.get("content"):
                    text_parts.append(content)
                    yield TextDelta(content)

                for call in message.get("tool_calls") or []:
                    function = call.get("function") or {}
                    name = function.get("name")
                    if not name:
                        continue
                    arguments = function.get("arguments") or {}
                    if isinstance(arguments, str):
                        # Some builds emit the arguments as a JSON string rather than an
                        # object. A model that produced unparseable arguments still gets
                        # to be told so by the dispatcher, which is more useful than
                        # dropping the call.
                        try:
                            arguments = json.loads(arguments)
                        except json.JSONDecodeError:
                            arguments = {}
                    calls.append(
                        ToolCall(
                            # Ollama does not issue correlation ids — it matches results
                            # positionally — so this is ours, for the agent loop's trace.
                            id=f"{name}-{len(calls)}",
                            name=name,
                            arguments=arguments,
                        )
                    )

                if chunk.get("done"):
                    self.last_usage = TokenUsage(
                        prompt_tokens=chunk.get("prompt_eval_count", 0),
                        completion_tokens=chunk.get("eval_count", 0),
                    )

        yield TurnComplete(
            text="".join(text_parts),
            tool_calls=tuple(calls),
            usage=self.last_usage,
        )

    async def health(self) -> bool:
        # A running Ollama daemon is not enough: the selected model must be installed
        # and able to use tools, or Sparky cannot ground its answer in household data.
        if not self.supports_tools:
            return False
        try:
            r = await self._http().get(f"{self.base_url}/api/tags", timeout=5.0)
            if r.status_code != 200:
                return False
            models = r.json().get("models", [])
            selected = self.model if ":" in self.model else f"{self.model}:latest"
            return any(
                isinstance(model, dict)
                and (model.get("name") == selected or model.get("model") == selected)
                for model in models
            )
        except (httpx.HTTPError, ValueError, AttributeError):
            return False

    async def warm(self) -> None:
        """Force the weights into memory so the first real request isn't a cold start.

        Several GB load from disk on first use. Ten seconds of silence at the start
        of a demo reads as a crash — call this on app startup.
        """
        try:
            async for _ in self.narrate(system="", user="hi", max_tokens=1):
                break
        except Exception as exc:  # noqa: BLE001 - warm-up must never block startup
            log.warning("ollama warm-up failed (non-fatal): %s", exc)
