import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { homeAtmosphere, opensHomeDock, tapsHomeDock } from './home-presentation.ts';
import { appendHomeCameraReveal, appendHomeMaterial } from './home-reveal.ts';
import gsapPackage from '../../node_modules/gsap/dist/gsap.js';
import { equipmentAt } from './home-equipment.ts';

it('actual GSAP timeline completes the camera before blending materials and forces the final frame', () => {
  const pose = { x: 0, y: 0, zoom: 2.05, focusX: 0.3, focusY: -0.14, focusZ: 0.45, mix: 1 };
  const frames = [];
  const publish = force => frames.push({ ...pose, force });
  const animation = gsapPackage.gsap.timeline({ paused: true });
  appendHomeCameraReveal(animation, pose, publish); appendHomeMaterial(animation, pose, publish, false, false);
  try {
    animation.seek(2, false); assert.ok(pose.zoom > 1 && pose.zoom < 2.05); assert.equal(pose.mix, 1);
    animation.seek(4.25, false); assert.equal(pose.zoom, 1); assert.equal(pose.focusX, 0); assert.equal(pose.mix, 1);
    animation.seek(5.35, false); assert.ok(Math.abs(pose.mix - 0.5) < 1e-6);
    animation.seek(animation.duration(), false); assert.equal(pose.mix, 0); assert.equal(frames.at(-1).force, true);
    assert.ok(animation.paused(), 'a hidden-scene timeline stays paused');
  } finally { animation.kill(); }
});
it('an interrupted reveal keeps the current pose and a replacement material transition can finish or stay pinned', () => {
  const pose = { x: 0, y: 0, zoom: 2.05, focusX: 0.3, focusY: -0.14, focusZ: 0.45, mix: 1 };
  const first = gsapPackage.gsap.timeline({ paused: true }); appendHomeCameraReveal(first, pose, () => {});
  first.seek(2, false); const zoom = pose.zoom; first.kill();
  const second = gsapPackage.gsap.timeline({ paused: true }); appendHomeMaterial(second, pose, () => {}, false, false);
  second.seek(second.duration(), false); assert.equal(pose.zoom, zoom); assert.equal(pose.mix, 0); second.kill();
  for (const [pinned, expected] of [[false, 0], [true, 1]]) {
    pose.mix = 0.4; const still = gsapPackage.gsap.timeline({ paused: true });
    appendHomeMaterial(still, pose, () => {}, pinned, true); still.seek(0, false);
    assert.equal(pose.mix, expected); still.kill();
  }
});
it('dock distinguishes upward swipes, taps, sideways scrolling and downward cancellation', () => {
  assert.ok(opensHomeDock(4, -31)); assert.ok(opensHomeDock(-12, -60));
  assert.ok(tapsHomeDock(3, -3));
  for (const [x, y] of [[4, 35], [40, -31], [3, -12], [20, 0]]) {
    assert.equal(opensHomeDock(x, y), false); assert.equal(tapsHomeDock(x, y), false);
  }
});
const at = value => Date.parse(value);
const weather = (now, patch = {}) => ({ observedAt: now, fetchedAt: now, temperatureC: 23, isDay: true, weatherCode: 0, cloudCoverPercent: 0, solarRadiationWm2: 600, sunriseAt: null, sunsetAt: null, condition: 'clear', description: 'Clear sky', ...patch });
it('NZ morning birds and summer butterflies require suitable fresh regional conditions', () => {
  const morning = at('2026-12-10T19:00:00Z'); // 08:00 NZDT, next day.
  assert.ok(homeAtmosphere(weather(morning), morning).birds);
  assert.ok(homeAtmosphere(weather(morning), morning).butterflies);
  assert.equal(homeAtmosphere(weather(morning, { condition: 'rain' }), morning).birds, false);
  assert.equal(homeAtmosphere(weather(morning, { condition: 'rain' }), morning).butterflies, false);
  assert.equal(homeAtmosphere(weather(morning, { temperatureC: 12 }), morning).butterflies, false);
  const winter = at('2026-07-10T20:00:00Z');
  assert.equal(homeAtmosphere(weather(winter), winter).butterflies, false);
});
it('stars/lights use regional night; snow and rain remain distinct; stale weather cannot invent conditions', () => {
  const night = at('2026-12-11T10:00:00Z');
  const sky = homeAtmosphere(weather(night, { isDay: false }), night);
  assert.ok(sky.stars); assert.equal(sky.nightLight, 1);
  assert.equal(homeAtmosphere(weather(night, { isDay: false, condition: 'cloudy', cloudCoverPercent: 95 }), night).stars, false);
  assert.ok(homeAtmosphere(weather(night, { condition: 'snow' }), night).snow);
  assert.equal(homeAtmosphere(weather(night, { condition: 'snow' }), night).rain, false);
  const stale = homeAtmosphere(weather(night - 2 * 3600000, { condition: 'rain' }), night);
  assert.equal(stale.source, 'clock-only'); assert.equal(stale.rain, false); assert.equal(stale.nightLight, 1);
  assert.equal(homeAtmosphere(null, at('2026-12-11T00:00:00Z')).nightLight, 0);
});
it('source GLB moonroof and corrected panel/house edges fall in their own surface masks', () => {
  const d = readFileSync(new URL('../../assets/models/tripo-home-native.glb', import.meta.url));
  const n = d.readUInt32LE(12); const doc = JSON.parse(d.subarray(20, 20 + n).toString());
  const accessor = doc.accessors[0], view = doc.bufferViews[accessor.bufferView];
  const scale = 2.2 / Math.max(...accessor.max.map((v, i) => v - accessor.min[i]));
  const center = accessor.min.map((v, i) => (v + accessor.max[i]) / 2);
  const offset = 28 + n + view.byteOffset;
  const p = [0, 0, 0]; let roof = 0;
  for (let index = 0; index < accessor.count; index++) {
    for (let i = 0; i < 3; i++) p[i] = (d.readFloatLE(offset + index * view.byteStride + i * 4) - center[i]) * scale;
    if (p[0] > 0.25 && p[0] < 0.5 && p[2] > 0.45 && p[2] < 0.7 && p[1] > -0.214 && p[1] < -0.2) {
      assert.equal(equipmentAt('car', p), true, `${p}`); assert.equal(equipmentAt('home', p), false); roof++;
    }
  }
  assert.ok(roof > 100, 'test samples actual moonroof vertices rather than a centre-only proxy');
  assert.ok(equipmentAt('solar', [0.445, 0.239, 0.142]));
  assert.ok(equipmentAt('home', [-0.87, 0.09, 0.44]));
  assert.equal(equipmentAt('solar', [0.445, 0.18, 0.142]), false, 'roof below solar stays unselected');
  assert.equal(equipmentAt('car', [0.62, -0.22, 0.31]), false, 'wall charger is not the car');
  assert.equal(equipmentAt('home', [-0.87, -0.405, 0.44]), false, 'platform stays unselected');
});
