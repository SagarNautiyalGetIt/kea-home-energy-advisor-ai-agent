"""Marker for transcripts produced on the user's device."""

from __future__ import annotations


class ClientSpeechToText:
    @property
    def available(self) -> bool:
        # The client reports its own model readiness. The server only needs to
        # accept text and return the answer plus Piper audio.
        return True

    def describe(self) -> dict[str, object]:
        return {"engine": "client", "binary": None, "model": None, "available": True}

    async def transcribe(self, pcm: bytes) -> None:
        raise RuntimeError("Microphone audio must stay on the device")
