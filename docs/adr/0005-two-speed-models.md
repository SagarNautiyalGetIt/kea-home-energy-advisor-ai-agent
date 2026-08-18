# ADR-0005 — A second "fast" model is the wrong tool here

**Date:** 2026-08-18 · **Status:** Accepted · **Owner:** Akash

## Context

A pattern in conversational AI pairs a **fast model** that keeps the user engaged with a
**slower, stronger model** doing the real work. It is a good pattern, and a phone channel
is exactly where you would expect to want it — silence on a call is expensive.

The question was whether to adopt it for our voice path.

## Where our time actually goes

Measured on the MacBook Pro M4 Pro with `qwen3:4b`, 18 Aug 2026:

| Stage | Cost | Who pays it |
|---|---|---|
| Speech → text | ~400 ms | whisper.cpp |
| Layer 0 routing | ~0 ms | Python regex |
| Layer 1 analytics | ~1 ms | arithmetic over 31 numbers |
| **Layer 2 narration** | **~1 s** | **the model — effectively the whole delay** |
| Layer 3 verification | ~1 ms | Python regex |
| Text → speech | ~200 ms | Piper |

**There is no slow reasoning step for a second model to take over.** ADR-0002 already moved
the reasoning out of the model — layer 1 is arithmetic, and it finishes in about a
millisecond. The fast/slow split solves a problem we designed away.

## Decision

**Adopt the shape, not the second model.** Because layer 0 identifies the intent in roughly
zero milliseconds, we can play a **pre-written, pre-synthesised acknowledgement immediately**
— *"Let me pull up your July usage"* — cached as audio, played the moment routing completes,
before any model runs at all.

Three reasons this beats a fast model for our case:

1. **Faster.** No inference at all versus a model's own time-to-first-word.
2. **Cannot fabricate.** The acknowledgement contains no figures, so it can't say a number
   layer 3 never approved. A fast model producing free text on a call could.
3. **No memory contention.** On shared unified memory a second model competes for the
   bandwidth that sets the main model's speed — it could make the real answer arrive *later*.
   Token generation here is bandwidth-bound, so this is a real effect, not a theoretical one.

## When a second model would earn its place

Recorded so this isn't read as a blanket no:

- **Barge-in.** If the caller interrupts, something must decide instantly whether that was a
  new question or just "mm-hm". Genuine classification under hard latency — a real fast-model
  job. Sprint 3.
- **Two-tier narration.** A 4B for simple intents, a larger model for messy ones. Worth
  testing — but it belongs in the Day 6 bake-off, measured against the golden set, not
  assumed now.
- **Open-ended questions.** If we ever let the agent handle things layer 0 doesn't recognise,
  a slower reasoning model becomes the right tool. That is a deliberate architecture change,
  not an optimisation.

## Consequences

- One extra build step: synthesise ~8 acknowledgement clips (one per intent) with Piper and
  ship them as assets. Day 8 work, an hour at most.
- The acknowledgement must stay generic. *"Let me pull up your July usage"* is safe;
  *"Let me check that spike"* is a claim, and claims belong downstream of layer 3.
- Revisit this ADR if we adopt barge-in, or if the bake-off shows a large model is needed for
  quality and its first-word latency becomes the problem.
