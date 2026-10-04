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
            if key in os.environ and os.environ[key] != value:
                # `setdefault` is the right precedence — a variable the operator exported
                # must beat a file — but losing silently is how an afternoon disappears.
                # `KEA_VOICE_ENABLED=0` inherited from a launcher's environment beats
                # `KEA_VOICE_ENABLED=1` in .env, /health then reports voice disabled, and
                # the only visible symptom is a WebSocket that opens and closes again.
                _OVERRIDDEN[key] = value
            os.environ.setdefault(key, value)


#: `.env` keys the surrounding environment is overriding, and what the file wanted.
#: Values are from the FILE, never from the environment — this is read by `/health` and
#: an exported secret must not be echoed back over HTTP.
_OVERRIDDEN: dict[str, str] = {}


def dotenv_overrides() -> dict[str, str]:
    """Which `.env` settings lost to an exported variable. Empty is the normal case."""
    return dict(_OVERRIDDEN)


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
    production: bool = field(default_factory=lambda: _env("KEA_PRODUCTION", "0") == "1")
    oidc_issuer: str = field(default_factory=lambda: _env("KEA_OIDC_ISSUER", ""))
    oidc_client_id: str = field(default_factory=lambda: _env("KEA_OIDC_CLIENT_ID", ""))
    outage_ingestion_secret: str = field(
        default_factory=lambda: _env("KEA_OUTAGE_INGESTION_SECRET", "")
    )
    reward_receipt_secret: str = field(
        default_factory=lambda: _env("KEA_REWARD_RECEIPT_SECRET", "")
    )
    delivery_receipt_secret: str = field(
        default_factory=lambda: _env("KEA_DELIVERY_RECEIPT_SECRET", "")
    )
    outage_source_hosts: str = field(default_factory=lambda: _env("KEA_OUTAGE_SOURCE_HOSTS", ""))
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

    #: The tested, tool-capable local default is qwen3:4b on every machine.
    #: A deliberate KEA_OLLAMA_MODEL override can select another compatible model.
    #: Only consulted when `ollama` appears in the provider chain.
    #:
    #: `select_ollama_model()` reads KEA_OLLAMA_MODEL itself and returns it unchanged
    #: when set, so an explicit choice still wins and the bake-off is unaffected. The
    #: env var is deliberately NOT the `_env` default here so that one selector owns
    #: the override and the value health reports is the value the provider uses.
    ollama_model: str = field(default_factory=lambda: select_ollama_model())
    ollama_url: str = field(
        default_factory=lambda: _env("KEA_OLLAMA_URL", "http://localhost:11434")
    )

    bedrock_model: str = field(
        default_factory=lambda: _env("KEA_BEDROCK_MODEL", "anthropic.claude-sonnet-5")
    )
    gcp_model: str = field(
        #: Not the newest flash model, on purpose.
        #:
        #: `gemini-3.6-flash` has a **20-request-per-day** free-tier cap. One agent turn
        #: is three or four requests, so that is roughly five customer questions a day
        #: before every subsequent call 429s — which surfaces as `AgentUnavailable` and
        #: reads to a user as "it sometimes doesn't respond". Voice makes it worse
        #: because transcription spends a request too.
        #:
        #: `gemini-3.5-flash` is capped the same way but has a larger per-minute
        #: allowance, so it degrades to "wait twenty seconds" rather than "wait a day".
        #:
        #: **Neither is enough to demo on.** Measured 2026-09-08: 20 requests/day and
        #: 5/minute per model. After pre-loading the account summary a turn costs two or
        #: three requests, so the free tier is roughly seven to ten questions per DAY,
        #: and voice spends one more on transcription. Plan the rehearsal around a billed
        #: key or the AWS account; `KEA_GCP_MODEL` switches model to spread the load in
        #: the meantime, since the cap is per model.
        default_factory=lambda: _env("KEA_GCP_MODEL", "gemini-3.5-flash")
    )

    #: Gemini API keys, as a pool. See `app/providers/keypool.py`.
    #:
    #: The cap above is per model **per project**, so a second key from a second project
    #: is a second allowance. The provider uses one key until it is exhausted and then
    #: moves to the next, which is what makes the free tier usable for a rehearsal.
    #:
    #: Three ways to supply them, all read, in this order:
    #:
    #:   GEMINI_API_KEY        the existing single key — first, so nothing changes for an
    #:                         .env that already has one
    #:   GEMINI_API_KEYS       comma-separated: GEMINI_API_KEYS=AIza...one,AIza...two
    #:   GEMINI_API_KEY_2..N   numbered, for adding them one at a time
    #:
    #: All empty means Application Default Credentials, which is how a deployment with a
    #: service account works and how this provider behaved before the pool existed.
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY", ""))
    gemini_api_keys: str = field(default_factory=lambda: _env("GEMINI_API_KEYS", ""))

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

    #: Which transcriber runs: `gemini` (default) | `whisper` | `auto`.
    #:
    #: Defaults to Gemini because the local path is what made voice slow and
    #: intermittently silent — see `app/voice/__init__.py`. `whisper` forces the local
    #: binary; `auto` prefers it when it is actually installed, which is right on a
    #: machine with a Metal build and wrong on everything else.
    stt_engine: str = field(default_factory=lambda: _env("KEA_STT_ENGINE", "gemini"))
    tts_engine: str = field(default_factory=lambda: _env("KEA_TTS_ENGINE", "piper"))
    tts_model: str = field(default_factory=lambda: _env("KEA_TTS_MODEL", "gemini-3.8-flash-tts"))
    tts_voice: str = field(default_factory=lambda: _env("KEA_TTS_VOICE", "Kore"))

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
    #: The team account now supports SES, SNS and Connect. Select them explicitly;
    #: provider credentials come from IAM and deployment configuration.
    email_backend: str = field(default_factory=lambda: _env("KEA_EMAIL_BACKEND", "file"))
    sms_backend: str = field(default_factory=lambda: _env("KEA_SMS_BACKEND", "file"))
    voice_backend: str = field(default_factory=lambda: _env("KEA_VOICE_BACKEND", "file"))
    ses_configuration_set: str = field(
        default_factory=lambda: _env("KEA_SES_CONFIGURATION_SET", "")
    )
    sns_sender_id: str = field(default_factory=lambda: _env("KEA_SNS_SENDER_ID", ""))
    connect_instance_id: str = field(default_factory=lambda: _env("KEA_CONNECT_INSTANCE_ID", ""))
    connect_flow_id: str = field(default_factory=lambda: _env("KEA_CONNECT_FLOW_ID", ""))
    connect_source_number: str = field(
        default_factory=lambda: _env("KEA_CONNECT_SOURCE_NUMBER", "")
    )
    connect_prompt_bucket: str = field(
        default_factory=lambda: _env("KEA_CONNECT_PROMPT_BUCKET", "")
    )

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

    twilio_account_sid: str = field(default_factory=lambda: _env("KEA_TWILIO_ACCOUNT_SID", ""))
    twilio_auth_token: str = field(default_factory=lambda: _env("KEA_TWILIO_AUTH_TOKEN", ""))
    twilio_from_number: str = field(default_factory=lambda: _env("KEA_TWILIO_FROM_NUMBER", ""))

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

    @property
    def numbered_gemini_keys(self) -> dict[str, str]:
        """`GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, … — however many are set.

        Scanned out of the environment rather than declared as fields, because the whole
        point is that somebody can add a fifth key by adding one line to `.env` without
        touching Python. `GEMINI_API_KEY` itself is excluded: it is read as the primary
        above and would otherwise be added twice.
        """
        return {
            name: value
            for name, value in os.environ.items()
            if name.startswith("GEMINI_API_KEY_") and value.strip()
        }


