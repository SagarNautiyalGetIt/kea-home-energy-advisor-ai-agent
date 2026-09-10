"""The July 2026 Genesis regression test — the analytics validated against real data.

This household has a defended, published answer, so it is the one case where we know
what correct looks like. These assertions lock in results the team has already stood
behind in a deck.

Ground truth, reproduced by running research/measure-july-chart.py on 17 Aug 2026:

    total 300.0 kWh over 31 days, mean 9.68, median 9.2
    Saturday 11 July 17.6 kWh vs typical Saturday 8.80 -> exactly 2.00x
    similar homes 219.0 kWh/month = 7.06 kWh/day  (from Genesis's "37% more")
    overshoot 81.0 kWh, of which the spike is 8.8 kWh (10.9%)
    sustained overshoot 2.41 kWh/day
    spike costs $2.64; the whole overshoot ~$24.30/month ~ $290/year at 30c/kWh

Source accuracy is about +/- 0.2 kWh/day (values measured off a chart image), so
tolerances are deliberately loose. Do not tighten them to make a test pass.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.analytics.engine import (
    UsageWindow,
    build_why_high,
    overshoot_attribution,
    standing_load_kwh_per_day,
    sustained_overshoot_per_day,
)

#: What similar homes use, from Genesis's own "you used 37% more" comparison:
#: 300.0 kWh / 1.37 / 31 days. An external benchmark — never derived from the household.
COMPARISON_BASELINE = 7.06

DATA = pathlib.Path(__file__).parent / "data" / "july_2026_daily.json"


@pytest.fixture
def july() -> UsageWindow:
    daily = json.loads(DATA.read_text())
    assert len(daily) == 31, "July has 31 days"
    return UsageWindow(customer_id="genesis-july", period="July 2026", daily_kwh=daily)


def test_total_matches_the_measurement(july: UsageWindow) -> None:
    assert july.total_kwh == pytest.approx(300.0, abs=0.5)


def test_saturday_11_july_is_exactly_double_the_others(july: UsageWindow) -> None:
    """The 'double' in the deck is real, not rounded — hold it to 2 decimal places.

    1 July 2026 is a Wednesday, so Saturdays fall on the 4th, 11th, 18th and 25th.
    """
    saturdays = [july.daily_kwh[d - 1] for d in (4, 11, 18, 25)]
    spike = saturdays[1]
    others = [s for i, s in enumerate(saturdays) if i != 1]
    ratio = spike / (sum(others) / len(others))
    assert ratio == pytest.approx(2.00, abs=0.02)


def test_the_two_baselines_are_not_the_same_number(july: UsageWindow) -> None:
    """Guards the bug that produced the wrong headline figure.

    The absolute floor (~7.1 kWh/day) and the sustained overshoot vs similar homes
    (~2.4 kWh/day) are different quantities. Conflating them inflated the spike's
    apparent share from ~11% to ~71%.
    """
    floor = standing_load_kwh_per_day(july)
    overshoot = sustained_overshoot_per_day(july, COMPARISON_BASELINE)
    assert floor == pytest.approx(7.1, abs=0.4)
    assert overshoot == pytest.approx(2.41, abs=0.3)
    assert floor > overshoot * 2


def test_spike_explains_only_about_a_tenth_of_the_overshoot(july: UsageWindow) -> None:
    """The line that lands in the room: the spike everyone stares at is not the money."""
    spike_kwh, sustained_kwh = overshoot_attribution(july, COMPARISON_BASELINE)
    share = spike_kwh / (spike_kwh + sustained_kwh) * 100
    assert share == pytest.approx(10.9, abs=2.0)
    assert sustained_kwh > spike_kwh * 5


def test_annual_overshoot_cost_is_about_317(july: UsageWindow) -> None:
    """The WHOLE overshoot annualised, not the sustained part alone.

    research/analysis.md worked this at 30c/kWh and got ~$290 (81.0 kWh -> $24.30/month).
    The default rate is now Kea's published Anytime Rate of 32.5c, so the same 81.0 kWh
    annualises to ~$317. The figure moved because the price did; the analysis did not
    change, and 81.0 kWh a year of overshoot is still the finding.
    """
    annual = build_why_high(july, COMPARISON_BASELINE).value_index()["overshoot_annual_cost"]
    assert annual == pytest.approx(317.0, abs=20.0)


def test_spike_costs_about_two_sixty(july: UsageWindow) -> None:
    """$2.60 vs $290 is the whole pitch in one comparison."""
    spike_cost = build_why_high(july, COMPARISON_BASELINE).value_index()["spike_cost"]
    assert spike_cost == pytest.approx(2.64, abs=0.30)


def test_bundle_forbids_naming_an_appliance(july: UsageWindow) -> None:
    """Half-hourly data cannot identify appliances. Our refusal to name one was
    correct and must survive into the product."""
    bundle = build_why_high(july, COMPARISON_BASELINE)
    assert any("appliance" in c.lower() for c in bundle.caveats)


def test_every_published_figure_survives_the_number_checker(july: UsageWindow) -> None:
    """End-to-end: the template answer built from real data must pass layer 3."""
    from app.verification.number_checker import template_fallback, verify

    bundle = build_why_high(july, COMPARISON_BASELINE)
    assert verify(template_fallback(bundle), bundle).passed


def test_spike_threshold_sensitivity_is_documented_not_hidden(july: UsageWindow) -> None:
    """Pins the sensitivity that decides our headline claim.

    At 1.8x only Sat 11 Jul is anomalous and the spike explains ~10%, matching the
    published analysis. At 1.5x Fri 10 Jul also qualifies and the share jumps to ~16%.
    If this test ever fails, the headline number in the deck has moved — go and look,
    don't adjust the tolerance.
    """
    strict = overshoot_attribution(july, COMPARISON_BASELINE, spike_threshold=1.8)
    loose = overshoot_attribution(july, COMPARISON_BASELINE, spike_threshold=1.5)

    strict_share = strict[0] / sum(strict) * 100
    loose_share = loose[0] / sum(loose) * 100

    assert strict_share == pytest.approx(10.4, abs=1.0)
    assert loose_share == pytest.approx(16.4, abs=1.5)
    assert loose_share > strict_share + 4, "the two methods must stay visibly different"
