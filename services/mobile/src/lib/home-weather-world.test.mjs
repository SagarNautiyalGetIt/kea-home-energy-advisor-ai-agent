import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { starPositions, meteorFrame, wildlifeFrame, nightWindowAt, HOME_GROUND_RADIUS, NIGHT_WINDOWS, NIGHT_APERTURES, WEATHER_BUDGET, weatherPalette } from './home-weather-world.ts';
import { homeAtmosphere } from './home-presentation.ts';
import { weatherCodeDetails } from './auckland-weather.ts';

function camera(pose, aspect = 1 / 0.7) {
  const c = new PerspectiveCamera(42, aspect, 0.01, 20), yaw = (35 + pose.x) * Math.PI / 180, pitch = (27 + pose.y) * Math.PI / 180, radius = 3.1 / pose.zoom;
  const target = new Vector3(pose.focusX ?? 0, -0.1 + (pose.focusY ?? 0), pose.focusZ ?? 0);
  c.position.set(Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius).add(target);
  c.lookAt(target); c.updateMatrixWorld(); return c;
}
test('actual camera frustum includes a starfield through reveal and all orbit extremes', () => {
  const points = starPositions(); assert.equal(points.length, WEATHER_BUDGET.stars);
  const poses = [{ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 2.05, focusX: 0.3, focusY: -0.14, focusZ: 0.45 }];
  for (const x of [-35, 28]) for (const y of [-12, 13]) for (const zoom of [0.9, 1.18]) poses.push({ x, y, zoom });
  for (const pose of poses) {
    const c = camera(pose);
    const visible = points.filter(p => { const v = new Vector3(...p).project(c); return Math.abs(v.x) < 0.95 && v.y > 0.1 && v.y < 0.95 && Math.abs(v.z) < 1; });
    assert.ok(visible.length >= 8, `${JSON.stringify(pose)}: ${visible.length} sky stars`);
  }
});
test('finite ground supports the model without swallowing the sky at manual orbit extremes', () => {
  for (const x of [-35, 0, 28]) for (const y of [-12, 0, 13]) {
    const c = camera({ x, y, zoom: 1 });
    for (const screenX of [-0.6, 0, 0.6]) {
      const ray = new Vector3(screenX, 0.85, 0.5).unproject(c).sub(c.position).normalize();
      const t = (-0.46 - c.position.y) / ray.y;
      const p = c.position.clone().addScaledVector(ray, t);
      assert.ok(t < 0 || Math.hypot(p.x, p.z) > HOME_GROUND_RADIUS, 'upper sky ray must miss finite matte ground');
    }
  }
});
test('one varied meteor starts every four seconds, fades out and fits visible upper sky', () => {
  const origins = new Set();
  for (let i = 0; i < 40; i++) {
    const start = meteorFrame(i * 4), peak = meteorFrame(i * 4 + 0.475), end = meteorFrame(i * 4 + 1), beforeNext = meteorFrame(i * 4 + 3.99);
    assert.equal(start.cycle, i); assert.equal(start.opacity, 0); assert.ok(peak.opacity > 0.8);
    assert.equal(end.opacity, 0); assert.equal(beforeNext.cycle, i); assert.equal(beforeNext.opacity, 0);
    for (const p of [start.from, start.to]) { assert.ok(Math.abs(p[0]) < 0.95); assert.ok(p[1] >= 0.3 && p[1] < 0.95); }
    origins.add(start.from.join(','));
  }
  assert.equal(origins.size, 40);
});
test('bounded wildlife fades in/out and changes spawn location between cycles', () => {
  for (const butterfly of [false, true]) {
    const lifetime = butterfly ? 7 : 11;
    assert.equal(wildlifeFrame(0, 0, butterfly).opacity, 0);
    assert.ok(wildlifeFrame(lifetime * 0.3, 0, butterfly).opacity > 0.5);
    assert.ok(wildlifeFrame(lifetime - 0.001, 0, butterfly).opacity < 0.001);
    assert.notEqual(wildlifeFrame(0, 0, butterfly).x, wildlifeFrame(lifetime, 0, butterfly).x);
  }
  assert.equal(WEATHER_BUDGET.birds, 3); assert.equal(WEATHER_BUDGET.butterflies, 3); assert.equal(WEATHER_BUDGET.fireflies, 12);
});
test('conditions select coherent effects and palettes without inventing stale weather', () => {
  const now = Date.parse('2026-12-11T10:00:00Z');
  const make = condition => ({ observedAt: now, temperatureC: 23, isDay: false, cloudCoverPercent: 0, condition });
  const missing = homeAtmosphere(null, now); assert.equal(missing.source, 'clock-only'); assert.ok(missing.stars); assert.ok(missing.fireflies);
  const rain = homeAtmosphere(make('rain'), now); assert.ok(rain.rain); assert.equal(rain.stars, false); assert.equal(rain.fireflies, false);
  const snow = homeAtmosphere(make('snow'), now); assert.ok(snow.snow); assert.equal(snow.rain, false);
  const day = Date.parse('2026-12-11T00:00:00Z');
  const sunny = homeAtmosphere({ ...make('clear'), observedAt: day, isDay: true }, day);
  assert.ok(sunny.birds); assert.ok(sunny.butterflies); assert.ok(sunny.cloud >= 0.12); assert.equal(sunny.fireflies, false);
  assert.equal(weatherCodeDetails(97).condition, 'storm');
  assert.notEqual(weatherPalette(true, 'rain').top, weatherPalette(true, 'snow').top);
  assert.notEqual(weatherPalette(true, 'clear').top, weatherPalette(false, 'clear').top);
  assert.equal(homeAtmosphere({ ...make('rain'), observedAt: now - 7200000 }, now).rain, false);
});
test('inset glass pane probes lie on actual source triangles; timber, frames and floor stay unlit', () => {
  const b = readFileSync(new URL('../../assets/models/tripo-home-native.glb', import.meta.url));
  const n = b.readUInt32LE(12), doc = JSON.parse(b.subarray(20, 20 + n).toString());
  const a = doc.accessors[0], v = doc.bufferViews[a.bufferView], scale = 2.2 / Math.max(...a.max.map((x, i) => x - a.min[i])), center = a.min.map((x, i) => (x + a.max[i]) / 2);
  const point = index => center.map((x, k) => (b.readFloatLE(28 + n + v.byteOffset + index * v.byteStride + k * 4) - x) * scale);
  const ia = doc.accessors[doc.meshes[0].primitives[0].indices], iv = doc.bufferViews[ia.bufferView], start = 28 + n + iv.byteOffset + (ia.byteOffset ?? 0);
  for (const w of NIGHT_WINDOWS) {
    const axis = w.half[0] < 0.02 ? 0 : 2, horizontal = axis === 0 ? 2 : 0;
    const probe = [...w.center]; if (probe[1] > 0) probe[1] = 0.055;
    assert.ok(nightWindowAt(probe));
    let hit = false;
    for (let i = 0; i < ia.count && !hit; i += 3) {
      const t = [0, 1, 2].map(k => point(b.readUInt32LE(start + (i + k) * 4)));
      if (Math.min(...t.map(p => p[axis])) > probe[axis] + w.half[axis] || Math.max(...t.map(p => p[axis])) < probe[axis] - w.half[axis]) continue;
      const [p, q, r] = t, x = probe[horizontal], y = probe[1];
      const denominator = (q[1] - r[1]) * (p[horizontal] - r[horizontal]) + (r[horizontal] - q[horizontal]) * (p[1] - r[1]);
      if (Math.abs(denominator) < 1e-10) continue;
      const u = ((q[1] - r[1]) * (x - r[horizontal]) + (r[horizontal] - q[horizontal]) * (y - r[1])) / denominator;
      const v = ((r[1] - p[1]) * (x - r[horizontal]) + (p[horizontal] - r[horizontal]) * (y - r[1])) / denominator;
      hit = u >= 0 && v >= 0 && u + v <= 1 && Math.abs(u * p[axis] + v * q[axis] + (1 - u - v) * r[axis] - probe[axis]) <= w.half[axis];
    }
    assert.ok(hit, `glass pane ${w.center} must intersect a real triangle, not only nearby wall vertices`);
  }
  for (const p of [[-0.75, -0.23, 0.50], [-0.35, -0.23, 0.50], [-0.56, -0.23, 0.50], [-0.63, 0.2, 0.5], [0.651, -0.225, 0.059], [0.86, -0.292, -0.916], [0.38, -0.297, 0.695], [0.254, 0.322, -0.25], [-0.5, -0.4, 0.5]]) assert.equal(nightWindowAt(p), false);
  assert.ok((a.min[1] - center[1]) * scale > -0.46, 'matte ground sits below all original model/pavement vertices');
  assert.equal(NIGHT_APERTURES.length, 3); // Explicit backings for absent glass, not invented source triangles.
  assert.ok(NIGHT_APERTURES.every(p => p.center[1] - p.height / 2 > -0.40));
});
