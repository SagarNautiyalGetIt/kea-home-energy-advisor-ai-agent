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
    #: One name, or a `+`-separated fallback chain. See `app.providers.resolver`.
    #:
    #:   gcp              the default — Gemini 3.6 Flash on GCP
    #:   bedrock          Claude on Bedrock
    #:   ollama           local development, chosen deliberately
    #:   gcp+ollama       GCP, dropping to the local model only if it is unreachable
    #:
    #: The default changed to `gcp` for speed. A local model sized to whatever
    #: hardware happened to be present was right for a laptop demo and wrong as an
    #: architecture — the answer a customer gets should not depend on which machine served
    #: it. Nothing falls back automatically: a chain has to be written out, because a
    #: silent model downgrade looks like an answer and reads as the product getting worse.
    provider: str = field(default_factory=lambda: _env("KEA_PROVIDER", "gcp"))

    #: Sized to the machine — see `app.hardware`. On the 48 GB M4 this is `gemma3:27b`,
    #: on the 16 GB M5 `gemma3:12b`, and `gemma3:4b` everywhere else including CI.
    #: Only consulted when `ollama` appears in the provider chain.
    #:
    #: `select_ollama_model()` reads KEA_OLLAMA_MODEL itself and returns it unchanged
    #: when set, so an explicit choice still wins and the bake-off is unaffected. The
    #: env var is deliberately NOT the `_env` default here: doing that would make the
    #: hardware probe run on every Settings construction, including in tests.
    ollama_model: str = field(default_factory=lambda: select_ollama_model())
    ollama_url: str = field(
        default_factory=lambda: _env("KEA_OLLAMA_URL", "http://localhost:11434")
    )

    bedrock_model: str = field(
        default_factory=lambda: _env("KEA_BEDROCK_MODEL", "anthropic.claude-sonnet-5")
    )
    gcp_model: str = field(
        default_factory=lambda: _env("KEA_GCP_MODEL", "gemini-3.6-flash")
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

    #: One backend per channel, all defaulting to `file`. See app/alerts/channels.py for
    #: what each one's free tier actually means — the limits are real and a demo that
    #: quietly depends on a trial account fails on the one day it matters.
    #:
    #:   email   file | smtp | resend
    #:   sms     file | textbelt | twilio
    #:   voice   file | twilio
    #:
    #: The university AWS account cannot use SES, SNS or Connect, which is why these are
    #: third parties rather than the obvious AWS services. An `SesGateway` slots into the
    #: same protocol when that changes.
    email_backend: str = field(default_factory=lambda: _env("KEA_EMAIL_BACKEND", "file"))
    sms_backend: str = field(default_factory=lambda: _env("KEA_SMS_BACKEND", "file"))
    voice_backend: str = field(default_factory=lambda: _env("KEA_VOICE_BACKEND", "file"))

    #: Shared by all three file backends; each writes into a per-channel subdirectory.
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

    resend_api_key: str = field(default_factory=lambda: _env("KEA_RESEND_API_KEY", ""))

    #: `textbelt` is the documented free key — one message per day per IP, no signup.
    textbelt_key: str = field(default_factory=lambda: _env("KEA_TEXTBELT_KEY", "textbelt"))

    twilio_account_sid: str = field(
        default_factory=lambda: _env("KEA_TWILIO_ACCOUNT_SID", "")
    )
    twilio_auth_token: str = field(default_factory=lambda: _env("KEA_TWILIO_AUTH_TOKEN", ""))
    twilio_from_number: str = field(
        default_factory=lambda: _env("KEA_TWILIO_FROM_NUMBER", "")
    )

    #: Fallback contact points for households with no preference row — the seeded demo
    #: accounts carry no personal details by design (see models.Customer), so there is no
    #: address to read off the account. Set for a rehearsal; a real deployment reads them
    #: off `app.alert_preference` and leaves these empty, which correctly produces
    #: "no email address on file" rather than mailing the operator about a stranger.
    demo_recipient: str = field(
        default_factory=lambda: _env("KEA_DEMO_RECIPIENT", "demo@kea.example")
    )
    demo_phone: str = field(default_factory=lambda: _env("KEA_DEMO_PHONE", ""))

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
    from app.providers.resolver import build_provider

    return build_provider(
        settings.provider,
        bedrock_model=settings.bedrock_model,
        aws_region=settings.aws_region,
        ollama_model=settings.ollama_model,
        ollama_url=settings.ollama_url,
        gcp_model=settings.gcp_model,
    )


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

    from app.alerts.channels import build_registry
    from app.alerts.service import AlertDispatcher, NullDispatcher

    if not (settings.alerts_enabled and settings.persist):
        return NullDispatcher()

    from app.db.session import get_sessionmaker

    registry = build_registry(
        outbox=Path(settings.email_outbox),
        email_backend=settings.email_backend,
        sms_backend=settings.sms_backend,
        voice_backend=settings.voice_backend,
        email_from=settings.email_from,
        smtp_host=settings.smtp_host,
        smtp_port=settings.smtp_port,
        smtp_username=settings.smtp_username,
        smtp_password=settings.smtp_password,
        smtp_timeout=settings.smtp_timeout,
        resend_api_key=settings.resend_api_key,
        textbelt_key=settings.textbelt_key,
        twilio_account_sid=settings.twilio_account_sid,
        twilio_auth_token=settings.twilio_auth_token,
        twilio_from_number=settings.twilio_from_number,
    )
    return AlertDispatcher(registry=registry, sessionmaker=get_sessionmaker())


@lru_cache(maxsize=1)
def get_preferences_store():
    """Where a customer's alert thresholds are read from and written to.

    Falls back to an in-memory store when persistence is off, rather than to a constant:
    the frontend team needs the Settings screen to actually save something while they
    build it, and a read-only default would make every save appear to fail.
    """
    from app.alerts.store import build_preferences_store

    return build_preferences_store(settings.persist)


@lru_cache(maxsize=1)
def get_context_store():
    """What each household has told us about their home — see `app/clarify/`.

    Separate from the preferences store even though both are per-household, because they
    change for different reasons: preferences are what the customer wants, this is what is
    true about their house. One flag chooses both backends, so there is no state where one
    is persisted and the other is not.
    """
    from app.clarify.store import build_context_store

    return build_context_store(settings.persist)
