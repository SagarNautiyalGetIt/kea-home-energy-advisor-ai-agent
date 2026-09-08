"""What the model can look up, and the only way it reaches customer data.

## The rule that replaced layer 1

The old architecture decided what to compute *before* the model saw the question: a
keyword router picked one of twenty-six intents, a builder produced a fixed list of
facts for that intent, and the model wrote three sentences from it. Anything the router
did not recognise fell through to an empty bundle whose caveat told the model to offer a
handoff — which is why so many different questions came back as the same non-answer.

Here the model asks. Python answers honestly, including when the honest answer is "this
account has no bill history". Nothing decides in advance what the reply will be.

## What Python still owns, and why that is not a middleman

Three things stay on this side of the line, because they are not judgement calls:

* **Scope.** `customer_id` is bound from the authenticated request and is never a tool
  parameter. There is no argument the model can pass that reaches another household's
  data. This is the one thing that must not be a matter of prompting.
* **Retrieval.** SQL, mart selection, timezone handling, Decimal-to-float at the
  boundary. A model writing its own SQL against `kea.*` is a worse version of a job dbt
  already did.
* **The forecast.** `project_this_bill` runs the weather-normalised regression in
  `analytics/forecast.py`. That is a fitted model with a published prediction interval,
  and asking a language model to eyeball a trend line instead would be a downgrade
  dressed as autonomy. It is offered as a *tool the model may call*, which is the whole
  difference from the old pipeline: the model decides whether a projection is relevant,
  it does not have one forced on it.

Everything else — what matters, what to compare, how much to say, what the customer
actually meant — is the model's.

## Shape of a tool result

Every tool returns a plain JSON-able dict carrying, alongside the data, a `source` line
naming where the figures came from. That line exists so the answer can cite its basis in
words the customer can check, which is what the verification layer used to be for. The
provenance is now real rather than reconstructed: the model is quoting a row it actually
read.

`available: false` with a `reason` is a first-class result, not an error. Half the demo
accounts have no bill history and the fixtures have no plan at all; a tool that invents a
plausible plan name so the demo has something to say would be the exact fabrication this
service exists to prevent, and it would be invisible to any checker because a plan name
contains no digits.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any

from app.analytics import forecast as forecast_mod
from app.analytics.account import AccountContext
from app.analytics.engine import DEFAULT_UNIT_PRICE_NZD, TariffOption, UsageWindow
from app.analytics.repository import UsageContext

log = logging.getLogger(__name__)

#: Illustrative plans — Kea's real tariffs are not public, and every surface quoting a
#: dollar figure has to say so. Standard trades a higher daily charge for a lower unit
#: rate; Low Fixed Charge is the reverse, which is why it suits low users.
#:
#: Break-even is (1.50 - 0.30) / (0.36 - 0.30) = **20 kWh/day**, calibrated against NZ's
#: Low Fixed Charge regulation (households under ~8,000 kWh/year, about 22 kWh/day). An
#: earlier draft used 0.34 for the LFC unit rate, which pushed break-even to 30 kWh/day
#: and made LFC look cheaper for almost everybody.
STANDARD_PLAN = TariffOption("Kea Standard", unit_price_nzd=0.30, daily_fixed_nzd=1.50)
LOW_FIXED_PLAN = TariffOption("Low Fixed Charge", unit_price_nzd=0.36, daily_fixed_nzd=0.30)

ILLUSTRATIVE_DISCLOSURE = (
    "Kea's real tariffs are not public, so dollar figures here use an ILLUSTRATIVE "
    f"{DEFAULT_UNIT_PRICE_NZD * 100:.0f}c/kWh. Say so the first time you quote one."
)

BILLED_DISCLOSURE = (
    "Dollar figures here use this account's OWN effective rate, derived from its bill "
    "total divided by its metered kWh — so they reconcile with the invoice rather than "
    "with a posted tariff. You may quote them as real amounts. Do NOT call them "
    "illustrative."
)


def tariff_note(ctx: ToolContext) -> str:
    """Which disclosure is true for THIS account.

    A single constant was wrong in both directions once the repository started deriving a
    real rate from the bill (KEA-141 §2). Saying "illustrative" over a figure that
    reconciles with the invoice undersells it; saying "real" over the 30c fallback is a
    fabrication. The account decides.
    """
    current = getattr(ctx.account, "current_bill", None)
    if current is not None and current.total_kwh:
        return BILLED_DISCLOSURE
    return ILLUSTRATIVE_DISCLOSURE

METER_BASIS = (
    "the customer's own half-hourly meter data, aggregated to daily totals by the "
    "data platform"
)


@dataclass
class ToolContext:
    """One request's data, fetched once, plus the escalation flag a tool can set.

    `customer_id` lives here rather than in any tool signature. That is the scoping
    guarantee: the dispatcher passes this context, the model passes only the arguments
    the schema declares, and no declared argument names a household.
    """

    customer_id: str
    usage: UsageContext
    account: AccountContext
    escalated: bool = False
    escalation_reason: str | None = None

    open_question: object | None = None
    """The clarifying question Python asked on the previous turn, if any.

    Re-derived each turn rather than stored — see `app/clarify/conversation.py`. Present
    means the customer is being replied to, so `answer_clarifying_question` is live and
    the model is told what was asked. None means there is nothing to answer and the tool
    says so rather than inventing a question to attach the answer to."""

    answered_question: object | None = None
    """Set by `answer_clarifying_question` when the model maps a reply onto a typed
    answer. The pipeline writes it to the household context after the turn — the tool
    itself does no I/O, so a tool call cannot half-commit a fact about somebody's home."""


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
#
# JSON Schema, because all three providers take that shape: Anthropic's `input_schema`,
# Gemini's `FunctionDeclaration.parameters` and Ollama's `function.parameters` are the
# same object with different key names around it. Translation lives in each provider.
#
# Descriptions are written for the model, and they are load-bearing. "Returns daily
# usage" tells it nothing about when to call this rather than `get_bill_comparison`;
# saying what question each one answers is what makes the choice reliable.

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "get_account_summary",
        "description": (
            "Start here for almost any question. Returns who this customer is, their "
            "plan and rates, their connection (solar, controlled load, network, "
            "region), where they are in the current billing cycle, how much of their "
            "data is estimated rather than actually read, and what period of usage "
            "data is available to the other tools. Call this before quoting any figure "
            "so you know what this account actually has — several accounts have no "
            "plan or bill history at all, and the summary tells you which."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_daily_usage",
        "description": (
            "Day-by-day electricity use for this household. Each day carries total "
            "import, base load (the always-on draw measured overnight — usually the "
            "most explanatory figure available), controlled and uncontrolled circuits "
            "separately, solar export, mean temperature, heating degree days, whether "
            "it was a weekend or public holiday, and whether the meter returned a full "
            "48 intervals. Use it for anything about which days were high, how usage "
            "moved through the month, standing load, or how usage tracked the weather."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {
                    "type": "string",
                    "description": "ISO date, inclusive. Omit for the whole available period.",
                },
                "end_date": {
                    "type": "string",
                    "description": "ISO date, inclusive. Omit for the whole available period.",
                },
                "last_n_days": {
                    "type": "integer",
                    "description": "Most recent N days instead of a date range.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_bill_comparison",
        "description": (
            "This bill against the previous one, with the increase already attributed "
            "to its drivers by the data platform: period length, weather, base load, "
            "tariff change, and whatever is left over as unexplained. This is the "
            "definition of record for 'why is my bill higher' — prefer it over "
            "recomputing an attribution yourself from daily usage. Returns "
            "available:false for a first bill or an account with no billing history, "
            "which is a real answer and not a failure."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_hourly_profile",
        "description": (
            "The average shape of a day, hour by hour, with weekdays and weekends kept "
            "apart. Use this for anything about time of day — when the house draws "
            "most, whether the evening peak is large, whether hot water is running "
            "overnight. Check `sample_days`: a profile built from three days is a much "
            "weaker claim than one built from thirty, and you should say so. Returns "
            "available:false when this account has no half-hourly profile, in which "
            "case you can still answer at day resolution from get_daily_usage but must "
            "NOT name an hour or a part of the day."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {
                    "type": "string",
                    "description": (
                        "ISO date inside the month wanted, e.g. 2026-07-01. "
                        "Omit for the most recent."
                    ),
                }
            },
            "required": [],
        },
    },
    {
        "name": "compare_to_similar_homes",
        "description": (
            "How this household's daily use compares with a cohort of comparable homes "
            "in the same dataset. Returns the cohort figure, how it was constructed, "
            "and this household's own average. The comparison is against other homes "
            "in this dataset — it is NOT a New Zealand average, and you must not "
            "present it as one."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_plan_options",
        "description": (
            "The illustrative plans available, with unit rates, daily fixed charges and "
            "the break-even daily usage between them, plus what this household would "
            "pay on each over the period. Use it when asked whether a different plan "
            "would be cheaper. The rates are illustrative because Kea's real tariffs "
            "are not public; say so when you quote them."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "project_this_bill",
        "description": (
            "Project the full cycle from usage so far. Runs a weather-normalised "
            "regression when the household's usage actually tracks temperature, and a "
            "straight-line projection when it does not — the result says which, and "
            "carries an 80% prediction interval. Quote the range, not just the point "
            "estimate, when the interval is wide. Use this for 'what will my bill be' "
            "and for whether they are on track."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "as_at_day": {
                    "type": "integer",
                    "description": (
                        "Project as if only this many days of the cycle had elapsed. "
                        "Omit to use everything available."
                    ),
                }
            },
            "required": [],
        },
    },
    {
        "name": "answer_clarifying_question",
        "description": (
            "Record the customer's reply to the clarifying question Sparky asked at the "
            "end of the previous turn. ONLY call this when there is an open question — "
            "get_account_summary tells you the exact wording if there is — and only when "
            "this message is genuinely a reply to it. 'Yes', 'yeah we got a heat pump', "
            "'no nothing new', 'not sure' are replies. A new question is not, even if it "
            "is about the same subject. Answering it lets the bill explanation be "
            "recomputed with the cause confirmed, so the next answer is more specific."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": (
                        "yes | no | unsure. Use 'unsure' for 'I don't know' or 'maybe' — "
                        "it closes the question without confirming anything, which is "
                        "different from 'no'."
                    ),
                },
                "since": {
                    "type": "string",
                    "description": (
                        "ISO date the change started, ONLY if the customer gave one and "
                        "the answer is yes. Omit for 'a few weeks ago' — do not convert a "
                        "vague phrase into a date."
                    ),
                },
                "count": {
                    "type": "integer",
                    "description": (
                        "How many extra people, for an occupancy question, and only with "
                        "a yes."
                    ),
                },
            },
            "required": ["answer"],
        },
    },
    {
        "name": "handoff_to_human",
        "description": (
            "Hand this conversation to a person. Call it when the customer is telling "
            "you they cannot afford their bill or are in financial difficulty, when "
            "they are disputing the bill or the meter (you cannot adjudicate a claim "
            "about the world), when the account is flagged medically dependent or "
            "vulnerable and the conversation touches payment or supply, or when they "
            "ask for a human. Do NOT call it merely because a question is hard or the "
            "data is thin — explain what you do know instead. Calling this does not "
            "end your turn: still answer warmly, and still explain anything you can."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why, in one short phrase. Recorded on the escalation row.",
                }
            },
            "required": ["reason"],
        },
    },
]

