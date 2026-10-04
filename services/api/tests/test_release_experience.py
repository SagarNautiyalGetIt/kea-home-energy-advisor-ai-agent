import asyncio
import base64
import datetime as dt
import hashlib
import hmac
import io
import json
import sys
import time
import wave
from dataclasses import asdict
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.alerts.aws_channels import ConnectGateway, SesGateway, SnsGateway, aws_client
from app.alerts.channels import Notification, build_registry
from app.alerts.store import DatabasePreferencesStore, PreferencesUnavailable
from app.config import settings
from app.experience import ExperienceStore, OutageSnapshot, RewardEvent, VerifiedAction, reward_for
from app.security import household_access, identity, verify_receipt
from app.voice.connect import call_transition, connect_wav
from app.voice.tts_gemini import GeminiTextToSpeech, decode_audio


@pytest.fixture(autouse=True)
def mutable_configuration(monkeypatch):
    config = SimpleNamespace(**asdict(settings))
    monkeypatch.setattr(sys.modules[__name__], "settings", config)
    monkeypatch.setattr("app.experience.settings", config)
    monkeypatch.setattr("app.security.settings", config)


def test_non_idempotent_notification_clients_cannot_automatically_resend(monkeypatch):
    import boto3

    configurations = {}
    monkeypatch.setattr(boto3, "client", lambda name, **kw: configurations.setdefault(name, kw))
    for service, attempts in (("sesv2", 1), ("sns", 1), ("connect", 3)):
        aws_client(service, "ap-southeast-2")
        assert configurations[service]["config"].retries["total_max_attempts"] == attempts


def wav_payload(rate=24000, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\x00\x00" * 240)
    return {
        "steps": [
            {
                "type": "model_output",
                "content": [
                    {"type": "audio", "data": base64.b64encode(output.getvalue()).decode()}
                ],
            }
        ]
    }


async def test_gemini_exact_transcript_style_and_no_startup_calls():
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=wav_payload(16000))

    tts = GeminiTextToSpeech(api_key="fixture", transport=httpx.MockTransport(respond))
    assert await tts.prewarm() == 0
    assert await tts.acknowledgement() is None
    assert not requests
    utterance = await tts.synthesise("Support is available. Your bill is $34.12.")
    content = requests[0]["input"][0]["content"][0]
    assert content["text"] == utterance.text
    assert "respectful" in content["annotations"][0]["style"]
    assert requests[0]["model"] == "gemini-3.8-flash-tts"
    assert utterance.sample_rate == 16000
    assert len(utterance.pcm) == 480


@pytest.mark.parametrize(
    "payload",
    [
        {},
        wav_payload(channels=2),
        {"steps": [{"type": "model_output", "content": [{"type": "audio", "data": "invalid"}]}]},
    ],
)
def test_invalid_speech_fails_visibly(payload):
    with pytest.raises(RuntimeError, match="audio"):
        decode_audio(payload)


async def test_speech_failure_does_not_expose_provider_body():
    tts = GeminiTextToSpeech(
        api_key="fixture",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(403, text="private provider detail")
        ),
    )
    with pytest.raises(RuntimeError) as error:
        await tts.synthesise("A grounded answer.")
    assert "private provider detail" not in str(error.value)


async def test_gemini_cancel_stops_active_request():
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def respond(request):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    tts = GeminiTextToSpeech(api_key="fixture", transport=httpx.MockTransport(respond))
    stream = tts.stream(["hello"])
    task = asyncio.create_task(anext(stream))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


async def test_ses_and_sns_report_acceptance_not_delivery():
    captured = []
    ses = SesGateway(
        region="ap-southeast-2",
        sender="kea@verified.test",
        client=SimpleNamespace(
            send_email=lambda **kwargs: captured.append(kwargs) or {"MessageId": "email-1"}
        ),
    )
    result = await ses.send(
        Notification("email", "a@example.test", "Bill notice", "A grounded notice")
    )
    assert result.accepted and not result.delivered and result.destination == "email-1"
    assert captured[0]["Destination"] == {"ToAddresses": ["a@example.test"]}
    sns = SnsGateway(
        region="ap-southeast-2",
        client=SimpleNamespace(
            check_if_phone_number_is_opted_out=lambda **kwargs: {"isOptedOut": False},
            publish=lambda **kwargs: captured.append(kwargs) or {"MessageId": "sms-1"},
        ),
    )
    result = await sns.send(Notification("sms", "+64210000000", "", "A grounded notice"))
    assert result.accepted and not result.delivered
    assert (
        captured[-1]["MessageAttributes"]["AWS.SNS.SMS.SMSType"]["StringValue"] == "Transactional"
    )


