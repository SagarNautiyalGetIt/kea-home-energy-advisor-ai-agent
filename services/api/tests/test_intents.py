"""Layer 0 tests. Routing is Python, so routing bugs are ordinary bugs — keep them that way."""

from __future__ import annotations

import pytest

from app.routing.intents import route
from app.schemas import Intent


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Why is my power bill so high?", Intent.WHY_HIGH),
        ("why was my bill so expensive this month", Intent.WHY_HIGH),
        ("My usage has gone up", Intent.USING_MORE_THAN_USUAL),
        ("What will I pay this month?", Intent.WHAT_WILL_I_PAY),
        ("give me an estimate for the next bill", Intent.WHAT_WILL_I_PAY),
        ("Which appliance is using the most?", Intent.WHAT_COSTS_MOST),
        ("How does this compare to last year?", Intent.COMPARE_TO_LAST_YEAR),
        ("Am I on the right plan?", Intent.TARIFF_CHECK),
        ("what is the low fixed charge thing", Intent.TARIFF_CHECK),
        ("What's the capital of France?", Intent.OUT_OF_SCOPE),
        ("", Intent.OUT_OF_SCOPE),
    ],
)
def test_routes(message: str, expected: Intent) -> None:
    assert route(message).intent is expected


@pytest.mark.parametrize(
    "message",
    [
        "I can't afford this bill",
        "I am struggling to pay",
        "I'm behind on my payments",
        "are you going to disconnect me",
        "can I get a payment plan",
    ],
)
def test_hardship_is_detected_and_escalates(message: str) -> None:
    """Consumer Care Obligations Part 6 treats significant consumption change as a
    trigger for a retailer's duties. A customer saying they cannot pay must reach a
    human — the model must never counsel someone in financial distress."""
    result = route(message)
    assert result.intent is Intent.HARDSHIP
    assert result.is_escalation


def test_hardship_outranks_a_usage_question() -> None:
    """Both patterns match; hardship must win."""
    result = route("my bill is so high and I can't afford to pay it")
    assert result.intent is Intent.HARDSHIP
