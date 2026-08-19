# contracts/

The frozen interface between the backend and everything that calls it.

`openapi.json` is **committed on purpose**, unlike most generated files. The frontend
team must be able to generate types on a fresh clone without installing Python, starting
Docker, seeding Postgres and booting the API. One `git clone` and they are working.

## The rule

> If a PR changes an endpoint, request model or response model, that same PR
> regenerates `openapi.json`.

```bash
make api-spec
```

The PR template has a checkbox for it and CI fails if the committed file is stale, so
this is enforced rather than remembered.

## What is deliberately NOT in here

`POST /api/chat/stream` appears with an empty response body. That is not a bug —
FastAPI's `StreamingResponse` carries no response schema, so SSE cannot be expressed in
OpenAPI. Its event shapes are hand-written in
[`services/web/src/lib/client.ts`](../services/web/src/lib/client.ts), which is the
contract of record for the stream. Change one, change the other, in the same PR.

## Related

- [`../docs/api-standards.md`](../docs/api-standards.md) — how endpoints are shaped
- [`../services/web/README.md`](../services/web/README.md) — how the frontend consumes this
