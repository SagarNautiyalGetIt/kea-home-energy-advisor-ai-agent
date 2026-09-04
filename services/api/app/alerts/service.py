"""Dispatching an alert, and writing down that we did.

Ties the pure pieces together: `policy.decide` chooses the tier and the channels,
`render` composes each channel's message, `channels` delivers, and every outcome lands in
`app.alert` with a child row per channel in `app.alert_delivery`.

## Idempotency is the load-bearing property

The dashboard polls `/bill-shock`. If dispatch fired on every poll the first rehearsal
would send the customer an email every few seconds. The guard is the unique constraint
`(account_ref, kind, period, tier)` in the database, not a check in Python — a
check-then-insert races itself the moment there are two workers, and this is exactly the
code path where that would be discovered in front of an audience.

So the flow is: insert first, let the constraint reject a duplicate, and only send if the
insert won. A row that loses the race means somebody already sent it.

## Why the deliveries are a separate table

A tier-3 warning goes out on three channels, and `app.alert` has one `channel` column and
one `status`. Writing three outcomes into two fields means overwriting two of them, which
is how this repo previously produced rows reading `tier=2 channel=sms status=delivered`
when no SMS gateway existed and the email had done the work — a record claiming a
delivery that never happened, in the one table whose entire purpose is answering "through
which channel, and did it land".

`app.alert` stays the idempotency anchor. `app.alert_delivery` is the ledger, one row per
channel, with its own unique constraint so a deferred SMS is not re-queued every time the
scheduler runs.

## Failure never propagates

Same rule as the recorder: a customer asking about their bill gets their answer even if
the mail server is down. Dispatch failures are recorded on the delivery row
(`status='failed'` with a reason) and logged, never raised into the request path. An alert
nobody could send is a fact worth keeping; an exception that takes down `/bill-shock` is
not.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError

from app.alerts import render
from app.alerts.channels import GatewayRegistry, Notification
from app.alerts.policy import TIER_CHANNELS, AlertDecision, decide
from app.alerts.preferences import AlertPreferences
from app.analytics.billshock import BillShockAssessment
from app.db.models import Alert, AlertDelivery

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChannelResult:
    """One channel's outcome, as the UI and the alert row both see it."""

    channel: str
    status: str
    provider: str | None = None
    destination: str | None = None
    detail: str | None = None
    scheduled_for: datetime | None = None


@dataclass(frozen=True)
class DispatchResult:
    """What the API reports back. Rendered into the bill-shock response so the UI can
    show what was sent without a second request."""

    tier: int
    channels: tuple[str, ...]
    sent: tuple[str, ...]
    suppressed: bool
    confidence: float = 0.0
    detail: str | None = None
    #: Where tier 1 landed — an .eml path under the file backend. The demo points at it.
    destination: str | None = None
    already_sent: bool = False
    results: tuple[ChannelResult, ...] = field(default_factory=tuple)

    @property
    def deferred(self) -> tuple[str, ...]:
        return tuple(r.channel for r in self.results if r.status == "scheduled")


_NOTHING = DispatchResult(tier=0, channels=(), sent=(), suppressed=False)


