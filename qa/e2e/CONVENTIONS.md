# How to write a test in here

Nine rules. Each one is free to follow while writing and expensive to retrofit once the
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

The pipeline is four layers (ADR-0002): routing and analytics are deterministic Python,
**layer 2 is a language model**, and layer 3 is the number checker. Only layer 2 is
non-deterministic, and it is the only one that produces the sentence you can see.

Worse, the sentence differs by environment. When no provider is reachable the API returns
`template_fallback()` — deterministic text built from verified facts
(`services/api/app/narration/narrator.py`). So with Ollama running you get prose, and on
a runner without it you get the template. **Any assertion on exact wording passes locally
and fails in CI.**

Assert what is stable:

- the figures in the answer, against the same numbers the API returned
- `intent` on the `meta` event
- the verification badge — via `isSafeToDisplay()`, never `passed` on its own
  (`services/web/src/lib/client.ts` explains why)
- that the SSE stream renders progressively rather than in one jump
- escalation: `drop@kea.example` must reach a human

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
tests/
  auth.setup.ts          storageState, runs before everything
  dashboard.spec.ts      one file per page or per user journey
  fixtures/              shared test data and custom fixtures
  pages/                 page objects, added when duplication justifies one
```

Test titles say what should be true, not what the test does:

```ts
test('dashboard shows the same cycle cost the API returned')   // ✅
test('test dashboard 2')                                       // ❌
```

Not every suite needs page objects on day one. Add one when three files are repeating the
same locators, not before.

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
