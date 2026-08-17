# ADR-0003 — Voice is a transport skin, not a second brain

**Date:** 2026-08-17 · **Status:** Accepted · **Owner:** Akash

## Context

The Kea scenario brief gives us the target: **900+ bill-query calls a week, 12–15
minutes each, ≈200 agent-hours**. Voice is not a novelty interaction — it is the
channel those calls already arrive on, and deflecting them is the business case.

A distinction our own Research Brief v2 forces us to be careful about:

- **§5** ends with *"one thing to stop: voice and speech-recognition design. We have
  no evidence anybody wants it, and two of nine responses is not a mandate."*
- **§6** says our survey respondents mostly do not call — they open the app or shrug —
  and that *"the callers are a group we did not reach."*

So the survey's 2-of-9 result is evidence about **voice as an app feature**, and says
nothing about **voice as call deflection**, because it never sampled callers. Those
are different claims with different evidence bases.

> **Action outstanding:** Brief §5 must be amended to draw that distinction, or we
> argue against our own document in the room. Owner: whoever holds the brief.

## Decision

Voice reuses the **identical** pipeline:

```
mic → VAD → STT → [ layer 0 → 1 → 2 → 3 — unchanged ] → TTS → speaker
```

Text in the middle, always. A speech-to-speech model would bypass layer 3 and could
speak a dollar figure nobody computed — which loses the exact thing the pitch is
built on.

| Stage | Choice | Why |
|---|---|---|
| Turn detection | Silero VAD | MIT, CPU, ~1 MB |
| Speech → text | **whisper.cpp** | Metal/Core ML on Apple Silicon. `faster-whisper`'s CTranslate2 backend is CPU-only on ARM Macs — several hundred ms per turn |
| Text → speech | Piper | MIT, fast on CPU, offline. **Must stream sentence-by-sentence** |
| Transport | WebSocket + MediaRecorder | Browser-native, no extra infra |

## Latency budget

VAD ~100 ms + STT ~400 ms + first model sentence ~1–2 s + Piper ~200 ms.
**Target: under 2 s to first audio.** Past ~3 s a caller talks over it.

Sentence-streamed TTS is the load-bearing optimisation: speaking sentence one while
generating sentence two turns a six-second wait into ~1.5 s of perceived latency.

## Consequences

- Voice can never say something chat wouldn't. That is the point.
- Cost is ~1.5 days rather than ~5, because the middle already exists.
- **Browser mic requires a secure context.** `localhost` qualifies; `http://192.168.x.x`
  does not, and `getUserMedia` fails silently. Either demo from the host machine or
  issue a local cert with `mkcert`. Test this on Day 8, not Day 10.
