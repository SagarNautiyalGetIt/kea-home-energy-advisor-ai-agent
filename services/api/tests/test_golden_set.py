"""KEA-46 / KEA-57 — the golden set, executed as a CI gate. **Offline path.**

This runs the analytics and the number-checker against `ml/goldens/golden_set.json` with
no model and no database, which is what lets it run in CI on every pull request rather
than on one laptop with Ollama installed.

## What it covers now, and what it stopped covering

It used to open with layer 0: each question was fed to the keyword router and asserted to
land on the right intent, 56 cases of it. **That is gone with the router** (ADR-0011) —
the agent reads the question rather than classifying it, so there is nothing to assert a
routing decision about. The `routing` block in the JSON is kept and still exercised, but
for what remains true of it: each `(intent, customer_id)` pair must still build the
bundle it claims to, because `app/analytics/bundles.py` still builds those for the
offline pack.

The verification half is unchanged and still meaningful, because the offline path is
still narrate-only: a device with no connection gets a fixed bundle and a small local
model, and a token-by-token check against that bundle is exactly the right control there.
See `app/analytics/bundles.py` for why offline keeps the architecture the server dropped.

Both directions, on purpose:

* `verification_must_reject` — invented figures are caught. Without these, the headline
  means nothing.
* `verification_must_pass` — legitimate answers survive. Without these, a checker that
  rejected literally everything would score a perfect "0 fabricated figures", which is
  the failure mode nobody would notice until a demo produced no answers at all.

The agent path is covered by `test_agent.py`, and its trust claim is a different one:
not "no figure outside the bundle" but "every figure traces to a recorded tool result".
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.analytics.bundles import bundle_for as _bundle_for
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


# ───────────────────────────── the offline bundles ─────────────────────────────


@pytest.mark.parametrize("case", ROUTING, ids=_ids(ROUTING))
def test_bundle_for_intent_and_household(case: dict) -> None:
    """Each (intent, household) builds the facts and caveats it claims to.

    The routing assertion this used to open with is gone with the router — see the module
    docstring. `case["question"]` is left in the JSON because it documents what each
    intent is *for*, and because the agent-path eval in `ml/evals/` reads the same file.
    """
    bundle = _bundle_for(Intent(case["expect_intent"]), case["customer_id"])
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
    """Every intent the offline pack can precompute has a case here.

    Asserts the rule instead of trusting it: an intent with no case is one nobody is
    checking, and the offline pack is the one place where a bad bundle reaches a customer
    with no server-side tool result to contradict it.
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

    bundles = len(ROUTING)
    drafts = len(MUST_PASS) + len(MUST_REJECT)

    with capsys.disabled():
        print(
            f"\n  golden set (offline path): {bundles} bundles built, {drafts} drafts "
            f"verified, {len(fabricated_that_got_through)} fabricated figures reached "
            f"the customer"
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
