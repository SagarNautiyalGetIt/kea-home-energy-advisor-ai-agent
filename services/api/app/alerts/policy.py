"""How loudly to say it — pure Python, no I/O.

`billshock.assess` answers *whether* a cycle is heading somewhere expensive. This answers
*who hears about it and through which pipe*. Kept separate and kept pure for the same
reason layer 1 is: this decides whether a customer's phone rings, and that has to be
testable without a mail server, a gateway account or a database.

## The ladder, now on two axes

==== ============ ========================= ==================== ==========================
tier channel      fires when overshoot      and we are this      rationale
                  clears                    confident
==== ============ ========================= ==================== ==========================
1    email        their tier-1 setting      60%                  in writing, costs nothing
                                                                 to be wrong
2    sms          their tier-2 setting      75%                  interrupts them
3    voice        their tier-3 setting      90%                  a person's time, and theirs
==== ============ ========================= ==================== ==========================

The percentages come from the customer (`preferences.py`). The confidence floors do not —
see that module for why rigour is not a user setting. Together they replace the old fixed
`$60 / 40%` and `$120 / 75%` constants, which knew nothing about either the household's
tolerance or the strength of the evidence.

The confidence axis is what makes the ladder safe to hand to a customer. Somebody who
sets 20% across the board still will not be rung on day four, because on day four the
prediction interval is too wide for a 90% probability to exist. That property comes from
the maths rather than from a `if days_elapsed < 10` guard, which is what the previous
version had and which could be — and was — bypassed by anything that constructed an
assessment differently.

## Four rules that are not thresholds

**Escalating tiers do not replace the tier below.** A tier-3 customer gets the email *and*
the call. A call that goes to voicemail is not a substitute for the written record, and
the written record is what the Consumer Care Obligations expect a retailer to produce.

**Hardship suppresses escalation entirely.** If the conversation has already detected
payment difficulty, an automated "you are about to spend $340" is at best useless and at
worst cruel. That customer needs a person, which is what `escalation` is for. The tier is
still computed and the alert still written with `status='suppressed'`, so the fact that we
knew and chose not to send is on the record.

**Quiet hours defer the noisy channels, never the email.** Email does not make a sound at
3 am, and holding it back would delay the one artefact we are obliged to be able to
produce. SMS and voice wait until the window opens.

**A channel with no address is not a failure, it is a gap.** No phone number on file means
tier 2 downgrades to what *can* be delivered and says so on the row. Recording it as a
failed SMS would put "we tried to text you" in a customer's record when we never had a
number.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from app.alerts.preferences import CONFIDENCE_FLOORS, AlertPreferences

if TYPE_CHECKING:  # pragma: no cover - import cycle avoidance, not a runtime dependency
    from app.analytics.billshock import BillShockAssessment

#: Which pipe each tier uses. Separate from the tier itself because the mapping is
#: policy: a customer who has opted out of email still has a tier-1 alert.
TIER_CHANNELS: dict[int, str] = {1: "email", 2: "sms", 3: "voice"}

#: Channels that wake somebody up. Held back during quiet hours.
INTRUSIVE_CHANNELS: frozenset[str] = frozenset({"sms", "voice"})


@dataclass(frozen=True)
class AlertDecision:
    """What to send, on which channels, and why — or why not.

    Four channel lists rather than one, because "what the tier calls for", "what this
    customer allows", "what we have an address for" and "what is going out right now" are
    four different things and collapsing them is how a record ends up claiming a delivery
    that never happened. The previous version had exactly that bug — rows reading
    `tier=2 channel=sms status=delivered` when no SMS gateway existed.
    """

    tier: int
    #: Every channel this tier calls for, lowest first. What the UI greys out.
    channels: tuple[str, ...]
    #: The subset the customer has switched on and given us an address for.
    eligible: tuple[str, ...]
    #: Eligible, but held until quiet hours end.
    deferred: tuple[str, ...]
    reasons: tuple[str, ...]
    #: P(overshoot clears the threshold) at the tier that fired. Goes on the alert row,
    #: so a customer asking "why did you text me" gets a number rather than a shrug.
    confidence: float = 0.0
    suppressed: bool = False
    suppressed_because: str | None = None

    @property
    def should_send(self) -> bool:
        return self.tier > 0 and not self.suppressed and bool(self.sendable)

    @property
    def sendable(self) -> tuple[str, ...]:
        """Eligible and not deferred. What the dispatcher actually attempts."""
        return tuple(c for c in self.eligible if c not in self.deferred)


def tier_for(
    assessment: BillShockAssessment,
    preferences: AlertPreferences,
) -> tuple[int, float]:
    """The highest tier whose threshold and confidence floor are both cleared.

    Returns `(tier, confidence)`. Walks downward from 3 so a household clearing tier 3
    does not stop at tier 1 — and because the thresholds are customer-set, tier 3 can be
    cleared while tier 2 is not if somebody set them equal. Taking the highest satisfied
    tier is the right reading of "call me at 60%, text me at 60%": both fire.
    """
    for tier in (3, 2, 1):
        probability = assessment.tier_probabilities.get(tier, 0.0)
        if probability >= CONFIDENCE_FLOORS[tier]:
            return tier, probability
    return 0, assessment.tier_probabilities.get(1, 0.0)


def decide(
    assessment: BillShockAssessment,
    preferences: AlertPreferences,
    *,
    hardship_detected: bool = False,
    now: datetime | None = None,
) -> AlertDecision:
    """The whole policy, in one call.

    `hardship_detected` comes from the conversation, not from the meter. A household can
    be well over its own expectation and perfectly able to afford it; what suppresses the
    alert is the customer having told us they are struggling.
    """
    if not preferences.enabled:
        return AlertDecision(
            tier=0,
            channels=(),
            eligible=(),
            deferred=(),
            reasons=(),
            suppressed=True,
            suppressed_because="the customer has turned bill-shock alerts off",
        )

    tier, confidence = tier_for(assessment, preferences)
    if tier == 0:
        return AlertDecision(tier=0, channels=(), eligible=(), deferred=(), reasons=())

    # Escalating tiers stack rather than replace — see the module docstring.
    channels = tuple(TIER_CHANNELS[t] for t in range(1, tier + 1))
    reasons = tuple(assessment.reasons)

    if hardship_detected:
        return AlertDecision(
            tier=tier,
            channels=channels,
            eligible=(),
            deferred=(),
            reasons=reasons,
            confidence=confidence,
            suppressed=True,
            suppressed_because=(
                "hardship already detected on this conversation — this customer needs a "
                "person, not an automated warning about money"
            ),
        )

    eligible = tuple(
        c for c in channels if preferences.channel_allowed(c) and _has_address(c, preferences)
    )

    quiet = preferences.in_quiet_hours(now)
    deferred = tuple(c for c in eligible if quiet and c in INTRUSIVE_CHANNELS)

    if not eligible:
        return AlertDecision(
            tier=tier,
            channels=channels,
            eligible=(),
            deferred=(),
            reasons=reasons,
            confidence=confidence,
            suppressed=True,
            suppressed_because=(
                "no channel is both switched on and has a contact address on file"
            ),
        )

    return AlertDecision(
        tier=tier,
        channels=channels,
        eligible=eligible,
        deferred=deferred,
        reasons=reasons,
        confidence=confidence,
    )


def _has_address(channel: str, preferences: AlertPreferences) -> bool:
    if channel == "email":
        return bool(preferences.email)
    if channel in {"sms", "voice"}:
        return bool(preferences.phone_e164)
    return False
