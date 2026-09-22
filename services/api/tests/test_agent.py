"""The agent — ADR-0011's claims, as tests.

The old architecture's trust claim was *"the model cannot state a figure Python did not
compute"*, and it was enforced by never letting the model see any data. That is a strong
guarantee and it cost the product its ability to explain anything: the same closed set of
26 keyword-routed intents answered every question, and everything outside it came back as
an offer to connect the customer with the team.

The claim is now *"every figure traces to a row the model actually read, and the read is
recorded"*. That is weaker in one direction and stronger in another, and this file tests
the parts that must hold for it to mean anything:

1. **Scope.** No tool argument can name another household. This is the one property that
   must not depend on prompting.
2. **Provenance.** Every tool result carries a source, and the trace records what was
   read rather than what we intended to compute.
3. **Honesty about gaps.** A tool with no data says so; it never substitutes a plausible
   figure, an average, or another household's number.
4. **The loop.** Tool results reach the next round, failures do not end the turn, and the
   round cap still produces an answer.

(3) and (4) also live partly in `test_evidence_gaps.py`, which owns the degradation
policy. This file owns the tools and the catalogue.
"""

from __future__ import annotations

import json

import pytest
from fakes import ScriptedProvider

from app.agent.loop import answer_once, run_agent
from app.agent.prompts import SYSTEM
from app.agent.tools import TOOL_NAMES, TOOL_SCHEMAS, dispatch
from app.analytics import fixtures
from app.analytics.engine import DEFAULT_UNIT_PRICE_NZD
from app.pipeline import build_context

#: A plausible value per declared type, so the sweep can call a tool that has a required
#: argument without the test carrying a hand-maintained list of names. Derived from the
#: schema rather than hardcoded: a new required argument should be exercised by the sweep
#: automatically, not silently skipped until somebody remembers to add it here.
_SAMPLE_BY_TYPE = {"string": "unsure", "integer": 1, "number": 1.0, "boolean": True}


def _minimal_args(tool: dict) -> dict:
    schema = tool["input_schema"]
    properties = schema.get("properties") or {}
    return {
        name: _SAMPLE_BY_TYPE.get(str(properties[name].get("type", "string")), "unsure")
        for name in schema.get("required") or []
    }


@pytest.fixture
async def ctx():
    return await build_context("H-JUL")


# ---------- scope: the one thing that must not be a matter of prompting ----------


def test_no_tool_accepts_a_household_identifier() -> None:
    """`customer_id` is bound from the authenticated request and is never a parameter.

    If a tool ever grows an account argument, a prompt injection in a customer's own
    message becomes a route into somebody else's meter data. There is no wording of a
    system prompt that reliably prevents that, so the schema must make it unsayable.
    """
    forbidden = {
        "customer_id", "account", "account_number", "account_id",
        "icp", "icp_id", "household",
    }
    for tool in TOOL_SCHEMAS:
        params = set(tool["input_schema"].get("properties") or {})
        overlap = params & forbidden
        assert not overlap, (
            f"{tool['name']} exposes {overlap} — the model must not choose a household"
        )


async def test_a_tool_cannot_be_pointed_at_another_household(ctx) -> None:
    """And passing one anyway is an error, not a silent switch."""
    result = await dispatch(ctx, "get_daily_usage", {"customer_id": "H-COLD"})
    assert "error" in result, "an unknown argument must be refused, not ignored"

    clean = await dispatch(ctx, "get_daily_usage", {})
    assert clean["totals"]["day_count"] == len(ctx.usage.window.daily_kwh)


# ---------- the catalogue ----------


def test_every_schema_is_well_formed_and_dispatchable() -> None:
    """A tool the model can see but not call is worse than one that does not exist —
    it spends a round finding out."""
    from app.agent.tools import _ASYNC, _SYNC

    for tool in TOOL_SCHEMAS:
        assert tool["name"] in (_SYNC | _ASYNC), f"{tool['name']} has no implementation"
        assert tool["input_schema"]["type"] == "object"
        # The description is what the model routes on. A one-liner that says what the
        # tool returns but not when to reach for it is why models pick the wrong one.
        assert len(tool["description"]) > 120, f"{tool['name']}: description too thin to route on"

    assert {t["name"] for t in TOOL_SCHEMAS} == TOOL_NAMES


