"""Account-scoped read tools using the same facts and analytics as mobile pages.

No HTTP route calls: a dashboard GET may send alerts, whereas a chat lookup must not.
Missing invoice/payment/interval facts remain missing. None of these tools writes data.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.agent.tools import ToolContext


def _missing(reason: str, **extra: Any) -> dict[str, Any]:
    return {"available": False, "reason": reason, **extra}


def _dates(ctx: ToolContext) -> tuple[dt.date | None, dt.date | None]:
    days = sorted(day.date for day in ctx.account.days)
    if days:
        return days[0], days[-1]
    first, last = ctx.usage.period_start, ctx.usage.period_end
    return (
        first if isinstance(first, dt.date) else None,
        last if isinstance(last, dt.date) else None,
    )


def get_usage_history(
    ctx: ToolContext, start_date: str | None = None, end_date: str | None = None
) -> dict[str, Any]:
    from app.analytics.usage_series import from_context
    from app.config import get_repository

    first, last = _dates(ctx)
    if first is None or last is None:
        return _missing("No dated meter readings are available for this account.")
    try:
        end = dt.date.fromisoformat(end_date) if end_date else last
        start = (
            dt.date.fromisoformat(start_date)
            if start_date
            else max(first, end - dt.timedelta(days=365))
        )
    except ValueError:
        return {"error": "Use an exact ISO date (YYYY-MM-DD); do not guess the requested dates."}
    if end < start or (end - start).days > 365:
        return {"error": "Choose an ordered date range of at most 366 days."}
    view = from_context(
        ctx.customer_id,
        ctx.usage,
        start,
        end,
        demo_intervals=get_repository().name == "fixtures",
    )
    if not view.daily_dates:
        return _missing(
            "No complete days exist in that range; missing readings are not zero usage.",
            available_from=first.isoformat(),
            available_to=last.isoformat(),
        )
    complete_range = len(view.daily_dates) == (end - start).days + 1
    bands = {}
    for name in ("peak", "off_peak", "night"):
        values = getattr(view, f"daily_{name}_kwh")
        complete = complete_range and all(value is not None for value in values)
        bands[name] = {"complete": complete, "kwh": round(sum(values), 4) if complete else None}
    return {
        "available": True,
        **view.model_dump(mode="json"),
        "bands": bands,
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "complete_range": complete_range,
        "source": f"Household usage-series analytics ({view.date_source})",
        "guidance": (
            "Label demo/estimated data. Band totals require every selected day's band; "
            "null means unavailable, never zero. Missing days exclude a full-period total. "
            "Blended energy cost is an estimate, not an invoice or a time-of-use saving."
        ),
    }


async def get_hourly_usage(ctx: ToolContext, day: str | None = None) -> dict[str, Any]:
    from app.analytics.hourly_usage import load_hourly
    from app.config import get_repository

    _, last = _dates(ctx)
    try:
        selected = dt.date.fromisoformat(day) if day else last
    except ValueError:
        return {"error": "Use an exact ISO date (YYYY-MM-DD)."}
    if selected is None:
        return _missing("No dated interval readings are available.")
    view = await load_hourly(ctx.customer_id, selected, ctx.usage, get_repository().name)
    if not any(slot.kwh is not None for slot in view.hours):
        return _missing(view.note, **view.model_dump(mode="json"))
    return {
        "available": True,
        **view.model_dump(mode="json"),
        "source": f"Dated household hourly analytics ({view.source})",
        "guidance": (
            "These are this date's hours, not a monthly average. Report missing/estimated "
            "hours and repeated DST hours by their timezone. Demo hours are synthetic, "
            "not observed behaviour. An hour cannot identify an appliance."
        ),
    }


async def get_billing_records(ctx: ToolContext) -> dict[str, Any]:
    from app.account.invoices import history

    records = await history(ctx.customer_id)
    if records == []:
        return _missing("No issued invoices exist through the served as-of date.")
    if records:
        return {
            "available": True,
            "bills": [row.model_dump(mode="json") for row in records],
            "source": "Serving invoice history and successful payment records",
            "guidance": "These are issued invoice records through the served as-of date. "
            "Quote their exact period, due date and outstanding amount. "
            "Do not infer individual appliances from invoice totals.",
        }
    bills = [
        {
            "position": position,
            "label": bill.label,
            "days": bill.days,
            "total_nzd": bill.total_nzd,
            "total_kwh": bill.total_kwh,
            "charge_lines_available": False,
        }
        for position, bill in (
            ("current", ctx.account.current_bill),
            ("previous", ctx.account.prior_bill),
        )
        if bill is not None
    ]
    if not bills:
        return _missing(
            "No issued invoice records are available; a usage estimate is not an invoice."
        )
    return {
        "available": True,
        "bills": bills,
        "source": "Account repository current/prior bill facts",
        "guidance": (
            "These are invoice aggregates only. Actual charge lines, export credits, "
            "adjustment reasons and invoice read-quality were not loaded; their "
            "default-zero analytic fields are not evidence and are not returned. "
            "Do not infer payment status or a payment history from invoice totals. "
            "Account balance/due date come from get_account_summary. No full invoice "
            "archive, payment transaction ledger or downloadable document is supplied."
        ),
    }


def get_plan_details(ctx: ToolContext) -> dict[str, Any]:
    from app.account.mobile_plans import mobile_plans

    view = mobile_plans(ctx.account)
    return {
        "available": True,
        **view.model_dump(mode="json"),
        "source": "Shared mobile plan catalogue, docs/sprints/sprint-3/plans-and-terms.md",
        "guidance": (
            "This is the same offer catalogue as Plans. A catalogue offer is not proof "
            "of the customer's contracted time-of-use rates, eligibility or exit fee. "
            "Read get_account_summary for their actual plan and get_plan_options for "
            "meter-priced comparisons; never apply an unconfirmed offer to their account. "
            "Term credits are conditional, separate from usage savings. The assistant "
            "can stage a pricing-style change with request_plan_change; it cannot choose "
            "a commitment term, activate supply or guarantee retailer fulfilment."
        ),
    }


async def get_alert_status(ctx: ToolContext) -> dict[str, Any]:
    from app.account.settings import ladder_after
    from app.analytics import billshock
    from app.analytics.billing_context import cycle_days, own_history
    from app.config import get_preferences_store, settings

    prefs = await get_preferences_store().get(ctx.customer_id)
    recent, last_year = own_history(ctx.usage)
    assessment = billshock.assess(
        ctx.usage.window,
        days_in_cycle=cycle_days(ctx.usage),
        daily_hdd=ctx.usage.hdd,
        normal_hdd_per_day=ctx.usage.normal_hdd,
        comparable_home_kwh_per_day=ctx.usage.baseline,
        preferences=prefs,
        recent_cycle_costs_nzd=recent,
        same_period_last_year_nzd=last_year,
    )
    return {
        "available": True,
        "settings": ladder_after(prefs),
        "timezone": prefs.timezone,
        "bill_reminders": prefs.bill_reminders,
        "assessment": asdict(assessment),
        "delivery_enabled": settings.alerts_enabled and settings.persist,
        "source": "Household preferences and shared deterministic bill-shock assessment",
        "guidance": (
            "Read-only: this lookup sends no email, SMS or call. An enabled preference "
            "or triggered assessment does not prove delivery. No delivery receipts "
            "were read; do not claim an alert was sent or explain a particular failed "
            "delivery without its receipt. Respect missing destinations, disabled "
            "gateways and quiet hours. A projected energy cost is not an issued bill."
        ),
    }
