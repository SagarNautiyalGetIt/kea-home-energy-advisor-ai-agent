"""Intent -> a fixed list of computed facts. **The offline path only.**

This was the heart of the old request pipeline: layer 0 picked an intent from keywords,
this picked the analytics for it, and the model wrote three sentences from the result.
The online path no longer works that way — the model reads the data itself through
`app/agent/tools.py` — and the reasons are in `app/pipeline.py`'s docstring.

It survives because **ADR-0008 is a genuinely different problem.** A farmer with no
connectivity cannot reach this API at all, so an on-device model has no tools to call and
nothing to call them against. The only thing that works there is what worked here:
pre-compute the answers while the phone still has a connection, ship the facts, and let a
small local model narrate them under a prompt that forbids it from inventing a figure.
That is not the compromise it was online — offline, the alternative is no answer at all.

So: narrate-only is the right architecture for a device with no network, and the wrong
one for a server with a database. Both statements are in the repository, and this module
is the first one.

`app/offline.py` is the only caller. If something in the request path starts importing
this, that is a regression worth stopping in review — `tests/test_import_graph.py` is
where to encode it.
"""

from __future__ import annotations

import logging

from app.analytics import explain, fixtures
from app.analytics.account import AccountContext
from app.analytics.engine import (
    NO_APPLIANCE,
    TariffOption,
    build_hardship,
    build_peak_usage,
    build_tariff_check,
    build_weather_check,
    build_what_costs_most,
    build_what_will_i_pay,
    build_why_high,
)
from app.analytics.repository import UsageContext
from app.clarify.schemas import HouseholdContext
from app.config import get_context_store
from app.schemas import FactBundle, Intent

log = logging.getLogger(__name__)

#: Illustrative plans. Kept in step with `app/agent/tools.py`, which holds the same two
#: for the online comparison — break-even is 20 kWh/day either way, and the two must not
#: disagree or a customer would get one answer online and another on a plane.
STANDARD_PLAN = TariffOption("Kea Standard", unit_price_nzd=0.30, daily_fixed_nzd=1.50)
LOW_FIXED_PLAN = TariffOption("Low Fixed Charge", unit_price_nzd=0.36, daily_fixed_nzd=0.30)

DAYS_IN_JULY = 31
"""The demo cohort's cycle length. A fallback, not a fact about any real account."""


def days_in_cycle(ctx: UsageContext) -> int:
    """How many days this account's current billing period actually covers."""
    account = getattr(ctx, "account", None)
    billing = getattr(account, "billing", None) if account else None
    start = getattr(billing, "current_period_start", None)
    end = getattr(billing, "current_period_end", None)
    if start and end and end >= start:
        return (end - start).days + 1
    return DAYS_IN_JULY


#: The intents whose builders take an `AccountContext` rather than a `UsageWindow`.
#:
#: A table rather than another `if` chain because every entry has the same shape, and
#: because `test_schema_rules` asserts it covers every intent in the family — so a new
#: one fails a test rather than silently falling through to the empty bundle at the
#: bottom, which would answer "I have no figures for that" to a question the service can
#: answer.
_ACCOUNT_CONTEXT_INTENTS = {
    Intent.HOW_TO_REDUCE: explain.build_how_to_reduce,
    Intent.COMPARE_TO_SIMILAR: explain.build_compare_to_similar,
    Intent.BILL_BREAKDOWN: explain.build_bill_breakdown,
    Intent.USAGE_TOTAL: explain.build_usage_total,
    Intent.SOLAR_EXPORT: explain.build_solar_export,
    Intent.SUPPLY_QUALITY: explain.build_supply_quality,
    Intent.ACCOUNT_BALANCE: explain.build_account_balance,
    Intent.BILL_DUE: explain.build_bill_due,
    Intent.PLAN_DETAILS: explain.build_plan_details,
    Intent.RATE_DETAILS: explain.build_rate_details,
    Intent.PAYMENT_METHOD: explain.build_payment_method,
    Intent.ACCOUNT_IDENTITY: explain.build_account_identity,
    Intent.BILLING_CYCLE: explain.build_billing_cycle,
}


def _household(customer_id: str) -> HouseholdContext | None:
    """What this household has already told us, for the clarifying-question path.

    Swallows store failures to None, which disables the question rather than the answer.
    Returning a *blank* context on failure would be worse than None, because a blank one
    reads as "never asked anything" and would re-ask a question they already answered.
    """
    try:
        return get_context_store().get(customer_id)
    except Exception:  # noqa: BLE001
        log.warning("household context unavailable for %s", customer_id, exc_info=True)
        return None


def _account_context(customer_id: str, ctx: UsageContext) -> AccountContext:
    """The wide context for this request, however much of it the source could fill."""
    existing = getattr(ctx, "account", None)
    if existing is not None:
        return existing
    return AccountContext.from_window(
        customer_id, ctx.window, label=ctx.label, hdd=ctx.hdd, peer_baseline=ctx.baseline
    )


