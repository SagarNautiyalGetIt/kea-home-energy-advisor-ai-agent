# services/api — Backend

FastAPI · SQLAlchemy async · Alembic · Postgres. Owned by the **Backend team**.

## Start

```bash
make setup         # from the repo root — installs every service
cp .env.example .env
make db            # postgres
make api-migrate
make api-seed
make api-dev       # http://localhost:8000/docs
```

All targets also work from inside this directory as `make test`, `make dev` and so on.
The root Makefile just delegates here.

## How Sparky answers

The current online agent selects **typed lookup tools** for usage, bill facts,
forecasts, and support. Python computes the figures; Sparky writes the explanation
and the response names its sources. Tool arguments and results can be recorded for
review. See [ADR-0011](../../docs/adr/0011-agentic-tool-use.md) for the current
design. The earlier narrate-only approach in ADR-0002 is historical.

To use the local model, set `KEA_PROVIDER=ollama` in `.env`, run
`ollama pull qwen3:4b`, and start Ollama before the API. Then check
`/api/health`: `model_ready` must be `true` and `model` must name the selected
tool-capable model. A reachable Ollama daemon without that model is **not** ready.
The phone's offline preference does not download or run a model on the device.

## Cross-team ownership inside this service

Three directories here are written by other teams, because this is where their work
actually runs. Not enforced by tooling — **tag the owning team on the PR.**

| Path | Written by |
|---|---|
| `app/narration/`, `app/providers/` | [AI team](../../docs/teams/ai.md) |
| `app/analytics/`, `app/db/` | [Data team](../../docs/teams/data.md) |
| `app/verification/`, `app/schemas.py`, `app/api/`, `alembic/` | Maintainer |

`app/verification/` is the trust claim of the whole product. If it breaks, "0 fabricated
figures" stops being true and nobody notices. That is why
[`.github/CODEOWNERS`](../../.github/CODEOWNERS) requires a named approval on it.

## If you change an endpoint

```bash
make api-spec     # regenerates contracts/openapi.json — commit it in the same PR
```

CI fails if the committed contract is stale. Four people generate types from that file.

## Gotchas

- **`+asyncpg`, not `+psycopg`.** The app uses SQLAlchemy's async engine and asyncpg is
  the only Postgres driver in `pyproject.toml`.
- **The venv lives here**, at `services/api/.venv`, not at the repo root.
- **`get_provider()` is cached** — it owns the HTTP pool and the token counter. Call
  `get_provider.cache_clear()` in tests that need a different provider.
- **Migrations run from this directory.** `alembic.ini` uses relative paths.

## Related

- [`../../docs/prd.md`](../../docs/prd.md) — what we are building and why
- [`../../docs/api-standards.md`](../../docs/api-standards.md) — how endpoints are shaped
- [`../../docs/erd.md`](../../docs/erd.md) — the data model
- [`../../docs/teams/backend.md`](../../docs/teams/backend.md) — team onboarding
