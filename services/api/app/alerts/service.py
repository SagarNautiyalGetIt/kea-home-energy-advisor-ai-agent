"""Dispatching an alert, and writing down that we did.

Ties the three pure pieces together: `policy.decide` chooses the tier, `render` composes
the message, `email` delivers tier 1, and every outcome lands in `app.alert`.

## Idempotency is the load-bearing property

The dashboard polls `/bill-shock`. If dispatch fired on every poll the first rehearsal
would send the customer an email every few seconds. The guard is the unique constraint
`(account_ref, kind, period, tier)` in the database, not a check in Python — a
check-then-insert races itself the moment there are two workers, and this is exactly
the code path where that would be discovered in front of an audience.

So the flow is: insert first, let the constraint reject a duplicate, and only send if
the insert won. A row that loses the race means somebody already sent it.

## Failure never propagates

Same rule as the recorder: a customer asking about their bill gets their answer even if
the mail server is down. Dispatch failures are recorded on the row (`status='failed'`
with a reason) and logged, never raised into the request path. An alert nobody could
send is a fact worth keeping; an exception that takes down `/bill-shock` is not.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError

from app.alerts import render
from app.alerts.email import EmailSender
from app.alerts.policy import AlertDecision, decide
from app.analytics.engine import BillShockAssessment
from app.db.models import Alert

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DispatchResult:
    """What the API reports back. Rendered into the bill-shock response so the UI can
    show what was sent without a second request."""

    tier: int
    channels: tuple[str, ...]
    sent: tuple[str, ...]
    suppressed: bool
    detail: str | None = None
    #: Where tier 1 landed — an .eml path under the file backend. The demo points at it.
    destination: str | None = None
    already_sent: bool = False


_NOTHING = DispatchResult(tier=0, channels=(), sent=(), suppressed=False)


class AlertDispatcher:
    """Stateless apart from its sender and sessionmaker. One per process."""

    def __init__(self, sender: EmailSender, sessionmaker) -> None:
        self._sender = sender
        self._sessionmaker = sessionmaker

    async def dispatch(
        self,
        *,
        account_ref: str,
        assessment: BillShockAssessment,
        period: str,
        recipient_email: str | None,
        customer_name: str | None = None,
        hardship_detected: bool = False,
    ) -> DispatchResult:
        decision = decide(assessment, hardship_detected=hardship_detected)
        if decision.tier == 0:
            return _NOTHING

        subject = render.subject_for(assessment, decision.tier)
        body = render.body_for(assessment, decision, customer_name=customer_name)

        claimed = await self._claim(
            account_ref=account_ref,
            decision=decision,
            assessment=assessment,
            period=period,
            subject=subject,
            body=body,
        )
        if not claimed:
            # Another poll, another worker, or a page refresh. Not an error.
            log.debug("alert for %s %s tier=%d already exists", account_ref, period, decision.tier)
            return DispatchResult(
                tier=decision.tier,
                channels=decision.channels,
                sent=(),
                suppressed=decision.suppressed,
                already_sent=True,
            )

        if decision.suppressed:
            await self._finish(claimed, status="suppressed", detail=decision.suppressed_because)
            return DispatchResult(
                tier=decision.tier,
                channels=decision.channels,
                sent=(),
                suppressed=True,
                detail=decision.suppressed_because,
            )

        # Tier 1 is the only channel with a gateway. Tiers 2 and 3 are recorded above
        # and left `pending` — see policy.DELIVERABLE_TIERS.
        if not recipient_email:
            await self._finish(
                claimed, status="failed", detail="no email address on the account context"
            )
            return DispatchResult(
                tier=decision.tier,
                channels=decision.channels,
                sent=(),
                suppressed=False,
                detail="no email address on the account context",
            )

        outcome = self._sender.send(to=recipient_email, subject=subject, body=body)
        await self._finish(
            claimed,
            status="delivered" if outcome.delivered else "failed",
            detail=outcome.detail,
        )

        return DispatchResult(
            tier=decision.tier,
            channels=decision.channels,
            sent=("email",) if outcome.delivered else (),
            suppressed=False,
            detail=outcome.detail,
            destination=outcome.destination,
        )

    async def _claim(
        self,
        *,
        account_ref: str,
        decision: AlertDecision,
        assessment: BillShockAssessment,
        period: str,
        subject: str,
        body: str,
    ) -> int | None:
        """Insert the row. Returns its id, or None if this cycle+tier was already sent.

        Insert-then-catch rather than check-then-insert: the constraint is the only
        thing that holds under two workers, and this is the path that would discover it
        the hard way.
        """
        row = Alert(
            account_ref=account_ref,
            kind="bill_shock",
            tier=decision.tier,
            # The channel that will actually carry this, NOT the tier's headline channel.
            # Writing TIER_CHANNELS[tier] here produced rows reading
            # `tier=2 channel=sms status=delivered` when no SMS gateway exists and the
            # email did the work — a record claiming a delivery that never happened, in
            # the one table whose entire purpose is answering "through which channel,
            # and did it land". The tier still carries the severity; `facts` carries the
            # ladder that was intended and the rungs that are not wired.
            channel=(decision.deliverable_channels() or ("none",))[-1],
            status="pending",
            subject=subject,
            body=body,
            facts={
                "projected_cycle_cost_nzd": assessment.projected_cost_nzd,
                "comparable_home_cost_nzd": assessment.expected_cost_nzd,
                "overshoot_nzd": assessment.overshoot_nzd,
                "overshoot_pct": assessment.overshoot_pct,
                "recent_trend_pct": assessment.recent_trend_pct,
                "reasons": list(assessment.reasons),
                "channels_intended": list(decision.channels),
                "channels_not_wired": [
                    c for c in decision.channels if c not in decision.deliverable_channels()
                ],
            },
            period=period,
            as_at_day=assessment.days_elapsed,
        )
        try:
            async with self._sessionmaker() as session:
                session.add(row)
                await session.commit()
                return row.id
        except IntegrityError:
            return None
        except Exception:
            # Never costs the customer their warning on screen. Same rule as recorder.py.
            log.exception("could not record alert for %s", account_ref)
            return None

    async def _finish(self, alert_id: int, *, status: str, detail: str | None) -> None:
        try:
            async with self._sessionmaker() as session:
                row = await session.get(Alert, alert_id)
                if row is None:
                    return
                row.status = status
                row.failure_reason = detail
                now = datetime.now(UTC)
                row.sent_at = now
                if status == "delivered":
                    row.delivered_at = now
                await session.commit()
        except Exception:
            log.exception("could not update alert %s to %s", alert_id, status)


class NullDispatcher:
    """What runs when persistence is off — the normal state for frontend work and CI.

    Returns the tier so the UI can still show the escalation ladder, and sends nothing.
    Disclosed on `/health` alongside the recorder, for the same reason: "no alerts were
    sent" and "alerts are switched off" must not look identical from the outside.
    """

    name = "off"

    async def dispatch(
        self,
        *,
        account_ref: str,
        assessment: BillShockAssessment,
        period: str,
        recipient_email: str | None,
        customer_name: str | None = None,
        hardship_detected: bool = False,
    ) -> DispatchResult:
        decision = decide(assessment, hardship_detected=hardship_detected)
        return DispatchResult(
            tier=decision.tier,
            channels=decision.channels,
            sent=(),
            suppressed=decision.suppressed,
            detail="alerting is off (KEA_ALERTS_ENABLED=0)",
        )
