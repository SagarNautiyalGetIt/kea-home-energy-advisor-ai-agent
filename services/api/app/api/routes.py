"""HTTP surface. Shape is frozen so the React and mobile teams can generate types and
work in parallel — implementations behind it can change all week.

/chat/stream is Server-Sent Events. Voice and the Vapi telephony adapter reuse this exact
path (ADR-0003); they are different transports, never a second brain. The reuse is
literal: all three call `app.pipeline`, and none has its own copy of the agent loop.

This module is transport only — data access, tool dispatch, the model and the evidence
write all live behind `app.pipeline`. Anything here that starts computing a figure is in
the wrong file.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as _VapiBaseModel

from app import auth, hardware, offline, voice
from app.agent.loop import AgentUnavailable
from app.alerts.preferences import AlertPreferences
from app.analytics import billshock
from app.analytics.engine import UsageWindow
from app.analytics.repository import UsageContext
from app.clarify import apply, detect, questions
from app.clarify.schemas import ClarifyingQuestion, HouseholdContext, QuestionResponse
from app.config import (
    get_context_store,
    get_dispatcher,
    get_preferences_store,
    get_provider,
    get_recorder,
    get_repository,
    settings,
)
from app.narration.prompts import SYSTEM
from app.pipeline import (
    DAYS_IN_JULY,
    UnknownCustomerError,
    answer,
    answer_stream,
    build_context,
)
from app.schemas import (
    AlertSummary,
    BillShockWarning,
    CauseBreakdown,
    ChatRequest,
    ChatResponse,
    DemoAccountCard,
    ForecastSummary,
    HouseholdSummary,
    LoginRequest,
    LoginResponse,
    SourceRef,
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
        # Which gateway each alert channel resolved to. A misconfigured backend falls
        # back to the file sink with a warning rather than raising, so without this line
        # "no texts were sent" and "SMS is writing to disk" look identical from outside —
        # the same class of silent degradation the recorder disclosure exists for.
        "alerts": {
            "dispatcher": getattr(dispatcher := get_dispatcher(), "name", "off"),
            "gateways": dispatcher.describe(),
        },
        # Where a customer's thresholds are stored. "memory" means the Settings screen
        # saves for the life of the process and no longer.
        "preferences": get_preferences_store().name,
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
    it is a bill.

    Which days show what is not obvious from the data:

    * **H-COLD is the demo household.** It is the only one whose usage actually tracks
      the HDD series, so it is the only one that reaches the weather-normalised path and
      produces a cause breakdown ("$41 of this is the cold snap"). Read it around day 14.
    * **H-JUL always falls back to the straight line.** Its daily totals are real measured
      data and `_HDD_JULY` is an invented series built for H-COLD, so the two do not
      correspond and the regression correctly refuses to fit. That is the honest state of
      the fixture data — manufacturing a correlated weather series for it would be
      inventing the exact kind of figure this product exists to prevent. The response says
      `method: straight_line` and the narration is forbidden from attributing anything to
      temperature.

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

    preferences = await _preferences_for(customer_id)
    assessment = billshock.assess(
        window,
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=ctx.hdd[: len(window.daily_kwh)],
        normal_hdd_per_day=ctx.normal_hdd,
        comparable_home_kwh_per_day=ctx.baseline,
        preferences=preferences,
    )
    # The clarifying-question path. Python decides there is a gap worth asking about;
    # the model only delivers the question it is handed. See app/clarify/.
    household = await get_context_store().get(customer_id)
    gaps = detect.find_gaps(
        daily_kwh=window.daily_kwh,
        daily_hdd=ctx.hdd[: len(window.daily_kwh)],
        response=assessment.forecast.response,
        unit_price_nzd=window.unit_price_nzd,
        overshoot_nzd=assessment.overshoot_nzd,
        unexplained_nzd=assessment.attribution.everyday_load_nzd,
        attribution_explained=assessment.attribution.explained,
    )
    question = questions.select(gaps, household, period=window.period)
    bundle = billshock.build_bill_shock(
        assessment, context=household, question=question
    )

    # Escalation. Idempotent by database constraint, so polling this endpoint does not
    # re-send; failures are recorded on the delivery rows and never raised into the
    # response, because a customer's warning must not disappear because a mail server is
    # down.
    #
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
        preferences=preferences,
        period=window.period,
    )

    f = assessment.forecast
    log.info(
        "bill-shock customer=%s day=%d/%d triggered=%s method=%s reasons=%s "
        "projected=%.2f p(tier1)=%.2f",
        customer_id,
        assessment.days_elapsed,
        assessment.days_in_cycle,
        assessment.triggered,
        f.method,
        assessment.reasons,
        assessment.projected_cost_nzd,
        assessment.tier_probabilities.get(1, 0.0),
    )

    return BillShockWarning(
        customer_id=customer_id,
        period=window.period,
        triggered=assessment.triggered,
        reasons=assessment.reasons,
        days_elapsed=assessment.days_elapsed,
        days_in_cycle=assessment.days_in_cycle,
        days_remaining=assessment.days_remaining,
        usage_so_far_kwh=f.usage_so_far_kwh,
        cost_so_far_nzd=f.cost_so_far_nzd,
        projected_cycle_cost_nzd=assessment.projected_cost_nzd,
        expected_cost_nzd=assessment.expected_cost_nzd,
        expectation_basis=assessment.expectation.basis.value,
        overshoot_nzd=assessment.overshoot_nzd,
        overshoot_pct=assessment.overshoot_pct,
        recent_trend_pct=assessment.recent_trend_pct,
        forecast=ForecastSummary(
            method=f.method.value,
            detail=f.method_detail,
            cost_p10_nzd=f.cost_p10_nzd,
            cost_p90_nzd=f.cost_p90_nzd,
            confidence_width_pct=f.confidence_width_pct,
            base_load_kwh_per_day=(
                f.response.base_load_kwh_per_day if f.response.usable else None
            ),
            heating_kwh_per_hdd=(
                f.response.heating_kwh_per_hdd if f.response.usable else None
            ),
            r_squared=f.response.r_squared if f.response.usable else None,
        ),
        causes=CauseBreakdown(
            explained=assessment.attribution.explained,
            weather_nzd=assessment.attribution.weather_nzd,
            higher_use_nzd=assessment.attribution.behaviour_nzd,
            everyday_load_nzd=assessment.attribution.everyday_load_nzd,
            dominant=assessment.dominant_cause,
        ),
        # Keys are stringified because JSON object keys are strings and an int-keyed dict
        # round-trips as one anyway. Doing it here means the generated TypeScript says
        # `Record<string, number>` and the frontend is not surprised at runtime.
        thresholds_pct={str(k): v for k, v in preferences.thresholds.items()},
        tier_probabilities={str(k): v for k, v in assessment.tier_probabilities.items()},
        facts=bundle.facts,
        caveats=bundle.caveats,
        question=question,
        alert=AlertSummary(
            tier=dispatch.tier,
            channels=list(dispatch.channels),
            sent=list(dispatch.sent),
            deferred=list(dispatch.deferred),
            confidence=dispatch.confidence,
            suppressed=dispatch.suppressed,
            detail=dispatch.detail,
            destination=dispatch.destination,
            already_sent=dispatch.already_sent,
        )
        if dispatch.tier
        else None,
    )


async def _preferences_for(customer_id: str) -> AlertPreferences:
    """The customer's thresholds, with the demo contact points filled in if they have none.

    The fallback exists because the seeded households carry no personal details by design
    (see `models.Customer`), so a rehearsal would otherwise always resolve to "no email
    address on file" and never demonstrate a delivery. It applies **only when the customer
    has not set an address themselves** — a real preference always wins, and a deployment
    that leaves `KEA_DEMO_RECIPIENT` unset correctly reports the gap rather than mailing
    the operator about a stranger's bill.
    """
    prefs = await get_preferences_store().get(customer_id)
    patch: dict[str, str] = {}
    if not prefs.email and settings.demo_recipient:
        patch["email"] = settings.demo_recipient
    if not prefs.phone_e164 and settings.demo_phone:
        patch["phone_e164"] = settings.demo_phone
    return prefs.model_copy(update=patch) if patch else prefs


@router.get(
    "/households/{customer_id}/alert-preferences", response_model=AlertPreferences
)
async def get_alert_preferences(customer_id: str) -> AlertPreferences:
    """What this household asked to be told about, and how.

    Returns defaults for a customer who has never opened Settings rather than 404. There
    is no such thing as a household with no alerting behaviour — there is only one whose
    behaviour nobody has changed, and the screen has to render either way.
    """
    return await get_preferences_store().get(customer_id)


@router.put(
    "/households/{customer_id}/alert-preferences", response_model=AlertPreferences
)
async def put_alert_preferences(
    customer_id: str, prefs: AlertPreferences
) -> AlertPreferences:
    """Set the thresholds.

    The path parameter wins over the body. A body carrying a different `account_ref` is a
    request to write one customer's settings under another's id, and it is the shape a
    broken client produces long before it is the shape an attacker does — either way the
    only safe reading is the one in the URL.

    Validation (monotonic ladder, 5-200% bounds, real timezone) happens in the Pydantic
    model, so an invalid ladder is a 422 with a readable message rather than a policy
    layer quietly sorting the numbers behind the customer's back.
    """
    return await get_preferences_store().put(
        prefs.model_copy(update={"account_ref": customer_id})
    )


@router.get(
    "/households/{customer_id}/context", response_model=HouseholdContext
)
async def get_household_context(customer_id: str) -> HouseholdContext:
    """What this household has told us about their home.

    Returns an empty context for a household that has never been asked, rather than 404 —
    "nothing known" is a real state and the app has to render it.
    """
    return await get_context_store().get(customer_id)


@router.post(
    "/households/{customer_id}/context/answers", response_model=HouseholdContext
)
async def answer_question(
    customer_id: str, response: QuestionResponse
) -> HouseholdContext:
    """Record an answer to a clarifying question.

    The answer is a closed set — yes, no, not sure — plus at most a date and a count.
    Deliberately not free text: taking prose back and pasting it into the next prompt
    would put uncomputed figures into the model's context ("probably 400 kWh"), which is
    the exact failure the FactBundle exists to prevent. See `app/clarify/schemas.py`.

    A 404 for an unknown question id rather than silently recording it: an id we do not
    recognise means the client is out of date, and storing it would mark a question as
    asked that this backend has no way to ask again.
    """
    try:
        ctx = await get_repository().context(customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    household = await get_context_store().get(customer_id)
    question = _rebuild_question(response.question_id, customer_id, ctx, household)
    if question is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"no open question with id {response.question_id!r} for this household — "
                "it may already be answered, or no longer applicable."
            ),
        )

    updated = apply.record(household, question, response)
    return await get_context_store().put(updated)


def _rebuild_question(
    question_id: str,
    customer_id: str,
    ctx: UsageContext,
    household: HouseholdContext,
) -> ClarifyingQuestion | None:
    """Re-derive the question the client is answering, and check it is still the open one.

    The alternative — trusting the id in the request body — would let a client record an
    answer to a question that was never asked, or to one that no longer applies because
    the data moved. Re-deriving costs one pure assessment and makes the id unforgeable in
    the only way that matters: it has to be the question this household would be asked
    right now.
    """
    from app.alerts.preferences import defaults_for

    assessment = billshock.assess(
        ctx.window,
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=ctx.hdd[: len(ctx.window.daily_kwh)],
        normal_hdd_per_day=ctx.normal_hdd,
        comparable_home_kwh_per_day=ctx.baseline,
        preferences=defaults_for(customer_id),
    )
    gaps = detect.find_gaps(
        daily_kwh=ctx.window.daily_kwh,
        daily_hdd=ctx.hdd[: len(ctx.window.daily_kwh)],
        response=assessment.forecast.response,
        unit_price_nzd=ctx.window.unit_price_nzd,
        overshoot_nzd=assessment.overshoot_nzd,
        unexplained_nzd=assessment.attribution.everyday_load_nzd,
        attribution_explained=assessment.attribution.explained,
    )
    question = questions.select(gaps, household, period=ctx.window.period)
    return question if question and question.id == question_id else None


@router.get("/offline/models", response_model=list[offline.OfflineModelOption])
async def offline_models() -> list[offline.OfflineModelOption]:
    """What can be downloaded to a device, and how big it is.

    Served rather than hard-coded in the app so the sign-up prompt quotes a size that
    matches what will actually be downloaded. A customer agreeing to "about 530 MB" and
    receiving 1.8 GB on a metered rural connection is a real cost we imposed on them.
    """
    return offline.OFFLINE_MODELS


@router.get("/households/{customer_id}/offline-pack", response_model=offline.OfflinePack)
async def offline_pack(customer_id: str) -> offline.OfflinePack:
    """Everything a device needs to answer this household's questions with no network.

    Fetched by the client while it still has a connection, on the customer's schedule —
    the server never pushes. Carries pre-computed fact bundles, not meter readings: a
    device holding the raw series is a device whose on-device model can be asked to add
    it up, which is the one thing this architecture exists to prevent, on the platform
    where it is hardest to audit.

    See `app/offline.py` and `docs/adr/0008-offline-first-narration.md`.
    """
    try:
        ctx = await get_repository().context(customer_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return offline.PackBuilder(system_prompt=SYSTEM).build(customer_id, ctx)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Non-streaming path. Simpler to test; /chat/stream is what the apps use."""
    try:
        result = await answer(
            req.customer_id,
            req.message,
            conversation_id=req.conversation_id,
        )
    except UnknownCustomerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentUnavailable as exc:
        # 503, not 500. The service is fine; the model is not reachable, and that is a
        # "come back shortly" rather than a bug in the request. A client can retry a 503
        # and should not retry a 500.
        log.error("agent unavailable customer=%s: %s", req.customer_id, exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Sparky can't reach your account data right now, so there's nothing "
                "reliable to tell you. Please try again shortly."
            ),
        ) from exc

    return ChatResponse(
        customer_id=result.customer_id,
        text=result.text,
        sources=[SourceRef(**s) for s in result.sources],
        escalate_to_human=result.escalate,
        tier=result.tier,
        tier_reason=result.tier_reason,
        escalation_reason=result.escalation_reason,
        conversation_id=result.conversation_id,
        latency_ms=result.latency_ms,
    )


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    """SSE. Streams the answer as the assistant works.

    The event sequence is documented on `pipeline.answer_stream`, which produces it.
    Five names, and `reset` is the one worth reading about before writing a client.

    **What changed here, and why the old comment above this function no longer applies.**
    It used to say verification is a whole-text check, so the answer had to be generated
    in full and checked before a single token could be streamed. That constraint came
    from the number-checker, which compared the finished prose against a pre-computed
    fact bundle. There is no bundle now — the model reads the data itself and its
    figures are traceable to the tool results recorded alongside the answer — so nothing
    has to be withheld until the last sentence lands. The stream is live again, which is
    most of the perceived speed.
    """
    # Resolve the customer before the response starts. Raising inside the generator would
    # already have committed a 200 and an SSE content-type, so an unknown customer
    # surfaced as a 500 with a half-open stream while /chat returned a clean 404 for the
    # same input.
    try:
        await build_context(req.customer_id)
    except UnknownCustomerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def event_stream():
        # `answer_stream` records the evidence before it emits `done`, so a client that
        # disconnects on `done` has not raced the write. The recorder swallows its own
        # failures, so this cannot break the stream.
        async for name, payload in answer_stream(
            req.customer_id,
            req.message,
            conversation_id=req.conversation_id,
        ):
            yield f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # Nginx buffers proxied responses by default, which holds an SSE stream until it
        # has enough bytes to be worth forwarding — the answer then arrives all at once
        # and the streaming looks broken in exactly the deployment where it matters.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------- Vapi Custom LLM adapter (Tier 3 voice calls) ----------
