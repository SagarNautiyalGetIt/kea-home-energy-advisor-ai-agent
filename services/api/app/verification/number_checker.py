"""Layer 3 — the output verification gate.

Our customers' top concern is being told something untrue (61.9% of survey respondents).
This module is how we *demonstrate* rather than assert that we prevent it.

## The rule the whole architecture rests on

**The model may read the facts. It may not do arithmetic on them.**

Layer 1 computes; layer 2 writes the sentence. Making that true is a two-sided job, and
only one side lives here:

* **Remove the operands.** A `FactBundle` carries pre-computed, pre-formatted scalars and
  never a raw series. You cannot ban a language model from doing arithmetic by asking it
  not to — you can only decline to hand it the numbers to do arithmetic *with*. This is
  why `FactBundle` has no `daily_kwh` field and why `offline.OfflinePack` does not
  either, on a platform where nobody could audit it.
* **Catch the residue.** Everything below. A model given seven scalars can still divide
  two of them in its head, and this is the gate that rejects the result.

## Three classes of finding

    figure     a number carrying a unit ($, %, kWh, x) that matches no fact
    worded     a quantity spelled out — "twenty dollars", "a third of your bill"
    derived    a computed *relationship* with no number at all — "twice as much",
               "double what similar homes use", "half your bill"

The third class is the one that mattered and the one the previous version missed. Its
docstring said so plainly — *"Known gap, deliberately not papered over: worded quantities
(double, twice, a third) bypass the regex"* — and the gap is real: "your heating is using
double what it should" contains no numeric token, passes a token-by-token check, and is a
division the model performed and we never authorised. On the one product whose claim is
that figures are computed rather than invented, a comparison invented in prose is the same
failure wearing different clothes.

A derived claim is allowed only when the bundle contains a fact that supports it — a
ratio fact for "twice", a percent fact for "a third". Layer 1 computing the ratio and
handing it over is exactly the intended path.

## The design rule that keeps this tractable

    A number carrying a unit ($, %, kWh, x) is a CLAIM and must match a fact.
    A bare small integer with no unit is STRUCTURAL ("two things to note") and is
    allowed, but recorded separately so it is never invisible.
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

# ───────────────────────── worded quantities ─────────────────────────
#
# Only the values a narration would plausibly reach for. A full number-word parser would
# handle "three hundred and forty-two" and would also be a hundred lines of edge cases
# for an output nobody has ever seen a model produce in three sentences of energy advice.
# If the golden set turns one up, add it here.
_NUMBER_WORDS: dict[str, float] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
}

#: A worded number is only a *claim* when it is attached to a unit. "two things to note"
#: is prose; "twenty dollars" is a figure. Matching the word alone would reject every
#: sentence containing "one".
_WORDED_CLAIM = re.compile(
    r"\b(?P<word>" + "|".join(_NUMBER_WORDS) + r")\s+"
    r"(?P<unit>dollars?|percent|per\s?cent|kilowatt[- ]hours?|units?|kwh)\b",
    re.IGNORECASE,
)

# ───────────────────────── derived relationships ─────────────────────────
#
# Each pattern is a ratio the model computed rather than copied. The value is what that
# claim asserts, so it can be checked against a fact rather than banned outright: a bundle
# carrying `ratio=2.0` genuinely does support "twice as much", and layer 1 computing the
# comparison and handing it over is the intended path.
_DERIVED_CLAIMS: list[tuple[re.Pattern[str], float]] = [
    (re.compile(r"\bdoubl(?:e|ed|ing)\b|\btwice\b|\btwo[- ]fold\b", re.I), 2.0),
    (re.compile(r"\btripl(?:e|ed|ing)\b|\bthree times\b|\bthree[- ]fold\b", re.I), 3.0),
    (re.compile(r"\bquadrupl(?:e|ed|ing)\b|\bfour times\b", re.I), 4.0),
    # "half" needs the lookahead. Without it this pattern matches "half-hourly meter
    # data" — the phrase in the standard appliance refusal, which appears in almost every
    # honest answer this product gives. The first version of this check rejected the
    # entire `what_costs_most` intent for that reason, and it is the kind of false
    # positive that would have shown up as "the model got worse" rather than as a bug in
    # the verifier.
    (re.compile(r"\bhalf\b(?![- ]?hour)|\bhalved\b|\bfifty per ?cent\b", re.I), 0.5),
    (re.compile(r"\b(?:a|one)[- ]third\b", re.I), 1 / 3),
    (re.compile(r"\btwo[- ]thirds\b", re.I), 2 / 3),
    (re.compile(r"\b(?:a|one)[- ]quarter\b", re.I), 0.25),
    (re.compile(r"\bthree[- ]quarters\b", re.I), 0.75),
]

#: An "N times" claim with an explicit number — "1.8 times", "4x". The number is caught by
#: the token pass; this catches the ones written as words in between.
_TIMES_CLAIM = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:times|x)\b", re.I)


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


def extract_worded(text: str) -> list[Token]:
    """Quantities spelled out with a unit — "twenty dollars", "five kilowatt hours"."""
    found: list[Token] = []
    for m in _WORDED_CLAIM.finditer(text):
        value = _NUMBER_WORDS[m.group("word").lower()]
        unit = m.group("unit").lower()
        canonical = "$" if unit.startswith("dollar") else "%" if "cent" in unit else "kwh"
        found.append(Token(raw=m.group(0), value=float(value), unit=canonical))
    return found


def extract_derived(text: str) -> list[tuple[str, float]]:
    """Relationships the model computed. Returns (phrase, the ratio it asserts)."""
    found: list[tuple[str, float]] = []
    for pattern, ratio in _DERIVED_CLAIMS:
        for m in pattern.finditer(text):
            found.append((m.group(0), ratio))
    for m in _TIMES_CLAIM.finditer(text):
        found.append((m.group(0), float(m.group(1))))
    return found


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


def _ratio_supported(ratio: float, bundle: FactBundle) -> bool:
    """Is there a fact that licenses this comparison?

    Two ways it can be licensed. A ratio fact stating it directly (`2.0x`), or a percent
    fact meaning the same thing — a bundle carrying "50%" supports "half", and rejecting
    that would fail a correct sentence built from a real figure.

    Percentages are matched at 1 point rather than the usual relative tolerance: "a third"
    against 33% has to pass, and 1/3 is 33.33%.
    """
    for fact in bundle.facts:
        if fact.unit == "x" and abs(fact.value - ratio) <= max(0.01, ratio * REL_TOLERANCE):
            return True
        if fact.unit == "%" and abs(fact.value - ratio * 100) <= 1.0:
            return True
    return False


def verify(text: str, bundle: FactBundle) -> VerificationReport:
    """Check a draft against the facts it was supposed to be built from.

    Returns a report rather than raising: the caller decides whether to regenerate, fall
    back to a template, or (never, in production) ship it anyway.
    """
    allowed = bundle.allowed_values()
    # A year that already appears in the period phrase is context, not a claim.
    period_numbers = {float(n) for n in re.findall(r"\d{4}", bundle.period)}

    # Digits inside a stored string the model was handed — an ICP, an address, a date.
    # Verified by containment rather than by value, because they are not quantities and
    # there is nothing for a tolerance to mean. See `Fact.reference` for why the licence
    # is this narrow: only substrings of what was supplied can pass, so the model can
    # copy the connection number and cannot invent a different one.
    literals = bundle.allowed_literals()

    checked: list[str] = []
    unverified: list[str] = []

    for token in [*extract_tokens(text), *extract_worded(text)]:
        checked.append(token.raw)
        if token.value in period_numbers:
            continue
        if _matches_any(token.value, allowed):
            continue
        if token.is_structural:
            continue
        if not token.is_claim and any(token.raw.strip() in lit for lit in literals):
            continue
        unverified.append(token.raw)

    derived: list[str] = []
    for phrase, ratio in extract_derived(text):
        checked.append(phrase)
        if not _ratio_supported(ratio, bundle):
            derived.append(phrase)

    return VerificationReport(
        passed=not unverified and not derived,
        checked=checked,
        unverified=unverified,
        derived=derived,
    )


def template_fallback(bundle: FactBundle) -> str:
    """Deterministic prose for when the model cannot produce a verifiable draft.

    Boring on purpose. A plain, correct sentence beats a fluent, unverified one — and it
    means a verification failure degrades the answer instead of breaking it.
    """
    if not bundle.facts:
        # An empty bundle is not always "no usage data". Since the account-lookup intents
        # landed it is more often "this account has no plan on file" or "there is no
        # earlier bill to compare against" — and the bundle's caveat already says which,
        # in words written for the customer. Discarding it to print a fixed sentence
        # about usage answers a question nobody asked, and does it on the path that runs
        # whenever the model is unreachable.
        for caveat in bundle.caveats:
            if "do NOT have" in caveat or "NO figures" in caveat:
                return (
                    f"{_first_sentence(caveat)} "
                    "I can put you through to someone who can help with that."
                )
        return (
            "I don't have enough information to answer that yet. "
            "I can put you through to someone who can help."
        )
    lines = [f"Here is what your {bundle.period} usage shows:"]
    lines += [f"- {f.label}: {f.display}" for f in bundle.facts]
    lines.append("If you'd like this explained in more detail, I can connect you with our team.")
    return "\n".join(lines)


def _first_sentence(caveat: str) -> str:
    """The customer-facing half of a caveat, rewritten from instruction to statement.

    Caveats are written at the narrator ("You do NOT have a due date for this account"),
    so quoting one verbatim would tell the customer what *we* lack in the second person.
    Only the leading clause is used, with the addressee flipped.
    """
    head = caveat.split(". ")[0].strip().rstrip(".")
    head = head.replace("You do NOT have", "I cannot see")
    head = head.replace("You have NO", "I have no")
    head = head.replace(" for this account", " for your account")
    return head + "."
