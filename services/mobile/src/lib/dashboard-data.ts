import { news, notifications } from '@/data/mock';
import { apiFetch } from '@/lib/backend-client';

export const dashboardNews = news;
export const dashboardNotifications = notifications;
export type DashboardNewsItem = (typeof dashboardNews)[number];

type HouseholdSummaryApi = {
  customer_id: string;
  label: string;
  period: string;
  daily_kwh: number[];
  total_kwh: number;
  estimated_cost_nzd: number;
};

type BillShockApi = {
  triggered: boolean;
  days_elapsed: number;
  usage_so_far_kwh: number;
  cost_so_far_nzd: number;
  projected_cycle_cost_nzd: number;
  recent_trend_pct: number;
};

export type DashboardViewData = {
  latestDayCostNzd: number | null;
  usageSoFarKwh: number | null;
  costSoFarNzd: number | null;
  projectedCycleCostNzd: number | null;
  todayKwh: number | null;
  todayValuesKwh: number[];
  todayTooltipLabels: string[];
  weeklyValuesKwh: number[];
  weeklyCostNzd: number | null;
  weeklyLabels: string[];
  weeklyDayLabels: string[];
  weeklyMonthLabels: string[];
  trendPercent: number | null;
  warningTriggered: boolean | null;
};

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function finite(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Dashboard response has an invalid ${field}.`);
  return value;
}

function validateHousehold(value: unknown, customerId: string): HouseholdSummaryApi {
  if (!value || typeof value !== 'object') throw new Error('Dashboard household response is invalid.');
  const row = value as Partial<HouseholdSummaryApi>;
  if (row.customer_id !== customerId || !row.period || !Array.isArray(row.daily_kwh)) throw new Error('Dashboard household response is incomplete.');
  row.daily_kwh.forEach((reading) => finite(reading, 'daily reading'));
  finite(row.total_kwh, 'total usage');
  finite(row.estimated_cost_nzd, 'estimated cost');
  return row as HouseholdSummaryApi;
}

function validateShock(value: unknown): BillShockApi {
  if (!value || typeof value !== 'object') throw new Error('Bill-shock response is invalid.');
  const row = value as Partial<BillShockApi>;
  if (typeof row.triggered !== 'boolean') throw new Error('Bill-shock response is incomplete.');
  finite(row.days_elapsed, 'days elapsed');
  finite(row.usage_so_far_kwh, 'usage so far');
  finite(row.cost_so_far_nzd, 'cost so far');
  finite(row.projected_cycle_cost_nzd, 'projected cost');
  finite(row.recent_trend_pct, 'recent trend');
  return row as BillShockApi;
}

function periodStart(period: string) {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i.exec(period.trim());
  if (!match) return null;
  const month = monthLabels.findIndex((name) => name.toLowerCase() === match[1]?.slice(0, 3).toLowerCase());
  return month < 0 ? null : new Date(Number(match[2]), month, 1);
}

function dateRows(period: string, count: number, offset: number) {
  const start = periodStart(period);
  if (!start) return { labels: Array.from({ length: count }, (_, index) => `Day ${offset + index + 1}`), days: Array(count).fill(''), months: Array(count).fill('') };
  const dates = Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth(), offset + index + 1));
  return {
    labels: dates.map((date) => dayLabels[date.getDay()] ?? ''),
    days: dates.map((date) => String(date.getDate())),
    months: dates.map((date) => monthLabels[date.getMonth()] ?? ''),
  };
}

async function getJson(path: string, signal?: AbortSignal) {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error(`Dashboard data could not be loaded (${response.status}).`);
  return response.json() as Promise<unknown>;
}

async function loadApiDashboard(customerId: string, signal?: AbortSignal): Promise<DashboardViewData> {
  const path = `/api/households/${encodeURIComponent(customerId)}`;
  const [householdValue, shockValue] = await Promise.all([getJson(path, signal), getJson(`${path}/bill-shock`, signal)]);
  const household = validateHousehold(householdValue, customerId);
  const shock = validateShock(shockValue);
  const elapsed = Math.min(Math.max(Math.trunc(shock.days_elapsed), 0), household.daily_kwh.length);
  const readings = household.daily_kwh.slice(0, elapsed);
  const weeklyValuesKwh = readings.slice(-7);
  const weeklyOffset = elapsed - weeklyValuesKwh.length;
  const rows = dateRows(household.period, weeklyValuesKwh.length, weeklyOffset);
  const latestKwh = readings.at(-1) ?? null;
  const effectiveRate = shock.usage_so_far_kwh > 0 ? shock.cost_so_far_nzd / shock.usage_so_far_kwh : null;

  return {
    latestDayCostNzd: latestKwh !== null && effectiveRate !== null ? latestKwh * effectiveRate : null,
    usageSoFarKwh: shock.usage_so_far_kwh,
    costSoFarNzd: shock.cost_so_far_nzd,
    projectedCycleCostNzd: shock.projected_cycle_cost_nzd,
    todayKwh: latestKwh,
    todayValuesKwh: [],
    todayTooltipLabels: [],
    weeklyValuesKwh,
    weeklyCostNzd: effectiveRate === null ? null : weeklyValuesKwh.reduce((sum, value) => sum + value, 0) * effectiveRate,
    weeklyLabels: rows.labels,
    weeklyDayLabels: rows.days,
    weeklyMonthLabels: rows.months,
    trendPercent: shock.recent_trend_pct,
    warningTriggered: shock.triggered,
  };
}

export function getDashboardView(customerId: string, signal?: AbortSignal) {
  if (!process.env.EXPO_PUBLIC_API_URL) return Promise.reject(new Error('Dashboard data is waiting for the backend connection.'));
  if (!customerId) return Promise.reject(new Error('A signed-in customer is required to load the dashboard.'));
  return loadApiDashboard(customerId, signal);
}
