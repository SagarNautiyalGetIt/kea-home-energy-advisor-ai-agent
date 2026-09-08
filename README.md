# HAKAS — Kea Energy Home Energy Advisor

Bill-shock prevention agent · Scenario 10 · Team HAKAS · CS778-S2-2026-AWS-Challenge
Sprint 2: **17–28 August 2026**

> **Every number in every answer traces to a row of this customer's own data, and the
> lookup that produced it is recorded. The assistant reads the meter data itself and
> shows you where each figure came from.**
>
> That is not a technical footnote — 61.9% of surveyed customers named "it might give
> me wrong or made-up information" as their top concern, the largest single answer.
> Answering it *demonstrably* is the pitch.
>
> Sprint 2 answered it a different way: the model was never shown any data and could
> only restate figures Python had computed. That made fabrication impossible and made
> explanation impossible with it. See [ADR-0011](docs/adr/0011-agentic-tool-use.md) for
> what changed and what was traded.

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
services/api/     Backend team    FastAPI, the agent and its tools, Postgres
services/web/     Frontend team   React 19 + TypeScript + Tailwind + Vite
services/mobile/  Mobile team     React Native + Expo + TypeScript (iOS & Android)
ml/               AI team         Prompts, golden set, evals, model benchmarks
data/             Data team       Raw extracts, analysis, data dictionary
infra/            AWS team        docker-compose, IaC, deployment
contracts/        —               openapi.json: the frozen interface between api and web/mobile
docs/             —               ADRs, PRD, ERD, sprint boards, team onboarding
```

Two teams own code that sits inside `services/api/`: the AI team writes `app/agent/`,
the Data team writes `app/analytics/`. That code lives in the backend
service because the API imports it at request time — **ownership is a convention, not a
directory.** Who owns what is written down in [`docs/teams/`](docs/teams/); nothing stops
you editing another team's files, but tell them.

[`.github/CODEOWNERS`](.github/CODEOWNERS) currently routes every review to the
maintainer. To hand an area to someone, add their `@handle` to that line — they only need
write access to the repo.

## Architecture

The model reads the question, decides what it needs, fetches it, and answers.

| Step | Owner | Module | Responsibility |
|---|---|---|---|
| Context | Python | `app/pipeline.py` | Fetch this household's data once, scoped to the signed-in customer |
| Tools | Python | `app/agent/tools.py` | Eight typed lookups over that data, each naming its source |
| Loop | **Model** | `app/agent/loop.py` | Read, call tools, reason, write the answer |
| Evidence | Python | `app/db/recorder.py` | Record every call and result to `app.agent_tool_call` |

`customer_id` is bound from the request and is **never** a tool parameter — there is no
argument the model can pass that reaches another household's data. Everything else —
what matters, what to compare, how much to say — is the model's.

Python still owns retrieval and the weather-normalised forecast, because neither is a
judgement call. `app/agent/tools.py` explains why that is not the middleman we removed.

Voice, telephony and chat all call `app.pipeline`
([ADR-0003](docs/adr/0003-voice-transport-skin.md)) — different transports, never a
second brain.

**The offline pack is the exception, and deliberately so.** A device with no connection
cannot call a tool, so it still ships pre-computed fact bundles and narrates them under a
prompt that forbids inventing a figure — the Sprint 2 architecture, preserved in
`app/analytics/bundles.py` where it is still the right one
([ADR-0008](docs/adr/0008-offline-first-narration.md)).

## Decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-backend-fastapi.md) | FastAPI, not Django or Flask |
| [0002](docs/adr/0002-narrate-only-architecture.md) | ~~The model narrates; Python decides~~ — superseded by 0011, and still live for offline |
| [0003](docs/adr/0003-voice-transport-skin.md) | Voice is a transport skin |
| [0004](docs/adr/0004-llm-provider-interface.md) | One provider interface — Ollama now, Bedrock later |
| [0005](docs/adr/0005-two-speed-models.md) | A second "fast" model is the wrong tool here |
| [0006](docs/adr/0006-postgres-in-sprint-2.md) | PostgreSQL from Sprint 2, not SQLite |
| [0007](docs/adr/0007-mobile-stack-expo.md) | React Native + Expo for mobile (iOS & Android) |
| [0008](docs/adr/0008-offline-first-narration.md) | Bedrock by default; local models are for customers with no connection |
| [0009](docs/adr/0009-smart-home-integration.md) | Smart-home devices lift the appliance caveat, per device |
| [0010](docs/adr/0010-aws-deployment.md) | Cost-optimised AWS — Lambda, RDS t4g.micro, no NAT Gateway |
| [0011](docs/adr/0011-agentic-tool-use.md) | The model reads the data and answers; Python serves it |

Disagree with one? Open an ADR, not a PR.

## The API

Endpoint shapes are frozen; implementations change behind them.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Provider, model, and whether the model is warm |
| `GET /api/households` | The five demo households |
| `GET /api/households/{id}` | Daily kWh + cost for one household |
| `POST /api/chat` | Non-streaming — integrate against this first |
| `POST /api/chat/stream` | SSE: `token`* / `reset` / `tool` / `result` → `done`, or `error` |

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

