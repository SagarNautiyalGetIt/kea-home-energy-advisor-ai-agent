"""The bill-shock assessment — forecast, expectation, attribution, trigger.

These run with no model, no database and no network. That is the point of layer 1 being
pure: the figures the product is judged on are checkable in milliseconds.

The cases below are chosen to pin the four properties the redesign exists to provide,
each of which the previous straight-line detector got wrong:

* a cold cycle is not read as overspending
* the projection carries an interval, and the interval narrows as the cycle runs
* the trigger is a probability against the *customer's own* threshold
* the overshoot decomposes into causes that sum to it
"""

from __future__ import annotations

import math

import pytest

from app.alerts.preferences import AlertPreferences, defaults_for
from app.analytics import fixtures
from app.analytics.billshock import assess, build_bill_shock
from app.analytics.engine import UsageWindow
from app.analytics.forecast import (
    ExpectationBasis,
    ForecastMethod,
    choose_expectation,
    day_of_week_adjustment,
    fit_weather_response,
    forecast_cycle,
)

DAYS_IN_JULY = 31


def window(customer_id: str, days: int | None = None) -> UsageWindow:
    full = fixtures.get_window(customer_id)
    if days is None:
        return full
    return UsageWindow(
        customer_id=full.customer_id,
        period=full.period,
        daily_kwh=full.daily_kwh[:days],
        unit_price_nzd=full.unit_price_nzd,
    )


def assessment(customer_id: str, days: int | None = None, prefs: AlertPreferences | None = None):
    w = window(customer_id, days)
    hdd, normal = fixtures.heating_degree_days(customer_id)
    return assess(
        w,
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=hdd[: len(w.daily_kwh)],
        normal_hdd_per_day=normal,
        comparable_home_kwh_per_day=fixtures.comparison_baseline(customer_id),
        preferences=prefs or defaults_for(customer_id),
    )


# ───────────────────────── the weather regression ─────────────────────────


def test_fit_recovers_a_known_base_load_and_slope():
    """Synthetic data with no noise must return the coefficients it was built from.

    Written by hand rather than against a fixture because a regression that is subtly
    wrong still produces plausible output, and the only way to catch that is to know the
    answer in advance.
    """
    hdd = [float(h) for h in range(2, 18)]
    kwh = [6.0 + 0.5 * h for h in hdd]

    fit = fit_weather_response(kwh, hdd)

    assert fit.usable
    assert fit.base_load_kwh_per_day == pytest.approx(6.0, abs=1e-6)
    assert fit.heating_kwh_per_hdd == pytest.approx(0.5, abs=1e-6)
    assert fit.r_squared == pytest.approx(1.0, abs=1e-6)
    assert fit.residual_sd_kwh == pytest.approx(0.0, abs=1e-6)


def test_fit_refuses_when_the_weather_did_not_move():
    """No HDD variation means the slope is unidentifiable.

    OLS does not know that. It returns a large slope with a tiny denominator and no
    complaint, which then extrapolates catastrophically onto the remaining days.
    """
    fit = fit_weather_response([9.0, 11.0, 10.0, 12.0, 9.5, 10.5, 11.5, 10.0], [7.0] * 8)

    assert not fit.usable
    assert "varied" in (fit.unusable_because or "")


def test_fit_refuses_a_negative_heating_slope():
    """Colder weather associated with less electricity is a house with no electric
    heating, or a data problem. Projecting it forecasts the bill *down* as winter
    deepens."""
    hdd = [float(h) for h in range(2, 14)]
    kwh = [20.0 - 0.4 * h for h in hdd]

    fit = fit_weather_response(kwh, hdd)

    assert not fit.usable
    assert "negative" in (fit.unusable_because or "")


def test_fit_refuses_too_few_days():
    fit = fit_weather_response([10.0] * 5, [5.0, 8.0, 12.0, 6.0, 9.0])
    assert not fit.usable
    assert "days elapsed" in (fit.unusable_because or "")


def test_unusable_fit_still_carries_a_spread():
    """The fallback path needs an uncertainty to build an interval from. Returning None
    would push a branch into every caller and leave the straight line with no error bar."""
    fit = fit_weather_response([8.0, 12.0, 10.0, 14.0], [6.0] * 4)
    assert not fit.usable
    assert fit.residual_sd_kwh > 0


# ───────────────────────── the forecast ─────────────────────────


def test_remaining_days_are_projected_at_seasonal_normal_not_at_the_cold_snap():
    """The single most important line in the module.

    H-COLD read on day 8 is mid-southerly. A straight-line projection assumes the
    southerly lasts the month; this one assumes the weather returns to normal, which is
    the defensible assumption when no forecast is available. The weather-normalised
    projection must therefore be the *lower* of the two.
    """
    w = window("H-COLD", 8)
    hdd, normal = fixtures.heating_degree_days("H-COLD")

    f = forecast_cycle(
        w, days_in_cycle=DAYS_IN_JULY, daily_hdd=hdd[:8], normal_hdd_per_day=normal
    )
    straight_line = w.mean_kwh * DAYS_IN_JULY * w.unit_price_nzd

    assert f.method is ForecastMethod.WEATHER_NORMALISED
    assert f.projected_cost_nzd < straight_line


