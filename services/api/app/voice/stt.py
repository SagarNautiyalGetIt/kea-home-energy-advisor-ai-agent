"""Speech to text via whisper.cpp.

ADR-0003 chose whisper.cpp over faster-whisper for one reason: CTranslate2 has no
Metal backend, so on an ARM Mac faster-whisper runs on the CPU and costs several
hundred milliseconds a turn that we cannot spare. whisper.cpp compiles against Metal
and Core ML, and the demo machine is an M4 Pro.

We shell out to the `whisper-cli` binary rather than binding libwhisper through
ctypes. The binary is what `ml/voice/setup.sh` builds and what a developer can run by
hand to check their own install, and a subprocess boundary means a segfault in a
GPU driver kills a child process instead of the API.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from app.voice.audio import duration_ms, to_wav

log = logging.getLogger(__name__)

# A turn that takes longer than this has gone wrong — wrong model path, a CPU build on
# a 1.5 GB model, a wedged process. Fail it and say so rather than leaving the caller
# listening to silence.
TRANSCRIBE_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class Transcript:
    text: str
    latency_ms: float

    #: BCP-47 tag for the language actually spoken — "en", "hi", "mi", "zh". None when
    #: the transcriber cannot tell, which is not the same as English.
    #:
    #: Carried because a customer who asks a question in Hindi and is answered in English
    #: has not been served, and because the answer's language decides which voice can
    #: read it aloud. Whisper's adapter leaves it None; the Gemini one fills it in.
    language: str | None = None


class SpeechToText:
    """whisper.cpp adapter. `available` is false when the binary or weights are missing."""

    def __init__(self, binary: str, model: str, *, threads: int = 4, language: str = "en") -> None:
        self._binary = binary
        self._model = model
        self._threads = threads
        self._language = language

    @property
    def available(self) -> bool:
        return bool(
            self._binary
            and self._model
            and Path(self._binary).is_file()
            and os.access(self._binary, os.X_OK)
            and Path(self._model).is_file()
        )

    def describe(self) -> dict[str, object]:
        return {
            "engine": "whisper.cpp",
            "binary": self._binary or None,
            "model": Path(self._model).name if self._model else None,
            "available": self.available,
        }

    async def transcribe(self, pcm: bytes) -> Transcript:
        """PCM in, text out. Raises RuntimeError; the session turns that into a message."""
        if not self.available:
            raise RuntimeError(
                f"whisper.cpp not available (binary={self._binary!r} model={self._model!r}) "
                "— run ml/voice/setup.sh"
            )

        started = time.perf_counter()

        # mkstemp rather than a context manager: whisper-cli opens the path itself, so
        # our handle has to be closed before it runs, and the file has to outlive the
        # `with` block that would have created it.
        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(to_wav(pcm))

            proc = await asyncio.create_subprocess_exec(
                self._binary,
                "-m", self._model,
                "-f", wav_path,
                "-t", str(self._threads),
                "-l", self._language,
                "-nt",           # no timestamps — we want the words, not a transcript file
                "--no-prints",   # keep the banner out of stdout
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=TRANSCRIBE_TIMEOUT_S
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                raise RuntimeError(
                    f"whisper.cpp timed out after {TRANSCRIBE_TIMEOUT_S:.0f}s on "
                    f"{duration_ms(pcm) / 1000:.1f}s of audio"
                ) from None

            if proc.returncode != 0:
                raise RuntimeError(
                    f"whisper.cpp exited {proc.returncode}: "
                    f"{stderr.decode(errors='replace').strip()[:300]}"
                )

            text = stdout.decode(errors="replace").strip()
        finally:
            Path(wav_path).unlink(missing_ok=True)

        latency = (time.perf_counter() - started) * 1000.0
        log.info(
            "stt %.0f ms audio -> %.0f ms transcribe -> %r",
            duration_ms(pcm),
            latency,
            text[:80],
        )
        return Transcript(text=_clean(text), latency_ms=latency)


# whisper emits bracketed annotations for non-speech: [BLANK_AUDIO], [ Silence ],
# (upbeat music). None of them are a question, and routing "[BLANK_AUDIO]" lands on
# OUT_OF_SCOPE, so the assistant answers a noise with a refusal instead of ignoring it.
_ANNOTATION_PREFIXES = ("[", "(", "*")


def _clean(text: str) -> str:
    kept = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(_ANNOTATION_PREFIXES):
            continue
        kept.append(line)
    return " ".join(kept).strip()
