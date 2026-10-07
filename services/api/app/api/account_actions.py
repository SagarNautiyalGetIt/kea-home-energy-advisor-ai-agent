"""Authenticated client actions; payment execution requires a configured provider."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.account import client_state
from app.account.changes import PlanChangeRequest
from app.account.mobile_plans import mobile_plans
from app.config import get_change_store, get_repository, settings
from app.security import household_access

router = APIRouter()
Authorization = Annotated[str | None, Header()]


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProfileUpdate(StrictInput):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    phone: str = Field(default="", max_length=20, pattern=r"^(\+[1-9]\d{7,14})?$")


@router.put("/households/{customer_id}/profile")
async def update_profile(
    customer_id: str, body: ProfileUpdate, authorization: Authorization = None
):
    household_access(customer_id, authorization)
    await get_repository().context(customer_id)
    await client_state.put(customer_id, "profile", body.model_dump())
    from app.api.routes import get_customer_profile

    return await get_customer_profile(customer_id)


class Feedback(StrictInput):
    customer_id: str
    message_id: str = Field(min_length=1, max_length=64)
    feedback: Literal["like", "dislike"]


@router.post("/assistant/feedback", status_code=201)
async def feedback(body: Feedback, authorization: Authorization = None):
    household_access(body.customer_id, authorization)
    await client_state.put(body.customer_id, "feedback:" + body.message_id, body.model_dump())
    return {"status": "recorded"}


@router.post("/households/{customer_id}/assistant/attachments", status_code=201)
async def attachment(
    customer_id: str, file: Annotated[UploadFile, File()], authorization: Authorization = None
):
    household_access(customer_id, authorization)
    content = await file.read(512 * 1024 + 1)
    if not content or len(content) > 512 * 1024:
        raise HTTPException(413, "Choose a file smaller than 512 KB.")
    kind = file.content_type or ""
    signatures = {
        "application/pdf": b"%PDF-",
        "image/png": b"\x89PNG\r\n\x1a\n",
        "image/jpeg": b"\xff\xd8\xff",
    }
    if kind not in signatures or not content.startswith(signatures[kind]):
        raise HTTPException(415, "Choose a PDF, PNG or JPEG with a valid file header.")
    identifier = uuid.uuid4().hex
    if len(await client_state.records("attachment:", customer_id)) >= 10:
        raise HTTPException(429, "Remove an earlier attachment before adding another.")
    record = {"content_type": kind, "bytes": len(content)}
    if settings.persist:
        bucket = os.getenv("KEA_ATTACHMENT_BUCKET", "").strip()
        if not bucket:
            raise HTTPException(503, "Private attachment storage is not configured.")
        from app.alerts.aws_channels import aws_client

        s3 = aws_client("s3", settings.aws_region)
        key = "attachments/" + hashlib.sha256(customer_id.encode()).hexdigest() + "/" + identifier
        try:
            blocked = await asyncio.to_thread(s3.get_public_access_block, Bucket=bucket)
            if not all(
                blocked["PublicAccessBlockConfiguration"].get(name)
                for name in (
                    "BlockPublicAcls",
                    "IgnorePublicAcls",
                    "BlockPublicPolicy",
                    "RestrictPublicBuckets",
                )
            ):
                raise ValueError("Bucket must block all public access")
            await asyncio.to_thread(
                s3.put_object,
                Bucket=bucket,
                Key=key,
                Body=content,
                ContentType=kind,
                ServerSideEncryption="AES256",
            )
        except Exception:
            raise HTTPException(
                503, "Private attachment storage could not accept the file."
            ) from None
        record.update(bucket=bucket, key=key)
    else:
        record["content"] = base64.b64encode(content).decode()
    await client_state.put(customer_id, "attachment:" + identifier, record)
    return {"attachment_id": identifier, "status": "stored", "analysis": "not_requested"}


@router.delete("/households/{customer_id}/assistant/attachments/{attachment_id}", status_code=204)
async def delete_attachment(
    customer_id: str, attachment_id: str, authorization: Authorization = None
):
    household_access(customer_id, authorization)
    record = await client_state.get(customer_id, "attachment:" + attachment_id)
    if record and record.get("bucket"):
        from app.alerts.aws_channels import aws_client

        await asyncio.to_thread(
            aws_client("s3", settings.aws_region).delete_object,
            Bucket=record["bucket"],
            Key=record["key"],
        )
    await client_state.delete(customer_id, "attachment:" + attachment_id)


class SwitchPlan(StrictInput):
    customer_id: str
    pricing_style: str
    commitment_term: str


@router.post(
    "/households/{customer_id}/plan-change-requests",
    response_model=PlanChangeRequest,
    status_code=201,
)
async def switch_plan(customer_id: str, body: SwitchPlan, authorization: Authorization = None):
    household_access(customer_id, authorization)
    if body.customer_id != customer_id:
        raise HTTPException(403, "Account scope does not match.")
    ctx = await get_repository().context(customer_id)
    catalogue = mobile_plans(ctx.account)
    offer = next((item for item in catalogue.pricing_styles if item.id == body.pricing_style), None)
    if offer is None or body.commitment_term not in {
        item.id for item in catalogue.commitment_terms
    }:
        raise HTTPException(422, "Choose a published plan and commitment term.")
    request = PlanChangeRequest(
        account_ref=customer_id,
        from_plan=ctx.account.plan.name if ctx.account and ctx.account.plan else None,
        to_plan_code=offer.id,
        to_plan_name=offer.name + " · " + body.commitment_term,
        channel="app",
    )
    return await get_change_store().record(request)


class PushRegistration(StrictInput):
    token: str = Field(
        max_length=200, pattern=r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$"
    )
    enabled: bool = True


@router.post("/households/{customer_id}/push-tokens")
async def push_token(customer_id: str, body: PushRegistration, authorization: Authorization = None):
    household_access(customer_id, authorization)
    key = "push:" + hashlib.sha256(body.token.encode()).hexdigest()
    # A physical device changing accounts must stop receiving the previous account's alerts.
    if body.enabled:
        current = await client_state.get("__devices__", key) or {}
        prior = current if current.get("account") == customer_id else {}
        await client_state.put(
            "__devices__",
            key,
            {
                **prior,
                **body.model_dump(),
                "account": customer_id,
                "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
            },
        )
    else:
        current = await client_state.get("__devices__", key)
        if current and current.get("account") == customer_id:
            await client_state.update_device(key, customer_id, None)
    return {"registered": body.enabled}


class InvoicePayment(StrictInput):
    customer_id: str
    invoice_id: str = Field(min_length=1, max_length=100)
    payment_method_id: str = Field(min_length=1, max_length=100)


@router.post("/households/{customer_id}/payments")
async def pay_invoice(customer_id: str, body: InvoicePayment, authorization: Authorization = None):
    household_access(customer_id, authorization)
    if body.customer_id != customer_id:
        raise HTTPException(403, "Account scope does not match.")
    raise HTTPException(
        501,
        "Card payments are unavailable. Use the verified transfer details on your issued bill. "
        "No payment was taken.",
    )


class PaymentMethod(StrictInput):
    customer_id: str
    payment_method_token: str = Field(min_length=1, max_length=256)
    make_default: bool = False


@router.post("/households/{customer_id}/payment-methods")
async def save_method(customer_id: str, body: PaymentMethod, authorization: Authorization = None):
    household_access(customer_id, authorization)
    if body.customer_id != customer_id:
        raise HTTPException(403, "Account scope does not match.")
    raise HTTPException(
        501, "Saved cards are unavailable until retailer payment-provider setup. No card was saved."
    )


@router.delete("/households/{customer_id}/payment-methods/{method_id}")
async def delete_method(customer_id: str, method_id: str, authorization: Authorization = None):
    household_access(customer_id, authorization)
    raise HTTPException(
        501, "Saved-card management requires a configured retailer payment provider."
    )


@router.get("/households/{customer_id}/capabilities")
async def capabilities(customer_id: str, authorization: Authorization = None):
    household_access(customer_id, authorization)
    ctx = await get_repository().context(customer_id)
    account = ctx.account
    return {
        "has_solar": bool(account and account.connection and account.connection.has_solar),
        "has_battery": False,
        "has_ev": False,
        "instant_power_available": False,
    }
