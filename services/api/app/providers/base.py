"""The single seam between our code and any language model.

Sprint 2 runs a local model; the deployment story is Bedrock. Every model call in
this codebase goes through this Protocol so that migration is a new class, not a
rewrite. Nothing above this layer may import ollama, boto3 or anthropic.

Prompt construction deliberately lives OUTSIDE the provider. The provider
transports; it does not decide.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    """Minimal surface: stream text, and say who you are for logging."""

    name: str
    model: str

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 300,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        """Yield text chunks as they are generated.

        Streaming is not optional: on local hardware it is what lets the voice path
        start speaking sentence one while sentence two is still being produced.
        """
        ...

    async def health(self) -> bool:
        """True if the model is loaded and answering. Used for the UI ready-state."""
        ...


class TokenUsage:
    """Per-call token accounting.

    Running locally means no invoice to measure, so the cost argument becomes a
    projection: measured tokens x published Bedrock rates. That only works if we
    log the tokens from the first call, so this is not optional either.
    """

    __slots__ = ("prompt_tokens", "completion_tokens")

    def __init__(self, prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"TokenUsage(prompt={self.prompt_tokens}, completion={self.completion_tokens})"
