# Decision log

One line per non-obvious choice, with the date and the reason. Half the MIT report
writes itself out of this file, and future-you stops re-deciding settled things.

Substantial decisions get their own ADR in `docs/adr/`; this is for everything smaller.

| Date | Decision | Why |
|---|---|---|
| 2026-08-17 | Sprint 2 runs fully local, no AWS | Removes cloud setup from the critical path; Bedrock migration is ADR-0004's job |
| 2026-08-17 | SQLite over Postgres | Five seeded households; removes a container from a stack that must run on a laptop |
| 2026-08-17 | Structural integers ≤ 12 exempt from the number-checker | "Two things to note" is prose, not a claim; unit-bearing tokens are always claims |
| 2026-08-17 | Verify before streaming, not during | Cannot put an unverified figure on screen; revisit sentence-level verification on faster hardware |
