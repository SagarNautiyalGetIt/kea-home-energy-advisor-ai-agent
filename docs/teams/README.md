# Teams

Five teams, one repository. Each page below is the first thing a new member of that team
should read — what you own, where it lives, how to run it, and the rules specific to your
work.

| Team | Owns | Page |
|---|---|---|
| Backend | `services/api/` — the API, the four-layer pipeline | [backend.md](backend.md) |
| Frontend | `services/web/` — the React app | [frontend.md](frontend.md) |
| AI | `ml/`, plus `app/narration/` and `app/providers/` | [ai.md](ai.md) |
| Data | `data/`, plus `app/analytics/` and `app/db/` | [data.md](data.md) |
| AWS | `infra/` — local Postgres today, Bedrock and deployment in Sprint 3 | [aws.md](aws.md) |

## Ownership is a convention, not a directory

Two teams own code that lives inside `services/api/`. The AI team writes
`app/narration/`; the Data team writes `app/analytics/`. That code sits in the backend
service because the API imports it at request time — splitting it into separate packages
would buy nothing and cost a week.

**This is not enforced by tooling.** We deliberately do not use GitHub Teams — the setup
cost is not worth it for a two-week sprint.
[`.github/CODEOWNERS`](../../.github/CODEOWNERS) routes every review to the maintainer,
and the table above is what tells you whose work you are touching.

So: nothing stops you editing another team's files, and sometimes you should. **Tag them
on the PR when you do.** If a path needs a specific person's approval permanently, add
their `@handle` to that line in CODEOWNERS — no org permissions required, they just need
write access.

## Everyone reads these

- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — branches, commits, PRs, Definition of Done. This is the rulebook
- [`../../SECURITY.md`](../../SECURITY.md) — data handling and secrets
- [`../adr/`](../adr/) — the decisions already made, and why. Read before proposing to change one
