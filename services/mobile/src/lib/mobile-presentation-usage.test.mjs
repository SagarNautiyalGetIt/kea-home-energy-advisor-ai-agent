import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMobilePresentationUsage } from './mobile-presentation-usage.ts';

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('hourly, weekly and monthly selections describe the same calendar days and totals', async () => {
  const day = await getMobilePresentationUsage({ period: 'daily', date: '2026-10-07' });
  const week = await getMobilePresentationUsage({ period: 'weekly', date: '2026-10-07' });
  const month = await getMobilePresentationUsage({ period: 'monthly', date: '2026-10-07' });
  assert.equal(day.points.length, 24);
  assert.equal(week.points.length, 7);
  assert.equal(month.points.length, 31);
  assert.equal(day.points[0].tooltipLabel, '7 Oct 2026, 12 AM');
  assert.equal(day.points.at(-1).tooltipLabel, '7 Oct 2026, 11 PM');
  assert.equal(week.points[0].tooltipLabel, '5 Oct 2026');
  assert.equal(week.points.at(-1).tooltipLabel, '11 Oct 2026');
  assert.equal(month.points[0].tooltipLabel, '1 Oct 2026');
  assert.equal(month.points.at(-1).tooltipLabel, '31 Oct 2026');
  close(day.totalKwh, week.points[2].kwh);
  close(day.totalKwh, month.points[6].kwh);
  close(day.totalCostNzd, week.points[2].costNzd);
  close(day.totalCostNzd, month.points[6].costNzd);
  for (const view of [day, week, month]) {
    assert.ok(view.points.every((point) => point.kwh > 0 && point.costNzd > 0));
    close(view.totalKwh, view.points.reduce((sum, point) => sum + point.kwh, 0));
    close(view.totalCostNzd, view.points.reduce((sum, point) => sum + point.costNzd, 0));
    close(view.totalKwh, view.bands.reduce((sum, band) => sum + band.kwh, 0));
    close(view.totalCostNzd, view.bands.reduce((sum, band) => sum + band.costNzd, 0));
  }
});

test('month selections cover leap years and every real month length', async () => {
  for (const [date, length, end] of [
    ['2026-02-15', 28, '28 Feb 2026'],
    ['2028-02-15', 29, '29 Feb 2028'],
    ['2026-09-15', 30, '30 Sep 2026'],
    ['2026-10-15', 31, '31 Oct 2026'],
  ]) {
    const view = await getMobilePresentationUsage({ period: 'monthly', date });
    assert.equal(view.points.length, length);
    assert.equal(view.points.at(-1).tooltipLabel, end);
  }
});

test('calendar windows stay stable across year rollover and daylight saving dates', async () => {
  const week = await getMobilePresentationUsage({ period: 'weekly', date: '2027-01-01' });
  assert.equal(week.points[0].tooltipLabel, '28 Dec 2026');
  assert.equal(week.points.at(-1).tooltipLabel, '3 Jan 2027');
  for (const date of ['2026-04-05', '2026-09-27']) {
    const day = await getMobilePresentationUsage({ period: 'daily', date });
    assert.equal(day.selectedDate, date);
    assert.equal(day.points.length, 24);
  }
});

test('refreshes are deterministic and comparisons keep their selected dates and complete totals', async () => {
  const query = { period: 'monthly', date: '2026-02-15', compareDate: '2026-01-15' };
  const current = await getMobilePresentationUsage(query);
  assert.deepEqual(current, await getMobilePresentationUsage(query));
  assert.equal(current.points.length, 28);
  assert.equal(current.comparisonPoints.length, 31);
  assert.equal(current.comparisonPoints.at(-1).tooltipLabel, '31 Jan 2026');
  const previous = await getMobilePresentationUsage({ period: 'monthly', date: query.compareDate });
  close(previous.totalKwh, current.comparisonPoints.reduce((sum, point) => sum + point.kwh, 0));
  close(current.trendPercent, ((current.totalKwh - previous.totalKwh) / previous.totalKwh) * 100);
  const otherDay = await getMobilePresentationUsage({ period: 'daily', date: '2026-02-16' });
  const day = await getMobilePresentationUsage({ period: 'daily', date: '2026-02-15' });
  assert.notDeepEqual(otherDay.points.map((point) => point.kwh), day.points.map((point) => point.kwh));
});

test('invalid dates and aborted selections cannot produce a view', async () => {
  for (const date of ['2026-02-30', '2026-13-01', '2026-00-10', 'not-a-date']) {
    await assert.rejects(getMobilePresentationUsage({ period: 'daily', date }), /valid usage date/);
  }
  const controller = new AbortController();
  const pending = getMobilePresentationUsage({ period: 'weekly', date: '2026-10-07', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});
