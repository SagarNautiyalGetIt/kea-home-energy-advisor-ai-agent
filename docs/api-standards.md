# API standards & endpoint reference

How every endpoint in this service is shaped, and exactly what each one accepts and
returns. The frontend generates its types from `contracts/openapi.json`, so this
contract is load-bearing for four other people.

> Run `make api-spec` after **any** endpoint change. A stale `contracts/openapi.json`
> silently breaks the frontend build.

**Every example response in Part B was captured from a running server**, not written by
hand. If an example and the code disagree, the code is right and this file is a bug —
open a PR.

Base URL in development: `http://localhost:8000`. All paths below are prefixed `/api`.

---

- [Part A — Standards](#part-a--standards) · the rules new endpoints must follow
- [Part B — Endpoint reference](#part-b--endpoint-reference) · every endpoint in detail
- [Part C — Data models](#part-c--data-models) · the shapes shared across endpoints

---

# Part A — Standards

## A1. Style

REST over HTTP, JSON in and out, generated OpenAPI 3.1. FastAPI + Pydantic
([ADR-0001](adr/0001-backend-fastapi.md)) — Pydantic models *are* the schema, the
validation, and the docs. Never hand-write a response dict.

## A2. Naming

| Rule | Yes | No |
|---|---|---|
| Plural nouns for collections | `/households` | `/household`, `/getHouseholds` |
| Nouns, not verbs — the method is the verb | `POST /chat` | `POST /doChat` |
| `kebab-case` in paths | `/fact-bundles` | `/factBundles`, `/fact_bundles` |
| `snake_case` in JSON bodies and query params | `customer_id` | `customerId` |
| No version in the path yet | `/chat` | `/v1/chat` |

We are pre-v1 and the only consumer is our own frontend. When we ship externally,
version with a header, not a path segment — decide it in an ADR at that point.

## A3. Status codes

Codes this API **actually returns today**:

| Code | When | Emitted by |
|---|---|---|
| `200` | success with a body | every endpoint |
| `404` | household does not exist | `/households/{id}`, `/chat`, `/chat/stream` |
| `422` | request body failed validation | FastAPI, automatically |

Codes reserved for endpoints not yet built. Use these and no others:

| Code | When |
|---|---|
| `201` | created a resource — return it, and a `Location` header |
| `204` | success, deliberately no body |
| `400` | malformed request the client can fix, that isn't a validation error |
| `429` | rate limited |
| `500` | our fault. Should be rare and should page someone |
| `503` | dependency down |

**Never return `200` with an error inside the body.** The status code is the first thing
every client checks.

**Note that `/chat` does not return `503` when the model is down** — see
[A5](#a5-graceful-degradation). That is deliberate, and it is the one place this API
departs from the obvious REST answer.

## A4. Errors

FastAPI's default envelope is what this API emits today. One key, `detail`:

```json
{ "detail": "unknown household 'NOPE'; known: ['H-COLD', 'H-DROP', ...]" }
```

For `422`, FastAPI replaces the string with an array of per-field objects — see
[B7](#b7-validation-errors-422).

> ### Known defect — the 404 message is double-quoted
>
> `routes.py` raises `HTTPException(detail=str(exc))` from a `KeyError`, and `str()` on a
> `KeyError` **keeps the quotes its argument had**. The wire value is therefore
> `"\"unknown household 'NOPE'; ...\""` — a JSON string whose first and last characters
> are literal `"`. Clients that display `detail` raw will show the quotes.
>
> Fix is `exc.args[0]` instead of `str(exc)`. Not done here because it changes a response
> body and belongs in its own PR with a test. **Do not build client-side string
> trimming around this** — fix the server.

### The target error shape (not yet implemented)

When we add a second consumer, move to a structured envelope so clients can branch on a
stable code rather than parse prose:

```json
{
  "error": {
    "code": "household_not_found",
    "message": "No household with id H-NOPE.",
    "detail": null
  }
}
```

- `code` — stable, `snake_case`, safe to branch on. Never change one without a version bump.
- `message` — one sentence, plain language, safe to show a user.
- `detail` — optional structured extra. Never a stack trace, never a raw SQL error.

This is a breaking change and needs an ADR plus a heads-up to the frontend team. Until
then, **branch on the status code, never on the text of `detail`.**

## A5. Graceful degradation

An LLM-backed endpoint must **never** return a `500` or `503` because the model was slow
or absent. Provider failure degrades to a deterministic template built from the same
verified facts, returns `200`, and records that it did:

```json
{ "verification": { "fell_back_to_template": true } }
```

Silence, a permanent spinner, or a stack trace are all worse than a plain correct
sentence. This is also why the frontend can integrate before anyone has a model
installed — see [B4](#b4-post-apichat).

## A6. Rules that protect the trust claim

1. **No figure reaches a response without passing layer 3.** Verification is not optional
   middleware and must not be bypassed for "internal" endpoints.
2. **No raw meter readings in any response.** Responses carry computed facts.
3. **No PII in a `FactBundle`.** No name, address or account number. It is both the
   privacy control and, once we move to a hosted model, the prompt-cache boundary.
4. **Every response containing a number is traceable to its fact bundle.** That trail is
   the evidence for *"N prompts, 0 fabricated figures"*, and it cannot be reconstructed
   after the fact.

## A7. Breaking changes

A breaking change is: removing a field, renaming a field, changing a type, tightening
validation, or changing a status code.

- Mark the commit `feat(api)!:` with a `BREAKING CHANGE:` footer.
- Say so in the PR title.
- Tell the frontend team **before** merging — they must regenerate `api.d.ts`.
- Run `make api-spec` and commit `contracts/openapi.json` in the same PR. CI enforces it.

Adding an optional field is not breaking. Adding a required request field is.

---

# Part B — Endpoint reference

| # | Method | Path | Auth | Returns |
|---|---|---|---|---|
| [B1](#b1-get-apihealth) | `GET` | `/api/health` | none | Provider and model readiness |
| [B2](#b2-get-apihouseholds) | `GET` | `/api/households` | none | All demo households |
| [B3](#b3-get-apihouseholdscustomer_id) | `GET` | `/api/households/{customer_id}` | none | One household |
| [B4](#b4-post-apichat) | `POST` | `/api/chat` | none | Full verified answer |
| [B5](#b5-post-apichatstream) | `POST` | `/api/chat/stream` | none | Same answer over SSE |

**There is no authentication on any endpoint.** Sprint 2 is a local demo. Do not deploy
this to a public address as-is — that is on the [AWS team's](teams/aws.md) plate for
Sprint 3 and needs an ADR.

### The five demo households

Every `customer_id` the API accepts today. Anything else is a `404`.

| `customer_id` | Label | Why it exists |
|---|---|---|
| `H-JUL` | The real July household — high standing load | Reproduces the measured July data. The reference case |
| `H-COLD` | Cold-snap driven, not behaviour | Proves weather normalisation works |
| `H-SPIKE` | One genuine behavioural spike | A real one-off event, correctly attributed |
| `H-DROP` | Usage collapse — the hardship signal | Under-heating, the case that must escalate |
| `H-TARIFF` | Low steady user, better off on another plan | Drives the tariff comparison |

---

## B1. `GET /api/health`

Liveness, and whether the model is warm enough to answer quickly.

### Request

No parameters, no body.

```bash
curl http://localhost:8000/api/health
```

### Response `200`

| Field | Type | Notes |
|---|---|---|
| `status` | `string` | `"ok"`. Constant — the endpoint answering at all is the liveness signal |
| `provider` | `string` | `"ollama"` or `"bedrock"`. From `KEA_PROVIDER` |
| `model` | `string` | e.g. `"gemma3:4b"` |
| `model_ready` | `boolean` | Whether the provider reports the weights loaded |

```json
{
  "status": "ok",
  "provider": "ollama",
  "model": "gemma3:4b",
  "model_ready": false
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Always, if the process is up |

### Notes for clients

`model_ready: false` does **not** mean chat is broken. It means answers will come back as
deterministic templates rather than model prose. Use it to show "warming up", never to
disable the UI.

A cold model reads several gigabytes from disk. `main.py` warms it during startup, so ten
seconds of silence at the top of a demo reads as a crash rather than a load.

---

## B2. `GET /api/households`

Every demo household with its daily series. This is what the dashboard charts.

### Request

No parameters, no body.

```bash
curl http://localhost:8000/api/households
```

### Response `200`

An **array** of [`HouseholdSummary`](#householdsummary). Order is stable.

```json
[
  {
    "customer_id": "H-JUL",
    "label": "The real July household — high standing load",
    "period": "July 2026",
    "daily_kwh": [10.5, 9.9, 11.0, 9.2, 11.0, 10.3, 8.5, 7.1, 7.8, 14.1,
                  17.6, 8.8, 7.0, 7.2, 7.1, 8.4, 8.2, 7.9, 9.9, 10.5,
                  8.8, 11.2, 7.8, 9.5, 9.3, 11.5, 12.9, 12.3, 9.2, 7.8, 7.7],
    "total_kwh": 300.0,
    "estimated_cost_nzd": 90.0
  }
]
```

*(Truncated to one element; the live response has five.)*

### Status codes

| Code | Meaning |
|---|---|
| `200` | Always. An empty list would be `[]`, never `404` |

### Notes for clients

`daily_kwh` has one entry per day of `period`, in order, starting day 1. For July that is
31 entries. **Do not assume 31** — read the array length. `total_kwh` is the sum,
pre-rounded; use it rather than summing client-side, so your total always matches the
one the narrator quotes.

`estimated_cost_nzd` is computed at an **illustrative 30c/kWh**. Kea's real tariff is not
public. Any screen showing this number must say it is illustrative.

---

## B3. `GET /api/households/{customer_id}`

One household. Same shape as an element of [B2](#b2-get-apihouseholds).

### Request

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `customer_id` | path | `string` | yes | One of the [five demo IDs](#the-five-demo-households) |

```bash
curl http://localhost:8000/api/households/H-JUL
```

### Response `200`

A single [`HouseholdSummary`](#householdsummary) object — not wrapped, not an array.

```json
{
  "customer_id": "H-JUL",
  "label": "The real July household — high standing load",
  "period": "July 2026",
  "daily_kwh": [10.5, 9.9, "…29 more…", 7.7],
  "total_kwh": 300.0,
  "estimated_cost_nzd": 90.0
}
```

### Response `404`

```json
{ "detail": "\"unknown household 'NOPE'; known: ['H-COLD', 'H-DROP', 'H-JUL', 'H-SPIKE', 'H-TARIFF']\"" }
```

Note the doubled quotes — [known defect](#a4-errors). Don't display `detail` raw.

### Status codes

| Code | When |
|---|---|
| `200` | Household exists |
| `404` | No household with that ID |

---

## B4. `POST /api/chat`

The full pipeline, non-streaming. **Integrate against this one first** — it is the same
answer as [B5](#b5-post-apichatstream) without an SSE parser in the way. Debugging a UI
and a stream parser simultaneously is two problems.

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `customer_id` | `string` | yes | One of the [five demo IDs](#the-five-demo-households) |
| `message` | `string` | yes | The customer's question, free text. No length cap today |

```bash
curl -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"customer_id": "H-JUL", "message": "why is my bill so high?"}'
```

### Response `200`

| Field | Type | Notes |
|---|---|---|
| `customer_id` | `string` | Echoed back |
| `intent` | [`Intent`](#intent) | What layer 0 decided the question was |
| `text` | `string` | The answer. May contain `\n` — render with line breaks preserved |
| `facts` | [`Fact[]`](#fact) | Every number the answer is allowed to contain |
| `verification` | [`VerificationReport`](#verificationreport) | Layer 3's result. **Read the rules below** |
| `escalate_to_human` | `boolean` | Hand this conversation to a person |

Real response, captured with no model installed:

```json
{
  "customer_id": "H-JUL",
  "intent": "why_bill_high",
  "text": "Here is what your July 2026 usage shows:\n- Extra you use every day compared with similar homes: 2.4 kWh a day\n- What that extra usage costs over a year: $292 a year\n- Cost of the one-off spike: $2.52\n- Share of the extra usage the spike explains: 10%\n- Total cost for July 2026: $90.00\nIf you'd like this explained in more detail, I can connect you with our team.",
  "facts": [
    {
      "key": "sustained_overshoot",
      "value": 2.43,
      "unit": "kWh/day",
      "label": "Extra you use every day compared with similar homes",
      "display": "2.4 kWh a day"
    },
    {
      "key": "overshoot_annual_cost",
      "value": 292.32,
      "unit": "NZD/year",
      "label": "What that extra usage costs over a year",
      "display": "$292 a year"
    },
    {
      "key": "period_cost",
      "value": 90.0,
      "unit": "NZD",
      "label": "Total cost for July 2026",
      "display": "$90.00"
    }
  ],
  "verification": {
    "passed": false,
    "checked": [],
    "unverified": [],
    "regenerated": false,
    "fell_back_to_template": true
  },
  "escalate_to_human": false
}
```

*(`facts` truncated from five entries to three.)*

### Response `404`

Unknown `customer_id`, same shape as [B3](#b3-get-apihouseholdscustomer_id).

### Response `422`

Missing or wrongly-typed field — see [B7](#b7-validation-errors-422).

### Status codes

| Code | When |
|---|---|
| `200` | An answer was produced — **including when the model was unavailable** |
| `404` | Unknown `customer_id` |
| `422` | `customer_id` or `message` missing, or not a string |

There is deliberately **no `503`**. See [A5](#a5-graceful-degradation).

### How to read `verification.passed` — read this before using it

This is the single easiest thing to get wrong in the whole API.

`passed` answers one narrow question: **did the model's draft survive the number-checker?**
It does **not** mean "this answer is safe to show". When the model is missing or fails
twice, the endpoint returns a template built directly from `facts` — text that cannot
contain an uncomputed number, by construction — and `passed` stays `false`.

So a perfectly trustworthy answer arrives with `passed: false` and
`fell_back_to_template: true`, as in the example above.

**The rule for clients:**

```ts
const safeToDisplay = v.passed || v.fell_back_to_template;
```

| `passed` | `fell_back_to_template` | Means | Show it? |
|---|---|---|---|
| `true` | `false` | Model wrote it, every figure verified | ✅ yes |
| `false` | `true` | Deterministic template from verified facts | ✅ yes |
| `false` | `false` | Should be unreachable — treat as a bug and log it | ❌ no |

Never render the raw word "failed" from `passed`. A user seeing "verification failed" on
a correct answer undermines the exact claim the product is built on.

> **Open design question, for an ADR:** this trap exists because one boolean is being
> asked to carry two meanings. A `safe: bool` field computed server-side would remove it
> and let clients stop reasoning about the combination. That is a breaking change and a
> team decision — not made unilaterally here.

### Notes for clients

- `facts` is returned **even when the model wrote the prose**. Use it to render figures in
  a table or chart beside the text — don't regex numbers out of `text`.
- Use `display`, not `value`, whenever you show a number. `display` is the canonical
  rendering the verifier matches against; formatting `value` yourself risks showing
  `2.43` where the sentence says `2.4`.
- `facts` can be **empty**. Hardship answers carry no figures at all, deliberately —
  a number has no place in that reply.
- **Always surface `escalate_to_human`.** Under the Consumer Care Obligations that path is
  closer to a legal duty than a feature.

### Worked example — hardship

`{"customer_id": "H-JUL", "message": "I cannot afford to pay this bill"}` returns:

```json
{
  "intent": "hardship",
  "text": "I don't have enough information about your usage to answer that yet. I can put you through to someone who can help.",
  "facts": [],
  "escalate_to_human": true
}
```

Empty `facts`, `escalate_to_human: true`. A UI that only renders a figures table will show
a blank panel here — handle the empty case explicitly.

### Worked example — the appliance refusal

`{"customer_id": "H-JUL", "message": "which appliance is using the most?"}` routes to
`what_costs_most` and answers with standing load and its annual cost — **without naming an
appliance**. Half-hourly data cannot identify appliances. The refusal is deliberate and it
is a demo line, not a limitation to hide.

---

## B5. `POST /api/chat/stream`

The same answer as [B4](#b4-post-apichat), delivered as Server-Sent Events.

### ⚠️ Not fully described in `contracts/openapi.json`

FastAPI's `StreamingResponse` carries no response schema, so this endpoint appears in the
generated spec **with an empty response body**. Your generated types will be useless for
it. The event shapes below, mirrored in
[`services/web/src/lib/client.ts`](../services/web/src/lib/client.ts), are the contract of
record. **Change one, change the other, in the same PR.**

### Request body

Identical to [B4](#b4-post-apichat).

```bash
curl -N -X POST http://localhost:8000/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"customer_id": "H-TARIFF", "message": "am I on the right plan?"}'
```

`-N` disables curl's buffering. Without it you will see nothing until the stream closes
and wrongly conclude streaming is broken.

### Response `200` — `Content-Type: text/event-stream`

Exactly one `meta`, then zero or more `token`, then exactly one `done`.

```
event: meta
data: {"intent": "tariff_check", "escalate": false}

event: token
data: {"text": "Here is what your July 2026 usage shows:\n- Your plan for July 2026: $103\n- The other plan would have been: $77.38\n- You would save about: $310 a year\n"}

event: done
data: {"passed":false,"checked":[],"unverified":[],"regenerated":false,"fell_back_to_template":true}
```

| Event | Payload | Cardinality |
|---|---|---|
| `meta` | `{ intent: string, escalate: boolean }` | Exactly 1, always first |
| `token` | `{ text: string }` | 0 or more |
| `done` | [`VerificationReport`](#verificationreport) | Exactly 1, always last |

### Status codes

| Code | When |
|---|---|
| `200` | Stream opened. Note this is sent **before** the answer is generated |
| `404` | Unknown `customer_id` — raised *before* the stream opens |
| `422` | Body failed validation |

Validation happens before the response starts, on purpose. Raising inside the generator
would already have committed a `200` and an event-stream content type, so an unknown
household surfaced as a `500` with a half-open stream while `/chat` returned a clean
`404` for the same input. **Copy this ordering in any new streaming endpoint.**

### ⚠️ `token` is one event per *sentence*, not per word

Verification is a whole-text check. The server cannot stream raw model output and verify
afterwards — that would put an unverified number on screen, the exact failure this product
claims to prevent. So the server generates the full answer, verifies it, then streams the
approved text split on sentence boundaries.

Consequences you must design around:

- There is a **pause before the first `token`** equal to full generation time, then text
  arrives quickly. Show a thinking indicator from `meta` until the first `token`.
- Do not build a per-character typewriter effect expecting word-level granularity.
- Concatenate `text` values in order. Each already ends with a trailing space.

### Notes for clients

- **`EventSource` cannot do this.** It only issues GET requests and this endpoint needs a
  JSON body. Read frames off a `fetch` stream — `streamChat()` in
  `services/web/src/lib/client.ts` does it, including the case where a network chunk
  splits a frame mid-way.
- A stream that dies before `done` has **no verification result**. Treat a missing `done`
  as untrusted and do not present the partial text as a final answer.
- `escalate` arrives in `meta`, before any text — you can show the escalation affordance
  immediately rather than waiting for the answer.

---

## B6. Endpoints that do not exist yet

Do not build against these; they are here so nobody invents a conflicting shape.

| Planned | Purpose | Blocked on |
|---|---|---|
| `GET /api/households/{id}/intervals` | Half-hourly series | Repository layer replacing `fixtures.py` |
| `POST /api/feedback` | Was this answer useful? | Golden set (Day 6) |
| `GET /api/verification/log` | The audit trail behind "0 fabricated figures" | Persistence |

`compare_to_last_year` is a **routable intent with no analytics path**. It returns a
`FactBundle` with no facts and strong caveats — see [`Intent`](#intent).

---

## B7. Validation errors (`422`)

FastAPI generates these from the Pydantic model. Do not hand-write or override them.

Request missing `message`:

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "message"],
      "msg": "Field required",
      "input": { "customer_id": "H-JUL" }
    }
  ]
}
```

`detail` is an **array of objects** here, but a **string** for `404`. A client that assumes
`detail` is a string will break on `422`. Branch on the status code first.

| Field | Meaning |
|---|---|
| `type` | Machine-readable error kind, e.g. `missing`, `string_type` |
| `loc` | Path to the offending field, e.g. `["body", "message"]` |
| `msg` | Human-readable message. English only — do not show it to customers |
| `input` | What was actually received |

---

# Part C — Data models

Generated into TypeScript by `make web-types`. Definitions live in
[`services/api/app/schemas.py`](../services/api/app/schemas.py).

## `Fact`

One computed value. **Every number a customer ever sees starts life here.**

| Field | Type | Notes |
|---|---|---|
| `key` | `string` | Stable identifier, e.g. `standing_load_kwh_per_day`. Safe to branch on |
| `value` | `number` | The raw number, rounded |
| `unit` | `string` | `kWh` · `kWh/day` · `NZD` · `NZD/year` · `%` · `x` · `days` |
| `label` | `string` | Human-readable name, e.g. "Total cost for July 2026" |
| `display` | `string` | Pre-formatted, e.g. `"$292 a year"`. **Use this in the UI** |

`display` exists because the narration prompt tells the model to copy these strings
verbatim rather than format numbers itself. That both raises pass rate on small models and
gives the verifier an exact string to match. Reformatting `value` in the client
reintroduces the mismatch the field was created to remove.

## `FactBundle`

Everything layer 2 is allowed to know. **Not returned by the API** — it is internal — but
`facts` in `ChatResponse` is its `facts` list, so it shapes what you receive.

| Field | Type | Notes |
|---|---|---|
| `customer_id` | `string` | |
| `intent` | [`Intent`](#intent) | |
| `period` | `string` | Human phrase, e.g. `"July 2026"` |
| `facts` | `Fact[]` | May be empty |
| `caveats` | `string[]` | Claims the narrator must **not** make |

Deliberately carries no name, address, account number or raw meter reading.

## `VerificationReport`

Layer 3's output. Returned by `/chat` and as the SSE `done` event.

| Field | Type | Notes |
|---|---|---|
| `passed` | `boolean` | Did **the model's draft** survive the check. [Read this](#how-to-read-verificationpassed--read-this-before-using-it) |
| `checked` | `string[]` | Numeric tokens found in the draft |
| `unverified` | `string[]` | Tokens with no matching fact — the rejection evidence |
| `regenerated` | `boolean` | A second attempt was made after a first rejection |
| `fell_back_to_template` | `boolean` | Text is deterministic, not model-written |

On a template fallback, `checked` and `unverified` are both empty — no draft was ever
checked. An empty `checked` therefore does **not** mean "nothing to verify".

## `HouseholdSummary`

| Field | Type | Notes |
|---|---|---|
| `customer_id` | `string` | |
| `label` | `string` | Display name. Contains an em dash — don't assume ASCII |
| `period` | `string` | e.g. `"July 2026"` |
| `daily_kwh` | `number[]` | One entry per day, in order. Read the length |
| `total_kwh` | `number` | Pre-rounded sum |
| `estimated_cost_nzd` | `number` | At an **illustrative** 30c/kWh |

## `Intent`

What layer 0 decided the question was. A `StrEnum` — the wire value is the string.

| Value | Question | Analytics? |
|---|---|---|
| `why_bill_high` | "Why is my bill so high?" | ✅ |
| `what_will_i_pay` | "What will my next bill be?" | ✅ |
| `using_more_than_usual` | "Am I using more than usual?" | ✅ weather-normalised |
| `what_costs_most` | "What's costing me the most?" | ✅ never names an appliance |
| `tariff_check` | "Am I on the right plan?" | ✅ |
| `hardship` | "I can't afford this" | ⚠️ no figures, by design |
| `compare_to_last_year` | "Versus last winter?" | ❌ routable, **not implemented** |
| `out_of_scope` | Anything else | ❌ never had one |

The last two return an empty bundle with strong caveats. That is the one case layer 3
cannot protect: *"your usage was higher than last winter"* contains no numeric token, so
the number-checker passes it and a fabricated comparison reaches the customer. **The
caveats are the only guard.** Don't remove them when the analytics land — replace them
with real facts.

Adding an intent means adding four things: a router rule, an analytics path, a narration
prompt, and golden-set cases. Don't add one without all four.

---

## Related

- [`../contracts/README.md`](../contracts/README.md) — the generated contract, and why it is committed
- [`../services/web/README.md`](../services/web/README.md) — how the frontend consumes this
- [`teams/frontend.md`](teams/frontend.md) · [`teams/backend.md`](teams/backend.md)
- [`prd.md`](prd.md) · [`erd.md`](erd.md) · [`adr/`](adr/) · [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
