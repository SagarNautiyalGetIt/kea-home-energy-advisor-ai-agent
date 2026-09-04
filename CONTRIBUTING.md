# Contributing to HAKAS kea-energy

Team HAKAS · Kea Energy Scenario 10 · CS778-S2-2026-AWS-Challenge

This document is the rulebook. If a rule here and a habit disagree, the rule wins.
If a rule is wrong, open a PR against this file — don't quietly ignore it.

---

## 0. The one absolute rule

> **Only Kea Energy project files are ever committed to this repository.**

No vault notes, no personal files, no screenshots of unrelated work, no research
belonging to the Iris Vault, no other team's material. If you are not certain a file
belongs to this project, it does not go in. Ask first.

This is not a style preference. The repo is the record the course and AWS see.

---

## 1. Branches

`main` is protected. Nobody commits to it directly — not even the maintainer.
All work happens on a branch and arrives through a pull request.

### Naming

```
<type>/<KEA-id>-<short-kebab-description>
```

| Part | Rule | Example |
|---|---|---|
| `type` | one of the list below | `feat` |
| `KEA-id` | the card ID from the sprint board, lowercase | `kea-64` |
| description | 2–5 words, kebab-case, no ticket words like "fix" repeated | `end-to-end-chat-stream` |

**Full examples**

```
feat/kea-64-end-to-end-chat-stream
fix/kea-31-alembic-downgrade-order
docs/kea-38-postgres-adr
chore/kea-30-benchmark-script
test/kea-46-golden-set
refactor/kea-33-fixtures-to-repository
```

**Allowed types:** `feat` · `fix` · `docs` · `test` · `refactor` · `chore` · `spike`

**Never:** `akash-branch`, `new`, `test2`, `final`, `final-final`, `temp`.
A branch name is read by other people six weeks later. Write it for them.

### Lifecycle

1. Branch from an up-to-date `main`.
2. Push early — an open draft PR is better than three days of invisible work.
3. Delete the branch after merge (GitHub does this automatically once configured).
4. One card, one branch. If your branch is doing two things, it is two branches.

---

## 2. Commits — Conventional Commits

```
<type>(<scope>): <subject>

<body — why, not what>

Refs: KEA-64
```

### The rules

| Rule | Why |
|---|---|
| `type` from the same list as branches | machine-readable history, release notes generate themselves |
| `scope` = the area touched — see the list below | tells a reviewer where to look before opening the diff |
| subject ≤ 72 chars, imperative mood, no trailing full stop | "add weather normalisation", not "added" or "adds" |
| body explains **why** | the diff already shows what |
| `Refs: KEA-##` on every commit | links code to the board, permanently |

**Scopes**, one per team plus the cross-cutting ones:

| Team | Scopes |
|---|---|
| Backend | `api` · `schemas` · `routing` |
| Frontend | `web` |
| Mobile | `mobile` |
| AI | `narration` · `providers` · `evals` · `voice` |
| Data | `analytics` · `db` · `data` |
| AWS | `infra` · `deploy` |
| Anyone | `ci` · `docs` · `contracts` · `repo` |

### Good

```
feat(analytics): attribute overshoot to standing load vs spike

The published method flags Sat 11 Jul only, giving 10.9%. A generic 1.5x
detector also flags Fri 10 Jul and yields 16.4%. We keep the published
method as the default and expose the looser one behind a flag so the
team can compare before the pitch.

Refs: KEA-26
```

### Bad

```
update stuff
fix
final version
asdf
WIP
```

**Breaking changes:** add `!` after the scope and a `BREAKING CHANGE:` footer.

```
feat(api)!: rename /chat to /chat/stream

BREAKING CHANGE: frontend must regenerate api.d.ts from openapi.json.
```

---

## 3. Pull requests

A PR is a request for a colleague's judgement, not a formality.

### Rules

