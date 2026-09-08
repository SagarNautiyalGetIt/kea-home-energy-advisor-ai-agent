# Windows local setup

Run the Kea Energy web app and API from PowerShell. These commands replace the
Unix-style `make` setup commands; virtual-environment activation is not required.

Start with the fixture demo below. PostgreSQL and a model service are optional for
that mode. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution workflow.

## Prerequisites

- Python 3.12 or newer, with the Windows `py` launcher and pip.
- Node.js 24 LTS with npm.
- Git if cloning; an extracted repository ZIP also works.
- Internet access to install dependencies.

Check these in a new PowerShell window:

```powershell
py -3.12 --version
node --version
npm.cmd --version
```

The commands below select Python 3.12 explicitly. If you installed a newer Python,
replace `py -3.12` with its launcher selector. `npm.cmd` avoids PowerShell blocking
the `npm.ps1` wrapper; there is no need to change execution policy.

## 1. Open the repository

If using Git:

```powershell
git clone https://github.com/CS778-S2-2026-AWS-Challenge/HAKAS-kea-energy.git
Set-Location HAKAS-kea-energy
```

If using a ZIP, extract it and open PowerShell in the extracted folder containing
`README.md`, `services`, and `contracts`. This is the **repository root** throughout
the guide. A ZIP download is enough to run the app but does not contain Git history.

## 2. Configure the fixture demo

From the repository root, copy the example only if `.env` does not already exist:

```powershell
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
}
notepad .env
```

Set the following entries, replacing existing values rather than duplicating keys:

```dotenv
KEA_PROVIDER=ollama
KEA_OLLAMA_MODEL=gemma3:4b
KEA_OLLAMA_URL=http://localhost:11434
KEA_DEMO_LOGINS=1
KEA_PERSIST=0
KEA_ALERTS_ENABLED=0
KEA_VOICE_ENABLED=0
```

The API reads the repository-root `.env` automatically. Environment variables set
in the terminal take precedence. Restart the API after changing configuration.

Demo sign-in uses synthetic accounts and is intended only for local development.
Keep `.env` out of commits; `.env.example` is the shared example.

## 3. Install and start the API

In the first PowerShell window, from the repository root:

```powershell
Set-Location services/api
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pip install tzdata
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Keep this window open. API documentation is at <http://127.0.0.1:8000/docs>.

`tzdata` supplies the IANA timezone database needed for `Pacific/Auckland` on
Windows. Without it, sign-in can work while the dashboard's bill-shock request
fails. It is not currently listed in the backend dependencies, so install it
explicitly as shown above.

If Ollama is absent, a model warm-up warning is expected. The API still starts and
chat uses the application's template fallback. A startup log saying “model warm”
is not proof of model availability; check `model_ready` on `/api/health`.

## 4. Install and start the frontend

Open a second PowerShell window at the repository root:

```powershell
Set-Location services/web
npm.cmd ci
npm.cmd run types
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Keep this window open and visit <http://127.0.0.1:5173>.

`npm ci` uses the committed `package-lock.json`. Type generation reads
`contracts/openapi.json`, so it does not need a running API. Vite proxies `/api`
requests to the API on port 8000.

## 5. Sign in and check the demo

Use the July household:

| Field | Value |
|---|---|
| Email | `july@kea.example` |
| Password | `julyhouse24` |
| Household | `H-JUL` |

Dismiss the welcome dialog. The current July fixture should show **300.0 kWh**
and **90.00 NZD** for the cycle. Dollar figures use the project's illustrative
30c/kWh rate, not a live customer tariff.

Try “Why is my bill so high?” in Sparky. Without a model, expect a template answer
listing computed facts rather than model-written prose. The API reports
`fell_back_to_template: true` and `provider_error: true`; this is not a successful
model verification.

The five `H-*` households work in fixture mode. The other nine accounts displayed
on the login page require the data-platform marts; signing in does not load those
datasets. Credentials and household mappings are in
[`app/auth.py`](../services/api/app/auth.py).

