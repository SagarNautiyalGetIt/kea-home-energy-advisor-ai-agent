"""What this bill would have cost on a Kea plan.

## Why this is arithmetic and not a conversation

The model read the bill. It does not also get to decide whether the customer should
switch, because that decision is the one with money attached and the one this company
benefits from. Everything below is division and comparison over two numbers the customer
can check against the page in their hand: their total, and ours.

## The term credit is not a discount on a worse plan

`docs/sprints/sprint-3/plans-and-terms.md` is explicit: *a switch is recommended only
when `usage_saving > 0`; a term credit cannot turn a more expensive usage plan into a
"saving"*. That rule exists because the opposite is the oldest trick in retail energy —
quote a signing bonus loudly enough that nobody prices the year behind it.

So the credit is reported separately from the usage saving, never added into the
headline when the usage saving is negative, and always alongside the exit fee that pays
for it. A customer who would be worse off on Kea is told they would be worse off on Kea.

## What this cannot know

A bill is one period. It carries no half-hourly shape, so Time of Use and Free Weekends
cannot be priced from it — the same rule `analytics/plans.py` applies to a Kea household
with no band data, for the same reason. Only the flat Anytime Rate is comparable from a
bill alone, and the result says so rather than quietly comparing one plan and calling it
a catalogue.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from app.analytics.plans import ANYTIME
from app.bills.reader import BillReading

#: From the plans page: $25 a month for twelve months. Reported, never added to a
#: headline saving — see the module docstring.
TWELVE_MONTH_CREDIT_NZD = 300.0
TWELVE_MONTH_EXIT_FEE_MAX_NZD = 100.0
SIX_MONTH_CREDIT_NZD = 60.0
SIX_MONTH_EXIT_FEE_MAX_NZD = 50.0

#: Under this over a year, the two are the same price and saying otherwise is noise.
#: Matches `plans.MATERIAL_SAVING_NZD_PER_YEAR` deliberately — a customer should not get
#: one threshold from their own usage and a different one from a photograph.
MATERIAL_SAVING_NZD_PER_YEAR = 30.0


@dataclass(frozen=True)
class BillComparison:
    comparable: bool
    reason: str | None = None

    days: int | None = None
    their_total_nzd: float | None = None
    kea_total_nzd: float | None = None
    kea_plan: str | None = None
    #: Positive means Kea is cheaper over the same period.
    period_saving_nzd: float | None = None
    annual_saving_nzd: float | None = None
    material: bool | None = None

    their_effective_rate_nzd: float | None = None
    kea_unit_rate_nzd: float | None = None
    kea_daily_charge_nzd: float | None = None

    term_credit_nzd: float | None = None
    term_exit_fee_max_nzd: float | None = None
    caveats: tuple[str, ...] = ()

    def as_payload(self) -> dict[str, Any]:
        return {
            "comparable": self.comparable,
            "reason": self.reason,
            "days": self.days,
            "their_total_nzd": self.their_total_nzd,
            "kea_total_nzd": self.kea_total_nzd,
            "kea_plan": self.kea_plan,
            "period_saving_nzd": self.period_saving_nzd,
            "annual_saving_nzd": self.annual_saving_nzd,
            "material": self.material,
            "their_effective_rate_nzd": self.their_effective_rate_nzd,
            "kea_unit_rate_nzd": self.kea_unit_rate_nzd,
            "kea_daily_charge_nzd": self.kea_daily_charge_nzd,
            "term_credit_nzd": self.term_credit_nzd,
            "term_exit_fee_max_nzd": self.term_exit_fee_max_nzd,
            "caveats": list(self.caveats),
        }


def _days(reading: BillReading) -> int | None:
    if reading.days_in_period and reading.days_in_period > 0:
        return reading.days_in_period
    if reading.period_start and reading.period_end:
        try:
            start = dt.date.fromisoformat(reading.period_start)
            end = dt.date.fromisoformat(reading.period_end)
        except ValueError:
            return None
        span = (end - start).days + 1
        return span if span > 0 else None
    return None


def compare_to_kea(reading: BillReading) -> BillComparison:
    """Price this bill's usage on Kea's flat plan and say plainly who is cheaper."""
    if not reading.is_electricity_bill:
        return BillComparison(
            comparable=False,
            reason="That does not look like an electricity bill, so there is nothing to compare.",
        )
    if not reading.is_comparable:
        return BillComparison(
            comparable=False,
            reason=(
                "The usage and billing period could not both be read off that page, and "
                "a comparison without them would be about a different household. A "
                "clearer photo of the summary section usually has both."
            ),
        )

    days = _days(reading)
    if not days:
        return BillComparison(
            comparable=False,
            reason="The billing period could not be read, so the daily charges cannot be counted.",
        )

    kwh = float(reading.total_kwh or 0)
    kea_energy = kwh * ANYTIME.unit_rate_nzd
    kea_fixed = days * ANYTIME.daily_fixed_nzd
    kea_total = round(kea_energy + kea_fixed, 2)

    caveats: list[str] = [
        "Kea's figure is this bill's own kWh priced at Kea's published Anytime Rate. It "
        "is an estimate of the same period, not a quote.",
    ]
    if reading.confidence != "high":
        caveats.append(
            f"The photo read as {reading.confidence} confidence. Ask the customer to "
            "confirm the usage and total before relying on the comparison."
        )
    if reading.unreadable_fields:
        caveats.append(
            "These fields could not be read: " + ", ".join(reading.unreadable_fields) + "."
        )
    if reading.has_time_of_use_rates:
        caveats.append(
            "Their bill has time-of-use rates, so their total reflects when they used "
            "power. Kea's Time of Use plan might suit them better than the flat rate "
            "compared here, but a bill carries no half-hourly shape to price it from."
        )
    if reading.is_gst_inclusive is False:
        caveats.append(
            "Their total reads as GST-exclusive and Kea's rates are GST-inclusive. Say "
            "the comparison is not like-for-like until that is confirmed."
        )

    their_total = reading.total_due_nzd
    if their_total is None or their_total <= 0:
        return BillComparison(
            comparable=False,
            reason=(
                "The amount due could not be read off that page, so there is nothing to "
                "compare Kea's price against."
            ),
            days=days,
            kea_total_nzd=kea_total,
            kea_plan=ANYTIME.name,
            caveats=tuple(caveats),
        )

    period_saving = round(their_total - kea_total, 2)
    annual_saving = round(period_saving / days * 365, 2)
    material = abs(annual_saving) >= MATERIAL_SAVING_NZD_PER_YEAR and period_saving > 0

    # The credit is only ever mentioned where the usage price already wins. Reporting it
    # on a losing comparison is precisely the move the plan doc forbids.
    credit = TWELVE_MONTH_CREDIT_NZD if material else None
    exit_fee = TWELVE_MONTH_EXIT_FEE_MAX_NZD if material else None
    if material:
        caveats.append(
            f"The ${TWELVE_MONTH_CREDIT_NZD:.0f} is the 12-month term credit — "
            f"$25 a month for twelve months — and it is separate from the usage saving. "
            f"Quote it as a credit for committing, never as part of what they save on "
            f"power, and mention the early-exit fee of up to "
            f"${TWELVE_MONTH_EXIT_FEE_MAX_NZD:.0f} in the same breath."
        )
    elif period_saving <= 0:
        caveats.append(
            "Kea is NOT cheaper for this household on these numbers. Say so plainly. Do "
            "not offer the term credit to make up the difference — it is a credit for "
            "committing, not a discount on a dearer plan."
        )
    else:
        caveats.append(
            "The difference is under $30 a year, which is not a reason to switch. Say "
            "the two are about the same price."
        )

    return BillComparison(
        comparable=True,
        days=days,
        their_total_nzd=round(their_total, 2),
        kea_total_nzd=kea_total,
        kea_plan=ANYTIME.name,
        period_saving_nzd=period_saving,
        annual_saving_nzd=annual_saving,
        material=material,
        their_effective_rate_nzd=round(their_total / kwh, 4) if kwh else None,
        kea_unit_rate_nzd=ANYTIME.unit_rate_nzd,
        kea_daily_charge_nzd=ANYTIME.daily_fixed_nzd,
        term_credit_nzd=credit,
        term_exit_fee_max_nzd=exit_fee,
        caveats=tuple(caveats),
    )
