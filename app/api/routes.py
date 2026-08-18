"""HTTP surface. Shape is frozen today so the React team can generate types and work
in parallel — implementations behind it can change all week.

/chat is Server-Sent Events. Voice reuses this exact pipeline (ADR-03); it is a
different transport, never a second brain.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.analytics import fixtures
from app.analytics.engine import (
    TariffOption,
    build_hardship,
    build_tariff_check,
    build_weather_check,
    build_what_costs_most,
    build_what_will_i_pay,
    build_why_high,
)
from app.config import get_provider
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


def _bundle_for(intent: Intent, customer_id: str) -> FactBundle:
    """Layer 0's decision selects the layer 1 path. The model has no say in this."""
    window = fixtures.get_window(customer_id)

    baseline = fixtures.comparison_baseline(customer_id)

    if intent is Intent.WHAT_WILL_I_PAY:
        return build_what_will_i_pay(window, DAYS_IN_JULY)

    if intent is Intent.WHY_HIGH:
        return build_why_high(window, baseline)

    if intent is Intent.USING_MORE_THAN_USUAL:
        # "Was it just the cold snap?" — give the weather its due before anything else.
        hdd, normal = fixtures.heating_degree_days(customer_id)
        return build_weather_check(window, hdd, normal)

    if intent is Intent.WHAT_COSTS_MOST:
        # The honest refusal: we cannot name an appliance, but we can say where the money is.
        return build_what_costs_most(window, baseline)

    if intent is Intent.TARIFF_CHECK:
        return build_tariff_check(window, STANDARD_PLAN, LOW_FIXED_PLAN)

    if intent is Intent.HARDSHIP:
        # No figures at all — nothing to get wrong, and a number has no place here.
        bundle = build_hardship()
        return bundle.model_copy(update={"customer_id": customer_id})

    # Out of scope: say so and offer a person. Never improvise.
    return FactBundle(customer_id=customer_id, intent=intent, period=window.period)


@router.get("/health")
async def health() -> dict[str, object]:
    provider = get_provider()
    return {
        "status": "ok",
        "provider": provider.name,
        "model": provider.model,
        "model_ready": await provider.health(),
    }


@router.get("/households", response_model=list[HouseholdSummary])
async def list_households() -> list[HouseholdSummary]:
    out: list[HouseholdSummary] = []
    for cid in fixtures.all_ids():
        w = fixtures.get_window(cid)
        out.append(
            HouseholdSummary(
                customer_id=cid,
                label=fixtures.label(cid),
                period=w.period,
                daily_kwh=w.daily_kwh,
                total_kwh=round(w.total_kwh, 2),
                estimated_cost_nzd=round(w.cost_nzd, 2),
            )
        )
    return out


@router.get("/households/{customer_id}", response_model=HouseholdSummary)
async def get_household(customer_id: str) -> HouseholdSummary:
    try:
        w = fixtures.get_window(customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return HouseholdSummary(
        customer_id=customer_id,
        label=fixtures.label(customer_id),
        period=w.period,
        daily_kwh=w.daily_kwh,
        total_kwh=round(w.total_kwh, 2),
        estimated_cost_nzd=round(w.cost_nzd, 2),
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Non-streaming path. Simpler to test; /chat/stream is what the UI uses."""
    try:
        fixtures.get_window(req.customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    routing = route(req.message)
    bundle = _bundle_for(routing.intent, req.customer_id)
    provider = get_provider()

    text, report = await narrate_verified(provider, bundle, req.message)

    usage = getattr(provider, "last_usage", None)
    log.info(
        "chat customer=%s intent=%s verified=%s tokens=%s",
        req.customer_id,
        routing.intent,
        report.passed,
        usage.total if usage else "n/a",
    )

    return ChatResponse(
        customer_id=req.customer_id,
        intent=routing.intent,
        text=text,
        facts=bundle.facts,
        verification=report,
        escalate_to_human=routing.is_escalation,
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
    routing = route(req.message)
    bundle = _bundle_for(routing.intent, req.customer_id)
    provider = get_provider()

    async def event_stream():
        meta = json.dumps({"intent": routing.intent, "escalate": routing.is_escalation})
        yield f"event: meta\ndata: {meta}\n\n"
        text, report = await narrate_verified(provider, bundle, req.message)
        for sentence in text.split(". "):
            if sentence.strip():
                chunk = sentence if sentence.endswith(".") else sentence + "."
                yield f"event: token\ndata: {json.dumps({'text': chunk + ' '})}\n\n"
        yield f"event: done\ndata: {report.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
