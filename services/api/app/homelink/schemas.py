"""What a connected home tells us, normalised.

Five providers with five different data models collapse to one shape here, and everything
above this file is written against that shape rather than against any vendor's.

## The single rule this package exists to respect

Device data is **more raw data**, and the architecture's whole claim is that the model
never touches raw data. So a device observation is not a thing the narrator ever sees. It
goes:

    connector    vendor payload      ->  DeviceObservation   (normalisation, I/O)
    insights     observations        ->  Fact                (pure Python arithmetic)
    narration    facts               ->  a sentence          (the model)

An observation reaching a prompt would hand a language model a runtime in minutes and a
wattage and invite it to multiply them, which is the one thing this system is built to
prevent. `test_no_calculation.py` asserts it does not.

## Minute-level data is deliberately not stored

A device event stream is a record of when somebody is home, when they shower, and when
they go to bed. 47.6% of surveyed customers said they would not trust an AI with their
usage data, and half-hourly meter reads are already the sharpest thing we hold. Adding a
per-second occupancy signal to that, for a feature about explaining bills, is not a trade
worth making — so connectors aggregate to daily runtime and energy at the edge, and
`DeviceObservation` has no field a minute-level record could go in. That is a schema-level
guarantee rather than a policy somebody has to remember.
"""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import BaseModel, Field


class Provider(StrEnum):
    """Where the data came from. Carried on every observation because the trust level and
    the legal basis differ per provider, and a mixed-provider household is normal."""

    #: Apple HomeKit. On-device only — see `connectors.HomeKitConnector` for why there is
    #: no cloud integration to build and why that is a feature rather than a limitation.
    HOMEKIT = "homekit"
    #: Google Home / Device Access. Cloud-to-cloud OAuth.
    GOOGLE_HOME = "google_home"
    #: Matter over a local controller (Home Assistant, a hub). Local, open, no vendor.
    MATTER = "matter"
    #: Samsung SmartThings. Cloud OAuth.
    SMARTTHINGS = "smartthings"
    #: Development and the demo. Never reachable in a deployment — see the registry.
    MOCK = "mock"


class DeviceClass(StrEnum):
    """What kind of load it is, in the only terms that matter for a power bill.

    Deliberately coarse. A vendor taxonomy has two hundred device types and this has
    eight, because the question the product answers is "where is the money going" and a
    smart bulb and a smart plug on a lamp are the same answer. Precision we cannot use is
    surface area we have to maintain.
    """

    SPACE_HEATING = "space_heating"
    """Heat pump, panel heater, electric radiator. Usually the largest single load."""

    WATER_HEATING = "water_heating"
    """Hot water cylinder. Typically the largest *invisible* load — it runs to a schedule
    nobody set and nobody looks at, which is exactly the finding this product exists for."""

    COOLING = "cooling"
    LAUNDRY = "laundry"
    """Washer, dryer. Intermittent and easy for a customer to shift off peak."""

    KITCHEN = "kitchen"
    """Oven, dishwasher, fridge."""

    EV_CHARGER = "ev_charger"
    """The fastest-growing residential load in NZ, and the most shiftable."""

    LIGHTING = "lighting"
    OTHER = "other"


class Confidence(StrEnum):
    """How much this figure can carry, and therefore what may be said about it.

    This is the field that makes the whole feature safe. A device that reports its own
    energy meter is a measurement; a device that reports on/off and has a nameplate rating
    is an estimate; a device inferred from a schedule is a guess. Presenting all three as
    "your heat pump used 4.2 kWh" would put the product's central claim behind the weakest
    of them.
    """

    MEASURED = "measured"
    """The device reported energy directly, from its own meter. A fact."""

    RATED = "rated"
    """Runtime x the device's nameplate power. Real arithmetic over two real numbers, but
    nameplate power is a maximum, not a draw — must be described as an estimate."""

    INFERRED = "inferred"
    """Neither. Never turned into a dollar figure, and never narrated as one."""


class DeviceObservation(BaseModel):
    """One device, one day. The atom of this package.

    A day rather than an event because of the minimisation rule in the module docstring,
    and because a bill is billed per day. Anything finer would be data we cannot use held
    at a resolution we cannot justify.
    """

    device_id: str = Field(description="Stable per (provider, household). Never a serial.")
    provider: Provider
    device_class: DeviceClass
    label: str = Field(description="What the customer calls it — 'Lounge heat pump'.")
    day: dt.date

    runtime_minutes: float | None = Field(
        default=None, ge=0, le=1440, description="Minutes the device was drawing power."
    )
    energy_kwh: float | None = Field(
        default=None, ge=0, description="Reported by the device's own meter, if it has one."
    )
    rated_watts: float | None = Field(
        default=None, ge=0, description="Nameplate power. A maximum, not a draw."
    )
    confidence: Confidence

    #: Whether this device was running when nobody asked it to — a cylinder on a 24/7
    #: schedule, a heater left on in an empty room. The single most actionable signal a
    #: connected home produces, and the reason this integration is worth building.
    always_on: bool = False

    @property
    def estimated_kwh(self) -> float | None:
        """Energy, measured if the device knows and derived from the plate if not.

        Returns None rather than 0.0 when neither is available. A missing figure and a
        zero figure mean opposite things — "we do not know what this used" and "this used
        nothing" — and collapsing them would let a device we cannot read reduce a
        household's attributed total, making the unexplained remainder look larger.
        """
        if self.energy_kwh is not None:
            return round(self.energy_kwh, 3)
        if self.runtime_minutes is not None and self.rated_watts:
            return round(self.rated_watts * (self.runtime_minutes / 60) / 1000, 3)
        return None


class DeviceSummary(BaseModel):
    """What the app shows for one device over a period. Computed, never narrated raw."""

    device_id: str
    label: str
    device_class: DeviceClass
    provider: Provider
    confidence: Confidence
    days_observed: int
    total_kwh: float | None
    total_cost_nzd: float | None
    share_of_bill_pct: float | None
    always_on_days: int


class Connection(BaseModel):
    """A household's link to one provider.

    `scopes` is stored because consent is per-scope and revocable, and because "what did
    they actually agree to" is a question that gets asked months later by someone who was
    not in the room. A boolean `connected` cannot answer it.
    """

    account_ref: str
    provider: Provider
    status: str = Field(description="active | revoked | error")
    scopes: list[str] = Field(default_factory=list)
    device_count: int = 0
    connected_at: dt.datetime | None = None
    last_sync_at: dt.datetime | None = None
    last_error: str | None = None

    #: Set when the customer disconnects. The row is kept rather than deleted so a later
    #: question about a figure we quoted while connected still has its provenance.
    revoked_at: dt.datetime | None = None
