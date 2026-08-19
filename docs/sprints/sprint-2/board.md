# Sprint 2 board — draft cards

Copy-paste into whatever the team uses. **Sprint 2: Mon 17 Aug → Fri 28 Aug 2026.**
Feature milestone (chat + voice) **Wed 26 Aug**.

> [!note] Scope of this file
> Backend + AI only (Akash). Frontend, deck and research cards belong to their owners.
> The Sprint 1 column is **reconstructed from the artefacts** — the brief, the vault and the
> repos — not copied from the real board. Correct it against what was actually tracked.

> [!warning] Card IDs were renumbered on 18 Aug 2026 — four of them collided
> **KEA-35, 36, 37 and 38 each named two different cards.** The worst was KEA-38, which was
> simultaneously *"ADR-0006 — PostgreSQL"* in the ✅ done list and *"Weather normalisation"* in
> Day 4's to-do — one ID both finished and not started. If any of these were copied into a real
> tracker before today, **check that tracker**: the Day 3 and Day 4 blocks were the ones moved.
>
> | Was | Now | Card |
> |---|---|---|
> | KEA-35 | **KEA-64** | End-to-end path with a real model (Day 3) |
> | KEA-36 | **KEA-65** | Verify on the second machine (Day 3) |
> | KEA-37 | **KEA-66** | Model warm-up + UI ready state (Day 3) |
> | KEA-38 | **KEA-67** | Weather normalisation (Day 4) |
> | KEA-39 | **KEA-68** | Low Fixed Charge modelling (Day 4) |
> | KEA-40 | **KEA-69** | Year-on-year comparison (Day 4) |
> | KEA-41 | **KEA-70** | Hardship detection signals (Day 4) |
>
> 39–41 moved too, only to keep the Day 4 block contiguous. Kept: KEA-35/36/37 as the Day 2
> cards and KEA-38 as ADR-0006, because those are referenced elsewhere and partly done.

Sizes: **S** ≤ 2h · **M** ≤ half a day · **L** ≈ a day · **XL** > a day, split it.

---

## ✅ DONE — Sprint 1 (carry-in, before 17 Aug)

| ID | Card | Description |
|---|---|---|
| S1-01 | Design and run the customer survey | Google Form, closed 12 Aug, **21 responses**, self-selected Auckland households |
| S1-02 | Analyse survey results | Headline: **61.9%** fear fabrication (top concern), 47.6% distrust AI with usage data, 90.5% want a mid-month warning, 71.4% want it in dollars |
| S1-03 | Measure the July 2026 Genesis bill | `measure-july-chart.py` — 31 daily values read off the published chart, ±0.2 kWh/day |
| S1-04 | Derive the headline finding | Sat 11 Jul exactly **2.00×** the other Saturdays; spike ≈11% of the overshoot; ~2.4 kWh/day sustained; **$290/yr vs $2.60** |
| S1-05 | Research the regulatory position | EA Consumer Care Obligations Part 6, **cl. 9.3(c)** names "significant consumption changes" as a trigger for retailer duties — enforceable since 1 Apr 2025 |
| S1-06 | Answer the six feasibility questions | NILM can't identify appliances at 30-min data; weather normalisation via NIWA; Opower effect size **1.4–3.3%** |
| S1-07 | Draft the persona set | Six personas; validation bar of 10 responses each **not met** at n=21 — flagged, not hidden |
| S1-08 | Build the pitch deck | 7 Aug, 12 slides, four speakers — `mit-deck-build/kea-energy/deck/build/deck.js` |
| S1-09 | Build the Sprint 1 review deck | 22 slides, dark problem arc opening to light at the UVP slide |
| S1-10 | Publish Research Brief v2 | 13 Aug — the primary source document for everything downstream |
| S1-11 | Split the project across both vaults | 13 Aug — code to Friday, research and artefacts of record to the Iris Vault |
| S1-12 | Decide the frontend stack | React + TypeScript + Tailwind (team decision) |

---

