import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isoDay, selectedTotals, usageRange, usageSource, validateUsageSeries } from './usage-series.ts';

const fixture = () => ({ customer_id: 'A', daily_dates: ['2026-09-29', '2026-10-01'], daily_kwh: [10, 20], daily_quality: ['measured', 'estimated'], daily_peak_kwh: [null, null], daily_off_peak_kwh: [null, null], daily_night_kwh: [null, null], date_source: 'mart', total_kwh: 30, estimated_cost_nzd: 9, available_from: '2026-09-29', available_to: '2026-10-01' });
const range = { start: '2026-09-01', end: '2026-10-31' };

describe('Frozen dated usage contract', () => {
  it('accepts a single daily total without inventing hours', () => {
    const row = { ...fixture(), daily_dates: ['2026-10-01'], daily_kwh: [20], daily_quality: ['measured'], daily_peak_kwh: [null], daily_off_peak_kwh: [null], daily_night_kwh: [null], total_kwh: 20, estimated_cost_nzd: 6 };
    assert.equal(validateUsageSeries(row, 'A', usageRange('daily', '2026-10-01')).daily_kwh.length, 1);
  });
  it('retains missing dates and labels estimated readings', () => {
    const row = validateUsageSeries(fixture(), 'A', range);
    assert.deepEqual(row.daily_dates, ['2026-09-29', '2026-10-01']);
    assert.match(usageSource(row).label, /estimated readings/);
    assert.equal(usageSource(row).isDemo, false);
    assert.equal(usageSource({ date_source: 'demo', daily_quality: [] }).isDemo, true);
    assert.equal(usageSource({ date_source: 'mart', daily_quality: ['demo'] }).isDemo, true);
  });
  it('rejects cross-account, misdated, mismatched and invalid readings', () => {
    assert.throws(() => validateUsageSeries(fixture(), 'B', range), /different customer/);
    for (const change of [{ daily_dates: ['2026-09-29'] }, { daily_dates: ['2026-10-01', '2026-09-29'] }, { daily_dates: ['2026-02-30', '2026-10-01'] }, { daily_kwh: [NaN, 20] }, { daily_kwh: [-10, 20] }, { daily_quality: [] }, { daily_peak_kwh: [] }, { total_kwh: 99 }]) assert.throws(() => validateUsageSeries({ ...fixture(), ...change }, 'A', range));
    assert.throws(() => validateUsageSeries(fixture(), 'A', { start: '2026-10-01', end: '2026-10-01' }), /outside/);
    assert.throws(() => isoDay('2026-2-3'));
  });
  it('uses calendar ranges across years and leap days', () => {
    assert.deepEqual(usageRange('weekly', '2026-01-01'), { start: '2025-12-29', end: '2026-01-04' });
    assert.deepEqual(usageRange('monthly', '2024-02-29'), { start: '2023-11-01', end: '2024-02-29' });
  });
  it('reports the selected month rather than all four chart months', () => {
    assert.deepEqual(selectedTotals(fixture(), 'monthly', '2026-10-01'), { kwh: 20, costNzd: 6 });
    assert.deepEqual(selectedTotals(fixture(), 'monthly', '2026-08-01'), { kwh: null, costNzd: null });
    assert.deepEqual(selectedTotals({ ...fixture(), daily_kwh: [0, 0], total_kwh: 0, estimated_cost_nzd: 0 }, 'monthly', '2026-10-01'), { kwh: 0, costNzd: 0 });
  });
});
