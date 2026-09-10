"""Pricing a photographed bill against Kea.

This is the one feature in the product that exists to convert somebody, which is exactly
why it gets the tighter leash. The tests below are almost entirely about the ways it
could mislead:

* quoting a $300 credit at a household that would be worse off here
* calling a few dollars a year a saving
* comparing against a bill whose figures were never actually read
* comparing a GST-inclusive total against a GST-exclusive one and not saying so

`reader.py` is not tested here beyond its coercion, because its job is to get numbers off
a photograph and that needs a photograph and a model. What IS tested is that nothing
downstream trusts it more than it should.
"""

from __future__ import annotations

import pytest

from app.analytics.plans import ANYTIME
from app.bills.compare import (
    MATERIAL_SAVING_NZD_PER_YEAR,
    TWELVE_MONTH_CREDIT_NZD,
    compare_to_kea,
)
from app.bills.reader import BillReading, _coerce


def bill(**kw) -> BillReading:
    """A legible 31-day bill. Override one field per test so the failure names itself."""
    base = dict(
        is_electricity_bill=True,
        retailer="Another Retailer",
        period_start="2026-07-01",
        period_end="2026-07-31",
        days_in_period=31,
        total_due_nzd=314.84,
        total_kwh=642.0,
        unit_rate_nzd_per_kwh=0.389,
        daily_charge_nzd=2.10,
        is_gst_inclusive=True,
        has_time_of_use_rates=False,
        confidence="high",
    )
    base.update(kw)
    return BillReading(**base)


# ---------- the offer, and when it may not be made ----------


def test_a_dearer_retailer_gets_the_real_saving_and_the_term_credit() -> None:
    """642 kWh over 31 days: $253.60 on Anytime against their $314.84."""
    result = compare_to_kea(bill())

    assert result.comparable
    expected = round(642.0 * ANYTIME.unit_rate_nzd + 31 * ANYTIME.daily_fixed_nzd, 2)
    assert result.kea_total_nzd == pytest.approx(expected, abs=0.01)
    assert result.period_saving_nzd == pytest.approx(61.24, abs=0.02)
    assert result.material is True
    assert result.term_credit_nzd == TWELVE_MONTH_CREDIT_NZD
    # The credit is never quoted without what it costs to leave.
    assert result.term_exit_fee_max_nzd == 100.0
    assert any("separate from the usage saving" in c for c in result.caveats)


def test_the_term_credit_is_never_offered_to_a_household_we_are_dearer_for() -> None:
    """The oldest trick in retail energy is a signing bonus loud enough that nobody
    prices the year behind it. `plans-and-terms.md` forbids it and this is the assertion
    that keeps the code honest: a term credit cannot turn a more expensive plan into a
    saving, so it is not even reported when the usage price loses."""
    cheap_rival = compare_to_kea(bill(total_due_nzd=162.72))

    assert cheap_rival.comparable
    assert cheap_rival.period_saving_nzd < 0
    assert cheap_rival.material is False
    assert cheap_rival.term_credit_nzd is None
    assert cheap_rival.term_exit_fee_max_nzd is None
    assert any("NOT cheaper" in c for c in cheap_rival.caveats)
    assert any("not a discount on a dearer plan" in c for c in cheap_rival.caveats)


def test_a_few_dollars_a_year_is_not_a_reason_to_switch() -> None:
    """Kea a shade cheaper, but under the materiality floor. Telling somebody to change
    retailer, sign a term and risk an exit fee to save pocket change is worse advice
    than saying nothing."""
    kea = 642.0 * ANYTIME.unit_rate_nzd + 31 * ANYTIME.daily_fixed_nzd
    # A whisker above Kea: about $1.70 a year.
    marginal = compare_to_kea(bill(total_due_nzd=round(kea + 0.14, 2)))

    assert marginal.period_saving_nzd > 0
    assert abs(marginal.annual_saving_nzd) < MATERIAL_SAVING_NZD_PER_YEAR
    assert marginal.material is False
    assert marginal.term_credit_nzd is None
    assert any("about the same price" in c for c in marginal.caveats)


