"""Layer 3 — the output verification gate.

Our customers' top concern is being told something untrue (61.9% of survey
respondents). This module is how we *demonstrate* rather than assert that we
prevent it: every numeric token in the model's prose must trace back to a value
layer 1 computed, or the draft is rejected.

The design rule that makes this tractable:

    A number carrying a unit ($, %, kWh, ×) is a CLAIM and must match a fact.
    A bare small integer with no unit is STRUCTURAL ("two things to note") and
    is allowed, but recorded separately so it is never invisible.

Known gap, deliberately not papered over: worded quantities ("double", "twice",
"a third") bypass the regex. Cover them in the golden set and decide from
evidence whether they need handling — don't guess now.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas import FactBundle, VerificationReport

# $1,234.56 | 1,234 | 2.4 | 37% | 2.00x | 2.4kWh — capture the number and any unit marker.
_TOKEN = re.compile(
    r"""
    (?P<currency>\$)?                 # leading $
    (?P<number>\d{1,3}(?:,\d{3})+     # 1,234,567
              |\d+\.\d+               # 2.4
              |\d+)                   # 290
    \s*
    (?P<unit>%|×|x\b|kWh|kwh|KWH)?    # trailing unit marker
    """,
    re.VERBOSE,
)

_UNIT_BEARING = {"$", "%", "×", "x", "kwh"}

#: Bare integers at or below this are treated as prose structure, not claims.
STRUCTURAL_INT_MAX = 12

#: Relative tolerance for rounding. "$290" satisfies a fact of 289.60 (0.14% off);
#: "$300" does not (3.6% off) — that is a rounding the model invented.
REL_TOLERANCE = 0.01
ABS_TOLERANCE = 0.005


@dataclass(frozen=True)
class Token:
    raw: str
    value: float
    unit: str | None

    @property
    def is_claim(self) -> bool:
        """Unit-bearing tokens assert something about the customer's energy or money."""
        return self.unit is not None

    @property
    def is_structural(self) -> bool:
        return (
            not self.is_claim
            and float(self.value).is_integer()
            and abs(self.value) <= STRUCTURAL_INT_MAX
        )


def extract_tokens(text: str) -> list[Token]:
    tokens: list[Token] = []
    for m in _TOKEN.finditer(text):
        number = m.group("number").replace(",", "")
        try:
            value = float(number)
        except ValueError:  # pragma: no cover - regex guarantees parseability
            continue
        unit = m.group("currency") or m.group("unit")
        if unit:
            unit = unit.lower().strip()
            unit = unit if unit in _UNIT_BEARING else None
        tokens.append(Token(raw=m.group(0).strip(), value=value, unit=unit))
    return tokens


def _matches_any(value: float, allowed: list[float]) -> bool:
    for a in allowed:
        if abs(value - a) <= max(ABS_TOLERANCE, abs(a) * REL_TOLERANCE):
            return True
        # The model may legitimately round for readability: 289.6 -> 290, 2.44 -> 2.4.
        if round(a) != 0 and abs(value - round(a)) <= ABS_TOLERANCE:
            return True
        if abs(value - round(a, 1)) <= ABS_TOLERANCE:
            return True
    return False


def verify(text: str, bundle: FactBundle) -> VerificationReport:
    """Check a draft against the facts it was supposed to be built from.

    Returns a report rather than raising: the caller decides whether to regenerate,
    fall back to a template, or (never, in production) ship it anyway.
    """
    allowed = bundle.allowed_values()
    # A year that already appears in the period phrase is context, not a claim.
    period_numbers = {float(n) for n in re.findall(r"\d{4}", bundle.period)}

    checked: list[str] = []
    unverified: list[str] = []

    for token in extract_tokens(text):
        checked.append(token.raw)
        if token.value in period_numbers:
            continue
        if _matches_any(token.value, allowed):
            continue
        if token.is_structural:
            continue
        unverified.append(token.raw)

    return VerificationReport(
        passed=not unverified,
        checked=checked,
        unverified=unverified,
    )


def template_fallback(bundle: FactBundle) -> str:
    """Deterministic prose for when the model cannot produce a verifiable draft.

    Boring on purpose. A plain, correct sentence beats a fluent, unverified one —
    and it means a verification failure degrades the answer instead of breaking it.
    """
    if not bundle.facts:
        return (
            "I don't have enough information about your usage to answer that yet. "
            "I can put you through to someone who can help."
        )
    lines = [f"Here is what your {bundle.period} usage shows:"]
    lines += [f"- {f.label}: {f.display}" for f in bundle.facts]
    lines.append("If you'd like this explained in more detail, I can connect you with our team.")
    return "\n".join(lines)
