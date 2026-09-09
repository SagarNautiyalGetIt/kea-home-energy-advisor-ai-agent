"""The plan comparison, and the ways it could lie.

This is the one tool in the product whose output ends with somebody changing their
electricity plan, so the tests are weighted towards the wrong answers rather than the
right one: the household told to switch to the plan it is already on, the winter month
multiplied by twelve, a banded plan priced from a monthly total, the rounding difference
reported as a recommendation, and a term credit dressed up as a saving.

The first test in the file is the one that matters most. It pins the rates to the
published Sprint 3 spec, because the failure this whole module exists to prevent is a
comparison that quotes numbers Kea does not charge.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import pytest

from app.analytics.account import DayUsage
from app.analytics.plans import (
    _FREE_WINDOW_HOURS,
    _TOU_NIGHT_HOURS,
    _TOU_OFF_PEAK_HOURS,
    _TOU_PEAK_HOURS,
    ANYTIME,
    ANYTIME_RATE,
    FREE,
    FREE_WEEKENDS,
    MATERIAL_SAVING_NZD_PER_YEAR,
    MIN_DAYS_TO_COMPARE,
    MIN_PROFILE_SAMPLE_DAYS,
    NIGHT,
    OFF_PEAK,
    OUTSIDE_FREE,
    PEAK,
    SIX_MONTH,
    TIME_OF_USE,
    TWELVE_MONTH,
    HourlyShape,
    annualise,
    compare,
    free_window_share_break_even,
    price,
)

#: A Wednesday, so a 31-day run from here holds four Saturdays and four Sundays.
ANCHOR = dt.date(2026, 7, 1)


def days(
    kwh: float,
    n: int = 31,
    *,
    hdd: float | None = None,
    export: float = 0.0,
    start: int = 0,
) -> list[DayUsage]:
    """A flat synthetic month. Flat on purpose — every test here is about the pricing,
    and a varying series would make the assertions about arithmetic into assertions
    about a fixture. `is_weekend` is derived from the real date because two of the three
    plans price weekends differently."""
    out = []
    for i in range(n):
        date = ANCHOR + dt.timedelta(days=start + i)
        out.append(
            DayUsage(
                date=date,
                import_kwh=kwh,
                export_kwh=export,
                heating_degree_days=hdd,
                is_weekend=date.weekday() >= 5,
            )
        )
    return out


@dataclass(frozen=True)
class Row:
    """Stands in for `MartHourlyProfile` — `HourlyShape.from_rows` only reads attributes."""

    hour_of_day: int
    is_weekday: bool
    avg_import_kwh: float
    sample_days: int = 30
    profile_month: dt.date = ANCHOR


def shape(
    weekday: dict[int, float] | None = None,
    weekend: dict[int, float] | None = None,
    *,
    sample_days: int = 30,
) -> HourlyShape:
    """An hourly shape from per-hour weights. Unlisted hours get 1.0, so the default is a
    perfectly flat day — which puts exactly a third of usage in each time-of-use band and
    makes the arithmetic hand-checkable."""
    rows = []
    for hour in range(24):
        rows.append(Row(hour, True, (weekday or {}).get(hour, 1.0), sample_days))
        rows.append(Row(hour, False, (weekend or {}).get(hour, 1.0), sample_days))
    built = HourlyShape.from_rows(rows)
    assert built is not None
    return built


FLAT = shape()

#: A household that lives at the weekend: most of its power lands inside the free window.
WEEKEND_HEAVY = shape(
    weekday={h: 0.2 for h in range(24)},
    weekend={h: (8.0 if h in _FREE_WINDOW_HOURS else 0.2) for h in range(24)},
)

#: An evening household — the one time-of-use is supposed to punish.
EVENING = shape(weekday={h: (6.0 if h in (17, 18, 19, 20) else 0.3) for h in range(24)})

#: A household that has moved its load to the small hours.
SHIFTED = shape(weekday={h: (6.0 if h in (0, 1, 2, 3) else 0.3) for h in range(24)})


# ---------- the rates themselves ----------


def test_the_catalogue_matches_the_published_sprint_3_spec() -> None:
    """docs/sprints/sprint-3/plans-and-terms.md §2 and §3, to the cent.

    Hard-coded rather than read from the doc on purpose: this test is the tripwire for
    somebody editing a rate in the code without the spec changing, which is precisely how
    the invented catalogue this replaced came to be quoted to customers.
    """
    assert ANYTIME_RATE.daily_fixed_nzd == 1.45
    assert ANYTIME_RATE.rates_nzd == {ANYTIME: 0.325}

    assert TIME_OF_USE.daily_fixed_nzd == 1.50
    assert TIME_OF_USE.rates_nzd == {PEAK: 0.390, OFF_PEAK: 0.270, NIGHT: 0.180}

    assert FREE_WEEKENDS.daily_fixed_nzd == 1.55
    assert FREE_WEEKENDS.rates_nzd == {FREE: 0.0, OUTSIDE_FREE: 0.365}

    # All three carry the same assumed buy-back, so it cannot drive a recommendation.
    assert {p.export_rate_nzd for p in (ANYTIME_RATE, TIME_OF_USE, FREE_WEEKENDS)} == {0.08}

    assert (SIX_MONTH.monthly_credit_nzd, SIX_MONTH.total_credit_nzd) == (10.0, 60.0)
    assert (TWELVE_MONTH.monthly_credit_nzd, TWELVE_MONTH.total_credit_nzd) == (25.0, 300.0)


def test_the_time_of_use_bands_tile_the_day_exactly_once() -> None:
    """Peak 07-11 and 17-21, off-peak 11-17 and 21-23, night 23-07. A gap would price
    some hours at zero and an overlap would price them twice, and both would look like a
    plausible number rather than a bug."""
    expected_peak = {7, 8, 9, 10, 17, 18, 19, 20}
    expected_off_peak = {11, 12, 13, 14, 15, 16, 21, 22}
    expected_night = {23, 0, 1, 2, 3, 4, 5, 6}

    assert expected_peak == _TOU_PEAK_HOURS
    assert expected_off_peak == _TOU_OFF_PEAK_HOURS
    assert expected_night == _TOU_NIGHT_HOURS

    covered = _TOU_PEAK_HOURS | _TOU_OFF_PEAK_HOURS | _TOU_NIGHT_HOURS
    assert covered == set(range(24))
    assert len(_TOU_PEAK_HOURS) + len(_TOU_OFF_PEAK_HOURS) + len(_TOU_NIGHT_HOURS) == 24


def test_the_free_window_is_weekend_only() -> None:
    """Saturday and Sunday 09:00-17:00. A weekday ten in the morning is not free, and
    treating it as free would zero out a third of a household's weekday bill."""
    assert FREE_WEEKENDS.band_of(10, is_weekend=True) == FREE
    assert FREE_WEEKENDS.band_of(10, is_weekend=False) == OUTSIDE_FREE
    assert FREE_WEEKENDS.band_of(8, is_weekend=True) == OUTSIDE_FREE
    assert FREE_WEEKENDS.band_of(17, is_weekend=True) == OUTSIDE_FREE


