import type { components } from '../api';

export type UsageSeries = components['schemas']['HouseholdUsageSeries'];
export type SeriesPeriod = 'daily' | 'weekly' | 'monthly';

export function isoDay(value: string): Date {
  const day = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
    throw new Error('Usage has an invalid date.');
  }
  return day;
}

function dateValue(day: Date) { return day.toISOString().slice(0, 10); }

export function usageRange(period: SeriesPeriod, selected: string) {
  const day = isoDay(selected);
  if (period === 'daily') return { start: selected, end: selected };
  if (period === 'weekly') {
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    const start = dateValue(day);
    day.setUTCDate(day.getUTCDate() + 6);
    return { start, end: dateValue(day) };
  }
  // Four calendar-month bars; the selected month's total is calculated separately.
  return {
    start: dateValue(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 3, 1, 12))),
    end: dateValue(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0, 12))),
  };
}

function nonnegative(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Usage has an invalid ${field}.`);
}

export function validateUsageSeries(value: unknown, customerId: string, range: { start: string; end: string }): UsageSeries {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Usage response is invalid.');
  const row = value as Partial<UsageSeries>;
  if (row.customer_id !== customerId) throw new Error('Usage response belongs to a different customer.');
  if (!Array.isArray(row.daily_dates) || !Array.isArray(row.daily_kwh) || row.daily_dates.length !== row.daily_kwh.length) throw new Error('Usage dates and readings do not match.');
  row.daily_dates.forEach((day, index) => {
    if (typeof day !== 'string') throw new Error('Usage date is invalid.');
    isoDay(day);
    if (day < range.start || day > range.end || (index > 0 && day <= row.daily_dates![index - 1]!)) throw new Error('Usage dates are outside the requested range or not unique and ordered.');
  });
  row.daily_kwh.forEach((reading) => nonnegative(reading, 'daily reading'));
  if (!Array.isArray(row.daily_quality) || row.daily_quality.length !== row.daily_dates.length || row.daily_quality.some((quality) => !['measured', 'estimated', 'demo'].includes(quality))) throw new Error('Usage reading quality is missing or invalid.');
  for (const field of ['daily_peak_kwh', 'daily_off_peak_kwh', 'daily_night_kwh'] as const) {
    if (!Array.isArray(row[field]) || row[field]!.length !== row.daily_dates.length) throw new Error(`Usage has an invalid ${field}.`);
    row[field]!.forEach((reading) => { if (reading !== null) nonnegative(reading, field); });
  }
  nonnegative(row.total_kwh, 'total usage');
  nonnegative(row.estimated_cost_nzd, 'estimated cost');
  if (Math.abs(row.daily_kwh.reduce((sum, reading) => sum + reading, 0) - row.total_kwh!) > 0.051) throw new Error('Usage total does not match the dated readings.');
  if (typeof row.date_source !== 'string' || !row.date_source) throw new Error('Usage source is missing.');
  for (const day of [row.available_from, row.available_to]) if (day != null) isoDay(day);
  if (row.available_from && row.available_to && row.available_from > row.available_to) throw new Error('Usage availability range is invalid.');
  return row as UsageSeries;
}

export function usageSource(series: Pick<UsageSeries, 'date_source' | 'daily_quality'>) {
  const demo = series.date_source === 'demo' || series.daily_quality.includes('demo');
  return {
    isDemo: demo,
    label: demo ? 'Demo usage · illustrative estimated cost' : series.daily_quality.includes('estimated') ? 'Includes estimated readings · estimated cost' : 'Daily meter totals · estimated cost',
  };
}

export function selectedIndexes(series: UsageSeries, period: SeriesPeriod, selected: string) {
  return series.daily_dates.flatMap((day, index) => period !== 'monthly' || day.slice(0, 7) === selected.slice(0, 7) ? [index] : []);
}

export function selectedTotals(series: UsageSeries, period: SeriesPeriod, selected: string) {
  const indexes = selectedIndexes(series, period, selected);
  if (!indexes.length) return { kwh: null, costNzd: null };
  const kwh = indexes.reduce((sum, index) => sum + series.daily_kwh[index]!, 0);
  return { kwh, costNzd: series.total_kwh > 0 ? kwh * series.estimated_cost_nzd / series.total_kwh : 0 };
}
