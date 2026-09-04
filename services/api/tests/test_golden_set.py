"""KEA-46 / KEA-57 — the golden set, executed as a CI gate.

This is the file that turns *"the model never invents a figure"* from a claim into a
number we can put on a slide. It runs the whole deterministic pipeline — layer 0 routing,
layer 1 analytics, layer 3 verification — against `ml/goldens/golden_set.json`.

**No model runs here, and no database is needed.** That is the point of ADR-0002: because
Python decides and the model only narrates, the three layers that carry the trust claim
are testable with nothing installed. A golden set that needed Ollama would run on one
laptop; this one runs in CI on every pull request.

Layer 2 (the model) is deliberately out of scope. Scoring a real model against these same
cases is the Day 6 bake-off (KEA-47) and belongs in `ml/evals/`. What this file proves is
narrower and more important: *if* a model fabricates a figure, layer 3 catches it.

The set tests both directions on purpose:

* `verification_must_reject` — invented figures are caught. Without these, the headline
  means nothing.
* `verification_must_pass` — legitimate answers survive. Without these, a checker that
  rejected literally everything would score a perfect "0 fabricated figures", which is
  the failure mode nobody would notice until a demo produced no answers at all.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.pipeline import _bundle_for
from app.routing.intents import route
from app.schemas import Intent
from app.verification.number_checker import verify

# services/api/tests -> services/api -> services -> repo root
_GOLDEN = pathlib.Path(__file__).resolve().parents[3] / "ml" / "goldens" / "golden_set.json"

DATA = json.loads(_GOLDEN.read_text())

ROUTING = DATA["routing"]
MUST_PASS = DATA["verification_must_pass"]
MUST_REJECT = DATA["verification_must_reject"]
KNOWN_GAP = DATA["verification_known_gap"]


def _ids(cases: list[dict]) -> list[str]:
    return [c["id"] for c in cases]


def _bundle(case: dict):
    """Rebuild the exact bundle the API would have produced for this case."""
    return _bundle_for(Intent(case["intent"]), case["customer_id"])


# ───────────────────────────── layer 0 + layer 1 ─────────────────────────────


@pytest.mark.parametrize("case", ROUTING, ids=_ids(ROUTING))
def test_routing_and_facts(case: dict) -> None:
    """Each question routes where it should, and gets the facts it should."""
    routing = route(case["question"])
    expected = Intent(case["expect_intent"])
    assert routing.intent is expected, (
        f"{case['id']}: {case['question']!r} routed to {routing.intent.value}, "
        f"expected {expected.value}"
    )

    if "expect_escalation" in case:
        assert routing.is_escalation is case["expect_escalation"], (
            f"{case['id']}: escalation flag wrong — a hardship disclosure that does not "
            f"escalate is a Consumer Care Obligations problem, not a UX one"
        )

    bundle = _bundle_for(routing.intent, case["customer_id"])
    keys = {f.key for f in bundle.facts}

    for key in case.get("expect_facts", []):
        assert key in keys, f"{case['id']}: expected fact {key!r}, got {sorted(keys)}"

    if case.get("expect_empty_bundle"):
        assert not bundle.facts, (
            f"{case['id']}: expected no facts at all, got {sorted(keys)}. "
            f"An intent with no analytics path must return an empty bundle."
        )

    if "expect_caveat_substring" in case:
        needle = case["expect_caveat_substring"]
        joined = " ".join(bundle.caveats)
        assert needle.lower() in joined.lower(), (
            f"{case['id']}: expected a caveat containing {needle!r}. "
            f"Caveats are the only guard on a bundle with no numbers in it."
        )


def test_every_intent_has_golden_cases() -> None:
    """`schemas.Intent` says adding an intent means adding golden-set cases too.

    This asserts that rule instead of trusting it. An intent that is routable but has no
    case here is an intent nobody is checking.
    """
    covered = {Intent(c["expect_intent"]) for c in ROUTING}
    missing = sorted(i.value for i in Intent if i not in covered)
    assert not missing, f"intents with no golden-set case: {missing}"


def test_every_demo_household_is_exercised() -> None:
    """A household serving no case is data nobody is checking."""
    from app.analytics import fixtures

    used = {c["customer_id"] for c in ROUTING}
    missing = sorted(set(fixtures.all_ids()) - used)
    assert not missing, f"demo households with no golden-set case: {missing}"


# ───────────────────────────── layer 3 ─────────────────────────────


@pytest.mark.parametrize("case", MUST_PASS, ids=_ids(MUST_PASS))
def test_legitimate_answers_are_not_rejected(case: dict) -> None:
    """False positives matter as much as false negatives.

    A verifier that rejects correct answers would still report zero fabrications, and
    would quietly turn every demo answer into the template fallback.
    """
    report = verify(case["draft"], _bundle(case))
    assert report.passed, (
        f"{case['id']}: a legitimate answer was rejected. "
        f"unverified={report.unverified} derived={report.derived}. "
        f"Reason this case exists: {case['why']}"
    )


@pytest.mark.parametrize("case", MUST_REJECT, ids=_ids(MUST_REJECT))
def test_fabricated_figures_are_caught(case: dict) -> None:
    """The claim itself. Every one of these drafts contains an invented figure.

    Both rejection lists count. `unverified` holds figures with no matching fact;
    `derived` holds computed *relationships* stated without a number — "doubled", "a
    third". They are reported separately because they are different failures and need
    different corrections on the retry, but from this test's point of view a draft that
    lands in either one was correctly refused.
    """
    report = verify(case["draft"], _bundle(case))
    assert not report.passed, (
        f"{case['id']}: a fabricated figure passed verification. "
        f"Draft: {case['draft']!r}. Why this must fail: {case['why']}"
    )
    refused = [*report.unverified, *report.derived]
    for token in case["must_reject_tokens"]:
        stripped = token.lstrip("$")
        assert any(stripped in u for u in refused), (
            f"{case['id']}: expected {token!r} among the refused tokens, got {refused}"
        )


@pytest.mark.parametrize("case", KNOWN_GAP, ids=_ids(KNOWN_GAP))
def test_known_gaps_still_behave_as_documented(case: dict) -> None:
    """Pins any gap `number_checker.py` admits to, by asserting the CURRENT behaviour —
    so closing one breaks this loudly and the docstring gets updated with the code.

    Empty as of 4 September 2026. The one entry it held (V-201, worded quantities such as
    "doubled" carrying no numeric token) was closed by the derived-claim pass and moved
    into `verification_must_reject` as V-110. An empty list here is the correct state, not
    a missing fixture — add a case when a new gap is knowingly accepted.
    """
    report = verify(case["draft"], _bundle(case))
    assert report.passed, (
        f"{case['id']}: this gap appears to have been closed. That is good news — "
        f"update the known-gap note in app/verification/number_checker.py and move this "
        f"case into verification_must_reject."
    )


# ───────────────────────────── the headline ─────────────────────────────


def test_headline_zero_fabricated_figures(capsys: pytest.CaptureFixture[str]) -> None:
    """KEA-57. Produces the line the pitch quotes, and fails if it is not true.

    Deliberately recomputed here rather than counting the parametrised tests above, so
    the number on the slide comes from one visible calculation a reviewer can follow.
    """
    fabricated_that_got_through: list[str] = []
    legitimate_wrongly_rejected: list[str] = []

    for case in MUST_REJECT:
        if verify(case["draft"], _bundle(case)).passed:
            fabricated_that_got_through.append(case["id"])

    for case in MUST_PASS:
        if not verify(case["draft"], _bundle(case)).passed:
            legitimate_wrongly_rejected.append(case["id"])

    prompts = len(ROUTING)
    drafts = len(MUST_PASS) + len(MUST_REJECT)

    with capsys.disabled():
        print(
            f"\n  golden set: {prompts} prompts routed, {drafts} drafts verified, "
            f"{len(fabricated_that_got_through)} fabricated figures reached the customer"
        )

    assert not fabricated_that_got_through, (
        f"fabricated figures passed verification: {fabricated_that_got_through}"
    )
    assert not legitimate_wrongly_rejected, (
        f"legitimate answers were rejected: {legitimate_wrongly_rejected}"
    )


def test_case_ids_are_unique() -> None:
    """Duplicate ids make a failure report ambiguous."""
    all_ids = _ids(ROUTING) + _ids(MUST_PASS) + _ids(MUST_REJECT) + _ids(KNOWN_GAP)
    dupes = sorted({i for i in all_ids if all_ids.count(i) > 1})
    assert not dupes, f"duplicate golden-set ids: {dupes}"