#
# Vapi handles telephony, STT and TTS. It connects to us via its "Custom LLM"
# integration, which sends an OpenAI-shaped /chat/completions request and expects
# an OpenAI-compatible SSE chunked response. This endpoint is the translation
# layer — the same `answer()` path `/chat` and the voice WebSocket use, reformatted
# for a different wire.
#
# Nothing here computes a figure. If it does, it is in the wrong file.


class _VapiMessage(_VapiBaseModel):
    role: str
    content: str


class _VapiCompletionRequest(_VapiBaseModel):
    """Vapi's OpenAI-compatible request shape.

    Vapi sends this as its "Custom LLM" integration. We accept the full shape
    and ignore everything except `messages` — the model choice is ours (layer 2),
    and streaming is always on because Vapi expects chunked SSE.
    """

    messages: list[_VapiMessage]
    model: str | None = None
    stream: bool = True
    temperature: float | None = None
    max_tokens: int | None = None
    # Vapi passes call metadata here; we don't branch on it today.
    call: dict | None = None


_CUSTOMER_ID_RE = re.compile(r"customer_id:\s*(\S+)", re.IGNORECASE)


def _extract_customer_id(
    messages: list[_VapiMessage], header: str | None
) -> str | None:
    """Find the customer this call is about.

    Two paths, because Vapi operators configure outbound calls differently:

    1. An explicit header (`X-Vapi-Customer-Id`) set on the Vapi assistant's
       server URL configuration. Cheapest to parse, hardest to misconfigure.
    2. A `customer_id: <value>` line inside the system message that Vapi sends.
       This is where the outbound call template injects per-call metadata.

    Header wins when both are present — it is the more explicit signal, and a
    system message that disagrees with the header is a misconfiguration that
    should lose rather than win silently.
    """
    if header:
        return header.strip()
    for msg in messages:
        if msg.role == "system":
            m = _CUSTOMER_ID_RE.search(msg.content)
            if m:
                return m.group(1)
    return None


