"""The plan comparison, and the four ways it could lie.

This is the one tool in the product whose output ends with somebody changing their
electricity plan, so the tests are weighted towards the wrong answers rather than the
right one: the household told to switch to the plan it is already on, the winter month
multiplied by twelve, the time-of-use plan priced from a monthly total, and the rounding
difference reported as a recommendation.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.analytics.account import DayUsage
from app.analytics.plans import (
    LOW_FIXED,
    MATERIAL_SAVING_NZD_PER_YEAR,
    MIN_DAYS_TO_COMPARE,
    STANDARD,
    TIME_OF_USE,
    annualise,
    break_even_kwh_per_day,
    compare,
    price,
)

ANCHOR = dt.date(2026, 7, 1)


def days(
    kwh: float,
    n: int = 31,
    *,
    hdd: float | None = None,
    peak_share: float | None = None,
    controlled: float = 0.0,
    export: float = 0.0,
    start: int = 0,
) -> list[DayUsage]:
    """A flat synthetic month. Flat on purpose — every test here is about the pricing,
    and a varying series would make the assertions about arithmetic into assertions
    about a fixture."""
    return [
        DayUsage(
            date=ANCHOR + dt.timedelta(days=start + i),
            import_kwh=kwh,
            controlled_kwh=controlled,
            export_kwh=export,
            heating_degree_days=hdd,
            peak_kwh=None if peak_share is None else kwh * peak_share,
            off_peak_kwh=None if peak_share is None else kwh * (1 - peak_share),
        )
        for i in range(n)
    ]


# ---------- the break-even, which is the whole trade-off ----------


def test_the_break_even_is_where_the_two_plans_actually_cross() -> None:
    """20 kWh/day, from (1.50 - 0.30) / (0.36 - 0.30).

    Asserted by pricing rather than by repeating the formula: a test that recomputes the
    arithmetic it is checking passes even when both are wrong the same way.
    """
    crossing = break_even_kwh_per_day(STANDARD, LOW_FIXED)
    assert crossing == pytest.approx(20.0)

    at_crossing = days(crossing, n=30)
    standard = price(STANDARD, at_crossing, has_solar=False)
    low_fixed = price(LOW_FIXED, at_crossing, has_solar=False)
    assert standard.total_nzd == pytest.approx(low_fixed.total_nzd, abs=0.01)


def test_each_plan_wins_on_its_own_side_of_the_line() -> None:
    small = compare(days(6.0), period="July 2026")
    large = compare(days(35.0), period="July 2026")

    assert small.best_code == LOW_FIXED.code
    assert large.best_code == STANDARD.code


def test_parallel_plans_have_no_break_even() -> None:
    """Two plans with the same unit rate never cross, and the cheaper one is simply
    cheaper at every level of use. Returning a very large number instead would put a
    threshold in front of the customer that nothing can reach."""
    twin = STANDARD.__class__(
        code="twin", name="Twin", daily_fixed_nzd=2.0, unit_rate_nzd=STANDARD.unit_rate_nzd
    )
    assert break_even_kwh_per_day(STANDARD, twin) is None


# ---------- the four ways it lies ----------


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


def test_a_time_of_use_plan_is_not_priced_from_a_monthly_total() -> None:
    """Without a peak/off-peak split there is no honest number, so there is no number.

    Pricing it at the headline rate would overstate it and at a blended rate would
    understate it, and both would arrive with the same confidence as a plan we can
    actually price.
    """
    assert price(TIME_OF_USE, days(20.0), has_solar=False) is None

    with_split = price(TIME_OF_USE, days(20.0, peak_share=0.3), has_solar=False)
    assert with_split is not None
    assert "peak" in with_split.priced_from

    result = compare(days(20.0), period="July 2026")
    assert TIME_OF_USE.code not in {c.plan.code for c in result.costs}
    assert any("time-of-use" in c for c in result.caveats)


def test_time_of_use_punishes_an_evening_household_and_rewards_a_shifted_one() -> None:
    """A catalogue where the interesting plan always wins makes the comparison
    decorative. The peak rate is deliberately above Standard's flat rate."""
    evening = price(TIME_OF_USE, days(20.0, peak_share=0.8), has_solar=False)
    shifted = price(TIME_OF_USE, days(20.0, peak_share=0.15), has_solar=False)
    flat = price(STANDARD, days(20.0), has_solar=False)

    assert evening.total_nzd > flat.total_nzd
    assert shifted.total_nzd < flat.total_nzd