def test_the_interval_narrows_as_the_cycle_runs():
    """This is what replaces the EARLY_CYCLE_DAYS constant.

    The old code hedged in prose about a warning it had already decided to send. Here the
    uncertainty is in the number, so the decision can use it.

    Asserted end-to-end rather than step-by-step, deliberately. The width is not
    monotonic day by day and should not be: it is driven by observed variance, so a
    genuinely unusual day *widens* the interval, which is the correct response to new
    evidence that the household is less predictable than it looked. What must hold is
    that a nearly-complete cycle is far more certain than a barely-started one.
    """
    hdd, normal = fixtures.heating_degree_days("H-JUL")
    widths = {}
    for day in (9, 15, 22, 29):
        f = forecast_cycle(
            window("H-JUL", day),
            days_in_cycle=DAYS_IN_JULY,
            daily_hdd=hdd[:day],
            normal_hdd_per_day=normal,
        )
        widths[day] = f.confidence_width_pct

    assert widths[29] < widths[22] < widths[15], widths
    assert widths[29] < widths[9] / 2, widths


def test_the_interval_brackets_the_point_estimate():
    f = forecast_cycle(
        window("H-JUL", 14),
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=fixtures.heating_degree_days("H-JUL")[0][:14],
        normal_hdd_per_day=fixtures.heating_degree_days("H-JUL")[1],
    )
    assert f.cost_p10_nzd <= f.projected_cost_nzd <= f.cost_p90_nzd


def test_a_complete_cycle_has_no_uncertainty_left():
    """Nothing remains to forecast on day 31, so the interval must collapse. A residual
    band on a finished cycle would be an error bar on measured data."""
    hdd, normal = fixtures.heating_degree_days("H-JUL")
    f = forecast_cycle(
        window("H-JUL"), days_in_cycle=DAYS_IN_JULY, daily_hdd=hdd, normal_hdd_per_day=normal
    )
    assert f.days_remaining == 0
    assert f.cost_sd_nzd == pytest.approx(0.0, abs=1e-9)
    assert f.projected_cost_nzd == pytest.approx(f.cost_so_far_nzd, abs=0.01)


def test_probability_above_is_a_real_distribution():
    f = forecast_cycle(
        window("H-JUL", 12),
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=fixtures.heating_degree_days("H-JUL")[0][:12],
        normal_hdd_per_day=fixtures.heating_degree_days("H-JUL")[1],
    )
    assert f.probability_above(f.projected_cost_nzd) == pytest.approx(0.5, abs=0.01)
    assert f.probability_above(f.cost_p90_nzd) == pytest.approx(0.10, abs=0.01)
    assert f.probability_above(0.0) > 0.99


def test_readings_longer_than_the_cycle_are_rejected():
    with pytest.raises(ValueError):
        forecast_cycle(
            window("H-JUL"), days_in_cycle=10, daily_hdd=[5.0] * 31, normal_hdd_per_day=5.0
        )


def test_day_of_week_correction_is_inert_without_a_start_date():
    """Not a stub. Guessing the start date from a period phrase would apply a real
    adjustment off a guessed calendar."""
    mix = day_of_week_adjustment([10.0] * 14, None, DAYS_IN_JULY)
    assert not mix.applied
    assert mix.adjustment == 1.0


# ───────────────────────── the expectation anchor ─────────────────────────


def test_own_history_beats_the_neighbourhood():
    """Bill shock is a violated *personal* expectation. A household that has always run
    hot is not surprised by another hot month."""
    own = choose_expectation(
        days_in_cycle=31,
        unit_price_nzd=0.30,
        comparable_home_kwh_per_day=7.0,
        same_period_last_year_nzd=240.0,
    )
    assert own.basis is ExpectationBasis.OWN_SAME_PERIOD_LAST_YEAR
    assert own.cost_nzd == 240.0

    recent = choose_expectation(
        days_in_cycle=31,
        unit_price_nzd=0.30,
        comparable_home_kwh_per_day=7.0,
        recent_cycle_costs_nzd=[210.0, 260.0, 230.0],
    )
    assert recent.basis is ExpectationBasis.OWN_RECENT_CYCLES
    assert recent.cost_nzd == 230.0  # median, not mean