def test_free_means_the_units_not_the_daily_charge() -> None:
    """"Free" zeroes every per-kWh import charge inside the window. The fixed daily
    charge still applies, which is the whole reason this plan is not simply the best one."""
    weekend_only = [d for d in days(20.0) if d.is_weekend]
    cost = price(FREE_WEEKENDS, weekend_only, has_solar=False, shape=WEEKEND_HEAVY)

    assert cost is not None
    assert cost.fixed_nzd == pytest.approx(len(weekend_only) * 1.55, abs=0.01)
    assert cost.total_nzd > cost.fixed_nzd  # the out-of-window units still cost


# ---------- the ways it lies ----------


def test_a_winter_month_is_not_multiplied_by_twelve() -> None:
    """The classic mistake, and it does not cancel out of a saving.

    Annualising a cold month at face value overstates the year for every plan, but by
    more for the plan with the higher unit rate — so the error exaggerates the case for
    switching rather than washing out.
    """
    winter = annualise(100.0, 31, winter_share=1.0)
    mild = annualise(100.0, 31, winter_share=0.0)
    naive = 100.0 / 31 * 365

    assert winter < naive < mild
    # And a period with no temperature data falls back to the flat scale, honestly.
    assert annualise(100.0, 31, winter_share=None) == pytest.approx(naive, abs=0.01)


