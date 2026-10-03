"""Authenticated product routes and signed integration ingestion."""

from __future__ import annotations

import base64
import datetime as dt
import io
import wave
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import get_preferences_store, settings
from app.experience import (
    ClashProgress,
    OutageSnapshot,
    OutageView,
    PlanAction,
    RewardEvent,
    VerifiedAction,
    experience_store,
    reward_for,
)
from app.security import household_access, verify_receipt

router = APIRouter()
Authorization = Annotated[str | None, Header()]


@router.get("/auth/config")
async def auth_config() -> dict:
    return {
        "issuer": settings.oidc_issuer or None,
        "client_id": settings.oidc_client_id or None,
        "demo": settings.demo_logins and not settings.production,
    }


@router.get("/households/{account}/scheduled-outages", response_model=OutageView)
async def scheduled_outages(account: str, authorization: Authorization = None):
    household_access(account, authorization)
    return await experience_store().outage(account)


@router.post("/internal/scheduled-outages")
async def receive_outages(request: Request):
    body = await signed_body(request, "outages")
    try:
        snapshot = OutageSnapshot.model_validate_json(body)
        changed = await experience_store().ingest(snapshot)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return {"updated": changed}


@router.get("/households/{account}/clash", response_model=ClashProgress)
async def clash_progress(account: str, authorization: Authorization = None):
    household_access(account, authorization)
    return await experience_store().progress(account)


@router.post("/households/{account}/clash/plans", response_model=ClashProgress)
async def plan_action(account: str, action: PlanAction, authorization: Authorization = None):
    household_access(account, authorization)
    day = (
        dt.datetime.now(dt.UTC)
        .astimezone(__import__("zoneinfo").ZoneInfo("Pacific/Auckland"))
        .date()
    )
    event = RewardEvent(
        key=f"plan:{action.mission_id}:{day}",
        mission_id=action.mission_id,
        evidence="planned",
        xp=5,
        day=day,
        source="Your plan; not device verified",
    )
    await experience_store().award(account, event)
    return await experience_store().progress(account)


@router.post("/internal/clash/receipts")
async def receive_action(request: Request):
    body = await signed_body(request, "rewards")
    try:
        receipt = VerifiedAction.model_validate_json(body)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    awarded = await experience_store().award(receipt.account_ref, reward_for(receipt))
    return {"awarded": awarded}


async def signed_body(request: Request, domain: Literal["outages", "rewards", "delivery"]) -> bytes:
    body = await request.body()
    if len(body) > 100_000:
        raise HTTPException(413, "Provider receipt exceeds the limit.")
    verify_receipt(
        body, request.headers.get("x-kea-timestamp"), request.headers.get("x-kea-signature"), domain
    )
    return body


class DeliveryReceipt(BaseModel):
    provider: Literal["ses", "sns", "connect"]
    provider_id: str = Field(min_length=1, max_length=256)
    status: Literal["delivered", "failed", "bounced", "complaint", "opted_out", "answered"]


@router.post("/internal/alerts/delivery")
async def receive_delivery(request: Request):
    try:
        receipt = DeliveryReceipt.model_validate_json(await signed_body(request, "delivery"))
    except ValueError:
        raise HTTPException(422, "Invalid delivery receipt.") from None
    if not settings.persist:
        raise HTTPException(503, "Delivery tracking needs persistent storage.")
    from app.db.models import Alert, AlertDelivery
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        row = await session.scalar(
            select(AlertDelivery)
            .where(
                AlertDelivery.provider == receipt.provider,
                AlertDelivery.destination == receipt.provider_id,
            )
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Unknown provider delivery.")
        parent = await session.get(Alert, row.alert_id)
        if receipt.status in {"complaint", "opted_out", "bounced"}:
            prefs = await get_preferences_store().get(parent.account_ref)
            field = {"email": "email_enabled", "sms": "sms_enabled", "voice": "voice_enabled"}[
                row.channel
            ]
            await get_preferences_store().put(prefs.model_copy(update={field: False}))
        # A phone answer is not evidence that the recipient heard a message.
        if receipt.status == "answered":
            row.failure_reason = "Call answered; message delivery unconfirmed."
        elif row.failure_reason not in {"complaint", "opted_out", "bounced"} and (
            row.status != "delivered" or receipt.status in {"complaint", "opted_out", "bounced"}
        ):
            row.status = "delivered" if receipt.status == "delivered" else "failed"
            row.failure_reason = receipt.status
            if row.status == "delivered":
                row.delivered_at = dt.datetime.now(dt.UTC)
                parent.status = "delivered"
                parent.delivered_at = row.delivered_at
        await session.commit()
    return {"recorded": True}


class VoiceTurn(BaseModel):
    transcript: str
    answer: str
    audio_wav_base64: str | None
    sample_rate: int | None
    speech_error: str | None = None


@router.post("/households/{account}/voice/turn", response_model=VoiceTurn)
async def voice_turn(account: str, audio: UploadFile, authorization: Authorization = None):
    household_access(account, authorization)
    from app import voice
    from app.pipeline import answer
    from app.voice.stt_gemini import GeminiSpeechToText

    if not settings.voice_enabled or not voice.get_stt().available:
        raise HTTPException(503, "Voice is unavailable. Continue with text.")
    data = await audio.read(5_000_001)
    if len(data) > 5_000_000:
        raise HTTPException(413, "Voice turn exceeds the limit.")
    if audio.content_type not in {"audio/mp4", "audio/m4a", "audio/webm", "audio/ogg", "audio/wav"}:
        raise HTTPException(415, "Unsupported recording format.")
    stt = voice.get_stt()
    if not isinstance(stt, GeminiSpeechToText):
        raise HTTPException(503, "Recorded voice turns require the Gemini transcriber.")
    try:
        transcript = await stt.transcribe_encoded(data, audio.content_type)
        if not transcript.text:
            raise HTTPException(422, "No speech detected. Please try again.")
        result = await answer(
            account, transcript.text, channel="voice", language=transcript.language
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            503, "Voice could not answer. Please retry or continue with text."
        ) from None
    try:
        utterance = await voice.get_tts().synthesise(" ".join(result.sentences))
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(utterance.sample_rate)
            wav.writeframes(utterance.pcm)
        return VoiceTurn(
            transcript=transcript.text,
            answer=result.text,
            audio_wav_base64=base64.b64encode(output.getvalue()).decode(),
            sample_rate=utterance.sample_rate,
        )
    except Exception:
        return VoiceTurn(
            transcript=transcript.text,
            answer=result.text,
            audio_wav_base64=None,
            sample_rate=None,
            speech_error="Speech is unavailable. Your verified answer is shown below.",
        )
