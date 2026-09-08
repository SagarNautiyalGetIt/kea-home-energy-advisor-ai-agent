# ADR-0002 — The model narrates; Python decides

**Date:** 2026-08-17 · **Status:** Superseded by
[ADR-0011](0011-agentic-tool-use.md) · **Owner:** Akash

> **Superseded on 2026-09-08, and still worth reading.** The cost this ADR named under
> *Consequences* — "the agent cannot answer a question we did not anticipate" — is
> exactly what came due, and ADR-0011 is the decision to pay differently. The reasoning
> below was sound for a 4B local model on laptop hardware; it stopped applying when the
> default provider became a frontier model on a cloud account.
>
> Narrate-only is **not** dead. It is still the architecture of the offline pack
> ([ADR-0008](0008-offline-first-narration.md)), because a device with no connection has
> no tools to call — see `app/analytics/bundles.py`, which is this design, preserved
> where it is still the right one.

## Context

Our research brief set the design rule on day four: *"the numbers are calculated by
code; the AI only writes the sentence."* The customer survey then validated it —
61.9% of respondents named "it might give me wrong or made-up information" as their
top concern, the single largest answer. That makes hallucination prevention the
centre of the pitch rather than a technical footnote.

Sprint 2 runs a **local model** on laptop hardware. Two consequences:

1. Small models are measurably weaker at **tool selection** — choosing which function
   to call, with which arguments — than at generating prose. They pick the wrong
   function, invent parameters, or emit malformed JSON.
2. Every token costs latency on local hardware, and the voice path has a budget of
   roughly two seconds to first audio.

## Options considered

**A. Model-driven tool calling.** The model reads the question, selects analytics
functions, calls them, and narrates the result. Standard agent design, and what we
would do on a frontier model.

**B. Python-driven routing, model narrates only.** Python maps the question to one of
a fixed set of intents, runs the matching analytics, and hands the model a bundle of
computed facts with one instruction: write the sentence.

**C. Hybrid** — Python for known intents, model tool-calling as a fallback.

## Decision

**Option B.** Four layers:

| Layer | Owner | Responsibility |
|---|---|---|
| 0 | Python | Intent routing — map free text to one of ~8 intents |
| 1 | Python | Deterministic analytics — return typed facts |
| 2 | Model | Narration — turn those facts into 2–4 sentences |
| 3 | Python | Verification — every figure must trace to a fact |

The model never chooses what to compute and never sees a raw meter reading. It
receives a `FactBundle` and writes prose.

## Consequences

**Accepted:**

- The agent cannot answer a question we did not anticipate. It routes to
  out-of-scope and offers a human. For a demo with a scripted path this is the right
  trade, and *"we hand off rather than guess"* answers a judge better than a
  confident wrong answer does.
- Adding an intent means four changes, not one: router rule, analytics path,
  narration prompt, golden-set cases.

**Gained:**

- Layers 0, 1 and 3 are fully testable with **no model running**, so most of the team
  can work while inference is still being set up.
- Every routing mistake is a Python bug with a stack trace, not a prompt to tune.
- A 3–4B model becomes sufficient rather than a compromise — which is what makes the
  local demo viable on the available hardware at all.
- Latency drops: one generation call per turn, no tool round-trips.

## Notes

This is not only a workaround for weak hardware. Even on a frontier model the
determinism and testability would be worth keeping — headroom is a reason to test a
larger narrator, not a reason to hand the model a harder job. Revisit **C** in Sprint 3
if out-of-scope routing proves too blunt in real use.

Related: [ADR-0004](0004-llm-provider-interface.md) keeps the model swappable.
