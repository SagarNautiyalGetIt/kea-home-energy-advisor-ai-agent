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
      {"type":"meta","escalate":...}
      {"type":"audio","kind":"ack"|"answer","text":...,"sample_rate":N,"bytes":N}
      <binary>                                  the clip that header describes
      {"type":"answer","text":...,"sources":[...],"escalate_to_human":bool}
      {"type":"done","latency":{...}}
      {"type":"error","message":...,"fatal":bool}

`meta` no longer carries an intent and `answer` no longer carries `facts` or a
`verification` verdict: there is no router deciding an intent up front, and no bundle for
prose to be checked against. `sources` replaces them — what the agent actually looked up
for this answer. See `app/pipeline.py`.

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
from dataclasses import dataclass

from app.agent.loop import AgentUnavailable
from app.pipeline import Answer, UnknownCustomerError, answer
from app.voice.audio import SAMPLE_RATE
from app.voice.stt import SpeechToText
from app.voice.tts import TextToSpeech
from app.voice.vad import Event, TurnDetector

log = logging.getLogger(__name__)

#: Spoken when the model cannot be reached. Figure-free by construction, and it does not
#: pretend to be an answer — the old architecture served a template built from verified
#: facts here, which worked because the model was only formatting figures Python had
#: already computed. Nothing stands in for reasoning, so this says so.
_UNAVAILABLE = (
    "I'm sorry — I can't reach your account details just now, so I'd rather not guess. "
    "Please try again in a moment."
)


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
    detector: TurnDetector | None = None

    def __post_init__(self) -> None:
        if self.detector is None and self.stt.describe()["engine"] != "client":
            self.detector = TurnDetector()

    async def send_ready(self) -> None:
        client_transcription = self.stt.describe()["engine"] == "client"
        await self.transport.send_json(
            {
                "type": "ready",
                "sample_rate_in": SAMPLE_RATE,
                "stt": self.stt.describe(),
                "tts": self.tts.describe(),
                "vad": self.detector.detector if self.detector is not None else "client",
                "client_transcription": client_transcription,
                # A client that knows the mic is useless can say so up front instead of
                # letting someone talk into a dead microphone for ten seconds.
                "can_listen": self.stt.available and not client_transcription,
                "can_speak": self.tts.available,
            }
        )

    async def on_audio(self, chunk: bytes) -> None:
        if self.detector is None:
            raise RuntimeError("Client transcription does not accept microphone audio")
        for event, clip in self.detector.push(chunk):
            if event is Event.SPEECH_START:
                await self.transport.send_json({"type": "speech_start"})
            elif event is Event.SPEECH_END:
                await self.handle_utterance(clip)

    async def on_end(self) -> None:
        """Push-to-talk released. Transcribe whatever is buffered, even mid-pause."""
        if self.detector is None:
            raise RuntimeError("Client transcription requires a text message")
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

        await self.answer_text(
            transcript.text,
            timings=timings,
            started=started,
            language=transcript.language,
        )

    async def answer_text(
        self,
        message: str,
        *,
        timings: Timings | None = None,
        started: float | None = None,
        language: str | None = None,
    ) -> Answer | None:
        """Text in, spoken answer out. The only path to audio in this class."""
        timings = timings or Timings()
        started = started if started is not None else time.perf_counter()

        # ADR-0005: speak now, from a constant, while the agent works. This is the only
        # audio the caller hears that was not produced from their own data, which is why
        # it is drawn from a reviewed figure-free string and never from model output.
        #
        # It is generic rather than picked per intent because there is no intent to pick
        # from at this moment — nothing has read the account yet. See `tts.ACKNOWLEDGEMENT`.
        first_audio_at = await self._speak_acknowledgement(started)
        if first_audio_at is not None:
            timings.first_audio_ms = first_audio_at

        model_started = time.perf_counter()
        try:
            result = await answer(self.customer_id, message, channel="voice", language=language)
        except UnknownCustomerError as exc:
            await self.error(f"unknown customer: {exc}", fatal=True)
            return None
        except AgentUnavailable as exc:
            # Spoken, not silent. A caller who hears nothing has no idea whether to wait,
            # hang up or repeat themselves, and this is a phone call.
            log.error("voice: agent unavailable customer=%s: %s", self.customer_id, exc)
            await self._speak_line(_UNAVAILABLE)
            await self.error("the assistant is unavailable", fatal=False)
            await self.transport.send_json({"type": "done", "latency": timings.as_dict()})
            return None
        timings.model_ms = (time.perf_counter() - model_started) * 1000.0

        await self.transport.send_json({"type": "meta", "escalate": result.escalate})
        await self.transport.send_json(
            {
                "type": "answer",
                "text": result.text,
                "sources": result.sources,
                "escalate_to_human": result.escalate,
            }
        )

        # `result.sentences` strips markdown before splitting — a synthesiser reading
        # "asterisk asterisk your bill asterisk asterisk" down a phone line is the
        # failure that property exists to prevent.
        #
        # A synthesis failure degrades to a silent-but-correct turn: the answer has
        # already been produced and sent to the client, and throwing here would take a
        # working answer off the screen because the speaker did not work.
        try:
            async for utt in self.tts.stream(result.sentences, language=language):
                if timings.first_audio_ms == 0.0:
                    timings.first_audio_ms = (time.perf_counter() - started) * 1000.0
                await self._send_audio("answer", utt.text, utt.pcm, utt.sample_rate)
        except Exception as exc:  # noqa: BLE001 - a mute demo beats a dead one
            log.error("tts failed mid-answer (%s) — turn completes without audio", exc)
            await self.error(f"speech synthesis unavailable: {exc}", fatal=False)

        if not self.tts.speaks(language):
            # The answer is on screen and correct; only the audio is missing. Saying so
            # beats a silent turn that reads as a broken speaker — and beats reading
            # Hindi with an English voice, which is what happens if this is skipped.
            log.info("tts: no installed voice for %r — answer sent as text only", language)
            await self.transport.send_json(
                {
                    "type": "notice",
                    "reason": "no_voice_for_language",
                    "language": language,
                    "text": (
                        "Sparky answered in your language, but can only speak English "
                        "aloud on this device."
                    ),
                }
            )

        timings.total_ms = (time.perf_counter() - started) * 1000.0
        await self.transport.send_json({"type": "done", "latency": timings.as_dict()})
        log.info(
            "voice turn customer=%s tools=%s escalate=%s stt=%.0fms model=%.0fms "
            "first_audio=%.0fms total=%.0fms",
            self.customer_id,
            [t.name for t in result.tools_used],
            result.escalate,
            timings.stt_ms,
            timings.model_ms,
            timings.first_audio_ms,
            timings.total_ms,
        )
        return result

    async def _speak_acknowledgement(self, started: float) -> float | None:
        utt = await self.tts.acknowledgement()
        if utt is None:
            return None
        await self._send_audio("ack", utt.text, utt.pcm, utt.sample_rate)
        return (time.perf_counter() - started) * 1000.0

    async def _speak_line(self, text: str) -> None:
        """Say one reviewed constant. Silent if synthesis is unavailable — the client
        still has the `error` frame, so the failure is never invisible."""
        try:
            utt = await self.tts.synthesise(text)
        except Exception:  # noqa: BLE001 - already on the failure path
            return
        await self._send_audio("answer", utt.text, utt.pcm, utt.sample_rate)

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
