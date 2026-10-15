"""Write an owner-only EC2 runtime file using temporary team SSO credentials."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote


#: A refresh wants a full credential lifetime; anything older than an hour is re-fetched.
FRESH = timedelta(hours=3)
CLI_CACHE = Path.home() / ".aws/cli/cache"
#: The API's own default is a Claude model, which the account's SCP blocks in Sydney.
#: Nova Pro is the model the demo is verified on; the cloud owner may change the line
#: in runtime.env, and a refresh keeps it.
DEFAULT_MODEL = "amazon.nova-pro-v1:0"


def export_credentials() -> dict[str, str]:
    # stderr is not captured: the CLI's "Token has expired" message must reach the
    # log, where keep-credentials looks for it to decide whether to sign in again.
    result = subprocess.run(
        ["aws", "configure", "export-credentials", "--profile", "kea-energy", "--format", "process"],
        stdout=subprocess.PIPE,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def drop_cached(expiration: str, cache: Path = CLI_CACHE) -> int:
    """Remove the CLI's cached SSO role credentials that expire at `expiration`.

    The CLI reuses cached role credentials until minutes before they expire, so a
    refresh 45 minutes early would upload the same short-lived keys. Only the
    matching SSO entry is removed; the SSO sign-in itself (~/.aws/sso/cache) is
    untouched, and the next export fetches new role credentials with it.
    """
    target = parse_time(expiration)
    removed = 0
    for path in cache.glob("*.json"):
        try:
            entry = json.loads(path.read_text())
            cached = parse_time(entry["Credentials"]["Expiration"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        # The export prints "+00:00" and the cache stores "Z": compare instants.
        if entry.get("ProviderType") == "sso" and cached == target:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def temporary_credentials(*, fresh: bool = False) -> tuple[dict[str, str], datetime]:
    exported = export_credentials()
    expires = datetime.fromisoformat(exported["Expiration"].replace("Z", "+00:00"))
    if fresh and expires < datetime.now(timezone.utc) + FRESH and drop_cached(exported["Expiration"]):
        exported = export_credentials()
        expires = datetime.fromisoformat(exported["Expiration"].replace("Z", "+00:00"))
    if expires < datetime.now(timezone.utc) + timedelta(minutes=30):
        raise RuntimeError("SSO credentials expire within 30 minutes; refresh the SSO login")
    values = {
        "AWS_ACCESS_KEY_ID": exported["AccessKeyId"],
        "AWS_SECRET_ACCESS_KEY": exported["SecretAccessKey"],
        "AWS_SESSION_TOKEN": exported["SessionToken"],
    }
    if any(not value or "\n" in value or "\r" in value for value in values.values()):
        raise RuntimeError("Invalid temporary AWS credential value")
    return values, expires


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime_file", type=Path)
    parser.add_argument("--public-ip")
    parser.add_argument("--db-host")
    parser.add_argument("--db-password-file", type=Path)
    parser.add_argument("--bedrock-model", default=DEFAULT_MODEL)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if args.refresh:
        if not args.runtime_file.is_file():
            parser.error("runtime file is missing")
        existing = {}
        for line in args.runtime_file.read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator:
                existing[key] = value
        for key in ("KEA_PG_PASSWORD", "KEA_DATABASE_URL", "KEA_CORS_ORIGINS"):
            if not existing.get(key):
                parser.error(f"runtime file is missing {key}")
        # Refresh credentials without discarding the cloud owner's model, SSM
        # or feature configuration. Only temporary credential values change.
        values = existing.copy()
    else:
        if args.runtime_file.exists():
            parser.error("runtime file already exists")
        if not args.public_ip or not args.db_host or not args.db_password_file:
            parser.error("--public-ip, --db-host and --db-password-file are required")
        password = args.db_password_file.read_text().strip()
        if not password or any(char in password for char in "\r\n"):
            parser.error("Invalid database password file")
        values = {
            "KEA_PG_PASSWORD": password,
            "KEA_DATABASE_URL": f"postgresql+asyncpg://kea:{quote(password, safe='')}@{args.db_host}:5432/kea",
            "KEA_DATABASE_SSL_CA": "/certs/rds/global-bundle.pem",
            "KEA_CORS_ORIGINS": f"https://{args.public_ip}",
            "KEA_BEDROCK_MODEL": args.bedrock_model,
        }
    credentials, expires = temporary_credentials(fresh=args.refresh)
    values.update(credentials)
    args.runtime_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".runtime-", dir=args.runtime_file.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as output:
            for key, value in values.items():
                output.write(f"{key}={value}\n")
        os.replace(temporary_name, args.runtime_file)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    # Read by credentials_timer.py to decide when the next refresh is due.
    expires_file = args.runtime_file.with_name(args.runtime_file.name + ".expires")
    fd = os.open(expires_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(expires.isoformat() + "\n")
    print(f"Temporary Sydney SSO credentials expire at {expires.isoformat()}.")


if __name__ == "__main__":
    main()