def _vapi_chunk(content: str) -> str:
    """One OpenAI-compatible SSE chunk. Vapi reads this format verbatim."""
    payload = {
        "id": "chatcmpl-kea",
        "object": "chat.completion.chunk",
        "choices": [{"index": 0, "delta": {"content": content}}],
    }
    return f"data: {json.dumps(payload)}\n\n"


_VAPI_DONE = "data: [DONE]\n\n"

# Spoken apologies. These are figure-free by construction — layer 3 has nothing to
# check — and they are the only thing a customer on a phone call can hear when
# something goes wrong. An HTTP 404 is silence; these are not.
_VAPI_UNKNOWN_CUSTOMER = (
    "I'm sorry, I'm having trouble pulling up your account details right now. "
    "Let me transfer you to someone who can help."
)
_VAPI_NO_CUSTOMER_ID = (
    "I wasn't able to identify your account. "
    "Let me put you through to a team member who can assist."
)
_VAPI_INTERNAL_ERROR = (
    "I'm sorry, I'm experiencing a technical issue right now. "
    "Let me connect you with someone who can help."
)


@router.post("/vapi/chat/completions")
async def vapi_chat_completions(
    req: _VapiCompletionRequest,
    x_vapi_customer_id: str | None = Header(None),
) -> StreamingResponse:
    """Vapi Custom LLM endpoint. Same agent, OpenAI wire format.

    Vapi places an outbound call (Tier 3 bill-shock alert), handles STT/TTS, and
    sends us an OpenAI-shaped request with the customer's transcribed speech. We
    run it through the same `answer()` path every other channel uses and return the
    result as OpenAI-compatible SSE chunks.

    Errors are spoken apologies, not HTTP status codes. A 404 on a phone call is
    silence — the customer hears nothing. The apology is the error handling.

    **Escalation no longer short-circuits the answer.** The old version returned a
    transfer line and hung up on the explanation, because layer 0 decided a call was a
    hardship call from keywords before anything had been read. The agent decides while
    holding the account, and an escalation is a thing it does *alongside* answering —
    somebody in payment difficulty who asked why the bill went up should be told why,
    warmly, and then put through. `result.escalate` is logged so the Vapi assistant's
    own transfer rule can act on it.
    """
    # --- extract inputs ---
    customer_id = _extract_customer_id(req.messages, x_vapi_customer_id)
    if not customer_id:
        log.warning("vapi: no customer_id in request")
        return _vapi_apology_response(_VAPI_NO_CUSTOMER_ID)

    # Last user message is the transcribed speech.
    user_messages = [m for m in req.messages if m.role == "user"]
    message = user_messages[-1].content.strip() if user_messages else ""
    if not message:
        return _vapi_apology_response(
            "I didn't quite catch that. Could you say that again?"
        )

    try:
        await build_context(customer_id)
    except UnknownCustomerError:
        log.warning("vapi: unknown customer %s", customer_id)
        return _vapi_apology_response(_VAPI_UNKNOWN_CUSTOMER)

    async def vapi_stream():
        try:
            result = await answer(customer_id, message, channel="vapi")
            if result.escalate:
                log.info(
                    "vapi: escalation customer=%s reason=%s",
                    customer_id,
                    result.escalation_reason,
                )
            # `sentences`, not `text`: the property strips markdown before splitting, and
            # a synthesiser reading "asterisk asterisk your bill asterisk asterisk" down
            # a phone line is the failure this exists to prevent.
            for sentence in result.sentences:
                yield _vapi_chunk(sentence + " ")
        except Exception:
            log.exception("vapi: answer failed customer=%s", customer_id)
            yield _vapi_chunk(_VAPI_INTERNAL_ERROR)
        yield _VAPI_DONE

    return StreamingResponse(vapi_stream(), media_type="text/event-stream")


def _vapi_apology_response(text: str) -> StreamingResponse:
    """A single-chunk apology stream. The customer hears the sentence; Vapi never
    sees an HTTP error that would drop the call."""

    async def stream():
        yield _vapi_chunk(text)
        yield _VAPI_DONE

    return StreamingResponse(stream(), media_type="text/event-stream")



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
