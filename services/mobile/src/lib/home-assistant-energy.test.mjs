import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measuredDayKwh, previousCompleteDay } from './home-assistant-energy.ts';

describe('Home Assistant energy boundaries', () => {
  it('uses the actual 23-hour Auckland day when daylight saving begins', () => {
    const { day, start, end } = previousCompleteDay('Pacific/Auckland', new Date('2026-09-28T00:00:00Z'));
    assert.equal(day, '2026-09-27');
    assert.equal(start.toISOString(), '2026-09-26T12:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-27T11:00:00.000Z');
  });

  it('uses the actual 25-hour Auckland day when daylight saving ends', () => {
    const { day, start, end } = previousCompleteDay('Pacific/Auckland', new Date('2026-04-06T00:00:00Z'));
    assert.equal(day, '2026-04-05');
    assert.equal(start.toISOString(), '2026-04-04T11:00:00.000Z');
    assert.equal(end.toISOString(), '2026-04-05T12:00:00.000Z');
  });

  it('adds cumulative meter deltas across a reset and rejects an incomplete day', () => {
    const sensor = { id: 'sensor.charger_energy', label: 'Charger', unit: 'Wh' };
    const start = new Date('2026-09-21T00:00:00Z');
    const end = new Date('2026-09-22T00:00:00Z');
    const state = (at, value) => ({ entity_id: sensor.id, last_updated: at, state: String(value) });
    const history = [[state('2026-09-21T00:00:00Z', 200), state('2026-09-21T12:00:00Z', 500), state('2026-09-21T13:00:00Z', 100), state('2026-09-21T23:30:00Z', 400)]];
    assert.equal(measuredDayKwh(history, sensor, start, end), 0.7);
    assert.throws(() => measuredDayKwh([history[0].slice(0, 3)], sensor, start, end), /no complete daily energy history/);
  });
});
