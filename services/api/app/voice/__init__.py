"""Voice — a transport skin over the identical pipeline (ADR-0003).

    mic -> VAD -> STT -> [ the agent, unchanged ] -> TTS -> speaker

Nothing in this package computes a figure, chooses what to look up, or writes prose. It
turns sound into a string, hands that string to `app.pipeline`, and turns the answer back
into sound.

## Choosing a transcriber

Two, selected by `KEA_STT_ENGINE`:

* **gemini** (default) — one HTTPS round trip on the key the assistant already uses.
* **whisper** — the local `whisper.cpp` binary from `ml/voice/setup.sh`.

The default moved to Gemini because the local path was the reason voice was slow and
sometimes silent. ADR-0003 picked whisper.cpp for an M4 Pro, where it runs on Metal; on
any machine without that it is a 548 MB model on four CPU threads, which is seconds per
utterance and occasionally past the 30 s timeout — and a timeout ends the turn with an
error rather than an answer. The model was never the problem: `KEA_PROVIDER=gcp` has
applied to voice all along, because voice and chat call the same `answer()`.

`auto` keeps the old behaviour of preferring whatever is actually installed, which is
what a machine with a working Metal build wants.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.voice.stt import SpeechToText
from app.voice.stt_gemini import GeminiSpeechToText
from app.voice.tts import TextToSpeech

#: What `get_stt()` returns. A Protocol would be more formal; the two classes already
#: agree on `available`, `describe()` and `transcribe()`, and `test_voice.py` asserts it.
Transcriber = SpeechToText | GeminiSpeechToText


@lru_cache(maxsize=1)
def get_stt() -> Transcriber:
    """The transcriber this deployment uses.

    Cached like the provider is: `GeminiSpeechToText` builds its SDK client lazily and
    once, and a fresh one per connection would open a new TLS connection on every call.
    """
    engine = (settings.stt_engine or "gemini").strip().lower()
    whisper = SpeechToText(binary=settings.whisper_bin, model=settings.whisper_model)

    if engine == "whisper":
        return whisper
    if engine == "gemini":
        return GeminiSpeechToText(model=settings.gcp_model)

    # `auto` — prefer the local binary when it is genuinely installed, because a machine
    # that went to the trouble of building it is usually one where it is fast. Fall back
    # to Gemini rather than to nothing, so a fresh clone has working voice without a
    # 548 MB download.
    return whisper if whisper.available else GeminiSpeechToText(model=settings.gcp_model)


@lru_cache(maxsize=1)
def get_tts() -> TextToSpeech:
    """Cached because it holds the synthesised-acknowledgement cache.

    A fresh TextToSpeech per connection would re-synthesise every acknowledgement on
    the first turn of every call, which is precisely the latency the cache exists to
    remove.

    Still Piper, deliberately. It is 61 MB, answers in tens of milliseconds, and is the
    half of the loop that was never slow — moving it to a hosted service would add a
    round trip to buy nothing.
    """
    return TextToSpeech(binary=settings.piper_bin, voice=settings.piper_voice)


def status() -> dict[str, object]:
    """What `/api/health` reports. Cheap — no subprocesses and no API calls, just path
    and credential checks, because this is read on every page load."""
    from app.config import dotenv_overrides

    stt, tts = get_stt(), get_tts()
    out: dict[str, object] = {
        "enabled": settings.voice_enabled,
        "stt": stt.describe(),
        "tts": tts.describe(),
        "ready": settings.voice_enabled and stt.available and tts.available,
    }

    # Why it is off, when `.env` says it should be on. Without this the two facts
    # available from outside are "/health says disabled" and "my .env says 1", and
    # nothing connects them — the socket opens, closes with the reason, and the browser
    # shows a failed connection. Same disclosure rule as `recording` and `preferences`
    # on the health payload: a degraded state must say which degradation it is.
    if not settings.voice_enabled and "KEA_VOICE_ENABLED" in dotenv_overrides():
        out["disabled_reason"] = (
            "KEA_VOICE_ENABLED is set to 0 in this process's environment, which "
            "overrides the 1 in .env. Unset it in the shell or launcher that starts "
            "the API — editing .env cannot win against an exported variable."
        )
    return out


__all__ = ["Transcriber", "get_stt", "get_tts", "status"]