def test_every_array_parameter_declares_its_element_type() -> None:
    """Gemini rejects an ARRAY parameter with no `items` — and rejects the whole request.

    Found the hard way: `update_alert_settings` shipped `turn_on` as a bare array, and the
    result was 400 INVALID_ARGUMENT on every turn, naming one field and taking the entire
    tool catalogue down with it. Anthropic and Ollama both accept the array without
    `items`, so the failure is invisible on two of the three providers and total on the
    third.

    Asserted over the schemas rather than by calling a provider, because the schemas are
    the thing that has to be right and the provider that punishes this is the one no test
    can reach without a network and a key.
    """
    for tool in TOOL_SCHEMAS:
        for name, spec in (tool["input_schema"].get("properties") or {}).items():
            if spec.get("type") == "array":
                assert "items" in spec, (
                    f"{tool['name']}.{name} is an array with no `items` — Gemini will "
                    f"reject the whole catalogue"
                )
                assert spec["items"].get("type"), f"{tool['name']}.{name}: items has no type"


def test_the_gemini_translator_carries_items_through() -> None:
    """The other half of the same bug.

    A correct JSON Schema was being made invalid on the way out: `_declaration` mapped only
    `type` and `description`, so `items` was dropped and the error named a field that was
    present in the source. Fixing the schema alone would have left the next array parameter
    to rediscover it.
    """
    pytest.importorskip("google.genai")
    from app.providers.gcp import GCPProvider

    declaration = GCPProvider._declaration(
        {
            "name": "probe",
            "description": "x",
            "input_schema": {
                "type": "object",
                "properties": {"names": {"type": "array", "items": {"type": "string"}}},
                "required": [],
            },
        }
    )
    array = declaration.parameters.properties["names"]
    assert str(array.type).upper().endswith("ARRAY")
    assert array.items is not None, "items was dropped in translation"


#: Tools that change something. Excluded from the read sweep below, because "called with
#: no arguments" is a legitimate error for a write — `update_alert_settings` with nothing to
#: set must refuse rather than guess at what the customer meant, and a sweep that forbade
#: error results would be asserting the opposite. They get their own sweep underneath.
WRITE_TOOLS = frozenset({"update_alert_settings", "request_plan_change"})


@pytest.mark.parametrize("customer_id", fixtures.all_ids())
async def test_every_tool_answers_for_every_demo_household(customer_id: str) -> None:
    """No tool may raise, and none may return an empty result.

    `available: false` with a reason is a first-class answer — the fixtures genuinely have
    no plan, no bills and no hourly profile. What must never happen is an exception (which
    costs a round) or a bare empty dict (which the model reads as "nothing to say" and
    fills in for itself).
    """
    ctx = await build_context(customer_id)
    for tool in TOOL_SCHEMAS:
        if tool["name"] in WRITE_TOOLS:
            continue
        result = await dispatch(ctx, tool["name"], _minimal_args(tool))

        assert result, f"{tool['name']} returned nothing for {customer_id}"
        assert "error" not in result, f"{tool['name']} errored on {customer_id}: {result}"
        json.dumps(result, default=str)  # must survive the wire to the model

        if result.get("available") is False:
            assert result.get("reason"), (
                f"{tool['name']} declined without saying why — the model needs the reason "
                f"to tell the customer what is missing rather than guessing"
            )


@pytest.mark.parametrize("customer_id", fixtures.all_ids())
async def test_a_write_tool_refuses_an_empty_call_rather_than_guessing(
    customer_id: str,
) -> None:
    """The other half of the sweep above, with the assertion inverted.

    A write tool called with nothing to write is the shape of a model that has decided to
    act before it worked out what the customer wanted. It must come back as a readable
    error the model can recover from — never a silent no-op, and never an exception, which
    `dispatch` would flatten into the same shape and hide.
    """
    ctx = await build_context(customer_id)
    for name in sorted(WRITE_TOOLS):
        result = await dispatch(ctx, name, {})

        assert result, f"{name} returned nothing"
        json.dumps(result, default=str)
        assert "error" in result or result.get("available") is False, (
            f"{name} accepted an empty call — a write with nothing to write must refuse"
        )
        # And the refusal has to be actionable. "Invalid" tells the model nothing; the
        # message is the only thing standing between a bad call and a repeated bad call.
        message = result.get("error") or result.get("reason") or ""
        assert len(message) > 20, f"{name} refused without saying why: {result}"


