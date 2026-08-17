"""The July 2026 Genesis regression test — written before the code, per the plan.

We already have a defended, published answer for this household. Asserting it here
first means our very first analytics code is provably correct against a result the
team has already stood behind in a deck, and it stays locked in for the rest of the
sprint.

Published conclusions (Research Brief v2, 13 Aug 2026):
  * Saturday 11 July is exactly 2.00x the other three Saturdays
  * that visible spike explains only ~11% of the overshoot
  * the remaining ~2.4 kWh/day standing load is the rest
  * spike costs ~$2.60; the standing load ~$290/year at an illustrative 30c/kWh

TO PORT (Day 4): the 31 measured daily values live in
  ~/Documents/Iris Vault/MIT Internship/kea-energy/research/measure-july-chart.py
which derives them from the chart PNG at runtime rather than storing them. Run it,
write the output to tests/data/july_2026_daily.json, and these tests activate.

Accuracy of the source measurement is about +/- 0.2 kWh/day, so tolerances here are
deliberately loose. Do not tighten them to make a test pass.
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
)

DATA = pathlib.Path(__file__).parent / "data" / "july_2026_daily.json"

pytestmark = pytest.mark.skipif(
    not DATA.exists(),
    reason=(
        "July measurements not ported yet — run measure-july-chart.py from the Iris "
        "Vault and write its 31 daily values to tests/data/july_2026_daily.json"
    ),
)


@pytest.fixture
def july() -> UsageWindow:
    daily = json.loads(DATA.read_text())
    assert len(daily) == 31, "July has 31 days; the measurement should have 31 values"
    return UsageWindow(customer_id="genesis-july", period="July 2026", daily_kwh=daily)


def test_saturday_11_july_is_double_the_other_saturdays(july: UsageWindow) -> None:
    """The 'double' in the deck is real, not rounded — hold it to 2 decimal places."""
    dow = "WTFSSMTWTFSSMTWTFSSMTWTFSSMTWTF"  # 1 July 2026 is a Wednesday
    saturdays = [july.daily_kwh[i] for i, d in enumerate(dow) if d == "S" and i % 7 == 3]
    spike, others = saturdays[1], [s for j, s in enumerate(saturdays) if j != 1]
    ratio = spike / (sum(others) / len(others))
    assert ratio == pytest.approx(2.00, abs=0.02)


def test_standing_load_is_about_2_4_kwh_per_day(july: UsageWindow) -> None:
    assert standing_load_kwh_per_day(july) == pytest.approx(2.4, abs=0.3)


def test_spike_explains_only_about_a_tenth_of_the_overshoot(july: UsageWindow) -> None:
    """The line that lands in the room: the spike everyone stares at is not the money."""
    spike_kwh, sustained_kwh = overshoot_attribution(july)
    share = spike_kwh / (spike_kwh + sustained_kwh) * 100
    assert share == pytest.approx(11.0, abs=4.0)
    assert sustained_kwh > spike_kwh * 5


def test_annual_standing_load_cost_is_about_290(july: UsageWindow) -> None:
    bundle = build_why_high(july)
    annual = bundle.value_index()["standing_load_annual_cost"]
    assert annual == pytest.approx(290.0, abs=40.0)


def test_spike_cost_is_small(july: UsageWindow) -> None:
    bundle = build_why_high(july)
    assert bundle.value_index()["spike_cost"] < 10.0


def test_bundle_forbids_naming_an_appliance(july: UsageWindow) -> None:
    """Half-hourly data cannot identify appliances. Our refusal to name one was
    correct and must survive into the product."""
    bundle = build_why_high(july)
    assert any("appliance" in c.lower() for c in bundle.caveats)
