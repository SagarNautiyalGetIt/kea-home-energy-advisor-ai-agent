"""Export the complete local PostgreSQL 16 serving database for one AWS session.

This prepares a local dump only. It does not upload, create, or alter AWS data.
The operator must pause local publishing before calling it and resume afterward.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
COMPOSE = ROOT / "infra/docker-compose.yml"
EXPORTS = ROOT / "infra/aws/.work/exports"


def command(*parts: str) -> list[str]:
    return ["docker", "compose", "-f", str(COMPOSE), "exec", "-T", "db", *parts]


def capture(*parts: str) -> str:
    result = subprocess.run(
        command(*parts), capture_output=True, text=True, timeout=30, check=False
    )
    if result.returncode:
        raise RuntimeError(
            f"local PostgreSQL command failed (exit {result.returncode})"
        )
    return result.stdout.strip()


def export(session_id: str, *, destination: Path = EXPORTS) -> tuple[Path, Path]:
    if not re.fullmatch(r"[a-z0-9]{8,16}", session_id):
        raise ValueError("Session ID must be 8–16 lowercase letters or digits")
    version = capture(
        "psql",
        "-U",
        "kea",
        "-d",
        "kea",
        "-Atc",
        "SELECT current_setting('server_version_num')",
    )
    if not version.isdigit() or int(version) // 10000 != 16:
        raise RuntimeError("source serving database must be PostgreSQL 16")
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    dump = destination / f"{session_id}.dump"
    manifest = destination / f"{session_id}.json"
    if dump.exists() or manifest.exists():
        raise FileExistsError("a dump or manifest already exists for this session")
    # The dump is a full custom-format snapshot: public/app/serving schemas and
    # migration records. Do not silently substitute the pipeline source DB on 5433.
    created: list[Path] = []
    try:
        fd = os.open(dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created.append(dump)
        with os.fdopen(fd, "wb") as output:
            result = subprocess.run(
                command("pg_dump", "-U", "kea", "-d", "kea", "-Fc", "-Z", "6"),
                stdout=output,
                stderr=subprocess.PIPE,
                timeout=900,
                check=False,
            )
        if result.returncode:
            raise RuntimeError(
                f"PostgreSQL 16 pg_dump failed (exit {result.returncode})"
            )
        size = dump.stat().st_size
        with dump.open("rb") as stream:
            if stream.read(5) != b"PGDMP":
                raise RuntimeError("pg_dump did not produce a custom-format archive")
            stream.seek(0)
            sha = hashlib.file_digest(stream, "sha256").hexdigest()
        metadata = {
            "session_id": session_id,
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_database": "kea",
            "source_postgres_version_num": int(version),
            "dump_format": "pg_dump custom",
            "bytes": size,
            "sha256": sha,
        }
        from database_inventory import inventory

        metadata["inventory"] = inventory(
            lambda sql: capture("psql", "-U", "kea", "-d", "kea", "-Atc", sql)
        )
        fd = os.open(manifest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created.append(manifest)
        with os.fdopen(fd, "w") as output:
            json.dump(metadata, output, indent=2)
            output.write("\n")
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        for path in created:
            path.unlink(missing_ok=True)
        raise
    return dump, manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id", default=secrets.token_hex(6))
    parser.add_argument(
        "--source-paused",
        action="store_true",
        help="acknowledge local pipeline publishing/writes are paused",
    )
    args = parser.parse_args()
    if not args.source_paused:
        parser.error("pause local publishing/writes, then pass --source-paused")
    if shutil.which("docker") is None:
        parser.error("Docker is required for the PostgreSQL 16 source container")
    try:
        dump, manifest = export(args.session_id)
    except (
        ValueError,
        FileExistsError,
        RuntimeError,
        OSError,
        subprocess.TimeoutExpired,
    ) as exc:
        print(f"FAIL local database export: {exc}", file=sys.stderr)
        return 1
    print(f"Export created: {dump}")
    print(f"Manifest created: {manifest}")
    print("Keep both private; the dump contains complete application and serving data.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
