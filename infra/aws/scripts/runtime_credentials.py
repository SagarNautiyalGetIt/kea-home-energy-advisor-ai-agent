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


def temporary_credentials() -> tuple[dict[str, str], datetime]:
    result = subprocess.run(
        ["aws", "configure", "export-credentials", "--profile", "kea-energy", "--format", "process"],
        capture_output=True,
        text=True,
        check=True,
    )
    exported = json.loads(result.stdout)
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
        values = {key: existing[key] for key in ("KEA_PG_PASSWORD", "KEA_DATABASE_URL", "KEA_CORS_ORIGINS")}
        if existing.get("KEA_DATABASE_SSL_CA"):
            values["KEA_DATABASE_SSL_CA"] = existing["KEA_DATABASE_SSL_CA"]
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
        }
    credentials, expires = temporary_credentials()
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
    print(f"Temporary Sydney SSO credentials expire at {expires.isoformat()}.")


if __name__ == "__main__":
    main()
