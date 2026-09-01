"""Two defects the merge surfaced, pinned so they cannot come back.

Both were invisible from the outside: the recorder swallows its own failures by design
(a customer's answer must not depend on the evidence write succeeding), and
`provider_error` defaulted to False everywhere. So the evidence tables were silently
empty and an outage was indistinguishable from a clean verification run.
"""

from __future__ import annotations

import pytest

from app.analytics import fixtures
from app.db.recorder import DatabaseRecorder
from app.pipeline import _bundle_for
from app.schemas import Intent, VerificationReport


def test_the_recorder_can_build_a_citation() -> None:
    """`DatabaseRecorder._citation` was referenced and never written, so every single
    evidence write raised AttributeError — caught, logged, and swallowed. The tables
    stayed empty while `/health` cheerfully reported `recording: database`."""
    bundle = _bundle_for(Intent.WHY_HIGH, "H-JUL")
    citation = DatabaseRecorder._citation(bundle)

    assert citation is not None
    assert citation["household"] == "H-JUL"
    assert citation["fact_keys"], "a citation with no keys cites nothing"
    assert citation["intent"] == Intent.WHY_HIGH.value


def test_the_citation_carries_keys_but_never_values() -> None:
    """`fact_bundle` is the full receipt; this is the panel the customer sees. Values
    belong in the receipt — duplicating them here means two places to keep correct."""
    bundle = _bundle_for(Intent.WHY_HIGH, "H-JUL")
    citation = DatabaseRecorder._citation(bundle)

    assert "fact_keys" in citation
    assert "facts" not in citation
    assert all(isinstance(k, str) for k in citation["fact_keys"])


def test_a_bundle_with_no_facts_cites_nothing_rather_than_empty() -> None:
    """A hardship reply carries no figures by design. `{}` renders as a transparency
    panel asserting we cited nothing; None renders as no panel."""
    assert DatabaseRecorder._citation(_bundle_for(Intent.HARDSHIP, "H-DROP")) is None


def test_provider_error_is_on_the_report_schema() -> None:
    """The column existed in the database and the field did not exist on the wire, so
    the recorder wrote False for every outage."""
    assert VerificationReport(passed=True).provider_error is False
    assert VerificationReport(passed=True, provider_error=True).provider_error is True


async def test_an_unreachable_model_is_marked_provider_error_not_a_rejection() -> None:
    """The distinction the whole evidence table turns on.

    A day Ollama was down must not read as a day the number-checker caught six
    fabrications — that is the opposite claim, and the flattering one.
    """
    from app.narration.narrator import narrate_verified

    class DeadProvider:
        name = "dead"
        model = "none"

        async def narrate(self, **_kwargs):
            raise ConnectionError("all connection attempts failed")
            yield ""  # pragma: no cover - makes this an async generator

    bundle = _bundle_for(Intent.WHY_HIGH, "H-JUL")
    text, report = await narrate_verified(DeadProvider(), bundle, "why is my bill high?")

    assert report.provider_error is True, "an outage was recorded as a checker rejection"
    assert report.fell_back_to_template is True
    assert report.unverified == [], "nothing was checked, so nothing can be unverified"
    assert text, "the customer still gets an answer built from verified facts"


@pytest.mark.parametrize("customer_id", fixtures.all_ids())
async def test_a_clean_template_fallback_is_not_a_provider_error(customer_id: str) -> None:
    """The other direction: `provider_error` must stay False when the model answered."""
    from app.narration.narrator import narrate_verified

    class HonestProvider:
        name = "honest"
        model = "test"

        async def narrate(self, **_kwargs):
            # Contains no numeric token, so the checker passes it unchanged.
            yield "Here is what I can see about your usage."

    bundle = _bundle_for(Intent.WHY_HIGH, customer_id)
    _text, report = await narrate_verified(HonestProvider(), bundle, "why?")
    assert report.provider_error is False
