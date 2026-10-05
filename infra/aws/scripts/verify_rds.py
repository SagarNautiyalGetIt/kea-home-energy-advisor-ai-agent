"""Compare a restored RDS snapshot to its complete source inventory over TLS."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

from database_inventory import inventory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--public-ip", required=True)
    args = parser.parse_args()
    command = ["ssh", "-i", str(args.directory / "id_ed25519"),
               "-o", f"UserKnownHostsFile={args.directory / 'known_hosts'}",
               "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=5",
               f"ec2-user@{args.public_ip}",
               "sudo docker run --rm -i --env-file /opt/kea/db-client.env -v /opt/kea/certs/rds:/certs:ro postgres:16-alpine psql -X -v ON_ERROR_STOP=1 -At"]

    def query(sql: str) -> str:
        result = subprocess.run(command, input=sql, text=True, capture_output=True, check=True)
        return result.stdout.strip()

    expected = json.loads(args.manifest.read_text())["inventory"]
    actual = inventory(query)
    canonical = lambda value: {(row["schema"], row["name"], row["kind"]): row["value"] for row in value["relations"]}
    if canonical(expected) != canonical(actual) or expected["extensions"] != actual["extensions"]:
        raise RuntimeError("RDS restore inventory does not match the source manifest")
    if query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()") != "t":
        raise RuntimeError("RDS connection is not encrypted")
    (args.directory / "restored-inventory.json").write_text(json.dumps(actual, indent=2) + "\n")
    print(f"RDS restore verified: {len(actual['relations'])} table/sequence records, extensions and TLS.")


if __name__ == "__main__":
    main()