class AlertDispatcher:
    """Stateless apart from its gateways and sessionmaker. One per process."""

    def __init__(self, registry: GatewayRegistry, sessionmaker) -> None:
        self._registry = registry
        self._sessionmaker = sessionmaker

    @property
    def name(self) -> str:
        return "database"

    def describe(self) -> dict[str, str]:
        return self._registry.describe()

    async def dispatch(
        self,
        *,
        account_ref: str,
        assessment: BillShockAssessment,
        preferences: AlertPreferences,
        period: str | None = None,
        customer_name: str | None = None,
        hardship_detected: bool = False,
        now: datetime | None = None,
    ) -> DispatchResult:
        moment = now or datetime.now(UTC)
        decision = decide(
            assessment, preferences, hardship_detected=hardship_detected, now=moment
        )
        if decision.tier == 0:
            return _NOTHING

        cycle = period or assessment.period
        subject = render.subject_for(assessment, decision.tier)
        body = render.body_for(assessment, decision, customer_name=customer_name)

        claimed = await self._claim(
            account_ref=account_ref,
            decision=decision,
            assessment=assessment,
            preferences=preferences,
            period=cycle,
            subject=subject,
            body=body,
        )
        if not claimed:
            # Another poll, another worker, or a page refresh. Not an error.
            log.debug("alert for %s %s tier=%d already exists", account_ref, cycle, decision.tier)
            return DispatchResult(
                tier=decision.tier,
                channels=decision.channels,
                sent=(),
                suppressed=decision.suppressed,
                confidence=decision.confidence,
                already_sent=True,
            )

        if decision.suppressed:
            await self._finish_alert(
                claimed, status="suppressed", detail=decision.suppressed_because
            )
            return DispatchResult(
                tier=decision.tier,
                channels=decision.channels,
                sent=(),
                suppressed=True,
                confidence=decision.confidence,
                detail=decision.suppressed_because,
            )

        results: list[ChannelResult] = []

        # Channels the tier calls for but the customer has switched off or given us no
        # address for. Recorded as `skipped`, never as `failed` — "we tried to text you"
        # in a customer's record when we never had a number is a false statement, and
        # this table is the one we would produce if asked to show what we did.
        for channel in decision.channels:
            if channel not in decision.eligible:
                reason = (
                    f"{channel} is switched off for this customer"
                    if not preferences.channel_allowed(channel)
                    else f"no {channel} address on file"
                )
                await self._record_delivery(
                    claimed, channel=channel, status="skipped", detail=reason
                )
                results.append(ChannelResult(channel, "skipped", detail=reason))

        # Quiet hours. Scheduled rather than dropped: the customer asked us not to ring at
        # 3am, not to never tell them. `scripts/dispatch_scheduled.py` picks these up.
        opens_at = preferences.next_open(moment)
        for channel in decision.deferred:
            await self._record_delivery(
                claimed,
                channel=channel,
                status="scheduled",
                scheduled_for=opens_at,
                detail=f"held until quiet hours end at {preferences.quiet_hours_end}:00",
            )
            results.append(ChannelResult(channel, "scheduled", scheduled_for=opens_at))

        # Everything left goes now, and goes concurrently. Three sequential HTTP calls to
        # three gateways is three timeouts deep in the worst case, on a request path the
        # dashboard is polling.
        sendable = decision.sendable
        if sendable:
            notes = [
                self._compose(channel, assessment, preferences, subject, body, customer_name)
                for channel in sendable
            ]
            outcomes = await asyncio.gather(
                *(self._send_one(claimed, note) for note in notes),
                return_exceptions=True,
            )
            for channel, outcome in zip(sendable, outcomes, strict=True):
                if isinstance(outcome, BaseException):
                    # A gateway raising something other than the errors it handles is a
                    # bug in that gateway, not a reason the customer loses their warning.
                    log.exception("gateway for %s raised", channel, exc_info=outcome)
                    await self._record_delivery(
                        claimed, channel=channel, status="failed", detail=repr(outcome)
                    )
                    results.append(ChannelResult(channel, "failed", detail=repr(outcome)))
                else:
                    results.append(outcome)

        delivered = tuple(r.channel for r in results if r.status == "delivered")
        await self._finish_alert(
            claimed,
            status="delivered" if delivered else "failed",
            detail=None if delivered else "no channel delivered",
        )

        email_result = next(
            (r for r in results if r.channel == "email" and r.status == "delivered"), None
        )
        return DispatchResult(
            tier=decision.tier,
            channels=decision.channels,
            sent=delivered,
            suppressed=False,
            confidence=decision.confidence,
            destination=email_result.destination if email_result else None,
            results=tuple(results),
        )

    def _compose(
        self,
        channel: str,
        assessment: BillShockAssessment,
        preferences: AlertPreferences,
        subject: str,
        body: str,
        customer_name: str | None,
    ) -> Notification:
        """One rendering per channel, from one set of figures.

        The address comes off the customer's preferences, not from a global setting. The
        previous version sent every alert to `KEA_DEMO_RECIPIENT` — one address for all
        fourteen households, which is correct for a rehearsal and indefensible the moment
        a real account exists.
        """
        if channel == "sms":
            return Notification(
                channel="sms",
                to=preferences.phone_e164 or "",
                subject=subject,
                body=render.sms_for(assessment),
            )
        if channel == "voice":
            return Notification(
                channel="voice",
                to=preferences.phone_e164 or "",
                subject=subject,
                body=body,
                voice_script=render.voice_script_for(assessment, customer_name=customer_name),
            )
        return Notification(channel="email", to=preferences.email or "", subject=subject, body=body)

    async def _send_one(self, alert_id: int, note: Notification) -> ChannelResult:
        gateway = self._registry.for_channel(note.channel)
        if gateway is None:
            detail = f"no gateway configured for {note.channel}"
            await self._record_delivery(
                alert_id, channel=note.channel, status="skipped", detail=detail
            )
            return ChannelResult(note.channel, "skipped", detail=detail)

        outcome = await gateway.send(note)
        segments = render.sms_segments(note.body) if note.channel == "sms" else None
        status = "delivered" if outcome.delivered else "failed"
        await self._record_delivery(
            alert_id,
            channel=note.channel,
            status=status,
            provider=outcome.provider,
            destination=outcome.destination,
            detail=outcome.detail,
            segments=segments,
        )
        return ChannelResult(
            channel=note.channel,
            status=status,
            provider=outcome.provider,
            destination=outcome.destination,
            detail=outcome.detail,
        )

    async def _claim(
        self,
        *,
        account_ref: str,
        decision: AlertDecision,
        assessment: BillShockAssessment,
        preferences: AlertPreferences,
        period: str,
        subject: str,
        body: str,
    ) -> int | None:
        """Insert the parent row. Returns its id, or None if this cycle+tier was already
        sent.

        Insert-then-catch rather than check-then-insert: the constraint is the only thing
        that holds under two workers, and this is the path that would discover it the
        hard way.
        """
        f = assessment.forecast
        row = Alert(
            account_ref=account_ref,
            kind="bill_shock",
            tier=decision.tier,
            # The tier's headline channel, as a label. What actually carried it is on the
            # delivery rows — see the module docstring on why those are separate.
            channel=TIER_CHANNELS[decision.tier],
            status="pending",
            subject=subject,
            body=body,
            facts={
                "projected_cycle_cost_nzd": f.projected_cost_nzd,
                "cost_range_nzd": [f.cost_p10_nzd, f.cost_p90_nzd],
                "expected_cost_nzd": assessment.expected_cost_nzd,
                "expectation_basis": assessment.expectation.basis.value,
                "overshoot_nzd": assessment.overshoot_nzd,
                "overshoot_pct": assessment.overshoot_pct,
                "forecast_method": f.method.value,
                "forecast_detail": f.method_detail,
                "attribution": {
                    "weather_nzd": assessment.attribution.weather_nzd,
                    "higher_use_nzd": assessment.attribution.behaviour_nzd,
                    "everyday_load_nzd": assessment.attribution.everyday_load_nzd,
                    "explained": assessment.attribution.explained,
                },
                "reasons": list(assessment.reasons),
                "confidence": decision.confidence,
                # The settings this was judged against, not the ones in force when
                # somebody reads the row later. A customer asking "why did you call me"
                # gets the thresholds that were live at the time.
                "thresholds_pct": preferences.thresholds,
                "thresholds_nzd": assessment.tier_thresholds_nzd,
                "tier_probabilities": assessment.tier_probabilities,
                "channels_intended": list(decision.channels),
                "channels_eligible": list(decision.eligible),
                "channels_deferred": list(decision.deferred),
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

    async def _record_delivery(
        self,
        alert_id: int,
        *,
        channel: str,
        status: str,
        provider: str | None = None,
        destination: str | None = None,
        detail: str | None = None,
        segments: int | None = None,
        scheduled_for: datetime | None = None,
    ) -> None:
        now = datetime.now(UTC)
        row = AlertDelivery(
            alert_id=alert_id,
            channel=channel,
            provider=provider,
            status=status,
            destination=destination,
            failure_reason=detail,
            segments=segments,
            scheduled_for=scheduled_for,
            sent_at=now if status in {"delivered", "failed"} else None,
            delivered_at=now if status == "delivered" else None,
        )
        try:
            async with self._sessionmaker() as session:
                session.add(row)
                await session.commit()
        except IntegrityError:
            # Already recorded for this alert and channel. The scheduler re-running over
            # a deferred row is the normal way this happens.
            log.debug("delivery row for alert=%s channel=%s already exists", alert_id, channel)
        except Exception:
            log.exception("could not record %s delivery for alert %s", channel, alert_id)

    async def _finish_alert(self, alert_id: int, *, status: str, detail: str | None) -> None:
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

    def describe(self) -> dict[str, str]:
        return {}

    async def dispatch(
        self,
        *,
        account_ref: str,
        assessment: BillShockAssessment,
        preferences: AlertPreferences,
        period: str | None = None,
        customer_name: str | None = None,
        hardship_detected: bool = False,
        now: datetime | None = None,
    ) -> DispatchResult:
        decision = decide(
            assessment, preferences, hardship_detected=hardship_detected, now=now
        )
        return DispatchResult(
            tier=decision.tier,
            channels=decision.channels,
            sent=(),
            suppressed=decision.suppressed,
            confidence=decision.confidence,
            detail="alerting is off (KEA_ALERTS_ENABLED=0)",
        )
