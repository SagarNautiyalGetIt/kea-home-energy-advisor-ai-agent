"""Pricing half-hourly usage against the three Sprint 3 Kea tariffs.

Rates are transcribed from the plan screenshots through
``data/pipeline/scripts/gen_source/02_catalogue.sql``. The catalogue stores
ex-GST, pre-line-loss values; tests recompose them onto the customer-facing
basis shown in the UI.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

from app.analytics.tariff import (
    ENERGY,
    NETWORK,
    Band,
    FlatCharge,
    Reading,
    Tariff,
    TariffError,
    cost_of,
)

D = Decimal
ALL_DAYS = range(1, 8)
LOSS = D("0.0511")
GST = D("1.15")


def _band(group, label, days, start_h, end_h, rate):
    return Band(charge_group=group, label=label, days=frozenset(days),
                start_minute=int(start_h * 60), end_minute=int(end_h * 60),
                rate=D(rate))


def _network_zero():
    return _band(NETWORK, "BUNDLED", ALL_DAYS, 0, 24, "0")


ANYTIME = Tariff(
    name="Anytime Rate",
    bands=(
        _band(ENERGY, "ANYTIME", ALL_DAYS, 0, 24, "0.268869"),
        _network_zero(),
    ),
    flat=(FlatCharge("other", "Daily charge", D("1.260870"), "day"),),
    export_bands=(_band(ENERGY, "ANYTIME", ALL_DAYS, 0, 24, "0.069565"),),
    loss_factor=LOSS,
)

TIME_OF_USE = Tariff(
    name="Time of Use",
    bands=(
        _network_zero(),
        _band(ENERGY, "NIGHT", ALL_DAYS, 0, 7, "0.148912"),
        _band(ENERGY, "PEAK", ALL_DAYS, 7, 11, "0.322643"),
        _band(ENERGY, "OFFPEAK", ALL_DAYS, 11, 17, "0.223368"),
        _band(ENERGY, "PEAK", ALL_DAYS, 17, 21, "0.322643"),
        _band(ENERGY, "OFFPEAK", ALL_DAYS, 21, 23, "0.223368"),
        _band(ENERGY, "NIGHT", ALL_DAYS, 23, 24, "0.148912"),
    ),
    flat=(FlatCharge("other", "Daily charge", D("1.304348"), "day"),),
    loss_factor=LOSS,
)

FREE_WEEKENDS = Tariff(
    name="Free Weekends",
    bands=(
        _network_zero(),
        _band(ENERGY, "STANDARD", range(1, 6), 0, 24, "0.301961"),
        _band(ENERGY, "STANDARD", (6, 7), 0, 9, "0.301961"),
        _band(ENERGY, "FREE", (6, 7), 9, 17, "0"),
        _band(ENERGY, "STANDARD", (6, 7), 17, 24, "0.301961"),
    ),
    flat=(FlatCharge("other", "Daily charge", D("1.347826"), "day"),),
    export_bands=(
        _band(ENERGY, "STANDARD", range(1, 6), 0, 24, "0.069565"),
        _band(ENERGY, "STANDARD", (6, 7), 0, 9, "0.069565"),
        _band(ENERGY, "FREE", (6, 7), 9, 17, "0.069565"),
        _band(ENERGY, "STANDARD", (6, 7), 17, 24, "0.069565"),
    ),
    loss_factor=LOSS,
)


def _readings(day: dt.date, hours, kwh="1.0", *, exported=False):
    return [Reading(at=dt.datetime.combine(
                        day, dt.time(int(h), int(h % 1 * 60))),
                    kwh=D(kwh), exported=exported)
            for h in hours]


def _gross(value: Decimal, places="0.001") -> Decimal:
    return (value * GST).quantize(D(places))


def test_a_gap_is_rejected_rather_than_billed_at_zero():
    with pytest.raises(TariffError, match="prices nothing"):
        Tariff(name="gappy", bands=(
            _band(ENERGY, "MORNING", ALL_DAYS, 0, 12, "0.20"),
            _band(ENERGY, "EVENING", ALL_DAYS, 13, 24, "0.20"),
        ))


def test_an_overlap_is_rejected():
    with pytest.raises(TariffError, match="overlapping"):
        Tariff(name="doubled", bands=(
            _band(ENERGY, "A", ALL_DAYS, 0, 13, "0.20"),
            _band(ENERGY, "B", ALL_DAYS, 12, 24, "0.20"),
        ))


def test_a_weekday_only_band_must_still_cover_the_weekend():
    with pytest.raises(TariffError, match="weekday 6"):
        Tariff(name="weekdays only", bands=(
            _band(ENERGY, "STD", range(1, 6), 0, 24, "0.20"),
        ))


def test_anytime_recomposes_to_the_displayed_rate_and_daily_charge():
    monday = dt.date(2026, 9, 7)
    bill = cost_of(_readings(monday, [12]), ANYTIME, days=1)

    assert _gross(bill.by_group[ENERGY]) == D("0.325")
    assert _gross(bill.by_group["other"], "0.01") == D("1.45")
    assert bill.by_group[NETWORK] == 0


@pytest.mark.parametrize(("hour", "label", "displayed"), [
    (6.5, "NIGHT", D("0.180")),
    (7.0, "PEAK", D("0.390")),
    (11.0, "OFFPEAK", D("0.270")),
    (17.0, "PEAK", D("0.390")),
    (21.0, "OFFPEAK", D("0.270")),
    (23.0, "NIGHT", D("0.180")),
])
def test_time_of_use_boundaries_match_the_plan_page(hour, label, displayed):
    monday = dt.date(2026, 9, 7)
    bill = cost_of(_readings(monday, [hour]), TIME_OF_USE, days=0)

    assert _gross(bill.by_band[(ENERGY, label)]) == displayed


def test_free_weekends_means_zero_usage_charge_from_nine_to_five():
    saturday = dt.date(2026, 9, 12)
    inside = cost_of(_readings(saturday, [10]), FREE_WEEKENDS, days=0)
    outside = cost_of(_readings(saturday, [8]), FREE_WEEKENDS, days=0)

    assert inside.by_group[ENERGY] == 0
    assert inside.by_group[NETWORK] == 0
    assert _gross(outside.by_group[ENERGY]) == D("0.365")


def test_common_buy_back_is_eight_cents_and_does_not_change_plan_ranking():
    monday = dt.date(2026, 9, 7)
    credit = cost_of(
        _readings(monday, [12], exported=True), ANYTIME, days=0
    ).by_group[ENERGY]

    assert _gross(credit) == D("-0.080")


def test_each_charge_group_bands_the_same_reading_independently():
    tariff = Tariff(name="scoped", bands=(
        _band(ENERGY, "ALL", ALL_DAYS, 0, 24, "0.20"),
        _band(NETWORK, "DAY", ALL_DAYS, 7, 21, "0.10"),
        _band(NETWORK, "NIGHT", ALL_DAYS, 0, 7, "0.02"),
        _band(NETWORK, "NIGHT", ALL_DAYS, 21, 24, "0.02"),
    ))
    monday = dt.date(2026, 9, 7)
    bill = cost_of(_readings(monday, [8]), tariff, days=0)

    assert bill.by_band[(ENERGY, "ALL")] == D("0.20")
    assert bill.by_band[(NETWORK, "DAY")] == D("0.10")


def test_the_daily_charge_uses_period_days_not_days_with_readings():
    monday = dt.date(2026, 9, 7)
    bill = cost_of(_readings(monday, [12]), ANYTIME, days=31)

    assert bill.by_band[("other", "Daily charge")] == D("1.260870") * 31


def test_the_term_credit_is_negative_and_in_its_own_group():
    with_credit = Tariff(
        name="Anytime + 12mo",
        bands=ANYTIME.bands,
        flat=ANYTIME.flat,
        monthly_credit=D("21.739130"),
        loss_factor=LOSS,
    )
    monday = dt.date(2026, 9, 7)
    bill = cost_of(_readings(monday, [12]), with_credit, days=31)

    assert _gross(bill.by_group["credit"], "0.01") == D("-25.00")


def test_line_losses_uplift_import_energy_only():
    plain = Tariff(name="plain", bands=ANYTIME.bands, flat=ANYTIME.flat)
    monday = dt.date(2026, 9, 7)
    readings = _readings(monday, [3], kwh="10")

    plain_bill = cost_of(readings, plain, days=1)
    lossy_bill = cost_of(readings, ANYTIME, days=1)

    assert lossy_bill.by_group[ENERGY] == plain_bill.by_group[ENERGY] * D("1.0511")
    assert lossy_bill.by_group[NETWORK] == plain_bill.by_group[NETWORK]
    assert lossy_bill.by_group["other"] == plain_bill.by_group["other"]
    assert lossy_bill.kwh_by_band[(ENERGY, "ANYTIME")] == D("10")
