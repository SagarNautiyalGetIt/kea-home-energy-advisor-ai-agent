"""Record real model turns once, replay them for free forever.

## Why this exists

The e2e suite has about thirty assertions that are genuinely about what the model wrote:
does the answer quote the total that is on the bill, does it compare against this
account's own previous period, does it name the driver that actually carries the
movement. A scripted stub cannot satisfy those — it writes from a fixed template, so it
is being tested rather than the product. They need a real model.

A real model in CI is the wrong answer too, and would be even with unlimited quota:
two hundred tests against a nondeterministic endpoint is slow, flaky, and fails for
reasons that have nothing to do with the commit under test.

So: spend the quota once, keep the transcript, and let CI replay it. The recorded turn is
a real Gemini response to the real prompt over real tool results, and it stays that way
until someone deliberately re-records.

## What a cassette is keyed on

The hash covers the model, the system prompt, the message history and the tool catalogue —
everything that determines the reply. Two things are deliberately excluded:

* **`ToolCall.raw`.** Provider-private, and for Gemini it carries a `thought_signature`
  that differs between otherwise identical runs. Hashing it would make every cassette a
  single-use recording.
* **Token usage.** An output of the call, not an input to it.

Because the history includes tool results, a cassette is bound to the figures it was
recorded against. That is the point: if the repository starts returning a different total,
the hash changes, the cassette misses, and the test fails loudly rather than replaying an
answer about numbers that no longer exist. A stale recording is the main way this kind of
harness rots, and a miss is how it announces it.

## Modes

`record` delegates to the real provider and writes what came back. `replay` never touches
the network and raises `CassetteMiss` on an unknown request. `off` is a passthrough.

Record mode carries a **hard request budget**. The free tier is a few dozen calls a day
across the whole pool, and a loop that retries on failure can spend all of it on one
broken test before anyone notices. `KEA_CASSETTE_BUDGET` is the ceiling; hitting it raises
`CassetteBudgetExhausted`, which fails the run rather than quietly recording less than was
asked for.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from app.providers.base import TextDelta, TokenUsage, ToolCall, TurnComplete

log = logging.getLogger(__name__)


class CassetteMiss(RuntimeError):
    """Replay was asked for a turn that was never recorded.

    Carries the digest and a readable summary of the request, because the only useful
    response to a miss is to record that exact turn, and finding it from a bare hash means
    reconstructing the prompt by hand.
    """


class CassetteBudgetExhausted(RuntimeError):
    """Record mode hit its ceiling. Deliberately fatal — see the module docstring."""


def _plain(value: Any) -> Any:
    """Everything that determines the reply, and nothing that merely accompanies it."""
    if isinstance(value, ToolCall):
        # `raw` omitted on purpose: provider-private, and non-deterministic for Gemini.
        return {"id": value.id, "name": value.name, "arguments": value.arguments}
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def digest(*, model: str, system: str, messages: list[dict], tools: Any) -> str:
    payload = json.dumps(
        {"model": model, "system": system, "messages": _plain(messages), "tools": _plain(tools)},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:20]


def _summarise(messages: list[dict]) -> str:
    """The customer's question, for a human reading a miss."""
    for m in messages:
        if m.get("role") == "user":
            return str(m.get("content", ""))[:160].replace("\n", " ")
    return "(no user turn)"


