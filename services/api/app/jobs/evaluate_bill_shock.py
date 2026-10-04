"""The proactive half, driven by a clock instead of a browser.

## Why this exists

`GET /households/{id}/bill-shock` used to dispatch alerts as a side effect of the
dashboard polling it. Two things wrong with that, and the second is the serious one:

* A GET with side effects is an HTTP anti-pattern. Any prefetch, any crawler, any
  double-render sends a customer an email.
* **It made a proactive product depend on somebody having the page open.** The entire
  premise is that the warning reaches the customer *before* the bill does. A warning that
  only fires when they visit the dashboard is a warning for people who were already
  looking, which is the group that needed it least.

So evaluation runs on a schedule (EventBridge, hourly — see `infra/aws/main.tf`) and the
GET became a read again. Both call the same `billshock.assess` and the same dispatcher, and
the dispatcher's unique constraint on `(account_ref, kind, period, tier)` means the two
paths cannot double-send.

## Why hourly rather than daily

Because it is also what releases alerts held back by a customer's quiet hours. A daily job
would hold a 9pm text until the following morning's run, which is not "quiet hours", it is
"tomorrow". Hourly costs nothing — the free tier is 14 million invocations and this is 24
a day.

## Failure policy

One household's failure must not stop the sweep. A household whose meter data is missing,
whose preferences row is malformed, or whose gateway times out is logged and skipped; the
run continues and the summary reports how many were skipped. The alternative — raising on
the first bad row — means one broken household silently suppresses every other
household's warning, and the failure would be invisible because nothing was sent.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from app.alerts.store import has_hardship
from app.analytics import billshock
from app.config import get_dispatcher, get_preferences_store, get_repository, settings
from app.pipeline import days_in_cycle

log = logging.getLogger(__name__)

#: How many households are assessed at once. The work is I/O-bound (a repository read, a
#: preferences read, up to three gateway calls), so this is about not opening 140,000
#: connections at once rather than about CPU. Sized to the RDS t4g.micro's connection
#: limit with room for the request path to keep serving.
CONCURRENCY = 8


@dataclass
class RunSummary:
    """What happened, in the shape a CloudWatch metric filter can read off the log line."""

    evaluated: int = 0
    triggered: int = 0
    sent: int = 0
    suppressed: int = 0
    already_sent: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "evaluated": self.evaluated,
            "triggered": self.triggered,
            "sent": self.sent,
            "suppressed": self.suppressed,
            "already_sent": self.already_sent,
            "skipped": self.skipped,
            # Truncated: a run where every household failed would otherwise write a log
            # line large enough to be its own cost line.
            "errors": self.errors[:10],
        }


async def evaluate_one(customer_id: str, summary: RunSummary) -> None:
    repository = get_repository()
    store = get_preferences_store()
    dispatcher = get_dispatcher()

    ctx = await repository.context(customer_id)
    prefs = await store.get(customer_id)

    # Same demo fallback the request path uses, and for the same reason — the seeded
    # households carry no personal details by design. A real deployment leaves these
    # unset and the policy layer correctly reports "no address on file".
    patch: dict[str, str] = {}
    if settings.demo_logins and not prefs.email and settings.demo_recipient:
        patch["email"] = settings.demo_recipient
    if settings.demo_logins and not prefs.phone_e164 and settings.demo_phone:
        patch["phone_e164"] = settings.demo_phone
    if patch:
        prefs = prefs.model_copy(update=patch)

    assessment = billshock.assess(
        ctx.window,
        days_in_cycle=max(days_in_cycle(ctx), len(ctx.window.daily_kwh)),
        daily_hdd=ctx.hdd[: len(ctx.window.daily_kwh)],
        normal_hdd_per_day=ctx.normal_hdd,
        comparable_home_kwh_per_day=ctx.baseline,
        preferences=prefs,
    )

    summary.evaluated += 1
    if not assessment.triggered:
        return

    summary.triggered += 1
    result = await dispatcher.dispatch(
        account_ref=customer_id,
        assessment=assessment,
        preferences=prefs,
        period=ctx.window.period,
        hardship_detected=await has_hardship(customer_id),
    )

    if result.already_sent:
        summary.already_sent += 1
    elif result.suppressed:
        summary.suppressed += 1
    elif result.sent:
        summary.sent += 1

    log.info(
        "bill-shock evaluated customer=%s tier=%d sent=%s deferred=%s confidence=%.2f",
        customer_id,
        result.tier,
        list(result.sent),
        list(result.deferred),
        result.confidence,
    )


async def run(customer_ids: list[str] | None = None) -> RunSummary:
    """Sweep every household. Never raises for one household's sake."""
    summary = RunSummary()
    ids = customer_ids if customer_ids is not None else await get_repository().all_ids()
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def guarded(customer_id: str) -> None:
        async with semaphore:
            try:
                await evaluate_one(customer_id, summary)
            except Exception as exc:  # noqa: BLE001 — one bad household must not stop the run
                summary.skipped += 1
                summary.errors.append(f"{customer_id}: {exc}")
                log.exception("bill-shock evaluation failed for %s", customer_id)

    await asyncio.gather(*(guarded(customer_id) for customer_id in ids))

    if settings.persist and settings.alerts_enabled:
        from app.jobs.send_scheduled import release_due
        try:
            await release_due()
        except Exception:
            summary.skipped += 1
            summary.errors.append("Scheduled release failed; inspect the delivery ledger.")
            log.exception("Scheduled release failed")

    log.info("bill-shock sweep complete %s", summary.as_dict())
    return summary


def handler(event: dict | None = None, context: object | None = None) -> dict[str, object]:
    """Lambda entry point. Referenced by `infra/aws/main.tf`.

    Returns the summary rather than logging it and returning None: EventBridge records the
    payload, so a run's outcome is retrievable without going to CloudWatch Logs, and a
    metric filter can alarm on `sent` being zero for a day.
    """
    return asyncio.run(run()).as_dict()


if __name__ == "__main__":  # pragma: no cover — local sweep, same code path as Lambda
    logging.basicConfig(level=logging.INFO)
    print(asyncio.run(run()).as_dict())
