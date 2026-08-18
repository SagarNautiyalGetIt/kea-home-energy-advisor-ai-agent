"""The database schema — PostgreSQL, per ADR-0006.

Three type rules, none of them negotiable:

* **Money and energy are `Numeric`, never `Float`.** `0.1 + 0.2 == 0.30000000000000004`
  in binary floating point. Our entire product claim is that figures are computed rather
  than invented; a rounding artefact reaching the screen would undermine exactly the thing
  we are selling.
* **Every timestamp is timezone-aware.** New Zealand observes daylight saving, and the July
  analysis is about *which day* usage happened. A naive timestamp moves half-hourly readings
  into the wrong day twice a year.
* **Ids are `BigInteger`.** Readings grow fastest; a 32-bit id is a future outage.

The tables fall into three groups — the customer's world, what we compare against, and
what we can prove. The third group exists because "N answers, 0 fabricated figures" and
"this costs X per conversation" are deliverables, and neither can be reconstructed after
the fact if it was never written down.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[int]:
    return mapped_column(BigInteger, primary_key=True, autoincrement=True)


def _now() -> Mapped[dt.datetime]:
    return mapped_column(DateTime(timezone=True), server_default="now()", nullable=False)


# ───────────────────────────── the customer's world ─────────────────────────────


class Customer(Base):
    """Deliberately holds no name, address or account number.

    Minimum necessary: 47.6% of surveyed customers said they wouldn't trust an AI with
    their usage data, so the schema should be able to back up what we say about that.
    `region` is here because it is what matches a household to weather and to a benchmark.
    """

    __tablename__ = "customer"

    id: Mapped[int] = _pk()
    external_ref: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    region: Mapped[str] = mapped_column(String(64), nullable=False)
    benchmark_id: Mapped[int | None] = mapped_column(ForeignKey("benchmark.id"), nullable=True)
    label: Mapped[str | None] = mapped_column(String(128))  # demo households only
    created_at: Mapped[dt.datetime] = _now()

    meters: Mapped[list[Meter]] = relationship(back_populates="customer")
    benchmark: Mapped[Benchmark | None] = relationship(back_populates="customers")
    tariffs: Mapped[list[CustomerTariff]] = relationship(back_populates="customer")
    conversations: Mapped[list[Conversation]] = relationship(back_populates="customer")


class Meter(Base):
    __tablename__ = "meter"

    id: Mapped[int] = _pk()
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    icp: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    """NZ Installation Control Point — the national meter identifier."""

    customer: Mapped[Customer] = relationship(back_populates="meters")
    readings: Mapped[list[Reading]] = relationship(back_populates="meter")


class Reading(Base):
    """One half-hourly interval. The highest-volume table by a wide margin:
    5 households × 31 days × 48 intervals = 7,440 rows a month, ~87k a year."""

    __tablename__ = "reading"
    __table_args__ = (
        UniqueConstraint("meter_id", "interval_start", name="uq_reading_meter_interval"),
        # Every analytics query is "this meter, this time range" — so the composite
        # index leads on meter_id and the planner can range-scan the timestamp.
        Index("ix_reading_meter_time", "meter_id", "interval_start"),
    )

    id: Mapped[int] = _pk()
    meter_id: Mapped[int] = mapped_column(ForeignKey("meter.id"), nullable=False)
    interval_start: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kwh: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)

    meter: Mapped[Meter] = relationship(back_populates="readings")


class Tariff(Base):
    __tablename__ = "tariff"

    id: Mapped[int] = _pk()
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    plan_type: Mapped[str] = mapped_column(String(32), nullable=False)
    """`standard` | `low_fixed_charge` — the LFC plan is what the brief ranks as job #1."""

    unit_price_nzd: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    daily_fixed_nzd: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)

    is_illustrative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    """TRUE while we're using 30c/kWh as a stand-in. Kea's real tariff is not public, and
    the brief's rule is that any surface showing a dollar figure has to say so. Keeping the
    flag on the row means the API can enforce it rather than relying on someone remembering."""

    customers: Mapped[list[CustomerTariff]] = relationship(back_populates="tariff")