TOOL_NAMES = frozenset(t["name"] for t in TOOL_SCHEMAS)


# ---------------------------------------------------------------------------
# Implementations
# ---------------------------------------------------------------------------


def _round(value: float | None, places: int = 2) -> float | None:
    return None if value is None else round(float(value), places)


def _iso(value: dt.date | dt.datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def _prune(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop null entries.

    A month of daily rows carrying eight `null` columns each is a few hundred wasted
    tokens and, worse, reads to the model as data it should mention. Absent is clearer
    than null: the tool docs already say which columns some accounts do not have.
    """
    return {k: v for k, v in payload.items() if v is not None}


def _unavailable(reason: str, **extra: Any) -> dict[str, Any]:
    return {"available": False, "reason": reason, **extra}


def get_account_summary(ctx: ToolContext) -> dict[str, Any]:
    account = ctx.account
    usage = ctx.usage
    plan = account.plan
    connection = account.connection
    billing = account.billing
    quality = account.quality

    # `display_name` is a real person only when it came off a mart account row. On the
    # fixture and seeded paths it is the household's *description* — "Cold-snap driven,
    # not behaviour" — and an earlier version of this system greeted somebody with
    # "Hi Cold-snap driven, not behaviour,". There is no name to fall back to:
    # `models.Customer` deliberately holds none, because 47.6% of surveyed customers said
    # they would not trust an AI with their data and the schema has to be able to back
    # that up. So the description is passed through labelled as one.
    from_account_row = getattr(ctx.usage, "account", None) is not None

    summary: dict[str, Any] = {
        "available": True,
        "account_reference": ctx.customer_id,
        "usage_data_period": {
            "label": usage.window.period,
            "days_available": len(usage.window.daily_kwh),
            "first_day": _iso(account.days[0].date) if account.days else None,
            "last_day": _iso(account.days[-1].date) if account.days else None,
        },
        "source": f"kea.mart_account_context, plus {METER_BASIS}",
    }

    if account.display_name:
        if from_account_row:
            summary["customer_name"] = account.display_name
        else:
            summary["household_description"] = account.display_name
            summary["name_note"] = (
                "This is a description of the household for demo purposes, NOT a "
                "person's name. Do not greet them with it and do not repeat it back. "
                "There is no name on file for this account."
            )

    summary["plan"] = (
        _prune(
            {
                "name": plan.name,
                "code": plan.code,
                "user_type": plan.user_type,
                "user_type_note": (
                    "'low_user' and 'standard' are the New Zealand regulated categories; "
                    "a low user pays a lower daily fixed charge and a higher unit rate."
                ),
                "is_time_of_use": plan.is_tou,
                "daily_fixed_charge_nzd": _round(plan.daily_fixed_nzd),
                "unit_rate_nzd_per_kwh": _round(plan.unit_rate_nzd, 4),
            }
        )
        if plan is not None
        else _unavailable("this account has no plan on file in the serving marts")
    )

    summary["connection"] = (
        _prune(
            {
                "icp_number": connection.icp_number or None,
                "address": connection.address_display,
                "climate_region": connection.climate_region,
                "network": connection.network_name,
                "has_solar": connection.has_solar,
                "has_controlled_load": connection.has_controlled_load,
                "controlled_load_note": (
                    "A controlled (ripple) circuit is metered separately from the rest "
                    "of the house. In New Zealand it is usually the hot-water cylinder, "
                    "though not always — you may ask about it, never assert it."
                )
                if connection.has_controlled_load
                else None,
            }
        )
        if connection is not None
        else _unavailable("this account has no connection record on file")
    )

    summary["billing"] = (
        _prune(
            {
                "account_number": billing.account_number,
                "balance_nzd": _round(billing.balance_nzd),
                "last_bill_total_nzd": _round(billing.last_bill_total_nzd),
                "due_date": _iso(billing.due_date),
                "days_until_due": billing.days_until_due,
                "is_overdue": billing.is_overdue if billing.due_date else None,
                "payment_method": billing.payment_method,
                "billing_cycle_day": billing.billing_cycle_day,
                "current_period_start": _iso(billing.current_period_start),
                "current_period_end": _iso(billing.current_period_end),
                "days_into_period": billing.days_into_period,
            }
        )
        if billing is not None
        else _unavailable("this account has no billing record on file")
    )

    # Read quality is disclosed rather than hidden, for the same reason /health discloses
    # which recorder is live: a figure computed from estimated reads is a different claim
    # from one computed from actual reads, and only one side of this call knows which.
    summary["data_quality"] = _prune(
        {
            "estimated_read_pct": _round(quality.estimated_read_pct, 1),
            "missing_intervals": quality.missing_intervals or None,
            "last_read_at": _iso(quality.last_read_at),
            "has_incomplete_days": account.has_gaps or None,
            "guidance": (
                "Some of this month was estimated rather than actually read. Say so "
                "plainly when you quote a figure from it."
            )
            if quality.must_hedge
            else "Readings are actual, not estimated.",
        }
    )

    # The Consumer Care flags. On the summary rather than behind their own lookup because
    # they change what may be said, and a tool the model might not call is not a control.
    care: dict[str, Any] = {}
    if account.is_medically_dependent:
        care["medically_dependent"] = True
    if account.is_vulnerable:
        care["vulnerable"] = True
    if quality.must_decline:
        care["account_quarantined"] = quality.quarantine_reason or "unresolved references"
    if care:
        care["guidance"] = (
            "Under the Consumer Care Obligations this account needs a person for "
            "anything touching payment difficulty, disconnection or supply. Call "
            "handoff_to_human if the conversation goes near those."
        )
        summary["consumer_care"] = care

    if ctx.open_question is not None:
        summary["open_question"] = {
            "asked": ctx.open_question.prompt,
            "about": str(ctx.open_question.hypothesis),
            "worth_nzd": _round(ctx.open_question.explains_nzd),
            "guidance": (
                "Sparky asked this at the end of the previous turn. If this message is a "
                "reply to it — 'yes', 'no', 'not sure', or anything that answers it — "
                "call answer_clarifying_question. If it is a new question, ignore this "
                "and answer what they actually asked."
            ),
        }

    summary["tariff_note"] = tariff_note(ctx)
    return summary


def get_daily_usage(
    ctx: ToolContext,
    start_date: str | None = None,
    end_date: str | None = None,
    last_n_days: int | None = None,
) -> dict[str, Any]:
    days = ctx.account.days
    if not days:
        return _unavailable("no daily usage rows for this account")

    # Default to the period the rest of the app is answering about.
    #
    # `account.days` is the WHOLE history the mart holds — 397 days for Rangi — while
    # `/api/households/{id}` serves the billed period. Reading the raw list made the
    # assistant say "over the 397 days on this bill" and name a peak the dashboard
    # disagreed with: the same defect as KEA-141 §3, on the path that fix missed.
    #
    # An explicit `start_date`/`end_date` still reaches the full history, which is the
    # point of them — "how does this compare with last winter" is a real question, and it
    # is one the model has to ask for rather than get by accident.
    window_start = getattr(ctx.usage, "period_start", None)
    window_end = getattr(ctx.usage, "period_end", None)
    if window_start and window_end and not (start_date or end_date or last_n_days):
        days = [d for d in days if window_start <= d.date <= window_end] or days

    def _parse(value: str | None) -> dt.date | None:
        if not value:
            return None
        try:
            return dt.date.fromisoformat(value[:10])
        except ValueError:
            return None

    start, end = _parse(start_date), _parse(end_date)
    selected = [
        d
        for d in days
        if (start is None or d.date >= start) and (end is None or d.date <= end)
    ]
    if last_n_days and last_n_days > 0:
        selected = selected[-last_n_days:]

    if not selected:
        return _unavailable(
            "no days in that range",
            data_covers=f"{days[0].date.isoformat()} to {days[-1].date.isoformat()}",
        )

    rows = [
        _prune(
            {
                "date": d.date.isoformat(),
                "day": f"{d.date:%a}",
                "import_kwh": _round(d.import_kwh),
                "base_load_kwh": _round(d.base_load_kwh),
                "controlled_kwh": _round(d.controlled_kwh) or None,
                "uncontrolled_kwh": _round(d.uncontrolled_kwh) or None,
                "export_kwh": _round(d.export_kwh) or None,
                "peak_kwh": _round(d.peak_kwh),
                "off_peak_kwh": _round(d.off_peak_kwh),
                "temp_mean_c": _round(d.temp_mean_c, 1),
                "heating_degree_days": _round(d.heating_degree_days, 1),
                "weekend": d.is_weekend or None,
                "public_holiday": d.is_public_holiday or None,
                # Only when it is not a normal day. 48 on every row is 31 repetitions of
                # "nothing to report"; a short day is the thing worth surfacing.
                "incomplete_intervals": None
                if d.is_complete
                else f"{d.interval_count} of {d.expected_intervals}",
                "estimated_intervals": d.estimated_count or None,
            }
        )
        for d in selected
    ]

    totals = [d.import_kwh for d in selected]
    base_loads = [d.base_load_kwh for d in selected if d.base_load_kwh is not None]

    return {
        "available": True,
        "days": rows,
        "totals": _prune(
            {
                "day_count": len(selected),
                "total_import_kwh": _round(sum(totals)),
                # The cost, computed rather than left for the model to derive.
                #
                # It had the kWh and not the rate, so stating a dollar figure meant
                # multiplying by a number it was never given — which is the one kind of
                # arithmetic that cannot be traced back to anything. `unit_price_nzd` is
                # this account's own effective rate where a bill exists (KEA-141 §2), so
                # both figures reconcile with the invoice and with /api/households/{id}.
                "total_cost_nzd": _round(sum(totals) * ctx.usage.window.unit_price_nzd),
                "unit_price_nzd": _round(ctx.usage.window.unit_price_nzd, 4),
                "mean_daily_kwh": _round(sum(totals) / len(totals)),
                "mean_base_load_kwh_per_day": _round(
                    sum(base_loads) / len(base_loads)
                )
                if base_loads
                else None,
                "total_export_kwh": _round(sum(d.export_kwh for d in selected)) or None,
                "total_controlled_kwh": _round(sum(d.controlled_kwh for d in selected)) or None,
            }
        ),
        "column_notes": {
            "base_load_kwh": (
                "The overnight floor — what the house draws when nobody is doing "
                "anything. It is the single most explanatory column here, and the only "
                "one a household can usually move without noticing."
            ),
            "import_kwh": "Total drawn from the grid that day.",
            "controlled_kwh": (
                "A separately metered circuit the network switches. Usually the hot "
                "water cylinder in New Zealand, but you may not assert that."
            ),
            "heating_degree_days": (
                "How far below 18°C the day averaged. Higher means colder, so more "
                "heating. This is what lets you separate weather from behaviour."
            ),
        },
        "source": METER_BASIS,
        "tariff_note": tariff_note(ctx),
    }


def get_bill_comparison(ctx: ToolContext) -> dict[str, Any]:
    account = ctx.account
    current, prior = account.current_bill, account.prior_bill

    if current is None:
        return _unavailable(
            "this account has no billed period on file — the demo households are meter "
            "data without bills behind them. You can still explain usage from "
            "get_daily_usage, but there is no bill-to-bill change to attribute."
        )
    if prior is None:
        return {
            "available": True,
            "is_first_bill": True,
            "current_bill": _prune(
                {
                    "period": current.label,
                    "days": current.days,
                    "total_nzd": _round(current.total_nzd),
                    "total_kwh": _round(current.total_kwh),
                    "base_load_kwh_per_day": _round(current.base_load_kwh_per_day),
                    "heating_degree_days": _round(current.heating_degree_days, 1),
                }
            ),
            "note": (
                "This is a first bill, which is itself a complete explanation — there is "
                "nothing before it to compare against. Say that rather than treating it "
                "as missing data."
            ),
            "source": "kea.mart_bill_explanation",
        }

    # The platform's decomposition, in attribution order. Recomputing it here would give
    # two answers to the same question — the dashboard's and the assistant's — that agree
    # until somebody edits one of them.
    #
    # The household's OWN fitted heating slope is passed through. Without it the weather
    # driver is not computed at all and its dollars stay in `discretionary`, which is
    # deliberate: a weather attribution built on somebody else's heating sensitivity is a
    # fabrication with a regression stapled to it.
    from app.analytics.drivers import decompose

    breakdown = decompose(
        current,
        prior,
        heating_sensitivity_kwh_per_hdd=account.heating_sensitivity_kwh_per_hdd,
        weather_fit_r2=account.weather_fit_r2,
    )
    drivers = [
        _prune(
            {
                "driver": d.key,
                "label": d.label,
                "amount_nzd": _round(d.amount_nzd),
                "direction": d.direction,
                "confidence": str(d.confidence),
                "computed_from": {k: _round(v) for k, v in d.evidence.items()} or None,
                "caveat": d.note,
            }
        )
        for d in breakdown.drivers
    ]

    return {
        "available": True,
        "is_first_bill": False,
        "current_bill": _prune(
            {
                "period": current.label,
                "days": current.days,
                "total_nzd": _round(current.total_nzd),
                "total_kwh": _round(current.total_kwh),
                "base_load_kwh_per_day": _round(current.base_load_kwh_per_day),
                "heating_degree_days": _round(current.heating_degree_days, 1),
            }
        ),
        "prior_bill": _prune(
            {
                "period": prior.label,
                "days": prior.days,
                "total_nzd": _round(prior.total_nzd),
                "total_kwh": _round(prior.total_kwh),
                "base_load_kwh_per_day": _round(prior.base_load_kwh_per_day),
                "heating_degree_days": _round(prior.heating_degree_days, 1),
            }
        ),
        "change": {
            "amount_nzd": _round(breakdown.total_delta_nzd),
            "percent": _round(breakdown.delta_pct, 1),
            "kwh": _round(current.total_kwh - prior.total_kwh),
        },
        "drivers": drivers,
        "explained_nzd": _round(breakdown.explained_nzd),
        "unexplained_nzd": _round(breakdown.unexplained_nzd),
        "biggest_cause": breakdown.headline.key if breakdown.headline else None,
        "caveats": breakdown.caveats(),
        "guidance": (
            "The drivers are ordered by size, largest first, and they sum to the change. "
            "Lead with the biggest one — `biggest_cause` is null when nothing dominates, "
            "and that is a real answer: several things moved together and you should "
            "list them rather than promote one. If a meaningful amount is unexplained, "
            "say so — 'I can account for $34 of the $61' is a better answer than a "
            "confident story about the other $27. If the increase was fixed charges or "
            "price rather than usage, be explicit that using less power will not undo it."
        ),
        "source": "kea.mart_bill_explanation, decomposed by app/analytics/drivers.py",
        "tariff_note": tariff_note(ctx),
    }


async def get_hourly_profile(ctx: ToolContext, month: str | None = None) -> dict[str, Any]:
    """The one question the old architecture had to refuse.

    `TIME_OF_DAY` used to return a bundle with no figures and a caveat forbidding the
    model from naming any hour — because the seeded households' half-hourly data is one
    fixed 48-interval shape scaled by each day's total, so a "peak hour" read off it was
    a constant being presented as an observation.

    That is still true of the seeded households, and this returns `available: false` for
    them. It is *not* true of the mart accounts, which carry a real per-ICP profile in
    `kea.mart_hourly_profile` that nothing in the old pipeline ever read. The refusal was
    correct for one data source and was being applied to both.
    """
    from sqlalchemy import select

    icp_id = getattr(ctx.usage, "icp_id", None)
    if icp_id is None:
        return _unavailable(
            "no half-hourly profile for this account. The demo households store one "
            "synthetic interval shape scaled by each day's total, so a peak hour read "
            "off it would be a constant, not an observation. Answer at day resolution "
            "instead and do not name an hour, a time window, or a part of the day."
        )

    try:
        from app.db.marts import MartHourlyProfile
        from app.db.session import get_sessionmaker

        async with get_sessionmaker()() as session:
            stmt = select(MartHourlyProfile).where(MartHourlyProfile.icp_id == icp_id)
            if month:
                try:
                    anchor = dt.date.fromisoformat(month[:10]).replace(day=1)
                    stmt = stmt.where(MartHourlyProfile.profile_month == anchor)
                except ValueError:
                    pass
            rows = (
                await session.execute(
                    stmt.order_by(
                        MartHourlyProfile.profile_month.desc(),
                        MartHourlyProfile.hour_of_day,
                    )
                )
            ).scalars().all()
    except Exception:  # noqa: BLE001 - a missing mart is not an error worth failing on
        log.warning("hourly profile unavailable for %s", ctx.customer_id, exc_info=True)
        return _unavailable("the half-hourly profile mart could not be read")

    if not rows:
        return _unavailable(
            "kea.mart_hourly_profile has no rows for this connection. Answer at day "
            "resolution and do not name an hour or a part of the day."
        )

    latest = rows[0].profile_month
    in_month = [r for r in rows if r.profile_month == latest]

    def _curve(weekday: bool) -> list[dict[str, Any]]:
        return [
            {
                "hour": r.hour_of_day,
                "avg_import_kwh": _round(float(r.avg_import_kwh), 3),
                **(
                    {"avg_export_kwh": _round(float(r.avg_export_kwh), 3)}
                    if r.avg_export_kwh
                    else {}
                ),
            }
            for r in sorted(
                (r for r in in_month if r.is_weekday is weekday),
                key=lambda r: r.hour_of_day,
            )
        ]

    weekday, weekend = _curve(True), _curve(False)
    sample_days = max((r.sample_days for r in in_month), default=0)

    return {
        "available": True,
        "month": f"{latest:%B %Y}",
        "weekday_hours": weekday,
        "weekend_hours": weekend,
        "sample_days": sample_days,
        "guidance": (
            f"This shape is averaged over {sample_days} days. Weekday and weekend are "
            "separate curves because averaging them produces a shape neither day has. "
            "A profile built from a handful of days is a weak claim and you should say "
            "so. You may describe when the house draws power; you still may NOT name "
            "which appliance is responsible — one meter reading cannot identify one."
        ),
        "source": "kea.mart_hourly_profile",
    }


def compare_to_similar_homes(ctx: ToolContext) -> dict[str, Any]:
    window = ctx.usage.window
    baseline = ctx.usage.baseline
    mine = window.mean_kwh

    return {
        "available": True,
        "this_household_kwh_per_day": _round(mine),
        "comparable_homes_kwh_per_day": _round(baseline),
        "difference_kwh_per_day": _round(mine - baseline),
        "period": window.period,
        "cohort_definition": (
            "The mean daily use of the OTHER accounts in this dataset, excluding this "
            "household. It is reproducible from the same tables and can be stated out "
            "loud."
        ),
        "guidance": (
            "This is a comparison against other homes in this dataset. It is NOT a New "
            "Zealand average and must not be presented as one. Homes differ in size, "
            "occupancy and heating, so a difference is a starting point for a question, "
            "not a verdict on how they live."
        ),
        "source": "peer cohort computed across kea.mart_daily_usage, excluding this ICP",
        "tariff_note": tariff_note(ctx),
    }


def get_plan_options(ctx: ToolContext) -> dict[str, Any]:
    window = ctx.usage.window
    days = len(window.daily_kwh)
    total_kwh = window.total_kwh
    plan = ctx.account.plan

    # (1.50 - 0.30) / (0.36 - 0.30) = 20 kWh/day. Computed rather than written down so
    # editing a rate above cannot leave a stale threshold in the answer.
    break_even = (STANDARD_PLAN.daily_fixed_nzd - LOW_FIXED_PLAN.daily_fixed_nzd) / (
        LOW_FIXED_PLAN.unit_price_nzd - STANDARD_PLAN.unit_price_nzd
    )

    return {
        "available": True,
        "period": window.period,
        "days_in_period": days,
        "usage_kwh": _round(total_kwh),
        "mean_daily_kwh": _round(window.mean_kwh),
        "options": [
            {
                "name": option.name,
                "unit_rate_nzd_per_kwh": option.unit_price_nzd,
                "daily_fixed_nzd": option.daily_fixed_nzd,
                "cost_over_this_period_nzd": _round(option.cost_for(total_kwh, days)),
            }
            for option in (STANDARD_PLAN, LOW_FIXED_PLAN)
        ],
        "break_even_kwh_per_day": _round(break_even, 1),
        "current_plan": plan.name if plan else None,
        "guidance": (
            "Below the break-even daily usage the Low Fixed Charge plan wins; above it "
            "the Standard plan does. Compare against THIS household's mean daily usage "
            "and say which side of the line they sit, and by how much. If the gap is "
            "small, say it is small — switching for two dollars a month is not advice."
        ),
        "source": "illustrative plan catalogue in app/agent/tools.py",
        "tariff_note": (
            "These plans are illustrative. Kea's real tariffs are not public, so the "
            "comparison shows the SHAPE of the trade-off — high fixed charge and low "
            "unit rate against the reverse — rather than Kea's actual prices. Say so."
        ),
    }


def project_this_bill(ctx: ToolContext, as_at_day: int | None = None) -> dict[str, Any]:
    window = ctx.usage.window
    daily = window.daily_kwh
    if as_at_day and 1 <= as_at_day <= len(daily):
        daily = daily[:as_at_day]

    elapsed = len(daily)
    billing = ctx.account.billing
    if billing and billing.current_period_start and billing.current_period_end:
        cycle_days = (billing.current_period_end - billing.current_period_start).days + 1
    else:
        cycle_days = max(len(window.daily_kwh), elapsed)

    truncated = UsageWindow(
        customer_id=window.customer_id,
        period=window.period,
        daily_kwh=daily,
        unit_price_nzd=window.unit_price_nzd,
    )
    result = forecast_mod.forecast_cycle(
        truncated,
        # `forecast_cycle` refuses a cycle shorter than the readings it was given, and
        # rightly — projecting 31 days of data over a 28-day cycle is a bug, not a
        # forecast. Clamping here keeps a short `as_at_day` from tripping it.
        days_in_cycle=max(cycle_days, elapsed),
        daily_hdd=ctx.usage.hdd[:elapsed],
        normal_hdd_per_day=ctx.usage.normal_hdd,
    )
    fit = result.response

    return {
        "available": True,
        "period": window.period,
        "days_elapsed": result.days_elapsed,
        "days_in_cycle": result.days_in_cycle,
        "days_remaining": result.days_remaining,
        "usage_so_far_kwh": _round(result.usage_so_far_kwh),
        "cost_so_far_nzd": _round(result.cost_so_far_nzd),
        "projected_cycle_kwh": _round(result.projected_kwh),
        "projected_cycle_cost_nzd": _round(result.projected_cost_nzd),
        "projected_range_nzd": {
            "low": _round(result.cost_p10_nzd),
            "high": _round(result.cost_p90_nzd),
            "interval": "80% prediction interval, not 95% — a 95% band on a fortnight "
            "of daily electricity is so wide it communicates nothing.",
        },
        "confidence_width_pct": _round(result.confidence_width_pct, 1),
        "method": result.method.value,
        "method_detail": result.method_detail,
        "fitted": _prune(
            {
                "base_load_kwh_per_day": _round(fit.base_load_kwh_per_day)
                if fit.usable
                else None,
                "heating_kwh_per_degree_day": _round(fit.heating_kwh_per_hdd, 3)
                if fit.usable
                else None,
                "r_squared": _round(fit.r_squared, 2) if fit.usable else None,
            }
        ),
        "guidance": (
            "Quote the range rather than the single figure when confidence_width_pct is "
            "above about 25 — early in a cycle it usually is. If the method is "
            "straight_line, the weather fit was not usable for this household and you "
            "must NOT attribute anything in the projection to temperature."
        ),
        "source": (
            "projection over the customer's own daily totals, "
            "app/analytics/forecast.py"
        ),
        "tariff_note": tariff_note(ctx),
    }


def answer_clarifying_question(
    ctx: ToolContext,
    answer: str,
    since: str | None = None,
    count: int | None = None,
) -> dict[str, Any]:
    """Map the customer's reply onto the typed answer, and stage it for the pipeline.

    Does no I/O on purpose. The tool validates and parks the result on the context;
    `pipeline.answer()` writes it once the turn has completed. A tool that wrote directly
    would let a turn that later failed leave a half-committed fact about somebody's home
    in the household context, which nothing downstream could distinguish from something
    they actually said.
    """
    from app.clarify.schemas import Answer, QuestionResponse

    if ctx.open_question is None:
        return _unavailable(
            "there is no open question to answer. Sparky did not ask anything on the "
            "previous turn, so treat this message as a new question rather than a reply."
        )

    try:
        parsed = Answer(answer.strip().lower())
    except ValueError:
        return {
            "error": f"{answer!r} is not a valid answer",
            "hint": "Use exactly one of: yes, no, unsure.",
        }

    since_date: dt.date | None = None
    if since:
        try:
            since_date = dt.date.fromisoformat(since[:10])
        except ValueError:
            # Not fatal. A yes with an unparseable date is still a yes, and the detector's
            # own step date is a better fallback than refusing the answer.
            log.warning("unparseable `since` %r on a clarifying answer", since)

    try:
        response = QuestionResponse(
            question_id=ctx.open_question.id,
            answer=parsed,
            since=since_date,
            count=count,
        )
    except Exception as exc:  # noqa: BLE001 - the validator's message is the useful part
        # `QuestionResponse` refuses a date or a count attached to anything but "yes",
        # because that would write a confirmed change into the record off a denial.
        return {
            "error": f"that answer is not valid: {exc}",
            "hint": "A date or a count may only accompany 'yes'.",
        }

    ctx.answered_question = (ctx.open_question, response)
    return {
        "recorded": True,
        "question": ctx.open_question.prompt,
        "answer": parsed.value,
        "guidance": (
            "Recorded. Tell them briefly what it means for their bill — a 'yes' lets the "
            "change be attributed to a cause instead of sitting in the unexplained "
            "remainder, and a 'no' or 'unsure' narrows what is left. Do not ask another "
            "question; if there is one worth asking it is appended for you."
        ),
        "source": "recorded against this household's own context, app/clarify/",
    }


def handoff_to_human(ctx: ToolContext, reason: str) -> dict[str, Any]:
    ctx.escalated = True
    ctx.escalation_reason = reason
    log.info("agent escalation customer=%s reason=%s", ctx.customer_id, reason)
    return {
        "acknowledged": True,
        "reason": reason,
        "guidance": (
            "A person will pick this up. Tell the customer warmly and without drama "
            "that you are putting them through — do not lecture, do not give financial "
            "advice, and do not argue with them about whether the bill is right. You "
            "may still explain anything factual they asked about."
        ),
    }


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

_SYNC = {
    "get_account_summary": get_account_summary,
    "get_daily_usage": get_daily_usage,
    "get_bill_comparison": get_bill_comparison,
    "compare_to_similar_homes": compare_to_similar_homes,
    "get_plan_options": get_plan_options,
    "project_this_bill": project_this_bill,
    "handoff_to_human": handoff_to_human,
    "answer_clarifying_question": answer_clarifying_question,
}
_ASYNC = {
    "get_hourly_profile": get_hourly_profile,
}


async def dispatch(ctx: ToolContext, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Run one tool. Never raises.

    A tool that blows up returns an error *result* rather than propagating, because the
    model can recover from "that lookup failed, try another route" and cannot recover
    from a 500. This is the same policy the recorder uses and for the same reason: an
    infrastructure failure must not cost the customer their answer.

    Unknown names and bad arguments are also results, not exceptions — a model that
    hallucinates a tool or a parameter is told so and gets to correct itself, which it
    reliably does.
    """
    arguments = arguments or {}
    try:
        if name in _SYNC:
            return _SYNC[name](ctx, **arguments)
        if name in _ASYNC:
            return await _ASYNC[name](ctx, **arguments)
    except TypeError as exc:
        log.warning("tool %s called with bad arguments %r: %s", name, arguments, exc)
        return {
            "error": f"bad arguments for {name}: {exc}",
            "hint": "Check the parameter names against the tool definition and try again.",
        }
    except Exception as exc:  # noqa: BLE001 - a tool failure must not end the turn
        log.exception("tool %s failed for customer=%s", name, ctx.customer_id)
        return {
            "error": f"{name} failed: {exc}",
            "hint": (
                "This lookup is unavailable. Answer from what the other tools give you, "
                "and tell the customer plainly which part you could not check."
            ),
        }

    return {
        "error": f"no such tool: {name}",
        "available_tools": sorted(TOOL_NAMES),
    }
