"""One voice conversation over one WebSocket.

The protocol, in full:

    client -> server
      {"type":"hello","customer_id":"H-JUL"}    must be first
      <binary>                                  16 kHz mono s16le PCM
      {"type":"end"}                            caller released push-to-talk
      {"type":"text","message":"..."}           typed input, same pipeline, no mic

    server -> client
      {"type":"ready", ...capabilities}
      {"type":"speech_start"}
      {"type":"transcript","text":...}
      {"type":"meta","intent":...,"escalate":...}
      {"type":"audio","kind":"ack"|"answer","text":...,"sample_rate":N,"bytes":N}
      <binary>                                  the clip that header describes
      {"type":"answer","text":...,"facts":[...],"verification":{...}}
      {"type":"done","latency":{...}}
      {"type":"error","message":...,"fatal":bool}

Every audio header is immediately followed by exactly one binary frame. The header
carries the sample rate because Piper voices are 16 kHz or 22.05 kHz depending on the
voice, and playing one at the other's rate does not error — it just sounds wrong.

The `text` message type is not a convenience. It is how the voice channel is tested in
CI and on a machine with no microphone, and it exercises the identical path from
`plan()` onward, so a regression in the voice pipeline fails a test rather than a demo.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

from app.pipeline import Answer, Plan, UnknownCustomerError, narrate, plan
from app.voice.audio import SAMPLE_RATE
from app.voice.stt import SpeechToText
from app.voice.tts import TextToSpeech
from app.voice.vad import Event, TurnDetector

log = logging.getLogger(__name__)


class Transport:
    """What `VoiceSession` needs from a WebSocket. Kept narrow so tests can fake it."""

    async def send_json(self, payload: dict) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def send_bytes(self, payload: bytes) -> None:  # pragma: no cover - interface
        raise NotImplementedError


@dataclass
class Timings:
    """Measured, not estimated. KEA-59 reports these against the ADR-0003 budget."""

    stt_ms: float = 0.0
    plan_ms: float = 0.0
    model_ms: float = 0.0
    first_audio_ms: float = 0.0
    total_ms: float = 0.0

    def as_dict(self) -> dict[str, float]:
        return {k: round(v, 1) for k, v in self.__dict__.items()}


@dataclass
class VoiceSession:
    transport: Transport
    stt: SpeechToText
    tts: TextToSpeech
    customer_id: str = ""
    detector: TurnDetector = field(default_factory=TurnDetector)

    async def send_ready(self) -> None:
        await self.transport.send_json(
            {
                "type": "ready",
                "sample_rate_in": SAMPLE_RATE,
                "stt": self.stt.describe(),
                "tts": self.tts.describe(),
                "vad": self.detector.detector,
                # A client that knows the mic is useless can say so up front instead of
                # letting someone talk into a dead microphone for ten seconds.
                "can_listen": self.stt.available,
                "can_speak": self.tts.available,
            }
        )

    async def on_audio(self, chunk: bytes) -> None:
        for event, clip in self.detector.push(chunk):
            if event is Event.SPEECH_START:
                await self.transport.send_json({"type": "speech_start"})
            elif event is Event.SPEECH_END:
                await self.handle_utterance(clip)

    async def on_end(self) -> None:
        """Push-to-talk released. Transcribe whatever is buffered, even mid-pause."""
        clip = self.detector.flush()
        if clip:
            await self.handle_utterance(clip)

    async def handle_utterance(self, clip: bytes) -> None:
        timings = Timings()
        started = time.perf_counter()

        try:
            transcript = await self.stt.transcribe(clip)
        except RuntimeError as exc:
            log.error("stt failed: %s", exc)
            await self.error(str(exc), fatal=False)
            return

        timings.stt_ms = transcript.latency_ms
        await self.transport.send_json({"type": "transcript", "text": transcript.text})

        if not transcript.text:
            # Silence, a cough, or a annotation-only transcription. Saying "I did not
            # catch that" is right; running it through the pipeline is not — it routes
            # to OUT_OF_SCOPE and the caller is told we cannot help with a noise.
            await self.transport.send_json(
                {"type": "done", "empty": True, "latency": timings.as_dict()}
            )
            return

        await self.answer_text(transcript.text, timings=timings, started=started)

    async def answer_text(
        self,
        message: str,
        *,
        timings: Timings | None = None,
        started: float | None = None,
    ) -> Answer | None:
        """Text in, spoken verified answer out. The only path to audio in this class."""
        timings = timings or Timings()
        started = started if started is not None else time.perf_counter()

        plan_started = time.perf_counter()
        try:
            p = await plan(self.customer_id, message)
        except UnknownCustomerError as exc:
            await self.error(f"unknown customer: {exc}", fatal=True)
            return None
        timings.plan_ms = (time.perf_counter() - plan_started) * 1000.0

        await self.transport.send_json(
            {"type": "meta", "intent": p.intent, "escalate": p.escalate}
        )

        # ADR-0005: speak now, from a constant, while the model works. This is the only
        # audio the caller hears that layer 3 never checked, which is why it is drawn
        # from a reviewed dict of figure-free strings and never from model output.
        first_audio_at = await self._speak_acknowledgement(p, started)
        if first_audio_at is not None:
            timings.first_audio_ms = first_audio_at

        model_started = time.perf_counter()
        # `channel="voice"` reaches the conversation row. Call deflection is the business
        # case, so voice turns have to be countable separately from chat ones.
        result = await narrate(p, message, channel="voice")
        timings.model_ms = (time.perf_counter() - model_started) * 1000.0

        await self.transport.send_json(
            {
                "type": "answer",
                "text": result.text,
                "facts": [f.model_dump() for f in result.bundle.facts],
                "verification": result.report.model_dump(),
                "escalate_to_human": result.escalate,
            }
        )

        # `result.sentences` is the verified text and nothing else. There is no branch
        # in this class that synthesises a string the number-checker has not passed.
        #
        # A synthesis failure degrades to a silent-but-correct turn, for the same reason
        # `narrate_verified` degrades to a template: the answer has already been computed
        # and verified, and the client has already been sent it. Throwing here would take
        # a working answer off the screen because the speaker did not work.
        try:
            async for utt in self.tts.stream(result.sentences):
                if timings.first_audio_ms == 0.0:
                    timings.first_audio_ms = (time.perf_counter() - started) * 1000.0
                await self._send_audio("answer", utt.text, utt.pcm, utt.sample_rate)
        except Exception as exc:  # noqa: BLE001 - a mute demo beats a dead one
            log.error("tts failed mid-answer (%s) — turn completes without audio", exc)
            await self.error(f"speech synthesis unavailable: {exc}", fatal=False)

        timings.total_ms = (time.perf_counter() - started) * 1000.0
        await self.transport.send_json({"type": "done", "latency": timings.as_dict()})
        log.info(
            "voice turn customer=%s intent=%s verified=%s stt=%.0fms model=%.0fms "
            "first_audio=%.0fms total=%.0fms",
            self.customer_id,
            result.intent,
            result.report.passed,
            timings.stt_ms,
            timings.model_ms,
            timings.first_audio_ms,
            timings.total_ms,
        )
        return result

    async def _speak_acknowledgement(self, p: Plan, started: float) -> float | None:
        utt = await self.tts.acknowledgement(p.intent)
        if utt is None:
            return None
        await self._send_audio("ack", utt.text, utt.pcm, utt.sample_rate)
        return (time.perf_counter() - started) * 1000.0

    async def _send_audio(self, kind: str, text: str, pcm: bytes, sample_rate: int) -> None:
        await self.transport.send_json(
            {
                "type": "audio",
                "kind": kind,
                "text": text,
                "sample_rate": sample_rate,
                "bytes": len(pcm),
            }
        )
        await self.transport.send_bytes(pcm)

    async def error(self, message: str, *, fatal: bool) -> None:
        await self.transport.send_json({"type": "error", "message": message, "fatal": fatal})


def parse_control(raw: str) -> dict:
    """Client text frames. Malformed JSON is a client bug, not a reason to drop the call."""
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {"type": "invalid", "raw": raw[:120]}
    if not isinstance(payload, dict):
        return {"type": "invalid", "raw": raw[:120]}
    return payload
