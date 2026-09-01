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

import logging
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import func, select

from app.analytics.engine import UsageWindow

log = logging.getLogger(__name__)


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
        from app.db.recorder import DatabaseRecorder
        from app.db.session import get_sessionmaker

        async with get_sessionmaker()() as session:
            # Exclude conversation anchors. The recorder provisions a bare `customer` row
            # the first time a mart account is recorded, because `conversation.customer_id`
            # is a foreign key and the spine needs something to hang off. Those rows are
            # identity only — they have no meters and no readings — so listing them here
            # would put every mart account in the picker twice: once from `public.*` with
            # no data, once from `kea.*` with its real usage.
            rows = await session.execute(
                select(Customer.external_ref)
                .where(Customer.region != DatabaseRecorder.ANCHOR_REGION)
                .order_by(Customer.id)
            )
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


class MartRepository:
    """Reads the nine seeded accounts out of Harvey's `kea.*` serving marts.

    `DatabaseRepository` serves the five hand-shaped demo households from `public.*`;
    this serves the fixture accounts the data platform loaded. Both produce the same
    `UsageContext`, so every intent works against either without a second code path.

    ## The comparison baseline, and why it is a peer cohort

    The rule that outranks convenience here: **the baseline must never be derived from
    the household itself.** Doing that once inflated a spike's apparent share from 11%
    to 71%, and `Benchmark` exists as its own table to make repeating it hard.

    `public.benchmark` has no rows for these accounts — it holds per-demo-household
    figures, all Auckland. `kea.mart_forecast_input.baseline_daily_kwh` covers exactly
    one of the nine. So the baseline here is the **mean daily use of the other seeded
    accounts**, excluding this one.

    That is a real cohort, not an invention: it is what comparable homes in this dataset
    actually used, it is reproducible from the same tables, and it can be stated out
    loud — which matters, because "every number traces to a source" is the claim the
    whole pitch rests on and a benchmark nobody can source is the softest number on the
    screen. It is *not* a claim about New Zealand averages, and nothing in the narration
    presents it as one.
    """

    name = "marts"

    async def all_ids(self) -> list[str]:
        from app.db.marts import MartAccountContext
        from app.db.session import get_sessionmaker

        async with get_sessionmaker()() as session:
            rows = await session.execute(
                select(MartAccountContext.account_number).order_by(MartAccountContext.account_id)
            )
            return [r for (r,) in rows.all()]

    async def context(self, customer_id: str) -> UsageContext:
        from app.analytics.fixtures import NORMAL_HDD_PER_DAY
        from app.db.marts import MartAccountContext, MartDailyUsage
        from app.db.session import get_sessionmaker

        async with get_sessionmaker()() as session:
            account = (
                await session.execute(
                    select(MartAccountContext).where(
                        MartAccountContext.account_number == customer_id
                    )
                )
            ).scalar_one_or_none()
            if account is None:
                raise KeyError(f"unknown account {customer_id!r}; has `make data-load` been run?")

            rows = (
                await session.execute(
                    select(
                        MartDailyUsage.usage_date,
                        MartDailyUsage.import_kwh,
                        MartDailyUsage.heating_degree_days,
                    )
                    .where(MartDailyUsage.icp_id == account.icp_id)
                    .order_by(MartDailyUsage.usage_date)
                )
            ).all()
            if not rows:
                raise KeyError(
                    f"account {customer_id!r} has no rows in kea.mart_daily_usage"
                )

            # The cohort: every OTHER account's mean daily use. Excluding this household
            # is the whole point — see the class docstring.
            cohort = (
                await session.execute(
                    select(func.avg(MartDailyUsage.import_kwh)).where(
                        MartDailyUsage.icp_id != account.icp_id
                    )
                )
            ).scalar_one_or_none()
            if cohort is None:
                raise KeyError(
                    f"no comparison cohort for {customer_id!r}: the baseline must come from "
                    f"outside the household, so there is nothing safe to substitute here"
                )

        # Trim to the most recent COMPLETE calendar month.
        #
        # These accounts carry anything from 24 days to 13 months, and every intent in
        # layer 1 is month-shaped: "a typical day", "the highest day", the month-end
        # projection. Handing them 397 days produced two visible failures — a peak
        # reported as "day 351", which means nothing to a customer, and a period label
        # of "1 Aug 2023 to 31 Aug 2024" whose stray "31" the number-checker correctly
        # flagged as an unverified figure, because it is not a fact and never was.
        #
        # A month is also the unit the customer is billed in, so it is the honest window
        # to answer about rather than merely the convenient one.
        last_day = rows[-1][0]
        month_start = last_day.replace(day=1)
        in_month = [r for r in rows if r[0] >= month_start]
        # A final partial month with almost nothing in it is worse than the month before
        # it: "your highest day" over three days is not a finding.
        if len(in_month) < 7 and len(rows) > len(in_month):
            earlier = [r for r in rows if r[0] < month_start]
            prior_start = earlier[-1][0].replace(day=1)
            in_month = [r for r in earlier if r[0] >= prior_start]

        daily = [round(float(kwh), 3) for _, kwh, _ in in_month]
        hdd = [float(h) for _, _, h in in_month if h is not None]
        period = f"{in_month[0][0]:%B %Y}"

        return UsageContext(
            window=UsageWindow(customer_id=customer_id, period=period, daily_kwh=daily),
            baseline=float(cohort),
            label=account.customer_name,
            hdd=hdd,
            normal_hdd=NORMAL_HDD_PER_DAY,
        )


class CompositeRepository:
    """The five demo households and the nine mart accounts, behind one lookup.

    They live in different schemas because they come from different places — `public.*`
    is this repo's seeder, `kea.*` is the data platform's loader — and unifying them in
    the *repository* rather than in the schema keeps that provenance honest while still
    letting one login page serve all fourteen.

    Order matters: demo households first. They are the ones every intent is calibrated
    against and the ones the rehearsed demo lines use, so a name collision must resolve
    to the household the script expects, not to a fixture account.
    """

    name = "database+marts"

    def __init__(self) -> None:
        self._sources: tuple[UsageRepository, ...] = (DatabaseRepository(), MartRepository())

    async def all_ids(self) -> list[str]:
        ids: list[str] = []
        for source in self._sources:
            try:
                ids += await source.all_ids()
            except Exception:  # noqa: BLE001
                # One empty or unmigrated schema must not take out the other. A missing
                # `kea.*` is the normal state before `make data-load`, and the five demo
                # households should still be reachable.
                log.warning("repository %s could not list ids", source.name, exc_info=True)
        return ids

    async def context(self, customer_id: str) -> UsageContext:
        for source in self._sources:
            try:
                return await source.context(customer_id)
            except KeyError:
                continue
        raise KeyError(f"unknown household or account {customer_id!r}")


def build_repository(use_database: bool) -> UsageRepository:
    return CompositeRepository() if use_database else FixtureRepository()
