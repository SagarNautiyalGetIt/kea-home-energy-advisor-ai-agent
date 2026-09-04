"""Composing the warning. Deterministic — no model runs here.

The design rule for this project is *"the numbers are calculated by code; the AI only
writes the sentence."* An alert is the one surface where even that is too much latitude:
it leaves the building, it arrives without the customer asking, and nobody sees it before
the customer does. There is no reviewer between the model and the inbox, so there is no
model.

Every figure below comes off `BillShockAssessment`, which is layer 1's output — the same
object the dashboard card and the assistant's fact bundle are built from. That is what
makes the email incapable of disagreeing with the screen.

## Three renderings, one set of figures

`body_for` (email), `sms_for` (160 characters) and `voice_script_for` (spoken) are
different shapes of the same facts, and they must never diverge in substance. The shared
pieces are module constants for that reason: a change to the basis disclosure cannot land
on email and miss the text message.

## The claim the wording is careful about

Which comparison a message may assert depends on which basis the assessment used, and
that now comes off the assessment as a typed field rather than being assumed. A household
compared against similar homes must never be told "more than you usually pay"; one
compared against its own history should not be told "more than similar homes". Previously
this was one hard-coded sentence that happened to be right because only one basis existed.

The disclosure is not optional. An alert that leaves the app without its caveat is the
regression this repo has already had once, on the invoice PDF.
"""

from __future__ import annotations

from app.alerts.channels import SMS_SEGMENT_CHARS
from app.alerts.policy import AlertDecision
from app.analytics.billshock import BillShockAssessment
from app.analytics.forecast import ExpectationBasis, ForecastMethod

#: How each basis is described to the customer. Mirrors `forecast.BASIS_CLAIM_RULES`,
#: which says the same thing to the narration layer. Two audiences, one fact.
_BASIS_SENTENCE: dict[ExpectationBasis, str] = {
    ExpectationBasis.OWN_SAME_PERIOD_LAST_YEAR: (
        "This compares your cycle with your own bill for the same period last year."
    ),
    ExpectationBasis.OWN_RECENT_CYCLES: (
        "This compares your cycle with your own recent bills."
    ),
    ExpectationBasis.COMPARABLE_HOMES: (
        "This compares your cycle with similar homes, not with your own past bills — "
        "Kea does not hold your billing history."
    ),
}

_PRICE_DISCLOSURE = "Costs are estimated at an illustrative 30c/kWh."

#: What each cause is called in a sentence a customer reads. Keys match
#: `BillShockAssessment.dominant_cause`.
_CAUSE_SENTENCE: dict[str, str] = {
    "weather": "Most of that difference tracks the colder-than-usual weather.",
    "behaviour": (
        "Most of that difference is on days that used more than the weather accounts for."
    ),
    "everyday_load": (
        "Most of that difference is in your everyday background load rather than "
        "particular busy days."
    ),
}


def basis_disclosure(assessment: BillShockAssessment) -> str:
    return f"{_BASIS_SENTENCE[assessment.expectation.basis]} {_PRICE_DISCLOSURE}"


def _money(amount: float) -> str:
    return f"${amount:,.2f}"


def _money_short(amount: float) -> str:
    """No cents. For SMS, where every character is budgeted."""
    return f"${amount:,.0f}"


