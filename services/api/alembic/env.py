"""Alembic environment — async engine, URL from the app's settings.

The database URL is never written into alembic.ini. It comes from KEA_DATABASE_URL so
that the same migrations run against local Docker Postgres today and RDS in Sprint 3
without editing a file (ADR-0006).
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

import sqlalchemy as sa
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

import sqlalchemy as sa
from alembic import context
from app.config import settings
from app.db.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


#: Alembic's `alembic_version.version_num` defaults to varchar(32), and this project's
#: revision ids are descriptive rather than hashes —
#: `0004_alert_preferences_and_deliveries` is 37 characters. A fresh database therefore
#: migrated 0001 -> 0003 and then failed:
#:
#:     StringDataRightTruncationError: value too long for type character varying(32)
#:     UPDATE alembic_version SET version_num='0004_alert_preferences_and_deliveries'
#:
#: It went unnoticed because every existing database was stamped before 0004 landed, so
#: only a clean `make db && make api-migrate` hits it — which is exactly what a new
#: teammate and CI both do.
#:
#: 64 rather than 40: the ids are meant to be readable, and the next one over the limit
#: should not be a second afternoon of this.
VERSION_NUM_LENGTH = 64

def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_column_type=sa.String(VERSION_NUM_LENGTH),
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Catch column type drift (e.g. someone slipping a Float into a money column)
        # rather than silently ignoring it on autogenerate.
        compare_type=True,
        version_table_column_type=sa.String(VERSION_NUM_LENGTH),
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
