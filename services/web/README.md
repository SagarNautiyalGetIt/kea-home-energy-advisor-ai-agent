# services/web — Frontend

React 19 · TypeScript · Tailwind v4 · Vite. Owned by the **Frontend team**.

## Start

```bash
make web-install     # from the repo root
make web-types       # generate src/api.d.ts from contracts/openapi.json
make web-dev         # http://localhost:5173
```

You do **not** need the backend running to start work. `contracts/openapi.json` is
committed, so types generate from the file. You need the backend only when you want
live answers — then run `make api-dev` in a second terminal.

The dev server proxies `/api` to `http://localhost:8000`, so all fetches use relative
URLs and there is no CORS preflight in development.

## What is here

| Path | What it is |
|---|---|
| `src/lib/client.ts` | The only place that talks to the backend. Add calls here, not in components |
| `src/App.tsx` | A plain integration harness — proves the wiring works. **Not the pitch UI** |
| `src/index.css` | Tailwind v4 entry. Design tokens live in `@theme`, not a config file |
| `src/api.d.ts` | Generated, gitignored. Run `make web-types` |
| `src/features/energy-home/` | Embedded Usage scene, adapted from the complete Kea home prototype |
| `energy-home-prototype/` | Complete Kea home prototype, including its UI, controls, tests, documentation, assets, configuration, and license |

## Kea home visualisation

Usage shows the original house scene below its heading. The embedded view uses the
prototype's weather, sky, house, and energy dispatch code, and displays a fixed
**illustrative** 2.4 kW solar flow so the solar conduit remains active. The live sky
is independent of these demo energy figures; they are not meter readings.

The complete prototype code is retained in `energy-home-prototype/`. Its other
interface sections (weather scenarios, whole-system cards, detail view, controls,
settings, and footer) remain available in its standalone site and are not mounted
on the Usage page. This keeps the current Usage chart and breakdown below the scene.
The included files can be checked against `energy-home-prototype/SOURCE_SHA256SUMS.txt`.

After `npm install` in `services/web`, run the full prototype from its folder:

```bash
cd energy-home-prototype
npm run check
npm run dev
```

Its Vite server defaults to port 5188. The integrated customer portal uses the
usual `npm run dev` from `services/web`.

Build the real interface around `client.ts`. Don't grow `App.tsx` into the product.

## The one thing that will catch you out

`/api/chat/stream` is **not fully described by `openapi.json`**. FastAPI's
`StreamingResponse` carries no response schema, so the generated types show an empty
body for it. The SSE event shapes are hand-written in `src/lib/client.ts` and that file
is the contract:

| Event | Payload | Notes |
|---|---|---|
| `meta` | `{ intent, escalate }` | Always first |
| `token` | `{ text }` | One per **sentence**, not per word |
| `done` | `VerificationReport` | Carries `passed` |

`EventSource` cannot POST and this endpoint needs a JSON body, so `streamChat` reads
SSE frames off a `fetch` stream by hand. Pass the `AbortSignal`.

## Rules that are not negotiable

- **Surface `escalate_to_human`.** Under the Consumer Care Obligations that path is
  closer to a legal duty than a feature. If `meta.escalate` is true, the user must see it.
- **Every dollar figure must be labelled illustrative.** Kea's real tariff is not
  public; the backend computes at 30c/kWh. Any screen showing `$` says so.
- **Never name an appliance**, even if a designer asks for it. Half-hourly data cannot
  identify appliances — the refusal is a demo line, not a gap to paper over.
- Regenerate types whenever the backend changes an endpoint. A stale `api.d.ts` compiles
  fine and lies.

## Related

- [`../../contracts/`](../../contracts/) — the API contract
- [`../../docs/api-standards.md`](../../docs/api-standards.md) — how endpoints are shaped
- [`../../docs/teams/frontend.md`](../../docs/teams/frontend.md) — team onboarding
