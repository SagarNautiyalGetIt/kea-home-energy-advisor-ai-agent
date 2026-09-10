"""Speech to text through the same Gemini API the assistant already uses.

## Why this exists

The voice turn was slow and intermittently unresponsive, and the model was not the
reason — `KEA_PROVIDER=gcp` has applied to voice since ADR-0003 made voice a transport
over the same pipeline. The latency was upstream of the model: `stt.py` shells out to
whisper.cpp running **ggml-large-v3-turbo-q5_0** (548 MB) on four CPU threads.

ADR-0003 chose that binary for an M4 Pro, where whisper.cpp compiles against Metal and
the model runs on the GPU. On a machine without that acceleration the same call is a
548 MB model on the CPU, which is seconds per utterance and occasionally long enough to
hit `TRANSCRIBE_TIMEOUT_S` — which is exactly the "sometimes does not respond" symptom,
because a timeout raises and the turn ends with an error rather than an answer.

Gemini takes audio natively, so transcription costs one HTTPS round trip on the key the
project already has. No second credential, no 548 MB download, no Metal.

## What this does NOT change

**Voice still cannot say anything chat would not** (ADR-0003). This replaces the
microphone-to-text step only; the transcript goes into the identical `answer()` path.
Swapping the transcriber cannot introduce a second brain, which is why this is a
drop-in for `SpeechToText` rather than anything the session layer knows about.

TTS stays on Piper. It is 61 MB, runs in tens of milliseconds, and is the half of the
loop that was never slow — moving it would add a round trip to buy nothing.
"""

from __future__ import annotations

import logging
import time

from app.voice.audio import duration_ms, to_wav
from app.voice.stt import Transcript, _clean

log = logging.getLogger(__name__)

#: Deliberately shorter than whisper's 30 s. This is one HTTPS request against a hosted
#: model — if it has not answered in eight seconds it is not going to, and a caller
#: sitting in silence is worse than a caller told to try again.
TRANSCRIBE_TIMEOUT_S = 8.0

#: Transcribe, do not answer. Gemini will happily reply to the *content* of the audio if
#: you leave this vague, and a helpful paraphrase reaching `answer()` as the customer's
#: own words is the failure to design against — the whole pipeline is built on the
#: question being what the customer actually asked.
_PROMPT = (
    "Transcribe this audio to plain text, verbatim. It is one short utterance from a New "
    "Zealand customer talking to their electricity retailer. Output only the words spoken "
    "— no speaker labels, no timestamps, no punctuation you did not hear, no commentary, "
    "and do not answer the question. If there is no intelligible speech, output nothing."
)


class GeminiSpeechToText:
    """`SpeechToText`-compatible transcriber backed by Gemini.

    Same three members the session uses — `available`, `describe()`, `transcribe()` — so
    `voice.get_stt()` can return either without the session knowing which it has.
    """

    def __init__(self, model: str = "gemini-2.5-flash", language: str = "en") -> None:
        self._model = model
        self._language = language
        self._client = None

    def _genai(self):
        if self._client is None:
            from google import genai

            self._client = genai.Client()
        return self._client

    @property
    def available(self) -> bool:
        """True when the SDK is importable and a credential is present.

        Deliberately not a live API call: `available` is read on every `/health` and on
        every socket open, and a round trip there would put Gemini's latency in front of
        a page load. A key that is present but rejected surfaces on the first real
        transcription, which `session.py` already reports to the caller.
        """
        try:
            import os

            from google import genai  # noqa: F401
        except ImportError:
            return False
        return bool(
            os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
            or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        )

    def describe(self) -> dict[str, object]:
        return {
            "engine": "gemini",
            "binary": None,
            "model": self._model,
            "available": self.available,
        }

    async def transcribe(self, pcm: bytes) -> Transcript:
        """PCM in, text out. Raises RuntimeError; the session turns that into a message."""
        if not self.available:
            raise RuntimeError(
                "Gemini speech-to-text is unavailable — set GEMINI_API_KEY, or set "
                "KEA_STT_ENGINE=whisper to use the local binary."
            )

        import asyncio

        from google.genai import types

        started = time.perf_counter()
        # WAV rather than raw PCM: the header carries the sample rate and channel count,
        # so the service does not have to be told them out of band and cannot be told
        # them wrongly.
        audio = types.Part.from_bytes(data=to_wav(pcm), mime_type="audio/wav")

        try:
            response = await asyncio.wait_for(
                self._genai().aio.models.generate_content(
                    model=self._model,
                    contents=[_PROMPT, audio],
                    config=types.GenerateContentConfig(
                        # Transcription is not a creative task, and a warm model
                        # paraphrases rather than transcribes.
                        temperature=0.0,
                        max_output_tokens=256,
                    ),
                ),
                timeout=TRANSCRIBE_TIMEOUT_S,
            )
        except TimeoutError:
            raise RuntimeError(
                f"Gemini transcription timed out after {TRANSCRIBE_TIMEOUT_S:.0f}s on "
                f"{duration_ms(pcm) / 1000:.1f}s of audio"
            ) from None
        except Exception as exc:  # noqa: BLE001 - the session reports this to the caller
            raise RuntimeError(f"Gemini transcription failed: {exc}") from exc

        text = (response.text or "").strip()
        latency = (time.perf_counter() - started) * 1000.0
        log.info(
            "stt(gemini) %.0f ms audio -> %.0f ms transcribe -> %r",
            duration_ms(pcm),
            latency,
            text[:80],
        )
        # `_clean` is shared with the whisper path rather than reimplemented. It strips
        # bracketed non-speech annotations, and a model told to output nothing for silence
        # sometimes writes "(no speech)" instead — the same shape, so the same filter.
        return Transcript(text=_clean(text), latency_ms=latency)
