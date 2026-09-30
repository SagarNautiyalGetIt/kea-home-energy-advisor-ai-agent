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
  });

  it('clamps the rendered range without changing the semantic tone', () => {
    assert.equal(billRingEndAngle(-1), 90);
    assert.equal(billRingEndAngle(2), 449.9);
    assert.equal(billRingToneForRatio(2), 'red');
  });
});
