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

## Ownership is a review rule, not a directory

Two teams own code that lives inside `services/api/`. The AI team writes
`app/narration/`; the Data team writes `app/analytics/`. That code sits in the backend
service because the API imports it at request time — splitting it into separate packages
would buy nothing and cost a week.

[`.github/CODEOWNERS`](../../.github/CODEOWNERS) routes reviews to the right team
regardless of which directory the file sits in. If you are on the AI team and someone
changes a prompt, GitHub asks you, automatically.

## Everyone reads these

- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — branches, commits, PRs, Definition of Done. This is the rulebook
- [`../../SECURITY.md`](../../SECURITY.md) — data handling and secrets
- [`../adr/`](../adr/) — the decisions already made, and why. Read before proposing to change one
