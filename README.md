# HAKAS — Kea Energy Home Energy Advisor

Bill-shock prevention agent · Scenario 9 · Team HAKAS · CS778-S2-2026-AWS-Challenge
Sprint 2: **17–28 August 2026**

> **Every number in every answer is computed by Python and verified before it reaches
> the customer. The model writes the sentence; it never does the maths.**
>
> That is not a technical footnote — 61.9% of surveyed customers named "it might give
> me wrong or made-up information" as their top concern, the largest single answer.
> Preventing it *demonstrably* is the pitch.

## Start here

**New to the repo? Go to [`docs/teams/`](docs/teams/) and read your team's page.** It is
one screen and it tells you what you own, how to run it, and the rules specific to your
work. Then read [`CONTRIBUTING.md`](CONTRIBUTING.md) — that is the rulebook for everyone.

```bash
git clone git@github.com:CS778-S2-2026-AWS-Challenge/HAKAS-kea-energy.git
cd HAKAS-kea-energy
cp .env.example .env
make setup            # installs every service
make db               # postgres in docker (Ollama stays native)
make api-migrate && make api-seed
make api-dev          # API   → http://localhost:8000/docs
make web-dev          # web   → http://localhost:5173
make check            # everything CI runs — do this before you push
```

`make help` lists every target, grouped by team.

## Layout

```
services/api/     Backend team    FastAPI, the four-layer pipeline, Postgres
services/web/     Frontend team   React 19 + TypeScript + Tailwind + Vite
ml/               AI team         Prompts, golden set, evals, model benchmarks
data/             Data team       Raw extracts, analysis, data dictionary
infra/            AWS team        docker-compose, IaC, deployment
contracts/        —               openapi.json: the frozen interface between api and web
docs/             —               ADRs, PRD, ERD, sprint boards, team onboarding
```

Two teams own code that sits inside `services/api/`: the AI team writes
`app/narration/`, the Data team writes `app/analytics/`. That code lives in the backend
service because the API imports it at request time. **Ownership is a review rule, not a
directory** — [`.github/CODEOWNERS`](.github/CODEOWNERS) routes each path to the right
team automatically.

## Architecture

Four layers. The model owns exactly one of them.

| Layer | Owner | Module | Responsibility |
|---|---|---|---|
| 0 | Python | `app/routing/intents.py` | Map free text to one of ~8 intents |
| 1 | Python | `app/analytics/engine.py` | Compute typed facts from meter data |
| 2 | **Model** | `app/narration/` | Turn those facts into 2–4 sentences |
| 3 | Python | `app/verification/number_checker.py` | Reject any figure not traceable to layer 1 |

The model never chooses what to compute and never sees a raw meter reading — it receives
a `FactBundle` and writes prose. Tool *selection* is the hardest task for a small local
model, so we removed it ([ADR-0002](docs/adr/0002-narrate-only-architecture.md)).

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

Disagree with one? Open an ADR, not a PR.

## The API

Endpoint shapes are frozen; implementations change behind them.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Provider, model, and whether the model is warm |
| `GET /api/households` | The five demo households |
| `GET /api/households/{id}` | Daily kWh + cost for one household |
| `POST /api/chat` | Non-streaming — integrate against this first |
| `POST /api/chat/stream` | SSE: `meta` → `token`* → `done` |

`contracts/openapi.json` is committed, so the frontend generates types on a fresh clone
without running the backend. **Change an endpoint → `make api-spec` → commit it in the
same PR.** CI fails if it goes stale.

## Ground rules

- **Every figure traces to a source** — the brief's standing rule, and it applies to code
  as much as to slides. Dollar amounts use an illustrative **30c/kWh** because Kea's real
  tariff is not public; anywhere showing a dollar figure must say so.
- **Never name an appliance.** Half-hourly data cannot identify appliances. The refusal
  is deliberate — it is a demo line, not a limitation to hide.
- **Surface `escalate_to_human`.** Under the Consumer Care Obligations that path is
  closer to a legal duty than a feature.
- **Don't tune prompts before the golden set exists** (Day 6). Tuning without a
  measurement is vibes.
- **Merge daily.** Branch, PR, one approval, squash. Run `make check` first.
- **Only Kea Energy project files are ever committed here.** No research notes, no
  personal files, no other team's material, no survey respondent data. If you are not
  certain a file belongs, it does not go in — ask first.

## What is not in this repository

Research, spoken scripts, the contribution log and the rendered decks are held in the
team research archive, which is deliberately not published — the customer survey contains
respondent data collected for analysis, not publication. Ask the maintainer for anything
you need from it. The deck generators live in a separate repository.

## Status

- [x] Provider seam, schemas, layer 0, layer 3, fixture API
- [x] Measured July values ported — analytics validated against real data, not fixtures
- [x] Device benchmarking kit → `ml/benchmarks/device/`
- [x] PostgreSQL schema + Alembic migration (13 tables, ADR-0006)
- [x] Seeder — 5 households x 31 days x 48 intervals; July household reproduces the measurement
- [x] Weather / tariff / hardship analytics — all 7 demo lines have maths behind them
- [x] Monorepo restructure — five team directories, contract committed, CI split per service
- [ ] Frontend: `npm install` and first real screens (scaffold is a harness, not the UI)
- [ ] Repository layer to replace `fixtures.py`
- [ ] **Unverified:** `make db && make api-migrate && make api-seed` has never run — no Docker on the dev machine
- [ ] Golden set + model bake-off (Day 6)
- [ ] Voice (Day 8)