@pytest.mark.parametrize("customer_id", fixtures.all_ids())
async def test_available_results_name_their_source(customer_id: str) -> None:
    """The provenance claim, enforced. A figure whose origin cannot be stated is exactly
    the kind of number this product exists to refuse."""
    ctx = await build_context(customer_id)
    by_name = {t["name"]: t for t in TOOL_SCHEMAS}
    # Neither of these returns data — one signals an escalation, the other records an
    # answer — so there is no source to assert on.
    for name in sorted(TOOL_NAMES - {"handoff_to_human", "answer_clarifying_question"}):
        result = await dispatch(ctx, name, _minimal_args(by_name[name]))
        if result.get("available"):
            assert result.get("source"), f"{name} returned data with no source"


# ---------- honesty about gaps ----------


async def test_no_hourly_profile_for_the_seeded_households(ctx) -> None:
    """The refusal that was correct and was being applied too widely.

    The demo households store one synthetic 48-interval shape scaled by each day's total,
    so a "peak hour" read off it is a constant presented as an observation. The tool
    declines and tells the model to stay at day resolution. The mart accounts carry a
    real per-ICP profile and are not covered by this — that is the point of it being a
    tool result rather than a blanket rule in the prompt.
    """
    result = await dispatch(ctx, "get_hourly_profile", {})
    assert result["available"] is False
    assert "do not name an hour" in result["reason"].lower()


async def test_a_household_with_no_bills_says_so_rather_than_estimating(ctx) -> None:
    result = await dispatch(ctx, "get_bill_comparison", {})
    assert result["available"] is False
    assert "no billed period" in result["reason"]
    # Nothing numeric may leak out of a declined lookup.
    assert not any(k for k in result if k in {"current_bill", "drivers", "change"})


async def test_the_peer_baseline_never_comes_from_the_household_itself(ctx) -> None:
    """Deriving it from the household once inflated a spike's apparent share from 11% to
    71%. The cohort definition is returned alongside the figure so the answer can say
    what it is comparing against."""
    result = await dispatch(ctx, "compare_to_similar_homes", {})
    assert result["comparable_homes_kwh_per_day"] != result["this_household_kwh_per_day"]
    assert "excluding this household" in result["cohort_definition"]
    assert "NOT a New Zealand average" in result["guidance"]


async def test_the_fixture_label_is_not_offered_as_a_persons_name(ctx) -> None:
    """An earlier version greeted somebody with "Hi Cold-snap driven, not behaviour,".

    `label` on a demo household is a description of the scenario. There is no name to
    fall back to — `models.Customer` deliberately holds none — so it is passed through
    labelled as what it is.
    """
    summary = await dispatch(ctx, "get_account_summary", {})
    assert "customer_name" not in summary
    assert summary["household_description"]
    assert "NOT a person's name" in summary["name_note"]


async def test_dollar_figures_carry_the_applicable_rate_disclosure(ctx) -> None:
    """Every surface quoting dollars identifies the rate and its billing limits.

    The plan catalogue now contains Kea's published prices, while accounts without an
    invoice use the published Anytime energy rate without pretending that energy-only
    arithmetic is a complete bill. Keep those two disclosures distinct.
    """
    plans = await dispatch(ctx, "get_plan_options", {})
    assert "Kea's published plan rates" in plans["tariff_note"]
    assert "GST-inclusive" in plans["tariff_note"]

    expected_rate = f"{DEFAULT_UNIT_PRICE_NZD * 100:.1f}c/kWh"
    for name in ("project_this_bill", "get_daily_usage"):
        result = await dispatch(ctx, name, {})
        assert expected_rate in result["tariff_note"]
        assert "not a bill total" in result["tariff_note"]


# ---------- the loop ----------


async def test_the_model_is_given_the_catalogue_and_the_system_prompt(ctx) -> None:
    provider = ScriptedProvider(rounds=[])
    await answer_once(provider, ctx, "hello")

    call = provider.calls[0]
    assert call["system"] == SYSTEM
    assert {t["name"] for t in call["tools"]} == TOOL_NAMES

    # One user turn, carrying the question and the pre-loaded account summary. The
    # summary rides on the user turn rather than as a synthetic assistant tool-call pair
    # because Gemini 3.x requires a `thought_signature` on every functionCall part in
    # history and a call the model never made has none — see `run_agent`.
    (turn,) = call["messages"]
    assert turn["role"] == "user"
    assert turn["content"].endswith("hello")
    assert "account summary" in turn["content"]


