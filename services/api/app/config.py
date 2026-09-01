"""Runtime configuration. Environment-driven so the provider swaps without a code change."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(key: str, default: str) -> str:
    """Read `key` when a Settings is *constructed*, not when this module is imported.

    A bare `x: str = os.getenv(...)` in a dataclass body evaluates once, at class
    creation. Every later `Settings()` then returns the value the environment had at
    import time. The Day 6 model bake-off (KEA-47) is exactly the shape that breaks on:
    set KEA_OLLAMA_MODEL per run, rebuild Settings, benchmark the same 4B model three
    times and record it as three results.
    """
    return os.getenv(key, default)


@dataclass(frozen=True)
class Settings:
    provider: str = field(default_factory=lambda: _env("KEA_PROVIDER", "ollama"))
    ollama_model: str = field(default_factory=lambda: _env("KEA_OLLAMA_MODEL", "gemma3:4b"))
    ollama_url: str = field(
        default_factory=lambda: _env("KEA_OLLAMA_URL", "http://localhost:11434")
    )

    # Sprint 3 — unused until BedrockProvider is implemented.
    bedrock_model: str = field(
        default_factory=lambda: _env("KEA_BEDROCK_MODEL", "anthropic.claude-sonnet-5")
    )
    aws_region: str = field(default_factory=lambda: _env("AWS_REGION", "ap-southeast-2"))

    cors_origins: str = field(
        default_factory=lambda: _env("KEA_CORS_ORIGINS", "http://localhost:5173")
    )

    # ADR-0006. asyncpg driver; the same URL shape points at RDS in Sprint 3.
    database_url: str = field(
        default_factory=lambda: _env(
            "KEA_DATABASE_URL", "postgresql+asyncpg://kea:kea@localhost:5432/kea"
        )
    )

    #: Write conversations, verification verdicts and token counts to PostgreSQL.
    #:
    #: Off by default, and that default is a deliberate trade. On would mean the four
    #: people building the frontend cannot run the API without Docker and a seeded
    #: database. Off means a rehearsal can silently record nothing — so `/health`
    #: reports which recorder is live, and the demo checklist says to look at it.
    #:
    #: Turn it on with KEA_PERSIST=1 after `make db && make api-migrate && make api-seed`.
    persist: bool = field(default_factory=lambda: _env("KEA_PERSIST", "0") == "1")

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


@lru_cache(maxsize=1)
def get_provider():
    """The only place a concrete provider is constructed — and it is constructed once.

    Cached because the provider owns the HTTP connection pool and the `last_usage`
    counter. Building a fresh one per request meant a new TCP connection for every
    chat turn, and made token accounting per-request state that nothing could
    aggregate. `get_provider.cache_clear()` in tests that need a different provider.
    """
    if settings.provider == "bedrock":
        from app.providers.bedrock import BedrockProvider

        return BedrockProvider(model=settings.bedrock_model, aws_region=settings.aws_region)

    from app.providers.ollama import OllamaProvider

    return OllamaProvider(model=settings.ollama_model, base_url=settings.ollama_url)


@lru_cache(maxsize=1)
def get_repository():
    """Where usage data is read from. Same opt-in flag as the recorder: one switch means
    there is no state where the API writes to PostgreSQL but reads from a Python file."""
    from app.analytics.repository import build_repository

    return build_repository(settings.persist)


@lru_cache(maxsize=1)
def get_recorder():
    """The evidence writer. Cached for the same reason the provider is — it owns a
    connection pool. `get_recorder.cache_clear()` in tests that swap it."""
    from app.db.recorder import build_recorder

    return build_recorder(settings.persist)