async def test_sns_opt_out_and_bad_phone_never_publish():
    def prohibited(**kwargs):
        pytest.fail("Opted-out recipient must not be messaged")

    sns = SnsGateway(
        region="ap-southeast-2",
        client=SimpleNamespace(
            check_if_phone_number_is_opted_out=lambda **kwargs: {"isOptedOut": True},
            publish=prohibited,
        ),
    )
    for number in ("+64210000000", "0210000000", ""):
        result = await sns.send(Notification("sms", number, "", "Notice"))
        assert not result.accepted and not result.delivered


def test_misconfigured_aws_cannot_fall_back_to_file(tmp_path):
    registry = build_registry(
        outbox=tmp_path,
        email_backend="ses",
        sms_backend="sns",
        voice_backend="connect",
        email_from="no-reply@kea.example",
    )
    assert registry.for_channel("email").name == "ses"
    assert registry.for_channel("voice").name == "connect"
    assert not list(tmp_path.iterdir())


async def test_connect_idempotency_and_private_notice():
    calls = []

    class Prompts:
        async def prepare_notice(self, key):
            return "s3://private/notices/fixture.wav"

    gateway = ConnectGateway(
        region="ap-southeast-2",
        instance_id="instance",
        flow_id="flow",
        source_number="+64210000001",
        prompt_builder=Prompts(),
        client=SimpleNamespace(
            start_outbound_voice_contact=lambda **kwargs: (
                calls.append(kwargs) or {"ContactId": "contact-1"}
            )
        ),
    )
    note = Notification(
        "voice",
        "+64210000000",
        "",
        "PRIVATE BILL $300",
        voice_script="PRIVATE BILL $300",
        delivery_key="alert-1-voice",
    )
    for _ in range(2):
        result = await gateway.send(note)
        assert result.accepted and not result.delivered
    assert calls[0]["ClientToken"] == calls[1]["ClientToken"]
    assert "PRIVATE BILL" not in str(calls)


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        ("1", "support"),
        ("9", "opt_out"),
        ("timeout", "ended"),
        ("invalid", "ended"),
        ("prompt_failed", "ended"),
        ("hangup", "ended"),
    ],
)
def test_connect_closed_routes(event, expected):
    assert call_transition("notice", event) == expected
    assert call_transition("notice", "model-generated-number") == "ended"


def test_connect_audio_is_real_mulaw():
    output = connect_wav(b"\x00\x00" * 2400, 24000)
    # WAV format code 7 is mu-law, not PCM format code 1.
    index = output.index(b"fmt ")
    assert int.from_bytes(output[index + 8 : index + 10], "little") == 7
    assert int.from_bytes(output[index + 12 : index + 16], "little") == 8000


async def test_preferences_storage_failure_is_not_defaults():
    def unavailable():
        raise ConnectionError("database unavailable")

    with pytest.raises(PreferencesUnavailable):
        await DatabasePreferencesStore(unavailable).get("H-A")


def snapshot(revision=1, status="scheduled"):
    now = dt.datetime.now(dt.UTC)
    return OutageSnapshot(
        account_ref="H-A",
        distributor="Fixture distributor",
        source_url="https://distributor.test/planned",
        fetched_at=now,
        valid_until=now + dt.timedelta(hours=4),
        revision=revision,
        events=[
            {
                "event_id": "work-1",
                "title": "Network work",
                "start": now + dt.timedelta(hours=1),
                "end": now + dt.timedelta(hours=2),
                "status": status,
            }
        ],
    )


