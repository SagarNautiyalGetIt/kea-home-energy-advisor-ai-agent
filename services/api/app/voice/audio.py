"""PCM plumbing shared by the STT and TTS adapters.

The browser sends 16 kHz mono signed-16-bit PCM and nothing else. That is a
deliberate narrowing: `MediaRecorder` would have given us WebM/Opus, which then needs
an ffmpeg transcode on every turn — a subprocess and 50-150 ms we do not have in a
2-second budget (ADR-0003). An `AudioWorklet` on the client downsamples to 16 kHz and
ships raw frames, so the server can run VAD on the bytes as they arrive and hand
whisper.cpp exactly the format it wants with no conversion at all.
"""

from __future__ import annotations

import array
import io
import math
import wave

SAMPLE_RATE = 16_000
SAMPLE_WIDTH = 2  # signed 16-bit
CHANNELS = 1

# 32 ms at 16 kHz = 512 samples. Silero v5 requires exactly 512-sample chunks at this
# rate, so it is the unit everything upstream works in rather than a number picked for
# the energy detector's convenience.
FRAME_SAMPLES = 512
FRAME_BYTES = FRAME_SAMPLES * SAMPLE_WIDTH
FRAME_MS = FRAME_SAMPLES / SAMPLE_RATE * 1000.0


def to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Wrap raw PCM in a WAV container. whisper.cpp reads files, not stdin."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def to_float32(pcm: bytes) -> list[float]:
    """Signed 16-bit ints -> the -1.0..1.0 floats every model in this path expects."""
    samples = array.array("h")
    samples.frombytes(pcm)
    return [s / 32768.0 for s in samples]


def rms(pcm: bytes) -> float:
    """Root-mean-square amplitude, normalised to 0..1."""
    samples = array.array("h")
    samples.frombytes(pcm)
    if not samples:
        return 0.0
    total = sum(float(s) * float(s) for s in samples)
    return math.sqrt(total / len(samples)) / 32768.0


def duration_ms(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> float:
    return len(pcm) / SAMPLE_WIDTH / sample_rate * 1000.0
