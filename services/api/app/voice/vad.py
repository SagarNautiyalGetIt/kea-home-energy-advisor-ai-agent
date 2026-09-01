"""Turn detection — deciding when the caller has stopped speaking.

Silero when its weights are present (ADR-0003: MIT, CPU, ~1 MB), and an RMS energy
detector when they are not. The fallback exists because voice must never be the reason
a fresh clone cannot start: `make api-dev` on a laptop that never ran the voice setup
script still gets a working turn detector, just a worse one in a noisy room.

Which detector is live is reported on `/api/health` and logged at startup. A quiet
downgrade to the energy detector would show up as "the demo mis-detected turns on the
night" with nothing in the logs pointing at the cause.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from app.voice.audio import FRAME_BYTES, FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE, rms, to_float32

log = logging.getLogger(__name__)

# How long a pause has to run before we call the turn over. 700 ms is the usual
# conversational floor: below ~500 ms you cut people off mid-sentence when they pause
# to think, above ~1 s the assistant feels slow to respond.
SILENCE_HANGOVER_MS = 700.0

# Ignore blips. A door closing is one loud frame; speech is many.
MIN_SPEECH_MS = 200.0

# Nobody asks a 30-second question, and an open mic that never closes is how a demo
# hangs with no error. Cut the turn and transcribe what we have.
MAX_UTTERANCE_MS = 20_000.0


class Detector(StrEnum):
    SILERO = "silero"
    ENERGY = "energy"


class Event(StrEnum):
    SPEECH_START = "speech_start"
    SPEECH_END = "speech_end"


@dataclass
class _Silero:
    """Silero VAD v5 via onnxruntime. Returns P(speech) for one 512-sample frame."""

    session: object
    state: object
    np: object

    @classmethod
    def load(cls, model_path: str) -> _Silero | None:
        if not model_path or not Path(model_path).is_file():
            return None
        try:
            import numpy as np
            import onnxruntime
        except ImportError:
            log.info("onnxruntime/numpy not installed — Silero VAD unavailable")
            return None
        try:
            opts = onnxruntime.SessionOptions()
            # One thread. The model is ~1 MB and runs in well under a millisecond; a
            # thread pool per frame costs more than the inference does, and this shares
            # a machine with a 4B language model that wants the cores.
            opts.inter_op_num_threads = 1
            opts.intra_op_num_threads = 1
            session = onnxruntime.InferenceSession(
                model_path, sess_options=opts, providers=["CPUExecutionProvider"]
            )
            return cls(session=session, state=np.zeros((2, 1, 128), dtype=np.float32), np=np)
        except Exception as exc:  # noqa: BLE001 - any load failure downgrades, never crashes
            log.warning(
                "Silero VAD failed to load from %s (%s) — using energy detector", model_path, exc
            )
            return None

    def probability(self, frame: bytes) -> float:
        np = self.np
        audio = np.array([to_float32(frame)], dtype=np.float32)
        out, self.state = self.session.run(
            None,
            {
                "input": audio,
                "state": self.state,
                "sr": np.array(SAMPLE_RATE, dtype=np.int64),
            },
        )
        return float(out[0][0])

    def reset(self) -> None:
        self.state = self.np.zeros((2, 1, 128), dtype=self.np.float32)


class TurnDetector:
    """Feed it PCM, it tells you when a turn starts and ends.

    Stateful and single-conversation: one instance per WebSocket.
    """

    def __init__(
        self,
        *,
        silero_model_path: str = "",
        speech_threshold: float = 0.5,
        energy_threshold: float = 0.012,
    ) -> None:
        self._silero = _Silero.load(silero_model_path)
        self.detector = Detector.SILERO if self._silero else Detector.ENERGY
        self._speech_threshold = speech_threshold
        self._energy_threshold = energy_threshold

        self._buffer = bytearray()  # partial frame carry-over
        self._speech = bytearray()  # the utterance being collected
        self._in_speech = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0

    def _is_speech(self, frame: bytes) -> bool:
        if self._silero is not None:
            return self._silero.probability(frame) >= self._speech_threshold
        return rms(frame) >= self._energy_threshold

    def push(self, pcm: bytes) -> list[tuple[Event, bytes]]:
        """Consume audio, return whatever turn boundaries it crossed.

        Returns a list because one WebSocket message can be long enough to contain a
        whole short utterance — start and end both. Returning a single event would
        silently drop the second one.
        """
        events: list[tuple[Event, bytes]] = []
        self._buffer.extend(pcm)

        while len(self._buffer) >= FRAME_BYTES:
            frame = bytes(self._buffer[:FRAME_BYTES])
            del self._buffer[:FRAME_BYTES]

            speaking = self._is_speech(frame)

            if speaking:
                self._silence_ms = 0.0
                self._speech_ms += FRAME_MS
                self._speech.extend(frame)
                if not self._in_speech and self._speech_ms >= MIN_SPEECH_MS:
                    self._in_speech = True
                    events.append((Event.SPEECH_START, b""))
            elif self._in_speech:
                # Keep the trailing silence in the clip. Whisper transcribes a word cut
                # off at the sample boundary as a different word.
                self._speech.extend(frame)
                self._silence_ms += FRAME_MS
                if self._silence_ms >= SILENCE_HANGOVER_MS:
                    events.append((Event.SPEECH_END, self._take()))
            else:
                # Pre-speech silence. Drop it so a mic left open for a minute does not
                # grow an unbounded buffer.
                self._speech_ms = 0.0
                self._speech.clear()

            if self._in_speech and len(self._speech) / 2 / SAMPLE_RATE * 1000.0 >= MAX_UTTERANCE_MS:
                log.warning(
                    "utterance hit the %.0f s cap — cutting the turn", MAX_UTTERANCE_MS / 1000
                )
                events.append((Event.SPEECH_END, self._take()))

        return events

    def flush(self) -> bytes:
        """End of stream. Return whatever speech was collected but never terminated."""
        if self._in_speech and self._speech:
            return self._take()
        return b""

    def _take(self) -> bytes:
        clip = bytes(self._speech)
        self._speech.clear()
        self._in_speech = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0
        if self._silero is not None:
            self._silero.reset()
        return clip


__all__ = ["Detector", "Event", "TurnDetector", "FRAME_SAMPLES"]
