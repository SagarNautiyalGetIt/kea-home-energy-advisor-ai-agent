"""Layer 0 — intent routing, in Python, with no model involved.

Tool selection is the hardest thing to ask a small local model to do, so we don't.
Python decides *what* to compute; the model only decides *how to say it*. That keeps
every routing mistake a debuggable Python bug with a stack trace instead of a prompt
to tune, and it is what makes a 4B model sufficient.

## This module is now an adapter

The rules moved to `app.routing.resolver`, which scores every intent instead of
returning the first pattern that matched. `route()` stays because it is the seam the
pipeline, the golden set and the voice transport all call, and because its
`RoutingResult` is the shape they expect — changing all three at once to gain nothing
would be churn.

**There is deliberately no second implementation behind this.** `route()` calls
`resolve()` and narrows the result; it does not keep a simpler copy of the rules for
the cases the resolver handles badly. A fallback router is how the demo starts
answering one way over the microphone and another way in the chat box, which is the
exact failure `pipeline.answer()` exists to prevent one layer up.

Callers wanting the confidence, the runner-up or a multi-part question should use
`resolver.resolve()` / `resolve_all()` directly — this signature cannot carry them.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.routing.resolver import resolve
from app.schemas import Intent


@dataclass(frozen=True)
class RoutingResult:
    intent: Intent
    matched_rule: str | None

    @property
    def is_escalation(self) -> bool:
        """Hardship and billing disputes go to a human. Under the Consumer Care
        Obligations the first is closer to a legal duty than a feature: an AI must not
        counsel someone in financial distress. The second is a claim about the world
        that our own data cannot settle, so it is not ours to adjudicate."""
        return self.intent.needs_human


def route(message: str) -> RoutingResult:
    """Free text to one intent. Never raises; an unrecognised question is OUT_OF_SCOPE.

    `matched_rule` carries the winning score rather than a regex fragment now. It is a
    diagnostic string either way — nothing branches on it — and the score is the more
    useful of the two, because a confident match and a barely-cleared one look identical
    in the intent alone. `resolver.explain()` prints the full table.
    """
    resolution = resolve(message)
    if resolution.intent is Intent.OUT_OF_SCOPE:
        return RoutingResult(Intent.OUT_OF_SCOPE, None)
    return RoutingResult(resolution.intent, f"score={resolution.score:.1f}")
