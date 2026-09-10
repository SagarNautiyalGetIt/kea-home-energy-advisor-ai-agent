"""The plan comparison, and the ways it could lie.

This is the one tool in the product whose output ends with somebody changing their
electricity plan, so the tests are weighted towards the wrong answers rather than the
right one: the household told to switch to the plan it is already on, the winter month
multiplied by twelve, a banded plan priced from a monthly total, and the rounding
difference reported as a recommendation.

The catalogue is Kea's three published pricing styles at the rates on the plan page.
`test_the_catalogue_matches_the_published_plan_page` is the guard that keeps it there:
the same numbers are rendered by `services/web/src/data/mockData.ts`, and nothing in a
Python service can import a TypeScript bundle to check itself against it.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.analytics.account import DayUsage
from app.analytics.plans import (
    ANYTIME,
    CATALOGUE,
    FREE_WEEKENDS,
    MATERIAL_SAVING_NZD_PER_YEAR,
    MIN_DAYS_TO_COMPARE,
    TIME_OF_USE,
    annualise,
    break_even_kwh_per_day,
    compare,
    price,
)

ANCHOR = dt.date(2026, 7, 1)  # a Wednesday


def days(
    kwh: float,
    n: int = 31,
    *,
    hdd: float | None = None,
    peak_share: float | None = None,
    night_share: float = 0.25,
    controlled: float = 0.0,
    export: float = 0.0,
    start: int = 0,
) -> list[DayUsage]:
    """A flat synthetic month. Flat on purpose — every test here is about the pricing,
    and a varying series would make the assertions about arithmetic into assertions
    about a fixture.

    `peak_share` is None for a household with no band split at all, which is what a
    seeded `public.*` account looks like. When it is set, the remainder after peak and
    night is the true off-peak block: three bands, not two.
    """

    def day(i: int) -> DayUsage:
        date = ANCHOR + dt.timedelta(days=start + i)
        banded = peak_share is not None
        return DayUsage(
            date=date,
            import_kwh=kwh,
            controlled_kwh=controlled,
            export_kwh=export,
            heating_degree_days=hdd,
            peak_kwh=None if not banded else kwh * peak_share,
            night_kwh=None if not banded else kwh * night_share,
            off_peak_kwh=None if not banded else kwh * (1 - peak_share - night_share),
            is_weekend=date.weekday() >= 5,
        )

    return [day(i) for i in range(n)]


# ---------- the catalogue is the product's, not this module's ----------


def test_the_catalogue_matches_the_published_plan_page() -> None:
    """These figures are printed on the plans page the customer can open in the next
    tab, and recorded in docs/sprints/sprint-3/plans-and-terms.md.

    The assistant used to answer from a different, older catalogue — "Kea Standard",
    "Low Fixed Charge" — so somebody could ask which plans were available, be given two
    names with two prices, and then find three different ones in the app. Pinning the
    numbers here is the only thing standing between the two drifting again, because
    nothing in Python can import the TypeScript that renders them.
    """
    published = {
        "anytime": ("Anytime Rate", 1.45, 0.325),
        "time_of_use": ("Time of Use", 1.50, 0.390),
        "free_weekends": ("Free Weekends", 1.55, 0.365),
    }
    assert {p.code for p in CATALOGUE} == set(published)
    for plan in CATALOGUE:
        name, daily, unit = published[plan.code]
        assert plan.name == name
        assert plan.daily_fixed_nzd == pytest.approx(daily)
        assert plan.unit_rate_nzd == pytest.approx(unit)

    # The three Time of Use bands, which is the whole reason that plan exists.
    assert TIME_OF_USE.off_peak_rate_nzd == pytest.approx(0.270)
    assert TIME_OF_USE.night_rate_nzd == pytest.approx(0.180)
    # 9am to 5pm, Saturday and Sunday.
    assert FREE_WEEKENDS.free_weekend_window == (9, 17)


# ---------- the break-even, which is the whole trade-off ----------


def test_there_is_no_break_even_between_anytime_and_free_weekends() -> None:
    """Anytime is cheaper on BOTH the daily charge and the unit rate, so on flat pricing
    the two lines never cross and Free Weekends is worse at every level of use.

    Reporting a crossing here would be the damaging answer: it would tell somebody that
    above N units a day the dearer plan starts to pay off, when the only thing that ever
    makes it pay off is the free window — which is a fact about their weekend habits,
    not about how much they use.
    """
    assert break_even_kwh_per_day(ANYTIME, FREE_WEEKENDS) is None


def test_the_break_even_is_where_two_flat_plans_actually_cross() -> None:
    """Asserted by pricing rather than by repeating the formula: a test that recomputes
    the arithmetic it is checking passes even when both are wrong the same way.

    Uses a synthetic pair, because none of Kea's three published styles crosses another
    on flat pricing — see the test above.
    """
    cheap_units = ANYTIME.__class__(
        code="cheap_units", name="Cheap units", daily_fixed_nzd=2.50, unit_rate_nzd=0.20
    )
    # (2.50 - 1.45) / (0.325 - 0.20) = 8.4 kWh/day
    crossing = break_even_kwh_per_day(cheap_units, ANYTIME)
    assert crossing == pytest.approx(8.4)

    at_crossing = days(crossing, n=30)
    a = price(cheap_units, at_crossing, has_solar=False)
    b = price(ANYTIME, at_crossing, has_solar=False)
    assert a.total_nzd == pytest.approx(b.total_nzd, abs=0.01)


def test_free_weekends_only_wins_by_actually_using_the_window() -> None:
    """It is the dearest plan on both the daily charge and the unit rate, so above a
    couple of kWh a day it can only come out ahead through the free hours. A household
    that is out all weekend pays more for nothing — which is the honest answer, and the
    one an upsell would not give."""
    month = days(20.0, peak_share=0.3)
    anytime = price(ANYTIME, month, has_solar=False)

    away = price(FREE_WEEKENDS, month, has_solar=False, weekend_free_share=0.05)
    home = price(FREE_WEEKENDS, month, has_solar=False, weekend_free_share=0.9)

    assert away.total_nzd > anytime.total_nzd
    assert home.total_nzd < anytime.total_nzd


def test_parallel_plans_have_no_break_even() -> None:
    """Two plans with the same unit rate never cross, and the cheaper one is simply
    cheaper at every level of use. Returning a very large number instead would put a
    threshold in front of the customer that nothing can reach."""
    twin = ANYTIME.__class__(
        code="twin", name="Twin", daily_fixed_nzd=2.0, unit_rate_nzd=ANYTIME.unit_rate_nzd
    )
    assert break_even_kwh_per_day(ANYTIME, twin) is None


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


def test_a_banded_plan_is_not_priced_from_a_monthly_total() -> None:
    """Without a band split there is no honest number, so there is no number.

    Pricing it at the headline rate would overstate it and at a blended rate would
    understate it, and both would arrive with the same confidence as a plan we can
    actually price.
    """
    assert price(TIME_OF_USE, days(20.0), has_solar=False) is None

    with_split = price(TIME_OF_USE, days(20.0, peak_share=0.3), has_solar=False)
    assert with_split is not None
    assert "night" in with_split.priced_from

    result = compare(days(20.0), period="July 2026")
    assert TIME_OF_USE.code not in {c.plan.code for c in result.costs}
    assert any("Time of Use could not be priced" in c for c in result.caveats)


def test_free_weekends_is_declined_without_an_hourly_shape() -> None:
    """A weekend daily total says nothing about the hours it fell in, and two households
    with identical Saturdays pay very differently depending on whether the washing
    machine ran at 10am or 10pm. No shape, no price, and a caveat that says so rather
    than one implying the plan would be worse."""
    assert price(FREE_WEEKENDS, days(20.0), has_solar=False) is None

    result = compare(days(20.0, peak_share=0.3), period="July 2026")
    assert FREE_WEEKENDS.code not in {c.plan.code for c in result.costs}
    assert any("Free Weekends could not be priced" in c for c in result.caveats)


def test_night_usage_is_not_charged_at_the_off_peak_rate() -> None:
    """The night rate is less than half the peak one and 9c under off-peak. Folding the
    23:00-07:00 block into off-peak — which is what happened while the mart's misnamed
    column was read as off-peak — overstates the plan on every one of those units and
    biases the recommendation against the households it actually suits.
    """
    month = days(20.0, peak_share=0.3, night_share=0.4)
    priced = price(TIME_OF_USE, month, has_solar=False)

    total = 20.0 * 31
    fixed = 31 * TIME_OF_USE.daily_fixed_nzd
    expected = (
        total * 0.3 * TIME_OF_USE.unit_rate_nzd
        + total * 0.3 * TIME_OF_USE.off_peak_rate_nzd
        + total * 0.4 * TIME_OF_USE.night_rate_nzd
    )
    assert priced.energy_nzd == pytest.approx(expected, abs=0.01)
    assert priced.total_nzd == pytest.approx(expected + fixed, abs=0.01)

    # The bug this replaces: charging that night block at the off-peak rate costs more.
    at_off_peak_instead = (
        total * 0.3 * TIME_OF_USE.unit_rate_nzd
        + total * 0.7 * TIME_OF_USE.off_peak_rate_nzd
    )
    assert priced.energy_nzd < at_off_peak_instead


def test_time_of_use_punishes_an_evening_household_and_rewards_a_shifted_one() -> None:
    """A catalogue where the interesting plan always wins makes the comparison
    decorative. The peak rate is deliberately above the Anytime rate."""
    evening = price(
        TIME_OF_USE, days(20.0, peak_share=0.8, night_share=0.1), has_solar=False
    )
    shifted = price(
        TIME_OF_USE, days(20.0, peak_share=0.05, night_share=0.6), has_solar=False
    )
    flat = price(ANYTIME, days(20.0), has_solar=False)

    assert evening.total_nzd > flat.total_nzd
    assert shifted.total_nzd < flat.total_nzd


def test_a_rounding_difference_is_not_a_recommendation() -> None:
    """Two plans within a few dollars a year are the same plan.

    An evening-heavy household, so Time of Use is genuinely dearer for them, and a free
    window share tuned so Free Weekends lands within a dollar a year of the plan they
    are already on. Real arithmetic, and meaningless advice: telling somebody to change
    plan, sign a term and risk an exit fee to save $8 a year is worse than saying
    nothing.
    """
    at_the_line = compare(
        days(20.0, peak_share=0.8, night_share=0.1),
        period="July 2026",
        plan_name="Anytime Rate",
        plan_code="anytime",
        weekend_free_share=0.49,
    )
    # `material` is the flag the tool surfaces and the model is told to respect. There is
    # deliberately no "close enough to the break-even" caveat here: none of Kea's three
    # published styles crosses another on flat pricing, so that caveat cannot fire for
    # them, and asserting it would be asserting a message the customer will never see.
    assert at_the_line.material is False
    assert 0 < at_the_line.saving_nzd_per_year < MATERIAL_SAVING_NZD_PER_YEAR


def test_an_unmatched_plan_yields_no_saving_at_all() -> None:
    """The most damaging wrong answer this feature can give is telling a household to
    switch to the plan it is already on."""
    result = compare(days(6.0), period="July 2026")  # no plan name or code

    assert result.current_plan_code is None
    assert result.saving_nzd_per_year == 0.0
    # Null, not false: the question has not been answered, not answered "no".
    assert result.material is None
    assert any("could not be matched" in c for c in result.caveats)


def test_the_regulated_category_is_not_guessed_into_a_pricing_style() -> None:
    """`low_user` describes a cap on the daily charge, not which of the three styles the
    customer chose. This used to resolve to a "Low Fixed Charge" plan, which is not a
    plan Kea offers — so an account was told it was on something it could not find."""
    result = compare(days(6.0), period="July 2026", plan_user_type="low_user")
    assert result.current_plan_code is None


def test_the_platform_plan_names_resolve_to_a_real_style() -> None:
    """The loaded accounts carry Sprint 2 names — "Demo Standard Fixed TOU" — and those
    accounts really are time-of-use (`mart_account_context.is_tou` is true for them), so
    that is what they match. "Standard" and "Fixed" in the name describe the daily
    charge, and matching on either of those first would put a time-of-use household on
    the flat plan and then price its evenings wrongly.
    """
    tou = compare(
        days(20.0, peak_share=0.3),
        period="July 2026",
        plan_name="Demo Standard Fixed TOU",
        plan_code="DEMO_STD_FXTOU_FULL_HOUSE",
    )
    assert tou.current_plan_code == TIME_OF_USE.code

    # A flat name with no band wording still lands on Anytime.
    flat = compare(
        days(20.0, peak_share=0.3),
        period="July 2026",
        plan_name="Anytime Rate",
        plan_code="anytime",
    )
    assert flat.current_plan_code == ANYTIME.code


# ---------- what the comparison must refuse ----------


def test_a_fortnight_is_the_floor() -> None:
    short = compare(days(20.0, n=MIN_DAYS_TO_COMPARE - 1), period="July 2026")
    assert short.available is False
    assert "at least" in short.reason

    just_enough = compare(days(20.0, n=MIN_DAYS_TO_COMPARE), period="July 2026")
    assert just_enough.available is True


def test_the_controlled_circuit_is_not_charged_twice() -> None:
    """It is metered separately, so it must come out of the general total before that
    total is priced. Leaving it in inflates every plan that has a controlled rate, and
    does so unevenly because the plans do not share one."""
    with_controlled = price(ANYTIME, days(20.0, controlled=8.0), has_solar=False)

    general = (20.0 - 8.0) * 31 * ANYTIME.unit_rate_nzd
    controlled = 8.0 * 31 * ANYTIME.controlled_rate_nzd
    fixed = 31 * ANYTIME.daily_fixed_nzd

    assert with_controlled.total_nzd == pytest.approx(general + controlled + fixed, abs=0.01)
    # Cheaper than pricing the whole lot at the general rate, which is the bug.
    assert with_controlled.total_nzd < 20.0 * 31 * ANYTIME.unit_rate_nzd + fixed


def test_the_decomposition_adds_back_up_to_the_total() -> None:
    """The decomposition IS the explanation — "your daily charges drop $37 but your units
    cost $52 more" — so it has to reconcile with the figure it explains."""
    cost = price(ANYTIME, days(20.0, controlled=5.0, export=3.0), has_solar=True)
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
