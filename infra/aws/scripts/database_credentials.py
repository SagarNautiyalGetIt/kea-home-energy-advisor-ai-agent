"""Prepare private database passwords and RDS client files without printing them."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import secrets


def password(path: Path) -> str:
    if path.is_symlink():
        raise ValueError("Password file must not be a symlink")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        value = path.read_text().strip()
    else:
        value = secrets.token_hex(24)
        with os.fdopen(fd, "w") as stream:
            stream.write(value + "\n")
    if not value or any(char in value for char in "\r\n"):
        raise ValueError("Invalid database password file")
    os.chmod(path, 0o600)
    return value


def prepare(directory: Path, host: str | None = None) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    master = password(directory / "db-master-password")
    app = password(directory / "db-app-password")
    # Metabase's read-only RDS login, and its own administrator. Neither reaches
    # runtime.env, so the API never holds them and Metabase never holds the API's.
    password(directory / "metabase-db-password")
    password(directory / "metabase-admin-password")
    if host is None:
        return
    if not re.fullmatch(r"[a-z0-9.-]+\.ap-southeast-2\.rds\.amazonaws\.com", host):
        raise ValueError("Expected a Sydney RDS hostname")
    for filename, user, value in [("db-admin.env", "kea_admin", master), ("db-client.env", "kea", app)]:
        target = directory / filename
        if target.is_symlink():
            raise ValueError("Client file must not be a symlink")
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(f"PGHOST={host}\nPGPORT=5432\nPGDATABASE=kea\nPGUSER={user}\nPGPASSWORD={value}\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/certs/global-bundle.pem\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--db-host")
    args = parser.parse_args()
    prepare(args.directory, args.db_host)
