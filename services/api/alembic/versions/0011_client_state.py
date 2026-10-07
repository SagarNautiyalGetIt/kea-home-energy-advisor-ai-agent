"""Private profile, feedback, attachment and device registration records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_client_state"
down_revision = "0010_outage_rewards"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("client_state",
        sa.Column("account_ref", sa.String(64), primary_key=True),
        sa.Column("key", sa.String(256), primary_key=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False), schema="app")


def downgrade():
    op.drop_table("client_state", schema="app")
