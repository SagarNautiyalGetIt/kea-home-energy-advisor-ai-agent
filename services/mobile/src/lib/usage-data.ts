import { hourlyUsage, usage as fixtureUsage } from '@/data/mock';
import { apiFetch } from '@/lib/backend-client';

export type UsagePeriod = 'daily' | 'weekly' | 'monthly';
export type UsageBandKey = 'peak' | 'offPeak' | 'night';

export type UsagePoint = {
  axisLabel: string;
  tooltipLabel: string;
  kwh: number | null;
  costNzd: number | null;
};

export type UsageBand = {
  key: UsageBandKey;
  label: string;
  window: string | null;
  kwh: number | null;
  costNzd: number | null;
};

export type UsageViewData = {
  period: UsagePeriod;
  selectedDate: string;
  sourcePeriod: string;
  points: UsagePoint[];
  comparisonPoints: UsagePoint[] | null;
  totalKwh: number | null;
  totalCostNzd: number | null;
  trendPercent: number | null;
  observedDays: number | null;
  expectedDays: number | null;
  bands: UsageBand[];
  availableFrom: string | null;
  availableTo: string | null;
  isDemo: boolean;
  dateSource: 'mart' | 'demo' | 'preview';
  hasEstimatedReadings: boolean;
  bandDataSource: string | null;
};

export type UsageQuery = {
  customerId: string;
  period: UsagePeriod;
  date: string;
  compareDate?: string;
  signal?: AbortSignal;
};

/** Dated series returned by /api/households/{customer_id}/usage-series. */
type UsageSeriesApi = {
  customer_id: string;
  daily_kwh: number[];
  daily_dates: string[];
  daily_quality: ('measured' | 'estimated' | 'demo')[];
  daily_peak_kwh: (number | null)[];
  daily_off_peak_kwh: (number | null)[];
  daily_night_kwh: (number | null)[];
  band_data_source: string | null;
  date_source: 'mart' | 'demo';
  total_kwh: number;
  estimated_cost_nzd: number;
  available_from: string | null;
  available_to: string | null;
};

