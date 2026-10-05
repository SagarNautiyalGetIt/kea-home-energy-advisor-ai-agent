import type { LivePower } from './home-assistant';
export type HomeFlow = { id: 'solar' | 'battery' | 'grid' | 'car'; watts: number | null; reverse: boolean; color: string; active: boolean; duration: number };
/** Daily kWh/EV ownership never implies connection or charging. */
export function homeFlows(power: LivePower, preview: boolean): HomeFlow[] {
  const valid = (value: number | undefined) => value != null && Number.isFinite(value) && value >= 0 ? value : null;
  const discharge = valid(power.battery_discharge), charge = valid(power.battery_charge);
  const imports = valid(power.grid_import), exports = valid(power.grid_export);
  const batteryNet = (discharge ?? 0) - (charge ?? 0), gridNet = (imports ?? 0) - (exports ?? 0);
  const rows = [
    { id: 'solar' as const, watts: valid(power.solar_generation), reverse: false, color: '#20FF78' },
    { id: 'battery' as const, watts: discharge === null && charge === null ? null : Math.abs(batteryNet), reverse: batteryNet > 0, color: '#368EFF' },
    { id: 'grid' as const, watts: imports === null && exports === null ? null : Math.abs(gridNet), reverse: gridNet > 0, color: '#FF8C24' },
    { id: 'car' as const, watts: valid(power.ev_charger), reverse: false, color: '#00DEFF' },
  ];
  const illustrative = preview && !rows.some(row => row.watts !== null);
  return rows.map(row => ({ ...row, active: row.watts !== null ? row.watts > 10 : illustrative && row.id !== 'car', duration: Math.max(1.9, 3.2 - Math.min((row.watts ?? 0) / 1000, 6) * 0.17) }));
}

export function freshHomePower(power: LivePower, fetchedAt: number, now = Date.now()): LivePower {
  return Number.isFinite(fetchedAt) && fetchedAt <= now && now - fetchedAt <= 60_000 ? power : {};
}