class CassetteProvider:
    """Wraps a provider, and either records what it says or replays what it said."""

    def __init__(self, delegate: Any, *, mode: str, directory: Path, budget: int = 0) -> None:
        self._delegate = delegate
        self._mode = mode
        self._dir = directory
        self._budget = budget
        self._spent = 0
        self._dir.mkdir(parents=True, exist_ok=True)

    @property
    def name(self) -> str:
        return f"cassette:{self._mode}"

    @property
    def model(self) -> str:
        return getattr(self._delegate, "model", "unknown")

    @property
    def spent(self) -> int:
        return self._spent

    def _path(self, key: str) -> Path:
        return self._dir / f"{key}.json"

    async def converse(
        self, *, system, messages, tools=None, max_tokens=2000, temperature=0.3
    ) -> AsyncIterator[Any]:
        key = digest(model=self.model, system=system, messages=messages, tools=tools)
        path = self._path(key)

        if self._mode == "replay" or (self._mode == "record" and path.exists()):
            if not path.exists():
                raise CassetteMiss(
                    f"no cassette {key} for: {_summarise(messages)!r}\n"
                    f"  record it with KEA_CASSETTE=record, or re-record if the "
                    f"underlying figures changed"
                )
            for event in self._load(path):
                yield event
            return

        if self._mode == "record":
            if self._budget and self._spent >= self._budget:
                raise CassetteBudgetExhausted(
                    f"record budget of {self._budget} model calls is spent; "
                    f"{_summarise(messages)!r} was not recorded"
                )
            self._spent += 1
            async for event in self._record(
                key, path, system, messages, tools, max_tokens, temperature
            ):
                yield event
            return

        async for event in self._delegate.converse(
            system=system, messages=messages, tools=tools,
            max_tokens=max_tokens, temperature=temperature,
        ):
            yield event

    async def _record(self, key, path, system, messages, tools, max_tokens, temperature):
        captured: list[dict] = []
        async for event in self._delegate.converse(
            system=system, messages=messages, tools=tools,
            max_tokens=max_tokens, temperature=temperature,
        ):
            if isinstance(event, TextDelta):
                captured.append({"t": "delta", "text": event.text})
            elif isinstance(event, TurnComplete):
                captured.append({
                    "t": "complete",
                    "text": event.text,
                    "tool_calls": [
                        {"id": c.id, "name": c.name, "arguments": c.arguments}
                        for c in event.tool_calls
                    ],
                    "usage": {
                        "prompt_tokens": getattr(event.usage, "prompt_tokens", 0),
                        "completion_tokens": getattr(event.usage, "completion_tokens", 0),
                    } if event.usage else None,
                })
            yield event

        # Written only after the turn completed. A partial recording would replay as a
        # truncated answer, which is worse than a miss because it looks like a result.
        path.write_text(json.dumps({
            "question": _summarise(messages),
            "model": self.model,
            "events": captured,
        }, indent=2))
        log.info("recorded cassette %s (%s)", key, _summarise(messages)[:60])

    def _load(self, path: Path):
        data = json.loads(path.read_text())
        for e in data["events"]:
            if e["t"] == "delta":
                yield TextDelta(e["text"])
            else:
                usage = TokenUsage(**e["usage"]) if e.get("usage") else None
                yield TurnComplete(
                    text=e["text"],
                    tool_calls=tuple(
                        ToolCall(id=c["id"], name=c["name"], arguments=c["arguments"])
                        for c in e["tool_calls"]
                    ),
                    usage=usage,
                )

    async def narrate(self, **kw):
        async for chunk in self._delegate.narrate(**kw):
            yield chunk

    async def health(self) -> bool:
        if self._mode == "replay":
            return True
        return await self._delegate.health()


def wrap_if_enabled(provider: Any) -> Any:
    """Wrap `provider` when the environment asks for it, otherwise hand it straight back."""
    mode = os.environ.get("KEA_CASSETTE", "off").strip().lower()
    if mode not in ("record", "replay"):
        return provider
    directory = Path(
        os.environ.get("KEA_CASSETTE_DIR")
        or Path(__file__).resolve().parents[3] / "qa" / "e2e" / "cassettes"
    )
    budget = int(os.environ.get("KEA_CASSETTE_BUDGET", "0") or 0)
    log.warning("cassette %s from %s (budget=%s)", mode, directory, budget or "none")
    return CassetteProvider(provider, mode=mode, directory=directory, budget=budget)
