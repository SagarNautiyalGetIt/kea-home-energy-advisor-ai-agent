"""Turn a tool result into a small chart, or into nothing.

## Why this lives on the server

The obvious place to draw a chart is the client: it already has `AreaChart`, and the
usage endpoints would give it numbers. That version was rejected. A chart assembled
from a *separate* fetch is a second answer to the same question, and the two drift —
the prose says the bill rose $66.50 because the lookup ran at 11:02, the chart says
something else because it refetched at 11:03. Worse, a figure the customer cannot
trace back to a lookup is the exact thing this product tells them it will never show.

So a chart is built here, from the same result dict that `app/db/recorder.py` writes to
`app.agent_tool_call`, and it carries that result's own `source` string. The chart and
the sentence beside it are then two renderings of one row. If the lookup did not happen,
there is no chart — never a placeholder, and never a shape inferred from the prose.

## What it will not do

- **No arithmetic beyond selection.** Every value below is lifted from a key the tool
  already computed. This module must never derive a figure the tool did not state:
  that would put a number on screen that no recorded lookup produced.
- **No chart for an unavailable lookup.** `available: false` is a real answer and the
  prose says so. Drawing an empty axis next to it implies data that is not there.
- **No opinion.** Ordering and highlighting come from the tool's own fields
  (`is_current_plan`, `direction`), not from a judgement made here.

Adding a tool to this module is deliberately a small, local edit: one branch, keyed on
the tool's name, returning `None` for any shape it does not recognise.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

#: Above this many points a bar chart reads as a picket fence in a chat bubble. Series
#: charts (a month of daily totals, a 24-hour profile) are line charts and exempt.
MAX_BARS = 8


@dataclass(frozen=True)
class ChartPoint:
    label: str
    value: float
    #: Draws this point in the accent colour. Used for the thing the customer asked
    #: about — their own household against a cohort, or the plan they are on today.
    highlight: bool = False


@dataclass(frozen=True)
class ChartSpec:
    """One chart, ready to render. `unit` drives axis formatting on the client."""

    kind: Literal["bar", "line"]
    title: str
    unit: Literal["nzd", "kwh"]
    points: list[ChartPoint]
    #: The tool's own caveat, carried through so the illustrative-rate disclosure and
    #: the appliance caveat travel with the picture rather than being left in the prose.
    caveat: str | None = None
    source: str | None = None

    def as_payload(self) -> dict[str, Any]:
        return asdict(self)


def _money(value: Any) -> float | None:
    """A float, or None for anything that is not a usable number.

    Tools return `None` for a figure they could not compute, and a `None` reaching the
    client as a point would plot as zero — which reads as "you spent nothing" rather
    than "we could not work it out".
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(float(value), 2)


def _points(pairs: list[tuple[str, Any, bool]]) -> list[ChartPoint]:
    """Drop any pair whose value did not survive `_money`."""
    out = []
    for label, raw, highlight in pairs:
        value = _money(raw)
        if value is not None:
            out.append(ChartPoint(label=label, value=value, highlight=highlight))
    return out


# ───────────────────────────── per-tool builders ─────────────────────────────


def _bill_comparison(r: dict[str, Any]) -> ChartSpec | None:
    """This bill against the one before it — the picture behind "why is it high"."""
    current, prior = r.get("current_bill"), r.get("prior_bill")
    if not isinstance(current, dict) or not isinstance(prior, dict):
        return None
    points = _points([
        (str(prior.get("period") or "Last period"), prior.get("total_nzd"), False),
        (str(current.get("period") or "This period"), current.get("total_nzd"), True),
    ])
    if len(points) < 2:
        return None
    return ChartSpec(
        kind="bar", title="This bill against the one before", unit="nzd",
        points=points, caveat=r.get("tariff_note"), source=r.get("source"),
    )


def _plan_options(r: dict[str, Any]) -> ChartSpec | None:
    """Every plan priced against this household's own usage, cheapest first.

    The plan they are on is highlighted rather than moved: seeing where their current
    plan sits in the order is the whole answer to "is there a better one".
    """
    options = r.get("options")
    if not isinstance(options, list) or not options:
        return None
    ranked = sorted(
        (o for o in options if isinstance(o, dict)),
        key=lambda o: _money(o.get("cost_over_this_period_nzd")) or float("inf"),
    )
    points = _points([
        (str(o.get("name") or o.get("code") or "?"),
         o.get("cost_over_this_period_nzd"),
         bool(o.get("is_current_plan")))
        for o in ranked[:MAX_BARS]
    ])
    if len(points) < 2:
        return None
    return ChartSpec(
        kind="bar", title=f"What each plan would have cost over {r.get('period') or 'this period'}",
        unit="nzd", points=points, caveat=r.get("tariff_note"), source=r.get("source"),
    )


