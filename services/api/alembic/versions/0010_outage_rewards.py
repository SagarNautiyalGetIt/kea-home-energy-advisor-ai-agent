"""Source snapshots and unique household action receipts."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = '0010_outage_rewards'
down_revision = '0009_device_observations'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('outage_snapshot', sa.Column('account_ref', sa.String(64), primary_key=True),
                    sa.Column('revision', sa.Integer(), nullable=False),
                    sa.Column('payload', postgresql.JSONB(), nullable=False), schema='app')
    op.create_table('reward_event', sa.Column('account_ref', sa.String(64), primary_key=True),
                    sa.Column('event_key', sa.String(256), primary_key=True),
                    sa.Column('payload', postgresql.JSONB(), nullable=False), schema='app')


def downgrade():
    op.drop_table('reward_event', schema='app')
    op.drop_table('outage_snapshot', schema='app')
