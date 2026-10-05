# How to write a test in here

Twelve rules. Each one is free to follow while writing and expensive to retrofit once the
suite has fifty tests in it. Most of them exist so this suite still passes the day it
runs on CI instead of your laptop.

---

## 1. Never hardcode a URL

`baseURL` is set in `playwright.config.ts` and overridable with `KEA_BASE_URL`.

```ts
await page.goto('/usage')                    // ✅
await page.goto('http://localhost:5173/usage')  // ❌
```

The API is reachable through the same origin — Vite proxies `/api` to :8000 — so
`request.get('/api/health')` works without a second base URL.

## 2. Log in once, not once per test

Signing in is not what most tests are testing, and doing it through the form every time
makes the suite slower and couples every file to the login markup.

A setup project signs in and saves `storageState`; other tests load it. `.gitignore`
already excludes `playwright/.auth/`, which is where the saved state goes.

Sessions here are `localStorage['kea-demo-session']`, not a token
(`services/web/src/lib/session.ts`) — Playwright stores `localStorage` in `storageState`,
so this works unchanged, and will keep working when the session becomes a real one.

The tests that *do* exercise the login form are the exception, and they start signed out.

## 3. Never `page.waitForTimeout()`

**This is the rule that decides whether the suite survives CI.**

```ts
await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()  // ✅ retries
await page.waitForTimeout(500)                                            // ❌
```

Web-first assertions retry until they pass or time out. A fixed sleep is tuned to the
machine you wrote it on: your laptop is fast, a CI runner is not, and the failure mode is
the worst kind — passes on re-run, fails at random, and nobody can reproduce it.

If you need to wait for something specific, wait for the thing:
`page.waitForResponse()`, `expect(locator).toHaveText()`, `expect(locator).toBeEnabled()`.

## 4. Every test runs alone

`fullyParallel` is on and CI may shard. A test that only passes after another one ran is
already broken; it just has not been noticed yet.

Verify by running the file on its own before you commit:

```bash
npx playwright test tests/dashboard.spec.ts
```

No shared mutable state between tests, no ordering assumptions, no "test B reuses the
account test A registered".

## 5. Assert on Sparky's *structure*, never its wording

The model reads the customer's data and writes the answer (ADR-0011). The **data** is
deterministic — the tools are pure reads over the same rows every time — and the prose is
not, because the model is not seeded.

When no provider is reachable there is now **no answer at all**: the stream carries
`event: error` and the page shows the message. There is no template fallback to be
confused with prose, which removes one environment difference and adds another —
**a suite run without a working provider will see the error path everywhere.** Assertions
must be written so that is a clear failure, not a silent skip.

Assert what is stable:

- the figures in the answer, against the same numbers the API returned
- that the answer is GROUNDED — `isGrounded()` in `api/client.ts`. An answer with no
  successful lookup is prose written from the system prompt with nothing behind it
- which lookups ran, via `turn.tools` — the equivalent of the old `intent` assertion, and
  a stronger one: it checks the assistant read the right thing rather than that a keyword
  matcher fired
- the hardship tier, via `turn.tier` — 1 autonomous, 2 monitored, 3 a person only
- that the SSE stream renders progressively rather than in one jump
- escalation: `drop@kea.example` must reach a human

**Do not assert that a figure matches a permitted list.** That check went with the
number-checker and it was never what it looked like: #141 §4 is the proof — Julia got "a
steady 0.0 kWh a day ... costs $0.00" under a badge reading "every figure checked". Every
figure in it was checked. The answer was worthless. Provenance is the claim now, not
permission.

Scoring the *model* against the golden set is a different job and already has a home in
`ml/evals/`. It is not an end-to-end test and does not belong here.

## 6. Cross-browser is a tagged subset, not the default

Only `chromium` is enabled. Running every functional test in three browsers triples the
wall clock to re-check business logic that cannot vary between them.

When a test genuinely covers layout or web-platform behaviour, tag it:

```ts
test('usage chart lays out at 1280px @cross-browser', async ({ page }) => { /* … */ })
```

then add the projects with `grep: /@cross-browser/`. Both browsers are already installed.
Do this when there is a tagged test to run, not before — a project that matches nothing
just reports zero and adds noise.

## 7. Locators: role and label first, `data-testid` only when there is no alternative

The app has no `data-testid` anywhere, and its semantics are good — real `<label>`s,
`aria-label` on icon buttons, `role` on live regions. Use them:

```ts
page.getByRole('button', { name: 'Send message' })   // ✅ survives restyling
page.getByLabel('Email')                             // ✅
page.locator('.login-button')                        // ❌ breaks on a CSS refactor
```

Charts are the real exception: an SVG area chart exposes nothing to query. Those need a
`data-testid`, and that is **frontend code owned by another team** — open a small PR
against `services/web/` and tag them on it. Do not reach into their components as part of
a test PR.

`testIdAttribute` is left at Playwright's default `data-testid`.

## 8. One root cause still gets one failure per affected case

When a single hardcoded value breaks fourteen accounts, the suite reports **fourteen**
failures, not one.

The instinct to assert it once — "it is the same defect, why say it fourteen times" — is
optimising the wrong thing. A single red row invites the reading that one account is
misconfigured. Fourteen red rows say, unmistakably, that the feature is wrong for every
customer the product has. The developer fixes it once either way; what changes is whether
they understand the blast radius before they decide how urgent it is.

