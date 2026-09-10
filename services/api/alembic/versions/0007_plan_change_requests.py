"""Plan changes the customer asked for, waiting for a person.

Backs `app/account/changes.py`. Append-only: a row per request rather than a column on the
account, because the question this table answers is not "what plan are they on" — the marts
answer that — but "what did they ask for, when, and what were they told it would save".

Nothing in this repository writes to an account's plan. `kea.mart_account_context` is built
by the data platform and read-only from the app; a plan switch is a commercial event with a
billing effective date attached, and a retailer applies it from the next billing period
rather than mid-cycle. So the assistant records a request and the team actions it, which is
both the honest implementation and the behaviour a customer expects.

`quoted_saving_nzd_per_year` is the figure the customer was shown at the moment they said
yes. It is stored because the only defensible record of consent is one that says what was
consented to, and "what were they told it would save" is asked six weeks later, when the
comparison has been recomputed against different data.

No backfill and no unique constraint. A household may legitimately request a change, change
its mind, and request another; the ordering index carries the history and the status column
carries what happened to each.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0007_plan_change_requests"
down_revision: str | None = "0006_agent_tool_calls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_change_request",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("account_ref", sa.String(64), nullable=False),
        # Nullable, and null means the account had no plan on file — recorded rather than
        # guessed, because somebody will act on this row.
        sa.Column("from_plan", sa.String(120)),
        sa.Column("to_plan_code", sa.String(64), nullable=False),
        sa.Column("to_plan_name", sa.String(120), nullable=False),
        sa.Column("quoted_saving_nzd_per_year", sa.Numeric(10, 2)),
        sa.Column("quoted_from_period", sa.String(64)),
        sa.Column(
            "status", sa.String(24), nullable=False, server_default="pending_review"
        ),
        sa.Column("channel", sa.String(24), nullable=False, server_default="chat"),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('pending_review', 'actioned', 'cancelled')",
            name="ck_plan_change_request_status",
        ),
        schema="app",
    )
    op.create_index(
        "ix_plan_change_request_account",
        "plan_change_request",
        ["account_ref", "requested_at"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_plan_change_request_account", table_name="plan_change_request", schema="app"
    )
    op.drop_table("plan_change_request", schema="app")
