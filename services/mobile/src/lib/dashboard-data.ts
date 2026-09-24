import { dashboardToday, notifications } from '@/data/mock';
import { apiFetch } from '@/lib/backend-client';

export const dashboardNotifications = notifications;

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
  expected_cost_nzd: number;
  overshoot_nzd: number;
  overshoot_pct: number;
  expectation_basis: string;
  reasons?: string[];
  caveats?: string[];
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
  overshootNzd: number | null;
  overshootPct: number | null;
  expectedCostNzd: number | null;
  expectationBasis: string | null;
  warningReasons: string[];
  warningCaveats: string[];
  warningTriggered: boolean | null;
  isDemo: boolean;
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
  finite(row.expected_cost_nzd, 'expected cost');
  finite(row.overshoot_nzd, 'bill overshoot');
  finite(row.overshoot_pct, 'bill overshoot percentage');
  if (typeof row.expectation_basis !== 'string' || !row.expectation_basis) throw new Error('Bill-shock response is missing its expectation basis.');
  if (row.reasons !== undefined && (!Array.isArray(row.reasons) || row.reasons.some((reason) => typeof reason !== 'string'))) throw new Error('Bill-shock response has invalid reasons.');
  if (row.caveats !== undefined && (!Array.isArray(row.caveats) || row.caveats.some((caveat) => typeof caveat !== 'string'))) throw new Error('Bill-shock response has invalid caveats.');
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
    overshootNzd: shock.overshoot_nzd,
    overshootPct: shock.overshoot_pct,
    expectedCostNzd: shock.expected_cost_nzd,
    expectationBasis: shock.expectation_basis,
    warningReasons: shock.reasons ?? [],
    warningCaveats: shock.caveats ?? [],
    warningTriggered: shock.triggered,
    isDemo: false,
  };
}

function loadDemoDashboard(): DashboardViewData {
  const weeklyValuesKwh = [13.8, 15.1, 12.6, 17.4, 16.2, 11.3, 9.7];
  const weeklyRate = 0.327;
  const todayValuesKwh = [...dashboardToday.values];
  const todayKwh = todayValuesKwh.reduce((sum, value) => sum + value, 0);
  return {
    latestDayCostNzd: 6.84,
    usageSoFarKwh: 286.4,
    costSoFarNzd: 93.65,
    projectedCycleCostNzd: 148.2,
    todayKwh,
    todayValuesKwh,
    todayTooltipLabels: dashboardToday.labels,
    weeklyValuesKwh,
    weeklyCostNzd: weeklyValuesKwh.reduce((sum, value) => sum + value, 0) * weeklyRate,
    weeklyLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weeklyDayLabels: ['14', '15', '16', '17', '18', '19', '20'],
    weeklyMonthLabels: Array(7).fill('Sep'),
    trendPercent: -8.4,
    overshootNzd: 28.2,
    overshootPct: 23.5,
    expectedCostNzd: 120,
    expectationBasis: 'own_recent_cycles',
    warningReasons: ['Usage is tracking above your recent billing cycles.'],
    warningCaveats: [],
    warningTriggered: true,
    isDemo: true,
  };
}

export function getDashboardView(customerId: string, signal?: AbortSignal) {
  if (process.env.EXPO_PUBLIC_USE_REAL_DATA === 'false') return Promise.resolve(loadDemoDashboard());
  if (!customerId) return Promise.reject(new Error('A signed-in customer is required to load the dashboard.'));
  return loadApiDashboard(customerId, signal);
}
