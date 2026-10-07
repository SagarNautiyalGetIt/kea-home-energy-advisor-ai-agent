import type { AucklandWeather } from './auckland-weather';
import type { Point3 } from './home-equipment';

export const STAR_COUNT = 420;
export const METEOR_INTERVAL = 4;
export const HOME_GROUND_RADIUS = 1.7;
export const WEATHER_BUDGET = { stars: STAR_COUNT, rain: 72, snow: 64, fireflies: 12, birds: 3, butterflies: 3, grass: 720, clouds: 4 } as const;
/** Seeded variation without allocating/spawning objects each frame. */
export function sceneRandom(seed: number) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export function starPositions(): Point3[] {
  return Array.from({ length: STAR_COUNT }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / STAR_COUNT, angle = i * Math.PI * (3 - Math.sqrt(5)), ring = Math.sqrt(1 - y * y);
    return [Math.cos(angle) * ring * 7, y * 7, Math.sin(angle) * ring * 7];
  });
}
export function meteorFrame(seconds: number) {
  const cycle = Math.floor(Math.max(0, seconds) / METEOR_INTERVAL), age = Math.max(0, seconds) % METEOR_INTERVAL;
  const t = Math.min(age / 0.95, 1);
  const from = [-0.72 + sceneRandom(cycle * 7 + 1) * 1.04, 0.52 + sceneRandom(cycle * 7 + 2) * 0.28] as const;
  const to = [from[0] + 0.32 + sceneRandom(cycle * 7 + 3) * 0.18, from[1] - 0.22] as const;
  return { cycle, from, to, t, opacity: age < 0.95 ? Math.sin(Math.PI * t) * 0.85 : 0 };
}
export function wildlifeFrame(seconds: number, slot: number, butterfly: boolean) {
  const window = butterfly ? 19 : 25, clock = Math.max(0, seconds) + slot * window / 3;
  const cycle = Math.floor(clock / window), age = clock % window, seed = cycle * 31 + slot * 17 + (butterfly ? 1000 : 0);
  // Vary arrival, lifetime and direction, with a quiet gap before each visitor.
  // Reuse three slots rather than growing a React/Three object list over time.
  const arrival = 0.8 + sceneRandom(seed + 3) * 4.5;
  const lifetime = (butterfly ? 6 : 9) + sceneRandom(seed + 4) * 4;
  const t = Math.max(0, Math.min(1, (age - arrival) / lifetime));
  const fade = Math.max(0, Math.min(1, t / 0.18, (1 - t) / 0.22));
  const direction = sceneRandom(seed + 5) < 0.5 ? -1 : 1;
  return {
    x: butterfly ? (sceneRandom(seed) - 0.5) * 2.1 + Math.sin(t * 5 + slot) * 0.12 : direction * (t - 0.5) * 3.4,
    y: (butterfly ? -0.27 : 0.62) + sceneRandom(seed + 1) * (butterfly ? 0.14 : 0.25) + Math.sin(t * 9 + slot) * (butterfly ? 0.045 : 0.035),
    z: butterfly ? 1.18 + sceneRandom(seed + 2) * 0.18 : -1.7 - sceneRandom(seed + 2) * 0.5,
    opacity: fade * (butterfly ? 0.9 : 0.8),
  };
}

/** Grass stays on the outer lawn, clear of the original house and driveway. */
export function grassBlades() {
  const blades = [];
  for (let seed = 1; blades.length < WEATHER_BUDGET.grass; seed++) {
    const angle = sceneRandom(seed * 5) * Math.PI * 2;
    const radius = Math.sqrt(sceneRandom(seed * 5 + 1)) * (HOME_GROUND_RADIUS - 0.05);
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    if (Math.abs(x) < 0.97 && Math.abs(z) < 1.15) continue;
    blades.push({ x, z, height: 0.035 + sceneRandom(seed * 5 + 2) * 0.035, angle, shade: sceneRandom(seed * 5 + 3) });
  }
  return blades;
}

export function cloudFrame(seconds: number, slot: number) {
  const period = 45 + sceneRandom(slot + 400) * 20;
  const t = ((Math.max(0, seconds) / period + slot / WEATHER_BUDGET.clouds) % 1);
  return {
    x: (t - 0.5) * 5.6,
    y: 0.85 + sceneRandom(slot + 401) * 0.38,
    z: -2.1 - sceneRandom(slot + 402) * 0.6,
    opacity: Math.max(0, Math.min(1, t / 0.15, (1 - t) / 0.15)),
    scale: 0.8 + sceneRandom(slot + 403) * 0.55,
  };
}
export function weatherPalette(isDay: boolean, condition: AucklandWeather['condition']) {
  if (!isDay) return { top: '#10162E', horizon: '#344460', mist: '#7689A2', body: '#DCE9F5', ground: condition === 'snow' ? '#697D8B' : '#28352F' };
  if (condition === 'snow') return { top: '#71899F', horizon: '#C8DCE7', mist: '#EFF7FB', body: '#EEF4F5', ground: '#DCE5E2' };
  if (['rain', 'drizzle', 'storm'].includes(condition)) return { top: condition === 'storm' ? '#27364B' : '#405F78', horizon: '#809DAE', mist: '#A2B9C6', body: '#D4DDE2', ground: '#53665C' };
  if (condition === 'fog') return { top: '#738C97', horizon: '#B9CCCF', mist: '#D4E0DE', body: '#E6E8DD', ground: '#819188' };
  if (condition === 'cloudy') return { top: '#54768F', horizon: '#ACC6D1', mist: '#D9E4E8', body: '#FAE8B5', ground: '#6A8070' };
  return { top: '#367EAD', horizon: '#B2DDE6', mist: '#EEF6F6', body: '#FFE9A2', ground: '#748B78' };
}
/** Individual glass panes read from textured model elevations, inset from timber/mullions. */
export const NIGHT_WINDOWS = [
  { center: [-0.630, -0.232, 0.474], half: [0.056, 0.131, 0.009] },
  { center: [-0.484, -0.232, 0.474], half: [0.051, 0.131, 0.009] },
  { center: [-0.630, 0.12, 0.474], half: [0.056, 0.102, 0.009] },
  { center: [-0.484, 0.12, 0.474], half: [0.051, 0.102, 0.009] },
  { center: [-0.125, -0.243, 0.188], half: [0.062, 0.132, 0.010] },
  { center: [0.110, -0.243, 0.178], half: [0.077, 0.132, 0.010] },
  { center: [0.308, -0.243, 0.178], half: [0.066, 0.132, 0.010] },
] as const;
/** These openings contain no glass triangles in the fused source mesh. */
export const NIGHT_APERTURES = [
  { center: [0.490, -0.243, 0.164], width: 0.110, height: 0.264, side: false },
  { center: [0.595, -0.243, -0.6525], width: 0.105, height: 0.264, side: true },
  { center: [0.595, -0.243, -0.5175], width: 0.115, height: 0.264, side: true },
] as const;
export function nightWindowAt(point: Point3) {
  return NIGHT_WINDOWS.some(box => point.every((v, i) => Math.abs(v - box.center[i]!) <= box.half[i]!)) && point[1] < point[0] * 0.34 + 0.342;
}
export const NIGHT_WINDOW_SHADER = NIGHT_WINDOWS.map(box => `windows=max(windows,region(keaWorld,vec3(${box.center.join(',')}),vec3(${box.half.join(',')}),vec3(1.,0.,0.),vec3(0.,1.,0.),vec3(0.,0.,1.)));`).join('\n') + '\nwindows*=1.0-step(keaWorld.x*0.34+0.342,keaWorld.y);';
