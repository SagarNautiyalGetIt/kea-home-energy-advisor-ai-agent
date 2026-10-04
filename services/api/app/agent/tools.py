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
from app.analytics.engine import DEFAULT_UNIT_PRICE_NZD, UsageWindow
from app.analytics.repository import UsageContext

log = logging.getLogger(__name__)

#: The plan catalogue lives in `app/analytics/plans.py`, which prices Kea's three
#: published styles — Anytime Rate, Time of Use and Free Weekends — against the
#: household's own daily rows at the rates printed on the plan page.
#:
#: It used to hold two invented plans ("Kea Standard", "Low Fixed Charge") that appear
#: nowhere in the product, so a customer could ask what plans were available, be given
#: two names and two prices, and then open the plans page and find three different ones.

ILLUSTRATIVE_DISCLOSURE = (
    "Where no bill is on file, energy is costed at Kea's published Anytime Rate of "
    f"{DEFAULT_UNIT_PRICE_NZD * 100:.1f}c/kWh, which is the rate on the plans page. It "
    "excludes the daily charge, so it is an energy cost and not a bill total — say that "
    "the first time you quote one."
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

    has_ev: bool | None = None


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
            "Every plan priced against THIS household's own metered usage, with the "
            "reasoning attached: what each would cost over the period and per year, how "
            "much of that is daily charges versus units, which plan is cheapest for them, "
            "how far their daily average sits from the point where the answer flips, and "
            "whether the cheapest plan stays cheapest on cold days as well as mild ones. "
            "Use it for anything about plans, rates, switching, whether they are on the "
            "right plan, or how to pay less. Read `worth_switching` before recommending "
            "anything — a plan that wins by two dollars a month has not been shown to win "
            "at all, and saying so is a real answer. The rates are Kea's published ones "
            "from the plans page; the usage and the arithmetic are this household's own."
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
        "name": "discover_smart_devices",
        "description": (
            "Scan the API server's local network for smart devices that announce "
            "themselves — Google Cast and Nest, Apple HomeKit accessories, Matter "
            "devices, Philips Hue, Shelly and Tasmota plugs, Home Assistant, SmartThings. "
            "Use it when they ask what smart devices you can see, whether you can connect "
            "to their home, or how to get a per-appliance breakdown. IT FINDS NAMES, NOT "
            "ENERGY: an announcement carries no power figure and there is no way to derive "
            "one, so never attach a kWh or dollar amount to anything it returns. What it "
            "is for is the next step — 'you have a Home Assistant and two Shelly plugs, "
            "connecting those would let me tell you what they actually used'. Takes a few "
            "seconds and only sees devices sharing the API server's network, which may "
            "be a cloud network rather than the customer's home."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_energy_breakdown",
        "description": (
            "Where this household's power actually goes, split into categories that are "
            "each separately measurable: the always-on background load, the separately "
            "metered circuit (usually hot water), the part of usage that moves with "
            "outdoor temperature, and everything else. This is the answer to 'what's "
            "using all my power' and 'which appliance is costing me the most' — give them "
            "this rather than only refusing. It does NOT identify appliances and you must "
            "not turn a category into a device: 'heating' is a fitted response to "
            "temperature, not a heat pump. Each slice carries a confidence that decides "
            "how you word it. Also use it for 'how do I use less', because it says which "
            "part of their bill is actually movable."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_connected_device_energy",
        "description": (
            "Measured daily energy from devices the household has connected. Call this "
            "alongside get_energy_breakdown when asked about appliances, EV charging, "
            "or the network scan. Returns available:false when no device meter has "
            "reported. Device names from discovery never appear here."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "search_help_topics",
        "description": (
            "Reference material for questions about the SERVICE rather than about this "
            "household's meter: how billing periods work, what the daily charge is for, "
            "estimated readings, disputing a bill, ways to pay, what help exists when a "
            "bill cannot be paid, medically dependent registration, the two regulated plan "
            "categories, switching, moving house, solar buy-back, how alerts work, what "
            "you are allowed to change on their account, privacy, power cuts, and how you "
            "produce an answer. Call it whenever the question is not answerable from the "
            "meter data, and call it ALONGSIDE the data tools when a question is both — "
            "'why am I charged when I was away' needs the daily charge explained and their "
            "own daily charge quoted. Returns facts to reason from, not an answer to "
            "repeat: write the reply to what they actually asked."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": (
                        "The customer's question, in their own words where possible. "
                        "Phrasing matters — the index is built on how people actually ask, "
                        "so passing their sentence beats passing a keyword."
                    ),
                },
                "topic": {
                    "type": "string",
                    "description": (
                        "Optional filter: billing, payments, hardship, plans, meters, "
                        "moving, solar, alerts, privacy, assistant, account. Omit unless "
                        "a first search returned the wrong area."
                    ),
                },
            },
            "required": ["question"],
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
        "name": "update_alert_settings",
        "description": (
            "Change this household's bill-shock warning settings, immediately. Use it when "
            "the customer asks for something you can honour here — 'text me at 20% "
            "instead', 'stop emailing me', 'don't call after 8pm', 'turn the warnings "
            "off', 'only warn me if it's more than $50 over'. Do it rather than telling "
            "them where the Settings screen is; doing it is the answer. The thresholds are "
            "a ladder — email fires first, then a text, then a call — and it must stay in "
            "that order, so setting the text lower than the email is refused and you "
            "should offer to move both. It returns exactly what changed and the whole "
            "ladder as it now stands: say both back, because 'done' gives the customer no "
            "way to catch you having changed the wrong one. It CANNOT take a payment, "
            "change bank or card details, change a due date, or change a plan."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "channel": {
                    "type": "string",
                    "description": (
                        "email | sms | voice. Required with `threshold_pct`, and names "
                        "which channel that percentage is for."
                    ),
                },
                "threshold_pct": {
                    "type": "number",
                    "description": (
                        "How far over their normal spend that channel fires at, as a "
                        "percentage. 5 to 200."
                    ),
                },
                "minimum_nzd": {
                    "type": "number",
                    "description": (
                        "Dollar floor under every warning, whatever the percentage says. "
                        "Stops small bills triggering constantly."
                    ),
                },
                # `items` is required, not decorative. Gemini rejects the whole tool
                # catalogue with 400 INVALID_ARGUMENT — "function_declarations[11].
                # parameters.properties[turn_on].items: missing field" — and the failure
                # takes down every tool in the request, not just this one. Anthropic and
                # Ollama accept the array without it, so this is invisible until the
                # provider that does not is the one in front of a customer.
                "turn_on": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Channels to switch on: email, sms, voice.",
                },
                "turn_off": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Channels to switch off.",
                },
                "quiet_from_hour": {
                    "type": "integer",
                    "description": "Local hour (0-23) after which texts and calls stop.",
                },
                "quiet_until_hour": {
                    "type": "integer",
                    "description": "Local hour (0-23) at which they may resume.",
                },
                "warnings_enabled": {
                    "type": "boolean",
                    "description": (
                        "Master switch for bill-shock warnings. False stops every channel "
                        "but keeps the assessment visible in the app — turning off the "
                        "interruption is not turning off the product."
                    ),
                },
            },
            "required": [],
        },
    },
    {
        "name": "request_plan_change",
        "description": (
            "Move this household onto a different Kea plan. TWO STEPS, and both are "
            "required: call it first without `confirm` to stage the change and get back "
            "what it would mean, tell the customer that in your reply and ask them to "
            "confirm, then call it again with confirm=true once they have said yes. Do "
            "NOT pass confirm=true on the strength of the message that asked for the "
            "switch — 'put me on the cheaper one' is a request, not a confirmation. This "
            "records the request for the team, who action it from the next billing period; "
            "it does not change the plan on the spot, and you must not tell them it has. "
            "Call get_plan_options first so the figure you quote is a real one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "plan_code": {
                    "type": "string",
                    "description": (
                        "The plan to move to, as `code` from get_plan_options — e.g. "
                        "anytime, time_of_use, free_weekends."
                    ),
                },
                "confirm": {
                    "type": "boolean",
                    "description": (
                        "True ONLY when the customer has said yes to the staged change in "
                        "a later message. Omit or false to stage."
                    ),
                },
            },
            "required": ["plan_code"],
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