def _similar_homes(r: dict[str, Any]) -> ChartSpec | None:
    points = _points([
        ("Your home", r.get("this_household_kwh_per_day"), True),
        ("Similar homes", r.get("comparable_homes_kwh_per_day"), False),
    ])
    if len(points) < 2:
        return None
    return ChartSpec(
        kind="bar", title="Daily use against comparable homes", unit="kwh",
        points=points,
        # `guidance` is written at the model, but it is the caveat that matters most
        # here — a cohort difference is not a verdict on how somebody lives.
        caveat=r.get("guidance"), source=r.get("source"),
    )


def _energy_breakdown(r: dict[str, Any]) -> ChartSpec | None:
    categories = r.get("categories")
    if not isinstance(categories, list) or not categories:
        return None
    points = _points([
        (str(c.get("label") or c.get("key") or "?"), c.get("cost_nzd"), False)
        for c in categories if isinstance(c, dict)
    ][:MAX_BARS])
    if not points:
        return None
    return ChartSpec(
        kind="bar", title="Where this period's cost went", unit="nzd",
        points=points, caveat=r.get("caveat"), source=r.get("source"),
    )


def _projection(r: dict[str, Any]) -> ChartSpec | None:
    """Spent so far against the projected total. Skipped at the end of a cycle, where
    the two are the same number and the chart says nothing."""
    if not r.get("days_remaining"):
        return None
    points = _points([
        ("So far", r.get("cost_so_far_nzd"), False),
        ("Projected", r.get("projected_cycle_cost_nzd"), True),
    ])
    if len(points) < 2:
        return None
    return ChartSpec(
        kind="bar", title="This cycle so far, and where it is heading", unit="nzd",
        points=points, caveat=r.get("guidance"), source=r.get("source"),
    )


def _daily_usage(r: dict[str, Any]) -> ChartSpec | None:
    days = r.get("days")
    if not isinstance(days, list) or len(days) < 3:
        return None
    points = _points([
        (str(d.get("date") or ""), d.get("import_kwh"), False)
        for d in days if isinstance(d, dict)
    ])
    if len(points) < 3:
        return None
    return ChartSpec(
        kind="line", title="Daily use over the period", unit="kwh",
        points=points, source=r.get("source"),
    )


def _hourly_profile(r: dict[str, Any]) -> ChartSpec | None:
    """The weekday curve. Weekend is a second series the bubble has no room for, and
    showing one labelled as though it were both would be worse than showing one."""
    hours = r.get("weekday_hours")
    if not isinstance(hours, list) or len(hours) < 12:
        return None
    points = _points([
        (f"{int(h.get('hour', 0)):02d}:00", h.get("avg_import_kwh"), False)
        for h in hours if isinstance(h, dict)
    ])
    if len(points) < 12:
        return None
    return ChartSpec(
        kind="line", title="A typical weekday, by hour", unit="kwh",
        points=points, caveat=r.get("guidance"), source=r.get("source"),
    )


_BUILDERS = {
    "get_bill_comparison": _bill_comparison,
    "get_plan_options": _plan_options,
    "compare_to_similar_homes": _similar_homes,
    "get_energy_breakdown": _energy_breakdown,
    "project_this_bill": _projection,
    "get_daily_usage": _daily_usage,
    "get_hourly_profile": _hourly_profile,
}


def chart_for(tool_name: str, result: dict[str, Any]) -> ChartSpec | None:
    """The chart for one lookup, or None if this lookup does not have one.

    None is the common case and not a failure: most tools answer in words, and a turn
    where the model only searched the help articles should show no chart at all.
    """
    if not isinstance(result, dict) or not result.get("available", True):
        return None
    builder = _BUILDERS.get(tool_name)
    if builder is None:
        return None
    try:
        return builder(result)
    except (KeyError, TypeError, ValueError):
        # A malformed result must not take out the answer. The prose is the product;
        # the chart is a garnish, and a garnish may never break the plate.
        return None
