"""Kea Energy home energy advisor — API entrypoint.

Run:  make dev      (or: uvicorn app.main:app --reload)
Docs: http://localhost:8000/docs
Spec: http://localhost:8000/openapi.json   <- the frontend generates types from this
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import voice
from app.alerts.store import PreferencesUnavailable
from app.api.account_actions import router as account_actions_router
from app.api.experience import router as experience_router
from app.api.routes import router
from app.config import get_provider, settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("kea")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from app.security import validate_production

    validate_production()
    provider = get_provider()
    log.info("provider=%s model=%s", provider.name, provider.model)

    # Warm the weights so the first real request isn't a cold start. Several GB load
    # from disk on first use; ten seconds of silence at the top of a demo reads as
    # a crash.
    warm = getattr(provider, "warm", None)
    if warm is not None:
        log.info("warming model ...")
        await warm()
        log.info("model warm")

    if settings.voice_enabled:
        status = voice.status()
        log.info(
            "voice enabled — stt=%s tts=%s",
            status["stt"]["available"],
            status["tts"]["available"],
        )
        if not status["ready"]:
            # Loud, because the alternative is discovering it when someone taps the mic
            # in front of an audience. The API still serves chat perfectly well.
            log.warning("voice is ENABLED but not READY — run ml/voice/setup.sh")
        else:
            # Same reasoning as warming the language model: the acknowledgement is the
            # thing that covers model latency, so it must not itself be the slow one.
            made = await voice.get_tts().prewarm()
            log.info("pre-synthesised %d acknowledgements", made)

    yield

    # The provider is cached and owns a connection pool, so it needs closing.
    aclose = getattr(provider, "aclose", None)
    if aclose is not None:
        await aclose()


app = FastAPI(
    title="Sparky — Kea Energy's Home Energy Advisor",
    version="0.1.0",
    description=(
        "Every number in every answer is computed by Python and verified before it "
        "reaches the customer. The model writes the sentence; it never does the maths."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


app.include_router(router, prefix="/api")
app.include_router(experience_router, prefix="/api")
app.include_router(account_actions_router, prefix="/api")


@app.middleware("http")
async def production_authorization(request: Request, call_next):
    if not settings.production or request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    public = {"/api/health", "/api/auth/config"}
    if not path.startswith("/api/") or path in public or path.startswith("/api/internal/"):
        return await call_next(request)
    import asyncio

    from fastapi import HTTPException

    from app.security import identity

    try:
        claims = await asyncio.to_thread(identity, request.headers.get("authorization"))
        parts = path.split("/")
        unavailable = {"/api/households", "/api/auth/login", "/api/auth/demo-accounts"}
        if path in unavailable or path.startswith("/api/vapi/"):
            raise HTTPException(403, "This route is unavailable in customer deployments.")
        if len(parts) > 3 and parts[2] == "households" and parts[3] != claims["customer_id"]:
            raise HTTPException(403, "This account cannot access that household.")
        if path in {"/api/chat", "/api/chat/stream"}:
            body = await request.json()
            if not isinstance(body, dict):
                raise HTTPException(400, "Invalid request.")
            if body.get("customer_id") != claims["customer_id"]:
                raise HTTPException(403, "This account cannot access that household.")
    except HTTPException as error:
        return JSONResponse(status_code=error.status_code, content={"detail": error.detail})
    except (ValueError, TypeError):
        return JSONResponse(status_code=400, content={"detail": "Invalid request."})
    return await call_next(request)


@app.exception_handler(PreferencesUnavailable)
async def unavailable_preferences(request: Request, error: PreferencesUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(error)})
