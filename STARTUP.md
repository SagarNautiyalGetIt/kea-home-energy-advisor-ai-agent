# Kea Agent Startup Sequence

> Last checked: 2026-09-24. Commands are sourced from the root and service Makefiles.

Read this file after `git status` when starting work in the repository. Keep dependencies and generated output under `~/.cache/vault-builds/`.

## Prerequisites

```bash
cd "$(git rev-parse --show-toplevel)"
source "$HOME/Documents/Software-Development-Environment/env.sh"
task_cache="${XDG_CACHE_HOME:-$HOME/.cache}/vault-builds/kea-agent"
mkdir -p "$task_cache"
python3 -m venv "$task_cache/api-venv"
"$task_cache/api-venv/bin/pip" install -e "services/api[dev]"
cp .env.example .env
```

For persistent demo data, start and seed PostgreSQL:

```bash
make db
make api-migrate
make api-seed
```

## Start

Run each service in its own terminal:

```bash
PYTHONPATH="$PWD/services/api" "$task_cache/api-venv/bin/uvicorn" app.main:app --reload --host 127.0.0.1 --port 8000
```

Install each JavaScript service in a cache-backed prefix, symlink its `node_modules` only when the repository has no existing dependency link, then run its package script:

```bash
task_cache="${XDG_CACHE_HOME:-$HOME/.cache}/vault-builds/kea-agent"
mkdir -p "$task_cache/web" "$task_cache/mobile"
cp services/web/package.json services/web/package-lock.json "$task_cache/web/"
cp services/mobile/package.json services/mobile/package-lock.json "$task_cache/mobile/"
cp services/mobile/.npmrc "$task_cache/mobile/"
npm ci --prefix "$task_cache/web"
npm ci --prefix "$task_cache/mobile"
test -e services/web/node_modules || ln -s "$task_cache/web/node_modules" services/web/node_modules
test -e services/mobile/node_modules || ln -s "$task_cache/mobile/node_modules" services/mobile/node_modules
npm --prefix services/web run dev
npm --prefix services/mobile run start
```

Expected result: API at `http://127.0.0.1:8000`, web at `http://127.0.0.1:5173`, and Expo Metro for mobile.

For the local demo accounts, start the API with `KEA_DEMO_LOGINS=1 KEA_PERSIST=0` in its environment. The mobile app needs `EXPO_PUBLIC_API_URL` pointing to that API; use the computer's LAN address on a physical phone and bind the API to that LAN interface only for a trusted test session. Keep the phone and API on the same network. Connected-device sync additionally needs a user-owned Home Assistant server with an energy sensor; device names found by network discovery do not provide electricity measurements.

## Verify

```bash
PYTHONPATH="$PWD/services/api" "$task_cache/api-venv/bin/pytest" services/api/tests
npm --prefix services/web run lint
npm --prefix services/mobile run typecheck
```

## Stop

Press `Ctrl+C` in each foreground service terminal. Stop local PostgreSQL only when it is no longer needed:

```bash
make db-stop
```

## Limits

- Use an API URL reachable from a physical Expo Go phone; emulator loopback defaults do not work on a phone.
- Demo logins, persistence, voice, and model providers are opt-in environment settings. Do not claim an AI response is live until `/api/health` reports a ready provider.
- Daily appliance figures require a mapped Home Assistant energy sensor. The API stores only completed daily measurements, and production ingestion remains unavailable until customer authentication is implemented.
