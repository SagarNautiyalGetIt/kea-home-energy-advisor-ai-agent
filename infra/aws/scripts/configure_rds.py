"""Create the ordinary PostgreSQL application owner through the SSH-only host."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--public-ip", required=True)
    args = parser.parse_args()
    directory = args.directory
    app_password = (directory / "db-app-password").read_text().strip()
    escaped = app_password.replace("'", "''")
    sql = f"""
DO $body$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='kea') THEN
        CREATE ROLE kea LOGIN PASSWORD '{escaped}';
    END IF;
END $body$;
GRANT kea TO kea_admin;
ALTER DATABASE kea OWNER TO kea;
ALTER SCHEMA public OWNER TO kea;
"""
    command = ["ssh", "-i", str(directory / "id_ed25519"),
               "-o", f"UserKnownHostsFile={directory / 'known_hosts'}",
               "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=5",
               f"ec2-user@{args.public_ip}",
               "sudo docker run --rm -i --env-file /opt/kea/db-admin.env -v /opt/kea/certs/rds:/certs:ro postgres:16-alpine psql -X -v ON_ERROR_STOP=1"]
    result = subprocess.run(command, input=sql, text=True, capture_output=True)
    if result.returncode:
        # PostgreSQL error context may repeat a statement; never expose its password.
        print(result.stderr.replace(app_password, "[REDACTED]"), file=sys.stderr)
        return result.returncode
    print("RDS application PostgreSQL owner configured.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
