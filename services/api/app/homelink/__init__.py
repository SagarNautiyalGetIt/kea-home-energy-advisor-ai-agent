"""Smart-home integration — more context, under the same rules.

Connecting a customer's Apple Home, Google Home, Matter controller or SmartThings account
so answers can say *which* appliance rather than "something in your house".

    connectors  vendor payload   ->  DeviceObservation   normalisation      (I/O)
    insights    observations     ->  Fact + caveats      pure arithmetic    (layer 1)
    narration   facts            ->  a sentence          the model          (layer 2)

The architecture is unchanged and that is the point. Device data is more raw data, so it
enters at layer 1 like meter readings do, and the model still only writes the sentence.

## The two decisions worth knowing before reading the code

**`NO_APPLIANCE` is lifted per device, never per household.** The caveat forbidding the
narrator from naming an appliance is the single biggest limit on how useful an answer can
be, and a connected device is the only honest reason to relax it. `insights.appliance_
caveats` therefore generates an allow-list of the specific devices that reported usable
figures, and leaves the prohibition in place for everything else in the house.

**Apple HomeKit is push-only, because Apple publishes no cloud API.** The iOS app reads
HomeKit locally and posts daily summaries; this backend is a sink. That is a constraint,
not a shortcut, and it has the pleasant side effect that the minute-level accessory
stream — the most intrusive data anywhere near this product — never leaves the phone.

See `docs/adr/0009-smart-home-integration.md` for the sequencing and the open questions.
"""

from app.homelink.insights import (
    actionable_findings,
    appliance_caveats,
    device_facts,
    summarise,
)
from app.homelink.schemas import (
    Confidence,
    Connection,
    DeviceClass,
    DeviceObservation,
    DeviceSummary,
    Provider,
)

__all__ = [
    "Confidence",
    "Connection",
    "DeviceClass",
    "DeviceObservation",
    "DeviceSummary",
    "Provider",
    "actionable_findings",
    "appliance_caveats",
    "device_facts",
    "summarise",
]