So parametrise over every account, every scenario, every case a customer could actually
hit, and let the count fall where it falls. Deduplicate in the **written report** — one
finding, with the count and the file:line beside it — never in the suite.

## 9. Naming and layout

```
qa/e2e/
  playwright.config.ts
  tests/
    auth.setup.ts        storageState, runs before everything
    dashboard.spec.ts    one file per page or per user journey
  pages/                 page objects, added when duplication justifies one
  fixtures/              shared test data and custom fixtures
  api/                   the API client tests use to fetch expected values
  cassettes/             recorded model turns the API replays (KEA_CASSETTE=replay)
```

One file per page, with no exceptions — a spec that tests the suite rather than the
product does not belong beside the page specs, where its red is indistinguishable from a
product defect at a glance.

Test titles say what should be true, not what the test does:

```ts
test('dashboard shows the same cycle cost the API returned')   // ✅
test('test dashboard 2')                                       // ❌
```

Not every suite needs page objects on day one. Add one when three files are repeating the
same locators, not before.

---

## 10. A failing test says whether it is a defect or a requirement

`bill-explainer.spec.ts` is mostly red on purpose. The tests were written before the
behaviour, from §8.5 of `kea-data-platform-design.md`, so that the specification is
something a developer can run rather than something they have to read.

That is only useful if a reader can tell the two kinds of red apart. Annotate every test
that is expected to fail:

```ts
const tdd = { type: 'tdd', description: 'Behaviour not built yet — this red is the requirement' }
const defect = { type: 'defect', description: 'Behaviour exists and returns the wrong answer' }

test('names the driver that carries the movement', { annotation: tdd }, async ({ … }) => { … })
```

The annotation renders in the HTML report beside the failure, so a triage does not depend
on the reader knowing which features exist.

**Do not use `test.fail()` for this.** It inverts the result — the test reports *passed*
while the behaviour is missing, and goes red on the day someone implements it. That hides
exactly what §8 exists to surface, and a report showing green for unbuilt features is
worse than no report.

## 11. Never assert that two model generations match

Layer 2 is `gemma3:4b` with no seed pinned. The same question against the same account
produces different prose every time, so anything comparing one answer to another is
asserting the model is deterministic and will fail on a correct application.

The split that makes this workable:

| | deterministic? | may a test compare against it? |
|---|---|---|
| `intent` (layer 0) | yes — pure Python | yes |
| `facts[]` (layer 1) | yes — pure Python | yes, from a separate call |
| `text` (layer 2) | **no** | only its *numeric tokens*, and only against facts |
| `verification` (layer 3) | yes for a given text | yes, for the text it verified |

So expected values come from a second `POST /api/chat` — the facts are identical — while
the prose is only ever checked for structure: which figures appear in it, whether it ends
in a question, whether a forbidden word is present. `AssistantPage.ask()` returns the
`done` event from the page's *own* stream for the same reason: the report a test reasons
about must belong to the words it is looking at.

## 12. Only preconditions go in the setup project

Every project declares `dependencies: ['setup']`, and Playwright will not **start** a
dependent project when any test in its dependency failed. A red test in `auth.setup.ts`
therefore does not cost one result — it costs the entire run, reported as `did not run`
rather than as failures.

That is the right behaviour for a genuine precondition. Without a `storageState` file the
tests that load it cannot execute, so skipping them is honest.

It is the wrong behaviour for anything else, and this suite has the scar to prove it. An
assertion that the API offers *exactly* the accounts `ACCOUNTS` covers used to live there.
The day two assistant accounts were added, all fourteen sign-ins passed, every
`storageState` file was written, the environment was completely healthy — and **565
runnable tests were skipped** to report a stale list.

```ts
// setup: an account we are about to sign in as must exist   ✅ blocking, it cannot be used
// setup: the API offers nothing we do not cover             ❌ not a precondition
```

Before putting a test in `auth.setup.ts`, ask: *if this fails, can the other tests still
run?* If the answer is yes it belongs in a page spec, where it goes red on its own.
**A test that reports a gap must not also create one.**

### The coverage check was removed, not relocated

`fixtures/accounts.ts` is a hardcoded list, and the guard that kept it honest is gone by
decision — `H-ZARA` and `H-AROHA` are assistant accounts with nothing to say about the
Dashboard or Billing, so the drift it reported was not worth a file of its own.

The tradeoff it leaves behind is worth stating plainly, because it is invisible: **nothing
now notices when the product gains an account.** The suite will keep reporting green while
covering fewer customers than the product ships. When somebody adds a household that these
pages do care about, add it to `ACCOUNTS` by hand — no test will remind you.

`auth.setup.ts` still catches the opposite direction: an account listed in `ACCOUNTS` that
the API no longer offers fails there, because it genuinely cannot be signed into.

---

## What does not belong in this suite

If a test can pass without the browser running, it belongs somewhere else:

| You want to check | Where it goes |
|---|---|
| an analytics calculation | `services/api/tests/` |
| an endpoint's response shape | `services/api/tests/test_api_contract.py` |
| the model does not invent figures | `ml/goldens/` — already runs in CI |
| a rendered number matches what the API sent | **here** |

Re-asserting a covered calculation at this level is slower, flakier, and leaves a
maintainer two places to update when the rule changes.