## ✅ DONE — today, Day 1 (Mon 17 Aug)

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-01 | ADR-0001 — backend framework | S | **FastAPI**, not Django/Flask. Streaming, Pydantic doing triple duty, OpenAPI for the frontend |
| KEA-02 | ADR-0002 — AI architecture | M | **The model narrates; Python decides.** Four layers; tool selection removed from the model entirely |
| KEA-03 | ADR-0003 — voice scope | S | Voice is a transport skin over the identical pipeline, never a second brain |
| KEA-04 | ADR-0004 — provider seam | S | One `LLMProvider` Protocol. Ollama now, Bedrock Sprint 3 |
| KEA-05 | Create the repo | S | `Friday/Coding/kea-agent/`, git init, `pyproject.toml`, `Makefile`, `.gitignore` |
| KEA-06 | CI from the first commit | S | GitHub Actions running `ruff` + `pytest` on every push and PR |
| KEA-07 | Define `FactBundle` and schemas | M | The spine every layer speaks. Carries no raw readings and no PII by design |
| KEA-08 | Layer 0 — intent router | M | 8 intents, pure Python. Hardship outranks everything. **15 tests** |
| KEA-09 | Layer 3 — number-checker | L | Unit-bearing tokens must match a computed fact; structural integers exempt; template fallback. **16 tests** |
| KEA-10 | `LLMProvider` + `OllamaProvider` | M | Streaming, health check, warm-up, token capture for the cost projection |
| KEA-11 | `BedrockProvider` stub | S | Written unused, **specifically to prove the seam holds** rather than assume it |
| KEA-12 | Layer 1 — analytics core | L | Standing load, spike detection, overshoot attribution, month-end projection |
| KEA-13 | Fixture API + 5 demo households | M | Each household demos exactly one finding. **Works with no model installed** |
| KEA-14 | Graceful degradation | S | Provider failure falls back to the deterministic template instead of a 500 |
| KEA-15 | Port the real July measurements | M | Ran `measure-july-chart.py`; 31 values into `tests/data/`. Analytics now validated against measured data. **9 tests** |
| KEA-16 | Generate `openapi.json` | S | 5 paths, 8 schemas — `make spec` |
| KEA-17 | Draft the §5 brief amendment | M | Separates voice-as-app-feature (unfunded) from voice-as-call-deflection (funded by 900 calls/week) |
| KEA-18 | Demo script template | S | 7 proposed lines, each mapped to a household and a conclusion |
| KEA-19 | Decision log | S | Eight non-obvious calls recorded with reasons |
| KEA-20 | Document in Obsidian | M | `Projects/kea-agent.md` + Friday Index + Changelog — cold-session handoff |

**End of day: 40 tests passing, lint clean, 3 commits.**

---

## ✅ DONE — early today (Tue 18 Aug, before standup)

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-28 | ADR-0005 — the two-speed question | M | Evaluated a fast-model / slow-model split for the voice channel. **Outcome: adopt the shape, skip the second model.** Layer 0 knows the intent in ~0 ms, so a pre-synthesised acknowledgement is faster, can't fabricate, and loads no competing weights |
| KEA-29 | Architecture diagrams | M | AI pipeline + backend ER model, published for the team |
| KEA-21 | ✅ Benchmark both Macs | S | **Done 18 Aug.** MacBook Pro M4 Pro is the demo machine (2.15× the mini). Voice viable at ~1.0 s to first audio. Results + verdict in `scripts/Device Benchmarking/results/` |
| KEA-22 | ✅ Confirm the M4 variant | S | **M4 Pro**, 48 GB, 14 cores — confirmed by the benchmark |
| KEA-38 | ADR-0006 — PostgreSQL from Sprint 2 | M | Reversed the SQLite call. Time-series data, exact decimals for money, and a one-line path to RDS |
| KEA-30 | Shareable Mac benchmark script | M | `scripts/Device Benchmarking/` — standalone, needs nothing from the repo. Detects chip/memory, runs 3 models × 3 runs, reports words/sec and time-to-first-word, writes a results file to send back |

---

## 🔴 CARRIED OVER — from Day 1, still open

Blocked on other people or other machines. None of it is code.

| ID | Card | Size | Description | Blocked on |
|---|---|---|---|---|
| KEA-23 | Hand `openapi.json` to the frontend | S | They run `npx openapi-typescript`. **Unblocks four people** — do it first | Nothing |
| KEA-24 | Circulate the four ADRs | S | Get agreement, or get the disagreement early | Team |
| KEA-25 | Confirm the 7-line demo script | M | Everything downstream derives from it — intents, seeding, golden set | Team |
| KEA-26 | 🔺 Decide the spike-detection method | M | **Moves a headline number.** Published method → 10.9%; generic 1.5× detector also flags Fri 10 Jul → **16.4%**. Looser is arguably better analysis and weaker rhetoric | Team |
| KEA-27 | Apply the §5 brief amendment | S | Draft is written; the brief's owner makes the edit | Brief owner |

---

## 🟡 IN PROGRESS / TO DO — today (Tue 18 Aug, Day 2)

The theme is **replace the placeholders with real data.** Right now five households are
hand-shaped numbers in a Python file; by tonight they should be a real database.

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-31 | Implement the data model | L | Build the schema from the ER diagram: customer, meter, reading, tariff, benchmark, weather_day, conversation, turn, fact_bundle, verification, token_usage, escalation. **AC:** `alembic upgrade head` builds it from empty |
| KEA-32 | Half-hourly data generator | L | 5 households × 31 days × 48 readings. Each shaped to demo one finding. **AC:** the July household reproduces the published figures through the real pipeline, not just the fixture |
| KEA-33 | Migrate fixtures → database | M | Swap `app/analytics/fixtures.py` for repository queries. **AC:** all 40 tests still pass |
| KEA-34 | Map each household to a demo line | S | A finding with no household can't be demoed; a household serving no line is data nobody sees |
| KEA-35 | Bind session → `customer_id` | S | Fake auth is fine; the binding must exist now. Retrofitting identity is painful |
| KEA-36 | Persist turns + verification + tokens | M | Start writing the evidence tables from the first real conversation. **This is the cost projection and the "0 fabricated figures" claim** — it doesn't exist retroactively |
| KEA-37 | `docker-compose.yml` for the app | M | Ollama stays **native** — Docker on macOS has no Apple GPU access |

