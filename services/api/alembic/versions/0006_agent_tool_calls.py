"""What the agent looked up, per answer — the provenance record after ADR-0011.

The agent replaced the four-layer pipeline, and with it the thing this project counted as
evidence changed shape. `fact_bundle` recorded what Python decided to compute *before* the
model saw the question; it was the same for every customer who tripped the same keyword,
so it could never say what a particular answer rested on. `agent_tool_call` records the
calls the model actually made, in order, with the arguments it passed and the source each
result named.

**Nothing is dropped.** `fact_bundle` and `verification` keep their rows and their
columns. They hold the Sprint 2 evidence — every answer given before the agent landed —
and a migration that deleted them would delete the audit trail behind
"N answers, 0 fabricated figures" in order to tidy up. New turns simply stop writing
them; `verification` also stops being written, because there is no longer a draft being
checked against a bundle, and a row asserting `passed: true` about a check that never ran
would be worse than no row.

Downgrade drops only the new table, which is the honest inverse: this migration created
one thing and changed nothing else.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0006_agent_tool_calls"
down_revision: str | None = "0005_household_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_tool_call",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "turn_id",
            sa.Integer(),
            sa.ForeignKey("app.turn.id"),
            nullable=False,
        ),
        # Call order within the turn. Itself evidence: it shows whether the model
        # oriented before answering or went straight for a figure.
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("tool_name", sa.String(64), nullable=False),
        sa.Column("arguments", JSONB()),
        # Stored whole, not summarised. This is the only copy — the marts are rebuilt on
        # every load, so a row read in July may be gone by September, and "we cannot
        # reconstruct what we told them" is not an answer to a billing complaint.
        sa.Column("result", JSONB()),
        # Lifted out of `result` so a provenance query does not have to reach into JSON.
        sa.Column("source", sa.Text()),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("duration_ms", sa.Integer()),
        schema="app",
    )
    op.create_index(
        "ix_agent_tool_call_turn",
        "agent_tool_call",
        ["turn_id", "seq"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index("ix_agent_tool_call_turn", table_name="agent_tool_call", schema="app")
    op.drop_table("agent_tool_call", schema="app")
