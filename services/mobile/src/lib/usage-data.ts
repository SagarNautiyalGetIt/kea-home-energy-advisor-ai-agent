import { hourlyUsage, usage as fixtureUsage } from '@/data/mock';
import { apiFetch } from '@/lib/backend-client';
import { hourlyComparisonUnavailable, hourlyPoints, validateHourlyUsage, type HourlyUsage } from '@/lib/hourly-usage';
import { canOverlayUsage, selectedIndexes, selectedTotals, usageBandReading, usageChartPoints, usageCoverage, usageRange, usageSource, usageTrendPercent, usageUnitRate, validateUsageSeries, type UsageSeries } from '@/lib/usage-series';

export type UsagePeriod = 'daily' | 'weekly' | 'monthly';
export type UsageBandKey = 'peak' | 'offPeak' | 'night';

export type UsagePoint = {
  axisLabel: string;
  tooltipLabel: string;
  kwh: number | null;
  costNzd: number | null;
};

export type UsageBand = {
  reason?: string | null;
  key: UsageBandKey;
  label: string;
  window: string | null;
  kwh: number | null;
  costNzd: number | null;
};

export type UsageViewData = {
  hourly?: HourlyUsage | null;
  period: UsagePeriod;
  selectedDate: string;
  sourcePeriod: string;
  sourceLabel: string;
  points: UsagePoint[];
  comparisonPoints: UsagePoint[] | null;
  totalKwh: number | null;
  totalCostNzd: number | null;
  trendPercent: number | null;
  bands: UsageBand[];
  availableFrom: string | null;
  availableTo: string | null;
  isDemo: boolean;
};

export type UsageQuery = {
  customerId: string;
  period: UsagePeriod;
  date: string;
  compareDate?: string;
  signal?: AbortSignal;
};

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

function shortDate(value: Date) {
  return `${value.getDate()} ${shortMonths[value.getMonth()]}`;
}

function seriesBands(series: UsageSeries, period: UsagePeriod, selected: string): UsageBand[] {
  const indexes = selectedIndexes(series, period, selected);
  const fields = { peak: series.daily_peak_kwh, offPeak: series.daily_off_peak_kwh, night: series.daily_night_kwh };
  const rate = series.total_kwh > 0 ? series.estimated_cost_nzd / series.total_kwh : 0;
  return bandDefinitions.map((band) => {
    const { kwh, reason } = usageBandReading(series, indexes, fields[band.key]);
    // Real tariff windows are not part of the contract. Demo windows are illustrative.
    const demo = series.band_data_source === 'demo' && series.date_source === 'demo';
    return { ...band, window: demo ? band.window : null, kwh, reason: demo && kwh !== null ? `Demo · ${band.window}` : reason, costNzd: kwh === null ? null : kwh * rate };
  });
}

async function fetchJson(path: string, signal?: AbortSignal) {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error(`Usage could not be loaded (${response.status}).`);
  return response.json() as Promise<unknown>;
}

