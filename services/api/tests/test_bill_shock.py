"""Bill-shock warning — the proactive half of the product.

The thresholds are the whole design. A warning that fires on every household is
ignored within a week, and one that never fires is decoration, so most of these tests
are about *not* triggering: three of the five demo households must stay quiet.

The claim boundary is tested too. This compares against **comparable homes**, never
against the customer's own history — there is no billing history behind the demo data,
and "more than you usually pay" would be a fabrication of exactly the kind the product
exists to prevent. `test_never_claims_to_know_their_usual_bill` pins that.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.analytics import fixtures
from app.analytics.engine import (
    EARLY_CYCLE_DAYS,
    SHOCK_NZD_THRESHOLD,
    SHOCK_PCT_THRESHOLD,
    UsageWindow,
    assess_bill_shock,
    build_bill_shock,
    recent_trend_pct,
)
from app.main import app

DAYS = 31

client = TestClient(app)


def window(customer_id: str, days: int | None = None) -> UsageWindow:
    full = fixtures.get_window(customer_id)
    return UsageWindow(
        customer_id=customer_id,
        period=full.period,
        daily_kwh=full.daily_kwh[:days] if days else full.daily_kwh,
        unit_price_nzd=full.unit_price_nzd,
    )


def assess(customer_id: str, days: int | None = None):
    return assess_bill_shock(
        window(customer_id, days), DAYS, fixtures.comparison_baseline(customer_id)
    )


# ───────────────────────────── triggering ─────────────────────────────


def test_the_real_july_household_triggers() -> None:
    """H-JUL genuinely runs above comparable homes — that is the published finding."""
    a = assess("H-JUL", 14)
    assert a.triggered
    assert "above_comparable_homes" in a.reasons
    assert a.projected_cost_nzd > a.expected_cost_nzd


@pytest.mark.parametrize("day", [6, 7, 8])
def test_cold_snap_is_caught_while_there_is_still_time(day: int) -> None:
    """The case the product is named for: caught early, with the cycle still open.

    H-COLD's snap runs days 3-9. Assessed inside it, daily use has risen sharply against
    the opening of the cycle and both signals fire — with 23+ days left to act on it.
    A warning on day 31 is not a warning, it is a bill.
    """
    a = assess("H-COLD", day)
    assert a.triggered
    assert "rising_within_cycle" in a.reasons
    assert a.days_remaining >= 23


def test_cold_snap_stops_triggering_once_it_has_passed() -> None:
    """By the full month the snap has washed out and H-COLD is only 24.5% above
    comparable homes — real, but not worth alarming someone about."""
    assert not assess("H-COLD").triggered


@pytest.mark.parametrize("customer_id", ["H-SPIKE", "H-DROP", "H-TARIFF"])
def test_households_without_bill_shock_settle_quiet(customer_id: str) -> None:
    """Once enough of the cycle has happened, three of five must be quiet.

    H-SPIKE sits 15-30% above but on a small bill, so the dollar floor holds it back.
    H-DROP ends *below* comparable homes — its story is hardship, not bill shock.
    H-TARIFF is 1.7% above, which is noise.

    Deliberately checked from day 14 onward, not from day 7. Both H-SPIKE and H-DROP do
    fire around day 7, and that is correct rather than a bug: on day 7 H-SPIKE's spike
    day is a seventh of the evidence and H-DROP has not yet collapsed, so both really
    are heading somewhere expensive on the data available. See
    `test_early_warnings_are_hedged_rather_than_suppressed`.
    """
    for day in (14, 21, DAYS):
        assert not assess(customer_id, day).triggered, f"{customer_id} fired on day {day}"


@pytest.mark.parametrize("customer_id,day", [("H-SPIKE", 7), ("H-DROP", 7)])
def test_early_warnings_are_hedged_rather_than_suppressed(customer_id: str, day: int) -> None:
    """The judgement call, pinned so it is not silently reversed.

    Both of these fire early on evidence that later settles. We do **not** suppress them
    — warning early enough to act is the entire point of a prevention agent, and on the
    data available at that moment the concern is real. What we do instead is refuse to
    sound confident: the bundle carries an explicit instruction not to present the figure
    as what they will pay.
    """
    a = assess(customer_id, day)
    assert a.triggered
    assert a.days_elapsed < EARLY_CYCLE_DAYS
    caveats = " ".join(build_bill_shock(a, window(customer_id, day)).caveats)
    assert "genuinely uncertain" in caveats
    assert "early estimate" in caveats


def test_a_settled_cycle_carries_no_uncertainty_hedge() -> None:
    """The hedge must disappear once it stops being true, or it becomes noise people
    learn to skip past."""
    a = assess("H-JUL", 21)
    caveats = " ".join(build_bill_shock(a, window("H-JUL", 21)).caveats)
    assert "genuinely uncertain" not in caveats


def test_both_thresholds_are_required() -> None:
    """A percentage alone fires constantly on small bills; a dollar amount alone never
    fires on large ones. H-SPIKE is the case that proves the pair is needed: it clears
    the percentage comfortably and is held back only by the dollar floor."""
    a = assess("H-SPIKE", 14)
    assert a.overshoot_pct >= SHOCK_PCT_THRESHOLD
    assert a.overshoot_nzd < SHOCK_NZD_THRESHOLD
    assert not a.triggered


def test_usage_collapse_produces_a_negative_overshoot() -> None:
    a = assess("H-DROP", 21)
    assert a.overshoot_nzd < 0
    assert not a.triggered


# ───────────────────────────── arithmetic ─────────────────────────────


def test_cost_so_far_and_usage_agree() -> None:
    """The dashboard shows both. Two figures on one screen that cannot both be true is
    the failure this feature exists to avoid."""
    a = assess("H-COLD", 6)
    assert a.cost_so_far_nzd == pytest.approx(a.usage_so_far_kwh * 0.30, abs=0.01)


def test_days_remaining_is_the_rest_of_the_cycle() -> None:
    a = assess("H-JUL", 14)
    assert a.days_elapsed == 14
    assert a.days_in_cycle == DAYS
    assert a.days_remaining == 17


def test_projection_scales_to_the_full_cycle() -> None:
    a = assess("H-TARIFF", 10)
    w = window("H-TARIFF", 10)
    assert a.projected_cost_nzd == pytest.approx(w.mean_kwh * DAYS * 0.30, abs=0.01)


def test_more_days_than_the_cycle_is_rejected() -> None:
    with pytest.raises(ValueError):
        assess_bill_shock(window("H-JUL"), 10, 7.06)


def test_trend_needs_enough_days_to_mean_anything() -> None:
    """Fewer than six days returns 0.0 rather than a small number that looks like a
    finding. Silence is the honest answer when there is nothing to say."""
    assert recent_trend_pct(window("H-COLD", 5)) == 0.0
    assert recent_trend_pct(window("H-COLD", 6)) != 0.0


# ───────────────────────────── the fact bundle ─────────────────────────────


def test_the_trend_fact_is_omitted_when_it_did_not_trigger() -> None:
    """A bundle carrying a fact the narration has no reason to mention is an invitation
    to mention it, and "usage is up 3%" stated as a finding is noise dressed as insight."""
    quiet = assess("H-JUL", 14)
    assert "rising_within_cycle" not in quiet.reasons
    keys = {f.key for f in build_bill_shock(quiet, window("H-JUL", 14)).facts}
    assert "recent_trend_pct" not in keys

    rising = assess("H-COLD", 6)
    rising_keys = {f.key for f in build_bill_shock(rising, window("H-COLD", 6)).facts}
    assert "recent_trend_pct" in rising_keys


def test_never_claims_to_know_their_usual_bill() -> None:
    """The claim boundary, pinned.

    There is no billing history in the demo data, so "more than you usually pay" is
    unknowable. The caveats must say so explicitly — this is the guard that stops the
    narration inventing a personal baseline out of a comparable-homes figure.
    """
    caveats = " ".join(build_bill_shock(assess("H-JUL", 14), window("H-JUL", 14)).caveats)
    assert "similar homes" in caveats
    assert "billing history" in caveats
    assert "usually pay" in caveats


def test_every_figure_in_the_bundle_is_verifiable() -> None:
    """Layer 3 checks narration against `allowed_values()`. A figure the warning shows
    but the bundle omits could never be quoted by the assistant without being rejected."""
    a = assess("H-COLD", 6)
    bundle = build_bill_shock(a, window("H-COLD", 6))
    allowed = bundle.allowed_values()
    for value in (a.projected_cost_nzd, a.expected_cost_nzd, a.overshoot_nzd):
        assert value in allowed


# ───────────────────────────── the endpoint ─────────────────────────────


def test_endpoint_returns_a_triggered_warning() -> None:
    body = client.get("/api/households/H-COLD/bill-shock?as_at_day=6").json()
    assert body["triggered"] is True
    assert set(body["reasons"]) == {"above_comparable_homes", "rising_within_cycle"}
    assert body["days_remaining"] == 25
    assert body["facts"]


def test_endpoint_returns_a_calm_state_rather_than_nothing() -> None:
    """The figures are present either way, so the dashboard can show "on track" without
    a second request."""
    body = client.get("/api/households/H-TARIFF/bill-shock?as_at_day=14").json()
    assert body["triggered"] is False
    assert body["reasons"] == []
    assert body["projected_cycle_cost_nzd"] > 0


def test_endpoint_defaults_to_the_whole_window() -> None:
    body = client.get("/api/households/H-JUL/bill-shock").json()
    assert body["days_elapsed"] == DAYS
    assert body["days_remaining"] == 0


@pytest.mark.parametrize("day", [0, -1, 99])
def test_endpoint_rejects_a_day_outside_the_cycle(day: int) -> None:
    assert client.get(f"/api/households/H-JUL/bill-shock?as_at_day={day}").status_code == 422


def test_endpoint_404s_for_an_unknown_household() -> None:
    assert client.get("/api/households/H-NOPE/bill-shock").status_code == 404
