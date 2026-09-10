"""Prove the Bedrock connection works, and say precisely what is wrong when it does not.

    python -m scripts.bedrock_check

Runs five checks in the order they fail in practice, and stops at the first failure with
the specific fix rather than a stack trace. Every one of these has a different remedy and
they are easy to confuse — "AccessDeniedException" reads the same whether the credentials
are wrong, the region is wrong, or the model was never enabled.

**Prints no credential material.** It reports which profile and region are in use and
whether a call succeeded; it never echoes a key, a token, or an ARN containing an account
id. Anything this prints is safe to paste into a chat with a teammate.
"""

from __future__ import annotations

import asyncio
import os
import sys

OK = "  \033[32mPASS\033[0m"
NO = "  \033[31mFAIL\033[0m"
HINT = "       ↳"


def _fail(message: str, *hints: str) -> None:
    print(f"{NO}  {message}")
    for hint in hints:
        print(f"{HINT} {hint}")
    sys.exit(1)


def check_sdk() -> None:
    try:
        import anthropic  # noqa: F401
    except ImportError:
        _fail(
            "the anthropic SDK is not installed",
            "run: make setup    (pyproject declares anthropic[bedrock])",
        )
    print(f"{OK}  anthropic SDK importable")


def check_credentials() -> str:
    """Confirm a credential chain resolves, without revealing what it resolved to."""
    try:
        import boto3
        from botocore.exceptions import NoCredentialsError, TokenRetrievalError
    except ImportError:
        _fail("boto3 is not installed", "run: make setup")

    session = boto3.Session()
    profile = session.profile_name or "default"
    region = session.region_name or os.getenv("AWS_REGION", "")

    try:
        creds = session.get_credentials()
        if creds is None:
            raise NoCredentialsError()
        creds = creds.get_frozen_credentials()
    except (NoCredentialsError, TokenRetrievalError):
        _fail(
            "no AWS credentials found",
            "Learner Lab: copy the block from 'AWS Details' into ~/.aws/credentials",
            "SSO:         aws sso login --profile kea",
            "IAM user:    aws configure --profile kea",
        )

    kind = "temporary (session token present)" if creds.token else "long-lived access key"
    print(f"{OK}  credentials resolved — profile={profile!r}, {kind}")
    if not creds.token:
        print(f"{HINT} prefer short-lived credentials; see docs/teams/aws-bedrock-setup.md")
    if not region:
        _fail(
            "no region set",
            "export AWS_REGION=ap-southeast-2   (or us-east-1 on Learner Lab)",
        )
    print(f"{OK}  region = {region}")
    return region


def check_identity() -> None:
    """Who are we? Confirms the credentials are live, not just present."""
    import boto3
    from botocore.exceptions import ClientError

    try:
        ident = boto3.client("sts").get_caller_identity()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"ExpiredToken", "ExpiredTokenException", "InvalidClientTokenId"}:
            _fail(
                "the credentials have EXPIRED",
                "Learner Lab sessions last ~4 hours — start the lab again and re-copy",
                "SSO: aws sso login --profile kea",
            )
        _fail(f"credentials rejected by STS ({code})", "check the keys were copied whole")

    # The role/user name is useful and the account id is not — print one, mask the other.
    arn = ident.get("Arn", "")
    who = arn.rsplit("/", 1)[-1] if "/" in arn else arn.rsplit(":", 1)[-1]
    print(f"{OK}  authenticated as …/{who}")


def check_model_access(region: str) -> str:
    """List what this account can actually invoke here. The most common failure by far.

    Model access is opt-in per account AND per region, so valid credentials with no
    enabled model is the normal first state rather than an edge case.
    """
    import boto3
    from botocore.exceptions import ClientError

    control = boto3.client("bedrock", region_name=region)
    try:
        models = control.list_foundation_models(byProvider="anthropic")["modelSummaries"]
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"AccessDeniedException", "UnrecognizedClientException"}:
            _fail(
                f"no permission to list Bedrock models in {region}",
                "the IAM policy needs bedrock:ListFoundationModels",
                "on Learner Lab, Bedrock may be blocked entirely — try us-east-1",
            )
        _fail(f"could not reach Bedrock in {region} ({code})", "is Bedrock offered in this region?")

    if not models:
        _fail(f"no Anthropic models offered in {region}", "try a region where Bedrock is available")

    print(f"{OK}  Bedrock reachable — {len(models)} Anthropic model(s) offered in {region}")

    # Inference profiles matter: in several regions the newer models are only invocable
    # through a cross-region profile, and the bare model id returns a validation error
    # that does not obviously say so.
    try:
        profiles = control.list_inference_profiles()["inferenceProfileSummaries"]
        anthro = [p for p in profiles if "anthropic" in p.get("inferenceProfileId", "")]
        if anthro:
            print(f"{OK}  {len(anthro)} inference profile(s) available. Candidate ids:")
            for p in anthro[:6]:
                print(f"       {p['inferenceProfileId']}")
    except ClientError:
        pass  # not offered in every region; not fatal

    configured = os.getenv("KEA_BEDROCK_MODEL", "")
    if configured:
        print(f"{OK}  KEA_BEDROCK_MODEL = {configured}")
    else:
        print(f"{HINT} KEA_BEDROCK_MODEL is unset — the app default may not exist here.")
        print(f"{HINT} Pick an id from the list above and set it in .env")
    return configured


async def check_invoke() -> None:
    """The only check that proves anything: actually call the model.

    Valid credentials plus a listed model still fails if access was never requested for
    that specific model, and that only surfaces on invocation.
    """
    from app.config import settings
    from app.providers.bedrock import BedrockProvider

    provider = BedrockProvider(model=settings.bedrock_model, aws_region=settings.aws_region)
    chunks: list[str] = []
    try:
        async for chunk in provider.narrate(
            system="Reply with exactly: ok",
            user="Reply with exactly: ok",
            max_tokens=8,
        ):
            chunks.append(chunk)
    except Exception as exc:  # noqa: BLE001 — this is the diagnostic
        text = str(exc)
        if "AccessDenied" in text or "not authorized" in text:
            _fail(
                "credentials are valid but this model is not enabled",
                "Bedrock console → Model access → enable the Anthropic models",
                "approval is usually instant, but it is per-account AND per-region",
            )
        if "ValidationException" in text and "inference profile" in text:
            _fail(
                "this model requires a cross-region inference profile",
                "use the inference-profile id printed above as KEA_BEDROCK_MODEL",
            )
        if "ResourceNotFound" in text or "ValidationException" in text:
            _fail(
                f"model id rejected: {settings.bedrock_model!r}",
                "set KEA_BEDROCK_MODEL to one of the ids listed above",
            )
        _fail(f"invocation failed: {text[:200]}")

    reply = "".join(chunks).strip()
    usage = provider.last_usage
    print(f"{OK}  model replied {reply[:40]!r}")
    print(f"{OK}  tokens in={usage.prompt_tokens} out={usage.completion_tokens}")


def main() -> None:
    print("\nBedrock connection check\n" + "─" * 46)
    check_sdk()
    region = check_credentials()
    check_identity()
    check_model_access(region)
    asyncio.run(check_invoke())
    print("─" * 46)
    print("All checks passed. Set KEA_PROVIDER=bedrock and run: make api-dev\n")


if __name__ == "__main__":
    main()
