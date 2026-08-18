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
| 2026-08-17 | Ported the 31 measured July values into `tests/data/july_2026_daily.json` | Ran `measure-july-chart.py` from the Iris Vault; the analytics are now validated against real data instead of shaped fixtures |
| 2026-08-17 | `COMPARISON_BASELINE = 7.06 kWh/day` | Derived from Genesis's own "37% more than similar homes": 300.0 kWh / 1.37 / 31. External benchmark, never derived from the household |
| 2026-08-17 | Renamed the headline fact to `overshoot_annual_cost` | The published $290/yr is the **whole overshoot** annualised (81 kWh/mo x $0.30 x 12), not the sustained portion alone — see research/analysis.md line 83 |
| 2026-08-17 | `SPIKE_THRESHOLD = 1.8` | **Open question, not settled.** 1.8x reproduces the published method (11 Jul alone, 10.4%, $2.52). 1.5x also flags Fri 10 Jul and the spike share jumps to 16.4%. The looser detector is arguably more correct but weakens "the spike is only 11%". Team must decide which method we defend |
| 2026-08-18 | Two-speed models: adopt the shape, skip the second model | The fast/slow pattern assumes a slow reasoning step to hide. ADR-0002 already moved reasoning out of the model — layer 1 is arithmetic and runs in ~1 ms — so the only delay is narration. Layer 0 knows the intent in ~0 ms, so a pre-synthesised acknowledgement is faster than any model, cannot fabricate, and loads no second set of weights competing for the same memory bandwidth. Revisit for barge-in (Sprint 3) |
| 2026-08-18 | Demo machine = MacBook Pro M4 Pro / 48 GB | Benchmarked both Macs: 2.15× the mini on 4B models, 2.42× on 12B. Mac mini is a genuine backup provided we ship a 4B model |
| 2026-08-18 | Primary model candidate = `qwen3:4b` | 141 ms to first word vs 322 ms for `gemma3:4b` at identical throughput, consistent across both machines. For a phone channel, first-word latency beats raw speed. Apache-2.0 licence is a bonus. **Speed decision only** — Day 6 golden set decides quality |
| 2026-08-18 | PostgreSQL, not SQLite (ADR-0006) | Time-series data, `numeric` for money (float drift is the one bug this product cannot survive), `timestamptz` for NZ daylight saving, and a connection-string path to RDS |
| 2026-08-18 | Local git only — never push this repo anywhere | Standing instruction from Akash. The internship is competitive (other teams bid for the same scenario) and the vaults hold client-adjacent and personal material. `.github/workflows/ci.yml` stays as a file but only runs if pushed, which won't happen. Verified: no remote configured on any vault or repo |
| 2026-08-18 | Illustrative Low Fixed Charge rate 0.34 → 0.36 /kWh | At 0.34 the break-even sat at 30 kWh/day, so LFC looked cheaper for almost every household — the tariff advice would have been wrong for most of the demo. 0.36 puts break-even at 20 kWh/day, matching NZ's LFC regulation (~8,000 kWh/yr). Pinned by a test |
| 2026-08-18 | Demo households defined once, in `app/analytics/fixtures.py` | They had been defined twice — the API served H-A..H-E while the seeder wrote H-JUL..H-TARIFF, so every chat request 404'd. `seed.py` now imports the definition |
