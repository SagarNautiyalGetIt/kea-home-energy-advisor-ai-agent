# qa/ — Quality Assurance

**Owner:** Stephen Li (Quality Assurance)

Tests that drive the **running system** from the outside, the way a customer does. New to
QA on this project? Start with the team page, [`docs/teams/qa.md`](../docs/teams/qa.md).

## Why this is not in `services/`

[`services/README.md`](../services/README.md) defines that directory in one line —
*"Things that run as a process and serve traffic."* A test suite is not one. It listens
on no port and answers no request; it is a client.

The precedent for where it does go is [`ml/`](../ml/README.md), which draws the same
line for the AI team: runtime code in `services/api/app/narration/`, *"everything you
measure and iterate on"* in `ml/`. `ml/goldens/` and `ml/evals/` are test assets living
at the top level on purpose. This directory is the same shape of thing for QA.

Every other top-level directory maps to a team — `ml/` to AI, `data/` to Data, `infra/`
to AWS. `qa/` is that directory for testing.

## What is in it

| Path | What goes in it |
|---|---|
| [`e2e/`](e2e/) | Web end-to-end functional tests. Playwright + TypeScript, driving a real browser against the real stack. Rules in [`e2e/CONVENTIONS.md`](e2e/CONVENTIONS.md) |
| [`e2e/pages/`](e2e/pages/) | Page objects, so a change to the UI is fixed in one place rather than in every spec |
| [`e2e/cassettes/`](e2e/cassettes/) | Recorded model turns that the assistant suites replay — see [Recorded model turns](#recorded-model-turns) |
| [`android-phone.md`](android-phone.md) | Physical Android development-build runbook for local Sparky, Home Visual Highlight, and frame evidence. |
| [`mobile-immersive-release.md`](mobile-immersive-release.md) | Physical iOS and Android acceptance checklist for the immersive Home release |
| [`sparky-release.md`](sparky-release.md) | Acceptance checklist and verification record for the replacement Sparky release |
| [`mobile-app-repair.md`](mobile-app-repair.md) | Historical verification evidence for PR #286, superseded by `sparky-release.md` |

Each subdirectory owns its own dependency manifest and lockfile, the same rule
`services/` follows — so an API-testing or performance suite added later brings its own
toolchain without touching this one.

## What does *not* go in here

Unit and integration tests live with the code they test — `services/api/tests/` for the
backend, `npm test` in `services/mobile/` for the mobile app's logic, and the golden set
in `ml/goldens/`. **They are not moving here.** A test that
can run without the system running belongs next to the system.

The dividing line is the test *level*, not the test *type*:

| | Where it lives | Example |
|---|---|---|
| Component / integration | `services/api/tests/` | `test_bill_shock.py` asserts the overshoot calculation |
| System (end-to-end) | `qa/e2e/` | the same figure is rendered on the dashboard card |

Both are functional tests. The second one exists because serialisation, HTTP, the
generated TypeScript types and React rendering sit between the two, and pytest cannot
see any of it.

## How each client is tested

| Client | Approach | Where the cases live |
|---|---|---|
| Web | Automated end-to-end functional tests, run against the local stack | [`e2e/`](e2e/) |
| Mobile | Manual acceptance testing on a physical phone, from the customer's point of view | Test case sheet and report linked from #349 (sub-issue of #229) |
| Mobile | Device runbooks and release acceptance checklists | the `*.md` files in this directory |

Both use the same rule for expected results: they come from the requirement and from each
demo household's documented scenario (the account picker shows it, and
[`docs/demo-walkthrough.md`](../docs/demo-walkthrough.md) gives reference figures), never
from what the screen currently shows. A case written by looking at the app can only pass.

## Running the tests

```bash
make db                          # Postgres — see the account note below
make api-migrate api-seed
KEA_DEMO_LOGINS=1 make api-dev   # :8000 — demo sign-in is off unless set
make web-dev                     # :5173, proxies /api to :8000
cd qa/e2e && npm ci
npx playwright install chromium  # first run on a machine only
npm test
```

`auth.setup.ts` signs in as each account in `e2e/fixtures/accounts.ts`, so without
`KEA_DEMO_LOGINS=1` the API answers `/api/auth/login` with 503 and nothing after the
setup project runs.

`npm run report` opens the HTML report afterwards. `npm run test:ui` is the interactive
runner and is usually the faster way to debug one failure.

Playwright's `webServer` config reuses whatever is already running, so having the stack
up in other terminals is the normal way to work — it will not start a second copy.

## Recorded model turns

