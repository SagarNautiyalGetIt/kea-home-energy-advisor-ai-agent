"""The single seam between our code and any language model.

Every model call in this codebase goes through this Protocol so that changing provider
is a new class, not a rewrite. Nothing above this layer may import ollama, boto3,
anthropic or google.genai.

Prompt construction deliberately lives OUTSIDE the provider. The provider transports; it
does not decide.

## Two methods, and why both exist

`converse()` is the one the agent uses: it takes a message history and a tool catalogue,
and the model may answer or ask for a tool. `narrate()` is the plain text-in-text-out
call, kept because two things still need it — `offline.py` ships a bundle and a prompt to
a device with no tool loop, and `health()`-adjacent warm-up paths want the cheapest
possible round trip.

## The event stream

`converse()` yields `TextDelta` as prose arrives and exactly one `TurnComplete` at the
end, carrying the assembled text, any tool calls, and the token usage. Streaming is not
optional: the voice path starts speaking sentence one while sentence two is generating,
and the chat UI shows tool activity live rather than a spinner.

Tool calls are deliberately NOT streamed as partial JSON. A half-parsed argument object
is not actionable, and every provider assembles them internally before reporting anyway.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class TextDelta:
    """Prose, as it is generated."""

    text: str


@dataclass(frozen=True)
class ToolCall:
    """One request from the model to run a tool.

    `id` is the provider's correlation handle. Anthropic and Ollama both require the
    result to carry it back; Gemini matches on name instead, so its provider synthesises
    one. Generating it here rather than letting each provider improvise means the agent
    loop and the evidence trail have a stable key regardless of who is answering.
    """

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)

    raw: Any = field(default=None, compare=False, repr=False)
    """The provider's own object for this call, carried back to it untouched.

    Provider-private: the agent loop never reads it, and no other provider may either.
    It exists because a neutral `(name, arguments)` pair is **lossy** for Gemini 3.x,
    which attaches a `thought_signature` to each `functionCall` part and rejects the
    next request if it is missing:

        400 INVALID_ARGUMENT — Function call is missing a thought_signature in
        functionCall parts. This is required for tools to work correctly.

    Rebuilding the part from name and args drops it, so every tool-using turn failed on
    round two. Round-tripping the original part is the documented fix, and an opaque
    field is the smallest way to allow it without leaking one provider's wire format
    into the shared shape.

    `compare=False` so two calls with the same name and arguments still compare equal —
    tests assert on the call, not on the transport's bookkeeping.
    """


@dataclass(frozen=True)
class TurnComplete:
    """The end of one model turn.

    `text` is the whole assembled response, not the last chunk — a consumer that ignored
    the deltas still has everything. `tool_calls` empty means the model answered.
    """

    text: str
    tool_calls: tuple[ToolCall, ...] = ()
    usage: TokenUsage | None = None

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


#: What `converse()` yields. A union rather than a base class because the two are
#: matched on, never subclassed.
TurnEvent = TextDelta | TurnComplete


@runtime_checkable
class LLMProvider(Protocol):
    """Stream text, hold a conversation with tools, and say who you are for logging."""

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
        """Yield text chunks. No tools, no history — one prompt, one answer."""
        ...

    async def converse(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> AsyncIterator[TurnEvent]:
        """One turn of a tool-using conversation.

        `messages` is the neutral history the agent loop maintains — see
        `app/agent/loop.py` for its shape. Each provider translates it into its own
        wire format; none of them may mutate it.

        `tools` is a list of `{"name", "description", "input_schema"}`. JSON Schema,
        because all three providers accept that with different keys around it.
        """
        ...

    async def health(self) -> bool:
        """True if the model is loaded and answering. Used for the UI ready-state."""
        ...


class TokenUsage:
    """Per-call token accounting.

    The cost argument in the pitch is measured tokens x published rates, which only
    works if tokens are logged from the first call. An agent turn spends several model
    calls, so the loop *accumulates* these rather than taking the last one — a
    tool-using turn that reported only its final call would understate its own cost by
    most of it.
    """

    __slots__ = ("prompt_tokens", "completion_tokens")

    def __init__(self, prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __add__(self, other: TokenUsage) -> TokenUsage:
        return TokenUsage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
        )

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"TokenUsage(prompt={self.prompt_tokens}, completion={self.completion_tokens})"