TOOL_SCHEMAS.extend([
    {"name": "get_power_clash_progress", "description":
     "Read this household's planning and device-verified XP, action ideas and evidenced "
     "tariff-shift savings. Planning XP never proves savings; points have no cash value.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_scheduled_outages", "description":
     "Read the linked distributor's scheduled outage snapshot, revisions, cancellations "
     "and freshness. A missing or stale source cannot establish that there are no outages.",
     "input_schema": {"type": "object", "properties": {}}},
])
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

    if ctx.has_ev is not None:
        summary["customer_confirmed_ev_ownership"] = ctx.has_ev
        summary["ev_ownership_limit"] = (
            "Ownership is customer-reported. It does not prove that any measured night "
            "rise came from EV charging; only a charger meter or confirmed matching "
            "charging schedule can do that."
        )

    summary["tariff_note"] = tariff_note(ctx)
    return summary


def billed_days(ctx: ToolContext) -> list:
    """The account's days, narrowed to the period the rest of the app is answering about.

    `account.days` is the WHOLE history the mart holds — 397 days for Rangi — while
    `/api/households/{id}` serves the billed period. Reading the raw list made the
    assistant say "over the 397 days on this bill" and name a peak the dashboard
    disagreed with: the same defect as KEA-141 §3, on the path that fix missed.

    Shared by `get_daily_usage` and `compare_plans` rather than repeated, because the two
    quoting different periods for the same household is the same class of bug one step
    along: a plan comparison priced over 397 days beside a bill explanation about 31 is
    two answers that cannot both be right, and nothing would flag it.
    """
    days = ctx.account.days
    start = getattr(ctx.usage, "period_start", None)
    end = getattr(ctx.usage, "period_end", None)
    if start and end:
        return [d for d in days if start <= d.date <= end] or days
    return days