class CustomerTariff(Base):
    """Which plan a customer was on, and when. Needed for year-on-year comparisons —
    a bill can rise because the plan changed, not because usage did."""

    __tablename__ = "customer_tariff"

    id: Mapped[int] = _pk()
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    tariff_id: Mapped[int] = mapped_column(ForeignKey("tariff.id"), nullable=False)
    valid_from: Mapped[dt.date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[dt.date | None] = mapped_column(Date)

    customer: Mapped[Customer] = relationship(back_populates="tariffs")
    tariff: Mapped[Tariff] = relationship(back_populates="customers")


# ───────────────────────────── what we compare against ─────────────────────────────


class Benchmark(Base):
    """What similar homes use.

    Its own table on purpose. The comparison baseline must **never** be derived from the
    household itself — doing that once inflated our spike's apparent share from 11% to 71%.
    Separating it structurally makes that mistake harder to repeat.
    """

    __tablename__ = "benchmark"

    id: Mapped[int] = _pk()
    region: Mapped[str] = mapped_column(String(64), nullable=False)
    segment: Mapped[str] = mapped_column(String(64), nullable=False)
    kwh_per_day: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    """Where the figure came from. Every number traces to a source — including this one."""

    customers: Mapped[list[Customer]] = relationship(back_populates="benchmark")


class WeatherDay(Base):
    """Daily temperature, for separating "you used more" from "it was a cold week".

    No foreign key — it's a lookup joined on (region, day). Deliberate: weather belongs to
    a place and a date, not to a customer.
    """

    __tablename__ = "weather_day"
    __table_args__ = (
        UniqueConstraint("region", "day", name="uq_weather_region_day"),
    )

    id: Mapped[int] = _pk()
    region: Mapped[str] = mapped_column(String(64), nullable=False)
    day: Mapped[dt.date] = mapped_column(Date, nullable=False)
    mean_temp_c: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    hdd_18: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False)
    """Heating degree days against an 18 °C base — the NZ convention."""


# ───────────────────────────── what we can prove ─────────────────────────────


class Conversation(Base):
    __tablename__ = "conversation"

    id: Mapped[int] = _pk()
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # chat | voice
    started_at: Mapped[dt.datetime] = _now()
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    customer: Mapped[Customer] = relationship(back_populates="conversations")
    turns: Mapped[list[Turn]] = relationship(back_populates="conversation")
    escalations: Mapped[list[Escalation]] = relationship(back_populates="conversation")


class Turn(Base):
    __tablename__ = "turn"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_turn_conversation_seq"),
    )

    id: Mapped[int] = _pk()
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversation.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # customer | agent
    body: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str | None] = mapped_column(String(48))
    """Layer 0's decision, logged on every turn so misroutes are visible rather than inferred."""

    created_at: Mapped[dt.datetime] = _now()

    conversation: Mapped[Conversation] = relationship(back_populates="turns")
    fact_bundle: Mapped[FactBundleRow | None] = relationship(back_populates="turn")
    verification: Mapped[VerificationRow | None] = relationship(back_populates="turn")
    token_usage: Mapped[TokenUsageRow | None] = relationship(back_populates="turn")


class FactBundleRow(Base):
    """Exactly what layer 2 was given. Stored so any answer can be reconstructed and
    audited afterwards — if a figure is ever disputed, this is the receipt."""

    __tablename__ = "fact_bundle"

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("turn.id"), unique=True, nullable=False)
    intent: Mapped[str] = mapped_column(String(48), nullable=False)
    period: Mapped[str] = mapped_column(String(64), nullable=False)
    facts: Mapped[dict] = mapped_column(JSONB, nullable=False)

    turn: Mapped[Turn] = relationship(back_populates="fact_bundle")


class VerificationRow(Base):
    """Layer 3's verdict, per turn.

    A table rather than a log line because *"N answers, 0 fabricated figures"* is a
    deliverable. Evidence you can count beats evidence you have to grep for.
    """

    __tablename__ = "verification"

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("turn.id"), unique=True, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    checked: Mapped[list] = mapped_column(JSONB, nullable=False)
    unverified: Mapped[list] = mapped_column(JSONB, nullable=False)
    regenerated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fell_back_to_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    turn: Mapped[Turn] = relationship(back_populates="verification")


class TokenUsageRow(Base):
    """What each answer cost the model.

    Running locally there is no invoice, so cost-to-serve is a projection: measured tokens
    × published rates. That only works if the tokens were recorded at the time — it cannot
    be reconstructed later.
    """

    __tablename__ = "token_usage"

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("turn.id"), unique=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # ollama | bedrock
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    turn: Mapped[Turn] = relationship(back_populates="token_usage")


class Escalation(Base):
    """Every handoff to a person.

    Under Consumer Care Obligations Part 6 a retailer on notice of payment difficulty has
    duties towards that customer. If we detect hardship, the fact that we detected it — and
    what happened next — needs to be on the record.
    """

    __tablename__ = "escalation"

    id: Mapped[int] = _pk()
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversation.id"), nullable=False)
    turn_id: Mapped[int | None] = mapped_column(ForeignKey("turn.id"))
    reason: Mapped[str] = mapped_column(String(48), nullable=False)
    """hardship | out_of_scope | model_unavailable"""

    created_at: Mapped[dt.datetime] = _now()

    conversation: Mapped[Conversation] = relationship(back_populates="escalations")
