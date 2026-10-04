"""Real tool evidence for normal account questions, not a canned model-answer test."""

import datetime as dt
import json
from dataclasses import replace
from pathlib import Path

import pytest
from fakes import ScriptedProvider

from app.agent import loop
from app.agent.tools import dispatch
from app.alerts.preferences import defaults_for
from app.analytics.account import DayUsage
from app.analytics.drivers import BillPeriod
from app.analytics.hourly_usage import hourly_slots
from app.config import get_preferences_store
from app.knowledge import search
from app.pipeline import build_context

READ_TOOLS = (
    "get_usage_history",
    "get_hourly_usage",
    "get_billing_records",
    "get_plan_details",
    "get_alert_status",
)


@pytest.fixture
async def ctx():
    return await build_context("H-JUL")


@pytest.mark.parametrize("tool", READ_TOOLS)
async def test_new_read_tools_reject_foreign_account_arguments(ctx, tool):
    denied = await dispatch(ctx, tool, {"customer_id": "H-COLD"})
    assert "error" in denied
    result = await dispatch(ctx, tool, {})
    assert "error" not in result
    json.dumps(result, default=str)


async def test_dated_history_matches_chart_and_labels_demo(ctx):
    view = await dispatch(
        ctx,
        "get_usage_history",
        {
            "start_date": "2026-07-01",
            "end_date": "2026-07-07",
        },
    )
    assert view["complete_range"]
    assert view["total_kwh"] == round(sum(ctx.usage.window.daily_kwh[:7]), 2)
    assert view["band_data_source"] == "demo"
    assert view["daily_quality"] == ["demo"] * 7
    assert sum(item["kwh"] for item in view["bands"].values()) == pytest.approx(
        view["total_kwh"],
        abs=0.02,
    )


async def test_missing_day_and_band_are_not_filled(ctx):
    start = dt.date(2026, 7, 1)
    days = [
        DayUsage(date=start, import_kwh=10, peak_kwh=3, off_peak_kwh=4, night_kwh=3),
        DayUsage(
            date=start + dt.timedelta(days=2),
            import_kwh=20,
            peak_kwh=None,
            off_peak_kwh=8,
            night_kwh=6,
        ),
    ]
    account = replace(ctx.account, days=days)
    ctx = replace(ctx, account=account, usage=replace(ctx.usage, account=account))
    result = await dispatch(
        ctx,
        "get_usage_history",
        {
            "start_date": "2026-07-01",
            "end_date": "2026-07-03",
        },
    )
    assert not result["complete_range"]
    assert result["total_kwh"] == 30
    assert result["bands"]["peak"] == {"complete": False, "kwh": None}
    assert result["bands"]["off_peak"] == {"complete": False, "kwh": None}
    assert result["bands"]["night"] == {"complete": False, "kwh": None}
    assert result["daily_dates"] == ["2026-07-01", "2026-07-03"]


@pytest.mark.parametrize(
    "arguments",
    [
        {"start_date": "yesterday"},
        {"start_date": "2026-08-02", "end_date": "2026-08-01"},
        {"start_date": "2020-01-01", "end_date": "2026-07-31"},
    ],
)
async def test_bad_date_ranges_are_rejected(ctx, arguments):
    assert "error" in await dispatch(ctx, "get_usage_history", arguments)


async def test_historic_data_is_not_relabelled_as_today(ctx):
    view = await dispatch(
        ctx,
        "get_usage_history",
        {
            "start_date": "2026-10-04",
            "end_date": "2026-10-04",
        },
    )
    assert view["available"] is False and view["available_to"] == "2026-07-31"
    hours = await dispatch(ctx, "get_hourly_usage", {"day": "2026-10-04"})
    assert hours["available"] is False
    assert all(hour["kwh"] is None for hour in hours["hours"])


async def test_dated_hours_keep_demo_evidence(ctx):
    view = await dispatch(ctx, "get_hourly_usage", {"day": "2026-07-02"})
    assert view["day"] == "2026-07-02" and view["source"].endswith("(demo)")
    assert len(view["hours"]) == 24
    assert all(hour["quality"] == "demo" for hour in view["hours"])
    assert sum(hour["kwh"] for hour in view["hours"]) == pytest.approx(
        ctx.usage.window.daily_kwh[1],
        abs=0.002,
    )


async def test_hourly_tool_preserves_dst_and_missing_hours(ctx, monkeypatch):
    from app.analytics import hourly_usage
    from app.schemas import HouseholdHourlyUsage

    day = dt.date(2026, 4, 5)
    start, end = hourly_usage.day_bounds(day)
    rows = [
        (1, start + dt.timedelta(minutes=30 * i), 0.5, "actual")
        for i in range(int((end - start).total_seconds() / 1800))
        if i != 0
    ]
    hours = hourly_slots(day, rows, {1})

    async def read(customer, requested, usage, repository):
        assert customer == ctx.customer_id and requested == day and usage is ctx.usage
        return HouseholdHourlyUsage(
            customer_id=customer,
            day=day,
            source="intervals",
            note="Measured",
            hours=hours,
        )

    monkeypatch.setattr(hourly_usage, "load_hourly", read)
    view = await dispatch(ctx, "get_hourly_usage", {"day": day.isoformat()})
    assert len(view["hours"]) == 25 and view["hours"][0]["kwh"] is None
    assert {hour["label"] for hour in view["hours"] if hour["label"].startswith("02:")} == {
        "02:00 NZST",
        "02:00 NZDT",
    }


