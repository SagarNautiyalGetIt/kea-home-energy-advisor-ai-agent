# Backend team

## You own

`services/api/` — the FastAPI service and the pipeline that runs inside it.

Note that `app/narration/`, `app/providers/`, `app/analytics/` and `app/db/` live in your
service but are reviewed by the AI and Data teams. You are not blocked from editing them;
they get a review request.

## First hour

```bash
make setup
cp .env.example .env
make db
make api-migrate
make api-seed
make api-dev          # http://localhost:8000/docs
make api-test         # 105 tests, should be green
```

Then read [ADR-0002](../adr/0002-narrate-only-architecture.md). It explains the one
decision the whole codebase is shaped around, and nothing else will make sense first.

## The thing to internalise

Four layers; the model owns exactly one.

```
free text → [0] intent → [1] compute facts → [2] MODEL writes prose → [3] verify every number
             Python        Python              gemma3:4b              Python
```

The model never chooses what to compute and never sees a raw meter reading. It gets a
`FactBundle` and writes sentences. If you find yourself giving the model a decision to
make, you are about to undo the architecture — write an ADR first.

Layer 3 (`app/verification/number_checker.py`) is the product's trust claim. It needs the
maintainer's approval to change, and that is not bureaucracy: if it silently weakens, "0
fabricated figures" becomes false and every test still passes.

## Rules specific to you

- **Endpoint changed? Run `make api-spec` and commit `contracts/openapi.json` in the same
  PR.** CI fails otherwise. Four people generate types from that file.
- **Validate before the stream opens.** Raising inside an SSE generator has already
  committed a 200 and an event-stream content-type — the client sees a 500 with a
  half-open stream instead of a clean 404. `chat_stream` does this correctly; copy it.
- **`+asyncpg`, not `+psycopg`.**
- New analytics functions need unit tests. This is in the Definition of Done.

## Where to look

| Question | File |
|---|---|
| How does routing work? | `app/routing/intents.py` |
| What can the API return? | `app/schemas.py` |
| What does the model see? | `app/narration/prompts.py` |
| How is a number verified? | `app/verification/number_checker.py` |

## Related

- [`../../services/api/README.md`](../../services/api/README.md)
- [`../api-standards.md`](../api-standards.md)
- [`README.md`](README.md) — other teams
