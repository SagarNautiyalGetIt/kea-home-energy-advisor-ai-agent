import type { MetricKey } from './clash-preview';

export const ARENA_PILLARS: { key: MetricKey; x: number; baseY: number; glyph: string }[] = [
  { key: 'ev', x: 104, baseY: 112, glyph: 'EV' },
  { key: 'solar', x: 201, baseY: 112, glyph: 'SOL' },
  { key: 'conservation', x: 92, baseY: 171, glyph: 'USE' },
  { key: 'offPeak', x: 206, baseY: 171, glyph: 'OFF' },
];
export function arenaTilt(dx: number, dy: number) {
  return { x: Math.max(-9, Math.min(9, -dy * 0.09)), y: Math.max(-12, Math.min(12, dx * 0.11)) };
}
export function isArenaTap(dx: number, dy: number) { return Math.hypot(dx, dy) <= 6; }
export function arenaGestureMoved(wasMoved: boolean, dx: number, dy: number, touches: number) {
  return wasMoved || !isArenaTap(dx, dy) || touches > 1;
}

function inside(x: number, y: number, polygon: readonly (readonly number[])[]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a[1]! > y) !== (b[1]! > y) && x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) hit = !hit;
  }
  return hit;
}
/** Match SVG's xMidYMid meet, real pillar faces and front-to-back painter order. */
export function arenaPillarAt(px: number, py: number, width: number, height: number, heights: Record<MetricKey, number>, selected: MetricKey): MetricKey | null {
  if (![px, py, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const scale = Math.min(width / 300, height / 245);
  const x = (px - (width - 300 * scale) / 2) / scale, y = (py - (height - 245 * scale) / 2) / scale;
  if (x < 0 || x > 300 || y < 0 || y > 245) return null;
  for (let i = ARENA_PILLARS.length - 1; i >= 0; i--) {
    const p = ARENA_PILLARS[i]!, top = p.baseY - heights[p.key] - (selected === p.key ? 5 : 0), bottom = p.baseY - (selected === p.key ? 5 : 0);
    const faces = [
      [[p.x - 23, top], [p.x, top + 11], [p.x, bottom + 11], [p.x - 23, bottom]],
      [[p.x, top + 11], [p.x + 23, top], [p.x + 23, bottom], [p.x, bottom + 11]],
      [[p.x, top - 11], [p.x + 23, top], [p.x, top + 11], [p.x - 23, top]],
    ];
    if (faces.some(face => inside(x, y, face))) return p.key;
  }
  return null;
}
