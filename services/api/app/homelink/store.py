"""Daily connected-device observations. Never store raw activity history or hub tokens."""

from __future__ import annotations

import asyncio
import datetime as dt
from decimal import Decimal
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.db.models import DeviceObservationRow
from app.homelink.schemas import DeviceObservation


class ObservationStore(Protocol):
    name: str

    async def put(self, account_ref: str, rows: list[DeviceObservation]) -> int: ...

    async def list(
        self, account_ref: str, since: dt.date | None = None, until: dt.date | None = None
    ) -> list[DeviceObservation]: ...


class MemoryObservationStore:
    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str, str, dt.date], DeviceObservation] = {}
        self._lock = asyncio.Lock()

    async def put(self, account_ref: str, rows: list[DeviceObservation]) -> int:
        async with self._lock:
            for row in rows:
                self._rows[(account_ref, row.provider.value, row.device_id, row.day)] = row
        return len(rows)

    async def list(
        self, account_ref: str, since: dt.date | None = None, until: dt.date | None = None
    ) -> list[DeviceObservation]:
        async with self._lock:
            return sorted(
                (
                    row
                    for (owner, _, _, day), row in self._rows.items()
                    if owner == account_ref
                    and (since is None or day >= since)
                    and (until is None or day <= until)
                ),
                key=lambda row: (row.day, row.provider.value, row.device_id),
            )


class DatabaseObservationStore:
    name = "database"

    def __init__(self, sessionmaker) -> None:
        self._sessionmaker = sessionmaker

    async def put(self, account_ref: str, rows: list[DeviceObservation]) -> int:
        if not rows:
            return 0
        async with self._sessionmaker() as session, session.begin():
            for row in rows:
                values = {
                    "account_ref": account_ref,
                    "provider": row.provider.value,
                    "device_id": row.device_id,
                    "device_class": row.device_class.value,
                    "label": row.label,
                    "day": row.day,
                    "runtime_minutes": Decimal(str(row.runtime_minutes))
                    if row.runtime_minutes is not None
                    else None,
                    "energy_kwh": Decimal(str(row.energy_kwh))
                    if row.energy_kwh is not None
                    else None,
                    "rated_watts": Decimal(str(row.rated_watts))
                    if row.rated_watts is not None
                    else None,
                    "confidence": row.confidence.value,
                    "always_on": row.always_on,
                }
                stmt = insert(DeviceObservationRow).values(**values)
                await session.execute(
                    stmt.on_conflict_do_update(
                        constraint="uq_device_observation_household_device_day",
                        set_={
                            key: value
                            for key, value in values.items()
                            if key not in {"account_ref", "provider", "device_id", "day"}
                        },
                    )
                )
        return len(rows)

    async def list(
        self, account_ref: str, since: dt.date | None = None, until: dt.date | None = None
    ) -> list[DeviceObservation]:
        stmt = select(DeviceObservationRow).where(DeviceObservationRow.account_ref == account_ref)
        if since is not None:
            stmt = stmt.where(DeviceObservationRow.day >= since)
        if until is not None:
            stmt = stmt.where(DeviceObservationRow.day <= until)
        stmt = stmt.order_by(
            DeviceObservationRow.day, DeviceObservationRow.provider, DeviceObservationRow.device_id
        )
        async with self._sessionmaker() as session:
            rows = (await session.execute(stmt)).scalars().all()
        return [
            DeviceObservation(
                device_id=row.device_id,
                provider=row.provider,
                device_class=row.device_class,
                label=row.label,
                day=row.day,
                runtime_minutes=float(row.runtime_minutes)
                if row.runtime_minutes is not None
                else None,
                energy_kwh=float(row.energy_kwh) if row.energy_kwh is not None else None,
                rated_watts=float(row.rated_watts) if row.rated_watts is not None else None,
                confidence=row.confidence,
                always_on=row.always_on,
            )
            for row in rows
        ]


def build_observation_store(persist: bool) -> ObservationStore:
    if not persist:
        return MemoryObservationStore()
    from app.db.session import get_sessionmaker

    return DatabaseObservationStore(get_sessionmaker())
