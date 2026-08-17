# ADR-0001 — FastAPI for the backend

**Date:** 2026-08-17 · **Status:** Accepted · **Owner:** Akash

## Context

The backend must stream chat responses, serve a voice WebSocket, expose typed
contracts to a React/TypeScript frontend built by other team members, and run on a
laptop with no cloud dependency. All candidates are Python, since the analytics and
the model client are Python.

## Options considered

**Django + DRF** — batteries included: admin, ORM, auth, migrations.
**Flask** — minimal, familiar, huge ecosystem.
**FastAPI** — ASGI, async-native, Pydantic-based, generates OpenAPI.

## Decision

**FastAPI**, on three grounds in order of weight:

1. **Streaming.** Chat and voice both need token-by-token output; on local hardware
   this is what lets the voice path start speaking sentence one while sentence two is
   still generating. FastAPI is ASGI — SSE is a generator function and WebSockets are
   built in. Flask is sync-first; Django needs Channels, which is substantial
   machinery for one feature.
2. **Pydantic does triple duty.** One model definition serves as request validation,
   the schema describing our analytics outputs, and the typed `FactBundle` the
   number-checker verifies against. One definition, three uses — this is the strongest
   single reason.
3. **OpenAPI for free.** The frontend team runs `openapi-typescript` against
   `/openapi.json` and has typed clients on day two, before any endpoint is
   implemented. Getting off other people's critical path matters more than our own
   velocity.

## Consequences

**Accepted:** no admin, ORM, auth or migrations for free. Replaced with SQLAlchemy +
Alembic. For five seeded households SQLite is the right store, not a compromise — and
it removes a container from a stack that has to run on a laptop. Moving to Postgres
later is a connection-string change.

**Rejected reasoning worth recording:** Django's batteries are real value, but for a
ten-day pitch build with fixture data we would use perhaps 15% of Django and carry
all of it.

## Contract-first commitment

The OpenAPI stub ships on day one with fixture responses. Endpoint shapes are frozen
early and implementations change behind them all sprint.
