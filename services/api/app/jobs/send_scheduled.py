"""Release due intrusive alerts after rechecking current consent, data and quiet hours."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

from sqlalchemy import select, update

from app.alerts import render
from app.alerts.policy import decide
from app.alerts.store import has_hardship
from app.analytics.billshock import assess
from app.config import get_dispatcher, get_preferences_store, get_repository
from app.db.models import Alert, AlertDelivery
from app.db.session import get_sessionmaker
from app.pipeline import days_in_cycle


async def release_due() -> int:
    sessions = get_sessionmaker()
    dispatcher = get_dispatcher()
    released = 0
    async with sessions() as session:
        ids = list(
            await session.scalars(
                select(AlertDelivery.id)
                .where(
                    AlertDelivery.status == "scheduled",
                    AlertDelivery.scheduled_for <= datetime.now(UTC),
                )
                .limit(50)
            )
        )
    for delivery_id in ids:
        async with sessions() as session:
            row = await session.get(AlertDelivery, delivery_id)
            parent = await session.get(Alert, row.alert_id)
            prefs = await get_preferences_store().get(parent.account_ref)
            ctx = await get_repository().context(parent.account_ref)
            assessment = assess(
                ctx.window,
                days_in_cycle=max(days_in_cycle(ctx), len(ctx.window.daily_kwh)),
                daily_hdd=ctx.hdd[: len(ctx.window.daily_kwh)],
                normal_hdd_per_day=ctx.normal_hdd,
                comparable_home_kwh_per_day=ctx.baseline,
                preferences=prefs,
            )
            decision = decide(
                assessment,
                prefs,
                now=datetime.now(UTC),
                hardship_detected=await has_hardship(parent.account_ref),
            )
            if row.channel in decision.deferred:
                continue
            eligible = row.channel in decision.sendable and not decision.suppressed
            # Atomic claim commits before a provider call. Unknown/crashed sends are
            # never automatically retried, because SES/SNS have no idempotent send API.
            changed = await session.scalar(
                update(AlertDelivery)
                .where(AlertDelivery.id == delivery_id, AlertDelivery.status == "scheduled")
                .values(
                    status="sending" if eligible else "skipped",
                    failure_reason=None
                    if eligible
                    else "Current preferences or forecast prevent send",
                )
                .returning(AlertDelivery.id)
            )
            await session.commit()
            if not changed or not eligible:
                continue
            note = dispatcher._compose(
                channel=row.channel,
                preferences=prefs,
                assessment=assessment,
                subject=parent.subject,
                body=render.body_for(assessment, decision),
                customer_name=None,
            )
            gateway = dispatcher._registry.for_channel(row.channel)
            if gateway is None:
                raise RuntimeError("Claimed delivery has no configured gateway.")
            outcome = await gateway.send(
                replace(note, delivery_key=f"alert-{parent.id}-{row.channel}")
            )
            await session.execute(
                update(AlertDelivery)
                .where(AlertDelivery.id == delivery_id)
                .values(
                    status="delivered"
                    if outcome.delivered
                    else "queued"
                    if outcome.accepted
                    else "failed",
                    provider=outcome.provider,
                    destination=outcome.destination,
                    failure_reason=outcome.detail,
                    sent_at=datetime.now(UTC),
                    delivered_at=datetime.now(UTC) if outcome.delivered else None,
                )
            )
            if outcome.delivered:
                parent.status = "delivered"
                parent.delivered_at = datetime.now(UTC)
            elif outcome.accepted and parent.status != "delivered":
                parent.status = "queued"
            await session.commit()
            released += 1
    return released
