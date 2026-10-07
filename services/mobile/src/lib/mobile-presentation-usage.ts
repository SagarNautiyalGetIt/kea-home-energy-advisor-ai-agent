import type { UsageBand, UsageBandKey, UsagePeriod, UsagePoint, UsageViewData } from './usage-data';

type PresentationUsageQuery = {
  period: UsagePeriod;
  date: string;
  compareDate?: string;
  signal?: AbortSignal;
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourlyProfile = [0.42, 0.35, 0.31, 0.29, 0.32, 0.44, 0.75, 1.34, 1.62, 1.1, 0.68, 0.61, 0.72, 0.64, 0.58, 0.66, 0.92, 1.48, 2.16, 1.93, 1.57, 1.12, 0.76, 0.51];
const bandDefinitions: { key: UsageBandKey; label: string; window: string; rate: number }[] = [
  { key: 'peak', label: 'Peak usage', window: '7–11 AM · 5–9 PM', rate: 0.36 },
  { key: 'offPeak', label: 'Off-peak usage', window: '11 AM–5 PM · 9–11 PM', rate: 0.27 },
  { key: 'night', label: 'Night usage', window: '11 PM–7 AM', rate: 0.21 },
];

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Choose a valid usage date.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Choose a valid usage date.');
  }
  return date;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function dateLabel(date: Date) {
  return `${date.getUTCDate()} ${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function hourLabel(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

function bandForHour(hour: number) {
  if ((hour >= 7 && hour < 11) || (hour >= 17 && hour < 21)) return bandDefinitions[0]!;
  if (hour >= 11 && hour < 23) return bandDefinitions[1]!;
  return bandDefinitions[2]!;
}

function dailyReadings(date: Date) {
  // This branch uses a deterministic local profile for the presentation.
  // Calendar arithmetic uses UTC so device timezone and DST never shift a day.
  const seed = date.getUTCFullYear() * 13 + (date.getUTCMonth() + 1) * 31 + date.getUTCDate() * 17;
  const dayFactor = 0.84 + (seed % 31) / 100;
  const weekendFactor = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 1.12 : 1;
  return hourlyProfile.map((value, hour) => {
    const hourFactor = 0.95 + ((seed + hour * 7) % 11) / 100;
    const kwh = Math.round(value * dayFactor * weekendFactor * hourFactor * 1000) / 1000;
    const band = bandForHour(hour);
    return { kwh, costNzd: kwh * band.rate, band: band.key };
  });
}

function periodDates(period: UsagePeriod, selected: Date) {
  if (period === 'daily') return [selected];
  if (period === 'weekly') {
    const start = addDays(selected, -((selected.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  const start = addDays(selected, 1 - selected.getUTCDate());
  const nextMonth = new Date(start);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const dayCount = Math.round((nextMonth.getTime() - start.getTime()) / 86_400_000);
  return Array.from({ length: dayCount }, (_, index) => addDays(start, index));
}

function periodData(period: UsagePeriod, selectedDate: string) {
  const selected = parseDate(selectedDate);
  const dates = periodDates(period, selected);
  const days = dates.map((date) => ({ date, readings: dailyReadings(date) }));
  const points: UsagePoint[] = period === 'daily'
    ? days[0]!.readings.map((reading, hour) => ({
      axisLabel: hour % 3 === 0 ? hourLabel(hour) : '',
      tooltipLabel: `${dateLabel(selected)}, ${hourLabel(hour)}`,
      kwh: reading.kwh,
      costNzd: reading.costNzd,
    }))
    : days.map(({ date, readings }, index) => ({
      axisLabel: period === 'weekly' ? weekNames[date.getUTCDay()]! : index === 0 || (index + 1) % 5 === 0 || index === days.length - 1 ? String(index + 1) : '',
      tooltipLabel: dateLabel(date),
      kwh: readings.reduce((sum, reading) => sum + reading.kwh, 0),
      costNzd: readings.reduce((sum, reading) => sum + reading.costNzd, 0),
    }));
  const bands: UsageBand[] = bandDefinitions.map(({ key, label, window }) => {
    const readings = days.flatMap((day) => day.readings.filter((reading) => reading.band === key));
    return {
      key,
      label,
      window,
      kwh: readings.reduce((sum, reading) => sum + reading.kwh, 0),
      costNzd: readings.reduce((sum, reading) => sum + reading.costNzd, 0),
    };
  });
  return {
    points,
    bands,
    totalKwh: points.reduce((sum, point) => sum + (point.kwh ?? 0), 0),
    totalCostNzd: points.reduce((sum, point) => sum + (point.costNzd ?? 0), 0),
  };
}

function previousDate(period: UsagePeriod, selectedDate: string) {
  const selected = parseDate(selectedDate);
  if (period === 'monthly') {
    selected.setUTCDate(1);
    selected.setUTCMonth(selected.getUTCMonth() - 1);
  } else {
    selected.setUTCDate(selected.getUTCDate() - (period === 'weekly' ? 7 : 1));
  }
  return selected.toISOString().slice(0, 10);
}

export async function getMobilePresentationUsage(query: PresentationUsageQuery): Promise<UsageViewData> {
  await Promise.resolve();
  if (query.signal?.aborted) throw new Error('Usage loading was cancelled.');
  const current = periodData(query.period, query.date);
  const previous = periodData(query.period, query.compareDate ?? previousDate(query.period, query.date));
  return {
    period: query.period,
    selectedDate: query.date,
    sourcePeriod: query.date.slice(0, 7),
    sourceLabel: 'Energy usage',
    points: current.points,
    comparisonPoints: query.compareDate ? previous.points : null,
    totalKwh: current.totalKwh,
    totalCostNzd: current.totalCostNzd,
    trendPercent: ((current.totalKwh - previous.totalKwh) / previous.totalKwh) * 100,
    bands: current.bands,
    availableFrom: null,
    availableTo: null,
    isDemo: true,
  };
}
