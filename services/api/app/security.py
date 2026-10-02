"""Issuer-verified household access and timestamped provider receipts."""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from functools import lru_cache
from typing import Literal

from fastapi import HTTPException

from app import auth
from app.config import settings


@lru_cache(maxsize=4)
def jwks_client(issuer: str):
    import jwt

    return jwt.PyJWKClient(issuer.rstrip("/") + "/.well-known/jwks.json", timeout=5)


def identity(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in to continue.")
    token = authorization[7:]
    if settings.oidc_issuer and settings.oidc_client_id:
        import jwt

        try:
            key = jwks_client(settings.oidc_issuer).get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=settings.oidc_client_id,
                issuer=settings.oidc_issuer,
                options={"require": ["exp", "iat", "sub"]},
            )
            account = claims.get("custom:account_ref")
            if claims.get("token_use") not in (None, "id"):
                raise ValueError("Expected configured OIDC identity token")
            if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", account):
                raise ValueError("Missing administrator-assigned household scope")
            return {
                "customer_id": account,
                "display_name": claims.get("name", "Kea customer"),
                "email": claims.get("email", ""),
                "sub": claims["sub"],
            }
        except Exception:
            raise HTTPException(401, "Session expired or invalid. Please sign in again.") from None
    if settings.demo_logins and not settings.production:
        account = auth.demo_token_customer(token)
        if account:
            return {"customer_id": account}
    raise HTTPException(401, "Session expired or authentication is not configured.")


def household_access(account_ref: str, authorization: str | None) -> dict:
    claims = identity(authorization)
    if claims["customer_id"] != account_ref:
        raise HTTPException(403, "This account cannot access that household.")
    return claims


def verify_receipt(
    body: bytes,
    timestamp: str | None,
    signature: str | None,
    domain: Literal["outages", "rewards", "delivery"] = "delivery",
) -> None:
    secret = {
        "outages": settings.outage_ingestion_secret,
        "rewards": settings.reward_receipt_secret,
        "delivery": settings.delivery_receipt_secret,
    }[domain]
    if len(secret) < 32:
        raise HTTPException(503, "Provider receipt verification is not configured.")
    try:
        stamp = int(timestamp or "")
    except ValueError:
        raise HTTPException(401, "Invalid receipt timestamp.") from None
    expected = hmac.new(
        secret.encode(), str(stamp).encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    if abs(time.time() - stamp) > 300 or not hmac.compare_digest(signature or "", expected):
        raise HTTPException(401, "Invalid or expired provider receipt.")


def validate_production() -> None:
    if not settings.production:
        return
    if settings.demo_logins or not settings.persist:
        raise RuntimeError("Production requires persistence and disabled demo logins.")
    if not settings.oidc_issuer.startswith("https://") or not settings.oidc_client_id:
        raise RuntimeError("Production requires an HTTPS OIDC issuer and client ID.")
    secrets = (
        settings.outage_ingestion_secret,
        settings.reward_receipt_secret,
        settings.delivery_receipt_secret,
    )
    if any(len(secret) < 32 for secret in secrets) or len(set(secrets)) != 3:
        raise RuntimeError(
            "Production requires three distinct integration secrets of at least 32 characters."
        )
    if any(not origin.startswith("https://") for origin in settings.cors_list):
        raise RuntimeError("Production browser origins must use HTTPS.")
