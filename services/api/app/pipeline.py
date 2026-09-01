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

from app.analytics import fixtures
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
from app.config import get_provider, get_recorder, get_repository
from app.db.recorder import TurnRecord
from app.narration.narrator import narrate_verified
from app.routing.intents import route
from app.schemas import FactBundle, Intent, VerificationReport

log = logging.getLogger(__name__)

DAYS_IN_JULY = 31

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


def bundle_from_context(intent: Intent, customer_id: str, ctx: UsageContext) -> FactBundle:
    """Layer 0's decision selects the layer 1 path. The model has no say in this.

    Pure: everything it needs was fetched by the repository first. Keeping the I/O out
    means this same function serves the database, the fixtures, and the golden set — one
    builder, so the demo and the tests cannot drift apart.
    """
    window = ctx.window
    baseline = ctx.baseline

    if intent is Intent.WHAT_WILL_I_PAY:
        return build_what_will_i_pay(window, DAYS_IN_JULY)

    if intent is Intent.WHY_HIGH:
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
