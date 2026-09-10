"""The architecture rule, tested directly: the model may read the data, never compute on it.

Everything else in this repository is downstream of this. If these fail, the product's
central claim — *"the numbers are calculated by code; the AI only writes the sentence"* —
is not true, whatever the docs say.

The rule has two halves and both are tested here:

* **Remove the operands.** No bundle, no prompt and no offline pack may carry a raw
  series. You cannot ask a language model not to do arithmetic; you can only decline to
  hand it the numbers to do arithmetic with.
* **Catch the residue.** A model given seven scalars can still divide two of them in its
  head and write "twice as much". Layer 3 rejects the result.
"""

from __future__ import annotations

import pytest

from app.analytics import fixtures
from app.analytics.bundles import bundle_for as _bundle_for
from app.analytics.repository import UsageContext
from app.narration.prompts import SYSTEM, build_user_prompt
from app.offline import OFFLINE_INTENTS, PackBuilder
from app.schemas import Fact, FactBundle, Intent
from app.verification.number_checker import verify


def context(customer_id: str = "H-JUL") -> UsageContext:
    hdd, normal = fixtures.heating_degree_days(customer_id)
    return UsageContext(
        window=fixtures.get_window(customer_id),
        baseline=fixtures.comparison_baseline(customer_id),
        label=fixtures.label(customer_id),
        hdd=hdd,
        normal_hdd=normal,
    )


def bundle_with(*facts: Fact) -> FactBundle:
    return FactBundle(
        customer_id="H-JUL", intent=Intent.WHY_HIGH, period="July 2026", facts=list(facts)
    )


# ───────────────── half one: the model is never given operands ─────────────────


@pytest.mark.parametrize("intent", list(Intent))
def test_no_bundle_carries_a_raw_series(intent: Intent):
    """The structural half of the guarantee.

    Every `Fact.value` is a scalar. A list on a bundle is a set of readings the model
    could be asked to total, and the first time someone adds `daily_kwh` "so the model
    can see the shape", the no-arithmetic property is gone.
    """
    bundle = _bundle_for(intent, "H-JUL")
    for fact in bundle.facts:
        assert isinstance(fact.value, int | float), f"{intent}:{fact.key} is {type(fact.value)}"
        assert not isinstance(fact.value, bool)


@pytest.mark.parametrize("intent", list(Intent))
def test_the_prompt_contains_no_sequence_of_numbers(intent: Intent):
    """The rendered prompt is what the model actually sees, so it is what has to be
    checked. A bundle could be scalar-only and still be rendered into a comma-separated
    run of figures by a careless `render_for_prompt`."""
    prompt = build_user_prompt(_bundle_for(intent, "H-JUL"), "why is my bill so high?")

    import re

    runs = re.findall(r"(?:\d+(?:\.\d+)?\s*,\s*){3,}\d+", prompt)
    assert not runs, f"{intent}: prompt carries a numeric series: {runs}"


def test_the_system_prompt_forbids_worded_comparison():
    """The instruction has to exist even though the verifier is what enforces it —
    a rejected draft costs a regeneration, and the cheapest fix is not writing it."""
    assert "twice" in SYSTEM
    assert "calculating" in SYSTEM


def test_the_offline_pack_carries_no_readings_either():
    """The platform where this is hardest to audit.

    A phone holding `daily_kwh` and a 1B model is a phone that can be asked "add these
    up", which is the single thing small models are worst at, on the question where a
    wrong answer destroys the product's claim.
    """
    pack = PackBuilder(system_prompt=SYSTEM).build("H-JUL", context())
    serialised = pack.model_dump_json()

    assert "daily_kwh" not in serialised
    for answer in pack.answers:
        for fact in answer.bundle.facts:
            assert isinstance(fact.value, int | float)


def test_the_offline_pack_covers_every_intent_it_claims_to():
    pack = PackBuilder(system_prompt=SYSTEM).build("H-JUL", context())
    assert {a.intent for a in pack.answers} == set(OFFLINE_INTENTS)


def test_hardship_is_deliberately_absent_from_the_offline_pack():
    """The most important omission in the whole feature.

    A household in payment difficulty needs a person, and the route to one runs over the
    network. An offline model producing a warm, self-contained reply about payment
    options would *replace* that handoff with a dead end — the customer would feel heard
    and nobody would be told.
    """
    assert Intent.HARDSHIP not in OFFLINE_INTENTS
    pack = PackBuilder(system_prompt=SYSTEM).build("H-JUL", context())
    assert Intent.HARDSHIP not in {a.intent for a in pack.answers}


