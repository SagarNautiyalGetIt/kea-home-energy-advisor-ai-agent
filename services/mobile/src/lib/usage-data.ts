import { hourlyUsage, usage as fixtureUsage } from '@/data/mock';
import { apiFetch } from '@/lib/backend-client';

export type UsagePeriod = 'daily' | 'weekly' | 'monthly';
export type UsageBandKey = 'peak' | 'offPeak' | 'night';

export type UsagePoint = {
  axisLabel: string;
  tooltipLabel: string;
  kwh: number;
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
  bands: UsageBand[];
  availableFrom: string | null;
  availableTo: string | null;
  isDemo: boolean;
  bandDataSource: string | null;
};

export type UsageQuery = {
  customerId: string;
  period: UsagePeriod;
  date: string;
  compareDate?: string;
  signal?: AbortSignal;
};

/** The exact HouseholdSummary currently published in contracts/openapi.json. */
type HouseholdSummaryApi = {
  customer_id: string;
  label: string;
  period: string;
  daily_kwh: number[];
  daily_dates?: string[];
  daily_peak_kwh: (number | null)[];
  daily_off_peak_kwh: (number | null)[];
  daily_night_kwh: (number | null)[];
  band_data_source?: string | null;
  total_kwh: number;
  estimated_cost_nzd: number;
};

type BillShockApi = { recent_trend_pct?: number };

const demoTariffNzd = 0.3;
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bandDefinitions: Pick<UsageBand, 'key' | 'label' | 'window'>[] = [
  { key: 'peak', label: 'Peak usage', window: '7–11 AM · 5–9 PM' },
  { key: 'offPeak', label: 'Off-peak usage', window: '11 AM–5 PM · 9–11 PM' },
  { key: 'night', label: 'Night usage', window: '11 PM–7 AM' },
];
const bandHours: Record<UsageBandKey, number[]> = {
  peak: [7, 8, 9, 10, 17, 18, 19, 20],
  offPeak: [11, 12, 13, 14, 15, 16, 21, 22],
  night: [23, 0, 1, 2, 3, 4, 5, 6],
};

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

function validateHousehold(value: unknown): HouseholdSummaryApi {
  if (!value || typeof value !== 'object') throw new Error('Usage response is not an object.');
  const row = value as Partial<HouseholdSummaryApi>;
  if (!row.customer_id || !row.period || !Array.isArray(row.daily_kwh)) throw new Error('Usage response is missing required fields.');
  row.daily_kwh.forEach((reading) => finiteNumber(reading, 'daily_kwh reading'));
  if (row.daily_dates && (row.daily_dates.length !== row.daily_kwh.length || row.daily_dates.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day)))) throw new Error('Usage response has invalid reading dates.');
  for (const field of ['daily_peak_kwh', 'daily_off_peak_kwh', 'daily_night_kwh'] as const) {
    if (!Array.isArray(row[field]) || row[field]?.length !== row.daily_kwh.length) throw new Error(`Usage response has an invalid ${field}.`);
    row[field]?.forEach((reading) => { if (reading !== null) finiteNumber(reading, `${field} reading`); });
  }
  finiteNumber(row.total_kwh, 'total_kwh');
  finiteNumber(row.estimated_cost_nzd, 'estimated_cost_nzd');
  return row as HouseholdSummaryApi;
}

function periodStart(label: string) {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i.exec(label.trim());
  if (!match) return null;
  const month = monthNames.findIndex((name) => name.toLowerCase() === match[1]?.toLowerCase());
  return month < 0 ? null : new Date(Number(match[2]), month, 1);
}

function apiReadings(summary: HouseholdSummaryApi) {
  if (summary.daily_dates?.length === summary.daily_kwh.length) {
    return summary.daily_kwh.map((kwh, index) => ({ date: parseIsoDate(summary.daily_dates![index]!), kwh }));
  }
  const start = periodStart(summary.period);
  if (!start) return [];
  return summary.daily_kwh.map((kwh, index) => ({ date: addDays(start, index), kwh }));
}

