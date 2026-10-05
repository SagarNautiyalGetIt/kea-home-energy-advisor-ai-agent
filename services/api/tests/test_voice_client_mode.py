from __future__ import annotations

from app.voice.session import VoiceSession
from app.voice.stt_client import ClientSpeechToText


class Transport:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)

    async def send_bytes(self, content):
        raise AssertionError("No audio expected from readiness")


class TTS:
    available = True

    def describe(self):
        return {"engine": "piper", "available": True}


async def test_client_mode_advertises_text_input_without_server_listening():
    transport = Transport()
    session = VoiceSession(transport=transport, stt=ClientSpeechToText(), tts=TTS())
    assert session.detector is None
    await session.send_ready()
    ready = transport.messages[0]
    assert ready["client_transcription"] is True
    assert ready["can_listen"] is False
    assert ready["can_speak"] is True
    assert ready["stt"]["engine"] == "client"
    assert ready["vad"] == "client"