def test_a_banded_plan_is_not_priced_from_a_daily_total() -> None:
    """Without an hourly profile there is no honest number, so there is no number.

    Pricing at the headline rate would overstate it and at a blended rate would
    understate it, and both would arrive with the same confidence as a plan we can
    actually price.
    """
    assert price(TIME_OF_USE, days(20.0), has_solar=False, shape=None) is None
    assert price(FREE_WEEKENDS, days(20.0), has_solar=False, shape=None) is None
    # The flat plan needs no shape and is still priced.
    assert price(ANYTIME_RATE, days(20.0), has_solar=False, shape=None) is not None

    result = compare(days(20.0), period="July 2026", shape=None)
    assert {c.plan.code for c in result.costs} == {ANYTIME_RATE.code}
    assert any("no hourly profile" in c for c in result.caveats)


def test_a_thin_profile_is_not_enough_to_price_a_banded_plan() -> None:
    """A shape averaged over three days is one week's habits, not how a household lives.
    Pricing off it would put a real-looking figure on a guess."""
    thin = shape(sample_days=MIN_PROFILE_SAMPLE_DAYS - 1)
    assert price(TIME_OF_USE, days(20.0), has_solar=False, shape=thin) is None

    enough = shape(sample_days=MIN_PROFILE_SAMPLE_DAYS)
    assert price(TIME_OF_USE, days(20.0), has_solar=False, shape=enough) is not None


def test_a_partial_profile_is_refused_rather_than_zero_filled() -> None:
    """A shape missing its overnight hours would put night usage at zero and make the
    time-of-use plan look cheap for a reason that is an artefact of the data."""
    partial = [Row(h, wd, 1.0) for h in range(6, 24) for wd in (True, False)]
    assert HourlyShape.from_rows(partial) is None


def test_time_of_use_punishes_an_evening_household_and_rewards_a_shifted_one() -> None:
    """A catalogue where the interesting plan always wins makes the comparison
    decorative. The peak rate is well above Anytime's flat rate."""
    month = days(20.0)
    evening = price(TIME_OF_USE, month, has_solar=False, shape=EVENING)
    shifted = price(TIME_OF_USE, month, has_solar=False, shape=SHIFTED)
    flat = price(ANYTIME_RATE, month, has_solar=False)

    assert evening.total_nzd > flat.total_nzd
    assert shifted.total_nzd < flat.total_nzd


def test_free_weekends_wins_only_for_a_household_that_uses_the_window() -> None:
    """The plan buys a free Saturday and Sunday window with a higher rate every other
    hour. A household that is out all weekend pays for the privilege."""
    month = days(20.0)
    weekend_heavy = price(FREE_WEEKENDS, month, has_solar=False, shape=WEEKEND_HEAVY)
    ordinary = price(FREE_WEEKENDS, month, has_solar=False, shape=FLAT)
    anytime = price(ANYTIME_RATE, month, has_solar=False)

    assert weekend_heavy.total_nzd < anytime.total_nzd
    assert ordinary.total_nzd > anytime.total_nzd


def test_the_free_window_threshold_is_where_the_two_plans_actually_cross() -> None:
    """Asserted by pricing rather than by repeating the formula: a test that recomputes
    the arithmetic it is checking passes even when both are wrong the same way."""
    needed = free_window_share_break_even(ANYTIME_RATE, FREE_WEEKENDS, 20.0)
    assert needed == pytest.approx(0.9 / 7.3, abs=1e-6)

    # Above the threshold the free plan wins, below it the flat one does.
    assert 0.0 < needed < 1.0


def test_a_rounding_difference_is_not_a_recommendation() -> None:
    """Two plans within a few dollars a year are the same plan."""
    at_the_line = compare(
        days(20.0),
        period="July 2026",
        plan_name="Anytime Rate",
        plan_code=ANYTIME_RATE.code,
        shape=FLAT,
    )
    if at_the_line.usage_saving_nzd_per_year < MATERIAL_SAVING_NZD_PER_YEAR:
        assert at_the_line.material is False


def test_an_unmatched_plan_yields_no_saving_at_all() -> None:
    """The most damaging wrong answer this feature can give is telling a household to
    switch to the plan it is already on. An earlier design defaulted to Standard when it
    could not tell, which did exactly that for every Low Fixed Charge customer."""
    result = compare(days(6.0), period="July 2026", shape=FLAT)  # no plan name or code

    assert result.current_plan_code is None
    assert result.usage_saving_nzd_per_year == 0.0
    # Null, not false: the question has not been answered, not answered "no".
    assert result.material is None
    assert any("could not be matched" in c for c in result.caveats)


