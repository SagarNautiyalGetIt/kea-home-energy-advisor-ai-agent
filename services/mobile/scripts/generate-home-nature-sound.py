"""Create Kea's original 24-second ambience loops (Python stdlib + ffmpeg).

Temporary PCM is kept outside the repository. No downloaded recordings or APIs.
"""
from array import array
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave

RATE = 24000
DURATION = 24
COUNT = RATE * DURATION
DESTINATION = Path(__file__).resolve().parent.parent / "assets" / "audio"


def wind():
    rng = random.Random(20261007)
    noise = [rng.uniform(-1, 1) for _ in range(COUNT)]
    low = slow = 0.0
    # Warm the filters with the end of the same noise ring for a smooth join.
    for value in noise[-RATE:]:
        low += (value - low) * 0.035
        slow += (low - slow) * 0.0015
    samples = []
    for i, value in enumerate(noise):
        low += (value - low) * 0.035
        slow += (low - slow) * 0.0015
        envelope = 0.75 + 0.16 * math.sin(2 * math.pi * i / COUNT) + 0.09 * math.sin(6 * math.pi * i / COUNT)
        samples.append((low - slow) * 0.48 * envelope)
    return samples


def chirp(samples, start, duration, frequency, lift, level):
    first, count = int(start * RATE), int(duration * RATE)
    for i in range(count):
        t = i / RATE
        phase = 2 * math.pi * (frequency * t + lift * t * t / (2 * duration))
        envelope = math.sin(math.pi * i / count) ** 2
        samples[first + i] += level * envelope * (math.sin(phase) + 0.15 * math.sin(phase * 2))


def encode(name, samples, temporary):
    pcm = array('h', (round(max(-0.95, min(0.95, value)) * 32767) for value in samples))
    wav = temporary / f"{name}.wav"
    with wave.open(str(wav), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', str(DESTINATION / f'{name}.m4a')], check=True)


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    breeze = wind()
    garden = breeze.copy()
    for start, frequency, lift in [(2.7, 2300, 700), (7.2, 2700, -450), (13.1, 2100, 1100), (19.8, 2500, -650)]:
        for offset, level in [(0, 0.11), (0.25, 0.08), (0.57, 0.055)]:
            chirp(garden, start + offset, 0.14, frequency, lift, level)
    with tempfile.TemporaryDirectory(prefix='kea-nature-audio-') as directory:
        encode('home-breeze', breeze, Path(directory))
        encode('home-garden', garden, Path(directory))


if __name__ == '__main__':
    main()
