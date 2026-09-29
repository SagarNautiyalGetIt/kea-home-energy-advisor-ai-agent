import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// Keep the test on the real selector while replacing only the network boundary.
const backendStub = `data:text/javascript,${encodeURIComponent('export async function apiFetch(path) { return globalThis.__usageApiFetch(path); }')}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/backend-client') return { url: backendStub, shortCircuit: true };
    if (specifier.startsWith('@/')) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

const { getUsageView } = await import('./usage-data.ts');
process.env.EXPO_PUBLIC_USE_REAL_DATA = 'true';

function datedRows(start, count, missing = new Set()) {
  const first = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    return { date, kwh: index + 1, peak: null, offPeak: null, night: null };
  }).filter((row) => !missing.has(row.date));
}

function serve(rows, dateSource = 'mart') {
  const calls = [];
  globalThis.__usageApiFetch = async (path) => {
    calls.push(path);
    const url = new URL(path, 'http://kea.test');
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    const selected = rows.filter((row) => row.date >= start && row.date <= end);
    const total = selected.reduce((sum, row) => sum + row.kwh, 0);
    return new Response(JSON.stringify({
      customer_id: 'H-TEST',
      daily_dates: selected.map((row) => row.date),
      daily_kwh: selected.map((row) => row.kwh),
      daily_quality: selected.map((row) => row.quality ?? (dateSource === 'demo' ? 'demo' : 'measured')),
      daily_peak_kwh: selected.map((row) => row.peak),
      daily_off_peak_kwh: selected.map((row) => row.offPeak),
      daily_night_kwh: selected.map((row) => row.night),
      band_data_source: selected.some((row) => row.peak !== null || row.offPeak !== null || row.night !== null) ? 'measured' : null,
      date_source: dateSource,
      total_kwh: total,
      estimated_cost_nzd: Number((total * 0.3).toFixed(2)),
      available_from: rows[0]?.date ?? null,
      available_to: rows.at(-1)?.date ?? null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

describe('Usage API projection', () => {
  it('uses dated weekly readings and never invents a time-band split', async () => {
    const calls = serve(datedRows('2026-07-01', 21));
    const view = await getUsageView({ customerId: 'H-TEST', period: 'weekly', date: '2026-07-15' });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /usage-series\?start=2026-07-06&end=2026-07-19/);
    assert.deepEqual(view.points.map((point) => point.kwh), [13, 14, 15, 16, 17, 18, 19]);
    assert.equal(view.totalKwh, 112);
    assert.equal(view.totalCostNzd, 33.6);
    assert.equal(view.observedDays, 7);
    assert.equal(Math.round(view.trendPercent), 78);
    assert.deepEqual(view.bands.map((band) => band.kwh), [null, null, null]);
  });

  it('keeps a missing Wednesday as an empty chart slot and withholds trend', async () => {
    serve(datedRows('2026-07-01', 21, new Set(['2026-07-15'])));
    const view = await getUsageView({ customerId: 'H-TEST', period: 'weekly', date: '2026-07-15' });
    assert.equal(view.points.length, 7);
    assert.equal(view.points[2].axisLabel, 'Wed');
    assert.equal(view.points[2].kwh, null);
    assert.equal(view.observedDays, 6);
    assert.equal(view.expectedDays, 7);
    assert.equal(view.trendPercent, null);
  });

  it('withholds measured time bands when one day of a week is missing', async () => {
    const rows = datedRows('2026-07-13', 7, new Set(['2026-07-15'])).map((row) => ({
      ...row, peak: 1, offPeak: 1, night: 1,
    }));
    serve(rows);
    const view = await getUsageView({ customerId: 'H-TEST', period: 'weekly', date: '2026-07-15' });
    assert.equal(view.observedDays, 6);
    assert.deepEqual(view.bands.map((band) => band.kwh), [null, null, null]);
  });

  it('identifies estimated meter intervals in the selected period', async () => {
    const rows = datedRows('2026-07-13', 7).map((row) => ({ ...row, quality: row.date === '2026-07-15' ? 'estimated' : 'measured' }));
    serve(rows);
    const view = await getUsageView({ customerId: 'H-TEST', period: 'weekly', date: '2026-07-15' });
    assert.equal(view.hasEstimatedReadings, true);
    assert.match(view.points[2].tooltipLabel, /estimated reads/);
  });

  it('returns an empty selected period with availability and demo provenance', async () => {
    serve(datedRows('2026-07-01', 21), 'demo');
    const view = await getUsageView({ customerId: 'H-TEST', period: 'weekly', date: '2026-09-16' });
    assert.equal(view.totalKwh, null);
    assert.equal(view.points.length, 7);
    assert.ok(view.points.every((point) => point.kwh === null));
    assert.equal(view.availableTo, '2026-07-21');
    assert.equal(view.dateSource, 'demo');
  });

  it('shows four real monthly slots but totals only the selected month', async () => {
    serve([...datedRows('2026-06-01', 30), ...datedRows('2026-07-01', 21)]);
    const view = await getUsageView({ customerId: 'H-TEST', period: 'monthly', date: '2026-07-15' });
    assert.deepEqual(view.points.map((point) => point.axisLabel), ['Apr', 'May', 'Jun', 'Jul']);
    assert.deepEqual(view.points.map((point) => point.kwh), [null, null, 465, 231]);
    assert.equal(view.totalKwh, 231);
    assert.equal(view.totalCostNzd, 69.3);
    assert.equal(view.observedDays, 21);
    assert.equal(view.trendPercent, null);
  });
});
