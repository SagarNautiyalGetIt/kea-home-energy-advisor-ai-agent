/** Time boundaries and meter deltas for complete Home Assistant energy days. */

export type EnergyHistoryRow = {
  entity_id?: unknown;
  state?: unknown;
  last_updated?: unknown;
  last_changed?: unknown;
};

type EnergySensor = { id: string; label: string; unit: 'Wh' | 'kWh' };

function zoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

function zonedMidnightUtc(year: number, month: number, day: number, timezone: string) {
  const guess = Date.UTC(year, month - 1, day);
  let candidate = guess;
  // The offset at UTC midnight can differ from the offset at local midnight on a
  // daylight-saving transition day. Recompute at the candidate until it settles.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zoneParts(new Date(candidate), timezone);
    const rendered = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    const correction = guess - rendered;
    candidate += correction;
    if (correction === 0) return new Date(candidate);
  }
  const final = zoneParts(new Date(candidate), timezone);
  if (final.year !== year || final.month !== month || final.day !== day || final.hour !== 0 || final.minute !== 0) {
    throw new Error('Could not resolve the home timezone at midnight.');
  }
  return new Date(candidate);
}

export function previousCompleteDay(timezone: string, now = new Date()) {
  const today = zoneParts(now, timezone);
  const todayStart = zonedMidnightUtc(today.year, today.month, today.day, timezone);
  const yesterday = zoneParts(new Date(todayStart.getTime() - 60_000), timezone);
  const yesterdayStart = zonedMidnightUtc(yesterday.year, yesterday.month, yesterday.day, timezone);
  return { day: `${yesterday.year}-${String(yesterday.month).padStart(2, '0')}-${String(yesterday.day).padStart(2, '0')}`, start: yesterdayStart, end: todayStart };
}

export function measuredDayKwh(history: EnergyHistoryRow[][], entity: EnergySensor, start: Date, end: Date): number {
  const states = history.flat().filter((row) => row.entity_id === entity.id).map((row) => ({
    at: new Date(String(row.last_updated ?? row.last_changed)),
    value: Number(row.state),
  })).filter((row) => Number.isFinite(row.value) && Number.isFinite(row.at.getTime())).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (states.length < 2 || states[0]!.at.getTime() > start.getTime() || states.at(-1)!.at.getTime() < end.getTime() - 60 * 60 * 1000) throw new Error(`${entity.label} has no complete daily energy history yet.`);
  let total = 0;
  let previous = states[0]!.value;
  for (const state of states.slice(1)) {
    if (state.at > end) break;
    total += state.value >= previous ? state.value - previous : state.value;
    previous = state.value;
  }
  const kwh = entity.unit === 'Wh' ? total / 1000 : total;
  if (!Number.isFinite(kwh) || kwh < 0 || kwh > 500) throw new Error(`${entity.label} reported energy outside the supported daily range.`);
  return Math.round(kwh * 1000) / 1000;
}
