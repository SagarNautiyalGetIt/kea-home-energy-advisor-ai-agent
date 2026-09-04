"""Reading and writing what a household has told us.

Same two-implementation shape as `alerts/store.py`, chosen by the same `KEA_PERSIST` flag,
so there is no configuration where answers are written to PostgreSQL but read from memory.

Absence means "never asked", and there is no backfill — see the migration for why.
"""

from __future__ import annotations

import logging
from typing import Protocol

from app.clarify.schemas import HouseholdContext
from app.db.models import HouseholdContextRow

log = logging.getLogger(__name__)


class ContextStore(Protocol):
    name: str

    async def get(self, account_ref: str) -> HouseholdContext: ...

    async def put(self, context: HouseholdContext) -> HouseholdContext: ...


def _to_model(row: HouseholdContextRow) -> HouseholdContext:
    return HouseholdContext(
        account_ref=row.account_ref,
        new_appliance_since=row.new_appliance_since,
        no_new_appliance=row.no_new_appliance,
        extra_occupants=row.extra_occupants,
        extra_occupants_since=row.extra_occupants_since,
        works_from_home=row.works_from_home,
        has_electric_heating=row.has_electric_heating,
        hot_water_changed_since=row.hot_water_changed_since,
        asked=list(row.asked or []),
        updated_at=row.updated_at,
    )


class DatabaseContextStore:
    name = "database"

    def __init__(self, sessionmaker) -> None:
        self._sessionmaker = sessionmaker

    async def get(self, account_ref: str) -> HouseholdContext:
        try:
            async with self._sessionmaker() as session:
                row = await session.get(HouseholdContextRow, account_ref)
        except Exception:
            # Same rule as the recorder and the preferences store: a lookup failure must
            # not cost the customer their answer. An empty context is safe — it means no
            # cause is confirmed, so the narrator is *more* constrained, not less.
            log.exception("could not read household context for %s", account_ref)
            return HouseholdContext(account_ref=account_ref)
        return _to_model(row) if row else HouseholdContext(account_ref=account_ref)

    async def put(self, context: HouseholdContext) -> HouseholdContext:
        """Create or update. Raises — a lost answer means the customer is asked again,
        and being asked the same question twice is how this feature stops being used."""
        async with self._sessionmaker() as session:
            row = await session.get(HouseholdContextRow, context.account_ref)
            if row is None:
                row = HouseholdContextRow(account_ref=context.account_ref)
                session.add(row)
            row.new_appliance_since = context.new_appliance_since
            row.no_new_appliance = context.no_new_appliance
            row.extra_occupants = context.extra_occupants
            row.extra_occupants_since = context.extra_occupants_since
            row.works_from_home = context.works_from_home
            row.has_electric_heating = context.has_electric_heating
            row.hot_water_changed_since = context.hot_water_changed_since
            row.asked = list(context.asked)
            await session.commit()
        return context


class MemoryContextStore:
    """What runs when persistence is off — the normal state for frontend work and CI."""

    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, HouseholdContext] = {}

    async def get(self, account_ref: str) -> HouseholdContext:
        return self._rows.get(account_ref) or HouseholdContext(account_ref=account_ref)

    async def put(self, context: HouseholdContext) -> HouseholdContext:
        self._rows[context.account_ref] = context
        return context


def build_context_store(persist: bool) -> ContextStore:
    if not persist:
        return MemoryContextStore()
    from app.db.session import get_sessionmaker

    return DatabaseContextStore(get_sessionmaker())
