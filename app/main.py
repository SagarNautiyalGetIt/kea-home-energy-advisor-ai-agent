"""Kea Energy home energy advisor — API entrypoint.

Run:  make dev      (or: uvicorn app.main:app --reload)
Docs: http://localhost:8000/docs
Spec: http://localhost:8000/openapi.json   <- the frontend generates types from this
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_provider, settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("kea")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
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

    yield

    # The provider is cached and owns a connection pool, so it needs closing.
    aclose = getattr(provider, "aclose", None)
    if aclose is not None:
        await aclose()


app = FastAPI(
    title="Kea Energy — Home Energy Advisor",
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

app.include_router(router, prefix="/api")