async def test_invoice_facts_never_invent_payment_status(ctx):
    assert (await dispatch(ctx, "get_billing_records", {}))["available"] is False
    bill = BillPeriod(
        label="July",
        days=31,
        total_nzd=108,
        total_kwh=300,
        unit_rate_nzd=0.3,
        daily_fixed_nzd=1,
        export_credit_nzd=13,
    )
    ctx.account = replace(ctx.account, current_bill=bill)
    result = await dispatch(ctx, "get_billing_records", {})
    assert "export_credit_nzd" not in result["bills"][0]
    assert "one_off_nzd" not in result["bills"][0]
    assert "daily_fixed_nzd" not in result["bills"][0]
    assert "estimated_read_pct" not in result["bills"][0]
    assert result["bills"][0]["charge_lines_available"] is False
    assert result["bills"][0]["total_nzd"] == 108
    assert "paid" not in result["bills"][0] and "status" not in result["bills"][0]


async def test_plan_details_match_mobile_without_inventing_current_contract(ctx):
    from app.account.mobile_plans import mobile_plans

    result = await dispatch(ctx, "get_plan_details", {})
    expected = mobile_plans(ctx.account).model_dump(mode="json")
    assert result["pricing_styles"] == expected["pricing_styles"]
    assert result["commitment_terms"] == expected["commitment_terms"]
    assert result["current_plan"]["pricing_style"] is None
    assert "conditional" in result["guidance"]


async def test_warning_read_uses_current_settings_without_sending_or_mutating(ctx, monkeypatch):
    from app.alerts.service import AlertDispatcher
    from app.analytics import billshock
    from app.analytics.billing_context import cycle_days, own_history

    async def forbidden(*args, **kwargs):
        raise AssertionError("A chat read must not send a notification")

    monkeypatch.setattr(AlertDispatcher, "dispatch", forbidden)
    prefs = defaults_for(ctx.customer_id).model_copy(update={"enabled": False, "tier2_pct": 25})
    store = get_preferences_store()
    await store.put(prefs)
    before = (await store.get(ctx.customer_id)).model_dump()
    result = await dispatch(ctx, "get_alert_status", {})
    recent, last_year = own_history(ctx.usage)
    expected = billshock.assess(
        ctx.usage.window,
        days_in_cycle=cycle_days(ctx.usage),
        daily_hdd=ctx.usage.hdd,
        normal_hdd_per_day=ctx.usage.normal_hdd,
        comparable_home_kwh_per_day=ctx.usage.baseline,
        preferences=prefs,
        recent_cycle_costs_nzd=recent,
        same_period_last_year_nzd=last_year,
    )
    assert result["settings"]["sms"]["fires_at_pct_over"] == 25
    assert result["assessment"]["forecast"]["projected_cost_nzd"] == expected.projected_cost_nzd
    assert not result["settings"]["warnings_enabled"]
    assert (await store.get(ctx.customer_id)).model_dump() == before
    assert (await store.get("H-COLD")).tier2_pct == 40
    get_preferences_store.cache_clear()


@pytest.mark.parametrize(
    "utc_at, expected_date",
    [
        ("2026-09-26T11:59:00+00:00", "2026-09-26"),
        ("2026-09-26T12:01:00+00:00", "2026-09-27"),
        ("2026-09-27T11:01:00+00:00", "2026-09-28"),
    ],
)
async def test_trusted_nz_date_reaches_first_and_followup_turn(
    ctx, monkeypatch, utc_at, expected_date
):
    fixed = dt.datetime.fromisoformat(utc_at)

    class Clock(dt.datetime):
        @classmethod
        def now(cls, zone=None):
            return fixed.astimezone(zone)

    monkeypatch.setattr(loop.dt, "datetime", Clock)
    provider = ScriptedProvider(rounds=[])
    await loop.answer_once(
        provider,
        ctx,
        "what about yesterday",
        history=[
            {"role": "user", "content": "show this week"},
            {"role": "assistant", "content": "Here is the available period."},
        ],
    )
    assert (
        f"Current date in Pacific/Auckland: {expected_date}"
        in provider.calls[0]["messages"][-1]["content"]
    )


def test_every_visible_help_question_has_reference_material():
    import re

    root = Path(__file__).resolve().parents[3]
    content = (root / "services/mobile/src/lib/help-content.ts").read_text()
    questions = re.findall(r"question: '([^']+)'", content)
    assert len(questions) >= 15
    for question in questions:
        assert search(question), f"Missing service reference for {question}"
    assert search("How often will Kea send warnings?")[0].article.id == "bill-shock-alerts"


@pytest.mark.parametrize(
    "question, article",
    [
        (
            "Help me plan EV charging using my actual off-peak tariff, "
            "departure time and battery target.",
            "ev-solar-battery",
        ),
        ("Help me prepare safely for a scheduled power outage.", "outages"),
        ("Why didn't I get points in Power Clash?", "power-clash"),
        ("Can you read my bill photo?", "bill-uploads"),
        ("Is the battery full?", "ev-solar-battery"),
    ],
)
def test_page_questions_find_relevant_service_facts(question, article):
    assert article in {hit.article.id for hit in search(question)}
