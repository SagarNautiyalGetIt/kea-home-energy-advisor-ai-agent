# Sprint 1 — research and the pitch

**Completed before this repo existed** (16 Aug 2026). Sprint 1 produced research and
decks, not code, so its artefacts live in the other two homes of this project.

| Artefact | Where |
|---|---|
| **Research Brief v2** (13 Aug) — the primary source document | `~/Documents/Kea-Energy-Research-Brief.docx` |
| Customer survey — 21 responses, closed 12 Aug | `~/Documents/Iris Vault/MIT Internship/kea-energy/research/survey/` |
| July 2026 bill analysis + the measurement script | `~/Documents/Iris Vault/MIT Internship/kea-energy/research/` |
| Personas (6, validation bar not met at n=21) | `~/Documents/Iris Vault/MIT Internship/kea-energy/research/user-personas.md` |
| Pitch deck (7 Aug, 12 slides) and Sprint 1 review deck (22 slides) | `~/Documents/Friday/Coding/mit-deck-build/kea-energy/deck/` |

## What sprint 1 handed to sprint 2

Five things this build depends on, all traceable to the brief:

1. **The design rule** — *"the numbers are calculated by code; the AI only writes the
   sentence."* Set on day four, then validated: **61.9%** of respondents named made-up
   information as their top concern.
2. **The headline finding** — Sat 11 July exactly **2.00×** the other Saturdays; the spike
   explains ~11% of the overshoot; the quiet remainder costs **$290/yr against $2.60**.
   Now locked in as a regression test (`tests/test_analytics_july.py`).
3. **The regulatory position** — Consumer Care Obligations cl. 9.3(c). Drives the hardship
   escalation path.
4. **What customers asked for** — dollars not kilowatt-hours (71.4%), a mid-month warning
   (90.5%), and no AI touching their data without trust (47.6% concern).
5. **The honest refusals** — half-hourly data cannot identify appliances. Encoded as a
   caveat on every `FactBundle`.

## Carry-over into sprint 2

- **Brief §5 needs amending** — it says to stop voice work, on evidence about voice-as-app-
  feature. Voice-as-call-deflection is a different claim with a different source. Draft:
  [`../sprint-2/brief-amendment-voice.md`](../sprint-2/brief-amendment-voice.md)
- **Scenario numbering unresolved** — brief text said "Scenario 10", the deck says 9.
