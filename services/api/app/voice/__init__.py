"""Voice — a transport skin over the identical pipeline (ADR-0003).

    mic -> VAD -> STT -> [ layer 0 -> 1 -> 2 -> 3, unchanged ] -> TTS -> speaker

Nothing in this package computes a figure, chooses what to compute, or writes prose.
It turns sound into a string, hands that string to `app.pipeline`, and turns the
verified answer back into sound.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.voice.stt import SpeechToText
from app.voice.tts import TextToSpeech


@lru_cache(maxsize=1)
def get_stt() -> SpeechToText:
    return SpeechToText(binary=settings.whisper_bin, model=settings.whisper_model)


@lru_cache(maxsize=1)
def get_tts() -> TextToSpeech:
    """Cached because it holds the synthesised-acknowledgement cache.

    A fresh TextToSpeech per connection would re-synthesise every acknowledgement on
    the first turn of every call, which is precisely the latency the cache exists to
    remove.
    """
    return TextToSpeech(binary=settings.piper_bin, voice=settings.piper_voice)


def status() -> dict[str, object]:
    """What `/api/health` reports. Cheap — no subprocesses, just path checks."""
    stt, tts = get_stt(), get_tts()
    return {
        "enabled": settings.voice_enabled,
        "stt": stt.describe(),
        "tts": tts.describe(),
        "ready": settings.voice_enabled and stt.available and tts.available,
    }


__all__ = ["get_stt", "get_tts", "status"]
