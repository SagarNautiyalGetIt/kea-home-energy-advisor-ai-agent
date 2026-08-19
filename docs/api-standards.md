# API standards

How every endpoint in this service is shaped. The frontend generates its types
from `openapi.json`, so the contract here is load-bearing for four other people.

> Run `make spec` after **any** endpoint change. A stale `openapi.json` silently
> breaks the frontend build.

---

## 1. Style

REST over HTTP, JSON in and out, generated OpenAPI 3.1. FastAPI + Pydantic
([ADR-0001](adr/0001-backend-fastapi.md)) — Pydantic models *are* the schema,
the validation, and the docs. Never hand-write a response dict.

## 2. Current surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness + model/provider readiness |
| `GET` | `/households` | list demo households |
| `GET` | `/households/{customer_id}` | one household summary |
| `POST` | `/chat` | full answer, non-streaming |
| `POST` | `/chat/stream` | token-streamed answer (SSE) |

## 3. Naming

| Rule | Yes | No |
|---|---|---|
| Plural nouns for collections | `/households` | `/household`, `/getHouseholds` |
| Nouns, not verbs — the method is the verb | `POST /chat` | `POST /doChat` |
| `kebab-case` in paths | `/fact-bundles` | `/factBundles`, `/fact_bundles` |
| `snake_case` in JSON bodies and query params | `customer_id` | `customerId` |
| No version in the path yet | `/chat` | `/v1/chat` |

We are pre-v1 and the only consumer is our own frontend. When we ship externally,
version with a header, not a path segment — decide it in an ADR at that point.

## 4. Status codes

| Code | When |
|---|---|
| `200` | success with a body |
| `201` | created a resource — return it, and a `Location` header |
| `204` | success, deliberately no body |
| `400` | malformed request the client can fix |
| `404` | resource does not exist |
| `422` | validation failed — FastAPI emits this automatically, don't override |
| `429` | rate limited |
| `500` | our fault. Should be rare and should page someone |
| `503` | dependency down (model provider, database) |

**Never return `200` with an error inside the body.** The status code is the
first thing every client checks.

## 5. Errors

One shape, everywhere:

```json
{
  "error": {
    "code": "household_not_found",
    "message": "No household with id 47.",
    "detail": null
  }
}
```

- `code` — stable, `snake_case`, safe to branch on in client code. Never change one without a version bump.
- `message` — one sentence, plain language, safe to show a user.
- `detail` — optional structured extra. Never a stack trace, never a raw SQL error.

## 6. Graceful degradation — a rule specific to this product

An LLM-backed endpoint must **never** return a 500 because the model was slow or
absent. Provider failure falls back to the deterministic template answer and the
response records that it did:

```json
{
  "answer": "...",
  "fell_back_to_template": true
}
```

Silence, a spinner forever, or a stack trace are all worse than a plain correct
sentence. See `app/verification/` and the degradation card in the sprint board.

## 7. Streaming

`/chat/stream` uses Server-Sent Events.

- Send an initial `ready` event so the UI can drop its skeleton.
- Stream token deltas as `data:` events.
- Terminate with an explicit `done` event carrying the verification result.
- A stream that dies mid-sentence must still emit `done` with `passed: false`.

Cold model start reads several GB from disk. Warm up on boot and expose readiness
on `/health` — ten seconds of silence reads as a crash.

## 8. Rules that protect the trust claim

1. **No figure reaches a response without passing layer 3.** Verification is not
   optional middleware and must not be bypassed for "internal" endpoints.
2. **No raw meter readings in any response.** Responses carry computed facts.
3. **Every response that contains a number is traceable to a `fact_bundle` row.**
   That trail is the evidence for the *"N prompts, 0 fabricated figures"* claim,
   and it cannot be reconstructed after the fact.

## 9. Breaking changes

A breaking change is: removing a field, renaming a field, changing a type,
tightening validation, or changing a status code.

- Mark the commit `feat(api)!:` with a `BREAKING CHANGE:` footer.
- Say so in the PR title.
- Tell the frontend team **before** merging — they must regenerate `api.d.ts`.

Adding an optional field is not breaking. Adding a required request field is.

---

## Related

- [`prd.md`](prd.md) · [`erd.md`](erd.md) · [`adr/`](adr/) · [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