---

## 📋 TO DO — rest of Sprint 2

### Day 3 — Wed 19 Aug · walking skeleton

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-64 | End-to-end path with a real model | L | React → `/chat/stream` → Ollama → streamed tokens. Ugly is fine; it only has to prove the wiring |
| KEA-65 | Verify on the second machine | M | `docker compose up` on the Mac mini. **Two people must be able to run the demo** |
| KEA-66 | Model warm-up + UI ready state | S | Cold start is several GB from disk; 10s of silence reads as a crash |

### Day 4 — Thu 20 Aug · analytics depth

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-67 | Weather normalisation | L | Heating degree days, 18 °C baseline. Depends on KEA-42 |
| KEA-68 | Low Fixed Charge modelling | M | Brief ranks this job #1 of five — needs no new data and produces a dated, personal, sourced prediction |
| KEA-69 | Year-on-year comparison | M | Serves the `compare_to_last_year` intent |
| KEA-70 | Hardship detection signals | M | Usage collapse pattern. Feeds KEA-48 |

### Day 5 — Fri 21 Aug · routing + narration

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-42 | 🕐 NIWA spike — **timebox 2h** | S | CliFlo is being retired for DataHub. Establish which is live and whether a free key arrives in time. **If not, weather normalisation moves to Sprint 3 and is said out loud** |
| KEA-43 | Per-intent narration prompts | L | Few-shot examples per intent — small models follow worked examples far better than rules |
| KEA-44 | Router hardening | M | Log every routing decision; add cases the demo script exposes |
| KEA-45 | Team demo | S | End of week. Even if it's ugly |

### Day 6 — Mon 24 Aug · evidence

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-46 | Build the golden set | L | 30–50 question/expected-fact pairs across 5 households, including adversarial ones |
| KEA-47 | Model bake-off | M | 4B / 12B / optional 27B against the golden set. **Rule: ship the smallest model that passes** |
| KEA-48 | Rejection log view | M | The verification log is the evidence, not debug output. Needed for demo line 6 |

### Day 7 — Tue 25 Aug · compliance + trust

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-49 | Hardship → human handoff | L | CCO cl. 9.3(c). The model must never counsel someone in financial distress |
| KEA-50 | Data-transparency panel | M | Show the customer exactly what the assistant can see. Answers the 47.6% |
| KEA-51 | Degradation under load | S | Model slow or down → template. Never a stack trace, never an empty bubble |

### Day 8 — Wed 26 Aug · 🎯 MILESTONE

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-52 | Silero VAD + whisper.cpp STT | L | **whisper.cpp, not faster-whisper** — Metal/Core ML on Apple Silicon |
| KEA-53 | Piper TTS, sentence-streamed | L | Speak sentence one while generating sentence two. Without this, voice feels broken |
| KEA-54 | Voice WebSocket → same pipeline | L | Identical layers 0–3. AC: voice cannot produce an answer chat wouldn't |
| KEA-55 | ⚠️ Secure-context check | S | `getUserMedia` fails **silently** on `http://192.168.x.x`. Demo from host or use `mkcert`. **Test today, not Day 10** |
| KEA-56 | Feature-flag voice | S | Dark-launch if latency doesn't land |

### Day 9 — Thu 27 Aug · measurement

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-57 | Golden set in CI | M | Produces the headline: *N prompts, 0 fabricated figures* |
| KEA-58 | Cost projection | M | Logged tokens × published Bedrock rates. **Label it a projection, cite the pricing page** |
| KEA-59 | Latency percentiles | M | First token, full answer, voice round trip vs the ADR-0003 budget. Report honestly |

### Day 10 — Fri 28 Aug · ship

| ID | Card | Size | Description |
|---|---|---|---|
| KEA-60 | Code freeze midday | S | Only demo-blocking fixes after |
| KEA-61 | Two dry runs, cold boot | M | On the actual demo machine |
| KEA-62 | Record fallback video | S | Live demos fail; a video that plays beats an apology |
| KEA-63 | Sprint review + retro | M | Update the risk register and tech-debt register |

---

## Definition of Done — applies to every card

- Merged to main via PR with one review, CI green
- Runs on a **second** teammate's machine, not just the author's
- New analytics functions have unit tests
- Any new external figure carries a source link
- Anything cut is written into the tech-debt register with a reason

## Related

- `docs/adr/` — the six decisions
- `docs/sprints/sprint-2/demo-script.md` — the spec everything derives from
- `docs/decision-log.md` — smaller calls, dated
- `README.md` — the project map and architecture overview