def bundle_from_context(intent: Intent, customer_id: str, ctx: UsageContext) -> FactBundle:
    """Pure: everything it needs was fetched by the repository first.

    Keeping the I/O out means the same function serves the database, the fixtures and
    the golden set — one builder, so the pack and the tests cannot drift apart.
    """
    window = ctx.window
    baseline = ctx.baseline

    if intent is Intent.WHAT_WILL_I_PAY:
        # The account's real cycle length, not a calendar month — see `days_in_cycle`.
        return build_what_will_i_pay(window, max(days_in_cycle(ctx), len(window.daily_kwh)))

    if intent is Intent.WHY_HIGH:
        # Two answers to the same question, chosen by what the data supports. With two
        # bills we can decompose the *change*, which is what the customer is asking
        # about. Without them there is no change to attribute, and the fallback is the
        # peer benchmark. The order is not a preference: the benchmark answer is true but
        # generic — it says the same thing about every household because it is built from
        # the same two inputs every time.
        account = _account_context(customer_id, ctx)
        if account.has_bill_comparison:
            return explain.build_why_high_v2(account, household=_household(customer_id))
        return build_why_high(window, baseline)

    if intent is Intent.USING_MORE_THAN_USUAL:
        # "Was it just the cold snap?" — give the weather its due before anything else.
        return build_weather_check(window, ctx.hdd, ctx.normal_hdd)

    if intent is Intent.WHAT_COSTS_MOST:
        # The honest refusal: we cannot name an appliance, but we can say where the money is.
        return build_what_costs_most(window, baseline)

    if intent is Intent.PEAK_USAGE:
        return build_peak_usage(window)

    if intent is Intent.TIME_OF_DAY:
        # Deliberately has no figures. The half-hourly data behind the demo households is
        # one fixed 48-interval shape scaled by each day's total (see db/seed.py), so
        # every household's "hourly curve" is the same synthetic curve. Naming a peak hour
        # off that would be presenting a constant as an observation.
        #
        # Note the online path is no longer restricted this way for every account: the
        # mart accounts carry a real per-ICP profile in `kea.mart_hourly_profile`, and
        # `agent/tools.py:get_hourly_profile` reads it. This refusal is correct for the
        # seeded households, which is what the offline pack is built from.
        peak = build_peak_usage(window)
        return FactBundle(
            customer_id=customer_id,
            intent=intent,
            period=window.period,
            facts=[f for f in peak.facts if f.key in {"peak_day", "peak_day_kwh"}],
            caveats=[
                "You have NO hour-by-hour or time-of-day figures. Do not name a peak "
                "hour, a time window, or a part of the day — not 'evenings', not "
                "'overnight'. Say plainly that Sparky can show which DAY was highest but "
                "not yet which hour, then offer the highest day you were given.",
                NO_APPLIANCE,
            ],
        )

    if intent is Intent.TARIFF_CHECK:
        return build_tariff_check(window, STANDARD_PLAN, LOW_FIXED_PLAN)

    if intent is Intent.HARDSHIP:
        # No figures at all — nothing to get wrong, and a number has no place here.
        bundle = build_hardship()
        return bundle.model_copy(update={"customer_id": customer_id})

    if intent is Intent.DISPUTE:
        # Same shape as hardship and for a related reason: the answer is a person. A
        # customer saying the bill is wrong is making a claim about the world, and
        # re-quoting our own figures at them is not an answer to it.
        return FactBundle(
            customer_id=customer_id,
            intent=intent,
            period=window.period,
            caveats=[
                "Acknowledge that they believe something is wrong, warmly and without "
                "argument. Do NOT quote any figure, do NOT defend the bill, and do NOT "
                "agree that it is wrong — you cannot know. Say you are putting them "
                "through to someone who can look into it, and stop there.",
            ],
        )

    if intent in _ACCOUNT_CONTEXT_INTENTS:
        return _ACCOUNT_CONTEXT_INTENTS[intent](_account_context(customer_id, ctx))

    # No analytics path for this intent. An empty bundle with no caveats is the one case
    # the device's number-checker cannot protect: "your usage was higher than last
    # winter" contains no numeric token, so the checker passes it and a fabricated
    # comparison reaches the customer. The caveats are the only guard here.
    return FactBundle(
        customer_id=customer_id,
        intent=intent,
        period=window.period,
        caveats=[
            "You have NO figures for this question. Do not compare, estimate, characterise "
            "or describe their usage in any way — not even in words like 'higher', 'lower' "
            "or 'about the same'. Say plainly that you cannot answer this one offline, and "
            "that Sparky can answer it properly once the phone has a connection.",
            NO_APPLIANCE,
        ],
    )


def bundle_for(intent: Intent, customer_id: str) -> FactBundle:
    """Fixture-backed convenience wrapper — synchronous, no I/O, no event loop.

    Routes through the same `bundle_from_context` the pack builder uses, so there is
    exactly one bundle builder and no second implementation to drift.
    """
    hdd, normal = fixtures.heating_degree_days(customer_id)  # validates the id
    ctx = UsageContext(
        window=fixtures.get_window(customer_id),
        baseline=fixtures.comparison_baseline(customer_id),
        label=fixtures.label(customer_id),
        hdd=hdd,
        normal_hdd=normal,
    )
    return bundle_from_context(intent, customer_id, ctx)
