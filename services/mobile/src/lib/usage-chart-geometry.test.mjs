import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pathFor, pathLength } from './usage-chart-geometry.ts';

describe('Usage chart gaps', () => {
  it('starts a new path after a missing day and does not count distance across it', () => {
    const points = [{ x: 0, y: 10 }, { x: 10, y: 5 }, null, { x: 30, y: 9 }, { x: 40, y: 6 }];
    const path = pathFor(points);
    assert.equal((path.match(/M/g) ?? []).length, 2);
    assert.equal((path.match(/C/g) ?? []).length, 2);
    assert.equal(pathLength(points), Math.hypot(10, -5) + Math.hypot(10, -3));
  });

  it('draws no connecting stroke for one isolated reading', () => {
    assert.equal(pathFor([null, { x: 50, y: 20 }, null]), 'M50.0 20.0');
    assert.equal(pathLength([null, { x: 50, y: 20 }, null]), 1);
  });
});
