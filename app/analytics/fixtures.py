"""Five demo households — placeholders until Day 2 replaces them with seeded data.

Each household exists to demonstrate exactly one finding, and each maps to a line in
docs/demo-script.md. A finding with no household to show it is a finding you cannot
demo; a household that serves no demo line is data nobody will see.

The numbers below are shaped, not measured. Day 2 replaces them with generated
half-hourly data. Nothing here may appear on a slide.
"""

from __future__ import annotations

from app.analytics.engine import UsageWindow

# H-A: high standing load. The flagship case — the spike is small, the floor is the money.
_H_A = [8.9, 9.1, 8.8, 9.0, 17.8, 9.2, 8.7, 9.1, 8.9, 9.0, 8.8, 9.3, 9.0, 8.9,
        9.1, 8.8, 9.2, 9.0, 8.7, 9.1, 8.9, 9.0, 9.2, 8.8, 9.1, 8.9, 9.0, 8.8, 9.1, 8.9, 9.0]

# H-B: genuine cold snap — a run of high days, not a single spike. Tests weather normalisation.
_H_B = [7.2, 7.5, 12.8, 14.1, 15.2, 14.8, 13.9, 12.1, 7.8, 7.4, 7.6, 7.2, 7.5, 7.3,
        7.6, 7.4, 7.2, 7.5, 7.8, 7.3, 7.4, 7.6, 7.2, 7.5, 7.3, 7.4, 7.6, 7.2, 7.5, 7.4, 7.3]

# H-C: real behavioural spike — one anomalous day against a low, steady baseline.
_H_C = [4.1, 4.2, 4.0, 4.3, 4.1, 4.2, 19.6, 4.1, 4.0, 4.2, 4.3, 4.1, 4.0, 4.2,
        4.1, 4.3, 4.0, 4.2, 4.1, 4.0, 4.3, 4.2, 4.1, 4.0, 4.2, 4.1, 4.3, 4.0, 4.2, 4.1, 4.0]

# H-D: usage collapse — the hardship signal. Someone rationing heat they cannot afford.
_H_D = [11.2, 10.9, 11.4, 11.0, 10.8, 11.1, 9.2, 7.4, 5.1, 3.8, 3.2, 3.0, 2.9, 3.1,
        2.8, 3.0, 2.9, 3.2, 2.8, 3.0, 2.9, 3.1, 2.8, 3.0, 2.9, 2.8, 3.1, 2.9, 3.0, 2.8, 2.9]

# H-E: steady mid-range user who is on the wrong tariff. Serves the Low Fixed Charge line.
_H_E = [6.1, 6.3, 6.0, 6.2, 6.1, 6.4, 6.0, 6.2, 6.1, 6.3, 6.0, 6.2, 6.1, 6.0,
        6.3, 6.2, 6.1, 6.0, 6.2, 6.3, 6.1, 6.0, 6.2, 6.1, 6.3, 6.0, 6.2, 6.1, 6.0, 6.2, 6.1]

_HOUSEHOLDS: dict[str, tuple[str, list[float]]] = {
    "H-A": ("High standing load", _H_A),
    "H-B": ("Cold-snap driven", _H_B),
    "H-C": ("One-off behavioural spike", _H_C),
    "H-D": ("Usage collapse (hardship signal)", _H_D),
    "H-E": ("Candidate for a different tariff", _H_E),
}

PERIOD = "July 2026"


def get_window(customer_id: str) -> UsageWindow:
    if customer_id not in _HOUSEHOLDS:
        raise KeyError(f"unknown household {customer_id!r}; known: {sorted(_HOUSEHOLDS)}")
    _, daily = _HOUSEHOLDS[customer_id]
    return UsageWindow(customer_id=customer_id, period=PERIOD, daily_kwh=list(daily))


def label(customer_id: str) -> str:
    return _HOUSEHOLDS[customer_id][0]


def all_ids() -> list[str]:
    return sorted(_HOUSEHOLDS)
