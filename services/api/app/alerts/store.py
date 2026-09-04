"""Reading and writing a household's alert settings.

Two implementations behind one Protocol, chosen by the same `KEA_PERSIST` flag the
recorder and the repository use — so there is no configuration in which the API writes
preferences to PostgreSQL but reads them from memory.

## Absence means defaults, and there is no backfill

A household with no row gets `preferences.defaults_for(account_ref)`, which is exactly the
ladder the hard-coded constants used. Writing a row per customer identical to the defaults
would mean migrating every row the next time a default moves, and it would make "this
customer has never touched their settings" indistinguishable from "this customer chose the
defaults" — which matters, because only the first is safe to change under them.

## The contact points, and where they come from

`email` and `phone_e164` live on the preference row rather than on `customer`, because
the seeded households deliberately carry no personal details: 47.6% of surveyed customers
said they would not trust an AI with their data, and the schema has to be able to back
that claim up. An address the customer gave us specifically so we could warn them about
their bill is a different thing from a profile we assembled, and it is stored in the place
that says so.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Protocol

from sqlalchemy import select

from app.alerts.preferences import AlertPreferences, defaults_for
from app.db.models import AlertPreferenceRow

log = logging.getLogger(__name__)


class PreferencesStore(Protocol):
    name: str

    async def get(self, account_ref: str) -> AlertPreferences: ...

    async def put(self, prefs: AlertPreferences) -> AlertPreferences: ...


def _to_model(row: AlertPreferenceRow) -> AlertPreferences:
    return AlertPreferences(
        account_ref=row.account_ref,
        enabled=row.enabled,
        # Numeric comes back as Decimal. Pydantic would coerce it, but float() here keeps
        # the model's own type honest — every threshold comparison downstream is float
        # arithmetic against a forecast, and a stray Decimal turns those into
        # TypeError at the one moment nobody is watching.
        tier1_pct=float(row.tier1_pct),
        tier2_pct=float(row.tier2_pct),
        tier3_pct=float(row.tier3_pct),
        min_overshoot_nzd=float(row.min_overshoot_nzd),
        email_enabled=row.email_enabled,
        sms_enabled=row.sms_enabled,
        voice_enabled=row.voice_enabled,
        email=row.email,
        phone_e164=row.phone_e164,
        quiet_hours_start=row.quiet_hours_start,
        quiet_hours_end=row.quiet_hours_end,
        timezone=row.timezone,
        offline_model_opt_in=row.offline_model_opt_in,
    )


def _apply(row: AlertPreferenceRow, prefs: AlertPreferences) -> None:
    row.enabled = prefs.enabled
    row.tier1_pct = Decimal(str(prefs.tier1_pct))
    row.tier2_pct = Decimal(str(prefs.tier2_pct))
    row.tier3_pct = Decimal(str(prefs.tier3_pct))
    row.min_overshoot_nzd = Decimal(str(prefs.min_overshoot_nzd))
    row.email_enabled = prefs.email_enabled
    row.sms_enabled = prefs.sms_enabled
    row.voice_enabled = prefs.voice_enabled
    row.email = prefs.email
    row.phone_e164 = prefs.phone_e164
    row.quiet_hours_start = prefs.quiet_hours_start
    row.quiet_hours_end = prefs.quiet_hours_end
    row.timezone = prefs.timezone
    row.offline_model_opt_in = prefs.offline_model_opt_in


class DatabasePreferencesStore:
    """PostgreSQL-backed. Upserts by primary key."""

    name = "database"

    def __init__(self, sessionmaker) -> None:
        self._sessionmaker = sessionmaker

    async def get(self, account_ref: str) -> AlertPreferences:
        try:
            async with self._sessionmaker() as session:
                row = await session.scalar(
                    select(AlertPreferenceRow).where(
                        AlertPreferenceRow.account_ref == account_ref
                    )
                )
        except Exception:
            # Same rule as the recorder: a settings lookup that fails must not cost the
            # customer their warning. Defaults are a safe answer — they are what the
            # ladder did before this table existed.
            log.exception("could not read alert preferences for %s — using defaults", account_ref)
            return defaults_for(account_ref)

        return _to_model(row) if row else defaults_for(account_ref)

    async def put(self, prefs: AlertPreferences) -> AlertPreferences:
        """Create or update. Raises — unlike `get`, a failed save must be visible.

        A settings screen that reports success and saves nothing is the worst version of
        this feature: the customer believes they will be told at 25% and they will not.
        """
        async with self._sessionmaker() as session:
            row = await session.get(AlertPreferenceRow, prefs.account_ref)
            if row is None:
                row = AlertPreferenceRow(account_ref=prefs.account_ref)
                session.add(row)
            _apply(row, prefs)
            await session.commit()
        return prefs


class MemoryPreferencesStore:
    """What runs when persistence is off — the normal state for frontend work and CI.

    Not a test double. The Settings screen has to save something while it is being built,
    and a read-only default store would make every save appear to fail. Disclosed on
    `/health` so "your settings were saved" and "your settings were saved until the
    process restarts" are not indistinguishable.
    """

    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, AlertPreferences] = {}

    async def get(self, account_ref: str) -> AlertPreferences:
        return self._rows.get(account_ref) or defaults_for(account_ref)

    async def put(self, prefs: AlertPreferences) -> AlertPreferences:
        self._rows[prefs.account_ref] = prefs
        return prefs


def build_preferences_store(persist: bool) -> PreferencesStore:
    if not persist:
        return MemoryPreferencesStore()
    from app.db.session import get_sessionmaker

    return DatabasePreferencesStore(get_sessionmaker())
