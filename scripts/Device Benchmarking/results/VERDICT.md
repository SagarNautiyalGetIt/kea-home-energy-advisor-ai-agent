# Benchmark verdict — 18 Aug 2026

Two machines measured. Raw output beside this file.

| | Mac mini | MacBook Pro |
|---|---|---|
| Chip | Apple **M4** (10 cores) | Apple **M4 Pro** (14 cores) |
| Memory | 16 GB unified | 48 GB unified |
| macOS | 26.5.1 | 15.7.2 |

## Results

Words per second, median of three runs. **TTFW** = time to first word.

| Model | Mac mini | | MacBook Pro | | Voice-capable |
|---|---|---|---|---|---|
| | speed | TTFW | speed | TTFW | |
| `qwen3:4b` | 35.3 | **158 ms** | 77.6 | **141 ms** | both machines |
| `gemma3:4b` | 36.8 | 379 ms | 78.9 | 322 ms | both machines |
| `gemma3:12b` | 11.6 | 726 ms | 28.1 | 450 ms | **MacBook Pro only** |

## What this settles

**The MacBook Pro M4 Pro is the demo machine.** It is **2.15×** faster than the mini on
the same 4B model and **2.42×** on the 12B — almost exactly what the bandwidth model
predicted (an M4 Pro moves roughly twice the data per second of a base M4). The
prediction held, so we can trust the same reasoning for future sizing.

**The Mac mini is a real backup, not a theoretical one** — as long as we ship a 4B model.
Both 4B candidates clear the 20 words/sec voice threshold on it comfortably. Only the
12B fails there, which is exactly the ceiling 16 GB predicts.

**Voice is comfortably viable.** Worked through with measured numbers, on the MacBook Pro
with `qwen3:4b`:

```
VAD turn detection      ~100 ms
whisper.cpp STT         ~400 ms
model time to first word 141 ms
first sentence (~15 w)  ~193 ms
Piper speaks            ~200 ms
                        ────────
first audio out         ~1.0 s   (target was under 2 s)
```

Even the 12B lands at ~1.7 s on the MacBook Pro. The latency budget in ADR-0003 is not
the constraint we feared — **model quality, not speed, is now the thing to optimise.**

## The finding worth acting on

**`qwen3:4b` reaches its first word in less than half the time of `gemma3:4b`** — 141 ms
vs 322 ms — at essentially identical throughput. That gap is consistent across both
machines, so it is a property of the model, not noise.

For a phone channel this matters more than raw speed. A caller forgives a slow answer far
more readily than a long silence, and time-to-first-word is what they actually experience.
Measuring TTFW separately from throughput is what surfaced this; a benchmark reporting
only words/sec would have called these two models equivalent.

## Decisions

| | |
|---|---|
| **Demo machine** | MacBook Pro M4 Pro / 48 GB |
| **Backup** | Mac mini M4 / 16 GB — 4B models only |
| **Primary model candidate** | `qwen3:4b`, on the TTFW advantage |
| **Quality ceiling to test** | `gemma3:12b`, MacBook Pro only |

⚠️ **These are speed decisions, not quality decisions.** Nothing here says the answers are
any good. The Day 6 bake-off (KEA-47) tests all three against the golden set, and the rule
stands: **ship the smallest model that passes.** If `qwen3:4b` passes, its head start on
first-word latency makes it the obvious choice. If it doesn't, the MacBook Pro has the
headroom to go bigger without breaking the voice budget.

`qwen3` also carries an Apache-2.0 licence against Gemma's custom terms — a shorter answer
if a judge asks whether Kea could actually deploy this.
