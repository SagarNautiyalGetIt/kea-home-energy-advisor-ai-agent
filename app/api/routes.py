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
from app.analytics.engine import build_what_will_i_pay, build_why_high
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


def _bundle_for(intent: Intent, customer_id: str) -> FactBundle:
    """Layer 0's decision selects the layer 1 path. The model has no say in this."""
    window = fixtures.get_window(customer_id)

    if intent is Intent.WHAT_WILL_I_PAY:
        return build_what_will_i_pay(window, DAYS_IN_JULY)
    if intent in (Intent.WHY_HIGH, Intent.USING_MORE_THAN_USUAL, Intent.WHAT_COSTS_MOST):
        return build_why_high(window, fixtures.comparison_baseline(customer_id))

    # Hardship and out-of-scope carry no figures on purpose: nothing to fabricate.
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
