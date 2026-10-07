"""Private, short Gemini prompts for deterministic Connect notification flows."""

from __future__ import annotations

import asyncio
import hashlib
import io
import wave

from app.alerts.aws_channels import aws_client

NOTICE = (
    "Hello, this is Sparky, Kea Energy's AI assistant. You asked Kea to call about bill "
    "warnings. There is a new energy notice in your Kea app. Open the app securely to "
    "see the details or talk with me. I will never ask for your password or payment "
    "details on this call. You can contact customer care or turn off phone warnings "
    "in Settings in the Kea app. Goodbye."
)


def connect_wav(pcm: bytes, sample_rate: int) -> bytes:
    """AWS Play prompt requires mono 8 kHz mu-law WAV; ffmpeg has explicit bounds."""
    # Standard wave writes signed PCM; ffmpeg converts, never a renamed PCM file.
    import subprocess

    stream = io.BytesIO()
    with wave.open(stream, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm)
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            "pipe:0",
            "-ar",
            "8000",
            "-ac",
            "1",
            "-c:a",
            "pcm_mulaw",
            "-f",
            "wav",
            "pipe:1",
        ],
        input=stream.getvalue(),
        capture_output=True,
        timeout=20,
        check=True,
    )
    if len(result.stdout) > 2_400_000:
        raise RuntimeError("Call prompt exceeds five minutes.")
    return result.stdout


class ConnectPromptBuilder:
    def __init__(self, *, tts, bucket: str, region: str, s3=None):
        self.tts, self.bucket, self.region, self._s3 = tts, bucket, region, s3

    async def prepare_notice(self, delivery_key: str) -> str:
        if not self.bucket or not self.tts.available:
            raise RuntimeError("Private prompt storage and speech must be configured.")
        # The prompt contains no customer information and is content addressed for reuse.
        key = (
            "notices/"
            + hashlib.sha256((NOTICE + str(self.tts.describe())).encode()).hexdigest()
            + ".wav"
        )
        s3 = self._s3 or aws_client("s3", self.region)
        try:
            await asyncio.to_thread(s3.head_object, Bucket=self.bucket, Key=key)
        except Exception:
            utterance = await self.tts.synthesise(NOTICE)
            audio = await asyncio.to_thread(connect_wav, utterance.pcm, utterance.sample_rate)
            await asyncio.to_thread(
                s3.put_object,
                Bucket=self.bucket,
                Key=key,
                Body=audio,
                ContentType="audio/wav",
                ServerSideEncryption="AES256",
            )
        return f"s3://{self.bucket}/{key}"


def call_transition(state: str, event: str) -> str:
    """Closed transition set: no model output can choose a number or routing action."""
    transitions = {
        ("notice", "1"): "support",
        ("notice", "9"): "opt_out",
        ("notice", "timeout"): "ended",
        ("notice", "invalid"): "ended",
        ("notice", "prompt_failed"): "ended",
        ("notice", "hangup"): "ended",
        ("support", "hardship"): "human_care",
        ("support", "agent_available"): "human_care",
        ("support", "unavailable"): "app_follow_up",
        ("opt_out", "saved"): "ended",
        ("opt_out", "save_failed"): "manual_opt_out",
    }
    return transitions.get((state, event), "ended")
