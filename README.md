# kea-agent

Home Energy Advisor & Bill-Shock Prevention Agent — Kea Energy, Scenario 9.
Team HAKAS, MIT Internship 2026. Sprint 2: **17–28 August 2026**.

> **Every number in every answer is computed by Python and verified before it reaches
> the customer. The model writes the sentence; it never does the maths.**
>
> That is not a technical footnote — 61.9% of surveyed customers named "it might give
> me wrong or made-up information" as their top concern, the largest single answer.
> Preventing it *demonstrably* is the pitch.

## Quick start

```bash
make setup                     # venv + deps
make db                        # postgres in docker (Ollama stays native)
make migrate                   # create the schema
brew install --cask ollama     # macOS: native install, NOT the Docker image
make pull                      # download the candidate models
make bench                     # measure words/sec on this machine
make dev                       # API on :8000, docs at /docs
make test
```

## Architecture

Four layers. The model owns exactly one of them.

| Layer | Owner | Module | Responsibility |
|---|---|---|---|
| 0 | Python | `app/routing/intents.py` | Map free text to one of ~8 intents |
| 1 | Python | `app/analytics/engine.py` | Compute typed facts from meter data |
| 2 | **Model** | `app/narration/` | Turn those facts into 2–4 sentences |
| 3 | Python | `app/verification/number_checker.py` | Reject any figure not traceable to layer 1 |

The model never chooses what to compute and never sees a raw meter reading — it
receives a `FactBundle` (`app/schemas.py`) and writes prose. Tool *selection* is the
hardest task for a small local model, so we removed it. See
[ADR-0002](docs/adr/0002-narrate-only-architecture.md).

Voice is the same pipeline with a different transport
([ADR-0003](docs/adr/0003-voice-transport-skin.md)) — never a second brain.

## Decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-backend-fastapi.md) | FastAPI, not Django or Flask |
| [0002](docs/adr/0002-narrate-only-architecture.md) | The model narrates; Python decides |
| [0003](docs/adr/0003-voice-transport-skin.md) | Voice is a transport skin |
| [0004](docs/adr/0004-llm-provider-interface.md) | One provider interface — Ollama now, Bedrock later |
| [0005](docs/adr/0005-two-speed-models.md) | A second "fast" model is the wrong tool here |
| [0006](docs/adr/0006-postgres-in-sprint-2.md) | PostgreSQL from Sprint 2, not SQLite |

## For the frontend team

```bash
make spec    # writes openapi.json
npx openapi-typescript openapi.json -o src/api.d.ts
```

Endpoint shapes are frozen; implementations change behind them. All fixture-backed
until Day 2 seeding lands, so you are never blocked on the backend.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Provider, model, and whether the model is warm |
| `GET /api/households` | The five demo households |
| `GET /api/households/{id}` | Daily kWh + cost for one household |
| `POST /api/chat` | Non-streaming — simplest to integrate against first |
| `POST /api/chat/stream` | SSE: `meta` → `token`* → `done` |

`done` carries the `VerificationReport`. Surface `escalate_to_human` in the UI —
under the Consumer Care Obligations that path is closer to a legal duty than a feature.

## Ground rules

- **Every figure traces to a source** — the brief's standing rule, and it applies to
  code as much as slides. Dollar amounts use an illustrative **30c/kWh** because Kea's
  real tariff is not public; anywhere that shows a dollar figure must say so.
- **Never name an appliance.** Half-hourly data cannot identify appliances. The
  refusal is deliberate and it is a demo line, not a limitation to hide.
- **Don't tune prompts before the golden set exists** (Day 6). Tuning without a
  measurement is vibes.
- **Merge daily.** Run `make check` before every commit.
- **This repo is never pushed anywhere.** Local git only — no remotes, no GitHub. The
  internship is competitive and the vaults hold client-adjacent material.
  `.github/workflows/ci.yml` exists but only runs if pushed, so treat `make check` as CI.

## Where things live

This repo is code only. Research, spoken scripts, the contribution log and the
rendered decks are held in the team research archive, which is deliberately not
published — the customer survey contains respondent data collected for analysis,
not publication. Ask the maintainer for anything you need from it. The deck
generators live in a separate repository.

## Status

- [x] Provider seam, schemas, layer 0, layer 3, fixture API
- [x] Measured July values ported — analytics validated against real data, not fixtures
- [x] Device benchmarking kit → `scripts/Device Benchmarking/`
- [x] PostgreSQL schema + Alembic migration (13 tables, ADR-0006)
- [x] Seeder — 5 households x 31 days x 48 intervals, July household reproduces the measurement
- [x] Weather / tariff / hardship analytics — all 7 demo lines now have maths behind them
- [ ] Repository layer to replace `fixtures.py` (Day 2 — next)
- [ ] **Unverified:** `make db && make migrate && make seed` has never run — no Docker on flex5
- [ ] Golden set + model bake-off (Day 6)
- [ ] Voice (Day 8)