For a direct health check, use a third PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8000/api/households/H-JUL/bill-shock | ConvertTo-Json -Depth 4
```

In this setup, expect `status: "ok"`, `data_source: "fixtures"`, and
`recording: "none"`. `model_ready` remains false until a model service is available.

## What this mode includes

| Feature | Fixture demo |
|---|---|
| Demo login, dashboard, usage and bill-shock calculations | Available for the five `H-*` households |
| Chat | Computed facts with template fallback when the model is unavailable |
| Model-written narration | Requires Ollama with the configured model, or configured AWS Bedrock |
| Conversation recording and database-backed preferences | Requires PostgreSQL and `KEA_PERSIST=1` |
| Preferences in fixture mode | In memory; lost when the API restarts |
| Alert delivery | Disabled in this guide |
| Voice | Disabled; requires separate speech binaries and models |
| Nine data-platform accounts | Require the separately loaded marts |

## Optional: enable local model narration

With Ollama installed and running, download the model configured in `.env`:

```powershell
ollama pull gemma3:4b
ollama list
```

This is a large model download. Restart the API, check `/api/health`, and retry a
chat question. Check both the answer and its verification result. Model availability
alone does not guarantee that every answer passes verification.

## Optional: enable PostgreSQL persistence

Install and start Docker Desktop before this section. Stop the API with `Ctrl+C`.
From the repository root:

```powershell
docker compose -f infra/docker-compose.yml up -d db
docker compose -f infra/docker-compose.yml ps
```

Wait until the database is healthy. Keep the example database URL in `.env`:

```dotenv
KEA_DATABASE_URL=postgresql+asyncpg://kea:kea@localhost:5432/kea
```

Apply migrations and seed the five households:

```powershell
Set-Location services/api
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.db.seed
```

Set `KEA_PERSIST=1` in the repository-root `.env`, then restart the API using
the command in step 3. The demo database credentials are for local development.
This seeder does not load the nine data-platform accounts; see
[`data/README.md`](../data/README.md) for that separate pipeline.

## Troubleshooting

| Symptom | Check or fix |
|---|---|
| `py`, `node`, or `npm.cmd` is not found | Check the prerequisite installation and reopen PowerShell so it sees the updated PATH. |
| PowerShell says scripts are disabled | Use `npm.cmd` and the explicit `.venv\Scripts\python.exe` commands above. Activation is unnecessary. |
| Login returns 503 | Set `KEA_DEMO_LOGINS=1` in the repository-root `.env` and restart the API. |
| Dashboard says “Usage data unavailable” | Inspect the API terminal. For `unknown timezone 'Pacific/Auckland'`, install `tzdata` in the API venv and retry. Otherwise inspect the bill-shock endpoint with the command above. |
| Model warm-up fails or `model_ready` is false | Start Ollama and pull the exact configured model, or use template fallback while developing the UI. |
| Database connection is refused | For fixtures, use `KEA_PERSIST=0`. For persistence, check Docker health and the database URL. |
| A data-platform account has no usage | Use an `H-*` household for fixture mode, or load the marts. |
| Port 8000 or 5173 is already in use | Stop your previous server in its terminal with `Ctrl+C`. Check what owns the port before stopping an unfamiliar process. |
| Frontend requests fail while the API health check works | Confirm Vite proxies to the API's port; an exported `VITE_API_BASE_URL` overrides its default target. |

## Stop, restart, and validate

Press `Ctrl+C` in each server window to stop it. To restart, repeat the API and
frontend start commands from their respective directories. Dependency installation
is only needed on first setup or when dependencies change.

If you started Docker, stop its database from the repository root with:

```powershell
docker compose -f infra/docker-compose.yml stop db
```

This retains the database volume.

For frontend checks, from `services/web`:

```powershell
npm.cmd run types
npm.cmd run build
npm.cmd run lint
```

For backend checks, from `services/api`:

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check app tests
```

### Verification scope

The local Windows walkthrough verified API startup, demo sign-in, the populated
July dashboard, bill-shock data, and template chat fallback. The Codex-hosted
environment used bundled runtimes and a local WebAssembly compiler workaround;
the standard npm commands above follow the repository's frontend Makefile and were
not separately tested on a clean Windows installation. Docker persistence, model
installation, and voice setup were not exercised in that walkthrough.
