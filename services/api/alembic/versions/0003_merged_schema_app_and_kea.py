"""the merged schema: `app` for what we write, `kea` for what we read

Brings the two halves of the design together. Up to 0002 every table lived in `public`
and the marts did not exist at all; the data-platform files on the `elt` branch
described namespaces this service had never created.

## What moves, and what does not

**Moves into `app`** — the conversation spine: `conversation`, `turn`, `fact_bundle`,
`verification`, `token_usage`, `escalation`. The namespace table in the platform design
gives `app` to conversation history, written by the agent and invisible to the loader.
`ALTER TABLE ... SET SCHEMA` carries indexes, constraints and sequences with it, so this
is a rename rather than a rebuild — no data is copied and nothing is dropped.

**Not created here — `kea`.** The schema is created empty so grants can be applied,
but the marts themselves belong to the loader. `data/design/kea_serving_schema.sql` is
their definition of record and `data/load.py` applies it. Two authorities for one set of
tables drift apart the first time a column is added on either side, and it would also
fight the sample fixtures, which the data README says to load on top of that same file.
`app/db/marts.py` maps them read-only — models without a migration, which is precisely
what "the app holds SELECT on `kea.*`" looks like in code.

**Stays in `public`** — `customer`, `meter`, `reading`, `tariff`, `customer_tariff`,
`benchmark`, `weather_day`. These are this repo's local stand-in for the
metering/billing/catalogue source systems. In the real platform the agent never reads
them directly; here they are what `make api-seed` fills and what the marts are built
from. Moving them would imply a fidelity to the source schema they do not have.

## New: `app.alert`

Harvey's `kea.alert`, relocated and given a tier. Relocated because the access rules
give the app SELECT-only on `kea.*` and this row is written the moment a warning fires.
The unique constraint is the load-bearing part — the dashboard polls, and without
`(account_ref, kind, period, tier)` the first rehearsal emails the customer on every
poll.

Revision ID: 0003_merged_schema_app_and_kea
Revises: 0002_converge_with_data_platform
Create Date: 2026-08-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_merged_schema_app_and_kea"
down_revision: str | None = "0002_converge_with_data_platform"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

#: In dependency order — `turn` references `conversation`, the evidence tables
#: reference `turn`. SET SCHEMA does not care, but a reader does.
SPINE = (
    "conversation",
    "turn",
    "fact_bundle",
    "verification",
    "token_usage",
    "escalation",
)


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS app")
    op.execute("CREATE SCHEMA IF NOT EXISTS kea")

    for table in SPINE:
        op.execute(f"ALTER TABLE {table} SET SCHEMA app")

    # ── verification.provider_error ─────────────────────────────────────────
    # Documented at length in models.VerificationRow and in 0002's own docstring, and
    # never actually added by either. The recorder therefore could not distinguish "the
    # model was unreachable" from "the number-checker rejected its drafts" — and this
    # table is what the "0 fabricated figures" claim is counted from, so an outage read
    # as a clean catch. server_default so the migration runs against existing rows;
    # they are all genuinely False, since nothing could set it before now.
    op.add_column(
        "verification",
        sa.Column(
            "provider_error", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        schema="app",
    )

    # ── app.alert ───────────────────────────────────────────────────────────
    op.create_table(
        "alert",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("account_ref", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="bill_shock"),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("subject", sa.Text()),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("facts", postgresql.JSONB()),
        sa.Column("period", sa.String(length=64), nullable=False),
        sa.Column("as_at_day", sa.Integer()),
        sa.Column("scheduled_for", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("failure_reason", sa.Text()),
        sa.Column("opened_at", sa.DateTime(timezone=True)),
        sa.Column("acted_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        # Severity ladder, not a free-form integer. Tier 4 would silently never send.
        sa.CheckConstraint("tier BETWEEN 1 AND 3", name="ck_alert_tier"),
        sa.UniqueConstraint(
            "account_ref", "kind", "period", "tier", name="uq_alert_once_per_cycle"
        ),
        schema="app",
    )
    op.create_index("ix_alert_account", "alert", ["account_ref", "created_at"], schema="app")

    # ── kea.* is deliberately NOT created here ──────────────────────────────
    # The marts belong to the loader, not to this service. `data/design/kea_serving_
    # schema.sql` is their definition of record and `data/load.py` applies it; Alembic
    # owning a second copy would mean two authorities for the same tables, drifting
    # apart the first time Harvey adds a column. It would also fight the sample data,
    # which the data README says to load on top of the serving schema.
    #
    # `app/db/marts.py` maps those tables read-only so the ORM can select from them.
    # Models without a migration is the correct arrangement here — it is exactly what
    # "the app holds SELECT on kea.*" looks like in code.


def downgrade() -> None:
    op.drop_table("alert", schema="app")
    op.drop_column("verification", "provider_error", schema="app")

    for table in SPINE:
        op.execute(f"ALTER TABLE app.{table} SET SCHEMA public")

    # Only if empty — another migration may legitimately own these namespaces by then,
    # and RESTRICT makes that a loud failure rather than a silent cascade.
    op.execute("DROP SCHEMA IF EXISTS kea RESTRICT")
    op.execute("DROP SCHEMA IF EXISTS app RESTRICT")
