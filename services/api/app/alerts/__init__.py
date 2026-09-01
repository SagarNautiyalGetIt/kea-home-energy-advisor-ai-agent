"""Proactive contact — the half of the product that does not wait to be asked.

The bill-shock warning has to reach the customer *before* the bill does, which is why
it has its own endpoint rather than living in the chat pipeline. This package is what
happens after that endpoint decides something is wrong.

    policy.decide()   how bad is it -> tier 1/2/3, and which channels   (pure)
    render.body_for() the message, composed from verified figures       (pure)
    email.send()      tier 1 delivery: file sink, or SMTP               (I/O)
    service.dispatch  ties them together and writes app.alert           (I/O)

Three of the four are pure and testable without a database, a model or a mail server.
That split is deliberate: the tier decides whether somebody's phone rings.
"""

from app.alerts.policy import TIER_CHANNELS, AlertDecision, decide, tier_for
from app.alerts.service import AlertDispatcher, DispatchResult, NullDispatcher

__all__ = [
    "TIER_CHANNELS",
    "AlertDecision",
    "AlertDispatcher",
    "DispatchResult",
    "NullDispatcher",
    "decide",
    "tier_for",
]