def test_the_demo_households_fall_back_to_comparable_homes_and_say_so():
    """The honest state of the seeded data — and the caveat that goes with it is the
    thing that stops the narration claiming 'more than you usually pay'."""
    e = choose_expectation(
        days_in_cycle=31, unit_price_nzd=0.30, comparable_home_kwh_per_day=7.06
    )
    assert e.basis is ExpectationBasis.COMPARABLE_HOMES
    assert "similar homes" in e.claim_rule.lower()
    assert "usually pay" in e.claim_rule


def test_the_basis_claim_rule_reaches_the_narration_bundle():
    caveats = " ".join(build_bill_shock(assessment("H-JUL", 14)).caveats).lower()
    assert "similar homes" in caveats
    assert "usually pay" in caveats


# ───────────────────────── attribution ─────────────────────────


def test_the_causes_sum_to_the_overshoot():
    """They add up by construction, and the test is here because a decomposition whose
    parts do not add up to its headline is what gets picked apart on stage."""
    a = assessment("H-COLD", 20)
    total = (
        a.attribution.weather_nzd
        + a.attribution.behaviour_nzd
        + a.attribution.everyday_load_nzd
    )
    assert total == pytest.approx(a.overshoot_nzd, abs=0.05)


def test_no_cause_is_offered_when_the_regression_was_not_usable():
    """An unexplained overshoot presented with a confident cause is worse than one
    presented with none, so the bundle must forbid it outright."""
    w = window("H-JUL", 6)
    a = assess(
        w,
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=fixtures.heating_degree_days("H-JUL")[0][:6],
        normal_hdd_per_day=fixtures.heating_degree_days("H-JUL")[1],
        comparable_home_kwh_per_day=fixtures.comparison_baseline("H-JUL"),
        preferences=defaults_for("H-JUL"),
    )
    assert not a.attribution.explained
    assert a.dominant_cause is None

    caveats = " ".join(build_bill_shock(a).caveats)
    assert "NO breakdown" in caveats
    assert "not even a hedged one" in caveats


def test_attribution_facts_are_absent_when_unexplained():
    """Not merely forbidden in prose — the numbers are not in the bundle at all, so
    there is nothing on the page for the model to reach for."""
    a = assessment("H-JUL", 6)
    keys = {f.key for f in build_bill_shock(a).facts}
    assert not {"weather_share_nzd", "higher_use_share_nzd"} & keys


# ───────────────────────── the trigger ─────────────────────────


def test_the_customers_threshold_changes_whether_it_fires():
    """The feature, in one test. Same household, same day, same data — two settings."""
    sensitive = AlertPreferences(account_ref="H-JUL", tier1_pct=5, tier2_pct=10, tier3_pct=20)
    tolerant = AlertPreferences(account_ref="H-JUL", tier1_pct=150, tier2_pct=175, tier3_pct=200)

    assert assessment("H-JUL", 20, sensitive).triggered
    assert not assessment("H-JUL", 20, tolerant).triggered


def test_the_dollar_floor_holds_under_a_low_percentage():
    """A percentage alone fires constantly on small bills. Someone who sets 5% must still
    not be texted about $8."""
    prefs = AlertPreferences(
        account_ref="H-FLAT", tier1_pct=5, tier2_pct=10, tier3_pct=20, min_overshoot_nzd=200
    )
    a = assessment("H-JUL", 20, prefs)
    assert a.tier_thresholds_nzd[1] >= a.expected_cost_nzd + 200


def test_probabilities_are_monotonic_across_the_ladder():
    """A higher threshold can never be more likely to be exceeded. If this fails the
    thresholds or the CDF are the wrong way round."""
    a = assessment("H-JUL", 18)
    p = a.tier_probabilities
    assert p[1] >= p[2] >= p[3]
    assert all(0.0 <= v <= 1.0 for v in p.values())


def test_a_household_on_track_does_not_trigger():
    a = assessment("H-FLAT", 20) if "H-FLAT" in fixtures.all_ids() else None
    if a is None:
        pytest.skip("no on-track fixture household")
    assert not a.triggered


def test_every_fixture_household_assesses_without_raising():
    """Cheap breadth. The forecast has several fallback paths and each fixture exercises
    a different one; a household that raises here is a household the dashboard 500s on."""
    for customer_id in fixtures.all_ids():
        for day in (7, 14, 21, 31):
            a = assessment(customer_id, day)
            assert math.isfinite(a.projected_cost_nzd)
            assert a.forecast.cost_p10_nzd <= a.forecast.cost_p90_nzd


def test_the_bundle_never_carries_a_raw_series():
    """The load-bearing property of the whole architecture.

    You cannot ban a language model from doing arithmetic — you can only decline to hand
    it the operands. Every fact must be a scalar; a list reaching this bundle is a model
    that can be asked to add it up.
    """
    bundle = build_bill_shock(assessment("H-JUL", 20))
    for fact in bundle.facts:
        assert isinstance(fact.value, int | float)
    assert "daily_kwh" not in bundle.model_dump()
