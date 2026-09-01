"""HTTP surface. Shape is frozen today so the React team can generate types and work
in parallel — implementations behind it can change all week.

/chat is Server-Sent Events. Voice reuses this exact pipeline (ADR-03); it is a
different transport, never a second brain. The reuse is literal: both call
`app.pipeline`, and neither has its own copy of the layer 0-3 sequence.

This module is transport only — routing, analytics, narration, verification and the
evidence write all live in `app.pipeline`. Anything here that starts computing a
figure is in the wrong file.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app import auth, hardware, voice
from app.analytics.engine import UsageWindow, assess_bill_shock, build_bill_shock
from app.analytics.repository import UsageContext
from app.config import get_dispatcher, get_provider, get_recorder, get_repository, settings
from app.pipeline import DAYS_IN_JULY, UnknownCustomerError, answer, narrate, plan
from app.schemas import (
    AlertSummary,
    BillShockWarning,
    ChatRequest,
    ChatResponse,
    DemoAccountCard,
    HouseholdSummary,
    LoginRequest,
    LoginResponse,
)
from app.voice.session import VoiceSession, parse_control
from app.voice.vad import TurnDetector

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    provider = get_provider()
    return {
        "status": "ok",
        "provider": provider.name,
        "model": provider.model,
        "model_ready": await provider.health(),
        # Which model, and why that one. On the M4 this should read gemma3:27b with
        # `autodetect`; if it reads gemma3:4b on the demo machine something has gone
        # wrong and it is better to find that out here than mid-answer.
        "hardware": hardware.describe(),
        # Which recorder is live. Surfaced because the failure mode it prevents is
        # rehearsing all afternoon, then discovering the evidence tables are empty and
        # the "N answers, 0 fabricated figures" number cannot be produced.
        "recording": get_recorder().name,
        # "fixtures" means the five households are being served from a Python file and
        # the database is not in the request path at all. Worth being able to see at a
        # glance before a rehearsal.
        "data_source": get_repository().name,
        # The UI decides whether to render a mic button from this. Asking for the
        # microphone and then failing is worse than not offering it.
        "voice": voice.status(),
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



@router.post("/auth/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    """Demo sign-in. See app/auth.py — this is not authentication.

    503 rather than 404 when the flag is off, because "this deployment does not offer
    demo logins" and "that email does not exist" are different answers and only one of
    them should ever be true in front of a real customer.
    """
    if not settings.demo_logins:
        raise HTTPException(
            status_code=503,
            detail="demo logins are disabled on this deployment (set KEA_DEMO_LOGINS=1)",
        )

    account = auth.authenticate(req.email, req.password)
    if account is None:
        # One message for both halves. Saying "no such email" enumerates accounts, and
        # the habit is worth keeping even where the accounts are synthetic.
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")

    log.info("demo login customer=%s", account.customer_id)
    return LoginResponse(
        customer_id=account.customer_id,
        display_name=account.display_name,
        scenario=account.scenario,
    )


@router.get("/auth/demo-accounts", response_model=list[DemoAccountCard])
async def demo_accounts() -> list[DemoAccountCard]:
    """Every sign-in, passwords included, so the team can pick a scenario to test.

    This endpoint hands out credentials. It is behind the same flag as the login itself
    and returns 503 when that flag is off — the accounts are entirely synthetic, but an
    endpoint that lists passwords should never be reachable by accident.
    """
    if not settings.demo_logins:
        raise HTTPException(
            status_code=503,
            detail="demo logins are disabled on this deployment (set KEA_DEMO_LOGINS=1)",
        )
    return [DemoAccountCard(**vars(a)) for a in auth.DEMO_ACCOUNTS]


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

    Reads through the repository (KEA-33) rather than `fixtures` directly. The warning
    and the dashboard summary quote the same dollar figure, so they have to come from
    the same source — a warning served from a Python file while `/households` serves
    from PostgreSQL is two numbers that disagree in front of a judge.
    """
    try:
        ctx = await get_repository().context(customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    full = ctx.window
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

    assessment = assess_bill_shock(window, DAYS_IN_JULY, ctx.baseline)
    bundle = build_bill_shock(assessment, window)

    # Escalation. Idempotent by database constraint, so polling this endpoint does not
    # re-send; failures are recorded on the row and never raised into the response,
    # because a customer's warning must not disappear because a mail server is down.
    # No `customer_name`. `ctx.label` is the demo household's *description* — "Cold-snap
    # driven, not behaviour" — and greeting somebody with it produced "Hi Cold-snap
    # driven, not behaviour,". There is no name to use instead: `models.Customer` holds
    # none by design, because 47.6% of surveyed customers said they would not trust an
    # AI with their data and the schema has to be able to back that up. The renderer
    # falls back to a plain "Hi," which is the honest greeting for a record that
    # deliberately contains no person.
    dispatch = await get_dispatcher().dispatch(
        account_ref=customer_id,
        assessment=assessment,
        period=window.period,
        recipient_email=settings.demo_recipient,
    )

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
        alert=AlertSummary(
            tier=dispatch.tier,
            channels=list(dispatch.channels),
            sent=list(dispatch.sent),
            suppressed=dispatch.suppressed,
            detail=dispatch.detail,
            destination=dispatch.destination,
            already_sent=dispatch.already_sent,
        )
        if dispatch.tier
        else None,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Non-streaming path. Simpler to test; /chat/stream is what the UI uses."""
    try:
        result = await answer(req.customer_id, req.message, conversation_id=req.conversation_id)
    except UnknownCustomerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ChatResponse(
        customer_id=result.customer_id,
        intent=result.intent,
        text=result.text,
        facts=result.bundle.facts,
        verification=result.report,
        escalate_to_human=result.escalate,
        conversation_id=result.conversation_id,
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
    # Plan before the response starts. Raising inside the generator would already have
    # committed a 200 and an SSE content-type, so an unknown customer surfaced as a 500
    # with a half-open stream while /chat returned a clean 404 for the same input.
    # Layers 0-1 get `meta` onto the wire before the model is asked for anything.
    try:
        p = await plan(req.customer_id, req.message)
    except UnknownCustomerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def event_stream():
        meta = json.dumps({"intent": p.intent, "escalate": p.escalate})
        yield f"event: meta\ndata: {meta}\n\n"

        # `narrate` records the evidence before it returns, so a client that disconnects
        # on `done` has not raced the write. The recorder swallows its own failures, so
        # this cannot break the stream.
        result = await narrate(p, req.message, conversation_id=req.conversation_id)

        for chunk in result.sentences:
            yield f"event: token\ndata: {json.dumps({'text': chunk + ' '})}\n\n"

        done = result.report.model_dump(mode="json")
        done["conversation_id"] = result.conversation_id
        yield f"event: done\ndata: {json.dumps(done)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class _WebSocketTransport:
    """Adapts FastAPI's WebSocket to the narrow interface VoiceSession needs."""

    def __init__(self, ws: WebSocket) -> None:
        self._ws = ws

    async def send_json(self, payload: dict) -> None:
        await self._ws.send_text(json.dumps(payload))

    async def send_bytes(self, payload: bytes) -> None:
        await self._ws.send_bytes(payload)


# 1008 is "policy violation". Note it only reaches the browser as a close event with a
# readable `event.reason` when we have already accepted the socket — closing *before*
# accept is a rejected handshake, which surfaces as a bare HTTP 403 and no reason. That
# is why the disabled-feature branch below accepts first and the origin branch does not:
# a wrong origin is an attack we do not want to explain, a disabled flag is a teammate
# who needs to be told which variable to set.
_CLOSE_POLICY = 1008


@router.websocket("/voice/stream")
async def voice_stream(websocket: WebSocket) -> None:
    """Voice transport. Same layers, same verification, different wire (ADR-0003)."""
    # CORS middleware does not apply to WebSockets — the browser sends an Origin header
    # on the upgrade and then honours whatever we accept. Without this check any page on
    # any origin can open this socket against a developer's running API.
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.cors_list:
        log.warning("rejected voice websocket from origin %r", origin)
        await websocket.close(code=_CLOSE_POLICY, reason="origin not allowed")
        return

    if not settings.voice_enabled:
        # KEA-56. Accept first so the close reason reaches the browser: a rejected
        # handshake surfaces as a bare "connection failed" with no explanation.
        await websocket.accept()
        await websocket.close(code=_CLOSE_POLICY, reason="voice is disabled (KEA_VOICE_ENABLED=0)")
        return

    await websocket.accept()

    session = VoiceSession(
        transport=_WebSocketTransport(websocket),
        stt=voice.get_stt(),
        tts=voice.get_tts(),
        detector=TurnDetector(silero_model_path=settings.silero_vad_model),
    )

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if (data := message.get("bytes")) is not None:
                if not session.customer_id:
                    await session.error("send hello before audio", fatal=True)
                    break
                await session.on_audio(data)
                continue

            payload = parse_control(message.get("text") or "")
            kind = payload.get("type")

            if kind == "hello":
                session.customer_id = str(payload.get("customer_id") or "")
                await session.send_ready()
            elif not session.customer_id:
                await session.error("send hello first", fatal=True)
                break
            elif kind == "end":
                await session.on_end()
            elif kind == "text":
                await session.answer_text(str(payload.get("message") or ""))
            else:
                await session.error(f"unknown message type {kind!r}", fatal=False)

    except WebSocketDisconnect:
        log.info("voice websocket closed by client customer=%s", session.customer_id)
    except Exception:
        # A traceback out of a WebSocket handler closes the socket with 1011 and no
        # explanation. Log it here where it is readable, then let it close.
        log.exception("voice websocket failed customer=%s", session.customer_id)
        raise
