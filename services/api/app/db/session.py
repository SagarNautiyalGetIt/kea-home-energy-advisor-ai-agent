"""Engine and session factory.

Created lazily and cached. Importing this module must not open a connection — the test
suite imports the whole app and there is no PostgreSQL in CI, so a module-level
`create_async_engine` call would make every test depend on a database that isn't there.

`pool_pre_ping` is on because the demo machine sleeps. A laptop lid closing drops every
pooled connection, and without pre-ping the first question after a rehearsal break fails
with a stale-connection error rather than reconnecting — which is exactly the moment you
least want it.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        # Small on purpose: five demo households and one presenter. A large pool hides
        # connection leaks during the sprint instead of surfacing them.
        pool_size=5,
        max_overflow=5,
    )


@lru_cache(maxsize=1)
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def session_scope() -> AsyncIterator[AsyncSession]:
    """One transaction. Commits on success, rolls back on any exception."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Close the pool. Called from the FastAPI lifespan so `uvicorn --reload` does not
    leak a pool per reload."""
    if get_engine.cache_info().currsize:
        await get_engine().dispose()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
