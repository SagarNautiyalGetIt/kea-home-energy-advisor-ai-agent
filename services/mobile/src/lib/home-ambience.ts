import type { AudioMode, AudioPlayer } from 'expo-audio';

export const HOME_NATURE_VOLUME = 0.28;
export const HOME_NATURE_AUDIO_MODE: Partial<AudioMode> = {
  playsInSilentMode: false,
  shouldPlayInBackground: false,
  interruptionMode: 'mixWithOthers',
  allowsRecording: false,
};

/** Cleanup also cancels a pending audio-session activation after blur or mute. */
export function startHomeAmbience(player: Pick<AudioPlayer, 'volume' | 'loop' | 'play' | 'pause'>, configure: (mode: Partial<AudioMode>) => Promise<void>) {
  let current = true;
  player.loop = true;
  player.volume = HOME_NATURE_VOLUME;
  void configure(HOME_NATURE_AUDIO_MODE).then(() => {
    if (current) player.play();
  }).catch(() => { /* Optional ambience never blocks the energy screen. */ });
  return () => {
    current = false;
    // Expo's hook may release the native player before this effect's cleanup.
    // Release already stops playback; pausing a released shared object throws.
    try { player.pause(); } catch { /* Already released on unmount/source change. */ }
  };
}
