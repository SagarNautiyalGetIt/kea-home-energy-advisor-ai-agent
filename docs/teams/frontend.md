# Frontend team

## You own

`services/web/` — React 19, TypeScript, Tailwind v4, Vite.

## First hour

```bash
make web-install
make web-types        # generates src/api.d.ts from the committed contract
make web-dev          # http://localhost:5173
```

**You are not blocked on the backend.** `contracts/openapi.json` is committed, so types
generate from a file. Run `make api-dev` in a second terminal only when you want live
answers.

## The thing to internalise

The endpoint shapes are **frozen**. Implementations change behind them all sprint; the
contract does not. Build against it with confidence.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Provider, model, and whether the model is warm |
| `GET /api/households` | The five demo households |
| `GET /api/households/{id}` | Daily kWh + cost for one household |
| `POST /api/chat` | Non-streaming — integrate against this first, it is far simpler |
| `POST /api/chat/stream` | SSE: `meta` → `token`* → `done` |

Start with `POST /api/chat`. Get the whole flow working non-streaming, then swap in the
stream. Debugging a UI and an SSE parser at the same time is two problems.

## Rules specific to you

- **Surface `escalate_to_human`.** Under the Consumer Care Obligations that path is
  closer to a legal duty than a feature. If `meta.escalate` is true, the user sees it.
- **Every dollar figure is labelled illustrative.** Kea's real tariff is not public; the
  backend computes at 30c/kWh. Any screen with a `$` says so.
- **Never name an appliance**, even if it would make a nicer screen. Half-hourly data
  cannot identify appliances — the refusal is a demo line, not a gap.
- **Regenerate types after every backend endpoint change.** A stale `api.d.ts` compiles
  perfectly and lies to you.
- **Treat accessible names as part of the interface.** The end-to-end suite in `qa/e2e/`
  finds elements by role and label — `getByRole('button', { name: 'Send message' })` —
  so renaming a visible label or an `aria-label` breaks tests that pass on your machine.
  Tag QA on the PR when you change one. Charts expose nothing to query, so they are the one
  place a `data-testid` is wanted.

## The trap

`/api/chat/stream` is **not fully described in `openapi.json`**. FastAPI's
`StreamingResponse` has no response schema, so the generated types show an empty body.
The real event shapes are hand-written in `src/lib/client.ts` — that file is the
contract for the stream.

Also: `EventSource` cannot POST, and this endpoint needs a JSON body. `streamChat()`
reads SSE frames off a `fetch` stream by hand, including the case where a network chunk
splits a frame down the middle. Use it rather than rewriting it.

`token` events are **one per sentence**, not one per word — the backend verifies the
whole answer before it streams anything, because a half-verified number on screen is
exactly the failure the product claims to prevent.

## Related

- [`../../services/web/README.md`](../../services/web/README.md)
- [`../../contracts/README.md`](../../contracts/README.md)
- [`../api-standards.md`](../api-standards.md)
- [`qa.md`](qa.md) — the end-to-end suite that drives these pages
