"""Read-only deployment checks. No messages, calls or paid speech probes."""

from __future__ import annotations

import argparse
import json

from app.config import settings
from app.security import validate_production


def configuration() -> list[str]:
    failures = []
    try:
        validate_production()
    except RuntimeError as error:
        failures.append(str(error))
    if not settings.production:
        failures.append("KEA_PRODUCTION must be 1")
    required = {
        "KEA_PERSIST": settings.persist,
        "GEMINI_API_KEY": settings.gemini_api_key,
        "KEA_VOICE_ENABLED": settings.voice_enabled,
        "KEA_EMAIL_FROM": settings.email_from and not settings.email_from.endswith(".example"),
        "KEA_SES_CONFIGURATION_SET": settings.ses_configuration_set,
        "KEA_CONNECT_INSTANCE_ID": settings.connect_instance_id,
        "KEA_CONNECT_FLOW_ID": settings.connect_flow_id,
        "KEA_CONNECT_SOURCE_NUMBER": settings.connect_source_number,
        "KEA_CONNECT_PROMPT_BUCKET": settings.connect_prompt_bucket,
    }
    failures.extend(f"{name} is required" for name, value in required.items() if not value)
    for name, actual, expected in (
        ("KEA_EMAIL_BACKEND", settings.email_backend, "ses"),
        ("KEA_SMS_BACKEND", settings.sms_backend, "sns"),
        ("KEA_VOICE_BACKEND", settings.voice_backend, "connect"),
        ("KEA_TTS_ENGINE", settings.tts_engine, "gemini"),
        ("KEA_STT_ENGINE", settings.stt_engine, "gemini"),
    ):
        if actual != expected:
            failures.append(f"{name} must be {expected} for this release")
    return failures


def aws_checks() -> list[str]:
    import boto3
    from botocore.config import Config

    failures = []

    def client(service):
        return boto3.client(
            service,
            region_name=settings.aws_region,
            config=Config(connect_timeout=3, read_timeout=5),
        )

    probes = {
        "ses": lambda: client("sesv2").get_account(),
        "sns": lambda: client("sns").get_sms_attributes(),
        "connect": lambda: client("connect").describe_contact_flow(
            InstanceId=settings.connect_instance_id, ContactFlowId=settings.connect_flow_id
        ),
        "s3": lambda: client("s3").head_bucket(Bucket=settings.connect_prompt_bucket),
    }
    for name, probe in probes.items():
        try:
            result = probe()
            if name == "ses" and (
                not result.get("ProductionAccessEnabled") or not result.get("SendingEnabled")
            ):
                failures.append("SES production access and sending must be enabled")
            if name == "connect" and result["ContactFlow"].get("State") != "ACTIVE":
                failures.append("Connect flow is not active")
        except Exception:
            failures.append(f"{name} read-only check failed; inspect account configuration")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aws", action="store_true", help="Read team service configuration")
    arguments = parser.parse_args()
    failures = configuration()
    if arguments.aws and not failures:
        failures.extend(aws_checks())
    print(
        json.dumps(
            {
                "configuration_ready": not failures,
                "failures": failures,
                "live_delivery_verified": False,
                "live_speech_verified": False,
            }
        )
    )
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