def get_daily_usage(
    ctx: ToolContext,
    start_date: str | None = None,
    end_date: str | None = None,
    last_n_days: int | None = None,
) -> dict[str, Any]:
    days = ctx.account.days
    if not days:
        return _unavailable("no daily usage rows for this account")

    # An explicit `start_date`/`end_date` reaches the full history, which is the point of
    # them — "how does this compare with last winter" is a real question, and it is one
    # the model has to ask for rather than get by accident.
    if not (start_date or end_date or last_n_days):
        days = billed_days(ctx)

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
                # Three bands, on Kea's published Time of Use boundaries: peak is
                # 7-11am and 5-9pm, off-peak 11am-5pm and 9-11pm, night 11pm-7am. Until
                # now `off_peak_kwh` carried the NIGHT figure and the 11am-5pm block had
                # no field at all, so an answer about "your off-peak use" was describing
                # what the house drew while everyone was asleep.
                "peak_kwh": _round(d.peak_kwh),
                "off_peak_kwh": _round(d.off_peak_kwh),
                "night_kwh": _round(d.night_kwh),
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
    """Every illustrative plan priced on this household's own metered usage.

    Rewritten around `analytics/plans.py`. The old version returned two flat plans, a
    break-even and a period cost, which was enough to say *whether* to switch and not
    enough to say *why* — so the answers read as an assertion with a number in it, from a
    product whose whole claim is that it never asks to be taken on trust.

    Everything derived is derived in Python. A model handed a break-even, two plan costs
    and a period will occasionally produce a third figure that contradicts both, and this
    is the one tool here where a wrong derived figure ends with somebody changing their
    electricity plan.
    """
    from app.analytics import plans as plans_mod

    days = billed_days(ctx)
    account = ctx.account
    plan = account.plan
    connection = account.connection

    comparison = plans_mod.compare(
        days,
        period=ctx.usage.window.period,
        plan_name=plan.name if plan else None,
        plan_code=plan.code if plan else None,
        plan_user_type=plan.user_type if plan else None,
        has_solar=bool(connection and connection.has_solar),
        has_controlled_load=bool(connection and connection.has_controlled_load),
        weekend_free_share=ctx.account.weekend_free_share,
    )

    if not comparison.available:
        return _unavailable(comparison.reason or "a plan comparison is not possible here")

    def _option(cost: plans_mod.PlanCost) -> dict[str, Any]:
        shape = cost.plan
        return _prune(
            {
                "code": shape.code,
                "name": shape.name,
                "user_type": shape.user_type,
                "daily_fixed_nzd": shape.daily_fixed_nzd,
                "unit_rate_nzd_per_kwh": shape.unit_rate_nzd,
                "off_peak_rate_nzd_per_kwh": shape.off_peak_rate_nzd,
                "controlled_rate_nzd_per_kwh": shape.controlled_rate_nzd,
                "export_rate_nzd_per_kwh": shape.export_rate_nzd
                if connection and connection.has_solar
                else None,
                "cost_over_this_period_nzd": cost.total_nzd,
                "cost_per_day_nzd": _round(cost.per_day_nzd),
                # The decomposition IS the explanation. "Your daily charges would drop $37
                # but your units would cost $52 more" is the sentence a customer can check;
                # a total cannot be taken apart back into it.
                "of_which_daily_charges_nzd": cost.fixed_nzd,
                "of_which_energy_nzd": cost.energy_nzd,
                "of_which_controlled_circuit_nzd": cost.controlled_nzd or None,
                "less_solar_export_credit_nzd": cost.export_credit_nzd or None,
                "priced_from": cost.priced_from,
                "suits": shape.suits,
                "is_current_plan": shape.code == comparison.current_plan_code,
            }
        )

    return {
        "available": True,
        "period": comparison.period,
        "days_in_period": comparison.days,
        "usage_kwh": comparison.total_kwh,
        "mean_daily_kwh": comparison.mean_daily_kwh,
        "daily_usage_varies_by_kwh": plans_mod.variability_kwh_per_day(days),
        # Cheapest first. The order carries meaning, so it is fixed here rather than left
        # to whatever order the catalogue happens to be declared in.
        "options": [_option(c) for c in comparison.ranked()],
        "current_plan_on_file": plan.name if plan else None,
        "current_plan_matched_to": comparison.current_plan_code,
        "cheapest_for_this_household": comparison.best_code,
        "saving_nzd_over_this_period": comparison.saving_nzd_per_period or None,
        "saving_nzd_per_year": comparison.saving_nzd_per_year or None,
        # null, not false, when the current plan could not be matched — see
        # `PlanComparison.material`. The difference is "we don't know" against "no".
        "worth_switching": comparison.material,
        "break_even_kwh_per_day": comparison.break_even_kwh_per_day,
        "break_even_between": list(comparison.break_even_between)
        if comparison.break_even_between
        else None,
        "headroom_kwh_per_day": comparison.headroom_kwh_per_day,
        "sensitivity": plans_mod.sensitivity(comparison),
        "cost_per_day_on_cold_days": comparison.winter_cost or None,
        "cost_per_day_on_mild_days": comparison.summer_cost or None,
        "caveats": comparison.caveats,
        "guidance": plans_mod.explain(comparison),
        "source": (
            "illustrative plan catalogue in app/analytics/plans.py, priced against this "
            f"household's own daily meter readings for {comparison.period}"
        ),
        "tariff_note": (
            "These are Kea's published plan rates, GST-inclusive — Anytime Rate, Time of "
            "Use and Free Weekends, the same three on the plans page. The usage is this "
            "household's own and so is the arithmetic. Quote the prices as real; do NOT "
            "call them illustrative. What each plan WOULD have cost is still an estimate "
            "over a past period, not a quote for a future one."
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


async def discover_smart_devices(ctx: ToolContext) -> dict[str, Any]:
    """What is on the API server's network, by listening to what it broadcasts.

    The one tool here that reads something other than the customer's account, and the
    guardrail is in the shape of the result rather than in the prompt: there is no energy
    field anywhere in it, because an mDNS announcement carries no power figure. A list of
    device names is exactly the raw material from which a plausible "your heat pump used
    about 40 kWh" could be assembled, so the result says in three separate places that it
    contains none.

    See `app/homelink/discovery.py` for what is scanned and why nothing is stored.
    """
    from app.homelink import discovery

    result = await discovery.discover()
    payload = discovery.summarise(result)

    if payload["error"]:
        return _unavailable(
            f"the network scan could not run: {payload['error']}. This is normal when the "
            "service is running somewhere other than the customer's own network — say so "
            "plainly rather than telling them they have no smart devices.",
            method=payload["method"],
        )

    if not payload["devices_found"]:
        return _unavailable(
            "no smart devices answered on this network. That does NOT mean they have "
            "none: this only sees the network this service is running on, so if they are "
            "using the app from somewhere else, or their devices are on a guest network, "
            "nothing will answer. Say what was scanned and why it may have found nothing, "
            "and offer to connect a platform account instead — that route works from "
            "anywhere.",
            scan_was_shallow=payload["scan_was_shallow"],
        )

    # A successful tool result must not carry an error key, even when its value is None.
    payload.pop("error")
    return {
        "available": True,
        **payload,
        "important": (
            "These are device NAMES ONLY. Nothing here carries energy, power or cost, and "
            "there is no way to work one out from a name — do not attach a kWh or a dollar "
            "figure to any of them, and do not use this list to answer 'what is using my "
            "power'. Use get_energy_breakdown for that."
        ),
        "guidance": (
            "Tell them what you found, grouped by platform rather than as a flat list — "
            "'three Google devices and a Home Assistant' is more useful than nine "
            "hostnames. Then say what connecting one would buy them: a connected device "
            "that reports its own energy is the only thing that lets you name an "
            "appliance at all. `platforms_worth_connecting` is the shortlist. If "
            "`scan_was_shallow` is true, say the scan was quick and may have missed "
            "devices that were asleep."
        ),
        "source": "mDNS announcements on the API server's local network, app/homelink/discovery.py",
    }


def get_energy_breakdown(ctx: ToolContext) -> dict[str, Any]:
    """The honest half of "what's using all my power".

    This is the tool that turns the product's central limitation into an answer. The rule
    that a whole-house meter cannot identify an appliance is unchanged and unchangeable —
    but it was being used to refuse a question that *is* answerable at the level of
    behaviour, which is the level the customer can act on anyway. Nobody switches off
    "the fridge"; they switch off the standing load.

    See `app/analytics/disaggregation.py` for why each category is a measurement rather
    than an inference, and for the one category that is deliberately not decomposed.
    """
    from app.analytics import disaggregation

    days = billed_days(ctx)
    if not days:
        return _unavailable("no daily usage rows for this account")

    connection = ctx.account.connection
    breakdown = disaggregation.split(
        days,
        period=ctx.usage.window.period,
        unit_price_nzd=ctx.usage.window.unit_price_nzd,
        has_controlled_load=bool(connection and connection.has_controlled_load),
        heating_sensitivity_kwh_per_hdd=ctx.account.heating_sensitivity_kwh_per_hdd,
    )

    if not breakdown.available:
        return _unavailable(breakdown.reason or "a breakdown is not possible for this account")

    return {
        "available": True,
        "period": breakdown.period,
        "days": breakdown.days,
        "total_kwh": breakdown.total_kwh,
        "total_cost_nzd": breakdown.total_cost_nzd,
        "categories": [
            _prune(
                {
                    "key": s.key,
                    "label": s.label,
                    "kwh": s.kwh,
                    "cost_nzd": s.cost_nzd,
                    "share_of_bill_pct": s.share_pct,
                    "confidence": s.confidence.value,
                    "how_this_was_worked_out": s.basis,
                    "caveat": s.caveat or None,
                    "detail": s.detail or None,
                }
            )
            for s in breakdown.slices
        ],
        "largest_identified_category": (
            breakdown.largest.key if breakdown.largest else None
        ),
        "heating_fit_r_squared": breakdown.heating_fit_r2,
        "heating_not_reported_because": breakdown.heating_not_reported_because,
        "always_on_not_reported_because": breakdown.always_on_not_reported_because,
        "caveats": breakdown.caveats,
        "guidance": disaggregation.explain(breakdown),
        "source": (
            "this household's own daily meter readings, split by "
            "app/analytics/disaggregation.py"
        ),
        "tariff_note": tariff_note(ctx),
    }


async def get_connected_device_energy(ctx: ToolContext) -> dict[str, Any]:
    from app.config import get_observation_store
    from app.homelink.insights import appliance_caveats, summarise

    rows = await get_observation_store().list(ctx.customer_id)
    if not rows:
        return _unavailable("no connected device energy sensor has reported for this household")
    latest = max(row.day for row in rows)
    since = latest - dt.timedelta(days=29)
    observations = [row for row in rows if since <= row.day <= latest]
    days = [day for day in ctx.account.days if since <= day.date <= latest]
    bill_kwh = sum(day.import_kwh for day in days) if len(days) == 30 else None
    summaries = summarise(
        observations,
        unit_price_nzd=ctx.usage.window.unit_price_nzd,
        total_bill_kwh=bill_kwh,
    )
    return {
        "available": True,
        "period_start": since.isoformat(),
        "period_end": latest.isoformat(),
        "devices": [summary.model_dump(mode="json") for summary in summaries],
        "caveats": appliance_caveats(summaries),
        "source": "connected device energy sensors, aggregated to complete days",
        "guidance": (
            "Quote measured device kWh only for MEASURED devices. RATED is a nameplate "
            "estimate and must be called an estimate. INFERRED carries no energy claim. "
            "These devices are only a partial view of household electricity."
        ),
    }


def search_help_topics(
    ctx: ToolContext, question: str, topic: str | None = None
) -> dict[str, Any]:
    """Reference material for the questions the meter cannot answer.

    Returns facts, never prose. The corpus deliberately holds no stored answer — see
    `app/knowledge/__init__.py` — because an assistant that pastes a paragraph per topic is
    the twenty-six-intent router rebuilt in a new place, and it produces the same symptom:
    one canned response regardless of what was actually asked.

    An empty result is a first-class outcome. Below the retrieval floor this returns
    nothing rather than the least-bad article, so a question the corpus does not cover
    produces "I don't have anything on that" instead of a confident answer built out of an
    article about something else — a failure the customer has no way to detect.
    """
    from app.knowledge import TOPICS, search

    if topic and topic not in TOPICS:
        return {
            "error": f"unknown topic {topic!r}",
            "valid_topics": list(TOPICS),
            "hint": "Omit `topic` to search everything.",
        }

    hits = search(question, topic=topic)
    if not hits:
        return _unavailable(
            "nothing in the help material covers that. Say plainly that you do not have "
            "information on it rather than answering from general knowledge — you have no "
            "source for Kea's policies beyond what these articles carry. Answer any part "
            "of the question the account data CAN answer, and offer the team for the rest.",
            searched_for=question,
            topics_available=list(TOPICS),
        )

    articles = []
    for hit in hits:
        article = hit.article
        articles.append(
            _prune(
                {
                    "id": article.id,
                    "topic": article.topic,
                    "title": article.title,
                    "facts": [
                        _prune(
                            {
                                "fact": f.text,
                                "basis": f.basis.value,
                                "how_to_say_it": f.basis.how_to_say_it,
                                "customer_can_check_with": f.source or None,
                                "check_before_relying_on_the_detail": True
                                if f.verify
                                else None,
                            }
                        )
                        for f in article.facts
                    ],
                    "this_does_not_answer": article.not_covered or None,
                    "what_you_can_do_about_it": article.action or None,
                    "related_topics": list(article.see_also) or None,
                    "matched_on": hit.matched,
                }
            )
        )

    verify_count = sum(1 for h in hits for f in h.article.facts if f.verify)

    return {
        "available": True,
        "question_searched": question,
        "articles": articles,
        "guidance": (
            "These are facts to reason from, not an answer to repeat. Write the reply to "
            "what THIS customer asked, in their words, at the length their question "
            "deserves — most of these articles could answer five different questions and "
            "you are answering one of them.\n"
            "Read `basis` on every fact before you use it. A `regulation` fact applies to "
            "every retailer and you may name the body they can check it with. A "
            "`product` fact is how this system behaves and you may state it directly. A "
            "`kea_illustrative` fact is an EXAMPLE of how retailers normally do this and "
            "is NOT Kea's actual policy — say so, and point them at their own terms or the "
            "team. Never present an illustrative fact as Kea's.\n"
            "`this_does_not_answer` is the limit of the article. Respect it: it is usually "
            "the exact thing the customer is about to assume you said.\n"
            "If `what_you_can_do_about_it` names a tool, use the tool instead of describing "
            "where a settings screen is. Doing it is the answer; directions are not.\n"
            "Where the question ALSO touches this household's own data, look that up too "
            "and answer with both — the general rule and their actual number."
            + (
                "\nSome facts here are marked to check before relying on the detail. Their "
                "shape is stable but the number or date moves; hedge those specifically "
                "rather than hedging the whole answer."
                if verify_count
                else ""
            )
        ),
        "source": "Kea help knowledge base, app/knowledge/articles.py",
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


async def update_alert_settings(
    ctx: ToolContext,
    channel: str | None = None,
    threshold_pct: float | None = None,
    minimum_nzd: float | None = None,
    turn_on: list[str] | None = None,
    turn_off: list[str] | None = None,
    quiet_from_hour: int | None = None,
    quiet_until_hour: int | None = None,
    warnings_enabled: bool | None = None,
) -> dict[str, Any]:
    """Change this household's alerting. The first tool here that writes anything.

    Scoped the same way every read is: the account comes off `ctx`, never off an argument,
    so there is no value the model can pass that reaches another household's settings.
    That property is what makes a write tool safe to offer at all, and it is structural
    rather than prompted.

    Returns the diff and the whole ladder. The diff so the customer can catch a
    misunderstanding in the sentence that caused it — "your text alert now fires at 20%,
    down from 40%" is checkable and "done" is not. The ladder because one threshold means
    nothing alone: somebody who moves their text alert to 20% needs to see the email alert
    still sitting at 15%, or they will expect the text to be the first thing they hear.
    """
    from app.account import settings as settings_mod
    from app.config import get_preferences_store

    store = get_preferences_store()
    current = await store.get(ctx.customer_id)

    try:
        updated, changes = settings_mod.build(
            current,
            channel=channel,
            threshold_pct=threshold_pct,
            minimum_nzd=minimum_nzd,
            turn_on=turn_on,
            turn_off=turn_off,
            quiet_from_hour=quiet_from_hour,
            quiet_until_hour=quiet_until_hour,
            warnings_enabled=warnings_enabled,
        )
    except settings_mod.SettingsError as exc:
        return {"error": str(exc), "current_settings": settings_mod.ladder_after(current)}
    except Exception as exc:  # noqa: BLE001 - Pydantic's message is the useful part
        # The monotonic-ladder rule lands here: a text alert below the email alert is
        # individually valid and jointly incoherent, and the validator's own wording is
        # more useful to the model than anything this layer could paraphrase.
        return {
            "error": f"those settings are not a coherent ladder: {exc}",
            "hint": (
                "Warnings must escalate: email at or below text, text at or below the "
                "phone call. Offer to move the others too rather than refusing outright."
            ),
            "current_settings": settings_mod.ladder_after(current),
        }

    if not changes:
        return {
            "changed": False,
            "reason": "every setting they asked for is already set that way",
            "current_settings": settings_mod.ladder_after(current),
            "guidance": (
                "Nothing changed because nothing needed to. Tell them it is already set "
                "that way and show them the value — do not confirm a change that did not "
                "happen."
            ),
        }

    saved = await store.put(updated)
    log.info(
        "settings changed customer=%s fields=%s",
        ctx.customer_id,
        [c.field for c in changes],
    )

    ladder = settings_mod.ladder_after(saved)
    warnings: list[str] = []
    if saved.sms_enabled and not saved.phone_e164:
        warnings.append(
            "Text warnings are on but there is no mobile number on this account, so "
            "nothing can actually be sent. Tell them, and tell them the team can add one."
        )
    if saved.voice_enabled and not saved.phone_e164:
        warnings.append(
            "Phone warnings are on but there is no number on file. Tell them."
        )
    if saved.email_enabled and not saved.email:
        warnings.append(
            "Email warnings are on but there is no address on this account."
        )
    if not saved.enabled:
        warnings.append(
            "Every warning is now off. Say so plainly — the bill-shock assessment still "
            "runs and is still visible in the app, but nothing will reach them "
            "unprompted, which is the whole point of the product."
        )

    return {
        "changed": True,
        "what_changed": [c.describe() for c in changes],
        "current_settings": ladder,
        "warnings": warnings or None,
        "guidance": (
            "Say back exactly what you changed and what the whole ladder is now — a "
            "customer who asked for 20% and reads 'your text warning now fires at 20% "
            "over, and your email one is still at 15%' can catch you having changed the "
            "wrong thing. Keep it to a sentence or two; this is a settings change, not an "
            "explanation. Anything in `warnings` matters more than the change itself and "
            "goes first."
        ),
        "source": "this household's own alert preferences, app/alerts/store.py",
    }


async def request_plan_change(
    ctx: ToolContext, plan_code: str, confirm: bool = False
) -> dict[str, Any]:
    """Stage a plan switch, then record it once the customer has confirmed.

    Two calls, deliberately. The staged half returns what the change would mean and asks
    the model to put it to the customer; only a second call, after they have said yes,
    records anything. "Put me on the cheaper one" is a request and not a confirmation, and
    the difference is the whole reason this tool is not one call.

    It records a *request*. The account's plan lives in `kea.mart_account_context`, which
    the data platform owns and this service reads — and a plan switch is a commercial event
    with a billing effective date, applied from the next period rather than mid-cycle. So
    this does what a retailer does: writes down what was asked for, with the figure the
    customer was shown when they agreed to it.
    """
    from app.account import changes as changes_mod
    from app.analytics import plans as plans_mod
    from app.config import get_change_store, get_pending_changes

    pending = get_pending_changes()

    target = next((p for p in plans_mod.CATALOGUE if p.code == plan_code), None)
    if target is None:
        return {
            "error": f"no plan with code {plan_code!r}",
            "available_plans": [p.code for p in plans_mod.CATALOGUE],
            "hint": "Use the `code` field from get_plan_options.",
        }

    if confirm:
        staged = pending.take(ctx.customer_id)
        if staged is None:
            return _unavailable(
                "there is no staged plan change to confirm — it was never staged, it has "
                "already been confirmed, or it expired. Stage it again by calling this "
                "without confirm, tell the customer what it would mean, and ask them.",
            )
        if staged.to_plan_code != plan_code:
            # The customer confirmed a different plan from the one now being recorded. A
            # mismatch here means the model has lost track mid-conversation, and recording
            # either one would be recording a consent nobody gave.
            pending.clear(ctx.customer_id)
            return {
                "error": (
                    f"the staged change was to {staged.to_plan_code!r} but this "
                    f"confirmation is for {plan_code!r}"
                ),
                "hint": (
                    "The staged change has been cancelled. Stage the one they actually "
                    "want and ask them again."
                ),
            }

        recorded = await get_change_store().record(
            changes_mod.PlanChangeRequest(
                account_ref=ctx.customer_id,
                from_plan=staged.from_plan,
                to_plan_code=staged.to_plan_code,
                to_plan_name=staged.to_plan_name,
                quoted_saving_nzd_per_year=staged.quoted_saving_nzd_per_year,
                quoted_from_period=staged.quoted_from_period,
            )
        )
        log.info(
            "plan change confirmed customer=%s from=%s to=%s",
            ctx.customer_id, staged.from_plan, staged.to_plan_code,
        )
        return {
            "recorded": True,
            "to_plan": staged.to_plan_name,
            "from_plan": staged.from_plan,
            "status": recorded.status,
            "takes_effect": "from the start of their next billing period",
            "guidance": (
                "Confirm it in one or two sentences: which plan, and that it takes effect "
                "from their next billing period rather than today. Do NOT say they are on "
                "the new plan now — they are not, and their next bill will still be on the "
                "old one for the days already used. Tell them the team will action it and "
                "that they can change their mind by asking."
            ),
            "source": "recorded against this account, app/account/changes.py",
        }

    # --- staging ---
    days = billed_days(ctx)
    account = ctx.account
    plan = account.plan
    connection = account.connection

    comparison = plans_mod.compare(
        days,
        period=ctx.usage.window.period,
        plan_name=plan.name if plan else None,
        plan_code=plan.code if plan else None,
        plan_user_type=plan.user_type if plan else None,
        has_solar=bool(connection and connection.has_solar),
        has_controlled_load=bool(connection and connection.has_controlled_load),
        weekend_free_share=ctx.account.weekend_free_share,
    )

    if not comparison.available:
        return _unavailable(
            f"this account cannot be compared against the plan catalogue, so a switch "
            f"cannot be quoted: {comparison.reason}"
        )

    target_cost = next((c for c in comparison.costs if c.plan.code == plan_code), None)
    if target_cost is None:
        return _unavailable(
            f"{target.name} could not be priced for this household, so switching to it "
            "cannot be quoted. This is usually because the plan needs data this account "
            "does not have — a time-of-use plan needs a peak / off-peak split. Say which "
            "plan and why, and do not stage a change you cannot put a figure on.",
            plans_that_can_be_priced=[c.plan.code for c in comparison.costs],
        )

    current_cost = next(
        (c for c in comparison.costs if c.plan.code == comparison.current_plan_code), None
    )
    saving_year = None
    if current_cost is not None:
        saving_year = round(
            plans_mod.annualise(
                current_cost.total_nzd, comparison.days, plans_mod.winter_share(days)
            )
            - plans_mod.annualise(
                target_cost.total_nzd, comparison.days, plans_mod.winter_share(days)
            ),
            2,
        )

    import time

    pending.stage(
        changes_mod.Staged(
            account_ref=ctx.customer_id,
            to_plan_code=target.code,
            to_plan_name=target.name,
            from_plan=plan.name if plan else None,
            quoted_saving_nzd_per_year=saving_year,
            quoted_from_period=comparison.period,
            expires_at=time.monotonic() + changes_mod.PENDING_TTL_SECONDS,
        )
    )

    return {
        "staged": True,
        "confirmed": False,
        "to_plan": _prune(
            {
                "code": target.code,
                "name": target.name,
                "daily_fixed_nzd": target.daily_fixed_nzd,
                "unit_rate_nzd_per_kwh": target.unit_rate_nzd,
                "off_peak_rate_nzd_per_kwh": target.off_peak_rate_nzd,
                "cost_over_this_period_nzd": target_cost.total_nzd,
            }
        ),
        "from_plan": plan.name if plan else None,
        "saving_nzd_per_year": saving_year,
        "would_be_cheaper": (
            None
            if current_cost is None
            else target_cost.total_nzd < current_cost.total_nzd
        ),
        "priced_over": comparison.period,
        "caveats": comparison.caveats,
        "expires_in_seconds": changes_mod.PENDING_TTL_SECONDS,
        "guidance": (
            "NOTHING HAS CHANGED YET. Tell them what switching would mean — the plan, the "
            "rates, what it would have cost over the period you priced, and whether that "
            "is more or less than what they are on — and then ask them plainly to confirm. "
            "Do not call this again with confirm=true until they answer in a LATER "
            "message; the message that asked for the switch is not the confirmation. If "
            "`saving_nzd_per_year` is null, their current plan could not be matched, so "
            "say you cannot tell them whether it would save money and let them decide. If "
            "`would_be_cheaper` is false, say so — they may still want it, but they must "
            "not find out afterwards."
        ),
        "source": "app/analytics/plans.py, priced on this household's own usage",
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

async def get_power_clash_progress(ctx: ToolContext) -> dict:
    from app.experience import experience_store

    progress = await experience_store().progress(ctx.customer_id)
    return {"available": True, "source": "Household action receipt ledger",
            "disclosure": "Planning is not verified performance. XP is not cash. "
            "Tariff-shift estimates are not a causal measurement of lower total bills.",
            **progress.model_dump(mode="json")}


async def get_scheduled_outages(ctx: ToolContext) -> dict:
    from app.experience import experience_store

    view = await experience_store().outage(ctx.customer_id)
    return {
        "available": view.status == "current",
        "reason": None if view.status == "current" else (
            "No linked distributor schedule." if view.status == "not_linked"
            else "The distributor snapshot is stale; check the source."
        ),
        "source": "Linked distributor snapshot",
        "disclosure": (
            "Confirm changes with the distributor; unexpected outages remain possible."
        ),
        **view.model_dump(mode="json"),
    }


_SYNC = {
    "get_account_summary": get_account_summary,
    "get_daily_usage": get_daily_usage,
    "get_bill_comparison": get_bill_comparison,
    "compare_to_similar_homes": compare_to_similar_homes,
    "get_plan_options": get_plan_options,
    "project_this_bill": project_this_bill,
    "handoff_to_human": handoff_to_human,
    "answer_clarifying_question": answer_clarifying_question,
    "search_help_topics": search_help_topics,
    "get_energy_breakdown": get_energy_breakdown,
}
_ASYNC = {
    "get_power_clash_progress": get_power_clash_progress,
    "get_scheduled_outages": get_scheduled_outages,
    "get_hourly_profile": get_hourly_profile,
    # The write tools. Async because they touch a store, and grouped here rather than
    # marked out further because `app/account/` is where the read/write boundary is
    # enforced — see that package's docstring.
    "update_alert_settings": update_alert_settings,
    "request_plan_change": request_plan_change,
    # Not a write, but it does I/O off the machine and takes seconds rather than
    # milliseconds, so it belongs on the async side of the dispatcher.
    "discover_smart_devices": discover_smart_devices,
    "get_connected_device_energy": get_connected_device_energy,
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
