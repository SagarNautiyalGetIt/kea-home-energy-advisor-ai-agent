"""Weather, tariff and hardship analytics — the four demo lines that had no maths behind them.

All pure functions over daily totals, so none of this needs a model or a database.
"""

from __future__ import annotations

import pytest

from app.analytics.engine import (
    CollapseSignal,
    TariffOption,
    UsageWindow,
    build_hardship,
    build_tariff_check,
    build_weather_check,
    build_what_costs_most,
    compare_tariffs,
    detect_usage_collapse,
    heating_degree_days,
    weather_attribution,
)
from app.schemas import Intent
from app.verification.number_checker import template_fallback, verify


def _window(daily: list[float], ref: str = "H-TEST") -> UsageWindow:
    return UsageWindow(customer_id=ref, period="July 2026", daily_kwh=daily)


# ───────────────────────────── weather ─────────────────────────────


class TestHeatingDegreeDays:
    def test_cold_day_needs_heating(self):
        assert heating_degree_days(8.0) == pytest.approx(10.0)

    def test_warm_day_needs_none(self):
        assert heating_degree_days(21.0) == 0.0

    def test_the_base_is_18_degrees(self):
        """NZ convention. Changing it silently would move every weather figure."""
        assert heating_degree_days(18.0) == 0.0


class TestWeatherAttribution:
    def test_a_cold_snap_household_gets_credit_for_the_weather(self):
        """H-COLD's story: the bill rose because it got cold, not because they changed."""
        daily = [7.0] * 10 + [14.0] * 6 + [7.0] * 15
        hdd = [8.0] * 10 + [15.0] * 6 + [8.0] * 15
        weather, other = weather_attribution(_window(daily), hdd, normal_hdd_per_day=8.0)
        assert weather > 0, "a real cold snap must explain some usage"
        assert weather + other == pytest.approx(sum(daily))

    def test_steady_weather_explains_nothing(self):
        """A flat month has no cold snap to blame — the usage is behaviour."""
        daily = [9.0] * 31
        hdd = [8.0] * 31
        weather, other = weather_attribution(_window(daily), hdd, normal_hdd_per_day=8.0)
        assert weather == 0.0
        assert other == pytest.approx(sum(daily))

    def test_no_temperature_variation_is_handled_not_crashed(self):
        """Nothing to fit a line against — say so rather than dividing by zero."""
        weather, other = weather_attribution(_window([9.0] * 5), [8.0] * 5, 8.0)
        assert weather == 0.0
        assert other == pytest.approx(45.0)

    def test_weather_can_never_explain_more_than_the_whole_bill(self):
        daily = [20.0] * 31
        hdd = [30.0] * 15 + [5.0] * 16
        weather, other = weather_attribution(_window(daily), hdd, normal_hdd_per_day=1.0)
        assert weather <= sum(daily)
        assert other >= 0

    def test_mismatched_lengths_are_rejected(self):
        with pytest.raises(ValueError, match="one heating-degree-day"):
            weather_attribution(_window([9.0] * 31), [8.0] * 10, 8.0)


# ───────────────────────────── tariff ─────────────────────────────


STANDARD = TariffOption("Standard", unit_price_nzd=0.30, daily_fixed_nzd=1.50)
LOW_FIXED = TariffOption("Low Fixed Charge", unit_price_nzd=0.36, daily_fixed_nzd=0.30)


