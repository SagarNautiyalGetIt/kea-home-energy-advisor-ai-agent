"""Plan change requests: staged, confirmed, recorded — never silently applied.

A plan change is the only thing in this product that the assistant can start which costs a
customer money if it is wrong, so it is the one place with a confirmation step. Everything
else the assistant can change — thresholds, quiet hours, which channels are on — is a
preference that can be changed back in one sentence, and putting a confirmation in front of
those would train the customer to say yes to confirmations, which is how the one that
matters gets waved through.

## Why this records a request rather than applying a change

The account's plan comes from `kea.mart_account_context`, which is built by the data
platform and read-only from this service. There is no write path to it and there should not
be: a plan change is a commercial event with a billing effective date attached, and a
retailer applies it from the next billing period rather than mid-cycle. So the honest
implementation is the same one a real retailer runs — record what the customer asked for,
tell them when it takes effect, and let the team action it.

That is also the behaviour a customer expects. "Done, you're on the new plan" from a chat
window, mid-cycle, with a bill already running, is the answer that would make somebody
distrust the whole product.

## The pending confirmation is deliberately in memory

A staged change that has not been confirmed lives in `PendingChanges`, in the process, with
a short expiry. It is not persisted, and that is correct rather than a shortcut:

* It is ephemeral by nature. The customer is being asked a question *now*, in a
  conversation that is happening *now*.
* Its failure mode is safe. If the process restarts, the confirmation is lost and the
  customer is asked again — an extra question, never an unrequested plan change. The
  opposite arrangement, where a stale confirmation survives a restart and a later "yes" to
  something else applies it, is the failure that would matter.
* It is the same reasoning `clarify/conversation.py` uses for re-deriving the open question
  rather than storing it.

The *confirmed* request is a different thing and is persisted, because somebody has to
action it.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

#: How long a staged change waits for a yes. Long enough for a customer to read the
#: preview, think, and reply; short enough that a "yes" to something else half an hour
#: later cannot land on it. Five minutes is roughly one conversation.
PENDING_TTL_SECONDS = 300


class PlanChangeRequest(BaseModel):
    """A confirmed request, on its way to a person. Crosses the API boundary."""

    account_ref: str
    from_plan: str | None = Field(
        default=None,
        description=(
            "What they were on, as far as this service could tell. Null when the account "
            "has no plan on file — recorded as null rather than guessed, because the "
            "request is a document somebody will act on."
        ),
    )
    to_plan_code: str
    to_plan_name: str

    #: What the customer was shown when they said yes. Stored on the request because the
    #: only defensible record of consent is the one that says what was consented to — a
    #: request row carrying only a plan code cannot answer "what were they told it would
    #: save" six weeks later.
    quoted_saving_nzd_per_year: float | None = None
    quoted_from_period: str | None = None

    requested_at: dt.datetime | None = None
    status: str = Field(
        default="pending_review",
        description="pending_review | actioned | cancelled. Set by the team, not here.",
    )
    channel: str = "chat"


class ChangeStore(Protocol):
    name: str

    async def record(self, request: PlanChangeRequest) -> PlanChangeRequest: ...

    async def pending_for(self, account_ref: str) -> list[PlanChangeRequest]: ...


class DatabaseChangeStore:
    name = "database"

    def __init__(self, sessionmaker) -> None:
        self._sessionmaker = sessionmaker

    async def record(self, request: PlanChangeRequest) -> PlanChangeRequest:
        """Raises on failure, unlike a read.

        A change request that reports success and stores nothing is the worst outcome this
        module has: the customer believes they are moving plan and nobody knows. The same
        rule `alerts/store.py:put` follows, for the same reason.
        """
        from decimal import Decimal

        from app.db.models import PlanChangeRequestRow

        async with self._sessionmaker() as session:
            row = PlanChangeRequestRow(
                account_ref=request.account_ref,
                from_plan=request.from_plan,
                to_plan_code=request.to_plan_code,
                to_plan_name=request.to_plan_name,
                quoted_saving_nzd_per_year=(
                    Decimal(str(request.quoted_saving_nzd_per_year))
                    if request.quoted_saving_nzd_per_year is not None
                    else None
                ),
                quoted_from_period=request.quoted_from_period,
                channel=request.channel,
            )
            session.add(row)
            await session.commit()
            return request.model_copy(update={"requested_at": row.requested_at})

    async def pending_for(self, account_ref: str) -> list[PlanChangeRequest]:
        from sqlalchemy import select

        from app.db.models import PlanChangeRequestRow

        try:
            async with self._sessionmaker() as session:
                rows = (
                    await session.execute(
                        select(PlanChangeRequestRow)
                        .where(
                            PlanChangeRequestRow.account_ref == account_ref,
                            PlanChangeRequestRow.status == "pending_review",
                        )
                        .order_by(PlanChangeRequestRow.requested_at.desc())
                    )
                ).scalars().all()
        except Exception:
            # A read failure must not cost the customer their answer — but it MUST NOT
            # read as "no pending request" either, because the assistant would then offer
            # a switch that is already in flight. Logged loudly; the caller treats an
            # exception-free empty list and a failure the same way only because there is
            # nothing better available, and the log is how that is caught.
            log.exception("could not read plan change requests for %s", account_ref)
            return []
        return [
            PlanChangeRequest(
                account_ref=r.account_ref,
                from_plan=r.from_plan,
                to_plan_code=r.to_plan_code,
                to_plan_name=r.to_plan_name,
                quoted_saving_nzd_per_year=(
                    float(r.quoted_saving_nzd_per_year)
                    if r.quoted_saving_nzd_per_year is not None
                    else None
                ),
                quoted_from_period=r.quoted_from_period,
                requested_at=r.requested_at,
                status=r.status,
                channel=r.channel,
            )
            for r in rows
        ]


class MemoryChangeStore:
    """What runs when persistence is off — CI and frontend work.

    Reported on `/health` alongside the other stores, so "your plan change was logged" and
    "your plan change was logged until this process restarts" are never indistinguishable
    from outside.
    """

    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, list[PlanChangeRequest]] = {}

    async def record(self, request: PlanChangeRequest) -> PlanChangeRequest:
        stamped = request.model_copy(
            update={"requested_at": dt.datetime.now(dt.UTC)}
        )
        self._rows.setdefault(request.account_ref, []).append(stamped)
        log.info(
            "plan change requested (memory store) customer=%s to=%s",
            request.account_ref,
            request.to_plan_code,
        )
        return stamped

    async def pending_for(self, account_ref: str) -> list[PlanChangeRequest]:
        return [
            r for r in self._rows.get(account_ref, []) if r.status == "pending_review"
        ]


def build_change_store(persist: bool) -> ChangeStore:
    if not persist:
        return MemoryChangeStore()
    from app.db.session import get_sessionmaker

    return DatabaseChangeStore(get_sessionmaker())


# ---------------------------------------------------------------------------
# The staged half
# ---------------------------------------------------------------------------


@dataclass
class Staged:
    account_ref: str
    to_plan_code: str
    to_plan_name: str
    from_plan: str | None
    quoted_saving_nzd_per_year: float | None
    quoted_from_period: str | None
    expires_at: float
    """`time.monotonic()` deadline. Monotonic rather than wall clock so a clock adjustment
    cannot extend or expire a confirmation window."""


class PendingChanges:
    """One staged change per household, in memory, with a five-minute life.

    One, not a queue. A customer cannot be part-way through two plan changes, and holding
    a list would let a "yes" apply whichever one the implementation happened to pop.
    Staging a second change replaces the first, which is what the customer means when they
    change their mind mid-conversation.
    """

    def __init__(self) -> None:
        self._staged: dict[str, Staged] = {}

    def stage(self, staged: Staged) -> None:
        self._staged[staged.account_ref] = staged

    def take(self, account_ref: str) -> Staged | None:
        """Read and remove. Removal is the point: a confirmation is single-use, so a
        second "yes" in the same conversation cannot record the request twice."""
        import time

        staged = self._staged.pop(account_ref, None)
        if staged is None:
            return None
        if time.monotonic() > staged.expires_at:
            log.info("staged plan change for %s expired before confirmation", account_ref)
            return None
        return staged

    def peek(self, account_ref: str) -> Staged | None:
        import time

        staged = self._staged.get(account_ref)
        if staged is None or time.monotonic() > staged.expires_at:
            return None
        return staged

    def clear(self, account_ref: str) -> None:
        self._staged.pop(account_ref, None)
