"""HTTP surface. Shape is frozen today so the React team can generate types and work
in parallel — implementations behind it can change all week.

/chat is Server-Sent Events. Voice reuses this exact pipeline (ADR-03); it is a
different transport, never a second brain.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.analytics import fixtures
from app.analytics.engine import (
    NO_APPLIANCE,
    TariffOption,
    UsageWindow,
    assess_bill_shock,
    build_bill_shock,
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
    BillShockWarning,
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


@router.get("/households/{customer_id}/bill-shock", response_model=BillShockWarning)
async def bill_shock(customer_id: str, as_at_day: int | None = None) -> BillShockWarning:
    """The bill-shock warning. A GET, because it has to reach the customer unprompted.

    Every other endpoint answers a question somebody asked. A warning that only appears
    if you think to ask for it is not a warning, so this is polled by the dashboard
    rather than routed through chat.

    `as_at_day` truncates the cycle so the warning can be seen mid-cycle. Each seeded
    household holds a complete July, and a warning delivered on day 31 is not a warning,
    it is a bill. Which days show what is not obvious from the data, so: H-JUL trips
    `above_comparable_homes` at every point in the cycle, and H-COLD trips
    `rising_within_cycle` on days 6-8 as the cold snap starts — that second one is the
    better demo, because there are still 25 days left to act on it.
    """
    try:
        full = fixtures.get_window(customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if as_at_day is None:
        window = full
    else:
        if not 1 <= as_at_day <= len(full.daily_kwh):
            raise HTTPException(
                status_code=422,
                detail=f"as_at_day must be between 1 and {len(full.daily_kwh)}",
            )
        window = UsageWindow(
            customer_id=full.customer_id,
            period=full.period,
            daily_kwh=full.daily_kwh[:as_at_day],
            unit_price_nzd=full.unit_price_nzd,
        )

    assessment = assess_bill_shock(
        window, DAYS_IN_JULY, fixtures.comparison_baseline(customer_id)
    )
    bundle = build_bill_shock(assessment, window)

    log.info(
        "bill-shock customer=%s day=%d/%d triggered=%s reasons=%s projected=%.2f",
        customer_id,
        assessment.days_elapsed,
        assessment.days_in_cycle,
        assessment.triggered,
        assessment.reasons,
        assessment.projected_cost_nzd,
    )

    return BillShockWarning(
        customer_id=customer_id,
        period=window.period,
        triggered=assessment.triggered,
        reasons=assessment.reasons,
        days_elapsed=assessment.days_elapsed,
        days_in_cycle=assessment.days_in_cycle,
        days_remaining=assessment.days_remaining,
        usage_so_far_kwh=assessment.usage_so_far_kwh,
        cost_so_far_nzd=assessment.cost_so_far_nzd,
        projected_cycle_cost_nzd=assessment.projected_cost_nzd,
        comparable_home_cost_nzd=assessment.expected_cost_nzd,
        overshoot_nzd=assessment.overshoot_nzd,
        overshoot_pct=assessment.overshoot_pct,
        recent_trend_pct=assessment.recent_trend_pct,
        facts=bundle.facts,
        caveats=bundle.caveats,
    )


# A sentence ends at . ? or ! followed by whitespace and a capital or a quote. Splitting
# on the bare string ". " broke "2.4 kWh" -> no, but it did break "e.g. roughly $24" into
# a chunk ending "e.g." — and the old code then appended a second full stop. It matters
# beyond cosmetics: ADR-0003 has voice speaking sentence one while sentence two generates,
# so a bad boundary becomes an audible one.
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“])')


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


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
    # Validate before the response starts. Raising inside the generator would already
    # have committed a 200 and an SSE content-type, so an unknown customer surfaced as
    # a 500 with a half-open stream while /chat returned a clean 404 for the same input.
    try:
        fixtures.get_window(req.customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    routing = route(req.message)
    bundle = _bundle_for(routing.intent, req.customer_id)
    provider = get_provider()

    async def event_stream():
        meta = json.dumps({"intent": routing.intent, "escalate": routing.is_escalation})
        yield f"event: meta\ndata: {meta}\n\n"
        text, report = await narrate_verified(provider, bundle, req.message)
        for chunk in _sentences(text):
            yield f"event: token\ndata: {json.dumps({'text': chunk + ' '})}\n\n"
        yield f"event: done\ndata: {report.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
