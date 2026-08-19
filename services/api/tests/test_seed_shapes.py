"""Tests for the seeder's pure logic — no database needed.

The parts of seeding that can go silently wrong are the arithmetic ones: spreading a daily
total across 48 intervals and losing some to rounding, or shaping a household so it no
longer demonstrates the finding it exists to demonstrate. Both are caught here, on any
machine, without Postgres running.

What these do *not* cover is whether the rows actually land in the database — that needs a
live Postgres and belongs in an integration test once Docker is available.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.analytics.fixtures import DAYS, HOUSEHOLDS, _flat, _july
from app.db.seed import _intervals

DAY = dt.date(2026, 7, 1)


class TestDayShape:
    def test_a_day_is_48_half_hourly_intervals(self):
        assert len(_intervals(DAY, 10.0)) == 48

    def test_intervals_are_half_an_hour_apart_and_timezone_aware(self):
        iv = _intervals(DAY, 10.0)
        assert all(t.tzinfo is not None for t, _ in iv), "naive timestamps break DST (ADR-0006)"
        gaps = {(b - a).total_seconds() for (a, _), (b, _) in zip(iv, iv[1:], strict=False)}
        assert gaps == {1800.0}

    def test_spreading_preserves_the_daily_total(self):
        """Rounding to 3dp across 48 intervals must not lose meaningful energy."""
        for total in (2.5, 7.06, 9.68, 17.6, 19.6):
            got = float(sum(k for _, k in _intervals(DAY, total)))
            assert got == pytest.approx(total, abs=0.02)

    def test_the_curve_is_not_flat(self):
        """A flat 1/48th would look obviously synthetic on a chart, and would make any
        future half-hourly analysis meaningless."""
        vals = [float(k) for _, k in _intervals(DAY, 10.0)]
        assert max(vals) > min(vals) * 3

    def test_the_peak_is_in_the_evening(self):
        """Real households peak when people get home, not at 3am."""
        iv = _intervals(DAY, 10.0)
        peak_hour = max(iv, key=lambda p: p[1])[0].hour
        assert 16 <= peak_hour <= 20, f"peak at {peak_hour}:00, expected late afternoon/evening"

    def test_overnight_is_the_floor(self):
        """The standing load — the thing our flagship finding is about — should be the
        quietest part of the day."""
        iv = _intervals(DAY, 10.0)
        overnight = [float(k) for t, k in iv if t.hour < 5]
        evening = [float(k) for t, k in iv if 17 <= t.hour < 20]
        assert max(overnight) < min(evening)


class TestHouseholds:
    def test_every_household_has_a_full_month(self):
        for h in HOUSEHOLDS:
            assert len(h.daily_kwh) == DAYS, f"{h.ref} has {len(h.daily_kwh)} days"

    def test_every_household_serves_a_demo_line(self):
        """A household serving no line is data nobody will see."""
        for h in HOUSEHOLDS:
            assert h.demo_line.strip(), f"{h.ref} has no demo line"

    def test_refs_are_unique(self):
        refs = [h.ref for h in HOUSEHOLDS]
        assert len(refs) == len(set(refs))

    def test_july_household_matches_the_measurement(self):
        """H-JUL is the real Genesis household — it must stay at the measured 300.0 kWh."""
        july = {h.ref: h.daily_kwh for h in HOUSEHOLDS}["H-JUL"]
        assert sum(july) == pytest.approx(300.0, abs=0.5)
        assert july == _july()

    def test_each_household_actually_exhibits_its_finding(self):
        """The demo depends on these shapes. If someone tweaks the numbers, this fails."""
        by_ref = {h.ref: h.daily_kwh for h in HOUSEHOLDS}

        # H-COLD: a sustained run of high days, not one spike
        cold = by_ref["H-COLD"]
        assert sum(1 for v in cold if v > 12) >= 5, "cold snap needs a run of high days"

        # H-SPIKE: exactly one anomalous day against a flat baseline
        spike = by_ref["H-SPIKE"]
        assert sum(1 for v in spike if v > 15) == 1, "should be a single spike"

        # H-DROP: ends much lower than it starts — the hardship signal
        drop = by_ref["H-DROP"]
        assert sum(drop[-7:]) < sum(drop[:7]) / 2, "usage should visibly collapse"

        # H-TARIFF: steady, so the story is the plan not the behaviour
        tariff = by_ref["H-TARIFF"]
        assert max(tariff) - min(tariff) < 0.5, "should be flat"


def test_flat_helper():
    assert _flat(6.1, 5) == [6.1] * 5
    assert len(_flat(1.0)) == DAYS
