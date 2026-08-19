"""Sprint 2 provider — a local model served by Ollama.

Run Ollama NATIVELY on macOS, not in Docker. Docker Desktop on a Mac is a Linux VM
with no access to the Apple GPU, so a containerised model server silently drops to
CPU speed. If this app runs in a container, reach the host at
http://host.docker.internal:11434.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.providers.base import TokenUsage

log = logging.getLogger(__name__)


class OllamaProvider:
    name = "ollama"

    def __init__(
        self,
        model: str = "gemma3:4b",
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

    async def health(self) -> bool:
        try:
            r = await self._http().get(f"{self.base_url}/api/tags", timeout=5.0)
            return r.status_code == 200
        except httpx.HTTPError:
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