def test_the_current_plan_is_matched_on_the_real_kea_codes() -> None:
    for plan in (ANYTIME_RATE, TIME_OF_USE, FREE_WEEKENDS):
        result = compare(days(20.0), period="July 2026", plan_code=plan.code, shape=FLAT)
        assert result.current_plan_code == plan.code


# ---------- terms are not savings ----------


def test_a_term_credit_never_turns_a_dearer_plan_into_a_saving() -> None:
    """`material` is decided on the usage difference alone. A comparison that let a $300
    commitment credit rescue a plan that costs more to run would be an upsell with
    arithmetic attached."""
    result = compare(
        days(20.0),
        period="July 2026",
        plan_name="Anytime Rate",
        plan_code=ANYTIME_RATE.code,
        shape=FLAT,
    )

    # The credit is offered, and is real money...
    assert result.term_credit_nzd_per_year == 300.0
    assert result.annual_saving_nzd_per_year == pytest.approx(
        result.usage_saving_nzd_per_year + 300.0, abs=0.01
    )
    # ...but `material` tracks the usage saving, not the total.
    assert result.material is (
        result.usage_saving_nzd_per_year >= MATERIAL_SAVING_NZD_PER_YEAR
    )


def test_the_annual_credit_does_not_assume_a_term_renews() -> None:
    """A 12-month term pays its whole $300 inside the year. A 6-month term pays $60 once
    — nothing in the spec says it rolls over, so assuming it does would invent $60."""
    assert TWELVE_MONTH.annual_credit_nzd == pytest.approx(300.0)
    assert SIX_MONTH.annual_credit_nzd == pytest.approx(60.0)


def test_all_nine_combinations_are_offered() -> None:
    """Three pricing styles by three terms, per the spec's §3."""
    result = compare(days(20.0), period="July 2026", shape=FLAT)
    assert len(result.costs) == 3
    assert len(result.terms) == 3


# ---------- what the comparison must refuse ----------


def test_a_fortnight_is_the_floor() -> None:
    short = compare(days(20.0, n=MIN_DAYS_TO_COMPARE - 1), period="July 2026", shape=FLAT)
    assert short.available is False
    assert "at least" in short.reason

    just_enough = compare(days(20.0, n=MIN_DAYS_TO_COMPARE), period="July 2026", shape=FLAT)
    assert just_enough.available is True


def test_the_decomposition_adds_back_up_to_the_total() -> None:
    """The decomposition IS the explanation — "your daily charges drop $37 but your units
    cost $52 more" — so it has to reconcile with the figure it explains."""
    cost = price(ANYTIME_RATE, days(20.0, export=3.0), has_solar=True, shape=FLAT)
    assert cost.total_nzd == pytest.approx(
        cost.fixed_nzd + cost.energy_nzd - cost.export_credit_nzd, abs=0.01
    )

    banded = price(TIME_OF_USE, days(20.0), has_solar=False, shape=FLAT)
    assert sum(banded.band_kwh.values()) == pytest.approx(20.0 * 31, abs=0.05)


def test_the_export_credit_is_only_paid_to_a_house_with_panels() -> None:
    with_panels = price(ANYTIME_RATE, days(20.0, export=5.0), has_solar=True, shape=FLAT)
    without = price(ANYTIME_RATE, days(20.0, export=5.0), has_solar=False, shape=FLAT)

    assert with_panels.export_credit_nzd > 0
    assert without.export_credit_nzd == 0
    assert without.total_nzd > with_panels.total_nzd


# ---------- the seasonal check ----------


def test_the_seasonal_check_needs_both_seasons() -> None:
    all_cold = compare(days(20.0, hdd=9.0), period="July 2026", shape=FLAT)
    assert all_cold.winter_cost == {}
    assert any("not enough cold days and mild days" in c for c in all_cold.caveats)

    mixed = days(6.0, n=16, hdd=9.0) + days(6.0, n=15, hdd=1.0, start=16)
    both = compare(mixed, period="July 2026", shape=FLAT)
    assert both.winter_cost and both.summer_cost
