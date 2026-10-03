import type { components } from '../api';

export type UsageSeries = components['schemas']['HouseholdUsageSeries'];
export type SeriesPeriod = 'daily' | 'weekly' | 'monthly';

export function usageUnitRate(series: UsageSeries) {
  if (!series.daily_dates.length) return null;
  return series.total_kwh > 0 ? series.estimated_cost_nzd / series.total_kwh : series.estimated_cost_nzd === 0 ? 0 : null;
}

/** Daily totals cannot recover a customer's time-of-use split. */
export function usageBandReading(series: UsageSeries, indexes: number[], values: (number | null)[]) {
  const demoBands = series.band_data_source === 'demo' && series.date_source === 'demo';
  const quality = demoBands ? 'demo' : 'measured';
  const complete = (demoBands || series.band_data_source === 'measured') && indexes.length > 0 && indexes.every(index => series.daily_quality[index] === quality && values[index] != null);
  if (complete) return { kwh: indexes.reduce((sum, index) => sum + values[index]!, 0), reason: demoBands ? 'Illustrative demo interval profile' : null };
  const demo = series.date_source === 'demo' || indexes.some(index => series.daily_quality[index] === 'demo');
  return { kwh: null, reason: demo ? 'Demo daily totals do not include measured time-band readings.' : 'Measured time-band readings are missing or estimated for the selected dates.' };
}

/** Keep missing dates/months in their calendar slots; never plot them as zero. */
export function usageChartPoints(series: UsageSeries, period: 'weekly' | 'monthly', selected: string) {
  const range = usageRange(period, selected);
  const rate = series.total_kwh > 0 ? series.estimated_cost_nzd / series.total_kwh : 0;
  const byDate = new Map(series.daily_dates.map((day, index) => [day, index]));
  const day = isoDay(range.start);
  const points: { axisLabel: string; tooltipLabel: string; kwh: number | null; costNzd: number | null }[] = [];
  while (dateValue(day) <= range.end) {
    const date = dateValue(day);
    if (period === 'weekly') {
      const index = byDate.get(date);
      const kwh = index === undefined ? null : series.daily_kwh[index]!;
      points.push({ axisLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getUTCDay()]!, tooltipLabel: `${date} · ${index === undefined ? 'missing' : series.daily_quality[index]}`, kwh, costNzd: kwh === null ? null : kwh * rate });
      day.setUTCDate(day.getUTCDate() + 1);
    } else {
      const indexes = series.daily_dates.flatMap((value, index) => value.slice(0, 7) === date.slice(0, 7) ? [index] : []);
      const kwh = indexes.length ? indexes.reduce((sum, index) => sum + series.daily_kwh[index]!, 0) : null;
      const expected = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      points.push({ axisLabel: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][day.getUTCMonth()]!, tooltipLabel: `${date.slice(0, 7)} · ${indexes.length}/${expected} days`, kwh, costNzd: kwh === null ? null : kwh * rate });
      day.setUTCMonth(day.getUTCMonth() + 1);
    }
  }
  return points;
}

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

export function usageCoverage(series: UsageSeries, period: SeriesPeriod, selected: string) {
  const range = usageRange(period, selected);
  // The headline covers the selected month, not all four chart months.
  const start = period === 'monthly' ? `${selected.slice(0, 7)}-01` : range.start;
  const expectedDays = Math.round((isoDay(range.end).getTime() - isoDay(start).getTime()) / 86_400_000) + 1;
  const days = selectedIndexes(series, period, selected).length;
  return { days, expectedDays, complete: days === expectedDays };
}

export function canOverlayUsage(series: UsageSeries, previous: UsageSeries, period: SeriesPeriod, selected: string, compared: string) {
  const coversWindow = (row: UsageSeries, date: string) => {
    const range = usageRange(period, date);
    const expected = Math.round((isoDay(range.end).getTime() - isoDay(range.start).getTime()) / 86_400_000) + 1;
    return row.daily_dates.length === expected;
  };
  // A missing weekday or month must not shift the remaining readings into
  // another date's chart slot. Render only complete, matching relative windows.
  return coversWindow(series, selected) && coversWindow(previous, compared);
}

export function selectedTotals(series: UsageSeries, period: SeriesPeriod, selected: string) {
  const indexes = selectedIndexes(series, period, selected);
  if (!indexes.length) return { kwh: null, costNzd: null };
  const kwh = indexes.reduce((sum, index) => sum + series.daily_kwh[index]!, 0);
  return { kwh, costNzd: series.total_kwh > 0 ? kwh * series.estimated_cost_nzd / series.total_kwh : 0 };
}

export function usageTrendPercent(series: UsageSeries, previous: UsageSeries, period: SeriesPeriod, selected: string, compared: string) {
  if (!usageCoverage(series, period, selected).complete || !usageCoverage(previous, period, compared).complete) return null;
  const currentKwh = selectedTotals(series, period, selected).kwh;
  const previousKwh = selectedTotals(previous, period, compared).kwh;
  return currentKwh !== null && previousKwh ? (currentKwh - previousKwh) / previousKwh * 100 : null;
}
