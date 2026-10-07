# Home nature ambience

Original procedural audio, covered by the repository license. No third-party recordings.

- `home-garden.m4a`: gentle breeze with occasional soft bird chirps.
- `home-breeze.m4a`: the same breeze without birds, used at night and during precipitation.

Both are 24-second mono AAC loops. Playback is quiet, opt-in through Settings → Sound effects → Home nature sounds, and limited to the focused, foreground Home screen. It respects silent mode and mixes with other audio.

Regenerate with `python3 services/mobile/scripts/generate-home-nature-sound.py` from the repository root. Requires local ffmpeg; temporary PCM lives outside the checkout.
