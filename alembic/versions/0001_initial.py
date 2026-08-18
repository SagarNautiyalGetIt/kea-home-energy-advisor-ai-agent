"""initial schema

Twelve tables plus weather lookup, per ADR-0006 and the ER diagram.
Generated from app/db/models.py by diffing against an empty database.

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('benchmark',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('region', sa.String(length=64), nullable=False),
        sa.Column('segment', sa.String(length=64), nullable=False),
        sa.Column('kwh_per_day', sa.Numeric(precision=10, scale=3), nullable=False),
        sa.Column('source', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
    op.create_table('tariff',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('plan_type', sa.String(length=32), nullable=False),
        sa.Column('unit_price_nzd', sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column('daily_fixed_nzd', sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column('is_illustrative', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
    op.create_table('weather_day',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('region', sa.String(length=64), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('mean_temp_c', sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column('hdd_18', sa.Numeric(precision=8, scale=3), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('region', 'day', name='uq_weather_region_day')
        )
    op.create_table('customer',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('external_ref', sa.String(length=64), nullable=False),
        sa.Column('region', sa.String(length=64), nullable=False),
        sa.Column('benchmark_id', sa.BigInteger(), nullable=True),
        sa.Column('label', sa.String(length=128), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default='now()', nullable=False),
        sa.ForeignKeyConstraint(['benchmark_id'], ['benchmark.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('external_ref')
        )
    op.create_table('conversation',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('customer_id', sa.BigInteger(), nullable=False),
        sa.Column('channel', sa.String(length=16), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default='now()', nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    op.create_table('customer_tariff',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('customer_id', sa.BigInteger(), nullable=False),
        sa.Column('tariff_id', sa.BigInteger(), nullable=False),
        sa.Column('valid_from', sa.Date(), nullable=False),
        sa.Column('valid_to', sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], ),
        sa.ForeignKeyConstraint(['tariff_id'], ['tariff.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    op.create_table('meter',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('customer_id', sa.BigInteger(), nullable=False),
        sa.Column('icp', sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('icp')
        )
    op.create_table('reading',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('meter_id', sa.BigInteger(), nullable=False),
        sa.Column('interval_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('kwh', sa.Numeric(precision=10, scale=3), nullable=False),
        sa.ForeignKeyConstraint(['meter_id'], ['meter.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('meter_id', 'interval_start', name='uq_reading_meter_interval')
        )
    op.create_index('ix_reading_meter_time', 'reading', ['meter_id', 'interval_start'], unique=False)
    op.create_table('turn',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('conversation_id', sa.BigInteger(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('intent', sa.String(length=48), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default='now()', nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversation.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conversation_id', 'seq', name='uq_turn_conversation_seq')
        )
    op.create_table('escalation',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('conversation_id', sa.BigInteger(), nullable=False),
        sa.Column('turn_id', sa.BigInteger(), nullable=True),
        sa.Column('reason', sa.String(length=48), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default='now()', nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversation.id'], ),
        sa.ForeignKeyConstraint(['turn_id'], ['turn.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    op.create_table('fact_bundle',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('turn_id', sa.BigInteger(), nullable=False),
        sa.Column('intent', sa.String(length=48), nullable=False),
        sa.Column('period', sa.String(length=64), nullable=False),
        sa.Column('facts', postgresql.JSONB(astext_type=Text()), nullable=False),
        sa.ForeignKeyConstraint(['turn_id'], ['turn.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('turn_id')
        )
    op.create_table('token_usage',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('turn_id', sa.BigInteger(), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('model', sa.String(length=64), nullable=False),
        sa.Column('prompt_tokens', sa.Integer(), nullable=False),
        sa.Column('completion_tokens', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['turn_id'], ['turn.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('turn_id')
        )
    op.create_table('verification',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('turn_id', sa.BigInteger(), nullable=False),
        sa.Column('passed', sa.Boolean(), nullable=False),
        sa.Column('checked', postgresql.JSONB(astext_type=Text()), nullable=False),
        sa.Column('unverified', postgresql.JSONB(astext_type=Text()), nullable=False),
        sa.Column('regenerated', sa.Boolean(), nullable=False),
        sa.Column('fell_back_to_template', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['turn_id'], ['turn.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('turn_id')
        )
    

def downgrade() -> None:
    op.drop_table('verification')
    op.drop_table('token_usage')
    op.drop_table('fact_bundle')
    op.drop_table('escalation')
    op.drop_table('turn')
    op.drop_index('ix_reading_meter_time', table_name='reading')
    op.drop_table('reading')
    op.drop_table('meter')
    op.drop_table('customer_tariff')
    op.drop_table('conversation')
    op.drop_table('customer')
    op.drop_table('weather_day')
    op.drop_table('tariff')
    op.drop_table('benchmark')
    
