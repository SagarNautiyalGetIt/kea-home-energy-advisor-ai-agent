"""Voice — ADR-0003's claims, as tests.

The claim that matters is "voice cannot produce an answer chat wouldn't". That is
not a property you can assert by reading the code once; it is a property that decays
the first time someone is under demo pressure. So it is tested three ways:

  1. the same question through both channels produces the same text
  2. every clip the session synthesises comes from the answer the agent wrote
  3. the acknowledgement — the only audio produced before any data is read — has no
     figures in it

None of these need a microphone, a GPU, whisper.cpp or Piper. They must keep running
in CI on a machine that has none of it (KEA-94's rule: a slow suite stops being run).
"""

from __future__ import annotations

import math
import struct

import pytest
from fakes import ScriptedProvider

from app.config import Settings, get_provider
from app.pipeline import answer
from app.schemas import Intent
from app.voice import audio
from app.voice.session import Timings, VoiceSession
from app.voice.stt import SpeechToText, _clean
from app.voice.tts import ACKNOWLEDGEMENT, ACKNOWLEDGEMENTS, TextToSpeech, Utterance
from app.voice.vad import Detector, Event, TurnDetector

CUSTOMER = "H-JUL"


# ---------- doubles ----------


class RecordingTransport:
    def __init__(self) -> None:
        self.json: list[dict] = []
        self.audio: list[bytes] = []

    async def send_json(self, payload: dict) -> None:
        self.json.append(payload)

    async def send_bytes(self, payload: bytes) -> None:
        self.audio.append(payload)

    def of_type(self, kind: str) -> list[dict]:
        return [m for m in self.json if m.get("type") == kind]


class FakeTTS(TextToSpeech):
    """Real streaming and ordering logic, no Piper. PCM is a marker, not a waveform."""

    def __init__(self) -> None:
        super().__init__(binary="", voice="")
        self.spoken: list[str] = []

    @property
    def available(self) -> bool:
        return True

    async def synthesise(self, text: str) -> Utterance:
        self.spoken.append(text)
        return Utterance(text=text, pcm=text.encode(), sample_rate=22_050, latency_ms=1.0)


@pytest.fixture(autouse=True)
def _fake_provider(monkeypatch):
    get_provider.cache_clear()
    monkeypatch.setattr("app.pipeline.get_provider", lambda: ScriptedProvider())
    yield
    get_provider.cache_clear()


def _session(tts: TextToSpeech | None = None) -> tuple[VoiceSession, RecordingTransport]:
    transport = RecordingTransport()
    session = VoiceSession(
        transport=transport,
        stt=SpeechToText(binary="", model=""),
        tts=tts or FakeTTS(),
        customer_id=CUSTOMER,
    )
    return session, transport


# ---------- ADR-0003: voice cannot say something chat wouldn't ----------


async def test_voice_and_chat_produce_identical_text():
    """The acceptance criterion for KEA-54, asserted rather than asserted-in-a-doc."""
    question = "why is my bill so high this month?"

    session, transport = _session()
    await session.answer_text(question)
    spoken = transport.of_type("answer")[0]["text"]

    typed = await answer(CUSTOMER, question)

    assert spoken == typed.text


async def test_only_the_answer_is_ever_synthesised():
    """Every clip must be either the answer the agent wrote or the reviewed acknowledgement.

    This is the test that catches "the model was slow in rehearsal so I made voice speak
    the draft" — the exact shortcut ADR-0003 exists to prevent. It matters more now than
    it did: the agent streams partial text mid-turn and some of that text belongs to
    rounds that turned out to be tool lookups, so there is genuinely prose flowing through
    the process that must never reach a speaker.
    """
    tts = FakeTTS()
    session, transport = _session(tts)
    await session.answer_text("why is my bill so high this month?")

    written = transport.of_type("answer")[0]["text"]
    allowed = {ACKNOWLEDGEMENT, *ACKNOWLEDGEMENTS.values()}

    for phrase in tts.spoken:
        assert phrase in allowed or phrase in written, f"synthesised unwritten text: {phrase!r}"


def test_acknowledgements_contain_no_figures():
    """Spoken before anything has read the account, so any number in one is uncomputed."""
    for intent, text in {**ACKNOWLEDGEMENTS, "generic": ACKNOWLEDGEMENT}.items():
        assert not any(c.isdigit() for c in text), f"{intent} acknowledgement has a digit: {text!r}"
        assert "$" not in text, f"{intent} acknowledgement has a dollar sign: {text!r}"


def test_every_offline_intent_has_an_acknowledgement():
    """A missing one is silence during the slowest part of the turn.

    Intent-keyed acknowledgements are the offline pack's now — the request path has no
    intent to key on at the moment this is spoken, and uses `ACKNOWLEDGEMENT`.
    """
    assert set(ACKNOWLEDGEMENTS) == set(Intent)


# ---------- the session protocol ----------


async def test_turn_emits_meta_before_the_answer():
    """The client needs somewhere to hang the escalation banner before the text lands.

    `meta` used to carry layer 0's intent as well, decided from keywords before any data
    was read. There is no such decision now, and asserting one would be asserting a
    classifier this system deliberately does not have.
    """
    session, transport = _session()
    await session.answer_text("why is my bill so high this month?")

    kinds = [m["type"] for m in transport.json]
    assert kinds.index("meta") < kinds.index("answer")
    assert transport.of_type("meta")[0]["escalate"] is False


