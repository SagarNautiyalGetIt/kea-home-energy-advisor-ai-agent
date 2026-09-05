# qa/ — Quality Assurance

Tests that drive the **running system** from the outside, the way a customer does.

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
| [`e2e/`](e2e/) | End-to-end functional tests. Playwright + TypeScript, driving a real browser against the real stack. Rules in [`e2e/CONVENTIONS.md`](e2e/CONVENTIONS.md) |

Each subdirectory owns its own dependency manifest and lockfile, the same rule
`services/` follows — so an API-testing or performance suite added later brings its own
toolchain without touching this one.

## What does *not* go in here

Unit and integration tests live with the code they test — `services/api/tests/` for the
backend, and the golden set in `ml/goldens/`. **They are not moving here.** A test that
can run without the system running belongs next to the system.

The dividing line is the test *level*, not the test *type*:

| | Where it lives | Example |
|---|---|---|
| Component / integration | `services/api/tests/` | `test_bill_shock.py` asserts the overshoot calculation |
| System (end-to-end) | `qa/e2e/` | the same figure is rendered on the dashboard card |

Both are functional tests. The second one exists because serialisation, HTTP, the
generated TypeScript types and React rendering sit between the two, and pytest cannot
see any of it.

## Running the tests

```bash
make db                     # Postgres — see the account note below
make api-migrate api-seed
make api-dev                # :8000
make web-dev                # :5173, proxies /api to :8000
cd qa/e2e && npm ci && npm test
```

`npm run report` opens the HTML report afterwards. `npm run test:ui` is the interactive
runner and is usually the faster way to debug one failure.

Playwright's `webServer` config reuses whatever is already running, so having the stack
up in other terminals is the normal way to work — it will not start a second copy.

## ⚠️ Which demo accounts actually resolve

`GET /api/auth/demo-accounts` advertises **fourteen** sign-ins. How many of them lead to
a working dashboard depends on how the API was started:

| API started as | `/api/households` returns | Working accounts |
|---|---|---|
| default (`KEA_PERSIST` unset — `"data_source": "fixtures"`) | 5 | the `H-*` households only |
| `KEA_PERSIST=1` + `make api-seed` + `make data-load` | 14 | all of them |

Against a fixtures-only backend the other nine — including `tama@kea.example`, the
account in most of the design screenshots — **log in successfully and then 404**, because
`auth.py` is a static list while the households come from the repository.

Check which state you are in before writing a test against an account:

```bash
curl -s localhost:8000/api/health | grep data_source
```

This matters for test design, not just setup: a suite pinned to all fourteen accounts
only passes on a fully loaded database, which is a heavier precondition than one pinned
to the five fixture households. Pick deliberately, and say which in the test file.

## Related

- [`e2e/CONVENTIONS.md`](e2e/CONVENTIONS.md) — how to write a test here
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — branches, commits, PRs, Definition of Done
- [`../services/api/tests/`](../services/api/tests/) — the layer below this one
