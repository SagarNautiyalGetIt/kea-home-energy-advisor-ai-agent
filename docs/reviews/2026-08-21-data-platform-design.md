# Review — `elt` branch, data platform design

**Reviewing:** `origin/elt` @ `8d71ac0` — Harvey Nan, 20 Aug 2026
**Reviewer:** Akash · **Date:** 21 Aug 2026 (Day 5)
**Scope:** `data/design/` — a 725-line design doc and four DDL files, 2,379 lines total.

> **Verdict: don't merge to `main` yet, and don't change any Sprint 2 code because of it.**
> The design is good and most of it is right. But it describes a different architecture
> from the one the ADRs specify and the code implements, and three of those differences
> are decisions, not details. Merge it as a design document once §1 below is resolved.

---

## What is genuinely strong

These are not politeness; they are things I would not have got right.

**The three-file split by writer.** `kea_loader` has no grant on `app` — not even `USAGE`
— so a pipeline bug cannot reach conversation history even by fully-qualified name. That
is a real security property enforced by the database, not a convention in a comment. The
regenerable/not-regenerable column in the file table is the clearest statement of blast
radius I have seen on this project.

**Temporal plan resolution** (§2.1.2). One plan code has many versions and a bill must be
rated against the version in force at its period end. Harvey flags that this *fails
silently* if done wrong. He is right, and it is the kind of bug that would have reached
the pitch as a wrong number in a slide.

**The reconciliation targets** (§10.3). Proving the rating engine agrees with Kea's
billing on the one case both can compute, before trusting it on the cases only ours can.
That is exactly the epistemics of our own `test_analytics_july.py` — validate against the
measured artefact first — arrived at independently.

**The deferral rule** (§8.2.4): decisions that touch the 2.45-billion-row table are made
now; standalone tables are added when the feature is built. Correct, and better stated
than our cut line.

**`kea.mart_bill_explanation` agrees with our Layer 1.** Its driver decomposition —
period length, then weather, then base load, in attribution order — is the same analysis
`app/analytics/engine.py` performs with `overshoot_attribution`, `weather_attribution`
and `standing_load_kwh_per_day`. **The two designs do not disagree about the arithmetic.
They disagree about where it runs.** That is the whole review in one sentence.

---

## 1. Blocking — the evidence layer has nowhere to live

`app` contains exactly two tables: `conversation` and `conversation_message`. Our schema
has six, and the four Harvey's does not have are the ones the pitch is made of:

| Ours | What it proves | Equivalent in `app` |
|---|---|---|
| `fact_bundle` | what the model was given, and what it was forbidden from claiming | `cited_sources jsonb` — adjacent, not equivalent |
| `verification` | every numeric token traced to a computed fact | **none** |
| `token_usage` | cost per conversation, per model | **none** |
| `escalation` | when we knew about hardship (CCO cl. 9.3(c)) | `conversation.hardship_detected boolean` |

`cited_sources` records *what data backed the answer*. `verification` records *whether
every figure in the sentence traces to that data*. The first is provenance; the second is
the guarantee. **"N prompts, 0 fabricated figures" cannot be computed from Harvey's
schema**, and 61.9% of surveyed customers named fabrication as their top concern — it is
the single largest answer in the survey and the centre of the pitch.

Concretely, as of today that table is not hypothetical. 41 turns are logged locally:
24 model drafts passed the checker, **15 were rejected and replaced with deterministic
text**, 2 were model outages. Zero answers containing an unverified figure reached a
customer. There is no column in `app` that can hold any of those five numbers.

`hardship_detected boolean` is also a downgrade from a row per escalation: it cannot
express *when*, *which turn*, or *why*, and under the Consumer Care Obligations the
record of when we knew is the compliance artefact.

**Ask:** add `verification`, `fact_bundle` and `token_usage` to `app`, keyed on
`conversation_message(message_id)`, and make `hardship_detected` an `app.escalation`
table with a reason. Our `models.py` already has working shapes for all four.

---

## 2. Blocking — `tool_calls` encodes an architecture we removed

```sql
tool_calls  jsonb,  -- Which tools ran, with what arguments
```

[ADR-0002](../adr/0002-narrate-only-architecture.md) removed tool selection from the
model entirely, for a measured reason: small local models pick the wrong function, invent
parameters, or emit malformed JSON. Layer 0 chooses the analytics path in Python, in
~0 ms, and the model never decides what to compute.

So either that column is vestigial and should go, or Harvey is proposing to reverse
ADR-0002 — which is a legitimate position on Bedrock in Sprint 3, where a frontier model
*is* good at tool selection, but it is an ADR, not a column.

---

## 3. Decision needed — "the agent computes nothing"

§1.1 states it plainly:

> "The agent computes nothing. It reads pre-computed marts and writes conversation turns.
> Bill-increase attribution, plan re-rating, forecasting and aggregation all happen in the
> warehouse, where they are version-controlled, testable, and identical for every customer."

