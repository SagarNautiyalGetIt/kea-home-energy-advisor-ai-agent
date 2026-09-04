"""What the customer told us about their home, when we asked.

Backs `app/clarify/`. One row per household, created on first answer — no backfill, for
the same reason `alert_preference` has none: a table of rows that all say "nothing known"
is a table that has to be migrated every time a field is added.

Separate from `alert_preference` even though both are keyed by household, because they
answer different questions and change at different rates. Preferences are what the
customer *wants*; this is what is *true about their house*. Sharing a row would mean a
Settings save and a conversational answer racing each other.

Every column is nullable, and null means "never asked". That is deliberately different
from a recorded denial — `no_new_appliance = true` is a fact, and it is the fact that
promotes the occupancy question from "also possible" to "the next thing to ask". Storing
a denial as absence would put the same question back in front of the customer every cycle.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0005_household_context"
down_revision: str | None = "0004_alert_preferences_and_deliveries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "household_context",
        sa.Column("account_ref", sa.String(64), primary_key=True),
        sa.Column("new_appliance_since", sa.Date()),
        sa.Column(
            "no_new_appliance", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("extra_occupants", sa.Integer()),
        sa.Column("extra_occupants_since", sa.Date()),
        sa.Column("works_from_home", sa.Boolean()),
        sa.Column("has_electric_heating", sa.Boolean()),
        sa.Column("hot_water_changed_since", sa.Date()),
        # Question ids already put to this household. JSONB rather than a child table:
        # it is read whole on every assessment, never queried by element, and a join for
        # a list of six short strings is a join nobody needs.
        sa.Column("asked", JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "extra_occupants IS NULL OR (extra_occupants >= 0 AND extra_occupants <= 20)",
            name="ck_household_context_occupants_sane",
        ),
        schema="app",
    )


def downgrade() -> None:
    op.drop_table("household_context", schema="app")
