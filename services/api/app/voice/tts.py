"""Text to speech via Piper, one sentence at a time.

## Why sentence-at-a-time, and what it actually buys us here

ADR-0003 calls sentence-streamed TTS "the load-bearing optimisation: speaking sentence
one while generating sentence two". That framing assumes the language model streams
into the speaker. **It cannot in this system**, and the reason is the thing the whole
pitch rests on: layer 3 verifies the *whole* answer, so no audio can be produced until
the model has finished writing and every figure has been checked. Speaking sentence one
early would mean speaking it before we know sentence three did not invent a number.

So the win available here is smaller than the ADR describes, and worth stating plainly:
we overlap **synthesis with synthesis**, not synthesis with generation. A four-sentence
answer used to need 4 x TTS before the first sound; now it needs 1 x TTS. That is a real
cut to time-to-first-audio (~600 ms -> ~150 ms on a warm Piper) but it does not touch the
model time in front of it.

The dead air *in front* of it is covered by ADR-0005's pre-synthesised acknowledgement
instead — see `acknowledgement()`. Layer 0 knows the intent in ~0 ms, so we can speak
"Let me look at your July usage" the instant the caller stops talking, from a cached WAV
that no model wrote and no verifier needs to check.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from app.schemas import Intent

log = logging.getLogger(__name__)

SYNTH_TIMEOUT_S = 20.0
DEFAULT_SAMPLE_RATE = 22_050

# Spoken while the agent works, before it has read anything. Deliberately contains no
# figure, no comparison and no characterisation of the customer's usage — anything
# specific here would be a claim nothing had looked up yet. These are the only strings in
# the system that reach a customer without the model having seen their data, which is
# exactly why they are constants in a reviewed file.
ACKNOWLEDGEMENT = "Let me pull that up for you."
"""What voice says the instant a question arrives (ADR-0005).

It used to be picked from the table below, keyed by the intent layer 0 had just decided.
There is no such decision now — the agent reads the question and the account rather than
classifying the message first — so there is nothing to key on at the moment this has to
be spoken, which is before any work has been done.