# ---------- refusing to compare ----------


def test_a_bill_that_is_not_an_electricity_bill_is_refused() -> None:
    result = compare_to_kea(bill(is_electricity_bill=False))
    assert result.comparable is False
    assert "electricity bill" in (result.reason or "")


def test_no_usage_means_no_comparison() -> None:
    """Without kWh there is nothing to price, and a comparison built on a total alone
    would be about a different household's consumption."""
    assert compare_to_kea(bill(total_kwh=None)).comparable is False
    assert compare_to_kea(bill(total_kwh=0)).comparable is False


def test_no_period_means_the_daily_charges_cannot_be_counted() -> None:
    result = compare_to_kea(bill(days_in_period=None, period_start=None, period_end=None))
    assert result.comparable is False
    assert "period" in (result.reason or "")


def test_the_period_is_derived_from_dates_when_the_day_count_is_missing() -> None:
    """1 July to 31 July inclusive is 31 days, not 30. An off-by-one here is a whole
    day's fixed charge on both sides of the comparison."""
    result = compare_to_kea(bill(days_in_period=None))
    assert result.days == 31


def test_an_unreadable_total_refuses_rather_than_comparing_against_nothing() -> None:
    result = compare_to_kea(bill(total_due_nzd=None))
    assert result.comparable is False
    # Kea's own side is still priced, because that part never depended on the photo.
    assert result.kea_total_nzd is not None


# ---------- saying how much to trust the photograph ----------


def test_a_low_confidence_read_says_so() -> None:
    result = compare_to_kea(bill(confidence="low"))
    assert any("low confidence" in c for c in result.caveats)


def test_unreadable_fields_are_named() -> None:
    result = compare_to_kea(bill(unreadable_fields=["daily_charge_nzd"]))
    assert any("daily_charge_nzd" in c for c in result.caveats)


def test_a_gst_exclusive_total_is_flagged_as_not_like_for_like() -> None:
    """Kea's rates are GST-inclusive. Comparing them against an ex-GST total makes us
    look 15% cheaper than we are, which is the most flattering possible error and so the
    one most worth catching."""
    result = compare_to_kea(bill(is_gst_inclusive=False))
    assert any("not like-for-like" in c for c in result.caveats)


def test_a_time_of_use_bill_says_the_flat_comparison_is_partial() -> None:
    """A bill carries no half-hourly shape, so Time of Use cannot be priced from it —
    the same rule `analytics/plans.py` applies to a Kea household with no band data."""
    result = compare_to_kea(bill(has_time_of_use_rates=True))
    assert any("no half-hourly shape" in c for c in result.caveats)


# ---------- the reader's coercion ----------


def test_a_rate_the_model_returned_as_text_becomes_none_not_a_crash() -> None:
    """The model is asked for numbers and usually returns them. When it returns "32.5c"
    instead, that has to become None here rather than raise on the first multiplication
    three modules away, where the traceback would say nothing about a photograph."""
    reading = _coerce(
        {
            "is_electricity_bill": True,
            "total_kwh": "642 kWh",
            "unit_rate_nzd_per_kwh": "32.5c",
            "total_due_nzd": 314.84,
            "confidence": "wildly certain",
        },
        latency_ms=0,
    )
    assert reading.total_kwh is None
    assert reading.unit_rate_nzd_per_kwh is None
    assert reading.total_due_nzd == 314.84
    # An unrecognised confidence falls to the most cautious value, never the loudest.
    assert reading.confidence == "low"


def test_booleans_are_not_mistaken_for_numbers() -> None:
    """`True` is `1` in Python, and a bill priced at one kilowatt-hour because a flag
    leaked into a number field would be quietly, confidently wrong."""
    reading = _coerce(
        {"is_electricity_bill": True, "total_kwh": True, "days_in_period": False},
        latency_ms=0,
    )
    assert reading.total_kwh is None
    assert reading.days_in_period is None