async def test_audio_header_precedes_every_binary_frame():
    session, transport = _session()
    await session.answer_text("why is my bill so high this month?")

    headers = transport.of_type("audio")
    assert len(headers) == len(transport.audio)
    for header, clip in zip(headers, transport.audio, strict=True):
        assert header["bytes"] == len(clip)
        assert header["sample_rate"] > 0


async def test_unknown_customer_is_a_fatal_error_not_a_crash():
    transport = RecordingTransport()
    session = VoiceSession(
        transport=transport,
        stt=SpeechToText(binary="", model=""),
        tts=FakeTTS(),
        customer_id="NOT-A-HOUSEHOLD",
    )
    assert await session.answer_text("why is my bill high") is None
    assert transport.of_type("error")[0]["fatal"] is True


async def test_sentence_streaming_preserves_order():
    tts = FakeTTS()
    sentences = ["One here.", "Two here.", "Three here."]
    got = [utt.text async for utt in tts.stream(sentences)]
    assert got == sentences


async def test_stream_of_nothing_yields_nothing():
    tts = FakeTTS()
    assert [u async for u in tts.stream([])] == []


# ---------- turn detection ----------


def _tone(ms: float, amplitude: float = 0.3, hz: float = 220.0) -> bytes:
    n = int(audio.SAMPLE_RATE * ms / 1000.0)
    return b"".join(
        struct.pack(
            "<h", int(amplitude * 32767 * math.sin(2 * math.pi * hz * i / audio.SAMPLE_RATE))
        )
        for i in range(n)
    )


def _silence(ms: float) -> bytes:
    return b"\x00\x00" * int(audio.SAMPLE_RATE * ms / 1000.0)


def test_energy_detector_is_the_fallback_without_silero():
    assert TurnDetector(silero_model_path="").detector is Detector.ENERGY


def test_detects_a_turn_and_returns_the_clip():
    detector = TurnDetector(silero_model_path="")
    events = detector.push(_silence(200) + _tone(600) + _silence(900))
    kinds = [e for e, _ in events]

    assert Event.SPEECH_START in kinds
    assert Event.SPEECH_END in kinds
    clip = next(c for e, c in events if e is Event.SPEECH_END)
    # The speech plus its trailing hangover, not the leading silence.
    assert 600 <= audio.duration_ms(clip) <= 1600


def test_a_brief_click_is_not_a_turn():
    """One loud frame is a door, not a question."""
    detector = TurnDetector(silero_model_path="")
    events = detector.push(_tone(60) + _silence(900))
    assert Event.SPEECH_START not in [e for e, _ in events]


def test_pre_speech_silence_does_not_accumulate():
    """A mic left open must not grow an unbounded buffer."""
    detector = TurnDetector(silero_model_path="")
    for _ in range(20):
        detector.push(_silence(500))
    assert detector.flush() == b""


def test_flush_returns_speech_that_never_ended():
    """Push-to-talk released mid-sentence still has to transcribe."""
    detector = TurnDetector(silero_model_path="")
    detector.push(_tone(500))
    assert audio.duration_ms(detector.flush()) >= 400


# ---------- adapters degrade rather than crash ----------


async def test_stt_without_a_binary_raises_a_named_error():
    stt = SpeechToText(binary="", model="")
    assert not stt.available
    with pytest.raises(RuntimeError, match="setup.sh"):
        await stt.transcribe(_tone(200))


async def test_tts_without_a_binary_raises_a_named_error():
    tts = TextToSpeech(binary="", voice="")
    assert not tts.available
    with pytest.raises(RuntimeError, match="setup.sh"):
        await tts.synthesise("hello")


async def test_missing_tts_does_not_stop_the_answer():
    """No Piper is a silent demo, not a broken one — the text still arrives."""
    session, transport = _session(TextToSpeech(binary="", voice=""))
    await session.answer_text("why is my bill so high this month?")

    assert transport.of_type("answer")[0]["text"]
    assert transport.audio == []


def test_whisper_annotations_are_stripped():
    """`[BLANK_AUDIO]` routed to OUT_OF_SCOPE and the caller was refused for coughing."""
    assert _clean("[BLANK_AUDIO]") == ""
    assert _clean("(upbeat music)") == ""
    assert _clean("Why is my bill high?") == "Why is my bill high?"
    assert _clean("[SOUND]\nWhy is my bill high?") == "Why is my bill high?"


# ---------- audio plumbing ----------


def test_wav_roundtrip_preserves_the_samples():
    import io
    import wave

    pcm = _tone(100)
    with wave.open(io.BytesIO(audio.to_wav(pcm)), "rb") as w:
        assert w.getframerate() == audio.SAMPLE_RATE
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.readframes(w.getnframes()) == pcm


def test_silence_and_tone_sit_either_side_of_the_energy_threshold():
    assert audio.rms(_silence(100)) == 0.0
    assert audio.rms(_tone(100)) > 0.012


# ---------- the feature flag ----------


def test_voice_defaults_to_off(monkeypatch):
    """KEA-56. A fresh clone must not start a demo path nobody has set up."""
    monkeypatch.delenv("KEA_VOICE_ENABLED", raising=False)
    assert Settings().voice_enabled is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes"])
def test_voice_flag_accepts_the_usual_truths(monkeypatch, value):
    monkeypatch.setenv("KEA_VOICE_ENABLED", value)
    assert Settings().voice_enabled is True


def test_timings_are_rounded_for_the_wire():
    t = Timings(stt_ms=123.456, model_ms=1.0)
    assert t.as_dict()["stt_ms"] == 123.5