That is a small loss and worth naming: "Let me compare your plans" was a nicer noise than
this one. It was also occasionally wrong, because it was a keyword match asserting what
the customer had asked about, out loud, before anything had been checked. One honest line
beats twenty-six confident ones that are right most of the time.
"""

#: **Unused by the request path.** Kept for the offline pack, whose device-side narration
#: still works intent-by-intent (see `app/analytics/bundles.py`), and as the source for
#: `prewarm`.
ACKNOWLEDGEMENTS: dict[Intent, str] = {
    Intent.WHY_HIGH: "Let me look at your usage for that period.",
    Intent.WHAT_WILL_I_PAY: "Let me work out where your bill is heading.",
    Intent.USING_MORE_THAN_USUAL: "Let me check that against the weather.",
    Intent.WHAT_COSTS_MOST: "Let me look at what your meter can tell us.",
    Intent.PEAK_USAGE: "Let me find your highest day.",
    Intent.TIME_OF_DAY: "Let me see what detail I have for that.",
    Intent.COMPARE_TO_LAST_YEAR: "Let me check what I have for that.",
    Intent.TARIFF_CHECK: "Let me compare your plans.",
    Intent.HARDSHIP: "I hear you. Let me get you to the right person.",
    Intent.OUT_OF_SCOPE: "Let me check whether I can answer that.",
    # ── added with the driver decomposition ──
    Intent.USAGE_TOTAL: "Let me add up your usage for that period.",
    Intent.COMPARE_TO_SIMILAR: "Let me compare you against similar homes.",
    Intent.BILL_BREAKDOWN: "Let me go through the charges on that bill.",
    Intent.HOW_TO_REDUCE: "Let me see where your money is actually going.",
    Intent.SOLAR_EXPORT: "Let me check what your panels sent back.",
    Intent.SUPPLY_QUALITY: "Let me check how your meter was read.",
    # ── account lookups. Shorter, because they are a lookup rather than a
    # computation and the pause before the answer is correspondingly brief; a
    # three-second acknowledgement in front of a half-second answer sounds broken.
    Intent.ACCOUNT_BALANCE: "Let me check your balance.",
    Intent.BILL_DUE: "Let me check that date.",
    Intent.PLAN_DETAILS: "Let me look up your plan.",
    Intent.RATE_DETAILS: "Let me look up your rates.",
    Intent.PAYMENT_METHOD: "Let me check how your bill is paid.",
    Intent.ACCOUNT_IDENTITY: "Let me pull up your account details.",
    Intent.BILLING_CYCLE: "Let me check your billing dates.",
    # Like HARDSHIP: acknowledges without conceding the point or defending the bill.
    # Neither "you're right" nor "our figures are correct" is ours to say before a
    # person has looked at it.
    Intent.DISPUTE: "I understand. Let me get you to someone who can look into that.",
}


@dataclass(frozen=True)
class Utterance:
    text: str
    pcm: bytes
    sample_rate: int
    latency_ms: float


class TextToSpeech:
    """Piper adapter. Spawns one process per sentence.

    A long-lived process fed line-by-line would save the ~80 ms model load per
    sentence, but Piper's raw output carries no frame markers, so there is no reliable
    way to know where one sentence's audio ends and the next begins — the boundary is
    exactly what we need in order to stream. Per-sentence processes keep the boundary
    trivial and the failure mode local.
    """

    def __init__(self, binary: str, voice: str) -> None:
        self._binary = binary
        self._voice = voice
        self._sample_rate = _voice_sample_rate(voice)
        self._ack_cache: dict[Intent, Utterance] = {}

    @property
    def available(self) -> bool:
        return bool(
            self._binary
            and self._voice
            and Path(self._binary).is_file()
            and os.access(self._binary, os.X_OK)
            and Path(self._voice).is_file()
        )

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def describe(self) -> dict[str, object]:
        return {
            "engine": "piper",
            "binary": self._binary or None,
            "voice": Path(self._voice).name if self._voice else None,
            "sample_rate": self._sample_rate,
            "available": self.available,
        }

    async def synthesise(self, text: str) -> Utterance:
        if not self.available:
            raise RuntimeError(
                f"piper not available (binary={self._binary!r} voice={self._voice!r}) "
                "— run ml/voice/setup.sh"
            )

        started = time.perf_counter()
        proc = await asyncio.create_subprocess_exec(
            self._binary,
            "--model", self._voice,
            "--output_raw",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=text.encode()), timeout=SYNTH_TIMEOUT_S
            )
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f"piper timed out after {SYNTH_TIMEOUT_S:.0f}s") from None

        if proc.returncode != 0:
            raise RuntimeError(
                f"piper exited {proc.returncode}: {stderr.decode(errors='replace').strip()[:300]}"
            )

        latency = (time.perf_counter() - started) * 1000.0
        return Utterance(
            text=text, pcm=stdout, sample_rate=self._sample_rate, latency_ms=latency
        )

    def speaks(self, language: str | None) -> bool:
        """Whether the installed voice can read this language.

        Piper voices are per-language: the file loaded here is `en_GB-alba-medium`, and
        it has English phonemes and nothing else. Handed a Hindi or Mandarin answer it
        does not fail — it reads the characters with English rules and produces confident
        nonsense, which is worse than silence, because silence is obviously a gap and
        fluent gibberish sounds like the product working.

        So a non-English answer is returned as text and not spoken, unless a matching
        voice has been installed. `ml/voice/setup.sh --voice <name>` fetches one, and the
        language is the part before the first dash.
        """
        if not language:
            return True
        installed = Path(self._voice).name.split("-")[0].lower() if self._voice else ""
        # `en_GB` covers `en`, and `en` covers `en-NZ`. Compare the base subtag only.
        return installed.split("_")[0] == language.split("-")[0].lower()

    async def stream(
        self, sentences: list[str], *, language: str | None = None
    ) -> AsyncIterator[Utterance]:
        """Yield each sentence's audio as it is ready.

        Synthesis of sentence n+1 is started before sentence n is yielded, so the
        caller is transmitting one clip while the next is being made. Order is
        preserved — a voice that says sentence three first is worse than a slow one.
        """
        if not sentences or not self.speaks(language):
            return

        pending = asyncio.create_task(self.synthesise(sentences[0]))
        for nxt in sentences[1:]:
            current = await pending
            pending = asyncio.create_task(self.synthesise(nxt))
            yield current
        yield await pending

    async def acknowledgement(self, intent: Intent | None = None) -> Utterance | None:
        """The instant reply, spoken while the agent works. Cached after first use, so it
        is ~0 ms on every later turn.

        `intent` is optional and the request path does not pass it — see
        `ACKNOWLEDGEMENT`. The offline pack still has an intent to key on, so the
        parameter stays rather than forcing that caller through a second method.
        """
        if intent in self._ack_cache:
            return self._ack_cache[intent]
        text = ACKNOWLEDGEMENTS.get(intent) if intent is not None else ACKNOWLEDGEMENT
        if not text or not self.available:
            return None
        try:
            utt = await self.synthesise(text)
        except Exception as exc:  # noqa: BLE001 - an ack is a nicety, never a failure
            log.warning("acknowledgement synthesis failed (%s) — continuing silently", exc)
            return None
        self._ack_cache[intent] = utt
        return utt

    async def prewarm(self) -> int:
        """Synthesise the acknowledgements up front so the first turn is not the slow one.

        The generic one first, because it is the only one the request path uses and the
        one whose latency a caller would actually hear.
        """
        if not self.available:
            return 0
        made = 1 if await self.acknowledgement() is not None else 0
        for intent in ACKNOWLEDGEMENTS:
            if await self.acknowledgement(intent) is not None:
                made += 1
        return made


def _voice_sample_rate(voice_path: str) -> int:
    """Piper ships `<voice>.onnx.json` next to the weights; the rate lives in it.

    Guessing 22050 is wrong for the 16 kHz voices, and a wrong rate does not error —
    it plays back at the wrong pitch and speed, which is a confusing thing to debug
    from a demo.
    """
    if not voice_path:
        return DEFAULT_SAMPLE_RATE
    config = Path(f"{voice_path}.json")
    if not config.is_file():
        return DEFAULT_SAMPLE_RATE
    try:
        data = json.loads(config.read_text())
        return int(data["audio"]["sample_rate"])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        log.warning(
            "could not read sample rate from %s (%s) — assuming %d",
            config, exc, DEFAULT_SAMPLE_RATE,
        )
        return DEFAULT_SAMPLE_RATE
