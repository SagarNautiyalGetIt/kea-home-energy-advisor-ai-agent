"""Detecting financial hardship, and deciding who is allowed to handle it.

Two questions, deliberately kept apart:

    signals.py   How much distress is there, and what is the evidence?
    tiers.py     Given that, who handles this — the assistant, a monitored
                 assistant, or a person only?

Keeping them separate is not tidiness. The first is a measurement and belongs in tests
with fixed inputs; the second is a **policy** decision under the Consumer Care
Obligations, and policy that is tangled up with scoring cannot be reviewed by the people
who are answerable for it. A support lead should be able to read `tiers.py` alone and
say whether they agree.

## Why the assistant does not decide this

`handoff_to_human` exists and the model can call it, and that stays — a customer who
says "I can't pay this" should reach a person whatever else happens. But a model
choosing its own escalation is a model that can choose not to, and under Part 6 of the
Consumer Care Obligations a retailer on notice of payment difficulty has duties that do
not depend on how the conversation went. So the tier is computed in Python from the
message and the account, on every turn, on every channel, and the model is told the
outcome rather than asked for it.

The model can still escalate *upward* — calling `handoff_to_human` forces tier 3
regardless of score. It can never de-escalate.
"""

from app.hardship.signals import HardshipAssessment, Signal, assess
from app.hardship.tiers import Tier, TierDecision, decide

__all__ = [
    "HardshipAssessment",
    "Signal",
    "Tier",
    "TierDecision",
    "assess",
    "decide",
]
