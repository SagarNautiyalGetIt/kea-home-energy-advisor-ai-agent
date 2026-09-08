import { usage as fixtureUsage } from '@/data/mock';
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
  limitation: string | null;
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
  total_kwh: number;
  estimated_cost_nzd: number;
};

type BillShockApi = { recent_trend_pct?: number };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
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
  const start = periodStart(summary.period);
  if (!start) return [];
  return summary.daily_kwh.map((kwh, index) => ({ date: addDays(start, index), kwh }));
}

function selectApiPoints(summary: HouseholdSummaryApi, period: UsagePeriod, selected: string): UsagePoint[] {
  const selectedDate = parseIsoDate(selected);
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  return apiReadings(summary)
    .filter(({ date }) => period === 'daily'
      ? toIsoDate(date) === selected
      : period === 'weekly'
        ? date >= weekStart && date <= weekEnd
        : date.getFullYear() === selectedDate.getFullYear() && date.getMonth() === selectedDate.getMonth())
    .map(({ date, kwh }) => ({
      axisLabel: period === 'weekly' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(date.getDay() + 6) % 7] ?? '' : String(date.getDate()),
      tooltipLabel: shortDate(date),
      kwh,
      costNzd: null,
    }));
}

function emptyBands(): UsageBand[] {
  return bandDefinitions.map((band) => ({ ...band, kwh: null, costNzd: null }));
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
  const isWholeBackendPeriod = query.period === 'monthly' && points.length === summary.daily_kwh.length;
  const totalKwh = isWholeBackendPeriod ? summary.total_kwh : points.length ? points.reduce((sum, point) => sum + point.kwh, 0) : null;
  const shock = shockResult && typeof shockResult === 'object' ? shockResult as BillShockApi : null;

  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: summary.period,
    points,
    comparisonPoints: comparisonPoints?.length ? comparisonPoints : null,
    totalKwh,
    totalCostNzd: isWholeBackendPeriod ? summary.estimated_cost_nzd : null,
    trendPercent: isWholeBackendPeriod && typeof shock?.recent_trend_pct === 'number' ? shock.recent_trend_pct : null,
    bands: emptyBands(),
    availableFrom: readings[0] ? toIsoDate(readings[0].date) : null,
    availableTo: readings.at(-1) ? toIsoDate(readings.at(-1)!.date) : null,
    isDemo: false,
    limitation: query.period === 'daily'
      ? 'The current API provides daily totals, not hourly readings.'
      : query.period === 'weekly'
        ? 'Weekly cost and time-band totals are not provided by the current API.'
        : 'Time-band totals are not provided by the current API.',
  };
}

function fixturePoints(period: UsagePeriod, selectedDate: string, previous = false): UsagePoint[] {
  const source = fixtureUsage[period];
  const readings = previous ? source.previous : source.values;
  return readings.map((kwh, index) => ({
    axisLabel: source.labels[index] ?? String(index + 1),
    tooltipLabel: `${shortDate(parseIsoDate(selectedDate))}, ${source.labels[index] ?? index + 1}`,
    kwh,
    costNzd: kwh * demoTariffNzd,
  }));
}

function loadDemoUsage(query: UsageQuery): UsageViewData {
  const points = fixturePoints(query.period, query.date);
  const previous = fixturePoints(query.period, query.compareDate ?? query.date, true);
  const totalKwh = points.reduce((sum, point) => sum + point.kwh, 0);
  const previousTotal = previous.reduce((sum, point) => sum + point.kwh, 0);
  const dailyBandValues = Object.fromEntries(Object.entries(bandHours).map(([key, hours]) => [key, hours.reduce((sum, hour) => sum + (fixtureUsage.daily.values[hour] ?? 0), 0)])) as Record<UsageBandKey, number>;
  const bands = query.period === 'daily'
    ? bandDefinitions.map((band) => ({ ...band, kwh: dailyBandValues[band.key], costNzd: dailyBandValues[band.key] * demoTariffNzd }))
    : emptyBands();

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
    limitation: query.period === 'daily' ? null : 'Hourly time-band totals are not available in the weekly and monthly fixture.',
  };
}

export async function getUsageView(query: UsageQuery): Promise<UsageViewData> {
  if (!query.customerId) throw new Error('A signed-in customer is required to load usage.');
  if (!apiBaseUrl) return loadDemoUsage(query);
  return loadApiUsage(query);
}
