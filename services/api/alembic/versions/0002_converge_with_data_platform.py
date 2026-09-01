"""converge the evidence tables with the data platform design

Adopts the operational columns from Harvey's `app` schema on the `elt` branch
(data/design/kea_app_schema.sql) without giving up the verification spine.

What came across, and why each one cannot be backfilled:

* conversation.outcome / was_escalated / hardship_detected — the deflection and
  hardship denominators. "How many conversations became calls anyway" is the
  question the business case rests on, and it should not need a scan of `turn`.
* conversation.retain_until — this table holds payment-difficulty disclosures.
  Deliberately no server default: an unset retention date should be visible and
  fixable, not silently mean "forever".
* turn.model_version — without it the bake-off cannot attribute a regression to a
  model change after the fact.
* turn.latency_ms — measured, never estimated. KEA-59 reports percentiles against
  the ADR-0003 budget.
* turn.cited_sources — the short citation the data-transparency panel shows the
  customer, as distinct from fact_bundle, which is the full receipt.

Partial indexes and the date-ordering CHECK are Harvey's too, verbatim in intent.

Revision ID: 0002_converge_with_data_platform
Revises: 0001_initial
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_converge_with_data_platform"
down_revision: str | None = "0001_initial"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # ── conversation ────────────────────────────────────────────────────────
    # server_default on the three booleans and on outcome so the migration can run
    # against a table that already has rows. The ORM default covers new inserts.
    op.add_column(
        "conversation",
        sa.Column(
            "outcome", sa.String(length=16), nullable=False, server_default="ongoing"
        ),
    )
    op.add_column(
        "conversation",
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "conversation",
        sa.Column(
            "was_escalated", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "conversation",
        sa.Column(
            "hardship_detected", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column("conversation", sa.Column("retain_until", sa.Date(), nullable=True))

    op.create_index(
        "ix_conversation_escalated",
        "conversation",
        ["started_at"],
        postgresql_where=sa.text("was_escalated"),
    )
    op.create_index(
        "ix_conversation_hardship",
        "conversation",
        ["started_at"],
        postgresql_where=sa.text("hardship_detected"),
    )
    op.create_index("ix_conversation_retention", "conversation", ["retain_until"])
    op.create_check_constraint(
        "ck_conversation_dates_ordered",
        "conversation",
        "ended_at IS NULL OR ended_at >= started_at",
    )

    # ── turn ────────────────────────────────────────────────────────────────
    op.add_column(
        "turn", sa.Column("cited_sources", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column("turn", sa.Column("model_version", sa.String(length=64), nullable=True))
    op.add_column("turn", sa.Column("latency_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("turn", "latency_ms")
    op.drop_column("turn", "model_version")
    op.drop_column("turn", "cited_sources")

    op.drop_constraint("ck_conversation_dates_ordered", "conversation", type_="check")
    op.drop_index("ix_conversation_retention", table_name="conversation")
    op.drop_index("ix_conversation_hardship", table_name="conversation")
    op.drop_index("ix_conversation_escalated", table_name="conversation")

    op.drop_column("conversation", "retain_until")
    op.drop_column("conversation", "hardship_detected")
    op.drop_column("conversation", "was_escalated")
    op.drop_column("conversation", "message_count")
    op.drop_column("conversation", "outcome")
