"""The whole voice loop, with no browser and no microphone.

    Piper says the question -> VAD finds the turn -> whisper transcribes it ->
    layers 0-3 answer it -> Piper speaks the answer

Run it on the demo machine before the demo:

    make voice-smoke

It writes `voice-smoke-answer.wav` so you can listen to what a caller would hear, and
reports every stage against the ADR-0003 budget. Using Piper to *produce* the question
means the test needs no recorded audio in the repo and no human in the loop — and if
the STT cannot understand our own TTS, it will not understand a caller either.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

from app.config import settings
from app.pipeline import UnknownCustomerError, plan
from app.voice import get_stt, get_tts
from app.voice.audio import SAMPLE_RATE, duration_ms, to_wav
from app.voice.session import VoiceSession
from app.voice.vad import Event, TurnDetector

QUESTION = "Why is my bill so high this month?"
CUSTOMER = "H-JUL"
OUT = Path("voice-smoke-answer.wav")

# ADR-0003. Past ~3 s a caller talks over the assistant.
BUDGET_FIRST_AUDIO_MS = 2_000.0


class CollectingTransport:
    def __init__(self) -> None:
        self.clips: list[tuple[str, bytes, int]] = []
        self._pending: dict | None = None

    async def send_json(self, payload: dict) -> None:
        if payload.get("type") == "audio":
            self._pending = payload
        elif payload.get("type") == "transcript":
            print(f"  transcript   {payload['text']!r}")
        elif payload.get("type") == "meta":
            print(f"  intent       {payload['intent']}")
        elif payload.get("type") == "answer":
            v = payload["verification"]
            print(f"  answer       {payload['text']}")
            print(f"  verified     passed={v['passed']} template={v['fell_back_to_template']}")
        elif payload.get("type") == "error":
            print(f"  ERROR        {payload['message']}")

    async def send_bytes(self, payload: bytes) -> None:
        assert self._pending is not None, "binary frame with no header"
        self.clips.append((self._pending["kind"], payload, self._pending["sample_rate"]))
        self._pending = None


def _resample_to_16k(pcm: bytes, source_rate: int) -> bytes:
    """Nearest-neighbour, which is ugly and completely adequate here.

    Piper speaks at 22.05 kHz and whisper wants 16 kHz. A real client never does this —
    the browser captures at 16 kHz directly. This exists only so the smoke test can
    feed Piper's output back into whisper without pulling in a resampling dependency.
    """
    if source_rate == SAMPLE_RATE:
        return pcm
    import array

    src = array.array("h")
    src.frombytes(pcm)
    ratio = source_rate / SAMPLE_RATE
    out = array.array(
        "h",
        (src[min(int(i * ratio), len(src) - 1)] for i in range(int(len(src) / ratio))),
    )
    return out.tobytes()


async def main() -> int:
    stt, tts = get_stt(), get_tts()

    print("voice stack")
    print(f"  enabled      {settings.voice_enabled}")
    print(f"  stt          {stt.describe()}")
    print(f"  tts          {tts.describe()}")

    if not stt.available or not tts.available:
        print("\nnot ready — run ./ml/voice/setup.sh and put its output in .env")
        return 1

    # --- 1. speak the question -------------------------------------------------
    print(f"\nspeaking the question: {QUESTION!r}")
    spoken = await tts.synthesise(QUESTION)
    print(f"  synthesised  {duration_ms(spoken.pcm, spoken.sample_rate):.0f} ms audio "
          f"in {spoken.latency_ms:.0f} ms")

    question_pcm = _resample_to_16k(spoken.pcm, spoken.sample_rate)

    # --- 2. turn detection -----------------------------------------------------
    detector = TurnDetector(silero_model_path=settings.silero_vad_model)
    print(f"  vad          {detector.detector}")
    # Trailing silence so the hangover fires and the turn actually closes.
    events = detector.push(question_pcm + b"\x00\x00" * SAMPLE_RATE)
    clips = [c for e, c in events if e is Event.SPEECH_END]
    if not clips:
        clips = [detector.flush()]
    if not clips or not clips[0]:
        print("  FAIL         VAD found no speech in Piper's own output")
        return 1
    print(f"  turn         {duration_ms(clips[0]):.0f} ms of speech detected")

    # --- 3. the full session ---------------------------------------------------
    transport = CollectingTransport()
    session = VoiceSession(transport=transport, stt=stt, tts=tts, customer_id=CUSTOMER)

    try:
        plan(CUSTOMER, QUESTION)
    except UnknownCustomerError:
        print(f"  FAIL         {CUSTOMER} is not seeded")
        return 1

    print("\nrunning the turn")
    started = time.perf_counter()
    await session.handle_utterance(clips[0])
    total = (time.perf_counter() - started) * 1000.0

    answer_clips = [(pcm, rate) for kind, pcm, rate in transport.clips if kind == "answer"]
    ack_clips = [(pcm, rate) for kind, pcm, rate in transport.clips if kind == "ack"]

    if not answer_clips:
        print("\n  FAIL         no answer audio was produced")
        return 1

    rate = answer_clips[0][1]
    answer_pcm = b"".join(pcm for pcm, _ in answer_clips)
    OUT.write_bytes(to_wav(answer_pcm, rate))

    print(f"\n  ack clips    {len(ack_clips)}")
    print(f"  answer clips {len(answer_clips)} (one per sentence)")
    print(f"  wrote        {OUT} — {duration_ms(answer_pcm, rate) / 1000:.1f} s at {rate} Hz")
    print(f"  total        {total:.0f} ms")

    # The acknowledgement is what the caller hears first, and it is the number that
    # ADR-0003's 2 s budget is actually about.
    if ack_clips:
        print(f"\n  first audio is the acknowledgement — budget {BUDGET_FIRST_AUDIO_MS:.0f} ms")
    else:
        print("\n  WARNING      no acknowledgement was spoken; the caller hears silence "
              "for the whole model time")

    print("\nlisten to it:")
    print(f"  {'afplay' if sys.platform == 'darwin' else 'aplay'} {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