def test_every_offline_answer_has_a_verified_template_fallback():
    """A device whose model fails or whose verification rejects the draft must not be
    left with nothing. The template is computed server-side, so the fallback is itself
    made of checked figures."""
    pack = PackBuilder(system_prompt=SYSTEM).build("H-JUL", context())
    for answer in pack.answers:
        assert answer.template.strip()
        assert verify(answer.template, answer.bundle).passed


# ───────────────── half two: the residue is caught ─────────────────


@pytest.mark.parametrize(
    "draft",
    [
        "Your heating is using double what similar homes use.",
        "That is twice the usual amount.",
        "Your standing load is about a third of the total.",
        "Usage has roughly halved since the start of the cycle.",
        "It is three times what a comparable home spends.",
        "Your bill is 2.5 times higher than expected.",
    ],
)
def test_a_worded_comparison_is_refused_when_no_fact_supports_it(draft: str):
    """Each of these is a division the model performed. None contains a figure that a
    token-by-token check could catch — which is exactly why this class existed as a
    documented gap for as long as it did."""
    report = verify(draft, bundle_with(Fact.money("total_cost", 180.0, "Total")))
    assert not report.passed
    assert report.derived


def test_a_worded_comparison_is_allowed_when_a_ratio_fact_supports_it():
    """Layer 1 computing the ratio and handing it over is the intended path. Banning the
    word outright would forbid a correct sentence built from a real figure."""
    report = verify(
        "Saturday used double a normal day.",
        bundle_with(Fact.ratio("saturday_vs_normal", 2.0, "Saturday against a normal day")),
    )
    assert report.passed, report.derived


def test_a_percentage_fact_licenses_the_equivalent_fraction():
    """A bundle carrying 33% genuinely does support "a third". Rejecting that would fail
    a true sentence, and false positives cost as much as false negatives — every one
    turns a good answer into the template fallback."""
    report = verify(
        "The spikes are about a third of the increase.",
        bundle_with(Fact.percent("spike_share", 33.0, "Share explained by spikes")),
    )
    assert report.passed, report.derived


def test_half_hourly_is_not_a_magnitude_claim():
    """The false positive that broke the entire `what_costs_most` intent on the first
    version of this check. "Half-hourly meter data" is the phrase in the standard
    appliance refusal, so it appears in almost every honest answer the product gives."""
    report = verify(
        "I can't tell which appliance that is from half-hourly meter data.",
        bundle_with(Fact.energy("standing_load", 4.1, "Standing load", per_day=True)),
    )
    assert report.passed, report.derived


@pytest.mark.parametrize(
    "draft,expected",
    [
        ("That is about twenty dollars more.", "twenty dollars"),
        ("You used fifteen kilowatt hours on Saturday.", "fifteen kilowatt hours"),
        ("It is thirty percent above normal.", "thirty percent"),
    ],
)
def test_a_quantity_spelled_out_is_still_a_figure(draft: str, expected: str):
    """Writing a number as a word does not make it traceable to a fact."""
    report = verify(draft, bundle_with(Fact.money("total_cost", 180.0, "Total")))
    assert not report.passed
    assert any(expected in token for token in report.unverified)


def test_a_number_word_without_a_unit_is_prose():
    """"Two things to note" is structure, not a claim. Matching the bare word would
    reject every sentence containing "one"."""
    report = verify(
        "There are two things worth knowing about your bill.",
        bundle_with(Fact.money("total_cost", 180.0, "Total")),
    )
    assert report.passed


def test_the_two_failure_classes_are_reported_separately():
    """They need different corrections on the retry. "That figure is not in your data"
    tells a model to re-read the list; a model that wrote "double" is looking at two
    correct figures and dividing them, and re-reading the list does not address that."""
    report = verify(
        "Your bill of $412 is double what similar homes spend.",
        bundle_with(Fact.money("total_cost", 180.0, "Total")),
    )
    assert "412" in " ".join(report.unverified)
    assert "double" in " ".join(report.derived)
    assert not report.passed
