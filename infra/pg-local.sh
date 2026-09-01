#!/usr/bin/env bash
# Rootless Postgres 16 for developers without Docker.
#
# The supported path is `make db` (infra/docker-compose.yml) and that is what the demo
# machine uses. This script exists because not every machine on this team has Docker —
# it downloads the same Postgres 16 server binaries used by the embedded-postgres
# project, runs initdb into a directory you own, and starts a server on :5432 with the
# credentials in .env.example. No root, no daemon, no package manager.
#
#   ./infra/pg-local.sh start     # download if needed, initdb if needed, start
#   ./infra/pg-local.sh stop
#   ./infra/pg-local.sh status
#   ./infra/pg-local.sh reset     # destroy the data directory and start clean
#
# The cluster lives in .pg-local/ at the repo root, which is gitignored.
set -euo pipefail

PG_VERSION="16.2.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGROOT="$ROOT/.pg-local"
PGDATA="$PGROOT/data"
PGBIN="$PGROOT/dist/bin"
PGLOG="$PGROOT/postgres.log"
PGPORT="${PGPORT:-5432}"
PGUSER="kea"
PGDB="kea"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  PLATFORM="linux-amd64";        ARCHIVE="postgres-linux-x86_64.txz" ;;
  Linux-aarch64) PLATFORM="linux-arm64v8";      ARCHIVE="postgres-linux-arm_64.txz" ;;
  Darwin-arm64)  PLATFORM="darwin-arm64v8";     ARCHIVE="postgres-darwin-arm_64.txz" ;;
  Darwin-x86_64) PLATFORM="darwin-amd64";       ARCHIVE="postgres-darwin-x86_64.txz" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m) — use 'make db' instead" >&2; exit 1 ;;
esac

fetch() {
  [ -x "$PGBIN/postgres" ] && return 0
  local url="https://repo1.maven.org/maven2/io/zonky/test/postgres"
  url="$url/embedded-postgres-binaries-$PLATFORM/$PG_VERSION/embedded-postgres-binaries-$PLATFORM-$PG_VERSION.jar"
  echo "downloading postgres $PG_VERSION for $PLATFORM..."
  mkdir -p "$PGROOT/dist"
  curl -sSL -o "$PGROOT/pg.jar" "$url"
  # The jar is a zip containing one .txz of the whole install. Server binaries only —
  # no psql, no createdb. Use the app's own asyncpg connection if you need a shell.
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extract(sys.argv[2], sys.argv[3])" \
    "$PGROOT/pg.jar" "$ARCHIVE" "$PGROOT"
  tar -xf "$PGROOT/$ARCHIVE" -C "$PGROOT/dist"
  rm -f "$PGROOT/pg.jar" "$PGROOT/$ARCHIVE"
}

init() {
  [ -f "$PGDATA/PG_VERSION" ] && return 0
  echo "initdb..."
  mkdir -p "$PGROOT/sock"
  # trust auth: this cluster listens on localhost only and holds five fake households.
  "$PGBIN/initdb" -D "$PGDATA" -U "$PGUSER" --auth=trust --encoding=UTF8 --locale=C >/dev/null
}

ensure_db() {
  # No createdb in this bundle, so use the driver the app already depends on.
  "$ROOT/services/api/.venv/bin/python" - "$PGPORT" <<'PY'
import asyncio, sys
import asyncpg

async def main(port: int) -> None:
    conn = await asyncpg.connect(host="localhost", port=port, user="kea", database="postgres")
    if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname='kea'"):
        await conn.execute("CREATE DATABASE kea")
        print("  created database kea")
    await conn.close()

asyncio.run(main(int(sys.argv[1])))
PY
}

start() {
  fetch; init
  if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    echo "already running on :$PGPORT"
  else
    # TZ=UTC for the same reason docker-compose.yml sets it: NZ daylight saving means
    # every timestamp conversion should happen in one predictable place.
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -o \
      "-p $PGPORT -k $PGROOT/sock -c listen_addresses=localhost -c timezone=UTC" -w start
  fi
  ensure_db
  echo "postgres ready on :$PGPORT — KEA_DATABASE_URL=postgresql+asyncpg://kea:kea@localhost:$PGPORT/kea"
}

case "${1:-start}" in
  start)  start ;;
  stop)   "$PGBIN/pg_ctl" -D "$PGDATA" -w stop ;;
  status) "$PGBIN/pg_ctl" -D "$PGDATA" status ;;
  reset)  "$PGBIN/pg_ctl" -D "$PGDATA" -w stop 2>/dev/null || true; rm -rf "$PGDATA"; start ;;
  *) echo "usage: $0 {start|stop|status|reset}" >&2; exit 1 ;;
esac
