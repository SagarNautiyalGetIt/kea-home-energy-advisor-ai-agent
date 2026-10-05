import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arenaGestureMoved, arenaPillarAt, arenaTilt, isArenaTap, ARENA_PILLARS } from './clash-arena.ts';
import { bottomNavMargin, NAV_DESTINATIONS } from './bottom-navigation.ts';

test('all six navigation routes are unique; Power Clash precedes More and fits phone/tablet targets', () => {
  assert.equal(NAV_DESTINATIONS.length, 6);
  assert.equal(new Set(NAV_DESTINATIONS.map(p => p.path)).size, 6);
  assert.equal(NAV_DESTINATIONS.at(-2).path, '/clash'); assert.equal(NAV_DESTINATIONS.at(-1).path, '/more');
  for (const width of [320, 360, 375, 390, 430, 600, 800, 1024]) {
    const margin = bottomNavMargin(width, NAV_DESTINATIONS.length);
    assert.ok(margin >= 0 && margin <= 58);
    assert.ok((width - margin * 2 - 18) / NAV_DESTINATIONS.length >= 48);
  }
});
test('SVG hit testing honours letterboxing, short/tall selected pillars and empty board', () => {
  for (const height of [27, 64]) for (const selected of ARENA_PILLARS.map(p => p.key)) for (const width of [260, 300, 680]) {
    const heights = Object.fromEntries(ARENA_PILLARS.map(p => [p.key, height])), scale = Math.min(width / 300, 1), offset = (width - 300 * scale) / 2, offsetY = (245 - 245 * scale) / 2;
    for (const p of ARENA_PILLARS) {
      const y = p.baseY - height - (p.key === selected ? 5 : 0);
      assert.equal(arenaPillarAt(offset + p.x * scale, offsetY + y * scale, width, 245, heights, selected), p.key);
    }
    assert.equal(arenaPillarAt(offset + 150 * scale, offsetY + 220 * scale, width, 245, heights, selected), null);
    assert.equal(arenaPillarAt(-5, 100, width, 245, heights, selected), null);
  }
});
test('overlapping pillar faces select the frontmost drawn pillar; blank margins never select', () => {
  const heights = { ev: 64, solar: 64, conservation: 64, offPeak: 64 };
  assert.equal(arenaPillarAt(92, 115, 300, 245, heights, 'solar'), 'conservation');
  assert.equal(arenaPillarAt(206, 115, 300, 245, heights, 'conservation'), 'offPeak');
  assert.equal(arenaPillarAt(20, 115, 680, 245, heights, 'ev'), null);
  assert.equal(arenaPillarAt(NaN, 115, 300, 245, heights, 'ev'), null);
});
test('tilt follows horizontal drag, stays bounded and tap threshold excludes drags', () => {
  assert.ok(arenaTilt(40, 0).y > 0); assert.ok(arenaTilt(-40, 0).y < 0);
  assert.deepEqual(arenaTilt(10000, -10000), { x: 9, y: 12 });
  assert.deepEqual(arenaTilt(-10000, 10000), { x: -9, y: -12 });
  assert.ok(isArenaTap(0, 0)); assert.ok(isArenaTap(3, 4));
  assert.equal(isArenaTap(6, 6), false); assert.equal(isArenaTap(30, 0), false);
});
test('a stationary second finger and a drag returning to origin remain ineligible taps', () => {
  for (const sequence of [[[0, 0, 1], [0, 0, 2], [0, 0, 1], [0, 0, 0]], [[0, 0, 1], [30, 0, 1], [0, 0, 1], [0, 0, 0]]]) {
    let moved = false;
    for (const event of sequence) moved = arenaGestureMoved(moved, ...event);
    assert.equal(moved, true);
  }
  let tap = false;
  for (const event of [[0, 0, 1], [3, 4, 1], [3, 4, 0]]) tap = arenaGestureMoved(tap, ...event);
  assert.equal(tap, false);
});
