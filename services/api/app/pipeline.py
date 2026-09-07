"""The one path from a customer question to a verified answer.

`/chat`, `/chat/stream` and the voice WebSocket all call `answer()`. That is not
tidiness — it is ADR-0003's acceptance criterion made structural. "Voice cannot
produce an answer chat wouldn't" is easy to assert in a document and easy to break
in code six days later, when someone adds a voice-only shortcut because the model
was slow in a rehearsal. There is one function that turns a question into prose, so
the two channels cannot drift without deleting this module.

Layers 0 -> 1 -> 2 -> 3, in that order, every time:

    route()               layer 0     free text -> intent          (pure Python)
    bundle_from_context() layer 1     intent    -> FactBundle      (pure Python)
    narrate_verified()    layers 2+3  bundle    -> verified prose  (model, then Python)

## Two seams that had to survive being merged

**The repository seam (KEA-33).** I/O is async and layer 1 is not, so `plan()` awaits
a `UsageContext` and then hands it to a *pure* bundle builder. The voice branch wrote
its own `_bundle_for()` that read `fixtures` directly; keeping that would have given
voice a second data source, so the demo could answer one way over the microphone and
another way in the chat box. There is one builder, and it takes its data as an
argument.

**Evidence recording.** Recording used to live in the `/chat` handlers, which meant a
voice conversation produced no `verification` row — and "N answers, 0 fabricated
figures" is counted from that table. A demo driven over the microphone would have
reported zero answers. `narrate()` records, so every channel is counted, and
`channel` on the row says which one it was.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass

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
from app.config import get_context_store, get_provider, get_recorder, get_repository
from app.db.recorder import TurnRecord
from app.narration.narrator import narrate_verified
from app.routing.intents import route
from app.schemas import FactBundle, Intent, VerificationReport

log = logging.getLogger(__name__)

DAYS_IN_JULY = 31
"""The demo cohort's cycle length. **A fallback, not a fact about any real account.**

Retailers stagger billing cycle days across the month precisely so that mid-cycle
alerting does not all fire on the same day — `billing.account.billing_cycle_day` exists
for that, and `mart_account_context` carries the resulting period dates. A real cohort
therefore has cycles of 28 to 33 days that start on different dates, and assuming 31 for
all of them puts a straight-line month-end projection out by up to 10% in the direction
that matters: it *understates* the bill for a household on a longer cycle, which is the
one group a bill-shock warning exists to reach.

Use `days_in_cycle()` below. This constant is what it falls back to when nothing knows
better, which on the fixture households is the honest answer.
"""


def days_in_cycle(ctx: UsageContext) -> int:
    """How many days this account's current billing period actually covers.

    Read from the account's own period dates when the marts have them, so an account
    billed 15th-to-14th is projected over its real 30 or 31 days rather than a calendar
    month it does not use.
    """
    account = getattr(ctx, "account", None)
    billing = getattr(account, "billing", None) if account else None
    start = getattr(billing, "current_period_start", None)
    end = getattr(billing, "current_period_end", None)
    if start and end and end >= start:
        # Inclusive of both endpoints, matching `bill.period_days` on the platform side —
        # a period from the 1st to the 31st is 31 days, not 30.
        return (end - start).days + 1
    return DAYS_IN_JULY

# Illustrative plans — Kea's real tariffs are not public, and every surface showing a
# dollar figure has to say so. Standard trades a higher daily charge for a lower unit
# rate; Low Fixed Charge is the reverse, which is why it suits low users.
#
# Break-even is (1.50 - 0.30) / (0.36 - 0.30) = **20 kWh/day**. Below that LFC wins,
# above it Standard does. That threshold is the whole point of the comparison, so it is
# calibrated deliberately: NZ's Low Fixed Charge regulation targeted households under
# ~8,000 kWh/year (~22 kWh/day). An earlier draft used 0.34 for the LFC unit rate, which
# pushed break-even to 30 kWh/day and made LFC look cheaper for almost everybody — the
# advice would have been wrong for most of the demo households.
STANDARD_PLAN = TariffOption("Kea Standard", unit_price_nzd=0.30, daily_fixed_nzd=1.50)
LOW_FIXED_PLAN = TariffOption("Low Fixed Charge", unit_price_nzd=0.36, daily_fixed_nzd=0.30)

#: The intents whose builders take an `AccountContext` rather than a `UsageWindow`.
#:
#: A table rather than another `if` chain because every entry has exactly the same
#: shape, and because the pipeline should not be where somebody has to remember to add
#: a branch: `test_schema_rules` asserts this covers every intent in the family, so a
#: new one fails a test rather than silently falling through to the empty bundle at the
#: bottom of `bundle_from_context` — which would answer "I have no figures for that"
#: to a question the service can answer.
#:
#: `WHY_HIGH` is deliberately NOT here — it picks its builder from the data it has; see
#: `bundle_from_context`.
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
    A clarifying question is an enhancement; the explanation is the product. Losing the
    store must not cost a customer their bill explanation — and returning a *blank*
    context on failure would be worse than None, because a blank one reads as "never
    asked anything" and would re-ask a question they already answered.
    """
    try:
        return get_context_store().get(customer_id)
    except Exception:  # noqa: BLE001
        log.warning("household context unavailable for %s", customer_id, exc_info=True)
        return None