async function loadApiUsage(query: UsageQuery): Promise<UsageViewData> {
  const customerPath = `/api/households/${encodeURIComponent(query.customerId)}/usage-series`;
  const load = async (selected: string) => {
    const range = usageRange(query.period, selected);
    const value = await fetchJson(`${customerPath}?start=${range.start}&end=${range.end}`, query.signal);
    return validateUsageSeries(value, query.customerId, range);
  };
  const [series, previous] = await Promise.all([load(query.date), query.compareDate ? load(query.compareDate) : Promise.resolve(null)]);
  const loadHours = async (day: string) => {
    if (query.period !== 'daily') return null;
    try { return validateHourlyUsage(await fetchJson(`/api/households/${encodeURIComponent(query.customerId)}/hourly-usage?day=${day}`, query.signal), query.customerId, day); }
    catch (error) { if (query.signal?.aborted) throw error; return null; }
  };
  const [hourly, previousHourly] = await Promise.all([loadHours(query.date), query.compareDate ? loadHours(query.compareDate) : Promise.resolve(null)]);
  const rate = usageUnitRate(series);
  const previousRate = previous ? usageUnitRate(previous) : null;
  const points = query.period === 'daily' ? hourlyPoints(hourly, rate) : usageChartPoints(series, query.period, query.date);
  const comparisonPoints = query.period === 'daily' ? hourlyPoints(previousHourly, previousRate) : previous ? usageChartPoints(previous, query.period, query.compareDate!) : null;
  const totals = selectedTotals(series, query.period, query.date);
  const source = usageSource(series);
  const previousSource = previous ? usageSource(previous) : null;
  const coverage = usageCoverage(series, query.period, query.date);
  const previousCoverage = previous ? usageCoverage(previous, query.period, query.compareDate!) : null;
  const completeComparisonDates = previous ? canOverlayUsage(series, previous, query.period, query.date, query.compareDate!) : false;
  const hourlyComparisonReason = query.period === 'daily' && previous ? hourlyComparisonUnavailable(hourly, previousHourly) : null;
  const comparisonReason = completeComparisonDates ? hourlyComparisonReason : 'incomplete date coverage';
  const overlayAvailable = completeComparisonDates && comparisonReason === null;
  const comparisonLabel = previousSource && previousCoverage
    ? ` · comparison: ${previousSource.label} · ${previousCoverage.days}/${previousCoverage.expectedDays} days${overlayAvailable ? '' : ` · comparison chart unavailable: ${comparisonReason}`}`
    : '';

  return {
    hourly,
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: query.date.slice(0, 7),
    sourceLabel: `${source.label} · ${coverage.days}/${coverage.expectedDays} days available${query.period === 'daily' ? ` · ${hourly ? `${hourly.hours.filter(hour => hour.kwh !== null).length}/${hourly.hours.length} hours available · ${hourly.note}` : 'Hourly source unavailable'}` : ''}${comparisonLabel}`,
    points,
    comparisonPoints: overlayAvailable && comparisonPoints?.length && comparisonPoints.length === points.length ? comparisonPoints : null,
    totalKwh: totals.kwh,
    totalCostNzd: totals.costNzd,
    trendPercent: previous ? usageTrendPercent(series, previous, query.period, query.date, query.compareDate!) : null,
    bands: seriesBands(series, query.period, query.date),
    availableFrom: series.available_from ?? null,
    availableTo: series.available_to ?? null,
    isDemo: source.isDemo || previousSource?.isDemo === true || hourly?.source === 'demo',
  };
}

function fixturePoints(period: UsagePeriod, selectedDate: string, previous = false): UsagePoint[] {
  const source = fixtureUsage[period];
  const readings = period === 'daily'
    ? fixtureDailyProfile(selectedDate)
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

function fixtureDailyProfile(selectedDate: string) {
  const selected = parseIsoDate(selectedDate);
  const seed = selected.getDate() * 7 + selected.getMonth() * 11;
  const totalVariation = 0.78 + (seed % 29) / 100;
  const peakVariation = ((seed % 7) - 3) * 0.045;
  return hourlyUsage.map((value, hour) => {
    const eveningWeight = hour >= 17 && hour <= 21 ? peakVariation : hour >= 7 && hour <= 10 ? -peakVariation * 0.45 : 0;
    return Math.max(0, value * totalVariation * (1 + eveningWeight));
  });
}

function loadDemoUsage(query: UsageQuery): UsageViewData {
  const points = fixturePoints(query.period, query.date);
  const previous = fixturePoints(query.period, query.compareDate ?? query.date, true);
  const totalKwh = query.period === 'monthly' ? points.at(-1)?.kwh ?? 0 : points.reduce((sum, point) => sum + (point.kwh ?? 0), 0);
  const previousTotal = query.period === 'monthly' ? previous.at(-1)?.kwh ?? 0 : previous.reduce((sum, point) => sum + (point.kwh ?? 0), 0);
  const profile = fixtureDailyProfile(query.date);
  const dailyBandValues = Object.fromEntries(Object.entries(bandHours).map(([key, hours]) => [key, hours.reduce((sum, hour) => sum + (profile[hour] ?? 0), 0)])) as Record<UsageBandKey, number>;
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
    sourceLabel: 'Local demo preview · illustrative estimated cost',
    points,
    comparisonPoints: query.compareDate ? previous : null,
    totalKwh,
    totalCostNzd: totalKwh * demoTariffNzd,
    trendPercent: previousTotal ? ((totalKwh - previousTotal) / previousTotal) * 100 : null,
    bands,
    availableFrom: null,
    availableTo: null,
    isDemo: true,
  };
}

export async function getUsageView(query: UsageQuery): Promise<UsageViewData> {
  if (!query.customerId) throw new Error('A signed-in customer is required to load usage.');
  if (process.env.EXPO_PUBLIC_USE_REAL_DATA === 'false') return loadDemoUsage(query);
  return loadApiUsage(query);
}