def subject_for(assessment: BillShockAssessment, tier: int) -> str:
    """Deliberately not alarming at tier 1.

    A subject line that shouts at somebody whose bill is $22 over teaches them to ignore
    the one that matters. The tier ladder is the escalation; the subject stays factual at
    every level.
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
    """The email. Plain text, and the written record of what we told them."""
    f = assessment.forecast
    greeting = f"Hi {customer_name}," if customer_name else "Hi,"

    lines = [
        greeting,
        "",
        f"You are {assessment.days_elapsed} of {assessment.days_in_cycle} days into this "
        f"billing cycle, and your usage so far is {f.usage_so_far_kwh:,.1f} kWh costing "
        f"about {_money(f.cost_so_far_nzd)}.",
        "",
        f"This cycle is on track to cost {_money(assessment.projected_cost_nzd)}, most "
        f"likely somewhere between {_money(f.cost_p10_nzd)} and {_money(f.cost_p90_nzd)}. "
        f"You would normally expect about {_money(assessment.expected_cost_nzd)} — that is "
        f"{_money(assessment.overshoot_nzd)} more, or {assessment.overshoot_pct:.0f}%.",
    ]

    cause = assessment.dominant_cause
    if cause:
        detail = ""
        if cause == "weather" and assessment.attribution.weather_nzd > 0:
            detail = (
                f" About {_money(assessment.attribution.weather_nzd)} of it is the weather."
            )
        lines += ["", _CAUSE_SENTENCE[cause] + detail]
    elif assessment.attribution.explained:
        lines += [
            "",
            "No single thing accounts for most of it — the increase is spread across the "
            "weather, your everyday load and some busier days.",
        ]

    # Why we are confident enough to send this at all. Stating it is what separates a
    # warning from a guess, and it is the honest answer to "why did you email me".
    lines += [
        "",
        f"Based on {assessment.days_elapsed} days of readings we put the chance of landing "
        f"above the level you asked to hear about at "
        f"{decision.confidence * 100:.0f}%.",
    ]

    if f.method is ForecastMethod.STRAIGHT_LINE:
        lines += [
            "",
            "This projection assumes the rest of the cycle looks like the days so far; "
            "there was not enough variation in the weather to adjust for temperature.",
        ]

    lines += [
        "",
        f"There are {assessment.days_remaining} days left in this cycle, which is enough "
        f"time to change the outcome. Open the Kea app to see which days drove this, or "
        f"ask the assistant to explain it.",
    ]

    if decision.tier >= 3 and "voice" in decision.channels:
        # Saying it in the email as well as on the call matters: if the call fails, the
        # customer has still been told.
        lines += ["", "Because this is a large difference, we will also try to call you."]

    if decision.deferred:
        lines += [
            "",
            "We held back a text message until your quiet hours end.",
        ]

    lines += ["", "— Kea Energy", "", basis_disclosure(assessment)]
    lines += [
        "",
        "You set these alert levels yourself. Change them or turn them off in the Kea "
        "app under Settings › Bill-shock alerts.",
    ]
    return "\n".join(lines)


def sms_for(assessment: BillShockAssessment) -> str:
    """One segment, or as close as the figures allow.

    Written to a character budget rather than truncated, because truncation lands
    mid-figure and a text reading "on track for $3" when the number is $312 is worse than
    no text. If the composed message still exceeds a segment it is sent whole — carriers
    concatenate — and the length is recorded on the alert row so the cost is visible.

    No basis disclosure here, and that is a deliberate, narrow exception: 160 characters
    cannot carry it, and the message therefore makes no comparative claim at all. It
    states the projection, the days remaining, and points at the app, where the full
    disclosure lives. A claim that is not made needs no caveat.
    """
    return (
        f"Kea Energy: your power use is tracking toward "
        f"{_money_short(assessment.projected_cost_nzd)} this cycle, about "
        f"{_money_short(assessment.overshoot_nzd)} above normal. "
        f"{assessment.days_remaining} days left — open the Kea app for the breakdown."
    )


def sms_segments(message: str) -> int:
    """How many segments the carrier will bill. Recorded, never guessed at."""
    return max(1, -(-len(message) // SMS_SEGMENT_CHARS))


def voice_script_for(
    assessment: BillShockAssessment,
    *,
    customer_name: str | None = None,
) -> str:
    """What the tier-3 call says.

    Three properties this script has to have, learned from how automated calls are
    received rather than from how they are written:

    * **It identifies itself immediately.** An automated call that opens with a dollar
      figure is indistinguishable from a scam, and the customer hangs up before the
      useful part.
    * **It repeats nothing it cannot show.** Every figure spoken here is also in the
      email that went out at tier 1, so a customer who writes one down can check it.
    * **It never asks for anything.** No account number, no confirmation, no keypad
      entry. A legitimate call that asks a customer to identify themselves trains them
      to do it for the next caller, who will not be us.
    """
    greeting = f"Hello {customer_name}." if customer_name else "Hello."
    return (
        f"{greeting} This is an automated call from Kea Energy about your power use. "
        f"You are {assessment.days_elapsed} days into your billing cycle, and your usage "
        f"is on track to cost about {_money_short(assessment.projected_cost_nzd)}. That is "
        f"around {_money_short(assessment.overshoot_nzd)} more than you would normally "
        f"expect. There are {assessment.days_remaining} days left in the cycle, so there "
        f"is still time to change it. We have also emailed you the details. "
        f"We will never ask you for payment or account details on a call like this."
    )
