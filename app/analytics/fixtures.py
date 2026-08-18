"""The five demo households — **the single definition**, used by both the API and the seeder.

`app/db/seed.py` imports `HOUSEHOLDS` from here rather than keeping its own copy. An
earlier version defined them twice and the two drifted apart within a day: the API was
still serving `H-A`…`H-E` while the seeder wrote `H-JUL`…`H-TARIFF`, so every request
404'd. One definition, imported.

Each household exists to demonstrate exactly one finding, and each maps to a line in
docs/sprints/sprint-2/demo-script.md. A finding with no household can't be demoed; a
household serving no line is data nobody will see.

> **H-JUL is the only real data here.** Its 31 daily totals were measured off a published
> Genesis chart (±0.2 kWh/day) — see tests/data/july_2026_daily.json. The other four are
> synthetic shapes built to exercise specific features. Do not present them as observations.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass

from app.analytics.engine import UsageWindow

PERIOD = "July 2026"
REGION = "Auckland"
DAYS = 31

_JULY_DATA = pathlib.Path(__file__).resolve().parents[2] / "tests" / "data" / "july_2026_daily.json"


def _july() -> list[float]:
    """The real measurements. Everything else in this file is invented."""
    return json.loads(_JULY_DATA.read_text())


def _flat(base: float, days: int = DAYS) -> list[float]:
    return [base] * days


@dataclass(frozen=True)
class Household:
    ref: str
    label: str
    daily_kwh: list[float]
    benchmark_kwh_per_day: float
    demo_line: str
    is_real: bool = False


HOUSEHOLDS: list[Household] = [
    Household(
        "H-JUL", "The real July household — high standing load",
        _july(), 7.06,
        "Line 1: why was my July bill so high?",
        is_real=True,
    ),
    Household(
        "H-COLD", "Cold-snap driven, not behaviour",
        [7.2, 7.5, 12.8, 14.1, 15.2, 14.8, 13.9, 12.1, *_flat(7.5, 23)], 7.0,
        "Line 2: wasn't that just the cold snap?",
    ),
    Household(
        "H-SPIKE", "One genuine behavioural spike",
        [*_flat(4.1, 6), 19.6, *_flat(4.1, 24)], 4.0,
        "Line 4: which appliance caused it? — the honest refusal",
    ),
    Household(
        "H-DROP", "Usage collapse — the hardship signal",
        [11.2, 10.9, 11.4, 11.0, 10.8, 11.1, 9.2, 7.4, 5.1, 3.8, *_flat(3.0, 21)], 8.0,
        "Line 5: I'm struggling to pay this",
    ),
    Household(
        "H-TARIFF", "Low steady user, better off on another plan",
        _flat(6.1), 6.0,
        "Line 3 / tariff check: low fixed charge modelling",
    ),
]

_BY_REF: dict[str, Household] = {h.ref: h for h in HOUSEHOLDS}


def get(customer_id: str) -> Household:
    if customer_id not in _BY_REF:
        raise KeyError(f"unknown household {customer_id!r}; known: {sorted(_BY_REF)}")
    return _BY_REF[customer_id]


def get_window(customer_id: str) -> UsageWindow:
    h = get(customer_id)
    return UsageWindow(customer_id=customer_id, period=PERIOD, daily_kwh=list(h.daily_kwh))


def comparison_baseline(customer_id: str) -> float:
    """What similar homes use per day. An external benchmark — **never** derived from the
    household itself. Separating the two is what stops the bug that once inflated our
    spike's apparent share from 11% to 71%."""
    return get(customer_id).benchmark_kwh_per_day


def label(customer_id: str) -> str:
    return get(customer_id).label


def all_ids() -> list[str]:
    return [h.ref for h in HOUSEHOLDS]


# ───────────────────────────── weather ─────────────────────────────
#
# ⚠️ **Invented.** These are not NIWA observations — real data is still an open task
# (KEA-42, a timeboxed spike). Anything derived from them is illustrative until that
# lands, and must not appear on a slide as measured.
#
# Days 4-9 are the cold snap H-COLD responds to. Mirrors what seed.py writes into
# weather_day.

_HDD_JULY = [
    8.2, 8.5, 8.0, 10.5, 10.8, 10.4, 10.6, 10.2, 10.5, 8.4,
    7.9, 8.3, 8.1, 7.8, 8.0, 8.4, 8.2, 7.7, 8.1, 8.3,
    8.0, 7.9, 8.2, 8.5, 8.1, 7.8, 8.0, 8.3, 8.2, 7.9, 8.1,
]

#: A typical July day in Auckland, for "colder than normal" comparisons. Same caveat.
NORMAL_HDD_PER_DAY = 8.1


def heating_degree_days(customer_id: str) -> tuple[list[float], float]:
    """(daily HDD, normal HDD per day). One series for every household — they all sit in
    the same region, which is what makes the comparison meaningful."""
    get(customer_id)  # validates the id
    return list(_HDD_JULY), NORMAL_HDD_PER_DAY
