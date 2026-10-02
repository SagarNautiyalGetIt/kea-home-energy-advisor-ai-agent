"""Exact-transcript Gemini 3.8 speech; transport and reasoning stay separate."""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import time
import wave
from collections.abc import AsyncIterator

import httpx

from app.schemas import Intent
from app.voice.tts import TextToSpeech, Utterance


def delivery_style(text: str) -> str:
    """Style the verified message, without guessing a customer's private emotions."""
    words = text.lower()
    if any(word in words for word in ("hardship", "support", "dispute", "medical")):
        return "warm, calm and respectful; unhurried; never dramatic or urgent"
    if any(word in words for word in ("saved", "progress", "well done")):
        return "warm and gently encouraging; natural conversational pace; no hype"
    return "warm, grounded and clear; natural New Zealand English; relaxed pace"


def decode_audio(payload: dict) -> tuple[bytes, int]:
    blocks = [
        item
        for step in payload.get("steps", [])
        if step.get("type") == "model_output"
        for item in step.get("content", [])
        if item.get("type") == "audio"
    ]
    if not blocks:
        raise RuntimeError("Gemini returned no speech audio.")
    try:
        audio = base64.b64decode(blocks[-1]["data"], validate=True)
        if len(audio) > 20_000_000:
            raise ValueError("audio exceeds turn limit")
        with wave.open(io.BytesIO(audio), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise ValueError("expected mono 16-bit WAV")
            rate = wav.getframerate()
            if not 8000 <= rate <= 48000:
                raise ValueError("unsupported sample rate")
            pcm = wav.readframes(wav.getnframes())
            if not pcm or len(pcm) % 2:
                raise ValueError("empty or truncated PCM")
            return pcm, rate
    except (KeyError, ValueError, binascii.Error, wave.Error, EOFError) as exc:
        raise RuntimeError("Gemini returned invalid speech audio.") from exc


class GeminiTextToSpeech(TextToSpeech):
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gemini-3.8-flash-tts",
        voice: str = "Kore",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        super().__init__(binary="", voice="")
        self._api_key, self._model, self._gemini_voice = api_key, model, voice
        self._transport = transport
        self._sample_rate = 24000

    @property
    def available(self) -> bool:
        return bool(self._api_key and self._model and self._gemini_voice)

    def describe(self) -> dict[str, object]:
        return {
            "engine": "gemini",
            "model": self._model,
            "voice": self._gemini_voice,
            "available": self.available,
            "verification": "configuration only",
        }

    def speaks(self, language: str | None) -> bool:
        return True

    async def synthesise(self, text: str) -> Utterance:
        if not self.available:
            raise RuntimeError("Gemini speech is not configured.")
        if not text.strip() or len(text) > 12000:
            raise RuntimeError("Speech transcript is empty or exceeds the turn limit.")
        started = time.perf_counter()
        request = {
            "model": self._model,
            "input": [
                {
                    "type": "user_input",
                    "content": [
                        {
                            "type": "text",
                            "text": text,
                            "annotations": [
                                {"type": "speech_metadata", "style": delivery_style(text)}
                            ],
                        }
                    ],
                }
            ],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": self._gemini_voice}]},
        }
        try:
            async with httpx.AsyncClient(timeout=30, transport=self._transport) as client:
                response = await client.post(
                    "https://generativelanguage.googleapis.com/v1beta/interactions",
                    headers={"x-goog-api-key": self._api_key},
                    json=request,
                )
                response.raise_for_status()
                pcm, rate = decode_audio(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            # Provider bodies and request URLs can contain private text or credentials.
            raise RuntimeError(
                "Speech provider failed. Please retry or continue with text."
            ) from exc
        return Utterance(text, pcm, rate, (time.perf_counter() - started) * 1000)

    async def stream(
        self, sentences: list[str], *, language: str | None = None
    ) -> AsyncIterator[Utterance]:
        pending = None
        try:
            for sentence in sentences:
                pending = asyncio.create_task(self.synthesise(sentence))
                yield await pending
        finally:
            if pending is not None and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)

    async def acknowledgement(self, intent: Intent | None = None) -> Utterance | None:
        # No hosted synthesis of generic acknowledgements or startup warm-up.
        return None

    async def prewarm(self) -> int:
        return 0
