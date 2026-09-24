"""Daily, household-scoped device energy with provenance.

No raw second-by-second device history is retained. This migration changes only the
local app schema; applying it to a customer deployment requires production auth first.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0009_device_observations"
down_revision: str | None = "0008_settings_persistence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("household_context", sa.Column("has_ev", sa.Boolean()), schema="app")
    op.create_table(
        "device_observation",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("account_ref", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=False),
        sa.Column("device_class", sa.String(32), nullable=False),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("runtime_minutes", sa.Numeric(10, 2)),
        sa.Column("energy_kwh", sa.Numeric(12, 3)),
        sa.Column("rated_watts", sa.Numeric(12, 2)),
        sa.Column("confidence", sa.String(16), nullable=False),
        sa.Column("always_on", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("account_ref", "provider", "device_id", "day", name="uq_device_observation_household_device_day"),
        sa.CheckConstraint("energy_kwh IS NULL OR energy_kwh >= 0", name="ck_device_energy_nonnegative"),
        schema="app",
    )
    op.create_index("ix_device_observation_household_day", "device_observation", ["account_ref", "day"], schema="app")


def downgrade() -> None:
    op.drop_index("ix_device_observation_household_day", table_name="device_observation", schema="app")
    op.drop_table("device_observation", schema="app")
    op.drop_column("household_context", "has_ev", schema="app")
