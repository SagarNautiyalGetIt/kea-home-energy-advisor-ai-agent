"""The `kea.*` serving marts — read-only to this application.

These mirror `data/design/kea_serving_schema.sql` on the data platform side. They are
**read models**: the loader writes them, the agent selects from them, and nothing in
this service inserts a row. Harvey's namespace table is explicit about it —
`kea_app` holds SELECT on `kea.*`, `kea_loader` holds write.

## Why the agent reads marts and not the source tables

`mart_account_context` is one row per account assembled from billing, metering *and*
catalogue. The brief's complaint is that Kea cannot currently join those three; the
mart is that join, done once by the pipeline instead of once per request by an agent
that could get it wrong. Same for `mart_daily_usage`, which folds 48 half-hourly
intervals into a day and pre-joins the weather — the two things layer 1 would
otherwise have to do itself, in Python, differently each time somebody touched it.

Only the subset the API actually reads is modelled here. `bill_forecast`,
`mart_bill_explanation` and `mart_forecast_input` are included because the explainer
and the warning are about to need them; the rest of the serving schema (metering,
billing, catalogue) is deliberately absent, because a model for a table we never
query is a claim we support something we don't.

**Sign convention**, inherited: `kwh` is a non-negative magnitude. Direction lives on
the register, not on the number.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base

#: Separate from `_APP_SCHEMA` in models.py, and the separation is the point: one
#: namespace this service writes, one it only reads.
_KEA_SCHEMA = {"schema": "kea"}


class MartAccountContext(Base):
    """Everything the agent needs to know about who it is talking to, in one row.

    The Consumer Care flags are here rather than behind a lookup deliberately: they
    change what the agent is *allowed* to say and when it must escalate, so they have
    to be on the row the agent already has, not one it might skip fetching.
    """

    __tablename__ = "mart_account_context"
    __table_args__ = (_KEA_SCHEMA,)

    account_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    account_number: Mapped[str] = mapped_column(Text, nullable=False)

    customer_id: Mapped[int] = mapped_column(Integer, nullable=False)
    customer_number: Mapped[str] = mapped_column(Text, nullable=False)
    customer_name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    is_medically_dependent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_vulnerable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    icp_id: Mapped[int] = mapped_column(Integer, nullable=False)
    icp_number: Mapped[str] = mapped_column(Text, nullable=False)
    address_display: Mapped[str | None] = mapped_column(Text)
    climate_region: Mapped[str | None] = mapped_column(Text)
    """The weather join key. `mart_daily_usage` already carries the degree days, so this
    is for labelling and for picking a comparison cohort, not for a join at request time."""

    network_code: Mapped[str | None] = mapped_column(Text)
    network_name: Mapped[str | None] = mapped_column(Text)
    has_solar: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_controlled_load: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    plan_id: Mapped[int] = mapped_column(Integer, nullable=False)
    plan_code: Mapped[str] = mapped_column(Text, nullable=False)
    plan_name: Mapped[str] = mapped_column(Text, nullable=False)
    user_type: Mapped[str] = mapped_column(Text, nullable=False)
    """`low_user` | `standard` — the NZ regulated categories. This is what makes the
    Low Fixed Charge comparison answerable at all."""

    is_tou: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    daily_fixed_charge: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    payment_method: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # ── the billing cycle ──────────────────────────────────────────────────────
    #
    # These eleven columns below `user_type` existed in `kea.mart_account_context`
    # from the start and were simply never mapped here, and because
    # `analytics/repository.py` reads every one of them through
    # `getattr(account, "...", None)`, the omission could not raise — it returned the
    # default and the context assembled cleanly with the fields empty. The result was
    # a set of features that reported success while doing nothing:
    #
    #   no cycle dates      -> days_remaining is always 0, so "what will I pay?"
    #                          projects a cycle that is already over and quotes the
    #                          money already spent as the forecast
    #   no estimated_read_pct -> the account whose whole purpose is to make the
    #                          assistant hedge about estimated reads never hedged
    #   is_quarantined False -> the guard that is supposed to make the agent DECLINE
    #                          on unresolved cross-system references never fired
    #
    # The last one is the reason this is a correctness fix and not a cosmetic one: a
    # safety control that is silently off is worse than one that was never written,
    # because the tests that assert the behaviour pass against a context that can
    # never trigger it.
    billing_cycle_day: Mapped[int | None] = mapped_column(SmallInteger)
    current_period_start: Mapped[dt.date | None] = mapped_column(Date)
    current_period_end: Mapped[dt.date | None] = mapped_column(Date)
    days_into_period: Mapped[int | None] = mapped_column(SmallInteger)

    estimated_read_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    last_read_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    is_quarantined: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    quarantine_reason: Mapped[str | None] = mapped_column(Text)

    built_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class MartDailyUsage(Base):
    """One row per meter per day, with the weather already joined.

    `base_load_kwh` is the overnight percentile — the always-on draw, and the single
    most useful explainer input we have: *"you draw 350 W around the clock, which is
    about $480 a year before you switch anything on."*

    `interval_count` against `expected_intervals` is what lets the narration hedge
    honestly. 48 is a normal day; 46 and 50 happen at the daylight-saving transitions,
    so a short day is not automatically a gap.
    """

    __tablename__ = "mart_daily_usage"
    __table_args__ = (
        Index("ix_mart_daily_usage_date", "usage_date"),
        _KEA_SCHEMA,
    )

    icp_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    usage_date: Mapped[dt.date] = mapped_column(Date, primary_key=True)

    import_kwh: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=0)
    export_kwh: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=0)
    controlled_kwh: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=0)
    uncontrolled_kwh: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=0)

    base_load_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    peak_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    off_peak_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))

    interval_count: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    expected_intervals: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    estimated_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    temp_mean_c: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    heating_degree_days: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))

    is_weekend: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_public_holiday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    built_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class MartHourlyProfile(Base):
    """A month's average shape, by hour, split weekday from weekend.

    There is no day dimension: `profile_month` of 2024-03-01 means *March 2024*, and
    the weekday row is the mean over all 21 March weekdays. The split is in the key
    rather than a filter applied afterwards because weekday and weekend are two
    different curves, and averaging them together produces a shape neither day
    actually has.
    """

    __tablename__ = "mart_hourly_profile"
    __table_args__ = (_KEA_SCHEMA,)

    icp_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    profile_month: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    hour_of_day: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    is_weekday: Mapped[bool] = mapped_column(Boolean, primary_key=True)

    avg_import_kwh: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    avg_export_kwh: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    sample_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    """A profile built from three days is not the same claim as one built from thirty,
    and the narration should be able to tell the difference."""

    built_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class MartBillExplanation(Base):
    """The bill explainer's row: this bill against the last one, decomposed by driver.

    The decomposition is in attribution order — period length, then weather, then base
    load, then tariff — and whatever is left lands in `delta_unexplained`. That column
    is the honest one. *"I can account for $34 of the $61 increase"* is a better answer
    than a confident story about the other $27, and `is_explainable` is what tells the
    narration to give the first answer instead of the second.
    """

    __tablename__ = "mart_bill_explanation"
    __table_args__ = (
        Index("ix_mart_bill_explanation_account", "account_id", "period_start"),
        _KEA_SCHEMA,
    )

    bill_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False)
    icp_id: Mapped[int] = mapped_column(Integer, nullable=False)

    period_start: Mapped[dt.date] = mapped_column(Date, nullable=False)
    period_end: Mapped[dt.date] = mapped_column(Date, nullable=False)
    period_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_kwh: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)

    prior_bill_id: Mapped[int | None] = mapped_column(Integer)
    prior_period_days: Mapped[int | None] = mapped_column(SmallInteger)
    prior_total_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    prior_total_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    """NULL for a first bill — which is itself a complete explanation, and one the
    narration should give rather than treating as missing data."""

    amount_delta: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    amount_delta_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    kwh_delta: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))

    delta_from_period_length: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    delta_from_weather: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    delta_from_base_load: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    delta_from_tariff: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    delta_unexplained: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    hdd_this_period: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    hdd_prior_period: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    temp_mean_this: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    temp_mean_prior: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    base_load_kwh_day_this: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    base_load_kwh_day_prior: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    heating_sensitivity_kwh_per_hdd: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))

    estimated_read_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    missing_interval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_explainable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    built_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class MartForecastInput(Base):
    """Everything the mid-cycle projection extrapolates from, as at a given day.

    Fixed charges are known exactly the moment a period starts, so only the variable
    part is ever forecast — which is why they are a separate column rather than folded
    into the projection.
    """

    __tablename__ = "mart_forecast_input"
    __table_args__ = (_KEA_SCHEMA,)

    account_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    period_start: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    as_at_date: Mapped[dt.date] = mapped_column(Date, primary_key=True)

    days_elapsed: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    days_total: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    kwh_to_date: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    cost_to_date: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    baseline_daily_kwh: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    same_period_last_year_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    same_period_last_year_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    hdd_to_date: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    hdd_expected_remaining: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    heating_sensitivity_kwh_per_hdd: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))

    fixed_charges_period: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    built_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class BillForecast(Base):
    """A stored projection, with its uncertainty band.

    `projected_low <= projected_amount <= projected_high` is a database constraint on
    the platform side, not a convention. A projection quoted without its band is a
    point estimate presented as a fact, and this product's whole claim is the opposite.
    """

    __tablename__ = "bill_forecast"
    __table_args__ = (
        Index("ix_bill_forecast_account", "account_id", "forecast_date"),
        _KEA_SCHEMA,
    )

    forecast_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[dt.date] = mapped_column(Date, nullable=False)
    period_end: Mapped[dt.date] = mapped_column(Date, nullable=False)
    forecast_date: Mapped[dt.date] = mapped_column(Date, nullable=False)

    days_elapsed: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    kwh_to_date: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    projected_kwh: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    projected_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    projected_low: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    projected_high: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    baseline_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    variance_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    is_anomalous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    model_version: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class MartLoadLog(Base):
    """One row per mart per load.

    Makes *"how fresh is this, and did it succeed"* answerable without inspecting the
    data itself — which matters because the failure mode is a mart that loaded
    yesterday and looks perfectly plausible today.
    """

    __tablename__ = "mart_load_log"
    __table_args__ = (
        Index("ix_mart_load_log_mart", "mart_name", "started_at"),
        _KEA_SCHEMA,
    )

    load_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mart_name: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    row_count: Mapped[int | None] = mapped_column(Integer)
    warehouse_run_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    error_message: Mapped[str | None] = mapped_column(Text)
