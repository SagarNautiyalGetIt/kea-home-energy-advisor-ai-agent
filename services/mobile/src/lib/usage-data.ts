import { hourlyUsage, usage as fixtureUsage } from '@/data/mock';
import { apiFetch } from '@/lib/backend-client';
import { selectedIndexes, selectedTotals, usageRange, usageSource, validateUsageSeries, type UsageSeries } from '@/lib/usage-series';

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

function seriesPoints(series: UsageSeries, period: UsagePeriod): UsagePoint[] {
  const rate = series.total_kwh > 0 ? series.estimated_cost_nzd / series.total_kwh : 0;
  if (period === 'monthly') {
    const buckets = new Map<string, number>();
    series.daily_dates.forEach((day, index) => {
      const key = day.slice(0, 7);
      buckets.set(key, (buckets.get(key) ?? 0) + series.daily_kwh[index]!);
    });
    return [...buckets].map(([month, kwh]) => {
      const date = parseIsoDate(`${month}-01`);
      return { axisLabel: shortMonths[date.getMonth()]!, tooltipLabel: `${monthNames[date.getMonth()]} ${date.getFullYear()}`, kwh, costNzd: kwh * rate };
    });
  }
  return series.daily_dates.map((day, index) => {
    const date = parseIsoDate(day);
    const kwh = series.daily_kwh[index]!;
    return {
      axisLabel: period === 'weekly' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]! : shortDate(date),
      tooltipLabel: `${shortDate(date)} · daily total`,
      kwh,
      costNzd: kwh * rate,
    };
  });
}

function seriesBands(series: UsageSeries, period: UsagePeriod, selected: string): UsageBand[] {
  const indexes = selectedIndexes(series, period, selected);
  const fields = { peak: series.daily_peak_kwh, offPeak: series.daily_off_peak_kwh, night: series.daily_night_kwh };
  const rate = series.total_kwh > 0 ? series.estimated_cost_nzd / series.total_kwh : 0;
  return bandDefinitions.map((band) => {
    const values = indexes.map((index) => fields[band.key][index]);
    const complete = series.band_data_source === 'measured' && values.length > 0 && values.every((value) => value != null);
    const kwh = complete ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    // Tariff time windows are not part of this endpoint's contract.
    return { ...band, window: null, kwh, costNzd: kwh === null ? null : kwh * rate };
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
  const points = seriesPoints(series, query.period);
  const comparisonPoints = previous ? seriesPoints(previous, query.period) : null;
  const totals = selectedTotals(series, query.period, query.date);
  const previousTotals = previous ? selectedTotals(previous, query.period, query.compareDate!) : null;
  const source = usageSource(series);
  const previousSource = previous ? usageSource(previous) : null;
  const selectedDays = selectedIndexes(series, query.period, query.date).length;

  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: query.date.slice(0, 7),
    sourceLabel: `${source.label}${previousSource ? ` · comparison: ${previousSource.label}` : ''} · ${selectedDays} day${selectedDays === 1 ? '' : 's'} available`,
    points,
    comparisonPoints: comparisonPoints?.length ? comparisonPoints : null,
    totalKwh: totals.kwh,
    totalCostNzd: totals.costNzd,
    trendPercent: totals.kwh !== null && previousTotals?.kwh ? (totals.kwh - previousTotals.kwh) / previousTotals.kwh * 100 : null,
    bands: seriesBands(series, query.period, query.date),
    availableFrom: series.available_from ?? null,
    availableTo: series.available_to ?? null,
    isDemo: source.isDemo || previousSource?.isDemo === true,
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