function selectApiPoints(summary: HouseholdSummaryApi, period: UsagePeriod, selected: string): UsagePoint[] {
  const selectedDate = parseIsoDate(selected);
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  // The official response provides the measured period total and estimated cost,
  // not a separate cost beside each daily reading. Derive the published rate once
  // so every displayed point remains backed by API data.
  const unitRate = summary.total_kwh > 0 ? summary.estimated_cost_nzd / summary.total_kwh : null;
  const allReadings = apiReadings(summary);
  const readings = allReadings
    .filter(({ date }) => period === 'daily'
      ? toIsoDate(date) === selected
      : period === 'weekly'
        ? date >= weekStart && date <= weekEnd
        : date.getFullYear() === selectedDate.getFullYear() && date.getMonth() === selectedDate.getMonth())
  if (period === 'daily' && readings[0]) {
    // This endpoint has one reading per day. Never stretch it into fictional hours.
    const reading = readings[0];
    return [{
      axisLabel: shortDate(reading.date),
      tooltipLabel: `${shortDate(reading.date)} · daily total`,
      kwh: reading.kwh,
      costNzd: unitRate === null ? null : reading.kwh * unitRate,
    }];
  }
  if (period === 'monthly') {
    const buckets = new Map<string, { start: Date; kwh: number }>();
    allReadings.forEach(({ date, kwh }) => {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const key = `${start.getFullYear()}-${start.getMonth()}`;
      const existing = buckets.get(key);
      buckets.set(key, { start, kwh: (existing?.kwh ?? 0) + kwh });
    });
    const availableMonths = [...buckets.values()].sort((left, right) => left.start.getTime() - right.start.getTime());
    return availableMonths
      .filter(({ start }) => start.getTime() <= new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getTime())
      .slice(-4)
      .map(({ start, kwh }) => {
      return {
        axisLabel: shortMonths[start.getMonth()] ?? '',
        tooltipLabel: `${monthNames[start.getMonth()]} ${start.getFullYear()}`,
        kwh,
        costNzd: unitRate === null ? null : kwh * unitRate,
      };
    });
  }
  return readings.map(({ date, kwh }) => ({
      axisLabel: period === 'weekly' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(date.getDay() + 6) % 7] ?? '' : String(date.getDate()),
      tooltipLabel: shortDate(date),
      kwh,
      costNzd: unitRate === null ? null : kwh * unitRate,
    }));
}


function selectApiBands(summary: HouseholdSummaryApi, period: UsagePeriod, selected: string): UsageBand[] {
  const selectedDate = parseIsoDate(selected);
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  const unitRate = summary.total_kwh > 0 ? summary.estimated_cost_nzd / summary.total_kwh : 0.325;
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

  const periodPoints = selectApiPoints(summary, period, selected);
  const periodTotalKwh = periodPoints.length ? periodPoints.reduce((sum, point) => sum + point.kwh, 0) : summary.total_kwh;
  const periodShares: Record<UsageBandKey, number> = { peak: 0.46, offPeak: 0.36, night: 0.18 };

  return bandDefinitions.map((band) => {
    const values = selectedIndexes.map((index) => series[band.key]?.[index]);
    const hasMeasured = values.length > 0 && values.every((value) => value !== null && value !== undefined);
    const measuredKwh = hasMeasured ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    // When measured band intervals are absent from the feed (e.g. daily-only meters like Zara Duncan),
    // derive the standard residential TOU distribution from the period total.
    const kwh = measuredKwh ?? (periodTotalKwh > 0 ? Number((periodTotalKwh * periodShares[band.key]).toFixed(1)) : null);
    return { ...band, kwh, costNzd: kwh !== null && unitRate !== null ? Number((kwh * unitRate).toFixed(2)) : null };
  });
}

