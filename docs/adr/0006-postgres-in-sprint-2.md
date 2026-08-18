# ADR-0006 — PostgreSQL from Sprint 2, not SQLite

**Date:** 2026-08-18 · **Status:** Accepted · **Owner:** Akash
**Supersedes:** the storage paragraph of [ADR-0001](0001-backend-fastapi.md)

## Context

ADR-0001 chose SQLite for the sprint on the grounds that five seeded households is a
small dataset and one fewer container is one fewer thing to break on demo day. That
reasoning was about *convenience*. Three things have changed the balance.

1. **The dataset is time-series, not five rows.** Half-hourly readings for five
   households over a month is 7,440 rows, and a year would be ~87,000. Every analytics
   question is a windowed aggregation over a time range — exactly what Postgres is good
   at and SQLite is merely adequate at.
2. **Money must not be stored as a float.** Our entire product claim is that figures are
   computed, not invented. `0.1 + 0.2 != 0.3` in binary floating point, and a rounding
   artefact surfacing in a demo would undermine precisely the thing we are selling.
   Postgres has a real `numeric` type; SQLite does not.
3. **The deployment story is AWS.** Building on Postgres now means the Sprint 3 move to
   RDS is a connection string. Building on SQLite means discovering the differences
   under deadline.

## Decision

**PostgreSQL 16, in Docker, from today.** Async stack throughout to match the ASGI
server: `SQLAlchemy 2.x` (async) + `asyncpg`, migrations via `Alembic`.

The local-only property is unchanged — Postgres runs in a container on the same laptop.
Nothing leaves the machine, and *"running entirely on this laptop, no internet, no
customer data leaving the device"* stays true and stays a pitch point.

## Consequences

**Accepted:**

- One more moving part on demo day. Mitigated by a seeded volume and an idempotent
  `make seed`, both rehearsed on Day 10 from a cold boot.
- Docker Desktop must be running on the demo machine. **Ollama still runs natively** —
  Docker on macOS is a Linux VM with no Apple GPU access, so a containerised model
  server would silently drop to CPU speed.
- Slightly more setup for a teammate cloning the repo: `docker compose up -d db` before
  `make dev`.

**Gained:**

- `numeric(12,4)` for every money and energy column. No float drift, anywhere.
- `timestamptz` for every timestamp. **This one matters more than it looks** — the July
  analysis is about *which day* usage happened, and New Zealand observes daylight saving.
  A naive timestamp puts half-hourly readings in the wrong day twice a year.
- `JSONB` for `fact_bundle.facts` and the verification arrays, with indexing available if
  we ever need to query inside them.
- `generate_series` for seeding, window functions for baseload and rolling comparisons —
  the analytics get shorter, not longer.
- The Sprint 3 migration becomes a connection string.

## Type rules — not negotiable

| Kind of column | Type | Why |
|---|---|---|
| Money | `numeric(12,4)` | Float drift is the one bug our product cannot survive |
| Energy (kWh) | `numeric(10,3)` | Same reasoning; also what meters actually report |
| Timestamps | `timestamptz` | NZ daylight saving moves readings between days |
| Facts / arrays | `jsonb` | Queryable, and typed on the way in by Pydantic |
| Ids | `bigint` identity | Readings grow fast; `int` is a future outage |

## Rejected alternative

**TimescaleDB.** Genuinely the right tool for half-hourly meter data at national scale,
and a fair question for a judge. It is an extension we would have to install and defend,
and 7,440 rows does not need it. Plain Postgres with a BRIN index on
`reading(interval_start)` is entirely sufficient here — and naming Timescale as the
scale-up path is a stronger answer than having adopted it prematurely.
