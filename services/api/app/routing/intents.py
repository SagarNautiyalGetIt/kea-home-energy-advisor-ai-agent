"""Layer 0 — intent routing, in Python, with no model involved.

Tool selection is the hardest thing to ask a small local model to do, so we don't.
Python decides *what* to compute; the model only decides *how to say it*. That keeps
every routing mistake a debuggable Python bug with a stack trace instead of a prompt
to tune, and it is what makes a 4B model sufficient.

Rules are deliberately dumb and readable. If they prove too brittle against the
golden set, the upgrade path is a small trained classifier — still not a generative
model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas import Intent

# Ordered: the first pattern that matches wins, so put the highest-stakes intent
# first. Hardship outranks everything — a customer saying they cannot pay must
# never be routed to a chirpy usage explanation.
_RULES: list[tuple[Intent, re.Pattern[str]]] = [
    (
        Intent.HARDSHIP,
        re.compile(
            r"\b(can'?t afford|cannot afford|struggl\w*|behind on|"
            r"disconnect\w*|cut off|payment plan|hardship|"
            r"can'?t pay|cannot pay|too expensive for me|help me pay)\b",
            re.I,
        ),
    ),
    (
        Intent.TARIFF_CHECK,
        re.compile(r"\b(tariff|plan|better deal|cheaper plan|switch|low fixed charge)\b", re.I),
    ),
    (
        Intent.WHAT_WILL_I_PAY,
        re.compile(
            r"\b(what will i pay|how much will|next bill|this month'?s bill|"
            r"estimate|forecast|projection|end of the month)\b",
            re.I,
        ),
    ),
    (
        Intent.COMPARE_TO_LAST_YEAR,
        # "last winter" is matched on its own rather than as part of the fixed phrase
        # "compared to last winter". The golden set (R-052) caught the original: it
        # answered "how does this compare to last winter?" with out_of_scope, because
        # only that one exact wording was handled. This rule must stay ahead of the
        # weather rule below — "last winter" is a year-on-year question, not a
        # cold-snap one, even though both mention winter.
        re.compile(r"\b(last year|last winter|same time last|year[- ]on[- ]year)\b", re.I),
    ),
    (
        Intent.WHAT_COSTS_MOST,
        re.compile(
            r"\b(what (?:is|'s) using|which appliance|what costs most|"
            r"biggest user|what uses the most)\b",
            re.I,
        ),
    ),
    (
        Intent.USING_MORE_THAN_USUAL,
        # The weather terms are not decoration — this intent is the *only* path to
        # weather attribution, and demo line 2 is literally "wasn't that just the cold
        # snap?". The golden set (R-020) caught that question routing to out_of_scope,
        # which would have been discovered on stage.
        #
        # Sitting below COMPARE_TO_LAST_YEAR is deliberate: "last winter" is a
        # year-on-year comparison and must not be captured here by "winter".
        re.compile(
            r"\b(more than usual|using more|gone up|increase[db]?|spike|unusual|"
            r"cold snap|cold spell|colder|the weather|because of the weather)\b",
            re.I,
        ),
    ),
    (
        # Above PEAK_USAGE: "what TIME of day" and "which DAY" are different questions
        # and we can only answer one of them. Routing a time-of-day question to the
        # daily peak would answer "day 11" to "what hour?", which is the same class of
        # confidently-wrong answer PEAK_USAGE was added to stop.
        Intent.TIME_OF_DAY,
        re.compile(
            r"\b(what|which|when)\b.{0,20}\b(time of day|hour|hourly|time)\b"
            r"|\b(time of day|what hour|which hour|peak hour|hourly breakdown|"
            r"morning|evening|overnight|afternoon|during the day|at night)\b",
            re.I,
        ),
    ),
    (
        # PEAK_USAGE must sit ABOVE WHY_HIGH, and the reason is a real bug this caught.
        #
        # "which was the day of my highest usage?" was answered with the full
        # why-is-my-bill-high explanation, because `\bhigh` matches inside "highest" and
        # WHY_HIGH's rule got there first. The model then narrated the wrong bundle
        # perfectly and layer 3 stamped it "every figure checked" — which was true and
        # completely beside the point. Layer 3 verifies that figures are real, never
        # that they answer the question asked; only layer 0 can do that, so a routing
        # miss surfaces as a confident wrong answer rather than an error.
        #
        # These are "when/which/what day" questions — the interrogative is what
        # distinguishes them from "why is it high", not the word "high".
        Intent.PEAK_USAGE,
        re.compile(
            r"\b(which|what|when|highest|peak|most)\b.{0,30}"
            r"\b(day|days|date|time|highest|peak|most|worst)\b"
            r"|\b(peak day|busiest day|highest day|highest usage|used the most|"
            r"using the most|use the most)\b",
            re.I,
        ),
    ),
    (
        Intent.WHY_HIGH,
        # `high\b` rather than `high` — the missing word boundary is what let this rule
        # swallow "highest". Same for the second rule below.
        re.compile(
            r"\b(why|high\b|expensive|so much|explain).{0,40}\b(bill|power|usage|charge)", re.I
        ),
    ),
    (
        Intent.WHY_HIGH,
        re.compile(r"\b(bill|power|usage).{0,40}\b(high\b|up|expensive|jumped|doubled)\b", re.I),
    ),
]


@dataclass(frozen=True)
class RoutingResult:
    intent: Intent
    matched_rule: str | None

    @property
    def is_escalation(self) -> bool:
        """Hardship goes to a human. Under the Consumer Care Obligations this is
        closer to a legal duty than a feature, and an AI must not counsel someone
        in financial distress."""
        return self.intent is Intent.HARDSHIP


def route(message: str) -> RoutingResult:
    text = message.strip()
    if not text:
        return RoutingResult(Intent.OUT_OF_SCOPE, None)
    for intent, pattern in _RULES:
        if pattern.search(text):
            return RoutingResult(intent, pattern.pattern[:60])
    return RoutingResult(Intent.OUT_OF_SCOPE, None)
