"""The write tools: what the assistant may change, and what it must ask about first.

Every other tool in this system is a read. These two are not, and the property that makes
them dangerous — that a second call is not free — is invisible at the call site. So the
tests here are about the guard rails rather than the happy path: the ladder that must stay
in order, the confirmation that cannot be skipped, the change that must be said back, and
the plan that is requested rather than applied.
"""

from __future__ import annotations

import pytest

from app.account import settings as settings_mod
from app.account.changes import PENDING_TTL_SECONDS, MemoryChangeStore, PendingChanges, Staged
from app.agent.tools import dispatch
from app.alerts.preferences import defaults_for
from app.config import get_change_store, get_pending_changes, get_preferences_store
from app.pipeline import build_context


@pytest.fixture
async def ctx():
    return await build_context("H-JUL")


@pytest.fixture(autouse=True)
def _isolated_stores():
    """Each test gets fresh stores. The preference store is a process-lifetime singleton
    when persistence is off, so without this a threshold set in one test is still set in
    the next and the failures land somewhere else entirely."""
    get_preferences_store.cache_clear()
    get_change_store.cache_clear()
    get_pending_changes.cache_clear()
    yield
    get_preferences_store.cache_clear()
    get_change_store.cache_clear()
    get_pending_changes.cache_clear()


# ---------- alert settings ----------


async def test_a_threshold_change_is_applied_and_read_back(ctx) -> None:
    result = await dispatch(
        ctx, "update_alert_settings", {"channel": "sms", "threshold_pct": 25}
    )

    assert result["changed"] is True
    assert any("25%" in line for line in result["what_changed"])
    # The whole ladder comes back, not just the field that moved. A customer who only
    # hears about the text alert will assume it is the first thing they get, when the
    # email alert is still sitting below it.
    assert result["current_settings"]["sms"]["fires_at_pct_over"] == 25.0
    assert result["current_settings"]["email"]["fires_at_pct_over"] == 15.0

    stored = await get_preferences_store().get("H-JUL")
    assert stored.tier2_pct == 25.0


async def test_the_ladder_cannot_be_put_out_of_order(ctx) -> None:
    """A text at 5% under an email at 15% is not a ladder, it is a bug in someone's UI —
    and here the "UI" is a model that heard "warn me earlier" and picked one channel.

    Rejected rather than silently reordered: sorting it out behind the customer's back
    means the settings screen no longer describes what will happen.
    """
    result = await dispatch(
        ctx, "update_alert_settings", {"channel": "sms", "threshold_pct": 5}
    )

    assert "error" in result
    assert "escalate" in result["error"] or "ladder" in result["error"]
    # And the error carries the current settings, so the model can offer to move both
    # rather than just reporting a failure.
    assert result["current_settings"]["email"]["fires_at_pct_over"] == 15.0

    stored = await get_preferences_store().get("H-JUL")
    assert stored.tier2_pct == 40.0, "a rejected change must leave nothing behind"


async def test_moving_the_whole_ladder_together_is_accepted(ctx) -> None:
    """The recovery from the test above, and it has to work in one call — a model that
    had to make three calls to lower three thresholds would leave the ladder invalid in
    between."""
    await dispatch(ctx, "update_alert_settings", {"channel": "email", "threshold_pct": 8})
    result = await dispatch(
        ctx, "update_alert_settings", {"channel": "sms", "threshold_pct": 10}
    )
    assert result["changed"] is True


async def test_a_threshold_without_a_channel_is_refused(ctx) -> None:
    """"Warn me at 20%" is ambiguous across three channels, and applying it to all three
    would flatten a ladder the customer deliberately spread out."""
    result = await dispatch(ctx, "update_alert_settings", {"threshold_pct": 20})
    assert "error" in result
    assert "channel" in result["error"]


async def test_a_threshold_below_the_floor_suggests_the_honest_alternative(ctx) -> None:
    """Below about 5% the overshoot is inside the measurement error of the projection, so
    the alert fires on noise. The refusal has to say what to do instead, or the model will
    simply try 4%."""
    result = await dispatch(
        ctx, "update_alert_settings", {"channel": "email", "threshold_pct": 1}
    )
    assert "error" in result
    assert "turn the channel off" in result["error"]


async def test_turning_everything_off_is_allowed_and_flagged(ctx) -> None:
    """The customer may switch off every warning — it is their phone. But the assistant
    has to say what that means, because a silent product looks identical to a working one
    right up until the bill arrives."""
    result = await dispatch(ctx, "update_alert_settings", {"warnings_enabled": False})

    assert result["changed"] is True
    assert result["warnings"]
    assert any("off" in w for w in result["warnings"])


async def test_a_channel_with_no_contact_point_is_flagged(ctx) -> None:
    """Switching on texts for an account with no mobile number is a setting that will
    never fire. Silently accepting it is the failure mode this whole repository is
    organised against: something that reports success and does nothing."""
    result = await dispatch(ctx, "update_alert_settings", {"turn_on": ["voice"]})

    assert result["changed"] is True
    assert any("no number" in w for w in result["warnings"])


async def test_a_no_op_is_reported_as_a_no_op(ctx) -> None:
    """Not an error, and emphatically not a confirmation. "That's already how it's set"
    is a real answer; confirming a change that did not happen is not."""
    result = await dispatch(
        ctx, "update_alert_settings", {"channel": "email", "threshold_pct": 15}
    )
    assert result["changed"] is False
    assert "already" in result["reason"]


def test_the_diff_is_written_in_the_customer_s_words() -> None:
    """`tier2_pct` means nothing to anybody. The customer said "text me", so the change
    has to read back as a text."""
    updated, changes = settings_mod.build(
        defaults_for("H-JUL"), channel="sms", threshold_pct=25
    )
    (change,) = changes
    assert "text" in change.describe()
    assert "40%" in change.describe() and "25%" in change.describe()
    assert "tier2" not in change.describe()


