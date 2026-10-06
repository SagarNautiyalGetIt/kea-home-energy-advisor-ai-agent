import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as hourlyValidators from './hourly-usage.ts';
import * as seriesValidators from './usage-series.ts';

function dailySeries(day, missing = false) {
  return { customer_id: 'A', daily_dates: missing ? [] : [day], daily_kwh: missing ? [] : [10], daily_quality: missing ? [] : ['measured'], daily_peak_kwh: missing ? [] : [null], daily_off_peak_kwh: missing ? [] : [null], daily_night_kwh: missing ? [] : [null], date_source: 'mart', total_kwh: missing ? 0 : 10, estimated_cost_nzd: missing ? 0 : 3 };
}

function hours(day) {
  const starts = { '2026-09-25': '2026-09-24T12:00:00Z', '2026-09-26': '2026-09-25T12:00:00Z', '2026-09-27': '2026-09-26T12:00:00Z' };
  const clock = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  return { customer_id: 'A', day, timezone: 'Pacific/Auckland', source: 'intervals', note: 'Long interval explanation', hours: Array.from({ length: day === '2026-09-27' ? 23 : 24 }, (_, index) => {
    const at = new Date(Date.parse(starts[day]) + index * 3600000);
    return { start: at.toISOString(), label: clock.format(at), kwh: 1, quality: 'measured', intervals_received: 2, expected_intervals: 2 };
  }) };
}

function usageClient({ missingHourly, missingDaily } = {}) {
  const dependencies = {
    '@/data/mock': { hourlyUsage: [], usage: {} },
    '@/lib/hourly-usage': hourlyValidators,
    '@/lib/usage-series': seriesValidators,
    '@/lib/backend-client': { apiFetch: async (path) => {
      const url = new URL(path, 'http://localhost');
      const hourly = url.pathname.endsWith('/hourly-usage');
      const day = url.searchParams.get(hourly ? 'day' : 'start');
      if (hourly && day === missingHourly) return { ok: false, status: 404 };
      return { ok: true, json: async () => hourly ? hours(day) : dailySeries(day, day === missingDaily) };
    } },
  };
  const module = { exports: {} };
  const source = readFileSync(new URL('./usage-data.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  runInNewContext(outputText, { module, exports: module.exports, process: { env: { EXPO_PUBLIC_USE_REAL_DATA: 'true' } }, require: (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return module.exports.getUsageView;
}

test('daily DST comparison explains why a 23-hour day cannot overlay a 24-hour day', async () => {
  const view = await usageClient()({ customerId: 'A', period: 'daily', date: '2026-09-27', compareDate: '2026-09-26' });
  assert.equal(view.points.length, 23);
  assert.equal(view.comparisonPoints, null);
  assert.match(view.sourceLabel, /23\/23 hours available/);
  assert.match(view.sourceLabel, /comparison: .*1\/1 days/);
  assert.match(view.sourceLabel, /comparison chart unavailable: different NZ day lengths \(23 vs 24 hours · daylight saving\)/);
});

test('daily missing hourly comparison keeps its unavailability explanation', async () => {
  const view = await usageClient({ missingHourly: '2026-09-25' })({ customerId: 'A', period: 'daily', date: '2026-09-26', compareDate: '2026-09-25' });
  assert.equal(view.comparisonPoints, null);
  assert.match(view.sourceLabel, /comparison chart unavailable: hourly source unavailable/);
});

test('daily incomplete comparison reports coverage instead of silently dropping the overlay', async () => {
  const view = await usageClient({ missingDaily: '2026-09-25' })({ customerId: 'A', period: 'daily', date: '2026-09-26', compareDate: '2026-09-25' });
  assert.equal(view.comparisonPoints, null);
  assert.match(view.sourceLabel, /comparison: .*0\/1 days/);
  assert.match(view.sourceLabel, /comparison chart unavailable: incomplete date coverage/);
});

test('daily compatible comparison keeps its points and coverage without a false warning', async () => {
  const view = await usageClient()({ customerId: 'A', period: 'daily', date: '2026-09-26', compareDate: '2026-09-25' });
  assert.equal(view.comparisonPoints.length, 24);
  assert.match(view.sourceLabel, /comparison: .*1\/1 days/);
  assert.doesNotMatch(view.sourceLabel, /comparison chart unavailable/);
});

test('daily view without comparison retains the concise hours label', async () => {
  const view = await usageClient()({ customerId: 'A', period: 'daily', date: '2026-09-26' });
  assert.match(view.sourceLabel, /24\/24 hours available$/);
  assert.doesNotMatch(view.sourceLabel, /comparison|Long interval explanation/);
});