const demoTariffNzd = 0.3;
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bandDefinitions: Pick<UsageBand, 'key' | 'label' | 'window'>[] = [
  { key: 'peak', label: 'Peak usage', window: '7–11 AM · 5–9 PM' },
  { key: 'offPeak', label: 'Off-peak usage', window: '11 AM–5 PM · 9–11 PM' },
  { key: 'night', label: 'Night usage', window: '11 PM–7 AM' },
];

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function toIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function addDays(value: Date, amount: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function shortDate(value: Date) {
  return `${value.getDate()} ${shortMonths[value.getMonth()]}`;
}

function startOfWeek(value: Date) {
  return addDays(value, -((value.getDay() + 6) % 7));
}

function finiteNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Usage response has an invalid ${field}.`);
  return value;
}

function validateSeries(value: unknown, customerId: string): UsageSeriesApi {
  if (!value || typeof value !== 'object') throw new Error('Usage response is not an object.');
  const row = value as Partial<UsageSeriesApi>;
  if (row.customer_id !== customerId || !Array.isArray(row.daily_kwh)) throw new Error('Usage response is missing required fields or belongs to another customer.');
  row.daily_kwh.forEach((reading) => finiteNumber(reading, 'daily_kwh reading'));
  if (!Array.isArray(row.daily_dates) || row.daily_dates.length !== row.daily_kwh.length || row.daily_dates.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) throw new Error('Usage response has invalid reading dates.');
  if (!Array.isArray(row.daily_quality) || row.daily_quality.length !== row.daily_kwh.length || row.daily_quality.some((quality) => quality !== 'measured' && quality !== 'estimated' && quality !== 'demo')) throw new Error('Usage response has invalid reading quality.');
  for (const field of ['daily_peak_kwh', 'daily_off_peak_kwh', 'daily_night_kwh'] as const) {
    if (!Array.isArray(row[field]) || row[field]?.length !== row.daily_kwh.length) throw new Error(`Usage response has an invalid ${field}.`);
    row[field]?.forEach((reading) => { if (reading !== null) finiteNumber(reading, `${field} reading`); });
  }
  finiteNumber(row.total_kwh, 'total_kwh');
  finiteNumber(row.estimated_cost_nzd, 'estimated_cost_nzd');
  if (row.date_source !== 'mart' && row.date_source !== 'demo') throw new Error('Usage response has no date provenance.');
  for (const field of ['available_from', 'available_to'] as const) {
    if (row[field] !== null && (typeof row[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[field]))) throw new Error(`Usage response has an invalid ${field}.`);
  }
  return row as UsageSeriesApi;
}

function apiReadings(summary: UsageSeriesApi) {
  return summary.daily_kwh.map((kwh, index) => ({ date: parseIsoDate(summary.daily_dates[index]!), kwh, quality: summary.daily_quality[index]! }));
}

function selectApiPoints(summary: UsageSeriesApi, period: UsagePeriod, selected: string): UsagePoint[] {
  const selectedDate = parseIsoDate(selected);
  const weekStart = startOfWeek(selectedDate);
  // The API reports an estimated cost for its requested range, not a daily tariff.
  // A single effective rate is the only supported cost estimate for each point.
  const unitRate = summary.total_kwh > 0 ? summary.estimated_cost_nzd / summary.total_kwh : null;
  const allReadings = apiReadings(summary);
  const byDate = new Map(allReadings.map((reading) => [toIsoDate(reading.date), reading]));
  if (period === 'daily') {
    const reading = byDate.get(selected);
    if (!reading) return [];
    // This endpoint has one reading per day. Never stretch it into fictional hours.
    return [{
      axisLabel: shortDate(selectedDate),
      tooltipLabel: `${shortDate(selectedDate)} · daily total${reading.quality === 'estimated' ? ' · estimated reads' : ''}`,
      kwh: reading.kwh,
      costNzd: unitRate === null ? null : reading.kwh * unitRate,
    }];
  }
  if (period === 'monthly') {
    const buckets = new Map<string, { kwh: number; estimated: boolean }>();
    allReadings.forEach(({ date, kwh, quality }) => {
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const prior = buckets.get(key);
      buckets.set(key, { kwh: (prior?.kwh ?? 0) + kwh, estimated: (prior?.estimated ?? false) || quality === 'estimated' });
    });
    return Array.from({ length: 4 }, (_, index) => {
      const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 3 + index, 1);
      const bucket = buckets.get(`${start.getFullYear()}-${start.getMonth()}`);
      const kwh = bucket?.kwh ?? null;
      return {
        axisLabel: shortMonths[start.getMonth()] ?? '',
        tooltipLabel: `${monthNames[start.getMonth()]} ${start.getFullYear()}${kwh === null ? ' · no reading' : bucket?.estimated ? ' · includes estimated reads' : ''}`,
        kwh,
        costNzd: kwh === null || unitRate === null ? null : kwh * unitRate,
      };
    });
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const reading = byDate.get(toIsoDate(date));
    const kwh = reading?.kwh ?? null;
    return {
      axisLabel: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index] ?? '',
      tooltipLabel: `${shortDate(date)}${kwh === null ? ' · no reading' : reading?.quality === 'estimated' ? ' · estimated reads' : ''}`,
      kwh,
      costNzd: kwh === null || unitRate === null ? null : kwh * unitRate,
    };
  });
}


function selectApiBands(summary: UsageSeriesApi, period: UsagePeriod, selected: string): UsageBand[] {
  const selectedDate = parseIsoDate(selected);
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  const unitRate = summary.total_kwh > 0 ? summary.estimated_cost_nzd / summary.total_kwh : null;
  const series: Record<UsageBandKey, (number | null)[]> = {
    peak: summary.daily_peak_kwh || [],
    offPeak: summary.daily_off_peak_kwh || [],
    night: summary.daily_night_kwh || [],
  };
  const selectedIndexes = apiReadings(summary).flatMap(({ date }, index) => {
    const included = period === 'daily'
      ? toIsoDate(date) === selected
      : period === 'weekly'
        ? date >= weekStart && date <= weekEnd
        : date.getFullYear() === selectedDate.getFullYear() && date.getMonth() === selectedDate.getMonth();
    return included ? [index] : [];
  });
  const expectedDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();

  return bandDefinitions.map((band) => {
    const values = selectedIndexes.map((index) => series[band.key]?.[index]);
    // A daily meter total cannot reveal a time-of-use split. A partially observed
    // period cannot be summed into a complete band either.
    const hasMeasured = summary.band_data_source === 'measured'
      && selectedIndexes.length === expectedDays
      && values.every((value) => value !== null && value !== undefined);
    const kwh = hasMeasured ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    return { ...band, kwh, costNzd: kwh !== null && unitRate !== null ? Number((kwh * unitRate).toFixed(2)) : null };
  });
}

async function fetchJson(path: string, signal?: AbortSignal) {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error(`Usage could not be loaded (${response.status}).`);
  return response.json() as Promise<unknown>;
}

function periodBounds(period: UsagePeriod, selected: string) {
  const day = parseIsoDate(selected);
  if (period === 'daily') return { start: day, end: day };
  if (period === 'weekly') {
    const start = startOfWeek(day);
    return { start, end: addDays(start, 6) };
  }
  return { start: new Date(day.getFullYear(), day.getMonth(), 1), end: new Date(day.getFullYear(), day.getMonth() + 1, 0) };
}

function previousDate(period: UsagePeriod, selected: string) {
  const day = parseIsoDate(selected);
  return toIsoDate(period === 'monthly'
    ? new Date(day.getFullYear(), day.getMonth() - 1, 1)
    : addDays(day, period === 'weekly' ? -7 : -1));
}

function seriesPath(customerPath: string, period: UsagePeriod, selected: string) {
  const current = periodBounds(period, selected);
  const historyStart = period === 'monthly'
    ? new Date(current.start.getFullYear(), current.start.getMonth() - 3, 1)
    : periodBounds(period, previousDate(period, selected)).start;
  return `${customerPath}/usage-series?start=${toIsoDate(historyStart)}&end=${toIsoDate(current.end)}`;
}

function periodTotal(series: UsageSeriesApi, period: UsagePeriod, selected: string) {
  const { start, end } = periodBounds(period, selected);
  const days = apiReadings(series).filter(({ date }) => date >= start && date <= end);
  const expectedDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : end.getDate();
  return { kwh: days.length ? days.reduce((sum, day) => sum + day.kwh, 0) : null, observedDays: days.length, expectedDays, complete: days.length === expectedDays, hasEstimatedReadings: days.some((day) => day.quality === 'estimated') };
}

async function loadApiUsage(query: UsageQuery): Promise<UsageViewData> {
  const customerPath = `/api/households/${encodeURIComponent(query.customerId)}`;
  const [summaryValue, comparisonValue] = await Promise.all([
    fetchJson(seriesPath(customerPath, query.period, query.date), query.signal),
    query.compareDate ? fetchJson(seriesPath(customerPath, query.period, query.compareDate), query.signal) : Promise.resolve(null),
  ]);
  const summary = validateSeries(summaryValue, query.customerId);
  const comparison = comparisonValue === null ? null : validateSeries(comparisonValue, query.customerId);

  const points = selectApiPoints(summary, query.period, query.date);
  const comparisonPoints = comparison && query.compareDate ? selectApiPoints(comparison, query.period, query.compareDate) : null;
  const selectedTotal = periodTotal(summary, query.period, query.date);
  const previousTotal = query.compareDate && comparison
    ? periodTotal(comparison, query.period, query.compareDate)
    : periodTotal(summary, query.period, previousDate(query.period, query.date));
  const unitRate = summary.total_kwh > 0 ? summary.estimated_cost_nzd / summary.total_kwh : null;
  const trendPercent = selectedTotal.complete && previousTotal.complete && selectedTotal.kwh !== null && previousTotal.kwh
    ? (selectedTotal.kwh - previousTotal.kwh) / previousTotal.kwh * 100 : null;

  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: summary.date_source === 'demo' ? 'Demo scenario' : 'Meter readings',
    points,
    comparisonPoints: comparisonPoints?.some((point) => point.kwh !== null) ? comparisonPoints : null,
    totalKwh: selectedTotal.kwh,
    totalCostNzd: selectedTotal.kwh !== null && unitRate !== null ? Number((selectedTotal.kwh * unitRate).toFixed(2)) : null,
    trendPercent,
    observedDays: selectedTotal.observedDays,
    expectedDays: selectedTotal.expectedDays,
    bands: selectApiBands(summary, query.period, query.date),
    availableFrom: summary.available_from,
    availableTo: summary.available_to,
    isDemo: false,
    dateSource: summary.date_source,
    hasEstimatedReadings: selectedTotal.hasEstimatedReadings,
    bandDataSource: summary.band_data_source ?? null,
  };
}

function fixturePoints(period: UsagePeriod, selectedDate: string, previous = false): UsagePoint[] {
  const source = fixtureUsage[period];
  const readings = period === 'daily'
    ? hourlyUsage.map((value) => previous ? value * 0.92 : value)
    : previous ? source.previous : source.values;
  const monthlyLabels = period === 'monthly'
    ? Array.from({ length: readings.length }, (_, index) => {
      const selected = parseIsoDate(selectedDate);
      const month = new Date(selected.getFullYear(), selected.getMonth() + index - readings.length + 1, 1);
      return {
        axis: shortMonths[month.getMonth()] ?? '',
        tooltip: `${monthNames[month.getMonth()]} ${month.getFullYear()}`,
      };
    })
    : null;
  return readings.map((kwh, index) => ({
    axisLabel: period === 'daily'
      ? index % 3 === 0 ? index === 0 ? '12 AM' : index < 12 ? `${index} AM` : index === 12 ? '12 PM' : `${index - 12} PM` : ''
      : monthlyLabels?.[index]?.axis ?? source.labels[index] ?? String(index + 1),
    tooltipLabel: period === 'daily'
      ? `${shortDate(parseIsoDate(selectedDate))}, ${index === 0 ? '12 AM' : index < 12 ? `${index} AM` : index === 12 ? '12 PM' : `${index - 12} PM`}`
      : monthlyLabels?.[index]?.tooltip ?? `${shortDate(parseIsoDate(selectedDate))}, ${source.labels[index] ?? index + 1}`,
    kwh,
    costNzd: kwh * demoTariffNzd,
  }));
}

function loadDemoUsage(query: UsageQuery): UsageViewData {
  const points = fixturePoints(query.period, query.date);
  const previous = fixturePoints(query.period, query.compareDate ?? query.date, true);
  const totalKwh = points.reduce((sum, point) => sum + (point.kwh ?? 0), 0);
  const previousTotal = previous.reduce((sum, point) => sum + (point.kwh ?? 0), 0);
  const bands = bandDefinitions.map((band) => ({ ...band, kwh: null, costNzd: null }));

  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: 'Local preview',
    points,
    comparisonPoints: query.compareDate ? previous : null,
    totalKwh,
    totalCostNzd: totalKwh * demoTariffNzd,
    trendPercent: previousTotal ? ((totalKwh - previousTotal) / previousTotal) * 100 : null,
    observedDays: null,
    expectedDays: null,
    bands,
    availableFrom: null,
    availableTo: null,
    isDemo: true,
    dateSource: 'preview',
    hasEstimatedReadings: false,
    bandDataSource: null,
  };
}

export async function getUsageView(query: UsageQuery): Promise<UsageViewData> {
  if (!query.customerId) throw new Error('A signed-in customer is required to load usage.');
  if (process.env.EXPO_PUBLIC_USE_REAL_DATA === 'false') return loadDemoUsage(query);
  return loadApiUsage(query);
}
