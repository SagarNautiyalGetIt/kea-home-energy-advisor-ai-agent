# QA team

**Owner:** Stephen Li (Quality Assurance)

## You own

`qa/` — tests that drive the running system from the outside, the way a customer does.

| Path | What it is |
|---|---|
| `qa/e2e/` | Web end-to-end functional tests. Playwright + TypeScript against the real stack |
| `qa/e2e/pages/` | Page objects — one place to fix when the UI changes |
| `qa/e2e/cassettes/` | Recorded model turns the assistant suites replay, so they run without network or quota |
| `qa/*.md` | Mobile device runbooks and release acceptance checklists |

Unit and integration tests stay with the code they test — `services/api/tests/`,
`npm test` in `services/mobile/`, and `ml/goldens/`. [`qa/README.md`](../../qa/README.md)
explains where the line is, and why.

## First hour

```bash
make db
make api-migrate api-seed
KEA_DEMO_LOGINS=1 make api-dev   # :8000 — demo sign-in is off unless set
make web-dev                     # :5173, proxies /api to :8000
cd qa/e2e && npm ci
npx playwright install chromium  # first run on a machine only
npm test                         # npm run test:ui to debug a single failure
```

Before trusting any result, check which data the API is serving:

```bash
curl -s localhost:8000/api/health | grep data_source
```

## The thing to internalise

**Expected results come from the requirement, not from the screen.** Every demo household
has a documented scenario — the account picker shows it, and
[`../demo-walkthrough.md`](../demo-walkthrough.md) gives reference figures. Cold Snap
should trip the bill-shock warning; Usage Collapse should be handed to a person; Zara
should not be given an invented cause. Write the expected result from that before you run
the case. A test written by looking at what the app currently shows can only ever pass.

## How each client is tested

| Client | Approach |
|---|---|
| Web | Automated end-to-end functional tests in `qa/e2e/` |
| Mobile | Manual acceptance testing on a physical phone, from the customer's point of view. The test case sheet and report are linked from #349 |
| Mobile | Device runbooks and release checklists in `qa/*.md` |

## Rules specific to you

- **Follow [`qa/e2e/CONVENTIONS.md`](../../qa/e2e/CONVENTIONS.md).** Rules 3 (no fixed
  waits), 7 (role and label locators first) and 8 (one failure per affected case) are the
  ones that decide whether the suite survives.
- **A failed case is not the same as a defect.** Keep every affected case red — in the
  suite or in the test case sheet — so the developer sees the blast radius, and group them
  by root cause in the written report so each bug is fixed once.
- **Do not change another team's code in a test PR.** If a chart needs a `data-testid`,
  open a small PR against `services/web/` and tag the Frontend team.
- **When two clients disagree, the API decides.** Check the endpoint response before
  reporting which client is wrong — one may be showing hardcoded data.
- **Commit scope is `qa`** for this directory, and `test(web)` for a new web suite.

## The trap

**A successful sign-in does not mean the account's data loaded.** The demo-account list in
`auth.py` is static, so an account can sign in and then 404 on every household endpoint —
for example when the database was seeded before that household existed. The screen can
still look plausible: an empty or default state is not the same as a passing check.
The "Which demo accounts actually resolve" section of
[`qa/README.md`](../../qa/README.md) has the details.

**The `H-*` households hold July 2026 only.** Screens default to today's date, so move the
date back to July 2026 before deciding that data is missing.

## Related

- [`../../qa/README.md`](../../qa/README.md) — what lives in `qa/`, how to run it, current
  coverage and what is next
- [`../../qa/e2e/CONVENTIONS.md`](../../qa/e2e/CONVENTIONS.md) — how to write a test here
- [`frontend.md`](frontend.md) and [`mobile.md`](mobile.md) — the teams whose screens these
  tests drive
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — branches, commits, PRs, Definition of
  Done