class TestTariffs:
    def test_low_user_is_better_off_on_low_fixed_charge(self):
        """That is the entire point of the LFC plan — it suits low users."""
        _, _, annual = compare_tariffs(_window([3.0] * 31), STANDARD, LOW_FIXED)
        assert annual > 0

    def test_high_user_is_worse_off(self):
        """And the plan penalises high users, which we must say rather than hide."""
        _, _, annual = compare_tariffs(_window([25.0] * 31), STANDARD, LOW_FIXED)
        assert annual < 0

    def test_break_even_is_about_twenty_kwh_a_day(self):
        """The threshold is the whole point of the comparison, so pin it.

        NZ's Low Fixed Charge regulation targeted households under ~8,000 kWh/year, so
        break-even belongs near 20-22 kWh/day. If this drifts upward, LFC starts looking
        cheaper for households it would actually cost more — and the advice goes wrong.
        """
        _, _, below = compare_tariffs(_window([18.0] * 31), STANDARD, LOW_FIXED)
        _, _, above = compare_tariffs(_window([22.0] * 31), STANDARD, LOW_FIXED)
        assert below > 0, "an 18 kWh/day household should be better off on LFC"
        assert above < 0, "a 22 kWh/day household should not be"

    def test_cost_includes_the_daily_charge_not_just_units(self):
        """Forgetting the standing charge is the classic tariff-comparison bug."""
        zero_use = TariffOption("X", unit_price_nzd=0.30, daily_fixed_nzd=1.00)
        assert zero_use.cost_for(kwh=0.0, days=31) == pytest.approx(31.0)

    def test_a_loss_is_never_presented_as_a_saving(self):
        bundle = build_tariff_check(_window([25.0] * 31), STANDARD, LOW_FIXED)
        keys = bundle.value_index()
        assert "annual_saving" not in keys, "must not offer a saving that isn't one"
        assert any("NOT cheaper" in c for c in bundle.caveats)

    def test_a_real_saving_is_offered(self):
        bundle = build_tariff_check(_window([3.0] * 31), STANDARD, LOW_FIXED)
        assert "annual_saving" in bundle.value_index()


# ───────────────────────────── hardship ─────────────────────────────


class TestUsageCollapse:
    def test_a_collapse_is_detected(self):
        """H-DROP's shape — someone rationing heat they cannot afford."""
        signal = detect_usage_collapse(_window([11.0] * 24 + [3.0] * 7))
        assert signal.detected
        assert signal.drop_pct > 40

    def test_steady_usage_is_not_flagged(self):
        assert not detect_usage_collapse(_window([9.0] * 31)).detected

    def test_a_mild_dip_is_not_a_collapse(self):
        """A quiet week is not hardship. False positives here are costly — they route a
        household to a hardship conversation they didn't ask for."""
        assert not detect_usage_collapse(_window([10.0] * 24 + [8.5] * 7)).detected

    def test_too_short_a_window_returns_no_signal(self):
        assert detect_usage_collapse(_window([10.0] * 3)) == CollapseSignal(False, 0.0, 0.0, 0.0)

    def test_the_hardship_reply_carries_no_figures_at_all(self):
        """Nothing to get wrong. A number has no place in this reply."""
        bundle = build_hardship()
        assert bundle.facts == []
        assert bundle.intent is Intent.HARDSHIP

    def test_the_hardship_caveats_forbid_advice(self):
        caveats = " ".join(build_hardship().caveats).lower()
        assert "financial advice" in caveats
        assert "figure" in caveats


# ───────────────────────────── the honest refusal ─────────────────────────────


class TestWhatCostsMost:
    def test_it_refuses_to_name_an_appliance(self):
        """Demo line 4. Two survey respondents asked exactly this, so it will come up."""
        bundle = build_what_costs_most(_window([9.0] * 31), 7.0)
        joined = " ".join(bundle.caveats).lower()
        assert "cannot identify which appliance" in joined
        assert "do not hedge" in joined and "do not guess" in joined

    def test_it_still_says_something_useful(self):
        """Refusing isn't enough — point at where the money actually is."""
        bundle = build_what_costs_most(_window([9.0] * 31), 7.0)
        assert "standing_load" in bundle.value_index()
        assert "standing_load_annual" in bundle.value_index()


# ───────────────────────────── every bundle survives layer 3 ─────────────────────────────


@pytest.mark.parametrize(
    "bundle",
    [
        build_weather_check(_window([7.0] * 10 + [14.0] * 6 + [7.0] * 15),
                            [8.0] * 10 + [15.0] * 6 + [8.0] * 15, 8.0),
        build_what_costs_most(_window([9.0] * 31), 7.0),
        build_tariff_check(_window([3.0] * 31), STANDARD, LOW_FIXED),
        build_tariff_check(_window([25.0] * 31), STANDARD, LOW_FIXED),
        build_hardship(),
    ],
    ids=["weather", "what_costs_most", "tariff_saving", "tariff_no_saving", "hardship"],
)
def test_every_new_bundle_passes_its_own_number_checker(bundle):
    """The deterministic fallback must never fail the gate it exists to satisfy.
    If this breaks, a verification failure would cascade into a second failure."""
    assert verify(template_fallback(bundle), bundle).passed
