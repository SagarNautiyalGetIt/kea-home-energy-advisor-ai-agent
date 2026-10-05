"""Which model answers, and the rule that a downgrade is never silent.

Sprint 2 defaulted to a local model on the demo laptop. That was right for a laptop and
wrong as an architecture: the answer a customer gets should not depend on which machine
happened to serve it, and a 4B model sized by a hardware probe is not a product decision.

Bedrock is now the default. Ollama stays, in two clearly separated roles:

1. **Local development.** `KEA_PROVIDER=ollama`, chosen deliberately, no cloud account
   needed to work on routing, analytics or the frontend.
2. **A declared fallback.** `KEA_PROVIDER=bedrock+ollama` runs Bedrock and drops to the
   local model only when Bedrock is unreachable.

## The fallback is opt-in, and that is the important part

An automatic silent fallback is the exact failure shape this repository has been bitten by
twice — a recorder that dropped nine of fourteen accounts while `/health` said
`recording: database`, and a `.env` nothing read. Both reported success while doing
nothing.

A model downgrade is worse than either, because the output still looks like an answer.
Gemma 3 4B and Claude Sonnet produce prose of visibly different quality from the same fact
bundle, and a rehearsal where the cloud was briefly unreachable would be read as "the
model got worse" rather than "we served a different model". So:

* the fallback chain must be written out in the environment variable — nothing falls back
  by default;
* `/health` reports the provider that is *currently answering*, not the one configured;
* every fallback logs at WARNING and sets `degraded`, which the response carries.

## What this is not

This is not the offline story. A customer with no connectivity cannot reach this API at
all, so nothing here helps them — a server-side fallback only covers the case where *our*
egress to Bedrock is down. The customer-offline case is `app/offline.py`: pre-computed
fact bundles cached on the device, narrated by an on-device model. See
`docs/adr/0008-offline-first-narration.md`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from app.providers.base import LLMProvider, TokenUsage, TurnComplete, TurnEvent

log = logging.getLogger(__name__)

#: How long a failed health check is trusted before probing again. Long enough that a
#: Bedrock outage does not mean a probe on every request; short enough that recovery is
#: picked up inside a demo. Re-probing per request would add a round trip to every turn.
PROBE_TTL_SECONDS = 60.0


class FallbackProvider:
    """Try each provider in order; use the first that answers.

    Streaming makes this less trivial than it looks. Once a chunk has been yielded to the
    caller, the transport has already put bytes on the wire and falling back would splice
    two models' prose together mid-sentence. So the switch can only happen **before the
    first chunk**: a provider that fails after yielding is a hard failure, and the
    narrator's own template fallback handles it from there.
    """

    def __init__(self, providers: list[LLMProvider]) -> None:
        if not providers:
            raise ValueError("FallbackProvider needs at least one provider")
        self._providers = providers
        self._active = providers[0]
        self._unhealthy_until: dict[str, float] = {}
        self.last_usage = TokenUsage()
        self.degraded = False

    @property
    def name(self) -> str:
        """The provider currently answering, not the chain.

        `/health` shows this. Reporting the chain would make a degraded deployment look
        identical to a healthy one, which is the whole thing this module exists to avoid.
        """
        suffix = " (degraded)" if self.degraded else ""
        return f"{self._active.name}{suffix}"

    @property
    def model(self) -> str:
        return self._active.model

    @property
    def chain(self) -> list[str]:
        return [f"{p.name}:{p.model}" for p in self._providers]

    def _skip(self, provider: LLMProvider) -> bool:
        until = self._unhealthy_until.get(provider.name, 0.0)
        return time.monotonic() < until

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 300,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        last_error: Exception | None = None

        for index, provider in enumerate(self._providers):
            if self._skip(provider) and index < len(self._providers) - 1:
                continue
            try:
                stream = provider.narrate(
                    system=system, user=user, max_tokens=max_tokens, temperature=temperature
                )
                first = await anext(stream)
            except StopAsyncIteration:
                # An empty stream is a failure, not an empty answer. Layer 3 would reject
                # the empty string anyway; failing over here gives a better result.
                last_error = RuntimeError(f"{provider.name} produced no output")
                self._unhealthy_until[provider.name] = time.monotonic() + PROBE_TTL_SECONDS
                continue
            except Exception as exc:  # noqa: BLE001 - any provider failure is a failover
                last_error = exc
                self._unhealthy_until[provider.name] = time.monotonic() + PROBE_TTL_SECONDS
                log.warning(
                    "provider %s failed (%s) — trying the next in the chain",
                    provider.name,
                    exc,
                )
                continue

            was_degraded = index > 0
            if was_degraded and not self.degraded:
                # WARNING, not INFO. This is the line somebody greps for when asked why
                # the answers read differently on the afternoon of the demo.
                log.warning(
                    "SERVING FROM FALLBACK PROVIDER %s:%s — the primary (%s) is unreachable. "
                    "Answer quality will differ.",
                    provider.name,
                    provider.model,
                    self._providers[0].name,
                )
            self._active = provider
            self.degraded = was_degraded

            yield first
            async for chunk in stream:
                yield chunk

            self.last_usage = getattr(provider, "last_usage", TokenUsage())
            return

        raise RuntimeError(
            f"every provider in the chain failed ({', '.join(self.chain)})"
        ) from last_error

    async def converse(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> AsyncIterator[TurnEvent]:
        """Same first-chunk rule as `narrate`, with one addition that matters more here.

        A provider that cannot use tools is skipped when tools were asked for. Ollama's
        `supports_tools` is the case this exists for: a model with no tool template does
        not error on a `tools` array, it ignores it and answers from the system prompt
        alone. In this application that is the worst available outcome — a fluent,
        confident answer with no meter data behind it — and it would look exactly like a
        good one. Better to fail the chain and let the transport say the assistant is
        unavailable.
        """
        last_error: Exception | None = None
        eligible = [p for p in self._providers if not tools or getattr(p, "supports_tools", True)]
        if not eligible:
            raise RuntimeError(
                f"no provider in the chain can use tools ({', '.join(self.chain)}). "
                "A local model without a tool template would answer without reading any "
                "meter data — set KEA_OLLAMA_MODEL to a tool-capable model, or use a "
                "cloud provider."
            )

        for index, provider in enumerate(eligible):
            if self._skip(provider) and index < len(eligible) - 1:
                continue
            try:
                stream = provider.converse(
                    system=system,
                    messages=messages,
                    tools=tools,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                first = await anext(stream)
            except StopAsyncIteration:
                last_error = RuntimeError(f"{provider.name} produced no output")
                self._unhealthy_until[provider.name] = time.monotonic() + PROBE_TTL_SECONDS
                continue
            except Exception as exc:  # noqa: BLE001 - any provider failure is a failover
                last_error = exc
                self._unhealthy_until[provider.name] = time.monotonic() + PROBE_TTL_SECONDS
                log.warning(
                    "provider %s failed (%s) — trying the next in the chain",
                    provider.name,
                    exc,
                )
                continue

            was_degraded = provider is not self._providers[0]
            if was_degraded and not self.degraded:
                log.warning(
                    "SERVING FROM FALLBACK PROVIDER %s:%s — the primary (%s) is unreachable. "
                    "Answer quality will differ.",
                    provider.name,
                    provider.model,
                    self._providers[0].name,
                )
            self._active = provider
            self.degraded = was_degraded

            yield first
            async for event in stream:
                if isinstance(event, TurnComplete) and event.usage is not None:
                    self.last_usage = event.usage
                yield event
            return

        raise RuntimeError(
            f"every provider in the chain failed ({', '.join(self.chain)})"
        ) from last_error

    async def health(self) -> bool:
        for provider in self._providers:
            if await provider.health():
                return True
        return False


def build_provider(
    spec: str,
    *,
    bedrock_model: str,
    aws_region: str,
    ollama_model: str,
    ollama_url: str,
    gcp_model: str,
    gemini_api_key: str = "",
    gemini_api_keys: str = "",
    gemini_numbered_keys: dict[str, str] | None = None,
) -> LLMProvider:
    """Construct from a `+`-separated chain, e.g. `bedrock+ollama`.

    A single name is the common case and returns that provider directly rather than a
    one-element chain — so `/health` reads `bedrock`, not `bedrock (degraded)` logic
    wrapped around a single option.

    An unknown name raises. This is not the place to be forgiving: falling back to a
    default provider because someone typed `bedrok` would serve a different model than the
    deployment asked for, silently, which is the thing this module is about.
    """
    names = [part.strip() for part in spec.split("+") if part.strip()]
    if not names:
        raise ValueError("KEA_PROVIDER is empty")

    providers: list[LLMProvider] = []
    for name in names:
        if name == "bedrock":
            if bedrock_model.startswith("amazon.nova-"):
                from app.providers.bedrock_nova import BedrockNovaProvider

                providers.append(BedrockNovaProvider(model=bedrock_model, aws_region=aws_region))
            else:
                from app.providers.bedrock import BedrockProvider

                providers.append(BedrockProvider(model=bedrock_model, aws_region=aws_region))
        elif name == "ollama":
            from app.providers.ollama import OllamaProvider

            providers.append(OllamaProvider(model=ollama_model, base_url=ollama_url))
        elif name == "gcp":
            from app.providers.gcp import GCPProvider
            from app.providers.keypool import build_pool

            # The key pool is one provider's quota model, not a chain — a rotation is
            # invisible to the caller and changes nothing about the answer, while a
            # fallback serves a different model and is reported as degraded. Building it
            # here keeps that distinction visible: the pool goes INSIDE one provider.
            pool = build_pool(
                primary=gemini_api_key,
                extras=gemini_api_keys,
                numbered=gemini_numbered_keys,
            )
            if pool.configured > 1:
                log.info(
                    "gemini key pool: %d keys configured (%s)",
                    pool.configured,
                    ", ".join(k.label for k in pool.keys),
                )
            providers.append(GCPProvider(model=gcp_model, keys=pool))
        else:
            raise ValueError(
                f"unknown provider {name!r} in KEA_PROVIDER={spec!r}. "
                "Valid names are 'bedrock', 'gcp', and 'ollama', joined with '+' for a "
                "fallback chain (e.g. 'gcp+ollama')."
            )

    if len(providers) == 1:
        return providers[0]
    return FallbackProvider(providers)