async def test_tool_results_are_appended_in_the_neutral_shape(ctx) -> None:
    """Every provider translates this; none may mutate it. A drift here shows up as one
    provider silently losing tool results, which reads as that model being worse."""
    provider = ScriptedProvider(rounds=[[("get_account_summary", {})]])
    await answer_once(provider, ctx, "what plan am I on?")

    second = provider.calls[1]["messages"]
    assert second[0]["role"] == "user"
    assert second[1]["role"] == "assistant" and second[1]["tool_calls"]
    assert second[2]["role"] == "tool"
    assert second[2]["name"] == "get_account_summary"
    assert second[2]["tool_call_id"] == second[1]["tool_calls"][0].id
    assert isinstance(second[2]["content"], dict), "results stay structured until the provider"


async def test_conversation_history_reaches_the_model(ctx) -> None:
    """A follow-up needs the turn before it to resolve against.

    The old pipeline had no history at all — every question was routed and answered in
    isolation, so "what about last month?" was re-answered as if it were the first thing
    asked.
    """
    provider = ScriptedProvider(rounds=[])
    history = [
        {"role": "user", "content": "why is my bill so high?"},
        {"role": "assistant", "content": "Mostly a steady overnight load."},
    ]
    await answer_once(provider, ctx, "what about last month?", history)

    messages = provider.calls[0]["messages"]
    assert len(messages) == 3
    assert messages[-1]["content"] == "what about last month?"


async def test_escalation_is_the_models_call_and_reaches_the_result(ctx) -> None:
    """Hardship used to be a keyword match on the question, decided before anything had
    read the account. It is now a tool the model calls while holding the data — and
    calling it does not end the turn, so the customer still gets their explanation."""
    provider = ScriptedProvider(
        rounds=[[("handoff_to_human", {"reason": "customer says they cannot afford the bill"})]],
        answer="I'm putting you through to someone who can help with payment options.",
    )
    result = await answer_once(provider, ctx, "I can't pay this bill")

    assert result.escalate is True
    assert "cannot afford" in result.escalation_reason
    assert result.text, "an escalating turn must still say something to the customer"


async def test_the_stream_discards_the_preamble_of_a_lookup_round(ctx) -> None:
    """Models narrate before reaching for a tool. That text is not the answer, and a
    client that kept it would show "Let me check that." glued to the front of every
    reply."""

    provider = ScriptedProvider(rounds=[[("get_daily_usage", {})]])
    seen = [type(e).__name__ async for e in run_agent(provider, ctx, "how much did I use?")]

    assert seen.index("TurnDiscarded") < seen.index("ToolStarted")
    assert seen.count("Thinking") >= 2, "text from both rounds should have streamed"
    assert seen[-1] == "Finished"


# ---------- the prompt ----------


def test_the_prompt_forbids_the_deflection_that_started_all_this() -> None:
    """The single sentence customers kept seeing.

    It came from the out-of-scope intent's task instruction ("offer to connect them with
    the team") and from the empty-bundle caveat, and anything the keyword router did not
    recognise landed on one or the other. Both are gone; this asserts the replacement
    forbids the behaviour rather than merely not asking for it — the phrase does appear
    in the prompt, inside the sentence banning it, which is the point.
    """
    assert "Never end by offering to connect them with the team" in SYSTEM
    assert "unless you are genuinely handing over" in SYSTEM
    # And the partial answer that should be given instead is spelled out, because
    # "don't deflect" with no alternative is a rule a model satisfies by waffling.
    assert "answer the part you can" in SYSTEM


def test_the_prompt_no_longer_bans_arithmetic() -> None:
    """The old rules — never calculate, never compare in words, 2 to 4 sentences — were
    right for a model that could not see the data and are wrong for one that can. A bill
    explanation that may not characterise the size of anything is a list of numbers."""
    assert "Never calculate" not in SYSTEM
    assert "Do the arithmetic" in SYSTEM
    assert "2 to 4 sentences" not in SYSTEM


def test_the_prompt_keeps_the_constraints_that_are_true_about_the_data() -> None:
    """These are not style rules and they did not go with the pipeline. One meter reads
    one number for the whole house; that does not become false because the model improved."""
    assert "cannot identify appliances" in SYSTEM
    assert "controlled load" in SYSTEM.lower()
    assert "handoff_to_human" in SYSTEM

    # The prompt used to pin the phrase "illustrative 30c". That constraint was true
    # while the rates were invented; the catalogue is Kea's published one now, and the
    # standing instruction is the opposite — quote the price as real, and say that a
    # figure derived from the unit rate excludes the daily charge. Asserting the old
    # wording would hold the prompt to a disclaimer that is no longer accurate.
    assert "Anytime Rate" in SYSTEM
    assert "daily charge" in SYSTEM.lower()
    assert "illustrative" not in SYSTEM.lower()