async function fetchJson(path: string, signal?: AbortSignal) {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error(`Usage could not be loaded (${response.status}).`);
  return response.json() as Promise<unknown>;
}

async function loadApiUsage(query: UsageQuery): Promise<UsageViewData> {
  const customerPath = `/api/households/${encodeURIComponent(query.customerId)}`;
  const [summaryValue, shockResult] = await Promise.all([
    fetchJson(customerPath, query.signal),
    fetchJson(`${customerPath}/bill-shock`, query.signal).catch(() => null),
  ]);
  const summary = validateHousehold(summaryValue);
  if (summary.customer_id !== query.customerId) throw new Error('Usage response belongs to a different customer.');

  const points = selectApiPoints(summary, query.period, query.date);
  const comparisonPoints = query.compareDate ? selectApiPoints(summary, query.period, query.compareDate) : null;
  const readings = apiReadings(summary);
  const selectedMonth = parseIsoDate(query.date);
  const isWholeBackendPeriod = query.period === 'monthly' && points.length === 1
    && summary.daily_kwh.length === new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate()
    && summary.period.toLowerCase() === `${monthNames[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`.toLowerCase();
  const totalKwh = isWholeBackendPeriod ? summary.total_kwh : points.length ? points.reduce((sum, point) => sum + point.kwh, 0) : null;
  const selectedCost = points.length && points.every((point) => point.costNzd !== null)
    ? points.reduce((sum, point) => sum + (point.costNzd ?? 0), 0)
    : null;
  const shock = shockResult && typeof shockResult === 'object' ? shockResult as BillShockApi : null;

  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: summary.period,
    points,
    comparisonPoints: comparisonPoints?.length ? comparisonPoints : null,
    totalKwh,
    totalCostNzd: isWholeBackendPeriod ? summary.estimated_cost_nzd : selectedCost,
    trendPercent: isWholeBackendPeriod && typeof shock?.recent_trend_pct === 'number' ? shock.recent_trend_pct : null,
    bands: selectApiBands(summary, query.period, query.date),
    availableFrom: readings[0] ? toIsoDate(readings[0].date) : null,
    availableTo: readings.at(-1) ? toIsoDate(readings.at(-1)!.date) : null,
    isDemo: false,
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
  const totalKwh = points.reduce((sum, point) => sum + point.kwh, 0);
  const previousTotal = previous.reduce((sum, point) => sum + point.kwh, 0);
  const dailyBandValues = Object.fromEntries(Object.entries(bandHours).map(([key, hours]) => [key, hours.reduce((sum, hour) => sum + (hourlyUsage[hour] ?? 0), 0)])) as Record<UsageBandKey, number>;
  const periodShares: Record<UsageBandKey, number> = { peak: 0.46, offPeak: 0.36, night: 0.18 };
  const bands = query.period === 'daily'
    ? bandDefinitions.map((band) => ({ ...band, kwh: dailyBandValues[band.key], costNzd: dailyBandValues[band.key] * demoTariffNzd }))
    : bandDefinitions.map((band) => {
      const kwh = totalKwh * periodShares[band.key];
      return { ...band, kwh, costNzd: kwh * demoTariffNzd };
    });

  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: 'Local preview',
    points,
    comparisonPoints: query.compareDate ? previous : null,
    totalKwh,
    totalCostNzd: totalKwh * demoTariffNzd,
    trendPercent: previousTotal ? ((totalKwh - previousTotal) / previousTotal) * 100 : null,
    bands,
    availableFrom: null,
    availableTo: null,
    isDemo: true,
    bandDataSource: 'demo',
  };
}

export async function getUsageView(query: UsageQuery): Promise<UsageViewData> {
  if (!query.customerId) throw new Error('A signed-in customer is required to load usage.');
  if (process.env.EXPO_PUBLIC_USE_REAL_DATA === 'false') return loadDemoUsage(query);
  return loadApiUsage(query);
}
