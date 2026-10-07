import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startHomeAmbience } from './home-ambience.ts';
import { restoreExperienceSettings } from './experience-settings.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function player() {
  return { loop: false, volume: 1, playing: false, play() { this.playing = true; }, pause() { this.playing = false; } };
}

test('Home ambience is quiet, looping, respects mute and leaves other audio alone', async () => {
  const audio = player(); let mode;
  const stop = startHomeAmbience(audio, async next => { mode = next; });
  await flush();
  assert.ok(audio.playing && audio.loop);
  assert.ok(audio.volume > 0 && audio.volume < 0.35);
  assert.equal(mode.playsInSilentMode, false);
  assert.equal(mode.shouldPlayInBackground, false);
  assert.equal(mode.interruptionMode, 'mixWithOthers');
  stop(); assert.equal(audio.playing, false);
});
test('leaving Home or disabling sound cancels a late audio activation', async () => {
  const audio = player(); let activate;
  const stop = startHomeAmbience(audio, () => new Promise(resolve => { activate = resolve; }));
  stop(); activate(); await flush();
  assert.equal(audio.playing, false);
});
test('mute cleanup remains safe if Expo has already released its native player', async () => {
  const audio = player(); let activate;
  const stop = startHomeAmbience(audio, () => new Promise(resolve => { activate = resolve; }));
  audio.pause = () => { throw new Error('ERR_NATIVE_SHARED_OBJECT_NOT_FOUND'); };
  assert.doesNotThrow(stop); activate(); await flush();
  assert.equal(audio.playing, false);
});
test('optional audio can fail without playing or breaking the screen', async () => {
  const audio = player();
  const stop = startHomeAmbience(audio, async () => { throw new Error('Audio session unavailable'); });
  await flush(); assert.equal(audio.playing, false); stop();
});
test('sound is opt-in and survives saved settings without losing existing appearance and haptics', () => {
  const off = restoreExperienceSettings(null, '{"holographic":true,"haptics":false}');
  assert.deepEqual(off, { holographic: false, haptics: false, natureSounds: false });
  const on = restoreExperienceSettings(JSON.stringify({ holographic: true, haptics: false, natureSounds: true }), null);
  assert.deepEqual(on, { holographic: true, haptics: false, natureSounds: true });
  assert.equal(restoreExperienceSettings(JSON.stringify({ ...on, natureSounds: false }), null).natureSounds, false);
  for (const saved of ['{broken', 'null', '[]', '{"natureSounds":"false"}']) assert.equal(restoreExperienceSettings(saved, null).natureSounds, false);
});
