"""Dated hours from interval reads, never from a daily total or monthly profile."""

from __future__ import annotations

import datetime as dt
import logging
import math
from collections.abc import Iterable
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

from app.analytics.repository import UsageContext
from app.schemas import HourlyUsageSlot, HouseholdHourlyUsage

ZONE = ZoneInfo("Pacific/Auckland")
log = logging.getLogger(__name__)
Interval = tuple[int, dt.datetime, float, str]


def day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    return tuple(
        dt.datetime.combine(value, dt.time(), ZONE).astimezone(dt.UTC)
        for value in (day, day + dt.timedelta(days=1))
    )


def hourly_slots(
    day: dt.date, rows: Iterable[Interval], registers: set[int], *, demo: bool = False
) -> list[HourlyUsageSlot]:
    start, end = day_bounds(day)
    values: dict[tuple[int, dt.datetime], tuple[float, str]] = {}
    invalid: set[tuple[int, dt.datetime]] = set()
    for register, at, kwh, quality in rows:
        if at.tzinfo is None:
            continue
        at = at.astimezone(dt.UTC)
        if (
            register not in registers
            or not start <= at < end
            or (at - start).total_seconds() % 1800
        ):
            continue
        key = (register, at)
        if (
            key in values
            or not math.isfinite(kwh)
            or kwh < 0
            or quality not in {"actual", "validated", "estimated", "measured", "demo"}
        ):
            invalid.add(key)
        values[key] = (kwh, quality)
    slots = []
    at = start
    while at < end:
        keys = {
            (register, moment)
            for register in registers
            for moment in (at, at + dt.timedelta(minutes=30))
        }
        received = [values[key] for key in keys if key in values and key not in invalid]
        complete = bool(keys) and len(received) == len(keys)
        quality = (
            "missing"
            if not complete
            else "demo"
            if demo
            else "estimated"
            if any(row[1] == "estimated" for row in received)
            else "measured"
        )
        local = at.astimezone(ZONE)
        slots.append(
            HourlyUsageSlot(
                start=at,
                label=local.strftime("%H:%M %Z"),
                kwh=round(sum(row[0] for row in received), 4) if complete else None,
                quality=quality,
                intervals_received=len(received),
                expected_intervals=len(keys),
            )
        )
        at += dt.timedelta(hours=1)
    return slots


async def load_hourly(
    customer_id: str, day: dt.date, ctx: UsageContext, repository_name: str
) -> HouseholdHourlyUsage:
    source = "unavailable"
    note = (
        "This data source has daily totals only. Hourly readings are unavailable; "
        "missing hours are not zero."
    )
    rows: list[Interval] = []
    registers: set[int] = set()
    start, end = day_bounds(day)
    if repository_name == "fixtures" and isinstance(ctx.period_start, dt.date):
        index = (day - ctx.period_start).days
        if 0 <= index < len(ctx.window.daily_kwh):
            from app.analytics.demo_intervals import intervals

            rows = [
                (1, at, float(kwh), "demo")
                for at, kwh in intervals(day, ctx.window.daily_kwh[index])
            ]
            registers = {1}
            source = "demo"
            note = (
                "Illustrative demo hourly shape, not observed household behaviour. "
                "Daily totals are preserved; costs use an illustrative blended estimate."
            )
    elif repository_name != "fixtures":
        from app.db.session import get_sessionmaker

        try:
            async with get_sessionmaker()() as session:
                if ctx.icp_id is not None:
                    # Scope BOTH sides of the join by this validated account's ICP.
                    register_rows = await session.execute(
                        text(
                            "SELECT register_id FROM metering.meter_register "
                            "WHERE icp_id = :icp AND direction = 'import'"
                        ),
                        {"icp": ctx.icp_id},
                    )
                    registers = {int(row[0]) for row in register_rows}
                    result = await session.execute(
                        text(
                            "SELECT r.register_id, r.interval_start, r.kwh, r.quality::text "
                            "FROM metering.meter_read_hh r JOIN metering.meter_register m "
                            "ON m.icp_id = r.icp_id AND m.register_id = r.register_id "
                            "WHERE r.icp_id = :icp AND m.direction = 'import' "
                            "AND r.interval_start >= :start AND r.interval_start < :end "
                            "ORDER BY r.interval_start"
                        ),
                        {"icp": ctx.icp_id, "start": start, "end": end},
                    )
                    rows = [(int(r[0]), r[1], float(r[2]), r[3]) for r in result]
                    source = "intervals"
                    note = (
                        "Dated import intervals in New Zealand time. Estimated and missing "
                        "hours are marked. Cost uses the daily blended estimate, "
                        "not time-of-use pricing."
                    )
                else:
                    from app.db.models import Customer, Meter, Reading

                    meters = await session.execute(
                        select(Meter.id).join(Customer).where(Customer.external_ref == customer_id)
                    )
                    registers = set(meters.scalars())
                    if registers:
                        result = await session.execute(
                            select(Reading.meter_id, Reading.interval_start, Reading.kwh).where(
                                Reading.meter_id.in_(registers),
                                Reading.interval_start >= start,
                                Reading.interval_start < end,
                            )
                        )
                        rows = [(r[0], r[1], float(r[2]), "demo") for r in result]
                        source = "demo"
                        note = (
                            "Seeded demo intervals with a synthetic daily shape. "
                            "These hours are illustrative, not observed household behaviour."
                        )
        except Exception:  # noqa: BLE001 - an unavailable interval replica must not fabricate data
            log.warning("hourly interval source unavailable", exc_info=True)
            registers, rows = set(), []
            source = "unavailable"
            note = "The interval source could not be read. Daily totals may still be available."
    return HouseholdHourlyUsage(
        customer_id=customer_id,
        day=day,
        source=source,
        note=note,
        hours=hourly_slots(day, rows, registers, demo=source == "demo"),
    )
