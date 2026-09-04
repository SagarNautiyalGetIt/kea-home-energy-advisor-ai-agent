"""Layer 1 for connected devices — pure arithmetic over observations.

This is where device data becomes something the narrator may see. Everything here is a
pure function returning `Fact` objects, testable with no network, no vendor account and
no model, exactly like `analytics/engine.py`.

## The thing this feature actually changes

Almost every bundle in this system carries `NO_APPLIANCE`:

    "Do not name or guess which appliance caused any change — half-hourly meter data
     cannot identify appliances, and claiming otherwise is a fabrication."

That caveat is correct, load-bearing, and the single biggest limit on how useful an
answer can be. "Something in your house is using 2.4 kWh a day and I cannot tell you
what" is honest and unsatisfying, and it is the honest answer *because of the data*, not
because of a policy.

A connected device changes the data. When a heat pump reports its own energy, naming it
is not inference — it is reading a label off a measurement. So this module lifts the
caveat, and the way it lifts it is the whole design:

* **Per device, never globally.** A household with one connected heat pump may be told
  about the heat pump. Everything else in that house is still unidentifiable, and the
  bundle says so — `PARTIAL_APPLIANCE` replaces `NO_APPLIANCE` rather than removing it.
* **Only at `MEASURED` or `RATED` confidence.** An inferred device produces no dollar
  figure and licenses no naming.
* **`RATED` is always worded as an estimate.** Nameplate power is a maximum. Runtime x
  plate rating is arithmetic over two real numbers and still an over-estimate, and the
  caveat says so in the words the narrator has to use.

Get this wrong in the permissive direction and the product's central claim goes with it.
That is why the caveat text is generated from the device list rather than switched on and
off by a boolean.
"""

from __future__ import annotations

from collections import defaultdict

from app.homelink.schemas import Confidence, DeviceClass, DeviceObservation, DeviceSummary
from app.schemas import Fact

#: What the meter alone can support. Copied from `analytics.engine` rather than imported
#: so the two can diverge if the wording ever needs to — they say the same thing today.
NO_APPLIANCE = (
    "Do not name or guess which appliance caused any change — half-hourly meter "
    "data cannot identify appliances, and claiming otherwise is a fabrication."
)

#: How much of the bill a device has to account for before it is worth a sentence. Below
#: this it is true and useless — nobody changes their behaviour over 2% of a power bill,
#: and listing it crowds out the finding that matters.
MIN_SHARE_PCT = 4.0

#: A device is "always on" for the period if it ran unattended on at least this share of
#: observed days. One day is a forgotten heater; most days is a schedule, and a schedule
#: is something a person can actually go and change.
ALWAYS_ON_DAY_SHARE = 0.6


def summarise(
    observations: list[DeviceObservation],
    *,
    unit_price_nzd: float,
    total_bill_kwh: float | None = None,
) -> list[DeviceSummary]:
    """Roll observations up per device. Pure.

    `total_bill_kwh` is the household's metered total for the same period, and `share` is
    computed against it rather than against the sum of the devices. Those are different
    denominators and only one of them is honest: dividing by the device total would make
    a house with one connected plug read "your lamp is 100% of your power", which is
    arithmetically defensible and a lie in every sense that matters.
    """
    grouped: dict[str, list[DeviceObservation]] = defaultdict(list)
    for observation in observations:
        grouped[observation.device_id].append(observation)

    summaries: list[DeviceSummary] = []
    for device_id, group in grouped.items():
        first = group[0]
        energies = [o.estimated_kwh for o in group]
        known = [e for e in energies if e is not None]

        # None, not 0.0, when nothing in the group could be quantified — see
        # `DeviceObservation.estimated_kwh` on why the distinction is load-bearing.
        total_kwh = round(sum(known), 3) if known else None
        cost = round(total_kwh * unit_price_nzd, 2) if total_kwh is not None else None

        share = None
        if total_kwh is not None and total_bill_kwh and total_bill_kwh > 0:
            share = round(total_kwh / total_bill_kwh * 100, 1)

        summaries.append(
            DeviceSummary(
                device_id=device_id,
                label=first.label,
                device_class=first.device_class,
                provider=first.provider,
                # The weakest confidence in the group. A device that measured six days and
                # guessed one is a device whose total is partly a guess, and reporting the
                # best of the two would launder that.
                confidence=_weakest([o.confidence for o in group]),
                days_observed=len(group),
                total_kwh=total_kwh,
                total_cost_nzd=cost,
                share_of_bill_pct=share,
                always_on_days=sum(1 for o in group if o.always_on),
            )
        )

    # Largest first: the answer to "where is my money going" is the top of this list, and
    # a caller that truncates should truncate the tail.
    return sorted(
        summaries, key=lambda s: (s.total_cost_nzd is None, -(s.total_cost_nzd or 0.0))
    )


_CONFIDENCE_ORDER = {Confidence.INFERRED: 0, Confidence.RATED: 1, Confidence.MEASURED: 2}


