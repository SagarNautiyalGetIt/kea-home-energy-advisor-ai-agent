"""KEA-33 — where usage data comes from.

Until now `routes.py` imported `app.analytics.fixtures` directly, so the database was
decorative: the schema existed, the seeder filled it, and no request ever read a row.

## The shape, and why it is this shape

I/O is async and layer 1 is not. Rather than making the analytics async — which would
spread `await` through pure arithmetic and make the golden set need an event loop — the
split is:

    await repo.context(customer_id)   ->  UsageContext   (I/O, here)
    bundle_from_context(intent, ctx)  ->  FactBundle     (pure, engine + routes)

One bundle builder, two sources for its input. That matters more than it looks: the
alternative — a fixture path and a database path each assembling their own bundle —
drifts within a week, and the drift shows up as the demo disagreeing with the tests.

`FixtureRepository` is not a test double. It is what runs when the API is started
without a database, which is the normal state for frontend work and for CI. As with the
recorder, the choice is disclosed on `/health` rather than being silent, because
"analytics served from a Python file" and "analytics served from PostgreSQL" should
never be indistinguishable from the outside.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import func, select

from app.analytics.engine import UsageWindow


@dataclass(frozen=True)
class UsageContext:
    """Everything layer 1 needs for one household, already fetched.

    `baseline` is carried here rather than looked up inside the engine on purpose: the
    comparison baseline must never be derived from the household itself, and passing it
    in as data keeps that a visible property of the call rather than a convention
    somebody could quietly break.
    """

    window: UsageWindow
    baseline: float
    label: str
    hdd: list[float]
    normal_hdd: float


class UsageRepository(Protocol):
    name: str

    async def all_ids(self) -> list[str]: ...

    async def context(self, customer_id: str) -> UsageContext:
        """Raises KeyError for an unknown household — callers turn that into a 404."""
        ...


class FixtureRepository:
    """The five hand-shaped demo households, from `app.analytics.fixtures`."""

    name = "fixtures"

    async def all_ids(self) -> list[str]:
        from app.analytics import fixtures

        return fixtures.all_ids()

    async def context(self, customer_id: str) -> UsageContext:
        from app.analytics import fixtures

        hdd, normal = fixtures.heating_degree_days(customer_id)  # validates the id
        return UsageContext(
            window=fixtures.get_window(customer_id),
            baseline=fixtures.comparison_baseline(customer_id),
            label=fixtures.label(customer_id),
            hdd=hdd,
            normal_hdd=normal,
        )


class DatabaseRepository:
    """Reads the seeded half-hourly data back out of PostgreSQL.

    The analytics work on daily totals, so the 48 intervals per day are summed here. That
    aggregation is the whole reason this class is not a trivial mapping: it has to agree
    with the fixtures to the last decimal, or the demo and the tests tell different
    stories.
    """

    name = "database"

    #: Readings are stored timezone-aware (ADR-0006). Grouping by day therefore has to
    #: happen in New Zealand local time — `date_trunc('day', ...)` on a `timestamptz`
    #: uses the *session* timezone, which in a container is UTC. At UTC+12 that moves
    #: every evening reading into the following day, quietly reshaping the exact evening
    #: peak the analysis is about.
    ZONE = "Pacific/Auckland"

    async def all_ids(self) -> list[str]:
        from app.db.models import Customer
        from app.db.session import get_sessionmaker

        async with get_sessionmaker()() as session:
            rows = await session.execute(select(Customer.external_ref).order_by(Customer.id))
            return [r for (r,) in rows.all()]

    async def context(self, customer_id: str) -> UsageContext:
        from app.analytics.fixtures import NORMAL_HDD_PER_DAY, PERIOD
        from app.db.models import Benchmark, Customer, Meter, Reading, WeatherDay
        from app.db.session import get_sessionmaker

        async with get_sessionmaker()() as session:
            customer = (
                await session.execute(
                    select(Customer).where(Customer.external_ref == customer_id)
                )
            ).scalar_one_or_none()
            if customer is None:
                raise KeyError(
                    f"unknown household {customer_id!r}; has `make api-seed` been run?"
                )

            local_day = func.date_trunc("day", func.timezone(self.ZONE, Reading.interval_start))
            daily = (
                await session.execute(
                    select(local_day.label("day"), func.sum(Reading.kwh).label("kwh"))
                    .join(Meter, Meter.id == Reading.meter_id)
                    .where(Meter.customer_id == customer.id)
                    .group_by(local_day)
                    .order_by(local_day)
                )
            ).all()
            if not daily:
                raise KeyError(
                    f"household {customer_id!r} exists but has no readings; re-run `make api-seed`"
                )

            baseline = (
                await session.execute(
                    select(Benchmark.kwh_per_day).where(Benchmark.id == customer.benchmark_id)
                )
            ).scalar_one_or_none()
            if baseline is None:
                # Never fall back to something derived from the household — that is the
                # bug that once inflated the spike's apparent share from 11% to 71%.
                raise KeyError(
                    f"household {customer_id!r} has no benchmark; the comparison baseline "
                    f"must come from outside the household, so there is nothing safe to "
                    f"substitute here"
                )

            hdd_rows = (
                await session.execute(
                    select(WeatherDay.hdd_18)
                    .where(WeatherDay.region == customer.region)
                    .order_by(WeatherDay.day)
                )
            ).all()

        return UsageContext(
            window=UsageWindow(
                customer_id=customer_id,
                period=PERIOD,
                daily_kwh=[round(float(kwh), 3) for _, kwh in daily],
            ),
            baseline=float(baseline),
            label=customer.label or customer_id,
            hdd=[float(h) for (h,) in hdd_rows],
            # The "normal" July is a regional constant, not a stored observation — there
            # is no NIWA baseline in the database to read (KEA-42 is still open). Taken
            # from the same constant the fixtures use so the two can never disagree.
            normal_hdd=NORMAL_HDD_PER_DAY,
        )


def build_repository(use_database: bool) -> UsageRepository:
    return DatabaseRepository() if use_database else FixtureRepository()
