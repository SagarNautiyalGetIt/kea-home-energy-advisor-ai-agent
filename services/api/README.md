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

## The four layers

The model owns exactly one of them.

| Layer | Owner | Module | Responsibility |
|---|---|---|---|
| 0 | Python | `app/routing/intents.py` | Map free text to one of ~8 intents |
| 1 | Python | `app/analytics/engine.py` | Compute typed facts from meter data |
| 2 | **Model** | `app/narration/` | Turn those facts into 2–4 sentences |
| 3 | Python | `app/verification/number_checker.py` | Reject any figure not traceable to layer 1 |

The model never chooses what to compute and never sees a raw meter reading. It receives a
`FactBundle` (`app/schemas.py`) and writes prose. Tool *selection* is the hardest task for
a small local model, so we removed it — [ADR-0002](../../docs/adr/0002-narrate-only-architecture.md).

## Cross-team ownership inside this service

Three directories here are reviewed by other teams, because that is where their work
actually runs. See [`.github/CODEOWNERS`](../../.github/CODEOWNERS).

| Path | Reviewed by |
|---|---|
| `app/narration/`, `app/providers/` | AI team |
| `app/analytics/`, `app/db/` | Data team |
| `app/verification/`, `app/schemas.py`, `app/api/`, `alembic/` | Maintainer |

`app/verification/` is the trust claim of the whole product. If it breaks, "0 fabricated
figures" stops being true and nobody notices. That is why it needs a named approval.

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
