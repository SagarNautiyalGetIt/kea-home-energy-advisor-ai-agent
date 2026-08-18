"""Layer 3 tests — the guarantee the pitch rests on.

If any of these fail, the claim "every number is computed, never generated" is false.
"""

from __future__ import annotations

import pytest

from app.schemas import Fact, FactBundle, Intent
from app.verification.number_checker import extract_tokens, template_fallback, verify


@pytest.fixture
def bundle() -> FactBundle:
    return FactBundle(
        customer_id="H-JUL",
        intent=Intent.WHY_HIGH,
        period="July 2026",
        facts=[
            Fact.energy("standing_load", 2.4, "Load running every day", per_day=True),
            Fact.money(
                "standing_load_annual_cost", 289.60, "Annual cost of that load", per_year=True
            ),
            Fact.money("spike_cost", 2.60, "Cost of the spike"),
            Fact.percent("spike_share", 11.0, "Share the spike explains"),
        ],
    )


class TestExtraction:
    def test_finds_currency_decimals_and_percentages(self) -> None:
        tokens = extract_tokens("It cost $290 a year, or 2.4 kWh a day — 11% of the total.")
        values = [t.value for t in tokens]
        assert 290.0 in values
        assert 2.4 in values
        assert 11.0 in values

    def test_thousands_separator(self) -> None:
        assert extract_tokens("$1,234")[0].value == 1234.0

    def test_unit_bearing_tokens_are_claims(self) -> None:
        claims = [t for t in extract_tokens("$290 and 2.4 kWh and 11%") if t.is_claim]
        assert len(claims) == 3

    def test_bare_small_integer_is_structural_not_a_claim(self) -> None:
        (token,) = extract_tokens("There are 3 things worth noting")
        assert not token.is_claim
        assert token.is_structural


class TestVerification:
    def test_passes_when_every_figure_traces_to_a_fact(self, bundle: FactBundle) -> None:
        text = (
            "Most of your bill is a steady 2.4 kWh a day, which adds up to $290 a year. "
            "The spike only explains 11% of the extra usage and cost $2.60."
        )
        report = verify(text, bundle)
        assert report.passed, report.unverified

    def test_rejects_a_fabricated_dollar_figure(self, bundle: FactBundle) -> None:
        report = verify("Your standing load is costing you about $450 a year.", bundle)
        assert not report.passed
        assert "$450" in report.unverified

    def test_rejects_an_invented_percentage(self, bundle: FactBundle) -> None:
        report = verify("That spike explains 60% of your increase.", bundle)
        assert not report.passed

    def test_allows_reasonable_rounding(self, bundle: FactBundle) -> None:
        # 289.60 -> "$290" is the model being readable, not inventing.
        assert verify("About $290 a year.", bundle).passed

    def test_rejects_rounding_that_moves_the_number(self, bundle: FactBundle) -> None:
        # 289.60 -> "$300" is a different claim.
        assert not verify("About $300 a year.", bundle).passed

    def test_year_in_the_period_is_context_not_a_claim(self, bundle: FactBundle) -> None:
        assert verify("In July 2026 you used 2.4 kWh a day.", bundle).passed

    def test_structural_integers_do_not_fail_the_draft(self, bundle: FactBundle) -> None:
        assert verify("Two things stand out about 2.4 kWh a day.", bundle).passed

    def test_records_every_token_it_checked(self, bundle: FactBundle) -> None:
        report = verify("2.4 kWh a day costs $290 a year.", bundle)
        assert len(report.checked) >= 2


class TestFallback:
    def test_template_uses_only_computed_displays(self, bundle: FactBundle) -> None:
        text = template_fallback(bundle)
        assert verify(text, bundle).passed, "the fallback must never fail its own checker"

    def test_empty_bundle_offers_a_human(self) -> None:
        empty = FactBundle(customer_id="H-JUL", intent=Intent.OUT_OF_SCOPE, period="July 2026")
        assert "someone" in template_fallback(empty).lower()
