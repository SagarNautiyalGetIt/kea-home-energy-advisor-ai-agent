export type HourlySlot = { start: string; label: string; kwh: number | null; quality: 'measured' | 'estimated' | 'demo' | 'missing'; intervals_received: number; expected_intervals: number };
export type HourlyUsage = { customer_id: string; day: string; timezone: string; source: 'intervals' | 'demo' | 'unavailable'; note: string; hours: HourlySlot[] };

export function validateHourlyUsage(value: unknown, customerId: string, day: string): HourlyUsage {
  const row = value as Partial<HourlyUsage> | null;
  if (!row || row.customer_id !== customerId || row.day !== day || row.timezone !== 'Pacific/Auckland' || !['intervals', 'demo', 'unavailable'].includes(row.source ?? '') || typeof row.note !== 'string' || !Array.isArray(row.hours) || ![23, 24, 25].includes(row.hours.length)) throw new Error('Invalid dated hourly usage.');
  const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  let previous = -Infinity;
  for (const slot of row.hours) {
    const at = Date.parse(slot.start);
    if (!Number.isFinite(at) || at <= previous || (previous !== -Infinity && at - previous !== 3600000) || localDay.format(new Date(at)) !== day || typeof slot.label !== 'string' || !['measured', 'estimated', 'demo', 'missing'].includes(slot.quality) || !Number.isInteger(slot.expected_intervals) || slot.expected_intervals < 0 || !Number.isInteger(slot.intervals_received) || slot.intervals_received < 0 || slot.intervals_received > slot.expected_intervals || (slot.kwh !== null && (!Number.isFinite(slot.kwh) || slot.kwh < 0)) || ((slot.quality === 'missing') !== (slot.kwh === null)) || (slot.kwh !== null && (slot.expected_intervals === 0 || slot.intervals_received !== slot.expected_intervals)) || (row.source === 'unavailable' && slot.kwh !== null) || (row.source === 'demo' && slot.kwh !== null && slot.quality !== 'demo')) throw new Error('Invalid hourly intervals or coverage.');
    previous = at;
  }
  const midnight = new Intl.DateTimeFormat('en-NZ', { timeZone: row.timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  if (midnight.format(new Date(row.hours[0]!.start)) !== '00:00' || localDay.format(new Date(previous + 3600000)) === day || (row.source === 'intervals' && row.hours.some(slot => slot.quality === 'demo'))) throw new Error('Hourly coverage does not span the selected local day.');
  return row as HourlyUsage;
}

export function hourlyPoints(usage: HourlyUsage | null, rate: number | null) {
  if (!usage || usage.hours.some(hour => hour.kwh === null)) return [];
  return usage.hours.map((hour, index) => ({ axisLabel: index % 3 === 0 ? hour.label : '', tooltipLabel: `${usage.day} · ${hour.label} · ${hour.quality}`, kwh: hour.kwh!, costNzd: rate !== null && Number.isFinite(rate) && rate >= 0 ? hour.kwh! * rate : null }));
}