def test_build_validates_rather_than_assigning() -> None:
    """`model_copy(update=...)` skips every validator, so the monotonic rule would be
    bypassed and the Settings screen would describe a ladder that cannot fire in the order
    it shows. `build` must rebuild through validation."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="thresholds must increase"):
        settings_mod.build(defaults_for("H-JUL"), channel="sms", threshold_pct=6)


# ---------- plan changes ----------


async def test_a_plan_change_is_staged_before_it_is_recorded(ctx) -> None:
    staged = await dispatch(ctx, "request_plan_change", {"plan_code": "low_fixed"})

    assert staged["staged"] is True
    assert staged["confirmed"] is False
    assert "NOTHING HAS CHANGED YET" in staged["guidance"]
    assert await get_change_store().pending_for("H-JUL") == []


async def test_confirming_records_the_request(ctx) -> None:
    await dispatch(ctx, "request_plan_change", {"plan_code": "low_fixed"})
    done = await dispatch(
        ctx, "request_plan_change", {"plan_code": "low_fixed", "confirm": True}
    )

    assert done["recorded"] is True
    assert done["status"] == "pending_review"
    # It is a REQUEST. The plan itself lives in a mart this service only reads, and a
    # switch takes effect from the next billing period — telling the customer they are on
    # the new plan now would be the answer that makes them distrust the product.
    assert "next billing period" in done["takes_effect"]
    assert "do NOT say they are on the new plan now" in done["guidance"].replace(
        "Do NOT", "do NOT"
    )

    (request,) = await get_change_store().pending_for("H-JUL")
    assert request.to_plan_code == "low_fixed"


async def test_a_confirmation_with_nothing_staged_is_refused(ctx) -> None:
    """The guard against a model that skipped the ask. "Put me on the cheaper one" is a
    request, and a tool that accepted confirm=true on the strength of it would be a
    one-call plan switch with a confirmation flag painted on."""
    result = await dispatch(
        ctx, "request_plan_change", {"plan_code": "low_fixed", "confirm": True}
    )
    assert result["available"] is False
    assert "no staged plan change" in result["reason"]
    assert await get_change_store().pending_for("H-JUL") == []


async def test_confirming_a_different_plan_cancels_rather_than_guessing(ctx) -> None:
    """A mismatch means the model lost track mid-conversation. Recording either plan
    would be recording a consent nobody gave, so both are dropped."""
    await dispatch(ctx, "request_plan_change", {"plan_code": "low_fixed"})
    result = await dispatch(
        ctx, "request_plan_change", {"plan_code": "standard", "confirm": True}
    )

    assert "error" in result
    assert await get_change_store().pending_for("H-JUL") == []
    # And the stale staging is gone, so a follow-up "yes" cannot land on it either.
    assert get_pending_changes().peek("H-JUL") is None


async def test_a_confirmation_is_single_use(ctx) -> None:
    await dispatch(ctx, "request_plan_change", {"plan_code": "low_fixed"})
    await dispatch(ctx, "request_plan_change", {"plan_code": "low_fixed", "confirm": True})
    again = await dispatch(
        ctx, "request_plan_change", {"plan_code": "low_fixed", "confirm": True}
    )

    assert again.get("available") is False
    assert len(await get_change_store().pending_for("H-JUL")) == 1, "recorded twice"


async def test_an_unknown_plan_is_refused_with_the_list(ctx) -> None:
    result = await dispatch(ctx, "request_plan_change", {"plan_code": "cheapest"})
    assert "error" in result
    assert "low_fixed" in result["available_plans"]


def test_a_staged_change_expires() -> None:
    """Five minutes is roughly one conversation. Longer, and a "yes" to something else
    half an hour later lands on a plan switch the customer had forgotten about."""
    import time

    pending = PendingChanges()
    pending.stage(
        Staged(
            account_ref="H-JUL",
            to_plan_code="low_fixed",
            to_plan_name="Low Fixed Charge",
            from_plan=None,
            quoted_saving_nzd_per_year=None,
            quoted_from_period="July 2026",
            expires_at=time.monotonic() - 1,
        )
    )
    assert pending.take("H-JUL") is None
    assert PENDING_TTL_SECONDS <= 600, "a confirmation window longer than ten minutes"


async def test_the_request_records_what_the_customer_was_shown() -> None:
    """The only defensible record of consent is one that says what was consented to.
    "What were they told it would save" gets asked weeks later, when the comparison has
    been recomputed against different data."""
    store = MemoryChangeStore()
    from app.account.changes import PlanChangeRequest

    await store.record(
        PlanChangeRequest(
            account_ref="H-JUL",
            to_plan_code="low_fixed",
            to_plan_name="Low Fixed Charge",
            quoted_saving_nzd_per_year=94.0,
            quoted_from_period="July 2026",
        )
    )
    (row,) = await store.pending_for("H-JUL")
    assert row.quoted_saving_nzd_per_year == 94.0
    assert row.quoted_from_period == "July 2026"
    assert row.requested_at is not None


# ---------- scoping ----------


async def test_a_write_cannot_be_pointed_at_another_household(ctx) -> None:
    """The same guarantee the read tools have, and it matters more here.

    `customer_id` is bound from the context and is not a parameter on any schema, so a
    model that tries to name a household gets an argument error rather than a write to
    somebody else's settings.
    """
    result = await dispatch(
        ctx,
        "update_alert_settings",
        {"customer_id": "H-COLD", "channel": "sms", "threshold_pct": 30},
    )
    assert "error" in result

    untouched = await get_preferences_store().get("H-COLD")
    assert untouched.tier2_pct == 40.0