def test_a_rounding_difference_is_not_a_recommendation() -> None:
    """Two plans within a few dollars a year are the same plan."""
    at_the_line = compare(
        days(20.0), period="July 2026", plan_name="Kea Standard", plan_code="standard"
    )
    assert at_the_line.material is False
    assert abs(at_the_line.saving_nzd_per_year) < MATERIAL_SAVING_NZD_PER_YEAR
    # And the caveat says so in words, because "$3.20" on its own reads as a saving.
    assert any("close enough" in c for c in at_the_line.caveats)


def test_an_unmatched_plan_yields_no_saving_at_all() -> None:
    """The most damaging wrong answer this feature can give is telling a household to
    switch to the plan it is already on. An earlier design defaulted to Standard when it
    could not tell, which did exactly that for every Low Fixed Charge customer."""
    result = compare(days(6.0), period="July 2026")  # no plan name or code

    assert result.current_plan_code is None
    assert result.saving_nzd_per_year == 0.0
    # Null, not false: the question has not been answered, not answered "no".
    assert result.material is None
    assert any("could not be matched" in c for c in result.caveats)


def test_the_regulated_category_is_used_when_the_name_is_not() -> None:
    """A `low_user` account is on a low-fixed-charge plan by definition, whatever the
    retailer has called it."""
    result = compare(days(6.0), period="July 2026", plan_user_type="low_user")
    assert result.current_plan_code == LOW_FIXED.code


# ---------- what the comparison must refuse ----------


def test_a_fortnight_is_the_floor() -> None:
    short = compare(days(20.0, n=MIN_DAYS_TO_COMPARE - 1), period="July 2026")
    assert short.available is False
    assert "at least" in short.reason

    just_enough = compare(days(20.0, n=MIN_DAYS_TO_COMPARE), period="July 2026")
    assert just_enough.available is True


def test_the_solar_plan_is_not_offered_to_a_house_without_panels() -> None:
    """Solar Plus charges a higher daily rate for a buy-back the household cannot earn.
    Offering it and letting the ranking sort it out is an upsell dressed as advice."""
    no_panels = compare(days(20.0), period="July 2026", has_solar=False)
    assert "solar" not in {c.plan.code for c in no_panels.costs}

    exporting = compare(
        days(20.0, export=6.0), period="July 2026", has_solar=True
    )
    assert "solar" in {c.plan.code for c in exporting.costs}

    # Connected, but exporting almost nothing: still not offered.
    token_export = compare(
        days(20.0, export=0.2), period="July 2026", has_solar=True
    )
    assert "solar" not in {c.plan.code for c in token_export.costs}
    assert any("exports too little" in c for c in token_export.caveats)


def test_the_controlled_circuit_is_not_charged_twice() -> None:
    """It is metered separately, so it must come out of the general total before that
    total is priced. Leaving it in inflates every plan that has a controlled rate, and
    does so unevenly because the plans do not share one."""
    with_controlled = price(STANDARD, days(20.0, controlled=8.0), has_solar=False)

    general = (20.0 - 8.0) * 31 * STANDARD.unit_rate_nzd
    controlled = 8.0 * 31 * STANDARD.controlled_rate_nzd
    fixed = 31 * STANDARD.daily_fixed_nzd

    assert with_controlled.total_nzd == pytest.approx(general + controlled + fixed, abs=0.01)
    # Cheaper than pricing the whole lot at the general rate, which is the bug.
    assert with_controlled.total_nzd < 20.0 * 31 * STANDARD.unit_rate_nzd + fixed


def test_the_decomposition_adds_back_up_to_the_total() -> None:
    """The decomposition IS the explanation — "your daily charges drop $37 but your units
    cost $52 more" — so it has to reconcile with the figure it explains."""
    cost = price(STANDARD, days(20.0, controlled=5.0, export=3.0), has_solar=True)
    assert cost.total_nzd == pytest.approx(
        cost.fixed_nzd + cost.energy_nzd + cost.controlled_nzd - cost.export_credit_nzd,
        abs=0.01,
    )


# ---------- the seasonal check ----------


def test_the_seasonal_check_needs_both_seasons() -> None:
    all_cold = compare(days(20.0, hdd=9.0), period="July 2026")
    assert all_cold.winter_cost == {}
    assert any("not enough cold days and mild days" in c for c in all_cold.caveats)

    mixed = days(6.0, n=16, hdd=9.0) + days(6.0, n=15, hdd=1.0, start=16)
    both = compare(mixed, period="July 2026")
    assert both.winter_cost and both.summer_cost