| # | Rule |
|---|---|
| 1 | Title uses the **same Conventional Commit format** as commits |
| 2 | The template must be filled in — no empty sections |
| 3 | **At least 1 approving review** before merge. [`CODEOWNERS`](.github/CODEOWNERS) decides who — GitHub requests them automatically. `app/verification/`, `app/schemas.py`, `app/api/`, `alembic/` and `contracts/` need the maintainer specifically |
| 4 | CI must be green. A red PR is not reviewable |
| 5 | Keep it under ~400 changed lines where you can. Big PRs get shallow reviews |
| 6 | Link the issue: `Closes #12` in the description auto-closes it on merge |
| 7 | **Squash merge only.** One card becomes one commit on `main` |
| 8 | The author merges after approval — not the reviewer |
| 9 | No self-approval, no merging your own unreviewed work |

### Review etiquette

- Review within one working day. Blocking a teammate for 48h costs more than the bug you found.
- Distinguish **blocking** from **suggestion**. Prefix non-blocking comments with `nit:`.
- Approve with comments if the only issues are nits. Don't hold a PR hostage over naming.
- Reviewers check: does it do what the card says · are there tests · are new figures sourced · does it break the API contract.

---

## 4. Definition of Done

A card is done when **all** of these are true. This is not negotiable per-card.

- [ ] Merged to `main` via PR with at least one approval, CI green
- [ ] Runs on a **second** teammate's machine, not only the author's
- [ ] Mobile changes verified on iOS & Android (screenshot or screen recording attached to PR)
- [ ] New analytics functions have unit tests
- [ ] Any new external figure carries a source link
- [ ] `contracts/openapi.json` regenerated (`make api-spec`) if any endpoint changed
- [ ] Illustrative tariff disclaimer ($) and escalate_to_human surfaced on web/mobile screens
- [ ] Anything cut is written into the tech-debt register with a reason

---

## 5. Issues

Every piece of work has an issue. The issue ID is the `KEA-##` used in branches and commits.

- Use the templates. A one-line issue is a note to self, not a task.
- Labels are mandatory: one `type:`, one `area:`, one `priority:`.
- Assign yourself when you start. An unassigned in-progress issue is invisible work.
- Close via PR (`Closes #n`), not by hand.

---

## 6. Local setup

```bash
make setup         # installs every service — python venv and node modules
cp .env.example .env
make db            # postgres in docker — Ollama stays NATIVE
make api-migrate
make api-seed
make check         # everything CI runs. Must pass before you push
```

`make help` lists every target grouped by team. Targets are prefixed by the team that
owns them (`api-`, `web-`, `ml-`); unprefixed targets are cross-cutting.

Your team's page in [`docs/teams/`](docs/teams/) has the shorter, specific version of
this.

Copy `.env.example` to `.env` and fill it in. **`.env` is gitignored and must stay that way.**
If you ever need to add a real secret, it goes in GitHub Actions secrets — never in a file.

---

## 7. Documentation

Decisions live in `docs/adr/`. If you make a call that a future teammate would
question, write an ADR — it takes ten minutes and saves an argument.

| Document | Location |
|---|---|
| **Team onboarding — read yours first** | `docs/teams/` |
| Product requirements | `docs/prd.md` |
| Data model / ERD | `docs/erd.md` |
| API standards | `docs/api-standards.md` |
| Architecture decisions | `docs/adr/` |
| Smaller dated calls | `docs/decision-log.md` |
| Sprint boards | `docs/sprints/` |

Each top-level directory also has a README explaining what belongs in it —
[`services/`](services/), [`ml/`](ml/), [`data/`](data/), [`infra/`](infra/),
[`contracts/`](contracts/). If you are unsure where a file goes, that is where to look.

---

## Related

- [`docs/teams/`](docs/teams/) — what your team owns and how to run it
- [`docs/api-standards.md`](docs/api-standards.md) — how endpoints are shaped
- [`docs/prd.md`](docs/prd.md) — what we are building and why
- [`SECURITY.md`](SECURITY.md) — data handling and secrets