def _weakest(levels: list[Confidence]) -> Confidence:
    return min(levels, key=lambda c: _CONFIDENCE_ORDER[c])


def quantified(summaries: list[DeviceSummary]) -> list[DeviceSummary]:
    """Devices that may carry a figure and be named.

    Three filters, and each one removes a different way of being wrong: no energy figure
    means nothing to say, `INFERRED` means we do not know it well enough to say it, and
    below `MIN_SHARE_PCT` means saying it is noise.
    """
    return [
        s
        for s in summaries
        if s.total_cost_nzd is not None
        and s.confidence is not Confidence.INFERRED
        and (s.share_of_bill_pct is None or s.share_of_bill_pct >= MIN_SHARE_PCT)
    ]


def device_facts(summaries: list[DeviceSummary], *, limit: int = 3) -> list[Fact]:
    """Facts the narrator may use, one per device that earned one.

    Capped at three. A bundle listing nine devices is a bundle inviting the model to
    compare them, and comparing them is arithmetic — see `number_checker`'s derived-claim
    pass, which would reject the result. Three is what fits in the two-to-four sentences
    the narration prompt asks for.
    """
    facts: list[Fact] = []
    for summary in quantified(summaries)[:limit]:
        facts.append(
            Fact.money(
                f"device_cost_{summary.device_id}",
                summary.total_cost_nzd or 0.0,
                f"What your {summary.label} cost over this period",
            )
        )
        if summary.share_of_bill_pct is not None:
            facts.append(
                Fact.percent(
                    f"device_share_{summary.device_id}",
                    summary.share_of_bill_pct,
                    f"Share of your bill from your {summary.label}",
                )
            )
    return facts


def appliance_caveats(summaries: list[DeviceSummary]) -> list[str]:
    """The caveat set for a household with connected devices.

    Returns `NO_APPLIANCE` unchanged when nothing qualifies — a household that connected a
    provider and has no usable device data is in exactly the position it was in before,
    and must not be told otherwise.
    """
    usable = quantified(summaries)
    if not usable:
        return [NO_APPLIANCE]

    named = ", ".join(f'"{s.label}"' for s in usable)
    caveats = [
        # Replaces NO_APPLIANCE rather than deleting it. The permission is an allow-list
        # of specific devices, so the default for everything else stays "you cannot say".
        f"This customer has connected smart devices, so you MAY name these and only "
        f"these: {named}. For anything else in the house the usual rule stands — "
        f"half-hourly meter data cannot identify an appliance, so do not name, guess or "
        f"hint at one.",
    ]

    if any(s.confidence is Confidence.RATED for s in usable):
        rated = ", ".join(
            f'"{s.label}"' for s in usable if s.confidence is Confidence.RATED
        )
        caveats.append(
            f"The figures for {rated} are ESTIMATES — that device reports how long it ran "
            f"but not how much power it drew, so the figure is its maximum rating times "
            f"its runtime and will be on the high side. Say 'about' or 'roughly'. Never "
            f"present it as measured."
        )

    unexplained = [s for s in summaries if s not in usable]
    if unexplained:
        caveats.append(
            "Not every device in this home reports usable figures, so the connected "
            "devices do not add up to the whole bill. Do not describe them as the whole "
            "bill, and do not present the remainder as unaccounted for."
        )

    return caveats


def always_on_findings(summaries: list[DeviceSummary]) -> list[str]:
    """Devices running to a schedule nobody set.

    The most actionable thing a connected home produces, and the reason this integration
    earns its complexity. A hot water cylinder heating at 2am every night is invisible on
    a meter, obvious to a device, and a change the customer can make in one afternoon.

    Returns prose fragments rather than Facts because these carry no number — the finding
    is *that* it happens, and the day count is the evidence. A Fact would put a bare
    integer in the bundle for the narrator to build a sentence around, and "your cylinder
    ran on 19 days" is a worse sentence than "your cylinder runs overnight every night".
    """
    findings: list[str] = []
    for summary in summaries:
        if not summary.days_observed:
            continue
        if summary.always_on_days / summary.days_observed >= ALWAYS_ON_DAY_SHARE:
            findings.append(
                f"Their {summary.label} ran unattended on {summary.always_on_days} of "
                f"{summary.days_observed} days — that is a schedule rather than a one-off, "
                f"and it is something they can change."
            )
    return findings


#: Device classes whose everyday load a customer can realistically shift or reduce.
#: Used to decide whether an always-on finding is worth surfacing at all: a fridge
#: running every day is a fridge working, not a finding.
ACTIONABLE_CLASSES: frozenset[DeviceClass] = frozenset(
    {
        DeviceClass.WATER_HEATING,
        DeviceClass.SPACE_HEATING,
        DeviceClass.COOLING,
        DeviceClass.EV_CHARGER,
        DeviceClass.LAUNDRY,
    }
)


def actionable_findings(summaries: list[DeviceSummary]) -> list[str]:
    """`always_on_findings`, minus the ones nobody can act on."""
    return always_on_findings(
        [s for s in summaries if s.device_class in ACTIONABLE_CLASSES]
    )
