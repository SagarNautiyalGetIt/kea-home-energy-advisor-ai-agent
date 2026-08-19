"""Seed the five demo households with real half-hourly readings.

Idempotent: run it as often as you like. It clears and rebuilds the demo data, so a
rehearsal that ends with a mangled database is one `make seed` away from clean.

Each household exists to demonstrate exactly one finding, and each maps to a line in
docs/sprints/sprint-2/demo-script.md. A finding with no household can't be demoed; a
household serving no line is data nobody will see.

**H-JUL is the important one.** It is the real July 2026 Genesis household — the 31 measured
daily totals, spread across half-hourly intervals — so the pipeline reproduces the published
figures end to end rather than only in a unit test. If the seeded version stops reproducing
them, either the shape function or the analytics has drifted.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.analytics.fixtures import HOUSEHOLDS, REGION
from app.config import settings
from app.db.models import (
    Base,
    Benchmark,
    Conversation,
    Customer,
    CustomerTariff,
    Escalation,
    FactBundleRow,
    Meter,
    Reading,
    Tariff,
    TokenUsageRow,
    Turn,
    VerificationRow,
    WeatherDay,
)

NZ = dt.timezone(dt.timedelta(hours=12))  # NZST for July; see the note in _intervals()
JULY = dt.date(2026, 7, 1)
DAYS = 31

#: Illustrative only — Kea's real tariff is not public. Every surface showing a dollar
#: figure has to say so, which is why the flag lives on the row.
UNIT_PRICE = Decimal("0.30")
DAILY_FIXED = Decimal("1.50")


# ───────────────────────────── daily shapes ─────────────────────────────
#
# A household's day has a morning peak and a bigger evening peak. Spreading a daily total
# across 48 intervals with a realistic curve matters: the analytics work on daily totals
# today, but the voice demo and any future half-hourly analysis need the shape to be
# plausible. A flat 1/48th would look obviously synthetic on a chart.

_SHAPE = [
    # 00:00-06:00 — overnight floor (hot water cylinder, fridge, standby)
    *[0.55] * 12,
    # 06:00-09:00 — morning peak
    1.35, 1.70, 1.85, 1.60, 1.30, 1.05,
    # 09:00-16:00 — daytime trough
    *[0.70] * 14,
    # 16:00-21:00 — evening peak, the big one
    1.25, 1.65, 2.05, 2.30, 2.20, 1.95, 1.60, 1.35, 1.15, 1.00,
    # 21:00-24:00 — wind down
    0.85, 0.75, 0.65, 0.60, 0.58, 0.56,
]
assert len(_SHAPE) == 48, f"day shape must have 48 intervals, got {len(_SHAPE)}"
_SHAPE_SUM = sum(_SHAPE)


def _intervals(day: dt.date, daily_kwh: float) -> list[tuple[dt.datetime, Decimal]]:
    """Spread one day's total across 48 half-hourly readings.

    Timestamps are timezone-aware (ADR-0006). New Zealand is on NZST (UTC+12) through
    July, so a fixed offset is correct for this dataset — but any seeder covering a DST
    boundary must use a real zone (`zoneinfo.ZoneInfo("Pacific/Auckland")`), or readings
    land in the wrong day twice a year.
    """
    out = []
    for i, weight in enumerate(_SHAPE):
        start = dt.datetime.combine(day, dt.time(0, 0), tzinfo=NZ) + dt.timedelta(minutes=30 * i)
        kwh = Decimal(str(round(daily_kwh * weight / _SHAPE_SUM, 3)))
        out.append((start, kwh))
    return out





async def seed(session: AsyncSession) -> None:
    # Idempotent: wipe demo data in FK-safe order, then rebuild.
    for model in (
        Escalation, VerificationRow, TokenUsageRow, FactBundleRow, Turn, Conversation,
        Reading, Meter, CustomerTariff, Customer, Tariff, Benchmark, WeatherDay,
    ):
        await session.execute(delete(model))
    await session.flush()

    standard = Tariff(
        name="Kea Standard (illustrative)", plan_type="standard",
        unit_price_nzd=UNIT_PRICE, daily_fixed_nzd=DAILY_FIXED, is_illustrative=True,
    )
    low_fixed = Tariff(
        name="Low Fixed Charge (illustrative)", plan_type="low_fixed_charge",
        unit_price_nzd=Decimal("0.36"), daily_fixed_nzd=Decimal("0.30"), is_illustrative=True,
    )
    session.add_all([standard, low_fixed])
    await session.flush()

    # Weather, taken from the same series the API uses (app/analytics/fixtures) so the
    # database and the fixtures can never disagree about how cold July was.
    from app.analytics.fixtures import _HDD_JULY

    for offset, hdd in enumerate(_HDD_JULY):
        session.add(
            WeatherDay(
                region=REGION, day=JULY + dt.timedelta(days=offset),
                mean_temp_c=Decimal(str(round(18.0 - hdd, 2))),
                hdd_18=Decimal(str(hdd)),
            )
        )

    for h in HOUSEHOLDS:
        ref, label, daily, bench_kwh = h.ref, h.label, h.daily_kwh, h.benchmark_kwh_per_day
        benchmark = Benchmark(
            region=REGION, segment=f"similar-to-{ref}",
            kwh_per_day=Decimal(str(bench_kwh)),
            source=(
                "Genesis in-app comparison: 'you used 37% more than similar homes' "
                "(300.0 kWh / 1.37 / 31 days)"
                if ref == "H-JUL"
                else "Illustrative benchmark for the demo household"
            ),
        )
        session.add(benchmark)
        await session.flush()

        customer = Customer(
            external_ref=ref, region=REGION, label=label, benchmark_id=benchmark.id
        )
        session.add(customer)
        await session.flush()

        session.add(
            CustomerTariff(
                customer_id=customer.id,
                tariff_id=(low_fixed if ref == "H-TARIFF" else standard).id,
                valid_from=dt.date(2026, 1, 1),
            )
        )

        meter = Meter(customer_id=customer.id, icp=f"ICP{ref.replace('-', '')}0000001")
        session.add(meter)
        await session.flush()

        assert len(daily) == DAYS, f"{ref} needs {DAYS} daily totals, got {len(daily)}"
        for offset, total in enumerate(daily):
            day = JULY + dt.timedelta(days=offset)
            for start, kwh in _intervals(day, total):
                session.add(Reading(meter_id=meter.id, interval_start=start, kwh=kwh))

    await session.commit()


async def _verify(session: AsyncSession) -> None:
    """Sanity-check what we just wrote. Seeding silently wrong is worse than not seeding."""
    n_customers = len((await session.execute(select(Customer))).scalars().all())
    n_readings = len((await session.execute(select(Reading))).scalars().all())
    expected = len(HOUSEHOLDS) * DAYS * 48

    print(f"  {n_customers} households, {n_readings} readings (expected {expected})")
    assert n_readings == expected, "reading count is wrong — check the day shape"

    # The July household must still add up to the measured 300.0 kWh after being spread
    # across intervals and rounded. If this drifts, the analytics will disagree with the deck.
    cust = (
        await session.execute(select(Customer).where(Customer.external_ref == "H-JUL"))
    ).scalar_one()
    meter = (
        await session.execute(select(Meter).where(Meter.customer_id == cust.id))
    ).scalar_one()
    readings = (
        await session.execute(select(Reading).where(Reading.meter_id == meter.id))
    ).scalars().all()
    total = sum(r.kwh for r in readings)
    print(f"  H-JUL total: {total:.1f} kWh (measured 300.0)")
    assert abs(float(total) - 300.0) < 1.0, f"H-JUL should total ~300.0 kWh, got {total}"


async def main() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # no-op if migrations already ran

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        print("seeding...")
        await seed(session)
        await _verify(session)
    await engine.dispose()
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
