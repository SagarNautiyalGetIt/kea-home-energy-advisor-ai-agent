"""Guards the type rules from ADR-0006 at the schema level.

These run with no database — they compile the models to PostgreSQL DDL and inspect it.
That means the rules are enforced on every PR, on machines that have never run Postgres.

Why bother: our entire product claim is that figures are computed rather than invented.
A `Float` column silently introduces `0.1 + 0.2 == 0.30000000000000004`, and a naive
timestamp moves half-hourly readings into the wrong day whenever NZ changes clocks. Both
are the kind of bug that surfaces once, in front of a judge.
"""

from __future__ import annotations

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app.db.models import Base

DIALECT = postgresql.dialect()

MONEY_OR_ENERGY = ("kwh", "nzd", "price", "cost")


def _columns():
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            yield table.name, col


def test_every_table_compiles_to_postgres_ddl():
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=DIALECT))
        assert "CREATE TABLE" in ddl


def test_no_float_columns_anywhere():
    """Money must never be a float. Neither must energy — meters report decimals."""
    offenders = [
        f"{t}.{c.name} is {c.type}"
        for t, c in _columns()
        if "FLOAT" in str(c.type).upper() or "DOUBLE" in str(c.type).upper()
    ]
    assert not offenders, "use Numeric, not Float: " + "; ".join(offenders)


def test_money_and_energy_columns_are_numeric():
    for t, c in _columns():
        if any(k in c.name.lower() for k in MONEY_OR_ENERGY):
            assert "NUMERIC" in str(c.type).upper(), f"{t}.{c.name} is {c.type}, expected NUMERIC"


def test_every_timestamp_is_timezone_aware():
    """NZ observes daylight saving and the July analysis is about *which day* usage
    happened. A naive timestamp puts readings in the wrong day twice a year."""
    offenders = [
        f"{t}.{c.name}"
        for t, c in _columns()
        if "TIMESTAMP" in str(c.type).upper() and "WITH TIME ZONE" not in str(c.type).upper()
    ]
    assert not offenders, "use DateTime(timezone=True): " + ", ".join(offenders)


def test_surrogate_ids_are_bigint():
    """Readings grow fastest; a 32-bit id is a future outage.

    Scoped to surrogate keys — columns actually named `id`. A natural primary key is not
    a counter and cannot overflow: `alert_preference.account_ref` is one row per
    household, keyed by the household. Widening it to a bigint would mean inventing a
    surrogate id for a table that has no use for one, and then needing a unique
    constraint on `account_ref` anyway to say the thing the primary key already said.
    """
    for table in Base.metadata.sorted_tables:
        for col in table.primary_key.columns:
            if col.name != "id":
                continue
            assert "BIGINT" in str(col.type).upper(), f"{table.name}.{col.name} is {col.type}"


def test_every_table_has_a_primary_key():
    """The rule the one above no longer covers on its own. A table with no primary key
    cannot be updated by row, replicated safely, or de-duplicated."""
    for table in Base.metadata.sorted_tables:
        assert list(table.primary_key.columns), f"{table.name} has no primary key"


def test_readings_are_indexed_for_the_query_we_actually_run():
    """Every analytics question is 'this meter, this time range'."""
    reading = Base.metadata.tables["reading"]
    cols = [tuple(c.name for c in ix.columns) for ix in reading.indexes]
    assert ("meter_id", "interval_start") in cols


def test_a_reading_cannot_be_recorded_twice():
    reading = Base.metadata.tables["reading"]
    uniques = [
        tuple(c.name for c in con.columns)
        for con in reading.constraints
        if con.__class__.__name__ == "UniqueConstraint"
    ]
    assert ("meter_id", "interval_start") in uniques


def test_customer_table_holds_no_personal_details():
    """47.6% of surveyed customers don't trust an AI with their data. Minimum necessary —
    the schema should be able to back up what we say about that."""
    banned = {"name", "full_name", "address", "email", "phone", "account_number", "dob"}
    present = {c.name for c in Base.metadata.tables["customer"].columns}
    assert not (present & banned), f"PII in customer: {present & banned}"


@pytest.mark.parametrize("table", ["verification", "token_usage", "fact_bundle", "escalation"])
def test_the_evidence_tables_exist(table: str):
    """These are deliverables, not debug output. 'N answers, 0 fabricated figures' and
    'X per conversation' cannot be reconstructed if they were never recorded.

    Qualified with `app.` since the merged schema: the spine is what this service
    writes, and the namespace is part of that claim rather than incidental.
    """
    assert f"app.{table}" in Base.metadata.tables


def test_the_agent_writes_app_and_only_reads_kea():
    """The namespace split from the data platform design, pinned.

    `kea` is the loader's; this service holds SELECT on it. `app` is ours. The failure
    this catches is somebody adding a mart-shaped table to `app`, or worse an ORM model
    that inserts into `kea` — at which point two writers own the same rows and the
    freshness in `mart_load_log` becomes a lie.
    """
    from app.db import marts  # noqa: F401  — registers the kea models on Base

    by_schema: dict[str | None, set[str]] = {}
    for table in Base.metadata.tables.values():
        by_schema.setdefault(table.schema, set()).add(table.name)

    assert by_schema["app"] == {
        "conversation",
        "turn",
        # What the agent looked up to produce one answer — the provenance record, and
        # ours to write by definition since the loader has no idea what was asked.
        # `fact_bundle` and `verification` are the pre-ADR-0011 receipt and are no longer
        # written; they keep their rows because they hold the Sprint 2 evidence.
        "agent_tool_call",
        "fact_bundle",
        "verification",
        "token_usage",
        "escalation",
        "alert",
        # The per-channel delivery ledger under `alert`, and the customer's own
        # thresholds. Both are ours to write, so both belong here — `alert_preference`
        # in particular is a customer setting and could never come from the loader.
        "alert_delivery",
        "alert_preference",
        # What the customer told us about their home, in answer to a question we asked.
        # Ours to write by definition — the loader has no way to know it.
        "household_context",
        # A plan switch the customer asked for and confirmed in conversation. In `app`
        # rather than `kea` for exactly the reason this test exists: the account's plan
        # lives in `kea.mart_account_context`, which the loader owns, and this service must
        # never write there. A request is a different fact from a plan, and it belongs to
        # the side that recorded it.
        "plan_change_request",
    }
    assert by_schema["kea"] == {
        "mart_account_context",
        "mart_daily_usage",
        "mart_hourly_profile",
        "mart_bill_explanation",
        "mart_forecast_input",
        "bill_forecast",
        "mart_load_log",
    }
