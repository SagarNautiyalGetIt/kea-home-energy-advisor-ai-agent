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

from app.analytics.account import (
    AccountContext,
    BillingFacts,
    ConnectionFacts,
    DataQuality,
    DayUsage,
    PlanFacts,
)
from app.analytics.drivers import BillPeriod
from app.analytics.engine import DEFAULT_UNIT_PRICE_NZD, UsageWindow

log = logging.getLogger(__name__)


def _period_label(start, end) -> str:
    """How a New Zealand bill prints its period.

    One month when the period sits inside it ("June 2024"), both ends when it straddles
    two ("1 May to 12 June 2024"). The straddling case is the one that matters: Daniel's
    43-day move-in bill reads as a 39% consumption rise if you call it "June", and the
    period length is the first thing the explainer has to attribute the change to.
    """
    if start.year == end.year and start.month == end.month:
        return f"{start:%B %Y}"
    if start.year == end.year:
        return f"{start:%-d %B} to {end:%-d %B %Y}"
    return f"{start:%-d %B %Y} to {end:%-d %B %Y}"


def _maybe_float(value: object) -> float | None:
    """`Decimal | None` out of the marts, `float | None` into the analytics.

    Numeric columns come back as `Decimal`, and mixing those with the floats the engine
    computes raises `TypeError` on the first multiplication rather than producing a
    wrong number — but it raises it deep inside a driver calculation, where the message
    says nothing about which mart column was null. Converting at the boundary keeps the
    failure where the data is.
    """
    if value is None:
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _periods_from_explanation(
    row: object, daily_fixed_nzd: float | None
) -> tuple[BillPeriod | None, BillPeriod | None]:
    """Turn one `kea.mart_bill_explanation` row into the two sides of the comparison.

    Returns `(current, None)` when `prior_bill_id` is null. That is a first bill, and
    the schema comment is explicit that it is *itself a complete explanation* — the
    narration should say so rather than treat the absence as missing data.

    Both periods are built with `BillPeriod.from_bill`, which derives the effective unit
    rate from the total. Using a posted tariff rate here instead would push the
    difference into `delta_unexplained`, where it would read to the customer as an
    increase we could not account for.
    """
    total = _maybe_float(getattr(row, "total_amount", None))
    kwh = _maybe_float(getattr(row, "total_kwh", None))
    days = getattr(row, "period_days", None)
    if total is None or kwh is None or not days:
        return None, None

    period_end = getattr(row, "period_end", None)
    current = BillPeriod.from_bill(
        f"{period_end:%B %Y}" if period_end else "this period",
        days=int(days),
        total_nzd=total,
        total_kwh=kwh,
        daily_fixed_nzd=daily_fixed_nzd or 0.0,
        base_load_kwh_per_day=_maybe_float(getattr(row, "base_load_kwh_day_this", None)),
        heating_degree_days=_maybe_float(getattr(row, "hdd_this_period", None)),
        estimated_read_pct=_maybe_float(getattr(row, "estimated_read_pct", None)) or 0.0,
    )

    prior_total = _maybe_float(getattr(row, "prior_total_amount", None))
    prior_kwh = _maybe_float(getattr(row, "prior_total_kwh", None))
    prior_days = getattr(row, "prior_period_days", None)
    if getattr(row, "prior_bill_id", None) is None or prior_total is None or not prior_days:
        return current, None

    prior = BillPeriod.from_bill(
        "the period before",
        days=int(prior_days),
        total_nzd=prior_total,
        total_kwh=prior_kwh or 0.0,
        daily_fixed_nzd=daily_fixed_nzd or 0.0,
        base_load_kwh_per_day=_maybe_float(getattr(row, "base_load_kwh_day_prior", None)),
        heating_degree_days=_maybe_float(getattr(row, "hdd_prior_period", None)),
    )
    return current, prior


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

    account: AccountContext | None = None
    """The wide context — plan, bills, connection, account row, read quality.

    Optional because the three repositories can fill different amounts of it, and the
    field is additive so every existing caller and test keeps working untouched.
    `MartRepository` populates it; the fixture and seeded-household paths leave it None
    and the account intents answer that they cannot see the detail.

    This is the field whose absence made the bill explanation generic. Layer 1 had five
    numbers to work with while the marts held the plan, both bills and a pre-computed
    driver decomposition — so the explanation could only ever be as specific as a daily
    kWh series allows, no matter how the prompt was written.
    """

    period_start: object | None = None
    period_end: object | None = None
    """The window `window.daily_kwh` covers, as dates.

    Carried because the daily series is a list of floats with no calendar on it, and
    `AccountContext.days` is the WHOLE history — 397 days for Rangi. Without these two,
    `get_daily_usage` had no way to answer about the same period `/api/households` serves,
    so the assistant said "over the 397 days on this bill" and named a peak the dashboard
    disagreed with. That is KEA-141 §3 again, on the path the fix missed: trimming the
    window did not trim the collection the tool reads.

    A suffix of `days` would not do instead. The billed period does not always end at the
    last metered row — Mereana's invoice covers April while her data runs to June — so
    "the last N days" is the wrong window for exactly the account the ticket named.
    """

    icp_id: int | None = None
    """The mart key for this connection, carried rather than dropped.

    `MartRepository` used to select it, join on it and throw it away. The agent's
    `get_hourly_profile` tool needs it to read `kea.mart_hourly_profile` — the one mart
    modelled in `db/marts.py` that nothing in the old pipeline ever queried, which is why
    "when in the day do I use most power?" had to be refused for every account rather
    than only for the ones with no real profile behind them.

    None on the fixture and seeded paths, which genuinely have no ICP. The tool reports
    that as unavailable rather than guessing a key.
    """


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
        from app.analytics import climate
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
                        # The temperature, not the warehouse's degree-day column. See
                        # the zero-fill note below for why.
                        MartDailyUsage.temp_mean_c,
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

        # Trim to the window the customer is actually billed for.
        #
        # These accounts carry anything from 24 days to 13 months, and every answer is
        # period-shaped: "a typical day", "the highest day", the month-end projection.
        # Handing them 397 days produced a peak reported as "day 351", which means
        # nothing to anybody.
        #
        # **The billed period, not the last calendar month** (KEA-141 §3). Taking the
        # calendar month was wrong for every account whose cycle does not start on the
        # 1st, and the failure was invisible because the answer still looked plausible:
        #
        #   Daniel   invoiced 1 May - 12 Jun (43 days); we answered about June's 12
        #   Mereana  invoiced April;          we answered about June's 10
        #
        # It also broke the figures downstream. Mereana's "highest usage day" came back
        # as 20.14 kWh when the highest day her bill charges for is 11.80 — 71% out,
        # against a bill she is holding.
        period_start = getattr(account, "current_period_start", None)
        period_end = getattr(account, "current_period_end", None)
        in_period = (
            [r for r in rows if period_start <= r[0] <= period_end]
            if period_start and period_end
            else []
        )

        if in_period:
            in_month = in_period
            period = _period_label(period_start, period_end)
        else:
            # No billing period on the account — the seeded households and anything the
            # loader has not reached. Fall back to the calendar month, which is at least
            # a unit the customer recognises.
            last_day = rows[-1][0]
            month_start = last_day.replace(day=1)
            in_month = [r for r in rows if r[0] >= month_start]
            # A final partial month with almost nothing in it is worse than the month
            # before it: "your highest day" over three days is not a finding.
            if len(in_month) < 7 and len(rows) > len(in_month):
                earlier = [r for r in rows if r[0] < month_start]
                prior_start = earlier[-1][0].replace(day=1)
                in_month = [r for r in earlier if r[0] >= prior_start]
            period = f"{in_month[0][0]:%B %Y}"

        daily = [round(float(kwh), 3) for _, kwh, _ in in_month]

        # **Zero-fill, never drop** (KEA-141 §1). This used to be
        # `[float(h) for ... if h is not None]`, which silently produced an `hdd` list
        # shorter than `daily`. Julia Fox's 24 metered days all carry a NULL
        # heating_degree_days, so the two arrays came out 24 and 0 long and the weather
        # regression raised ValueError straight out of the endpoint — an HTTP 500 on a
        # starter question.
        #
        # A missing weather join is "we cannot tell you how much of this was the
        # weather", not a crash. Zero is the honest filler: it means no heating demand
        # was recorded for that day, so the fit sees a day that cannot explain a rise
        # rather than a day that does not exist. `analytics/forecast.py` already reports
        # an unusable fit rather than inventing one, which is the behaviour we want here.
        #
        # **Derived here from the temperature, at our own base** (KEA-147). This read
        # `MartDailyUsage.heating_degree_days`, which `fct_weather_daily.sql` computes at
        # base 16 — the warehouse standard, set by `hdd_base_c` in dbt_project.yml. The
        # normals in `climate.py` are NIWA-derived at the New Zealand base 18. So every
        # account's observed heating demand was scored against a normal measured on a
        # different scale, and base 16 is always the smaller number:
        #
        #   June 2024, the coldest month in the set:  observed 5.50  normal 7.7
        #
        # which reads as 2.2 degree-days a day WARMER than typical. `excess_hdd` goes
        # negative, `max(0.0, ...)` in forecast.py clamps it, and the weather driver came
        # out $0.00 for every account in winter — not as a gap, but as a finding: "it
        # wasn't the weather", stated confidently about the coldest month of the year.
        #
        # `temp_mean_c` is a physical observation and carries no base, so deriving the
        # degree day here puts both sides of the comparison on one scale by construction
        # and leaves the warehouse free to change `hdd_base_c` without silently moving
        # our answers. Recomputed at base 18 the same June reads 7.50 against 7.7 — a
        # slightly milder than average winter month, which is what it was.
        hdd = [climate.heating_degree_day(t) for _, _, t in in_month]

        # The region's own normal for the month actually being answered about — not the
        # Auckland-July constant the fixtures use. "Colder than normal" is what the whole
        # weather attribution rests on, and scoring a Dunedin January against an Auckland
        # July would read as dramatically warmer than normal every time. See
        # analytics/climate.py.
        normal = climate.normal_hdd_per_day(
            getattr(account, "climate_region", None), in_month[0][0].month
        )

        # The account's OWN effective rate, when the bill gives us one (KEA-141 §2).
        #
        # Everything used to be priced at a flat illustrative 30c/kWh while
        # `billing.bill` held real charges, so the assistant quoted a "total cost" the
        # customer could not find on their invoice:
        #
        #   Tama    assistant $134.19   invoice $163.19
        #   Daniel  assistant  $42.75   invoice $189.60   (out by $146.85)
        #
        # The Terms modal disclosed the illustrative rate, which is not a defence when
        # the label says "total cost" and the number is wrong against the bill in their
        # hand. Derived from the bill total rather than a posted tariff so it absorbs
        # every line the invoice actually charges — fixed charges, levies, discounts —
        # and reconciles by construction.
        #
        # Falls back to the illustrative rate only when there is no bill, where it stays
        # illustrative and the tools keep saying so.
        unit_price = DEFAULT_UNIT_PRICE_NZD
        account_ctx = await self._account_context(customer_id, account)
        current = account_ctx.current_bill
        if current is not None and current.total_kwh:
            unit_price = round(current.total_nzd / current.total_kwh, 4)

        return UsageContext(
            window=UsageWindow(
                customer_id=customer_id,
                period=period,
                daily_kwh=daily,
                unit_price_nzd=unit_price,
            ),
            baseline=float(cohort),
            label=account.customer_name,
            hdd=hdd,
            normal_hdd=normal,
            account=account_ctx,
            icp_id=account.icp_id,
            period_start=in_month[0][0],
            period_end=in_month[-1][0],
        )

    async def _account_context(self, customer_id: str, account: object) -> AccountContext:
        """Assemble the wide context from the marts the old path never read.

        `mart_bill_explanation` is the important one, and it is why this reads a mart
        rather than recomputing: the decomposition there is **the definition of record**.
        It is built in dbt, so it is version-controlled, reviewable, tested, and
        identical for every customer. Recomputing the same attribution in Python at
        request time would give two answers to the same question — the dashboard's and
        the assistant's — that agree until the day somebody edits one of them.

        `analytics/drivers.py` is not redundant with that. It is what runs when the mart
        row is absent (a first bill, an account the pipeline has not reached, the local
        `public.*` households), and it is the executable statement of the same method,
        so the two can be tested against each other. Where the mart has a row, the mart
        wins.

        Failures here are swallowed to a bare context rather than raised. A missing mart
        must cost the customer their account details, not their answer — the usage half
        of every intent works without any of this, and `make data-load` not having run
        is the normal state of a fresh checkout.
        """

        from app.db.marts import MartBillExplanation, MartDailyUsage
        from app.db.session import get_sessionmaker

        icp_id = getattr(account, "icp_id", None)
        account_id = getattr(account, "account_id", None)

        plan = PlanFacts(
            code=getattr(account, "plan_code", "") or "",
            name=getattr(account, "plan_name", "") or "",
            user_type=getattr(account, "user_type", "standard") or "standard",
            is_tou=bool(getattr(account, "is_tou", False)),
            daily_fixed_nzd=_maybe_float(getattr(account, "daily_fixed_charge", None)),
        )
        connection = ConnectionFacts(
            icp_number=getattr(account, "icp_number", "") or "",
            address_display=getattr(account, "address_display", None),
            climate_region=getattr(account, "climate_region", None),
            network_name=getattr(account, "network_name", None),
            network_code=getattr(account, "network_code", None),
            has_solar=bool(getattr(account, "has_solar", False)),
            has_controlled_load=bool(getattr(account, "has_controlled_load", False)),
        )
        billing = BillingFacts(
            account_number=getattr(account, "account_number", customer_id) or customer_id,
            payment_method=getattr(account, "payment_method", None),
            billing_cycle_day=getattr(account, "billing_cycle_day", None),
            current_period_start=getattr(account, "current_period_start", None),
            current_period_end=getattr(account, "current_period_end", None),
            days_into_period=getattr(account, "days_into_period", None),
        )
        quality = DataQuality(
            estimated_read_pct=_maybe_float(getattr(account, "estimated_read_pct", 0)) or 0.0,
            last_read_at=getattr(account, "last_read_at", None),
            is_quarantined=bool(getattr(account, "is_quarantined", False)),
            quarantine_reason=getattr(account, "quarantine_reason", None),
            mart_built_at=getattr(account, "built_at", None),
        )

        days: list[DayUsage] = []
        current = prior = None
        sensitivity = None

        try:
            async with get_sessionmaker()() as session:
                rows = (
                    await session.execute(
                        select(MartDailyUsage)
                        .where(MartDailyUsage.icp_id == icp_id)
                        .order_by(MartDailyUsage.usage_date)
                    )
                ).scalars().all()
                days = [
                    DayUsage(
                        date=r.usage_date,
                        import_kwh=float(r.import_kwh or 0),
                        export_kwh=float(r.export_kwh or 0),
                        controlled_kwh=float(r.controlled_kwh or 0),
                        uncontrolled_kwh=float(r.uncontrolled_kwh or 0),
                        base_load_kwh=_maybe_float(r.base_load_kwh),
                        peak_kwh=_maybe_float(r.peak_kwh),
                        off_peak_kwh=_maybe_float(r.off_peak_kwh),
                        temp_mean_c=_maybe_float(r.temp_mean_c),
                        heating_degree_days=_maybe_float(r.heating_degree_days),
                        is_weekend=bool(r.is_weekend),
                        is_public_holiday=bool(r.is_public_holiday),
                        estimated_count=int(r.estimated_count or 0),
                        interval_count=int(r.interval_count or 48),
                        expected_intervals=int(r.expected_intervals or 48),
                    )
                    for r in rows
                ]

                explanation = (
                    await session.execute(
                        select(MartBillExplanation)
                        .where(MartBillExplanation.account_id == account_id)
                        .order_by(MartBillExplanation.period_end.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()

            if explanation is not None:
                sensitivity = _maybe_float(explanation.heating_sensitivity_kwh_per_hdd)
                current, prior = _periods_from_explanation(explanation, plan.daily_fixed_nzd)
                quality = DataQuality(
                    estimated_read_pct=_maybe_float(explanation.estimated_read_pct) or 0.0,
                    missing_intervals=int(explanation.missing_interval_count or 0),
                    last_read_at=quality.last_read_at,
                    is_quarantined=quality.is_quarantined,
                    quarantine_reason=quality.quarantine_reason,
                    mart_built_at=explanation.built_at or quality.mart_built_at,
                )
                billing = BillingFacts(
                    account_number=billing.account_number,
                    last_bill_total_nzd=_maybe_float(explanation.total_amount),
                    payment_method=billing.payment_method,
                    billing_cycle_day=billing.billing_cycle_day,
                    current_period_start=billing.current_period_start
                    or explanation.period_start,
                    current_period_end=billing.current_period_end or explanation.period_end,
                    days_into_period=billing.days_into_period,
                )
        except Exception:  # noqa: BLE001
            log.warning(
                "could not assemble the wide account context for %s; "
                "usage answers are unaffected, account lookups will decline",
                customer_id,
                exc_info=True,
            )

        return AccountContext(
            account_ref=customer_id,
            display_name=getattr(account, "customer_name", "") or "",
            plan=plan if plan.name else None,
            connection=connection if connection.icp_number else None,
            billing=billing,
            quality=quality,
            days=days,
            current_bill=current,
            prior_bill=prior,
            heating_sensitivity_kwh_per_hdd=sensitivity,
            is_medically_dependent=bool(getattr(account, "is_medically_dependent", False)),
            is_vulnerable=bool(getattr(account, "is_vulnerable", False)),
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
