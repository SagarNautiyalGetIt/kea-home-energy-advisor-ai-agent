"""Runtime configuration. Environment-driven so the provider swaps without a code change."""

from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass, field
from functools import lru_cache

from app.hardware import select_ollama_model


def _load_dotenv() -> None:
    """Read the repo-root `.env` into the environment, without a dependency.

    The README says `cp .env.example .env` and then `make api-dev`. Nothing read that
    file: `Settings` uses bare `os.getenv`, so every value in it was ignored and the API
    came up on fixtures with no recording, no demo logins and no voice — silently, and
    with `/health` cheerfully reporting the degraded state to nobody looking.

    Fifteen lines rather than `python-dotenv`, because the whole job is `KEY=VALUE` and
    a dependency for that has to be installed by five teammates before the README works.

    **`setdefault`, never overwrite.** A real exported variable always wins over the
    file. `.claude/launch.json` and CI both set variables explicitly, and a `.env` that
    silently overrode them would be a worse trap than the one this replaces.
    """
    root = pathlib.Path(__file__).resolve().parents[3]
    env_file = root / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ.setdefault(key, value)


_load_dotenv()


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

    #: Sized to the machine — see `app.hardware`. On the 48 GB M4 this is `gemma3:27b`,
    #: on the 16 GB M5 `gemma3:12b`, and `gemma3:4b` everywhere else including CI.
    #:
    #: `select_ollama_model()` reads KEA_OLLAMA_MODEL itself and returns it unchanged
    #: when set, so an explicit choice still wins and the bake-off is unaffected. The
    #: env var is deliberately NOT the `_env` default here: doing that would make the
    #: hardware probe run on every Settings construction, including in tests.
    ollama_model: str = field(default_factory=lambda: select_ollama_model())
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

    # --- Voice (ADR-0003) ---------------------------------------------------
    # KEA-56: off by default. Voice is the one part of the demo that can fail for
    # reasons no code change fixes on the night — a missing binary, a browser that
    # refused the mic, a machine without the model weights. It has to be possible to
    # turn it off from the environment without touching a file, and it has to be
    # *off* on a fresh clone so nobody's `make api-dev` starts failing on a laptop
    # that never ran the voice setup script.
    voice_enabled: bool = field(
        default_factory=lambda: _env("KEA_VOICE_ENABLED", "0").lower() in {"1", "true", "yes"}
    )

    # Paths, not auto-discovery. `ml/voice/setup.sh` writes these into .env, so a
    # broken voice stack fails with "no such file" naming the exact path we looked
    # for, rather than silently selecting some other whisper on the PATH.
    whisper_bin: str = field(default_factory=lambda: _env("KEA_WHISPER_BIN", ""))
    whisper_model: str = field(default_factory=lambda: _env("KEA_WHISPER_MODEL", ""))
    piper_bin: str = field(default_factory=lambda: _env("KEA_PIPER_BIN", ""))
    piper_voice: str = field(default_factory=lambda: _env("KEA_PIPER_VOICE", ""))
    silero_vad_model: str = field(default_factory=lambda: _env("KEA_SILERO_VAD_MODEL", ""))

    #: Demo sign-in (app/auth.py). OFF unless set — a deployment that forgets this
    #: gets 503 from /api/auth/login rather than fourteen accounts with printed
    #: passwords. Never enable it anywhere a real customer could reach.
    demo_logins: bool = field(
        default_factory=lambda: _env("KEA_DEMO_LOGINS", "0").lower() in {"1", "true", "yes"}
    )

    # --- Tiered alerts ------------------------------------------------------
    #: Off by default like the recorder, and for the same reason: sending needs a
    #: database to hold the idempotency constraint, and the frontend team runs the API
    #: without one. Reported on `/health` so "no alerts were sent" and "alerts are
    #: switched off" are never indistinguishable.
    alerts_enabled: bool = field(
        default_factory=lambda: _env("KEA_ALERTS_ENABLED", "0").lower() in {"1", "true", "yes"}
    )

    #: `file` writes a real .eml to `email_outbox`; `smtp` sends. See app/alerts/email.py
    #: for why a file is the default on a machine that will be on conference wifi.
    email_backend: str = field(default_factory=lambda: _env("KEA_EMAIL_BACKEND", "file"))
    email_outbox: str = field(default_factory=lambda: _env("KEA_EMAIL_OUTBOX", "var/outbox"))
    email_from: str = field(
        default_factory=lambda: _env("KEA_EMAIL_FROM", "Kea Energy <no-reply@kea.example>")
    )

    smtp_host: str = field(default_factory=lambda: _env("KEA_SMTP_HOST", "smtp.gmail.com"))
    smtp_port: int = field(default_factory=lambda: int(_env("KEA_SMTP_PORT", "587")))
    smtp_username: str = field(default_factory=lambda: _env("KEA_SMTP_USERNAME", ""))
    #: Never committed, never logged. `.env` is gitignored; the SMTP backend refuses to
    #: construct without it rather than degrading silently to "no mail".
    smtp_password: str = field(default_factory=lambda: _env("KEA_SMTP_PASSWORD", ""))
    smtp_timeout: int = field(default_factory=lambda: int(_env("KEA_SMTP_TIMEOUT", "10")))

    #: Where the tier-1 email goes in the demo. The seeded households carry no personal
    #: details by design (see models.Customer), so there is no address to read off the
    #: account — this is the operator's own inbox, set for a rehearsal.
    demo_recipient: str = field(
        default_factory=lambda: _env("KEA_DEMO_RECIPIENT", "demo@kea.example")
    )

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


@lru_cache(maxsize=1)
def get_dispatcher():
    """Tiered alerting.

    Needs `persist` as well as `alerts_enabled`: the idempotency guard is a database
    constraint, and without it a polling dashboard emails the customer on every poll.
    Requiring both means there is no configuration where alerts send without the thing
    that stops them sending repeatedly.
    """
    from pathlib import Path

    from app.alerts.email import build_sender
    from app.alerts.service import AlertDispatcher, NullDispatcher

    if not (settings.alerts_enabled and settings.persist):
        return NullDispatcher()

    from app.db.session import get_sessionmaker

    sender = build_sender(
        backend=settings.email_backend,
        outbox=Path(settings.email_outbox),
        sender=settings.email_from,
        host=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        timeout=settings.smtp_timeout,
    )
    return AlertDispatcher(sender=sender, sessionmaker=get_sessionmaker())