The assistant suites assert on what Sparky wrote, so they need real model output — but a
live model in CI is slow, nondeterministic and spends quota. The API can instead record a
real turn once and replay it ([`services/api/app/providers/cassette.py`](../services/api/app/providers/cassette.py)):

| Variable | Meaning |
|---|---|
| `KEA_CASSETTE` | `replay` serves recorded turns and never touches the network; `record` calls the real provider and saves what came back; `off` (default) is a passthrough |
| `KEA_CASSETTE_DIR` | where recordings live — defaults to `qa/e2e/cassettes/` |
| `KEA_CASSETTE_BUDGET` | hard ceiling on real requests while recording, so a retry loop cannot spend the day's quota |

A recording is keyed on the prompt, the history and the tool results, so when the data
behind a question changes the cassette misses and the test fails loudly instead of
replaying an answer about numbers that no longer exist. Re-record deliberately, never to
make a red test green.

## ⚠️ Which demo accounts actually resolve

`GET /api/auth/demo-accounts` advertises every demo sign-in — sixteen at the time of
writing: seven `H-*` fixture households and nine `DEMO-ACCT-*` accounts. How many of them
lead to a working dashboard depends on how the API was started:

| API started as | Working accounts |
|---|---|
| default (`KEA_PERSIST` unset — `"data_source": "fixtures"`) | the `H-*` households only |
| `KEA_PERSIST=1` + `make api-seed` + `make data-load` | all of them |

Against a fixtures-only backend the `DEMO-ACCT-*` accounts — including `tama@kea.example`,
the account in most of the design screenshots — **log in successfully and then 404**,
because `auth.py` is a static list while the households come from the repository.

The same thing happens in database mode when the database was seeded before a household
was added to `app/analytics/fixtures.py`: `H-ZARA` and `H-AROHA` sign in and then 404 on
every household endpoint until `make api-seed` is re-run. Re-seeding deletes
conversations and audit tables first, so agree it with the team before you run it.

Check which state you are in before writing a test against an account:

```bash
curl -s localhost:8000/api/health | grep data_source
```

This matters for test design, not just setup: a suite pinned to every account only passes
on a fully loaded database, which is a heavier precondition than one pinned to the `H-*`
fixture households. Pick deliberately, and say which in the test file.

## Where things stand

**Web — automated, needs rebuilding.** The suites below were written against the Sprint 3
and 4 UI. The Sprint 5 redesign moved and replaced parts of the Dashboard, so their
locators need rebuilding before the results can be trusted again.

| Suite | Page | What it checks |
|---|---|---|
| `dashboard.spec.ts` | Dashboard | per account: the greeting, the metric cards and the charts show this customer's figures as the API served them, not a fallback household |
| `billing.spec.ts` | Billing | per account: balance, due date, payment method and invoice totals belong to this customer |
| `assistant.spec.ts` | Sparky AI | the answer is about the signed-in customer, the highest day it names is the highest in the database, the documented prompts and New chat behave |
| `assistant-guardrails.spec.ts` | Sparky AI | no invented times of day or relationships, an unreachable backend says so, a second question does not interleave with the first |
| `bill-explainer.spec.ts` | Sparky AI | the bill explanation agrees with the invoice and its drivers sum to the movement; written ahead of the behaviour, so expected reds are annotated (CONVENTIONS rule 10) |

Not covered yet: the sign-in and sign-up forms themselves (setup only uses sign-in to get
a session), Usage, Plans and the solar calculator, Profile, Settings, and Help & Support.

**Mobile — manual acceptance testing, Sprint 5.** The P1 functionalities (Login & Session,
Bill Prediction, Sparky AI, Usage and Billing) were tested on an iPhone 15 Pro Max:
31 cases, 25 passed, 6 failed. The six failures trace to five defects, handed to the Mobile
team in #349. P2 (Plans, Solar calculator, Profile, Help & Support and Settings) is the
next round.

## Next

1. Rebuild the web suites against the current UI, moving shared locators into `e2e/pages/`.
2. Add suites for the uncovered web features listed above.
3. Tag a regression subset small enough to run on every pull request.
4. Add an end-to-end job to [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml)
   that starts the stack and replays cassettes, so it needs no model quota.
5. Re-run the failed mobile acceptance cases once #349 is fixed, then test P2.

## Related

- [`../docs/teams/qa.md`](../docs/teams/qa.md) — the QA team page: first hour, rules, traps
- [`e2e/CONVENTIONS.md`](e2e/CONVENTIONS.md) — how to write a test here
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — branches, commits, PRs, Definition of Done
- [`../services/api/tests/`](../services/api/tests/) — the layer below this one