That is a direct reversal of Layer 1. It is also **defensible** — computing once in dbt
rather than per request is cheaper, more testable, and genuinely identical for every
customer, and Harvey's reasoning is sound.

**It is also reconcilable, and cheaply.** Layer 3 verifies the sentence against the
`FactBundle`; it does not care where the bundle came from. So:

- Layer 1 becomes a mart *reader* that populates a `FactBundle` from
  `kea.mart_bill_explanation` instead of computing from readings.
- Layer 0, Layer 2 and Layer 3 are unchanged. The guarantee is unchanged.
- `engine.py` survives as the reference implementation the warehouse is reconciled
  against — which is what §10.3 already proposes doing against Kea's billing.

**This must be an ADR-0008 before anyone writes code against it.** Not because the idea
is wrong, but because "where the numbers are computed" is the single most load-bearing
decision in this project and it is currently specified in two places that disagree.

---

## 4. Worth answering before it reaches a slide — Snowflake in an AWS Challenge

The course is `CS778-S2-2026-AWS-Challenge`, the pitch is Bedrock and Amazon Connect, and
the roadmap's Sprint 3 goal is "the same pipeline running on AWS". The design's warehouse
is **Snowflake + dbt**, with Spark and Airflow around it.

That is a strong production stack and Snowflake does run on AWS, so this is not wrong. But
a judge will ask, and "we chose a non-AWS warehouse for an AWS challenge" needs a better
answer than silence. The AWS-native equivalents are Redshift, or Athena + Glue over the
same S3 bronze layer — and the dbt models are largely portable between them.

**Ask:** one paragraph in the design doc, or an ADR, saying why Snowflake and what the
Redshift/Athena alternative would cost. Either answer is fine; not having one is not.

---

## 5. Smaller conflicts, all resolvable

| # | Conflict | Detail | Fix |
|---|---|---|---|
| 5.1 | **Two conversation stores** | `app.conversation` + `app.conversation_message` vs our `public.conversation` + `turn`. Different schemas, so they coexist physically — which is worse, because both would silently work | Pick one. Ours is running and tested; Harvey's is richer (`topic`, `outcome`, `satisfaction_score`, `retain_until`). Merge toward his shape, keep our evidence children |
| 5.2 | **Identity model** | His `conversation.account_id → billing.account`. Ours is `customer.external_ref` = `H-JUL`. Neither matches the demo script's `H-A…H-D` | This is KEA-78 with a third naming scheme. Resolve all three at once |
| 5.3 | **Postgres 17 vs 16** | ADR-0006, `infra/docker-compose.yml` and CI all pin 16 | Everything used here works on 16. Either state 16 or raise the pin deliberately |
| 5.4 | **Role vocabulary** | His `speaker_role` enum adds `system` and `human_agent`; ours has `customer`/`agent` | His is better. Adopt it |
| 5.5 | **Scale** | 140k customers, 2.45B intervals, a 13-month subset. Sprint 2 is 5 households and 7,440 readings, offline on one laptop | Not a contradiction — his is the production design — but the board must say which one Day 10 demos |
| 5.6 | **`meter` table cut** | §8.2.4 defers `meter`; our `models.py` has one and `seed.py` writes to it | Ours is doing no work his `meter_register` would not. Low stakes |

---

## 6. The framing that matters

This is a **production data-platform design**, not a Sprint 2 delivery. Read that way it
is valuable and largely correct, and it answers a question our repo currently cannot:
*how would this actually work at Kea, at 140k customers?* That is a real gap in the pitch
and Harvey has filled it.

The risk is only that it gets read as a plan for the next five days. Sprint 2 ships an
offline laptop demo on five seeded households; nothing in `data/design/` should change
that, and §12's own open-items table — fourteen items, several blocking "everything
downstream" — says as much.

**Suggested landing:**

1. Merge the doc and DDL to `main` under `data/design/` as a **design of record**, once
   §1 and §2 are addressed, with a header line saying it describes the Sprint 3+ target
   and not what Sprint 2 runs.
2. Open **ADR-0008 — where the numbers are computed** (§3). Harvey and I both write a
   position; whoever is right, it gets written down once.
3. Open **ADR-0009 — warehouse choice** (§4), even if the answer is "Snowflake, because".
4. Fold the evidence tables into `app` (§1) — I will send the shapes, they exist and work.
5. Resolve KEA-78 across all three identity schemes at once (§5.2).

Nothing here changes what I am building today.

## Related

- [ADR-0002 — the model narrates; Python decides](../adr/0002-narrate-only-architecture.md)
- [ADR-0006 — PostgreSQL from Sprint 2](../adr/0006-postgres-in-sprint-2.md)
- [Sprint 2 board](../sprints/sprint-2/board.md) — KEA-78, identity reconciliation
- [Roadmap](../roadmap.md) — Sprint 3 cloud foundations
