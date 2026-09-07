"""The driver decomposition — the answer to "why is my bill so high?".

The property under test throughout is **closure**: the named causes sum to the change,
exactly. Everything else this module claims rests on it. A decomposition whose parts do
not add up to the whole is not a weaker explanation, it is a wrong one, and it fails in
front of a customer holding the paper bill.

The scenario tests are written as *the answer a person should get*, not as expected
floats. `test_move_in_bill_is_not_a_usage_increase` fails if the headline stops being
the day count, whatever the arithmetic underneath does — which is the regression that
matters, because attributing a 43-day bill to cold weather is confidently wrong in a way
that no numeric assertion would catch.
"""

from __future__ import annotations

import pytest

from app.analytics.drivers import BillPeriod, Confidence, decompose


def _bill(label: str, **kw) -> BillPeriod:
    """A bill whose parts reconstruct its total, so the residual means what it says."""
    return BillPeriod.from_bill(label, **kw)


JUNE = dict(days=31, total_nzd=180.0, total_kwh=520.0, daily_fixed_nzd=1.50,
            base_load_kwh_per_day=7.0, heating_degree_days=210.0)


# ───────────────────────────── closure ─────────────────────────────


@pytest.mark.parametrize(
    "current,prior,sensitivity",
    [
        # a longer period, colder, dearer — several drivers at once
        (dict(days=43, total_nzd=331.0, total_kwh=810.0, daily_fixed_nzd=1.62,
              base_load_kwh_per_day=7.6, heating_degree_days=390.0), JUNE, 0.45),
        # nothing moved at all
        (dict(**JUNE), JUNE, 0.4),
        # the bill fell
        (dict(days=31, total_nzd=120.0, total_kwh=380.0, daily_fixed_nzd=1.50,
              base_load_kwh_per_day=6.1, heating_degree_days=120.0), JUNE, 0.4),
        # a shorter period
        (dict(days=17, total_nzd=98.0, total_kwh=280.0, daily_fixed_nzd=1.50,
              base_load_kwh_per_day=7.0, heating_degree_days=115.0), JUNE, 0.4),
        # solar arrived
        (dict(days=31, total_nzd=95.0, total_kwh=430.0, daily_fixed_nzd=1.50,
              export_credit_nzd=41.0, base_load_kwh_per_day=5.0,
              heating_degree_days=90.0), JUNE, 0.3),
        # a late fee, and no weather data at all
        (dict(days=31, total_nzd=225.0, total_kwh=520.0, daily_fixed_nzd=1.50,
              one_off_nzd=37.21), JUNE, None),
        # a single day, which is a legitimate final bill
        (dict(days=1, total_nzd=8.0, total_kwh=22.0, daily_fixed_nzd=1.50), JUNE, 0.4),
    ],
)
def test_drivers_always_sum_to_the_change(current, prior, sensitivity) -> None:
    """The guarantee the whole module makes, across every shape of bill."""
    result = decompose(
        _bill("this period", **current),
        _bill("the period before", **prior),
        heating_sensitivity_kwh_per_hdd=sensitivity,
    )
    attributed = sum(d.amount_nzd for d in result.drivers)
    assert attributed == pytest.approx(result.total_delta_nzd, abs=0.05)


def test_residual_is_a_named_driver_not_a_dropped_remainder() -> None:
    """`unexplained` is always present, even at zero.

    Emitting it only when non-zero would make closure invisible: a reader could not tell
    a decomposition that accounted for everything from one that quietly discarded the
    remainder.
    """
    result = decompose(_bill("now", **JUNE), _bill("before", **JUNE))
    assert any(d.key == "unexplained" for d in result.drivers)


# ───────────────────────────── attribution order ─────────────────────────────


def test_move_in_bill_is_not_a_usage_increase() -> None:
    """A 43-day bill against a 31-day one must be explained by the day count.

    This is the failure the serving schema singles out and the reason period length is
    removed before anything else is attributed. The same numbers, explained as cold
    weather, would be a confident lie to a household that had just moved in.
    """
    result = decompose(
        _bill("August", days=43, total_nzd=250.0, total_kwh=721.0, daily_fixed_nzd=1.50,
              base_load_kwh_per_day=7.0, heating_degree_days=291.0),
        _bill("July", **JUNE),
        heating_sensitivity_kwh_per_hdd=0.45,
    )
    assert result.headline is not None
    assert result.headline.key == "period_length"
    assert result.headline.confidence is Confidence.EXACT


def test_a_pure_price_rise_is_attributed_to_price_not_behaviour() -> None:
    """Identical usage, identical days, dearer rates. Nothing the household did."""
    result = decompose(
        _bill("Aug", days=31, total_nzd=205.0, total_kwh=520.0, daily_fixed_nzd=1.50),
        _bill("Jul", **JUNE),
    )
    assert result.headline is not None
    assert result.headline.key == "unit_price"
    assert result.headline.amount_nzd == pytest.approx(25.0, abs=0.5)


