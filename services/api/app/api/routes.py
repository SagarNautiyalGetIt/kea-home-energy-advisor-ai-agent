"""HTTP surface. Shape is frozen today so the React team can generate types and work
in parallel — implementations behind it can change all week.

/chat is Server-Sent Events. Voice reuses this exact pipeline (ADR-03); it is a
different transport, never a second brain.
"""

from __future__ import annotations

import json
import logging
import re
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.analytics import fixtures
from app.analytics.engine import (
    NO_APPLIANCE,
    TariffOption,
    build_hardship,
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
from app.schemas import (
    ChatRequest,
    ChatResponse,
    FactBundle,
    HouseholdSummary,
    Intent,
)

log = logging.getLogger(__name__)
router = APIRouter()

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


@router.get("/health")
async def health() -> dict[str, object]:
    provider = get_provider()
    return {
        "status": "ok",
        "provider": provider.name,
        "model": provider.model,
        "model_ready": await provider.health(),
        # Which recorder is live. Surfaced because the failure mode it prevents is
        # rehearsing all afternoon, then discovering the evidence tables are empty and
        # the "N answers, 0 fabricated figures" number cannot be produced.
        "recording": get_recorder().name,
        # "fixtures" means the five households are being served from a Python file and
        # the database is not in the request path at all. Worth being able to see at a
        # glance before a rehearsal.
        "data_source": get_repository().name,
    }


def _summary(customer_id: str, ctx: UsageContext) -> HouseholdSummary:
    w = ctx.window
    return HouseholdSummary(
        customer_id=customer_id,
        label=ctx.label,
        period=w.period,
        daily_kwh=w.daily_kwh,
        total_kwh=round(w.total_kwh, 2),
        estimated_cost_nzd=round(w.cost_nzd, 2),
    )


@router.get("/households", response_model=list[HouseholdSummary])
async def list_households() -> list[HouseholdSummary]:
    repo = get_repository()
    return [_summary(cid, await repo.context(cid)) for cid in await repo.all_ids()]


@router.get("/households/{customer_id}", response_model=HouseholdSummary)
async def get_household(customer_id: str) -> HouseholdSummary:
    try:
        ctx = await get_repository().context(customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _summary(customer_id, ctx)


# A sentence ends at . ? or ! followed by whitespace and a capital or a quote. Splitting
# on the bare string ". " broke "2.4 kWh" -> no, but it did break "e.g. roughly $24" into
# a chunk ending "e.g." — and the old code then appended a second full stop. It matters
# beyond cosmetics: ADR-0003 has voice speaking sentence one while sentence two generates,
# so a bad boundary becomes an audible one.
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“])')


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


async def _record(
    req: ChatRequest,
    routing,
    bundle: FactBundle,
    report,
    text: str,
    provider,
    usage,
    latency_ms: int,
) -> int | None:
    """Hand the exchange to the recorder. Never raises — see recorder.py on why an
    evidence failure must not cost the customer their answer."""
    return await get_recorder().record(
        TurnRecord(
            customer_ref=req.customer_id,
            conversation_id=req.conversation_id,
            question=req.message,
            answer=text,
            intent=routing.intent,
            bundle=bundle,
            report=report,
            escalate=routing.is_escalation,
            provider=getattr(provider, "name", None),
            model=getattr(provider, "model", None),
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            latency_ms=latency_ms,
        )
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Non-streaming path. Simpler to test; /chat/stream is what the UI uses."""
    try:
        ctx = await get_repository().context(req.customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    routing = route(req.message)
    bundle = bundle_from_context(routing.intent, req.customer_id, ctx)
    provider = get_provider()

    started = time.perf_counter()
    text, report = await narrate_verified(provider, bundle, req.message)
    latency_ms = int((time.perf_counter() - started) * 1000)

    usage = getattr(provider, "last_usage", None)
    log.info(
        "chat customer=%s intent=%s verified=%s tokens=%s latency_ms=%s",
        req.customer_id,
        routing.intent,
        report.passed,
        usage.total if usage else "n/a",
        latency_ms,
    )

    conversation_id = await _record(
        req, routing, bundle, report, text, provider, usage, latency_ms
    )

    return ChatResponse(
        customer_id=req.customer_id,
        intent=routing.intent,
        text=text,
        facts=bundle.facts,
        verification=report,
        escalate_to_human=routing.is_escalation,
        conversation_id=conversation_id,
    )


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    """SSE. Streams the verified answer.

    Note the ordering constraint: verification is a whole-text check, so we cannot
    stream raw model output and verify afterwards — that would put an unverified
    number on screen. We verify first, then stream the approved text. On this
    hardware the wait is short; when we move to a hosted model, revisit whether
    sentence-level verification lets us start streaming earlier.
    """
    # Validate before the response starts. Raising inside the generator would already
    # have committed a 200 and an SSE content-type, so an unknown customer surfaced as
    # a 500 with a half-open stream while /chat returned a clean 404 for the same input.
    try:
        ctx = await get_repository().context(req.customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    routing = route(req.message)
    bundle = bundle_from_context(routing.intent, req.customer_id, ctx)
    provider = get_provider()

    async def event_stream():
        meta = json.dumps({"intent": routing.intent, "escalate": routing.is_escalation})
        yield f"event: meta\ndata: {meta}\n\n"

        started = time.perf_counter()
        text, report = await narrate_verified(provider, bundle, req.message)
        latency_ms = int((time.perf_counter() - started) * 1000)

        for chunk in _sentences(text):
            yield f"event: token\ndata: {json.dumps({'text': chunk + ' '})}\n\n"

        # Recorded before `done` is emitted, so a client that disconnects on `done` has
        # not raced the evidence write. The recorder swallows its own failures, so this
        # cannot break the stream.
        usage = getattr(provider, "last_usage", None)
        conversation_id = await _record(
            req, routing, bundle, report, text, provider, usage, latency_ms
        )

        done = report.model_dump(mode="json")
        done["conversation_id"] = conversation_id
        yield f"event: done\ndata: {json.dumps(done)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
