"""The energy breakdown, and the line it must not cross.

This module turns the product's central limitation into an answer, which makes it the
easiest place in the codebase to accidentally undo that limitation. The tests are
therefore mostly about what it refuses to say: no appliance names, no national averages, no
standing load invented from a daily series, no heating attributed off an unusable fit.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.analytics.disaggregation import (
    MIN_DAYS,
    Confidence,
    split,
)

ANCHOR = dt.date(2026, 7, 1)


def rows(
    n: int = 31,
    *,
    kwh: float = 20.0,
    base_load: float | None = None,
    controlled: float = 0.0,
    hdd: float | None = None,
    heating_kwh_per_hdd: float = 0.0,
) -> list:
    """A synthetic month. `heating_kwh_per_hdd` builds a real weather response into the
    series, so the regression has something true to find rather than noise."""
    from app.analytics.account import DayUsage

    out = []
    for i in range(n):
        day_hdd = None if hdd is None else hdd + (i % 5)
        total = kwh + (heating_kwh_per_hdd * (day_hdd or 0.0))
        out.append(
            DayUsage(
                date=ANCHOR + dt.timedelta(days=i),
                import_kwh=total,
                base_load_kwh=base_load,
                controlled_kwh=controlled,
                heating_degree_days=day_hdd,
            )
        )
    return out


# ---------- the arithmetic ----------


def test_the_categories_add_up_to_the_bill() -> None:
    """A split whose parts do not sum to the whole is a split the customer can catch, and
    they will — it is the first thing anybody does with a pie chart."""
    result = split(
        rows(base_load=4.0, controlled=5.0, hdd=6.0, heating_kwh_per_hdd=0.8),
        period="July 2026",
        unit_price_nzd=0.30,
        has_controlled_load=True,
    )
    assert result.available
    assert sum(s.kwh for s in result.slices) == pytest.approx(result.total_kwh, abs=0.1)
    assert sum(s.share_pct for s in result.slices) == pytest.approx(100.0, abs=0.5)


def test_nothing_is_counted_twice() -> None:
    """The controlled circuit runs overnight on most NZ connections, so a base load
    computed over the total would swallow the cylinder and then the cylinder would be
    added again from its own meter. That inflated the attributed portion above 100% and
    made the remainder negative the first time this was written."""
    result = split(
        rows(kwh=30.0, base_load=4.0, controlled=8.0),
        period="July 2026",
        unit_price_nzd=0.30,
        has_controlled_load=True,
    )
    assert all(s.kwh >= 0 for s in result.slices)
    remainder = next(s for s in result.slices if s.key == "everything_else")
    assert remainder.kwh > 0


def test_the_remainder_is_never_the_headline() -> None:
    """"Everything else is the biggest part of your bill" is arithmetically true for most
    households and answers nothing. A model handed it as the largest slice leads with it."""
    result = split(
        rows(base_load=4.0, controlled=5.0),
        period="July 2026",
        unit_price_nzd=0.30,
        has_controlled_load=True,
    )
    assert result.largest is not None
    assert result.largest.confidence is not Confidence.RESIDUAL


# ---------- what it refuses ----------


def test_standing_load_is_not_invented_from_a_daily_series() -> None:
    """The bug that made this worth a test.

    The quietest day of a month still contains a day of ordinary living — cooking, a
    shower, the evening lights. Used as "always-on" it put one demo household's standing
    load at 86% of its bill: not an optimistic estimate, the wrong measurement wearing the
    right label, and it would have been the headline of every answer.
    """
    without_intervals = split(
        rows(hdd=6.0, heating_kwh_per_hdd=0.8),
        period="July 2026",
        unit_price_nzd=0.30,
    )
    assert "always_on" not in {s.key for s in without_intervals.slices}
    assert without_intervals.always_on_not_reported_because
    assert any("always-on load is NOT broken out" in c for c in without_intervals.caveats)

    with_intervals = split(
        rows(base_load=3.0, hdd=6.0, heating_kwh_per_hdd=0.8),
        period="July 2026",
        unit_price_nzd=0.30,
    )
    always_on = next(s for s in with_intervals.slices if s.key == "always_on")
    assert always_on.confidence is Confidence.MEASURED
    assert "overnight" in always_on.basis


def test_heating_is_not_attributed_off_an_unusable_fit() -> None:
    """Same rule `forecast.py` follows: an attribution built on a regression that did not
    fit is a fabrication with statistics stapled to it."""
    flat_weather = split(
        rows(base_load=3.0, hdd=None), period="July 2026", unit_price_nzd=0.30
    )
    assert "space_heating" not in {s.key for s in flat_weather.slices}
    assert flat_weather.heating_not_reported_because
    assert any("Heating is NOT broken out" in c for c in flat_weather.caveats)


def test_a_real_weather_response_is_found_and_labelled_as_fitted() -> None:
    result = split(
        rows(base_load=3.0, hdd=5.0, heating_kwh_per_hdd=1.2),
        period="July 2026",
        unit_price_nzd=0.30,
    )
    heating = next(s for s in result.slices if s.key == "space_heating")

    assert heating.confidence is Confidence.FITTED
    assert result.heating_kwh_per_degree_day == pytest.approx(1.2, abs=0.15)
    # Real arithmetic on real data, and still an estimate. The wording has to say so.
    assert "estimate" in heating.caveat
    assert "r_squared" in heating.detail


def test_no_category_names_an_appliance() -> None:
    """The rule the whole product rests on. A category is a behaviour; a heat pump is a
    device, and one meter cannot see one."""
    result = split(
        rows(base_load=3.0, controlled=5.0, hdd=6.0, heating_kwh_per_hdd=1.0),
        period="July 2026",
        unit_price_nzd=0.30,
        has_controlled_load=True,
    )
    # The claim surface is the label and the key — those are what a customer reads as
    # "this is what X cost you", and what a model will lift verbatim into a sentence.
    #
    # Deliberately NOT a blanket word ban over the caveats. The always-on caveat says
    # "fridges, standby power, pumps" and then says the figure cannot be broken down
    # between them, which is the opposite of attribution: it is the explanation of why
    # the category exists at this resolution and not a finer one. Banning the word there
    # would push the module towards a vaguer caveat, which is worse.
    banned = ("heat pump", "dryer", "fridge", "oven", "washing machine", "television")
    claims = " ".join(f"{s.key} {s.label}" for s in result.slices).lower()
    for word in banned:
        assert word not in claims, f"a category is labelled {word!r}"

    assert any("not a measurement of a heater" in s.caveat for s in result.slices)
    assert any("not by appliance" in c for c in result.caveats)
    # And every caveat that lists examples must also say they cannot be separated.
    always_on = next(s for s in result.slices if s.key == "always_on")
    assert "cannot be broken down further" in always_on.caveat


def test_the_controlled_circuit_is_reported_without_asserting_what_is_on_it() -> None:
    """It is a second meter, so what it used may be stated. What is plugged into it may
    not — usually the hot water cylinder in New Zealand, usually being the point."""
    result = split(
        rows(base_load=3.0, controlled=6.0),
        period="July 2026",
        unit_price_nzd=0.30,
        has_controlled_load=True,
    )
    water = next(s for s in result.slices if s.key == "water_heating")

    assert water.confidence is Confidence.MEASURED
    assert "usually, not certainly" in water.caveat
    assert "may not assert" in water.caveat


def test_a_national_average_is_explicitly_out_of_scope() -> None:
    """This is where "lighting is 12% of your bill" would go. That figure is a fact about
    New Zealand, not about this house, and quoting it against somebody's own bill presents
    a population average as a personal measurement."""
    result = split(
        rows(base_load=3.0, controlled=5.0), period="July 2026", unit_price_nzd=0.30,
        has_controlled_load=True,
    )
    remainder = next(s for s in result.slices if s.key == "everything_else")
    assert "national average" in remainder.caveat
    assert "as if it were theirs" in remainder.caveat


# ---------- what it declines to do at all ----------


def test_a_short_period_is_refused() -> None:
    short = split(rows(n=MIN_DAYS - 1), period="July 2026", unit_price_nzd=0.30)
    assert short.available is False
    assert "at least" in short.reason


def test_a_split_with_nothing_separated_is_unavailable_not_one_big_slice() -> None:
    """A single category called "everything else" reads like an answer, and a model handed
    it will present it as one. Unavailable with the reasons attached makes it say what it
    could not do and why."""
    nothing = split(rows(hdd=None), period="July 2026", unit_price_nzd=0.30)

    assert nothing.available is False
    assert nothing.always_on_not_reported_because
    assert "cannot be split into categories" in nothing.reason
    # And the reason tells the model what to do instead of estimating.
    assert "rather than estimating a split" in nothing.reason


def test_an_account_with_no_usage_is_refused() -> None:
    empty = split(
        rows(kwh=0.0), period="July 2026", unit_price_nzd=0.30
    )
    assert empty.available is False
