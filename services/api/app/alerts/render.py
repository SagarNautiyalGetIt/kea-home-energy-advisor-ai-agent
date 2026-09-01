"""Composing the warning message. Deterministic — no model runs here.

The design rule for this project is *"the numbers are calculated by code; the AI only
writes the sentence."* An alert is the one surface where even that is too much latitude:
it leaves the building, it arrives without the customer asking, and nobody sees it
before the customer does. There is no reviewer between the model and the inbox, so
there is no model.

Every figure below comes off `BillShockAssessment`, which is layer 1's output — the
same object the dashboard card and the assistant's fact bundle are built from. That is
what makes the email incapable of disagreeing with the screen.

## The claim this wording is careful about

*"More than similar homes"*, never *"more than you usually pay"*. The seeded data is a
single cycle; there is no billing history behind this, so the second claim is
unknowable and asserting it would be the exact fabrication the product exists to
prevent. The basis line at the foot of every message says so in plain words, and it is
not optional — an alert that leaves the app without its caveat is the regression this
repo has already had once, on the invoice PDF.
"""

from __future__ import annotations

from app.alerts.policy import AlertDecision
from app.analytics.engine import EARLY_CYCLE_DAYS, BillShockAssessment

#: Repeated verbatim on every channel. Kept as one constant so a change to the wording
#: cannot land on email and miss SMS.
BASIS = (
    "This compares your cycle with similar homes, not with your own past bills — "
    "Kea does not hold your billing history. Costs are estimated at an illustrative "
    "30c/kWh."
)

#: Below this many elapsed days the projection is real but unsettled. Testing showed
#: households that trigger around day 7 on evidence that later settles; suppressing
#: them would defeat a prevention agent, so the message hedges instead.
EARLY_CYCLE_HEDGE = (
    "It is still early in the cycle, so treat this as a direction rather than a final "
    "figure — it will firm up over the next few days."
)


def _money(amount: float) -> str:
    return f"${amount:,.2f}"


def subject_for(assessment: BillShockAssessment, tier: int) -> str:
    """Deliberately not alarming at tier 1.

    A subject line that shouts at somebody whose bill is $22 over teaches them to
    ignore the one that matters. The tier ladder is the escalation; the subject stays
    factual at every level.
    """
    if tier >= 3:
        return (
            f"Your power bill is heading for {_money(assessment.projected_cost_nzd)} "
            f"— {assessment.days_remaining} days left to change it"
        )
    if tier == 2:
        return f"Heads up: this cycle is tracking {_money(assessment.overshoot_nzd)} high"
    return "Your energy use this cycle — a quick heads up from Kea Energy"


def body_for(
    assessment: BillShockAssessment,
    decision: AlertDecision,
    *,
    customer_name: str | None = None,
) -> str:
    """The message. Plain text, because it has to read identically as an SMS, as an
    email, and as the script a voice call would follow."""
    greeting = f"Hi {customer_name}," if customer_name else "Hi,"

    lines = [
        greeting,
        "",
        f"You are {assessment.days_elapsed} of {assessment.days_in_cycle} days into this "
        f"billing cycle, and your usage so far is {assessment.usage_so_far_kwh:,.1f} kWh "
        f"costing about {_money(assessment.cost_so_far_nzd)}.",
        "",
        f"At this rate the cycle is on track to cost {_money(assessment.projected_cost_nzd)}. "
        f"A comparable home would run to about {_money(assessment.expected_cost_nzd)} — "
        f"that is {_money(assessment.overshoot_nzd)} more, or "
        f"{assessment.overshoot_pct:.0f}%.",
    ]

    if "rising_within_cycle" in assessment.reasons:
        lines += [
            "",
            f"Your daily use has also risen {assessment.recent_trend_pct:.0f}% since the "
            f"start of the cycle.",
        ]

    if assessment.days_elapsed < EARLY_CYCLE_DAYS:
        lines += ["", EARLY_CYCLE_HEDGE]

    lines += [
        "",
        f"There are {assessment.days_remaining} days left in this cycle, which is enough "
        f"time to change the outcome. Open the Kea app to see which days drove this, or "
        f"ask the assistant to explain it.",
    ]

    # Tier 3 says a person is coming. Saying it in the email as well as on the call
    # matters: if the call fails, the customer has still been told.
    if decision.tier >= 3:
        lines += [
            "",
            "Because this is a large difference, someone from our team will also try to "
            "reach you.",
        ]

    lines += ["", "— Kea Energy", "", BASIS]
    return "\n".join(lines)
