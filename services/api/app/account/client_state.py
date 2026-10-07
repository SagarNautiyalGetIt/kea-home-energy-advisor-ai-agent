"""Small private client records. PostgreSQL in AWS; memory only in local previews."""

from __future__ import annotations

from copy import deepcopy

from app.config import settings

_memory: dict[tuple[str, str], dict] = {}


async def put(account: str, key: str, payload: dict) -> dict:
    if not settings.persist:
        _memory[account, key] = deepcopy(payload)
        return deepcopy(payload)
    from sqlalchemy.dialects.postgresql import insert

    from app.db.models import ClientStateRow
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        stmt = insert(ClientStateRow).values(account_ref=account, key=key, payload=payload)
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=[ClientStateRow.account_ref, ClientStateRow.key],
                set_={"payload": payload},
            )
        )
        await session.commit()
    return deepcopy(payload)


async def get(account: str, key: str) -> dict | None:
    if not settings.persist:
        return deepcopy(_memory.get((account, key)))
    from app.db.models import ClientStateRow
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        row = await session.get(ClientStateRow, (account, key))
        return deepcopy(row.payload) if row else None


async def records(prefix: str, account: str | None = None) -> list[tuple[str, str, dict]]:
    if not settings.persist:
        return [
            (a, k, deepcopy(p))
            for (a, k), p in _memory.items()
            if k.startswith(prefix) and (account is None or a == account)
        ]
    from sqlalchemy import select

    from app.db.models import ClientStateRow
    from app.db.session import get_sessionmaker

    query = select(ClientStateRow).where(ClientStateRow.key.startswith(prefix))
    if account is not None:
        query = query.where(ClientStateRow.account_ref == account)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(query)).scalars().all()
        return [(row.account_ref, row.key, deepcopy(row.payload)) for row in rows]


async def delete(account: str, key: str) -> None:
    if not settings.persist:
        _memory.pop((account, key), None)
        return
    from sqlalchemy import delete as sql_delete

    from app.db.models import ClientStateRow
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        await session.execute(
            sql_delete(ClientStateRow).where(
                ClientStateRow.account_ref == account,
                ClientStateRow.key == key,
            )
        )
        await session.commit()


async def claim_period(account: str, key: str, period: str, recipient: str | None = None) -> bool:
    """Atomic claim across evaluator processes before sending an external notice."""
    if not settings.persist:
        record = _memory.get((account, key))
        if (
            record is None
            or record.get("claimed_period") == period
            or (recipient is not None and record.get("account") != recipient)
        ):
            return False
        record["claimed_period"] = period
        return True
    from sqlalchemy import or_, update

    from app.db.models import ClientStateRow
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        row = ClientStateRow
        result = await session.scalar(
            update(row)
            .where(
                row.account_ref == account,
                row.key == key,
                *([row.payload["account"].astext == recipient] if recipient is not None else []),
                or_(
                    row.payload["claimed_period"].astext.is_(None),
                    row.payload["claimed_period"].astext != period,
                ),
            )
            .values(payload=row.payload.op("||")({"claimed_period": period}))
            .returning(row.key)
        )
        await session.commit()
        return result is not None


async def update_device(key: str, recipient: str, changes: dict | None) -> bool:
    """A send completing after an account switch cannot restore the former owner."""
    if not settings.persist:
        record = _memory.get(("__devices__", key))
        if record is None or record.get("account") != recipient:
            return False
        if changes is None:
            _memory.pop(("__devices__", key), None)
        else:
            record.update(deepcopy(changes))
        return True
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import update

    from app.db.models import ClientStateRow
    from app.db.session import get_sessionmaker

    row = ClientStateRow
    statement = (
        sql_delete(row)
        if changes is None
        else update(row).values(payload=row.payload.op("||")(changes))
    )
    statement = statement.where(
        row.account_ref == "__devices__", row.key == key, row.payload["account"].astext == recipient
    ).returning(row.key)
    async with get_sessionmaker()() as session:
        changed = await session.scalar(statement)
        await session.commit()
        return changed is not None
