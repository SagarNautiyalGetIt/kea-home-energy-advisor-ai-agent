import type { LivePower } from './home-assistant';
export type HomeFlow = { id: 'solar' | 'battery' | 'grid' | 'car'; watts: number | null; reverse: boolean; color: string; active: boolean; duration: number };
/** Daily kWh never implies instantaneous power. Preview paths carry no readings. */
export function homeFlows(power: LivePower, preview: boolean): HomeFlow[] {
  const valid = (value: number | undefined) => value != null && Number.isFinite(value) && value >= 0 ? value : null;
  const discharge = valid(power.battery_discharge), charge = valid(power.battery_charge);
  const imports = valid(power.grid_import), exports = valid(power.grid_export);
  const rows = [
    { id: 'solar' as const, watts: valid(power.solar_generation), reverse: false, color: '#63F09A' },
    { id: 'battery' as const, watts: discharge === null && charge === null ? null : Math.max(discharge ?? 0, charge ?? 0), reverse: discharge != null && discharge > (charge ?? 0), color: '#5AB8FF' },
    { id: 'grid' as const, watts: imports === null && exports === null ? null : Math.max(imports ?? 0, exports ?? 0), reverse: imports != null && imports >= (exports ?? 0), color: '#FF9F43' },
    { id: 'car' as const, watts: valid(power.ev_charger), reverse: false, color: '#38BDF8' },
  ];
  return rows.map(row => ({ ...row, active: row.watts !== null ? row.watts > 10 : preview, duration: Math.max(1.9, 3.2 - Math.min((row.watts ?? 0) / 1000, 6) * 0.17) }));
}