def _account_context(customer_id: str, ctx: UsageContext) -> AccountContext:
    """The wide context for this request, however much of it the source could fill.

    `UsageContext` carries one when the repository built one — `MartRepository` reads
    the plan, the bills and the account row. The fixture and seeded paths do not have
    those, so the thin `from_window` context is built instead and the account lookups
    answer honestly that they cannot see the detail.
    """
    existing = getattr(ctx, "account", None)
    if existing is not None:
        return existing
    return AccountContext.from_window(
        customer_id, ctx.window, label=ctx.label, hdd=ctx.hdd, peer_baseline=ctx.baseline
    )


def bundle_from_context(intent: Intent, customer_id: str, ctx: UsageContext) -> FactBundle:
    """Layer 0's decision selects the layer 1 path. The model has no say in this.

    Pure: everything it needs was fetched by the repository first. Keeping the I/O out
    means this same function serves the database, the fixtures, and the golden set — one
    builder, so the demo and the tests cannot drift apart.
    """
    window = ctx.window
    baseline = ctx.baseline

    if intent is Intent.WHAT_WILL_I_PAY:
        # The account's real cycle length, not a calendar month — see `days_in_cycle`.
        return build_what_will_i_pay(window, max(days_in_cycle(ctx), len(window.daily_kwh)))

    if intent is Intent.WHY_HIGH:
        # Two answers to the same question, chosen by what the data supports.
        #
        # With two bills we can decompose the *change* — which is what the customer is
        # actually asking about, and what `analytics/drivers.py` exists for. Without
        # them there is no change to attribute, and the fallback is the peer-benchmark
        # analysis: the standing-load finding the pitch turns on, measured against what
        # comparable homes use.
        #
        # The order matters and is not a preference. The benchmark answer is true but
        # generic — it says the same thing about every household because it is built
        # from the same two inputs every time. It is the right answer only when there is
        # nothing better available, never in preference to a real attribution.
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
        # "Which day was my highest usage?" — answerable straight off the daily series.
        # This used to fall through to WHY_HIGH and return a confident answer to a
        # different question; see the routing rule for why that was the worst failure
        # mode this system has.
        return build_peak_usage(window)

    if intent is Intent.TIME_OF_DAY:
        # Deliberately has no figures. The half-hourly data behind the demo households
        # is one fixed 48-interval shape scaled by each day's total (see db/seed.py), so
        # every household's "hourly curve" is the same synthetic curve. Naming a peak
        # hour off that would be presenting a constant as an observation — the exact
        # fabrication this product exists to prevent, and it would pass layer 3, because
        # layer 3 checks that figures are real and not that they mean anything.
        #
        # So the answer is an honest partial: we can say which *day*, not which *hour*,
        # and it offers that instead of a handoff. `peak_day` is included as a fact so
        # the model can make the offer concrete rather than vague.
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
        # re-quoting our own figures at them is not an answer to it — it is the same
        # data they are already disputing, said again with more confidence.
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
        # The wide-context family. On the fixture and seeded-household paths there is no
        # plan, bill or account row to read, so these return their "I cannot see that"
        # bundles. `MartRepository` is what fills the context in properly; see
        # analytics/account.py on why a placeholder is not offered here.
        return _ACCOUNT_CONTEXT_INTENTS[intent](_account_context(customer_id, ctx))

    # No analytics path for this intent yet — COMPARE_TO_LAST_YEAR is routable but
    # unimplemented (KEA-69), and OUT_OF_SCOPE never had one. Either way the model gets
    # an empty bundle, and an empty bundle with no caveats is the one case layer 3
    # cannot protect: "your usage was higher than last winter" contains no numeric token,
    # so the number-checker passes it and a fabricated comparison reaches the customer.
    # The caveats are the only guard here. Do not remove them when KEA-69 lands — replace
    # them with real facts.
    return FactBundle(
        customer_id=customer_id,
        intent=intent,
        period=window.period,
        caveats=[
            "You have NO figures for this question. Do not compare, estimate, characterise "
            "or describe their usage in any way — not even in words like 'higher', 'lower' "
            "or 'about the same'. Say plainly that you cannot answer this one yet and offer "
            "to connect them with the team.",
            NO_APPLIANCE,
        ],
    )


