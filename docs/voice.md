# Voice — how to run it, and what it does not do

Implements KEA-52 through KEA-56 against [ADR-0003](adr/0003-voice-transport-skin.md).
Everything runs locally: whisper.cpp for speech-to-text, Piper for text-to-speech,
Silero for turn detection. No audio leaves the machine.

## Run it

```bash
./ml/voice/setup.sh          # ~630 MB: builds whisper.cpp, fetches Piper + Silero
# paste the printed KEA_* lines into .env
make api-dev
make voice-smoke             # full loop, no browser, no microphone
```

`make voice-check` reports what is present without downloading anything.

On macOS the setup script builds whisper.cpp **with Metal**, which is the whole reason
ADR-0003 picked it over faster-whisper. On Linux it builds the CPU backend.

| Piece | Default | Size |
|---|---|---|
| STT model | `ggml-large-v3-turbo-q5_0` | 547 MB |
| TTS voice | `en_GB-alba-medium` | 60 MB |
| VAD | `silero_vad.onnx` | 2.2 MB |
| Piper binary | `2023.11.14-2` | 18 MB |

`--model base.en` (141 MB) on a machine that cannot spare the RAM. `en_GB` rather than
`en_US` because this is a New Zealand retailer.

Silero needs `onnxruntime`, which is not in `pyproject.toml` — without it the turn
detector silently downgrades to an RMS energy detector. That downgrade is reported on
`/api/health` and logged at startup, deliberately, because "the demo mis-detected
turns" with nothing in the logs is a bad evening.

```bash
services/api/.venv/bin/pip install onnxruntime numpy
```

## Wired to the assistant page

Landed. `AssistantPage.tsx` renders a push-to-talk mic button from
`health.voice.ready` — not from `health.voice.enabled`, which only says somebody set
the variable. The socket opens lazily on first press rather than on mount: a WebSocket
held open for a page nobody speaks on is a microphone permission prompt the customer
never asked for.

The transcript and the answer are appended to the *same* message list a typed question
produces, carrying the same verification badge. There is deliberately no voice-only
rendering path, because that is where an unchecked figure would eventually appear.

Both the mic and the chat box run through `app.pipeline` — `plan()` then `narrate()`,
layers 0 to 3 in order — so voice cannot produce an answer chat wouldn't. The
conversation row records `channel='voice'`, which is what makes call deflection
countable rather than asserted.

## The secure-context trap (KEA-55)

`getUserMedia` does not fail loudly on an insecure origin. On `http://192.168.1.x` the
whole `navigator.mediaDevices` object is `undefined`, so the call dies with "Cannot
read properties of undefined" and reads like a bug in our code. `localhost` is a secure
context; a LAN IP is not.

**Demo from the host machine**, or put `mkcert` in front of it. `checkVoiceSupport()`
returns the specific reason rather than letting it fail silently — call it before
offering the button.

## What ADR-0003's latency budget assumes, and what is actually true

The ADR budgets **under 2 s to first audio**, built from "VAD ~100 ms + STT ~400 ms +
first model sentence ~1–2 s + Piper ~200 ms". That arithmetic assumes the model streams
into the speaker — first *sentence*, not first answer.

**It cannot, and the reason is the pitch.** Layer 3 verifies the whole answer, so no
audio can be produced until the model has finished writing and every figure has been
checked. Speaking sentence one early means speaking it before we know sentence three
did not invent a number, which is the one thing this system exists not to do.

So the real sequence is `STT + full generation + verification + TTS(sentence 1)`, and
the model term is the whole answer rather than its first sentence. Measured here on an
Intel laptop with no GPU acceleration: **47 s**. That machine is not the demo machine —
the M4 Pro benchmark (KEA-21) puts it at 2.15× the mini and voice "viable at ~1.0 s to
first audio" — but even a 5× speedup does not put a full verified answer inside 2 s.

Two things follow, and both are already built:

1. **The acknowledgement carries the gap.** ADR-0005 concluded that layer 0 knows the
   intent in ~0 ms, so a pre-synthesised acknowledgement is faster than any model and
   cannot fabricate. `meta` is emitted at ~3 ms measured, and the caller hears "Let me
   look at your usage for that period" while the model works. The eight strings live in
   `app/voice/tts.py`, contain no figures, and are the only audio a caller hears that
   layer 3 never checked — which is why they are constants in a reviewed file.
2. **Sentence-streamed TTS still pays, just less than advertised.** It overlaps
   synthesis with synthesis, not synthesis with generation: a four-sentence answer needs
   1 × TTS before the first sound instead of 4 ×.

**This needs a number on the M4 Pro before the budget in ADR-0003 is quoted anywhere.**
Run `make voice-smoke` on the demo machine and put the real figure in KEA-59. If the
honest number is 6 s, ADR-0003 needs a superseding ADR rather than a quiet edit — the
repo's rule is "disagree with one, open an ADR, not a PR", and this is a disagreement
with its arithmetic, not its decision.

## Architecture

```
mic -> AudioWorklet (16 kHz s16le) -> WebSocket -> Silero VAD -> whisper.cpp
                                                                      |
                                              app.pipeline.plan() <---+
                                                     |
                                    [ layer 0 -> 1 -> 2 -> 3 unchanged ]
                                                     |
                                    Piper <- app.pipeline.narrate()
                                      |
                                   speaker
```

`/api/chat`, `/api/chat/stream` and `/api/voice/stream` all call `app.pipeline`. There
is one function that turns a question into prose, so the channels cannot drift without
deleting that module. `test_voice.py` asserts the two channels return identical text
for the same question, and that every synthesised string is either the verified answer
or one of the reviewed acknowledgements.

The wire protocol is documented at the top of `app/voice/session.py`. Both ends change
together or not at all.

## Related

- [ADR-0003](adr/0003-voice-transport-skin.md) — voice is a transport skin
- [ADR-0005](adr/0005-two-speed-models.md) — why the acknowledgement, not a second model
- [`sprint-2/brief-amendment-voice.md`](sprints/sprint-2/brief-amendment-voice.md) —
  why we cite the scenario brief for voice and never our own survey
