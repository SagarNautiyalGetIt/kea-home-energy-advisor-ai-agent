import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billRingEndAngle, billRingToneForAngle, billRingToneForRatio } from './bill-ring.ts';

describe('Bill prediction ring boundaries', () => {
  it('keeps exactly 1.0 in the green zone', () => {
    assert.equal(billRingEndAngle(1), 210);
    assert.equal(billRingToneForRatio(1), 'green');
    assert.equal(billRingToneForAngle(billRingEndAngle(1)), 'green');
  });

  it('keeps exactly 1.25 in the orange zone', () => {
    assert.equal(billRingEndAngle(1.25), 330);
    assert.equal(billRingToneForRatio(1.25), 'orange');
    assert.equal(billRingToneForAngle(billRingEndAngle(1.25)), 'orange');
  });

  it('moves values immediately above each boundary into the next zone', () => {
    assert.equal(billRingToneForRatio(1.0001), 'orange');
    assert.equal(billRingToneForAngle(billRingEndAngle(1.0001)), 'orange');
    assert.equal(billRingToneForRatio(1.2501), 'red');
    assert.equal(billRingToneForAngle(billRingEndAngle(1.2501)), 'red');
    assert.ok(billRingEndAngle(1.2501) < 449.9);
  });

  it('clamps the rendered range without changing the semantic tone', () => {
    assert.equal(billRingEndAngle(-1), 90);
    assert.equal(billRingEndAngle(2), 449.9);
    assert.equal(billRingToneForRatio(2), 'red');
  });

  it('matches the monthly $100 example', () => {
    for (const [projected, expectedTone] of [[80, 'green'], [100, 'green'], [110, 'orange'], [125, 'orange'], [130, 'red'], [175, 'red'], [200, 'red']]) {
      assert.equal(billRingToneForRatio(projected / 100), expectedTone);
    }
    assert.ok(billRingEndAngle(1.3) > 330);
    assert.ok(billRingEndAngle(1.3) < billRingEndAngle(1.6));
    assert.ok(billRingEndAngle(1.6) < 449.9);
    assert.equal(billRingEndAngle(1.75), 449.9);
    assert.equal(billRingEndAngle(2), 449.9);
  });
});
