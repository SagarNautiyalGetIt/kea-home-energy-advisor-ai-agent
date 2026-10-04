"""Source-dated outages and an append-only, evidence-labelled Power Clash ledger."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, Field, HttpUrl, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db.models import OutageSnapshotRow, RewardEventRow


class ScheduledOutage(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=160)
    start: AwareDatetime
    end: AwareDatetime
    status: Literal["scheduled", "cancelled", "completed"] = "scheduled"
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def valid_window(self):
        if self.end <= self.start:
            raise ValueError("Outage end must follow its start.")
        return self


class OutageSnapshot(BaseModel):
    account_ref: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    distributor: str = Field(min_length=1, max_length=100)
    source_url: HttpUrl
    fetched_at: AwareDatetime
    valid_until: AwareDatetime
    revision: int = Field(ge=1)
    events: list[ScheduledOutage] = Field(max_length=50)

    @model_validator(mode="after")
    def source_and_freshness(self):
        if self.source_url.scheme != "https":
            raise ValueError("Distributor sources must use HTTPS.")
        if not self.fetched_at < self.valid_until <= self.fetched_at + dt.timedelta(hours=24):
            raise ValueError("Outage snapshots must expire within 24 hours.")
        if len({event.event_id for event in self.events}) != len(self.events):
            raise ValueError("Duplicate outage event IDs.")
        return self


class OutageView(BaseModel):
    status: Literal["not_linked", "current", "stale"]
    snapshot: OutageSnapshot | None = None
    storage: Literal["database", "memory"]


class Mission(BaseModel):
    id: Literal["ev_off_peak", "shift_flexible_load", "review_energy_plan"]
    title: str
    question: str
    planning_xp: int = 5


MISSIONS = [
    Mission(
        id="ev_off_peak",
        title="Plan a cheaper EV charge",
        question=(
            "Help me plan EV charging using my actual off-peak tariff, "
            "departure time and battery target."
        ),
    ),
    Mission(
        id="shift_flexible_load",
        title="Move one flexible task",
        question=(
            "Which flexible energy task could I move off peak without "
            "changing my comfort or routine?"
        ),
    ),
    Mission(
        id="review_energy_plan",
        title="Check my energy plan",
        question=(
            "Compare my plan using measured usage and tell me if the evidence "
            "supports a cheaper option."
        ),
    ),
]


class PlanAction(BaseModel):
    mission_id: Literal["ev_off_peak", "shift_flexible_load", "review_energy_plan"]


class VerifiedAction(BaseModel):
    account_ref: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    receipt_id: str = Field(min_length=1, max_length=128)
    provider: str = Field(min_length=1, max_length=64)
    mission_id: Literal["ev_off_peak", "shift_flexible_load"]
    day: dt.date
    tariff_id: str = Field(min_length=1, max_length=128)
    shifted_kwh: Decimal = Field(gt=0, le=100, max_digits=8, decimal_places=3)
    peak_nzd_per_kwh: Decimal = Field(ge=0, le=5, max_digits=8, decimal_places=4)
    off_peak_nzd_per_kwh: Decimal = Field(ge=0, le=5, max_digits=8, decimal_places=4)
    measured_interval_count: int = Field(ge=2, le=288)
    comfort_preserved: Literal[True]

    @model_validator(mode="after")
    def valid_measurement(self):
        today = dt.datetime.now(ZoneInfo("Pacific/Auckland")).date()
        if not today - dt.timedelta(days=7) <= self.day <= today:
            raise ValueError("Receipts must cover the last seven days.")
        if self.peak_nzd_per_kwh <= self.off_peak_nzd_per_kwh:
            raise ValueError("This receipt does not demonstrate cheaper shifting.")
        return self


class RewardEvent(BaseModel):
    key: str
    mission_id: str
    evidence: Literal["planned", "verified"]
    xp: int
    day: dt.date
    savings_nzd: Decimal = Decimal("0")
    source: str


class ClashProgress(BaseModel):
    total_xp: int
    planning_xp: int
    verified_xp: int
    estimated_shift_savings_nzd: Decimal
    events: list[RewardEvent]
    missions: list[Mission] = MISSIONS
    storage: Literal["database", "memory"]


def reward_for(receipt: VerifiedAction) -> RewardEvent:
    saving = (
        receipt.shifted_kwh * (receipt.peak_nzd_per_kwh - receipt.off_peak_nzd_per_kwh)
    ).quantize(Decimal("0.01"))
    return RewardEvent(
        key=f"verified:{receipt.mission_id}:{receipt.day}",
        mission_id=receipt.mission_id,
        evidence="verified",
        xp=min(50, max(1, int(receipt.shifted_kwh * 10))),
        day=receipt.day,
        savings_nzd=saving,
        source=f"{receipt.provider} · {receipt.tariff_id}",
    )


class ExperienceStore:
    def __init__(self, sessionmaker=None):
        self.sessions = sessionmaker
        self.name = "database" if sessionmaker else "memory"
        self.outages: dict[str, OutageSnapshot] = {}
        self.events: dict[tuple[str, str], RewardEvent] = {}

    async def outage(self, account: str) -> OutageView:
        snapshot = self.outages.get(account)
        if self.sessions:
            async with self.sessions() as session:
                row = await session.get(OutageSnapshotRow, account)
                snapshot = OutageSnapshot.model_validate(row.payload) if row else None
        now = dt.datetime.now(dt.UTC)
        return OutageView(
            status="not_linked"
            if snapshot is None
            else "stale"
            if snapshot.valid_until < now or now - snapshot.fetched_at > dt.timedelta(hours=6)
            else "current",
            snapshot=snapshot,
            storage=self.name,
        )

    async def ingest(self, snapshot: OutageSnapshot) -> bool:
        allowed = {host.strip() for host in settings.outage_source_hosts.split(",") if host.strip()}
        if urlparse(str(snapshot.source_url)).hostname not in allowed:
            raise ValueError("Distributor source is not approved for ingestion.")
        if snapshot.fetched_at > dt.datetime.now(dt.UTC) + dt.timedelta(minutes=5):
            raise ValueError("Snapshot fetched_at is in the future.")
        if self.sessions:
            from sqlalchemy.dialects.postgresql import insert

            async with self.sessions() as session:
                statement = insert(OutageSnapshotRow).values(
                    account_ref=snapshot.account_ref,
                    revision=snapshot.revision,
                    payload=snapshot.model_dump(mode="json"),
                )
                statement = statement.on_conflict_do_update(
                    index_elements=["account_ref"],
                    set_={
                        "revision": snapshot.revision,
                        "payload": snapshot.model_dump(mode="json"),
                    },
                    where=OutageSnapshotRow.revision < snapshot.revision,
                ).returning(OutageSnapshotRow.account_ref)
                result = await session.scalar(statement)
                await session.commit()
                return result is not None
        old = self.outages.get(snapshot.account_ref)
        if old and old.revision >= snapshot.revision:
            return False
        self.outages[snapshot.account_ref] = snapshot
        return True

    async def award(self, account: str, event: RewardEvent) -> bool:
        if self.sessions:
            async with self.sessions() as session:
                session.add(
                    RewardEventRow(
                        account_ref=account,
                        event_key=event.key,
                        payload=event.model_dump(mode="json"),
                    )
                )
                try:
                    await session.commit()
                except IntegrityError:
                    await session.rollback()
                    return False
                return True
        key = (account, event.key)
        if key in self.events:
            return False
        self.events[key] = event
        return True

    async def progress(self, account: str) -> ClashProgress:
        events = [event for (owner, _), event in self.events.items() if owner == account]
        if self.sessions:
            async with self.sessions() as session:
                rows = (
                    await session.scalars(
                        select(RewardEventRow).where(RewardEventRow.account_ref == account)
                    )
                ).all()
                events = [RewardEvent.model_validate(row.payload) for row in rows]
        planned = sum(event.xp for event in events if event.evidence == "planned")
        verified = sum(event.xp for event in events if event.evidence == "verified")
        return ClashProgress(
            total_xp=planned + verified,
            planning_xp=planned,
            verified_xp=verified,
            estimated_shift_savings_nzd=sum((event.savings_nzd for event in events), Decimal("0")),
            events=sorted(events, key=lambda event: event.day, reverse=True)[:50],
            storage=self.name,
        )


@lru_cache(maxsize=1)
def experience_store() -> ExperienceStore:
    if settings.persist:
        from app.db.session import get_sessionmaker

        return ExperienceStore(get_sessionmaker())
    return ExperienceStore()
