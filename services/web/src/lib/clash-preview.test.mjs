import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demoDistricts, demoLeaderboard, demoScore, demoScoreParts, demoScoring, locationOutcomeCopy, nearbyDemoDistrict } from './clash-preview.ts';

describe('Power Clash synthetic preview', () => {
  it('suggests only a nearby example and never claims a verified suburb', () => {
    const result = nearbyDemoDistrict(-36.858, 174.733);
    assert.equal(result?.id, 'grey-lynn');
    assert.ok(result.distanceKm < 1);
    assert.equal(nearbyDemoDistrict(-41.29, 174.78), null);
    assert.equal(nearbyDemoDistrict(Number.NaN, 174.73), null);
  });

  it('retains a manual path when permission is denied or location fails', () => {
    assert.match(locationOutcomeCopy('denied'), /choose any demo suburb/i);
    assert.match(locationOutcomeCopy('unavailable'), /choose a demo suburb/i);
    assert.equal(demoDistricts.length, 3);
    assert.ok(demoDistricts.every((district) => Number.isFinite(district.latitude) && Number.isFinite(district.longitude)));
  });

  it('shows a monthly sample ranking of people within one suburb', () => {
    const standings = demoLeaderboard('grey-lynn');
    assert.equal(standings.length, 5);
    assert.deepEqual(standings.map((player) => player.rank), [1, 2, 3, 4, 5]);
    assert.ok(standings.every((player, index) => index === 0 || standings[index - 1].score >= player.score));
    assert.ok(standings.some((player) => player.id === 'you'));
    assert.ok(standings.every((player) => player.id === 'you' || /^Kea \d+$/.test(player.label)));
  });

  it('applies four bounded, different example weights without awarding credit', () => {
    assert.equal(Object.values(demoScoring).reduce((sum, item) => sum + item.weight, 0), 100);
    assert.equal(new Set(Object.values(demoScoring).map((item) => item.weight)).size, 3);
    const metrics = { conservedKwh: 120, reductionPercent: 25, evAvoidedKg: 50, offPeakSavingsNzd: 40, solarAvoidedKg: 50 };
    assert.deepEqual(demoScoreParts(metrics), { conservation: 35, ev: 20, offPeak: 25, solar: 20 });
    assert.equal(demoScore(metrics), 100);
    assert.equal(demoScore({ ...metrics, reductionPercent: -5, evAvoidedKg: -1 }), 45);
  });
});