def _bundle_for(intent: Intent, customer_id: str) -> FactBundle:
    """Fixture-backed convenience wrapper — synchronous, no I/O, no event loop.

    The golden set and the contract tests use this. It deliberately routes through the
    same `bundle_from_context` the request path uses, so there is exactly one bundle
    builder and no second implementation to drift.
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


# A sentence ends at . ? or ! followed by whitespace and a capital or a quote. Splitting
# on the bare string ". " broke "2.4 kWh" -> no, but it did break "e.g. roughly $24" into
# a chunk ending "e.g." — and the old code then appended a second full stop. It matters
# beyond cosmetics: ADR-0003 has voice speaking sentence one while sentence two generates,
# so a bad boundary becomes an audible one.
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“])')


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


class UnknownCustomerError(KeyError):
    """Raised before any transport has committed a response body."""


@dataclass(frozen=True)
class Plan:
    """Layers 0 and 1: what we are going to answer, decided before the model is touched.

    Split out from the narration because both transports need it *early* and the
    model is the slow part. SSE emits `meta` off this so the UI can render the intent
    while generation runs, and voice speaks a pre-synthesised acknowledgement off it —
    ADR-0005's conclusion exactly: layer 0 knows the intent in ~0 ms, so an
    acknowledgement built from the intent is faster than any model could be and
    cannot fabricate, which is why we did not buy a second "fast" model.
    """

    customer_id: str
    intent: Intent
    bundle: FactBundle
    escalate: bool


@dataclass(frozen=True)
class Answer:
    """One verified reply, plus everything a transport needs to render it.

    `sentences` is computed here rather than by each caller because voice speaks
    sentence one while sentence two is still being generated (ADR-0003's load-bearing
    latency optimisation) and SSE streams the same chunks. Two transports splitting
    prose two different ways is how the channels start to diverge.
    """

    customer_id: str
    intent: Intent
    text: str
    bundle: FactBundle
    report: VerificationReport
    escalate: bool
    conversation_id: int | None = None
    latency_ms: int = 0

    @property
    def sentences(self) -> list[str]:
        return _sentences(self.text)


async def plan(customer_id: str, message: str) -> Plan:
    """Layers 0 + 1. Raises before anything commits.

    Async only because the repository read is — the analytics themselves stay pure and
    synchronous, which is what lets the golden set run layer 1 without an event loop.
    """
    try:
        ctx = await get_repository().context(customer_id)
    except KeyError as exc:
        raise UnknownCustomerError(str(exc)) from exc

    routing = route(message)
    return Plan(
        customer_id=customer_id,
        intent=routing.intent,
        bundle=bundle_from_context(routing.intent, customer_id, ctx),
        escalate=routing.is_escalation,
    )


async def narrate(
    p: Plan,
    message: str,
    *,
    channel: str = "chat",
    conversation_id: int | None = None,
) -> Answer:
    """Layers 2 + 3, then the evidence write. The slow half: the model writes, then
    Python checks every figure.

    `channel` reaches the `conversation` row. Chat and voice are counted separately
    because call deflection is the business case, and "how many of these were voice"
    cannot be reconstructed from the transcript afterwards.
    """
    provider = get_provider()

    started = time.perf_counter()
    text, report = await narrate_verified(provider, p.bundle, message)
    latency_ms = int((time.perf_counter() - started) * 1000)

    usage = getattr(provider, "last_usage", None)
    log.info(
        "answer channel=%s customer=%s intent=%s verified=%s tokens=%s latency_ms=%s",
        channel,
        p.customer_id,
        p.intent,
        report.passed,
        usage.total if usage else "n/a",
        latency_ms,
    )

    # Never raises — see recorder.py on why an evidence failure must not cost the
    # customer their answer.
    recorded_id = await get_recorder().record(
        TurnRecord(
            customer_ref=p.customer_id,
            conversation_id=conversation_id,
            question=message,
            answer=text,
            intent=p.intent,
            bundle=p.bundle,
            report=report,
            escalate=p.escalate,
            channel=channel,
            provider=getattr(provider, "name", None),
            model=getattr(provider, "model", None),
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            latency_ms=latency_ms,
        )
    )

    return Answer(
        customer_id=p.customer_id,
        intent=p.intent,
        text=text,
        bundle=p.bundle,
        report=report,
        escalate=p.escalate,
        conversation_id=recorded_id,
        latency_ms=latency_ms,
    )


async def answer(
    customer_id: str,
    message: str,
    *,
    channel: str = "chat",
    conversation_id: int | None = None,
) -> Answer:
    """Question in, verified prose out. The only function that produces an answer."""
    return await narrate(
        await plan(customer_id, message),
        message,
        channel=channel,
        conversation_id=conversation_id,
    )
