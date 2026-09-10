"""The in-chat charts.

The property under test throughout is **traceability**: every number a chart plots must
already exist in the tool result it was built from. That is not a style rule. The chart
sits beside prose the customer is reading about their own money, under a product whose
whole claim is that its figures come from their data and can be traced back to it. A
chart that computed anything — a percentage, a total, a difference — would be a figure
with no lookup behind it, on the one screen where that is the thing being promised.

`test_no_chart_invents_a_number` asserts it structurally rather than case by case, so a
builder added later is covered without anybody remembering to extend this file.

The rest is about silence. Most turns have no chart, and the failure that matters is not
a missing picture but a misleading one: an axis drawn next to "I have no data for that",
a forecast whose two bars are the same number, a plan comparison with one plan in it.
Each of those is a test below, because each renders as a confident-looking answer.
"""

from __future__ import annotations

import pytest

from app.charts import chart_for


def _values(node) -> list[float]:
    """Every number anywhere in a tool result, flattened."""
    if isinstance(node, bool):
        return []
    if isinstance(node, (int, float)):
        return [round(float(node), 2)]
    if isinstance(node, dict):
        return [v for item in node.values() for v in _values(item)]
    if isinstance(node, list):
        return [v for item in node for v in _values(item)]
    return []


BILL_COMPARISON = {
    "available": True,
    "current_bill": {"period": "June 2024", "total_nzd": 208.93},
    "prior_bill": {"period": "May 2024", "total_nzd": 142.43},
    "source": "kea.mart_bill_explanation",
}

PLAN_OPTIONS = {
    "available": True,
    "period": "June 2024",
    "options": [
        {"name": "Kea Day & Night", "cost_over_this_period_nzd": 268.45, "is_current_plan": True},
        {"name": "Kea Standard", "cost_over_this_period_nzd": 232.75, "is_current_plan": False},
        {"name": "Low Fixed Charge", "cost_over_this_period_nzd": 234.30, "is_current_plan": False},
    ],
    "source": "app/analytics/plans.py",
}

SIMILAR_HOMES = {
    "available": True,
    "this_household_kwh_per_day": 20.86,
    "comparable_homes_kwh_per_day": 11.8,
    "guidance": "not a verdict on how they live",
    "source": "peer cohort",
}

PROJECTION = {
    "available": True,
    "days_remaining": 20,
    "cost_so_far_nzd": 53.97,
    "projected_cycle_cost_nzd": 154.92,
    "source": "app/analytics/forecast.py",
}

ALL_CHARTABLE = [
    ("get_bill_comparison", BILL_COMPARISON),
    ("get_plan_options", PLAN_OPTIONS),
    ("compare_to_similar_homes", SIMILAR_HOMES),
    ("project_this_bill", PROJECTION),
]


# ───────────────────────────── the guarantee ─────────────────────────────


@pytest.mark.parametrize(("tool", "result"), ALL_CHARTABLE, ids=[t for t, _ in ALL_CHARTABLE])
def test_no_chart_invents_a_number(tool: str, result: dict) -> None:
    """Every plotted value is already somewhere in the tool's own result.

    This is the module's whole contract. A builder that averaged two figures, or turned
    a pair into a percentage, would put a number on the customer's screen that no
    recorded lookup produced — and `app.agent_tool_call` would have no row to justify it
    if the answer were ever disputed.
    """
    spec = chart_for(tool, result)
    assert spec is not None
    available = _values(result)
    for point in spec.points:
        assert point.value in available, (
            f"{tool} plotted {point.value} ({point.label!r}), which is not in its result. "
            "Charts may select figures the tool computed; they may not compute their own."
        )


@pytest.mark.parametrize(("tool", "result"), ALL_CHARTABLE, ids=[t for t, _ in ALL_CHARTABLE])
def test_every_chart_carries_its_source(tool: str, result: dict) -> None:
    """The chart is shown with provenance or not at all — same rule as the prose."""
    spec = chart_for(tool, result)
    assert spec is not None
    assert spec.source, "a chart with no source cannot be checked by the person reading it"


# ───────────────────────────── knowing when to say nothing ─────────────────────────────


def test_an_unavailable_lookup_draws_nothing() -> None:
    """`available: false` is a real answer, and the prose says so in words.

    An empty axis beside "I don't have that for your account" implies data that is not
    there, which is a worse failure than the missing picture.
    """
    assert chart_for("get_bill_comparison", {"available": False, "reason": "no prior bill"}) is None


def test_a_tool_with_no_chart_is_not_an_error() -> None:
    """Most lookups answer in words. Returning None is the common path, not a failure."""
    assert chart_for("search_help_topics", {"available": True, "articles": []}) is None
    assert chart_for("handoff_to_human", {"available": True}) is None


def test_a_finished_cycle_has_nothing_to_project() -> None:
    """At the end of a cycle "so far" and "projected" are the same number, and two bars
    of identical height read as a forecast that was made and confirmed rather than a
    period that is simply over."""
    assert chart_for("project_this_bill", {**PROJECTION, "days_remaining": 0}) is None


def test_a_single_plan_is_not_a_comparison() -> None:
    """One bar labelled "your plan" answers nothing — the question is *against what*."""
    one = {**PLAN_OPTIONS, "options": PLAN_OPTIONS["options"][:1]}
    assert chart_for("get_plan_options", one) is None


def test_a_missing_figure_drops_its_point_rather_than_plotting_zero() -> None:
    """A tool returns None for a figure it could not work out. Plotted, that becomes a
    bar of height zero, which reads as "you spent nothing" instead of "we don't know"."""
    result = {**BILL_COMPARISON, "prior_bill": {"period": "May 2024", "total_nzd": None}}
    assert chart_for("get_bill_comparison", result) is None


# ───────────────────────────── shape ─────────────────────────────


def test_the_current_plan_is_marked_but_not_reordered() -> None:
    """Cheapest first, with the plan they are on highlighted in place.

    Where their plan sits in that order *is* the answer to "is there a better one" —
    moving it to the top would hide it.
    """
    spec = chart_for("get_plan_options", PLAN_OPTIONS)
    assert spec is not None
    assert [p.value for p in spec.points] == sorted(p.value for p in spec.points)
    (current,) = [p for p in spec.points if p.highlight]
    assert current.label == "Kea Day & Night"


def test_the_household_is_the_highlighted_side_of_a_comparison() -> None:
    spec = chart_for("compare_to_similar_homes", SIMILAR_HOMES)
    assert spec is not None
    (mine,) = [p for p in spec.points if p.highlight]
    assert mine.value == SIMILAR_HOMES["this_household_kwh_per_day"]


def test_a_malformed_result_costs_the_chart_and_not_the_answer() -> None:
    """The prose is the product; the chart is a garnish. A tool result in an unexpected
    shape must return None here rather than raising into the stream, where it would take
    out an answer that was otherwise fine."""
    for junk in ({"available": True, "options": "not a list"},
                 {"available": True, "current_bill": 5, "prior_bill": None},
                 {"available": True, "categories": [None, 7]}):
        for tool in ("get_plan_options", "get_bill_comparison", "get_energy_breakdown"):
            assert chart_for(tool, junk) is None