settings = Settings()


@lru_cache(maxsize=1)
def get_provider():
    """The only place a concrete provider is constructed — and it is constructed once.

    Cached because the provider owns the HTTP connection pool and the `last_usage`
    counter. Building a fresh one per request meant a new TCP connection for every
    chat turn, and made token accounting per-request state that nothing could
    aggregate. `get_provider.cache_clear()` in tests that need a different provider.
    """
    from app.providers.cassette import wrap_if_enabled
    from app.providers.resolver import build_provider

    provider = build_provider(
        settings.provider,
        bedrock_model=settings.bedrock_model,
        aws_region=settings.aws_region,
        ollama_model=settings.ollama_model,
        ollama_url=settings.ollama_url,
        gcp_model=settings.gcp_model,
        gemini_api_key=settings.gemini_api_key,
        gemini_api_keys=settings.gemini_api_keys,
        gemini_numbered_keys=settings.numbered_gemini_keys,
    )
    # Off unless KEA_CASSETTE says otherwise, so the request path is unchanged in
    # production and in every test that has not asked for a recording.
    return wrap_if_enabled(provider)


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
        aws_region=settings.aws_region,
        ses_configuration_set=settings.ses_configuration_set,
        sns_sender_id=settings.sns_sender_id,
        connect_instance_id=settings.connect_instance_id,
        connect_flow_id=settings.connect_flow_id,
        connect_source_number=settings.connect_source_number,
        connect_prompt_builder=_connect_prompt_builder(),
    )
    return AlertDispatcher(registry=registry, sessionmaker=get_sessionmaker())


def _connect_prompt_builder():
    if settings.voice_backend != "connect":
        return None
    from app.voice import get_tts
    from app.voice.connect import ConnectPromptBuilder

    return ConnectPromptBuilder(
        tts=get_tts(), bucket=settings.connect_prompt_bucket, region=settings.aws_region
    )


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
def get_change_store():
    """Plan changes the customer asked for, waiting for a person to action them.

    Same `persist` flag as everything else, so there is no state where a change request is
    written to PostgreSQL and read from memory. `/health` reports which one is live, for
    the reason the recorder disclosure exists: "your plan change was logged" and "your
    plan change was logged until this process restarts" must not look the same from
    outside.
    """
    from app.account.changes import build_change_store

    return build_change_store(settings.persist)


@lru_cache(maxsize=1)
def get_pending_changes():
    """Staged, unconfirmed plan changes. In-process by design — see `account/changes.py`.

    Cached like the stores because it holds state for the life of the process, and a fresh
    instance per request would mean nothing was ever staged long enough to confirm.
    """
    from app.account.changes import PendingChanges

    return PendingChanges()


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


@lru_cache(maxsize=1)
def get_observation_store():
    """Daily connected-device readings, backed by the configured app store."""
    from app.homelink.store import build_observation_store

    return build_observation_store(settings.persist)
