# Backend team

## You own

`services/api/` — the FastAPI service and the agent that runs inside it.

Note that `app/agent/`, `app/providers/`, `app/analytics/` and `app/db/` live in your
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

The model reads the data and answers; you serve it.

```
question → MODEL ⇄ tools over this household's data → answer + the lookups behind it
           Gemini    Python (app/agent/tools.py)       recorded to app.agent_tool_call
```

Up to six rounds; the last is tool-free so hitting the cap still produces an answer.

**Scoping is yours and it is the one thing prompting must never be trusted with.**
`customer_id` is bound from the request and is never a tool parameter, so no argument the
model can pass reaches another household's data. If you add a tool, it must not accept
one — `test_agent.py` asserts this, and that assertion needs the maintainer's approval to
weaken.

The evidence write (`app/db/recorder.py` → `app.agent_tool_call`) is the product's trust
claim. Every answer records the calls behind it with their whole results. If it silently
stops writing, "every figure traces to a source" becomes unprovable and every test still
passes — which is this repository's recurring defect, not a hypothetical.

Read [ADR-0011](../adr/0011-agentic-tool-use.md) before changing any of it.

## Rules specific to you

- **Endpoint changed? Run `make api-spec` and commit `contracts/openapi.json` in the same
  PR.** CI fails otherwise. Four people generate types from that file.
- **Validate before the stream opens.** Raising inside an SSE generator has already
  committed a 200 and an event-stream content-type — the client sees a 500 with a
  half-open stream instead of a clean 404. `chat_stream` calls `build_context` first for
  exactly this reason; copy it.
- **A failing tool returns an error result; a failing model raises.** Opposite policies
  on purpose. The model can route around one unavailable lookup, so raising there turns a
  missing mart into a failed conversation. It cannot route around itself being
  unreachable, and there is no template to fall back to any more — so that case says so
  plainly rather than serving something invented.
- **`+asyncpg`, not `+psycopg`.**
- New analytics functions need unit tests. This is in the Definition of Done.

## Where to look

| Question | File |
|---|---|
| What can the model look up? | `app/agent/tools.py` |
| How does the loop work? | `app/agent/loop.py` |
| What is the model told? | `app/agent/prompts.py` |
| What can the API return? | `app/schemas.py` |
| Where is the evidence written? | `app/db/recorder.py` |
| How does the offline pack still work? | `app/analytics/bundles.py` |

## Related

- [`../../services/api/README.md`](../../services/api/README.md)
- [`../api-standards.md`](../api-standards.md)
- [`README.md`](Coding/kea-agent/docs/teams/README.md) — other teams
