"""Customer-set alert thresholds, and a per-channel delivery ledger.

Two tables, both in `app` — Alembic owns `app.*` only. The `kea.*` marts are defined by
`data/design/kea_serving_schema.sql` and applied by `data/load.py`; creating them here
would collide with the sample fixtures that load on top of that same file.

## app.alert_preference

The escalation ladder used to be three module constants. 40% over is a shrug for a
household spending $400 a month and a crisis for one spending $90, and the person who
knows which is which is the customer.

No backfill. A household with no row gets the defaults, which are exactly the constants
the hard-coded ladder used (15 / 40 / 75, $20 floor), so nobody's alerting changes on the
day this migration runs. Inserting a row per customer identical to the defaults would
mean migrating every row the next time a default moves.

The monotonic-ladder rule is a CHECK constraint as well as a Pydantic validator. The
validator catches it at the API edge with a readable message; the constraint catches it
when something else writes the table — a fixture, a seed script, a psql session at 11pm.

## app.alert_delivery

A tier-3 warning goes out on three channels. `app.alert` has one `channel` column and one
`status`, so recording three outcomes in it means overwriting two of them. This repo has
already had that bug: rows reading `tier=2 channel=sms status=delivered` when no SMS
gateway existed and the email had done the work.

`app.alert` keeps its unique constraint and stays the idempotency anchor — one row per
customer, per cycle, per tier. This table is the ledger under it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB  # noqa: F401  (parity with 0003)

revision: str = "0004_alert_preferences_and_deliveries"
down_revision: str | None = "0003_merged_schema_app_and_kea"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_preference",
        sa.Column("account_ref", sa.String(64), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("tier1_pct", sa.Numeric(6, 2), nullable=False, server_default="15"),
        sa.Column("tier2_pct", sa.Numeric(6, 2), nullable=False, server_default="40"),
        sa.Column("tier3_pct", sa.Numeric(6, 2), nullable=False, server_default="75"),
        sa.Column(
            "min_overshoot_nzd", sa.Numeric(10, 2), nullable=False, server_default="20"
        ),
        sa.Column("email_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sms_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        # Opt-in, unlike the other two: an automated call is the most intrusive thing this
        # product can do and the one most easily mistaken for a scam.
        sa.Column("voice_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("email", sa.String(320)),
        sa.Column("phone_e164", sa.String(20)),
        sa.Column("quiet_hours_start", sa.Integer(), server_default="21"),
        sa.Column("quiet_hours_end", sa.Integer(), server_default="8"),
        sa.Column(
            "timezone", sa.String(64), nullable=False, server_default="Pacific/Auckland"
        ),
        sa.Column(
            "offline_model_opt_in", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "tier1_pct <= tier2_pct AND tier2_pct <= tier3_pct",
            name="ck_alert_preference_ladder_monotonic",
        ),
        sa.CheckConstraint(
            "tier1_pct >= 5 AND tier3_pct <= 200", name="ck_alert_preference_bounds"
        ),
        schema="app",
    )

    op.create_table(
        "alert_delivery",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "alert_id",
            sa.BigInteger(),
            sa.ForeignKey("app.alert.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(32)),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("destination", sa.Text()),
        sa.Column("segments", sa.Integer()),
        sa.Column("scheduled_for", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("failure_reason", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "alert_id", "channel", name="uq_alert_delivery_once_per_channel"
        ),
        schema="app",
    )
    # The scheduler's only query: everything still owed, ordered by when it is due.
    op.create_index(
        "ix_alert_delivery_pending",
        "alert_delivery",
        ["status", "scheduled_for"],
        schema="app",
    )


def downgrade() -> None:
    # Child first. `kea_app_schema.sql` documents ON DELETE CASCADE across the spine but
    # the live schema does not have it everywhere, so deletes and drops here are ordered
    # by hand rather than trusted to the database.
    op.drop_index("ix_alert_delivery_pending", table_name="alert_delivery", schema="app")
    op.drop_table("alert_delivery", schema="app")
    op.drop_table("alert_preference", schema="app")