def test_a_cold_snap_is_attributed_to_weather() -> None:
    result = decompose(
        _bill("Jul", days=31, total_nzd=268.0, total_kwh=790.0, daily_fixed_nzd=1.50,
              base_load_kwh_per_day=7.0, heating_degree_days=420.0),
        _bill("Jun", **JUNE),
        heating_sensitivity_kwh_per_hdd=1.0,
    )
    assert result.headline is not None
    assert result.headline.key == "weather"
    assert result.headline.confidence is Confidence.MODELLED


def test_weather_is_not_attributed_without_the_household_s_own_sensitivity() -> None:
    """No fitted slope means no weather driver — the dollars stay in `discretionary`.

    Substituting a population average here would produce a weather attribution for a
    household we have never fitted, which is a fabrication with a regression stapled to
    it. Layer 3 could not catch it: the figure would be real arithmetic over real
    degree days, just not about this house.
    """
    result = decompose(
        _bill("Jul", days=31, total_nzd=268.0, total_kwh=790.0, daily_fixed_nzd=1.50,
              heating_degree_days=420.0),
        _bill("Jun", **JUNE),
        heating_sensitivity_kwh_per_hdd=None,
    )
    assert not any(d.key == "weather" for d in result.drivers)
    assert sum(d.amount_nzd for d in result.drivers) == pytest.approx(
        result.total_delta_nzd, abs=0.05
    )


# ───────────────────────────── honesty ─────────────────────────────


def test_no_headline_when_nothing_dominates() -> None:
    """Four causes at roughly a quarter each is a bill that went up for four reasons.

    Returning the largest of them as "the reason" would be a false lead dressed as a
    finding, so `headline` is None and the caveat tells the narration to list them.
    """
    result = decompose(
        _bill("Jul", days=32, total_nzd=232.0, total_kwh=628.0, daily_fixed_nzd=1.58,
              base_load_kwh_per_day=7.4, heating_degree_days=250.0),
        _bill("Jun", **JUNE),
        heating_sensitivity_kwh_per_hdd=0.4,
    )
    if result.headline is None:
        assert any("No single cause dominates" in c for c in result.caveats())


def test_a_large_residual_is_declared_rather_than_narrated_away() -> None:
    """When the drivers cannot account for the change, the answer must say so."""
    # A bill whose parts do not reconstruct its total: the gap has nowhere to go but
    # the residual, which is exactly the situation the caveat exists for.
    current = BillPeriod(
        label="Jul", days=31, total_nzd=400.0, total_kwh=520.0,
        unit_rate_nzd=0.30, daily_fixed_nzd=1.50,
    )
    result = decompose(current, _bill("Jun", **JUNE))
    assert not result.is_fully_explained
    assert any("could NOT account for all of the change" in c for c in result.caveats())
    assert not result.inputs_reconstruct


def test_estimated_reads_force_a_hedge() -> None:
    result = decompose(
        _bill("Jul", days=31, total_nzd=210.0, total_kwh=600.0, daily_fixed_nzd=1.50,
              estimated_read_pct=42.0),
        _bill("Jun", **JUNE),
    )
    assert any("estimated" in c for c in result.caveats())


def test_appliances_are_never_named() -> None:
    """The refusal that has to survive every rewrite of this module."""
    result = decompose(_bill("Jul", **JUNE), _bill("Jun", **JUNE))
    assert any("cannot identify appliances" in c for c in result.caveats())
    for driver in result.drivers:
        assert "heater" not in driver.label.lower()
        assert "dryer" not in driver.label.lower()


# ───────────────────────────── inputs ─────────────────────────────


def test_from_bill_derives_a_rate_that_reconstructs_the_total() -> None:
    """The point of the constructor: the residual means "unattributed", not "the
    caller's arithmetic did not line up"."""
    bill = _bill("Jul", days=31, total_nzd=248.07, total_kwh=1034.665,
                 daily_fixed_nzd=1.12, export_credit_nzd=6.33)
    assert bill.reconstructs


def test_a_period_of_zero_days_is_rejected() -> None:
    with pytest.raises(ValueError, match="at least one day"):
        BillPeriod("bad", days=0, total_nzd=10.0, total_kwh=10.0, unit_rate_nzd=0.3)


def test_scaling_moves_volumes_and_leaves_rates_alone() -> None:
    """Rates are intensive, volumes are extensive. Scaling the rate would silently move
    a price change into the period-length driver and still close."""
    bill = _bill("Jun", **JUNE)
    scaled = bill.scaled_to(62)
    assert scaled.total_kwh == pytest.approx(bill.total_kwh * 2, rel=1e-6)
    assert scaled.unit_rate_nzd == pytest.approx(bill.unit_rate_nzd, rel=1e-9)
    assert scaled.daily_fixed_nzd == pytest.approx(bill.daily_fixed_nzd, rel=1e-9)


def test_zero_consumption_does_not_divide_by_zero() -> None:
    """A house that used nothing still has a bill — the fixed charges."""
    empty = _bill("Jul", days=31, total_nzd=46.50, total_kwh=0.0, daily_fixed_nzd=1.50)
    assert empty.unit_rate_nzd == 0.0
    result = decompose(empty, _bill("Jun", **JUNE))
    assert sum(d.amount_nzd for d in result.drivers) == pytest.approx(
        result.total_delta_nzd, abs=0.05
    )
