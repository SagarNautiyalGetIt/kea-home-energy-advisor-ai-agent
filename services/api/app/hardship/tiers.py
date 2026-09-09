"""Who handles this conversation: the assistant, a watched assistant, or a person.

    Tier 1  AUTONOMOUS   The assistant answers. Nobody is waiting on it.
    Tier 2  MONITORED    The assistant answers, a Kea agent is watching live and can
                         take the conversation at any point.
    Tier 3  HUMAN_ONLY   A person handles it. The assistant acknowledges, says a person
                         is coming, and stops.

This file is **policy**, not scoring. It is meant to be read on its own by whoever is
answerable for Consumer Care compliance, and changed by them rather than by whoever is
touching the model that week. `signals.py` measures; this decides.

## The two rules that are not thresholds

**Crisis goes straight to tier 3, whatever the score says.** A customer talking about
self-harm is not a hardship case to be scored — the ladder is bypassed entirely and the
score is not consulted. Deliberately first in `decide()` so it cannot be reordered
behind a threshold check by accident.

**The model may escalate but never de-escalate.** `handoff_to_human` forces tier 3, and
nothing the model does can lower a tier Python assigned. That asymmetry is the whole
safety property: a model that could argue its way down from tier 3 would eventually do
it on the conversation where it mattered.

## Why tier 2 exists

It is tempting to have two tiers — the assistant handles it, or a person does. Tier 2 is
for the large middle where the evidence is real but thin: a bill that doubled, a balance
one cycle behind, "things are a bit tight at the moment". Sending all of those to a
person floods the queue and trains everyone to close them unread; sending none of them
means the first human contact happens after the disconnection notice.

So tier 2 answers the customer *and* raises a live flag. The cost of being wrong is an
agent glancing at a conversation that turned out fine, which is the cheapest possible
way to be wrong here.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from app.hardship.signals import HardshipAssessment, Source

#: Score at or above which a person watches. Set low on purpose — see the module note on
#: why the middle band is wide.
MONITORED_THRESHOLD = 0.40

#: Score at or above which only a person handles it.
HUMAN_ONLY_THRESHOLD = 0.75


class Tier(IntEnum):
    """Ordered so `max()` is the escalation operator — a tier can only ever go up."""

    AUTONOMOUS = 1
    MONITORED = 2
    HUMAN_ONLY = 3

    @property
    def label(self) -> str:
        return {
            Tier.AUTONOMOUS: "autonomous",
            Tier.MONITORED: "monitored",
            Tier.HUMAN_ONLY: "human_only",
        }[self]

    @property
    def answers_the_customer(self) -> bool:
        """Whether the assistant writes the reply at all."""
        return self is not Tier.HUMAN_ONLY


@dataclass(frozen=True)
class TierDecision:
    tier: Tier
    reason: str
    """One sentence, in words a support lead would use. Goes on the escalation row."""

    evidence: list[str]
    score: float
    notify_agent: bool
    """Whether a Kea agent is told about this conversation now rather than after it."""

    @property
    def guidance(self) -> str:
        """What the assistant is told about its own position.

        Included in the model's context so its tone matches what is actually happening —
        an assistant reassuring somebody that everything is fine while a hardship agent
        is being paged reads as not listening.
        """
        if self.tier is Tier.HUMAN_ONLY:
            return (
                "HANDLING: a person is taking this conversation. Acknowledge them warmly "
                "and briefly, tell them a member of the team is picking this up now, and "
                "stop. Do not give financial advice, do not quote payment options, do not "
                "argue about the bill, and do not ask them to explain their situation "
                "again — they should not have to tell it twice. You may still answer a "
                "plain factual question they already asked."
            )
        if self.tier is Tier.MONITORED:
            return (
                "HANDLING: answer normally, but a Kea agent is watching this conversation "
                "and may step in. This customer is showing signs of financial pressure. "
                "Be concrete and warm, avoid anything that reads as upselling, and do not "
                "tell them their bill is fine or normal. If they say anything that "
                "confirms difficulty paying, call handoff_to_human immediately."
            )
        return "HANDLING: answer normally."


def decide(
    assessment: HardshipAssessment,
    *,
    model_requested_handoff: bool = False,
) -> TierDecision:
    """Assessment in, tier out. Pure — no I/O, so it is testable with fixed inputs.

    `model_requested_handoff` is the agent having called `handoff_to_human`. It forces
    tier 3 and is applied *last*, so it can only raise.
    """
    evidence = assessment.reasons()
    score = assessment.score

    # 1. Crisis. Before every threshold, and not a function of the score.
    if assessment.crisis:
        return TierDecision(
            tier=Tier.HUMAN_ONLY,
            reason="the customer expressed acute personal distress",
            evidence=evidence,
            score=score,
            notify_agent=True,
        )

    # 2. The model asked for a person. It knows things the phrase bank does not —
    #    this is the path for a paraphrase no regex would catch.
    if model_requested_handoff:
        return TierDecision(
            tier=Tier.HUMAN_ONLY,
            reason="the assistant judged that this needs a person",
            evidence=evidence or ["the assistant called handoff_to_human"],
            score=score,
            notify_agent=True,
        )

    # 3. Score.
    if score >= HUMAN_ONLY_THRESHOLD:
        return TierDecision(
            tier=Tier.HUMAN_ONLY,
            reason="the customer disclosed difficulty paying",
            evidence=evidence,
            score=score,
            notify_agent=True,
        )

    # 4. Corroboration promotes. Language and account agreeing is a different kind of
    #    evidence from either alone, and the threshold on its own would miss the case
    #    where both are individually moderate — which is the commonest real one.
    if assessment.corroborated and score >= MONITORED_THRESHOLD:
        return TierDecision(
            tier=Tier.HUMAN_ONLY,
            reason=(
                "what the customer said matches what their account shows, so this is "
                "treated as a disclosure rather than a turn of phrase"
            ),
            evidence=evidence,
            score=score,
            notify_agent=True,
        )

    if score >= MONITORED_THRESHOLD:
        # Paged only when the customer SAID something. An account-derived signal on its
        # own puts the conversation on a watchlist; it does not put a person on standby.
        #
        # This matters more here than it looks, because the product is bill-shock
        # prevention: a bill up 66% is the event it exists to catch, and Tama's account
        # trips `bill_shock` on a plain "why is my bill so high?" with no distress in it
        # at all. Paging on that would page on a large share of the cohort, every cycle,
        # and a queue that full is one nobody reads — which is how the real disclosure
        # underneath gets missed.
        #
        # Same distinction the care register already gets below, for the same reason.
        said_something = any(s.source is Source.LANGUAGE for s in assessment.signals)
        return TierDecision(
            tier=Tier.MONITORED,
            reason=(
                "the customer mentioned something that suggests financial pressure"
                if said_something
                else "this account shows signs of financial pressure"
            ),
            evidence=evidence,
            score=score,
            notify_agent=said_something,
        )

    # 5. The care register never leaves a conversation fully unwatched, even with no
    #    other signal. Under the Consumer Care Obligations a medically dependent customer
    #    is a category of person, not a state of a conversation — the duty is there before
    #    they say anything, and a quiet tier 2 is how that duty shows up in the product.
    if assessment.on_care_register:
        return TierDecision(
            tier=Tier.MONITORED,
            reason=(
                "the account is on the medically dependent or vulnerable register, so a "
                "person watches any conversation that could touch payment or supply"
            ),
            evidence=evidence,
            score=score,
            notify_agent=False,
        )

    return TierDecision(
        tier=Tier.AUTONOMOUS,
        reason="no hardship signals on this turn",
        evidence=evidence,
        score=score,
        notify_agent=False,
    )
