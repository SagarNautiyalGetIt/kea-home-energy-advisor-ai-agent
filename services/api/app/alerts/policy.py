"""How bad is it, and therefore who hears about it — pure Python, no I/O.

`assess_bill_shock` answers *whether* a cycle is heading somewhere expensive. This
answers *how loudly to say so*. Kept separate and kept pure for the same reason layer 1
is: the tier decides whether a customer's phone rings, and that decision has to be
testable without a mail server, a model, or a database.

## The ladder

==== ============ ================== =======================================
tier channel      overshoot          rationale
==== ============ ================== =======================================
1    email        triggered at all   the default: it is in writing, and it
                                     costs nothing to be wrong
2    sms          >= $60 or >= 40%    interrupts them; needs to be worth it
3    voice        >= $120 or >= 75%   a person's time, and theirs
==== ============ ================== =======================================

Only tier 1 delivers today. Tiers 2 and 3 are computed, recorded and rendered — the
row lands in `app.alert` with `status='suppressed'` and a reason — but no gateway is
wired. That is deliberate rather than unfinished: an SMS gateway is a paid account and
a phone number, and the tier logic is the part worth having right now.

## Two rules that are not thresholds

**Escalating tiers do not replace the tier below.** A tier-3 customer gets the email
*and* the call. An SMS that fails silently is not a substitute for the written record,
and the written record is what the Consumer Care Obligations expect a retailer to be
able to produce.

**Hardship suppresses escalation entirely.** If the conversation has already detected
payment difficulty, an automated "you are about to spend $340" is at best useless and
at worst cruel — that customer needs a person, which is what `escalation` is for. The
tier is computed but the alert is written `suppressed`, so the fact that we knew and
chose not to send is on the record.

## Why dollars *or* percent rather than both

The trigger in `assess_bill_shock` requires both, because a percentage alone fires
constantly on small bills. The tier ladder is deliberately the other way round: by the
time something has already triggered, either a large absolute overshoot or a large
relative one is worth escalating. A low-user household 80% over is a real emergency
for that household even if the dollar figure is modest, and the low-fixed-charge
customers this product is aimed at are exactly that shape.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.analytics.engine import BillShockAssessment

#: Tier 2 — worth interrupting someone's day for.
TIER_2_NZD = 60.0
TIER_2_PCT = 40.0

#: Tier 3 — worth a person's time, and worth theirs.
TIER_3_NZD = 120.0
TIER_3_PCT = 75.0

#: Which pipe each tier uses. Separate from the tier itself because the mapping is
#: policy: a customer who has opted out of email still has a tier-1 alert.
TIER_CHANNELS: dict[int, str] = {1: "email", 2: "sms", 3: "voice"}

#: Only tier 1 has a delivery path wired. The others are recorded and rendered so the
#: escalation is demonstrable without a paid gateway.
DELIVERABLE_TIERS: frozenset[int] = frozenset({1})


@dataclass(frozen=True)
class AlertDecision:
    """What to send, on which channels, and why — or why not.

    `tier` is the severity reached. `channels` is every channel that should fire, which
    is the tier's own plus all the ones below it: a tier-3 customer gets the call *and*
    the email, because the written record is the one that survives a failed call.
    """

    tier: int
    channels: tuple[str, ...]
    reasons: tuple[str, ...]
    suppressed: bool = False
    suppressed_because: str | None = None

    @property
    def should_send(self) -> bool:
        return self.tier > 0 and not self.suppressed

    def deliverable_channels(self) -> tuple[str, ...]:
        """The subset with a gateway behind them. Today: email."""
        return tuple(
            TIER_CHANNELS[t] for t in range(1, self.tier + 1) if t in DELIVERABLE_TIERS
        )


def tier_for(assessment: BillShockAssessment) -> int:
    """0 when the assessment did not trigger, otherwise 1-3.

    Reads off `overshoot_nzd` and `overshoot_pct` only. `recent_trend_pct` deliberately
    does not raise the tier: a rising trend says the cycle is *getting* worse, not that
    it is *already* expensive, and phoning someone on day 7 because their usage curve
    turned upward is how a prevention agent teaches people to ignore it.
    """
    if not assessment.triggered:
        return 0

    if assessment.overshoot_nzd >= TIER_3_NZD or assessment.overshoot_pct >= TIER_3_PCT:
        return 3
    if assessment.overshoot_nzd >= TIER_2_NZD or assessment.overshoot_pct >= TIER_2_PCT:
        return 2
    return 1


def decide(
    assessment: BillShockAssessment,
    *,
    hardship_detected: bool = False,
) -> AlertDecision:
    """The whole policy, in one call.

    `hardship_detected` comes from the conversation, not from the meter. A household
    can be well over a comparable home and perfectly able to afford it; what suppresses
    the alert is the customer having told us they are struggling.
    """
    tier = tier_for(assessment)
    if tier == 0:
        return AlertDecision(tier=0, channels=(), reasons=())

    # Escalating tiers stack rather than replace — see the module docstring.
    channels = tuple(TIER_CHANNELS[t] for t in range(1, tier + 1))
    reasons = tuple(assessment.reasons)

    if hardship_detected:
        return AlertDecision(
            tier=tier,
            channels=channels,
            reasons=reasons,
            suppressed=True,
            suppressed_because=(
                "hardship already detected on this conversation — this customer needs a "
                "person, not an automated warning about money"
            ),
        )

    return AlertDecision(tier=tier, channels=channels, reasons=reasons)
