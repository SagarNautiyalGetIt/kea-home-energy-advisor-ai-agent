# Product Requirements — Home Energy Advisor & Bill-Shock Prevention Agent

**Kea Energy · Scenario 10 · Team HAKAS · MIT Internship 2026**
Status: living document · Sprint 2 (17–28 Aug 2026) · Owner: maintainer

> Primary source for everything below: **Research Brief v2** (13 Aug 2026, Iris Vault).
> Every external figure in this document carries a source. Unsourced numbers do not
> belong in a PRD.

---

## 1. The problem

A household's power bill arrives at the end of the month, by which point every
decision that caused it has already been made. The customer cannot act on
information they do not have yet. The retailer absorbs the call.

Our measured example: on one Auckland household's July 2026 bill, **Sat 11 Jul was
exactly 2.00× every other Saturday** that month. That spike accounts for roughly
**11% of the overshoot**. The remaining ~89% is a **~2.4 kWh/day sustained rise** —
invisible day to day, and worth **$290/year against the $2.60 the spike cost**.

That asymmetry is the product thesis: *the dramatic event is not the expensive one.*
A human scanning their own usage chart finds the spike and misses the drift. A
computer finds both, in the middle of the month, while it can still be changed.

## 2. Why now — the regulatory hook

Electricity Authority **Consumer Care Obligations, Part 6, cl. 9.3(c)** names
"significant consumption changes" as a trigger for retailer duties. Enforceable
since **1 April 2025**. This moves a mid-month warning from a nice feature toward
an expectation of care.

## 3. What customers actually said

Survey of Auckland households, closed 12 Aug 2026. **n = 21, self-selected.**

| Finding | Share |
|---|---|
| "It might give me wrong or made-up information" — **top concern** | **61.9%** |
| Distrust an AI with their usage data | 47.6% |
| Want a mid-month warning | **90.5%** |
| Want it expressed in **dollars**, not kWh | 71.4% |

> **Honest limitation.** n = 21 is directional, not representative. The persona set
> defined a validation bar of 10 responses per persona; that bar was **not met**.
> This is flagged in the deck, not hidden. Do not present these as market research.

The top concern is fabrication. That single fact determines the architecture.

## 4. What we are building

A conversational agent — chat now, voice later — that answers a household's
questions about their own power usage, mid-month, in dollars, and **cannot make
a number up**.

### The architectural answer to concern #1

Four layers. The model owns exactly one.

| Layer | Owner | Responsibility |
|---|---|---|
| 0 | Python | Map free text to one of ~8 intents |
| 1 | Python | Compute typed facts from meter data |
| 2 | **Model** | Turn those facts into 2–4 sentences |
| 3 | Python | Reject any figure not traceable to layer 1 |

The model never chooses what to compute and never sees a raw meter reading.
Tool *selection* is the hardest task for a small local model, so we removed it
entirely ([ADR-0002](adr/0002-narrate-only-architecture.md)).

**Voice is a transport skin over the identical pipeline, never a second brain**
([ADR-0003](adr/0003-voice-transport-skin.md)). Requirement: voice cannot produce
an answer chat would not.

## 5. Goals

| # | Goal | How it is measured |
|---|---|---|
| G1 | The agent never states an unverifiable figure | Golden set in CI → *"N prompts, 0 fabricated figures"* |
| G2 | Warn mid-month, while it is still actionable | Month-end projection from partial-month readings |
| G3 | Answer in dollars | Every customer-facing figure carries a `$` where meaningful |
| G4 | Separate sustained drift from one-off spikes | Overshoot attribution in `app/analytics/` |
| G5 | Never counsel a household in financial distress | Hardship intent outranks all others → human handoff |
| G6 | Show the customer what we can see | Data-transparency panel — answers the 47.6% |
| G7 | Run on a laptop, prove it runs in the cloud | Ollama local now; `BedrockProvider` seam written and unused |

## 6. Non-goals for this sprint

- Appliance-level identification. NILM does not work at 30-minute resolution — established in feasibility research, not assumed.
- Real customer accounts, real billing integration, or production auth.
- A mobile app.
- Model fine-tuning. We ship the **smallest model that passes the golden set**.

## 7. Users

Six personas were drafted; the validation bar was not met at n=21. Treated as
design aids, not evidence. The demo speaks to three situations:

1. **Bill shock, already happened** — "why was my bill so high?"
2. **Bill shock, preventable** — mid-month, projection says you are heading over.
3. **Hardship** — usage collapse pattern; the correct response is a human, not advice.

## 8. Requirements

### Must have — Sprint 2

| ID | Requirement |
|---|---|
| R1 | Answer the ~8 intents in `app/routing/intents.py` |
| R2 | Every figure verified by layer 3 before it reaches the customer |
| R3 | Provider failure degrades to a deterministic template, never a 500 |
| R4 | Persist turn, fact bundle, verification and token usage from the first real conversation |
| R5 | Month-end projection from partial-month data |
| R6 | Overshoot attribution: standing load vs spike |
| R7 | Hardship signal → escalation, never advice |
| R8 | Runs on a second teammate's machine via `docker compose up` |
| R9 | Five demo households, each demonstrating exactly one finding |

### Should have

| ID | Requirement |
|---|---|
| R10 | Weather normalisation (heating degree days, 18 °C baseline) — depends on the NIWA data source resolving |
| R11 | Low Fixed Charge modelling — ranked #1 of five jobs in the brief; needs no new data |
| R12 | Year-on-year comparison |
| R13 | Voice: VAD + STT + sentence-streamed TTS over the same pipeline |
| R14 | Rejection-log view — the verification log is evidence, not debug output |

### Could have
Cost projection against published Bedrock rates (labelled a projection, with the pricing page cited); latency percentiles reported honestly against the ADR-0003 budget.

### Won't have this sprint
Appliance disaggregation · real billing integration · production authentication · fine-tuning.

## 9. Success criteria for the sprint review

- [ ] The demo runs cold, twice, on the demo machine (M4 Pro, 48 GB)
- [ ] Golden set runs in CI and reports **0 fabricated figures**
- [ ] The July household reproduces the published figures **through the real pipeline**, not a fixture
- [ ] A second person can run the whole thing from a clean checkout
- [ ] Every headline number in the pitch traces to a source or to a computation
- [ ] A fallback video exists — live demos fail, and a video that plays beats an apology

## 10. Key risks

| Risk | Mitigation |
|---|---|
| Small local model still fabricates | Layer 3 rejects it; template fallback; measured by the golden set |
| Weather data source unavailable (CliFlo → DataHub migration) | 2-hour timeboxed spike. If unresolved, weather normalisation moves to Sprint 3 **and is said out loud** |
| Voice latency does not land | Feature-flagged; dark-launch rather than a broken demo |
| `getUserMedia` fails silently on a plain-IP LAN address | Test early, not on demo day; demo from host or use `mkcert` |
| Spike-detection method changes a headline number | Open team decision: published method → 10.9%, generic 1.5× detector → 16.4%. Looser is arguably better analysis and weaker rhetoric |
| n=21 presented as representative | Stated as a limitation in the deck, every time |

## 11. Open decisions

| Question | Owner | Needed by |
|---|---|---|
| Spike-detection method | Team | Before analytics depth work |
| Final 7-line demo script | Team | Everything downstream derives from it |
| §5 brief amendment (voice-as-feature vs voice-as-call-deflection) | Brief owner | Before the pitch |

---

## Related

- [`erd.md`](erd.md) · [`api-standards.md`](api-standards.md) · [`adr/`](adr/) · [`sprints/`](sprints/) · [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
