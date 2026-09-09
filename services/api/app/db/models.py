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
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[int]:
    return mapped_column(BigInteger, primary_key=True, autoincrement=True)


#: The conversation spine lives in `app`, per the namespace table in the data platform
#: design: `app` is conversation history, written by the agent and invisible to the
#: loader. The operational tables below it (customer, meter, reading, …) stay in
#: `public` — they are this repo's local stand-in for the metering/billing/catalogue
#: source systems, which in the real platform the app never reads directly.
_APP_SCHEMA = {"schema": "app"}


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
    """One session with one customer.

    The operational columns below (`outcome`, `was_escalated`, `retain_until`) come from
    Harvey's `app.conversation` on the `elt` branch — see
    `data/design/kea-data-platform-design.md`. They are the columns the *business case*
    needs rather than the ones the pipeline needs, and we did not have them.

    `was_escalated` is denormalised on purpose: "how many conversations became calls
    anyway" is the deflection denominator, and it should not require a scan of `turn`.
    """

    __tablename__ = "conversation"
    __table_args__ = (
        # Deflection and hardship reporting are both "count conversations where X, by
        # date". Partial indexes keep those cheap without carrying the whole table.
        Index("ix_conversation_escalated", "started_at", postgresql_where=text("was_escalated")),
        Index(
            "ix_conversation_hardship", "started_at", postgresql_where=text("hardship_detected")
        ),
        Index("ix_conversation_retention", "retain_until"),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="ck_conversation_dates_ordered"
        ),
        _APP_SCHEMA,
    )

    id: Mapped[int] = _pk()
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # chat | voice
    started_at: Mapped[dt.datetime] = _now()
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="ongoing")
    """ongoing | resolved | escalated | abandoned."""

    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    """Denormalised turn count, so the "resolved in under 10 questions" customer-effort
    target does not need a scan of `turn`. Harvey's column."""

    was_escalated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hardship_detected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    """Detected *in conversation* — someone saying they are struggling. Deliberately
    distinct from any payment-behaviour risk score, which is a different signal with a
    different failure mode."""

    retain_until: Mapped[dt.date | None] = mapped_column(Date)
    """Deliberately no default. An unset retention date should be visible and fixable,
    not silently mean "forever". Harvey's point, and it is a good one — this table holds
    payment-difficulty disclosures, which is PII by design."""

    customer: Mapped[Customer] = relationship(back_populates="conversations")
    turns: Mapped[list[Turn]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    escalations: Mapped[list[Escalation]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Turn(Base):
    __tablename__ = "turn"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_turn_conversation_seq"),
        _APP_SCHEMA,
    )

    id: Mapped[int] = _pk()
    conversation_id: Mapped[int] = mapped_column(ForeignKey("app.conversation.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # customer | agent
    body: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str | None] = mapped_column(String(48))
    """Layer 0's decision, logged on every turn so misroutes are visible rather than inferred."""

    cited_sources: Mapped[dict | None] = mapped_column(JSONB)
    """What data backed this answer — fact keys, period, household. From Harvey's
    `conversation_message.cited_sources`. Adjacent to `fact_bundle` but not the same
    thing: the bundle is the full receipt, this is the short citation the UI can show
    the customer (KEA-50, the data-transparency panel)."""

    model_version: Mapped[str | None] = mapped_column(String(64))
    """Which model produced this turn. Without it the Day 6 bake-off (KEA-47) cannot
    attribute a regression to a model change after the fact."""

    latency_ms: Mapped[int | None] = mapped_column(Integer)
    """Measured, not estimated. KEA-59 reports first-token and full-answer percentiles
    against the ADR-0003 budget, and that is not reconstructable later."""

    created_at: Mapped[dt.datetime] = _now()

    conversation: Mapped[Conversation] = relationship(back_populates="turns")
    tool_calls: Mapped[list[AgentToolCallRow]] = relationship(
        back_populates="turn",
        cascade="all, delete-orphan",
        order_by="AgentToolCallRow.seq",
    )
    fact_bundle: Mapped[FactBundleRow | None] = relationship(
        back_populates="turn", cascade="all, delete-orphan"
    )
    verification: Mapped[VerificationRow | None] = relationship(
        back_populates="turn", cascade="all, delete-orphan"
    )
    token_usage: Mapped[TokenUsageRow | None] = relationship(
        back_populates="turn", cascade="all, delete-orphan"
    )


class AgentToolCallRow(Base):
    """What the agent actually looked up to produce one answer, in the order it looked.

    This is the provenance record, and it replaced `fact_bundle` as the receipt when the
    agent replaced the pipeline (ADR-0011). The two are not the same claim and the
    difference matters if a figure is ever disputed:

    * `fact_bundle` recorded what Python decided to compute *before* the model saw the
      question. It described the pipeline's intent, and it was identical for every
      customer who tripped the same keyword — so it could not tell you what any
      particular answer was based on.
    * This records the calls the model made, with the arguments it passed and the source
      each result named. It is the answer's actual basis, and replaying it reproduces
      what the model was holding when it wrote the sentence.

    `result` is stored whole rather than summarised. It is the only copy: the marts are
    rebuilt on every load, so a row read in July is not necessarily still there in
    September, and "we cannot reconstruct what we told them" is not an acceptable answer
    to a billing complaint.
    """

    __tablename__ = "agent_tool_call"
    __table_args__ = (
        Index("ix_agent_tool_call_turn", "turn_id", "seq"),
        _APP_SCHEMA,
    )

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("app.turn.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    """Call order within the turn. The sequence is itself evidence — it shows whether
    the model oriented before it answered or went straight for a figure."""

    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    arguments: Mapped[dict | None] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    source: Mapped[str | None] = mapped_column(Text)
    """The `source` line the tool returned — the table or computation behind it. Copied
    out of `result` so a provenance query does not have to reach into JSON."""

    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    """False when the tool errored or reported the data unavailable. Counting these is
    how "the assistant declined because the data was not there" stays distinguishable
    from "the assistant declined because it was not trying"."""

    duration_ms: Mapped[int | None] = mapped_column(Integer)

    turn: Mapped[Turn] = relationship(back_populates="tool_calls")


class FactBundleRow(Base):
    """Exactly what layer 2 was given. Stored so any answer can be reconstructed and
    audited afterwards — if a figure is ever disputed, this is the receipt.

    **Superseded by `agent_tool_call` (ADR-0011).** Nothing writes this table any more;
    the model no longer receives a pre-computed bundle. Kept, with its rows, because the
    Sprint 2 evidence was collected into it and deleting the table would delete the
    audit trail for every answer given before the agent landed.
    """

    __tablename__ = "fact_bundle"
    __table_args__ = (_APP_SCHEMA,)

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("app.turn.id"), unique=True, nullable=False)
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
    __table_args__ = (_APP_SCHEMA,)

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("app.turn.id"), unique=True, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    checked: Mapped[list] = mapped_column(JSONB, nullable=False)
    unverified: Mapped[list] = mapped_column(JSONB, nullable=False)
    regenerated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fell_back_to_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    provider_error: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    """True when the template was served because the model was unreachable.

    Without this column the two fallback paths are indistinguishable in the table, and
    this table is what "N answers, 0 fabricated figures" is counted from. A day when
    Ollama was down would read as a day the number-checker caught six fabrications —
    the opposite claim, and a flattering one, which is exactly the kind of number this
    product exists to refuse.
    """

    turn: Mapped[Turn] = relationship(back_populates="verification")


class TokenUsageRow(Base):
    """What each answer cost the model.

    Running locally there is no invoice, so cost-to-serve is a projection: measured tokens
    × published rates. That only works if the tokens were recorded at the time — it cannot
    be reconstructed later.
    """

    __tablename__ = "token_usage"
    __table_args__ = (_APP_SCHEMA,)

    id: Mapped[int] = _pk()
    turn_id: Mapped[int] = mapped_column(ForeignKey("app.turn.id"), unique=True, nullable=False)
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
    __table_args__ = (_APP_SCHEMA,)

    id: Mapped[int] = _pk()
    conversation_id: Mapped[int] = mapped_column(ForeignKey("app.conversation.id"), nullable=False)
    turn_id: Mapped[int | None] = mapped_column(ForeignKey("app.turn.id"))
    reason: Mapped[str] = mapped_column(String(48), nullable=False)
    """hardship | out_of_scope | model_unavailable"""

    created_at: Mapped[dt.datetime] = _now()

    conversation: Mapped[Conversation] = relationship(back_populates="escalations")


class Alert(Base):
    """Every proactive contact: what was sent, to whom, by which channel, and whether
    it landed.

    Harvey's `kea.alert` from the deferred schema, moved into `app` and given a tier.
    Moved because the namespace rules give the app SELECT-only on `kea.*`, and this row
    is written by the agent the moment a warning fires rather than by the nightly
    loader.

    **Tier is severity; channel is the pipe.** They are separate columns because the
    mapping between them is policy, and policy changes — a customer who has opted out
    of email still has a tier-1 alert, it just has to reach them another way. Today:

    ==== ========= =========================================
    tier channel   state
    ==== ========= =========================================
    1    email     delivering
    2    sms       recorded and rendered, no gateway wired
    3    voice     recorded and rendered, no gateway wired
    ==== ========= =========================================

    `status='suppressed'` is not a failure — it is a deliberate non-send, and the two
    have to be distinguishable. From the customer's side an undelivered bill-shock
    warning looks exactly like one that was never sent, which is the reason this table
    exists at all rather than a log line.
    """

    __tablename__ = "alert"
    __table_args__ = (
        # One alert per customer, per cycle, per tier. The dashboard polls; without
        # this constraint the first rehearsal sends the customer a hundred emails.
        # Enforced in the database rather than in Python because the check and the
        # insert would otherwise race across two workers.
        UniqueConstraint("account_ref", "kind", "period", "tier", name="uq_alert_once_per_cycle"),
        Index("ix_alert_account", "account_ref", "created_at"),
        _APP_SCHEMA,
    )

    id: Mapped[int] = _pk()
    account_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    """The customer as the marts know them. Not a foreign key — `kea` is separately
    loaded and the app has to keep working across a reload."""

    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="bill_shock")
    tier: Mapped[int] = mapped_column(Integer, nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")

    subject: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    facts: Mapped[dict | None] = mapped_column(JSONB)
    """The assessment that triggered it, stored whole. Same reasoning as `fact_bundle`:
    an alert whose figures cannot be reproduced later is an alert we cannot defend."""

    period: Mapped[str] = mapped_column(String(64), nullable=False)
    as_at_day: Mapped[int | None] = mapped_column(Integer)

    scheduled_for: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)

    opened_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    acted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _now()

    deliveries: Mapped[list[AlertDelivery]] = relationship(
        back_populates="alert", cascade="all, delete-orphan", lazy="selectin"
    )


class AlertDelivery(Base):
    """One attempt to reach the customer, on one channel.

    Split out from `alert` because a tier-3 warning goes out on three channels and the
    parent row has one `channel` column and one `status`. Collapsing three outcomes into
    those two fields is what produced the bug this schema already had once: rows reading
    `tier=2 channel=sms status=delivered` when no SMS gateway existed and the email had
    done the work — a record claiming a delivery that never happened, in the one table
    whose entire purpose is answering "through which channel, and did it land".

    The parent stays the idempotency anchor (one row per customer, cycle and tier). This
    is the ledger. `alert.channel` now holds the tier's headline channel purely as a
    label; `alert.status` is the *aggregate* — delivered if any child delivered.
    """

    __tablename__ = "alert_delivery"
    __table_args__ = (
        # One attempt per alert per channel. The dashboard polls and the scheduler runs
        # every hour; without this a deferred SMS is re-queued on every pass.
        UniqueConstraint("alert_id", "channel", name="uq_alert_delivery_once_per_channel"),
        Index("ix_alert_delivery_pending", "status", "scheduled_for"),
        _APP_SCHEMA,
    )

    id: Mapped[int] = _pk()
    alert_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app.alert.id", ondelete="CASCADE"), nullable=False
    )
    alert: Mapped[Alert] = relationship(back_populates="deliveries")

    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    """email | sms | voice."""

    provider: Mapped[str | None] = mapped_column(String(32))
    """Which backend handled it — file, smtp, resend, textbelt, twilio. Recorded because
    "the text did not arrive" has a completely different answer depending on this."""

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    """pending | scheduled | delivered | failed | skipped."""

    destination: Mapped[str | None] = mapped_column(Text)
    """A file path, an SMTP host, or the provider's message id. The provider id is what
    a delivery receipt is checked against afterwards, which matters on trial accounts
    that accept a message and fail it asynchronously."""

    segments: Mapped[int | None] = mapped_column(Integer)
    """SMS only. Carriers bill per 160-character segment and a trial account has few of
    them, so the cost of a message is recorded rather than assumed to be one."""

    scheduled_for: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    """Set when quiet hours held this channel back. The scheduler picks it up after."""

    sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()


class AlertPreferenceRow(Base):
    """The customer's own alerting thresholds.

    One row per household, created on first write. Absence means defaults — there is no
    backfill and no row for a customer who has never opened Settings, because a table of
    rows identical to the defaults is a table that has to be migrated every time a default
    changes.

    **Thresholds are stored as the customer set them, never as the tier that resulted.**
    A stored tier would silently change meaning when the confidence floors move; a stored
    percentage means the same thing in a year. The tier that actually fired is recorded on
    the alert row, alongside the thresholds it was evaluated against.
    """

    __tablename__ = "alert_preference"
    __table_args__ = (
        CheckConstraint(
            "tier1_pct <= tier2_pct AND tier2_pct <= tier3_pct",
            name="ck_alert_preference_ladder_monotonic",
        ),
        CheckConstraint(
            "tier1_pct >= 5 AND tier3_pct <= 200", name="ck_alert_preference_bounds"
        ),
        _APP_SCHEMA,
    )

    account_ref: Mapped[str] = mapped_column(String(64), primary_key=True)

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 15 / 40 / 75 is the ladder from before the preference system existed, kept on purpose
    # — see the "Defaults reproduce the previous behaviour exactly" note in
    # app/alerts/preferences.py. 15 and 75 do not sit on the four steps the settings screen
    # offers (`TIER_OPTIONS` in web/src/lib/alerts.ts); the screen shows an off-scale saved
    # value as its own option rather than snapping it, so this stays put. Moving these to
    # 20 / 80 would change when the alert fires for every customer who never opened
    # Settings, which is a migration and not a UI change.
    tier1_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=15)
    tier2_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=40)
    tier3_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=75)
    min_overshoot_nzd: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=20
    )

    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    voice_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    email: Mapped[str | None] = mapped_column(String(320))
    phone_e164: Mapped[str | None] = mapped_column(String(20))

    quiet_hours_start: Mapped[int | None] = mapped_column(Integer, default=21)
    quiet_hours_end: Mapped[int | None] = mapped_column(Integer, default=8)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="Pacific/Auckland"
    )

    offline_model_opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    """The customer asked for an on-device model because their connection is unreliable.
    See app/offline.py — the server never pushes a model, it only records the request and
    serves the pack when the client asks."""

    updated_at: Mapped[dt.datetime] = _now()


class HouseholdContextRow(Base):
    """What the customer has told us about their home, in answer to a question we asked.

    Separate from `alert_preference` even though both are one row per household, because
    they answer different questions and change at different rates: preferences are what
    the customer *wants*, this is what is *true about their house*. Merging them would
    mean a settings save and a conversational answer racing for the same row.

    Every column is nullable, and null means "never asked" — which is deliberately
    different from a recorded denial. `no_new_appliance = true` is a fact about the
    household: it is what promotes the occupancy question from "also possible" to "the
    next thing to ask". Storing a denial as absence would ask the same thing every cycle.
    """

    __tablename__ = "household_context"
    __table_args__ = (_APP_SCHEMA,)

    account_ref: Mapped[str] = mapped_column(String(64), primary_key=True)

    new_appliance_since: Mapped[dt.date | None] = mapped_column(Date)
    no_new_appliance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    extra_occupants: Mapped[int | None] = mapped_column(Integer)
    extra_occupants_since: Mapped[dt.date | None] = mapped_column(Date)

    works_from_home: Mapped[bool | None] = mapped_column(Boolean)
    has_electric_heating: Mapped[bool | None] = mapped_column(Boolean)
    hot_water_changed_since: Mapped[dt.date | None] = mapped_column(Date)

    asked: Mapped[list | None] = mapped_column(JSONB)
    """Question ids already put to this household. A question asked and ignored is still
    asked — re-asking it next cycle is how an assistant becomes something people mute."""

    updated_at: Mapped[dt.datetime] = _now()


class PlanChangeRequestRow(Base):
    """A plan switch the customer asked for and confirmed, waiting for a person.

    Append-only, and a row per request rather than a column on the account, because the
    interesting question is not "what plan are they on" — the marts answer that — but
    "what did they ask for, when, and what were they told it would save". A single
    mutable field cannot answer any of those, and this is the one thing the assistant can
    start that costs money if it is wrong.

    Nothing here writes to the account's plan. That comes from `kea.mart_account_context`,
    which the data platform owns and this service reads; a plan change is a commercial
    event with a billing effective date, and a retailer applies it from the next period
    rather than mid-cycle. See `app/account/changes.py`.

    `quoted_saving_nzd_per_year` is the figure the customer was shown when they said yes.
    Stored because the only defensible record of consent is one that says what was
    consented to — a row carrying a plan code alone cannot answer "what were they told"
    six weeks later, which is exactly when it gets asked.
    """

    __tablename__ = "plan_change_request"
    __table_args__ = (
        Index("ix_plan_change_request_account", "account_ref", "requested_at"),
        _APP_SCHEMA,
    )

    id: Mapped[int] = _pk()
    account_ref: Mapped[str] = mapped_column(String(64), nullable=False)

    from_plan: Mapped[str | None] = mapped_column(String(120))
    """Null when the account had no plan on file. Recorded as null rather than guessed —
    this row is a document somebody will act on."""

    to_plan_code: Mapped[str] = mapped_column(String(64), nullable=False)
    to_plan_name: Mapped[str] = mapped_column(String(120), nullable=False)

    quoted_saving_nzd_per_year: Mapped[float | None] = mapped_column(Numeric(10, 2))
    quoted_from_period: Mapped[str | None] = mapped_column(String(64))

    status: Mapped[str] = mapped_column(
        String(24), nullable=False, server_default="pending_review"
    )
    channel: Mapped[str] = mapped_column(String(24), nullable=False, server_default="chat")
    requested_at: Mapped[dt.datetime] = _now()