async def test_outage_revision_cancellation_isolation_and_expiry(monkeypatch):
    monkeypatch.setattr(settings, "outage_source_hosts", "distributor.test")
    store = ExperienceStore()
    assert (await store.outage("H-A")).status == "not_linked"
    assert await store.ingest(snapshot())
    assert not await store.ingest(snapshot())
    assert await store.ingest(snapshot(2, "cancelled"))
    assert (await store.outage("H-A")).snapshot.events[0].status == "cancelled"
    assert (await store.outage("H-B")).snapshot is None
    old = snapshot(3)
    old.fetched_at -= dt.timedelta(days=1)
    old.valid_until -= dt.timedelta(days=1)
    assert await store.ingest(old)
    assert (await store.outage("H-A")).status == "stale"


async def test_outage_unapproved_source_rejected(monkeypatch):
    monkeypatch.setattr(settings, "outage_source_hosts", "other.test")
    with pytest.raises(ValueError, match="approved"):
        await ExperienceStore().ingest(snapshot())


async def test_reward_plans_concurrency_isolation_and_verified_evidence():
    store = ExperienceStore()
    today = dt.datetime.now(dt.UTC).date()
    plan = RewardEvent(
        key=f"plan:ev_off_peak:{today}",
        mission_id="ev_off_peak",
        evidence="planned",
        xp=5,
        day=today,
        source="Your plan",
    )
    results = await asyncio.gather(*(store.award("H-A", plan) for _ in range(20)))
    assert sum(results) == 1
    receipt = VerifiedAction(
        account_ref="H-A",
        receipt_id="receipt-1",
        provider="charger",
        mission_id="ev_off_peak",
        day=today,
        tariff_id="actual-tariff",
        shifted_kwh="2.5",
        peak_nzd_per_kwh="0.4",
        off_peak_nzd_per_kwh="0.2",
        measured_interval_count=4,
        comfort_preserved=True,
    )
    assert await store.award("H-A", reward_for(receipt))
    receipt.receipt_id = "another-id-for-same-day"
    assert not await store.award("H-A", reward_for(receipt))
    progress = await store.progress("H-A")
    assert (progress.total_xp, progress.planning_xp, progress.verified_xp) == (30, 5, 25)
    assert str(progress.estimated_shift_savings_nzd) == "0.50"
    assert (await store.progress("H-B")).total_xp == 0


def test_signed_provider_receipts_expire_and_cannot_change_accounts(monkeypatch):
    monkeypatch.setattr(settings, "delivery_receipt_secret", "fixture-secret-" * 3)
    monkeypatch.setattr(settings, "outage_ingestion_secret", "outage-fixture-secret-" * 3)
    monkeypatch.setattr(settings, "reward_receipt_secret", "reward-fixture-secret-" * 3)
    stamp = str(int(time.time()))
    body = b'{"account_ref":"H-A"}'
    signature = hmac.new(
        settings.delivery_receipt_secret.encode(), stamp.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    verify_receipt(body, stamp, signature)
    for domain in ("outages", "rewards"):
        with pytest.raises(HTTPException) as error:
            verify_receipt(body, stamp, signature, domain)
        assert error.value.status_code == 401
    with pytest.raises(HTTPException):
        verify_receipt(b'{"account_ref":"H-B"}', stamp, signature)
    with pytest.raises(HTTPException):
        verify_receipt(body, str(int(stamp) - 600), signature)


def test_oidc_signature_audience_expiry_and_household_scope(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(settings, "oidc_issuer", "https://identity.test")
    monkeypatch.setattr(settings, "oidc_client_id", "app-client")
    monkeypatch.setattr(
        "app.security.jwks_client",
        lambda issuer: SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())
        ),
    )
    claims = {
        "sub": "user-1",
        "iss": settings.oidc_issuer,
        "aud": "app-client",
        "exp": int(time.time()) + 60,
        "iat": int(time.time()),
        "custom:account_ref": "H-A",
        "token_use": "id",
    }
    token = jwt.encode(claims, key, algorithm="RS256")
    assert identity("Bearer " + token)["customer_id"] == "H-A"
    with pytest.raises(HTTPException) as mismatch:
        household_access("H-B", "Bearer " + token)
    assert mismatch.value.status_code == 403
    for patch in ({"aud": "other-client"}, {"exp": 0}, {"custom:account_ref": None}):
        with pytest.raises(HTTPException):
            identity("Bearer " + jwt.encode(claims | patch, key, algorithm="RS256"))
