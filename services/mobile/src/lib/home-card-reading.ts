import type { HomeSceneData } from './home-scene-data';
import type { LivePower } from './home-assistant';

export type HomeTarget = 'home' | 'solar' | 'car' | 'battery' | 'grid';
export function homeCardReading(scene: HomeSceneData | null, live: LivePower, device: HomeTarget) {
  const daily = (kind: string) => {
    const rows = scene?.devices.filter((row) => row.deviceClass === kind) ?? [];
    return rows.length ? rows.reduce((total, row) => total + row.energyKwh, 0) : null;
  };
  const power = (watts: number | undefined) => watts === undefined ? null : `${(watts / 1000).toFixed(2)} kW`;
  const energy = (kwh: number | null) => kwh === null ? '—' : `${kwh.toFixed(1)} kWh`;
  const deviceDate = scene?.deviceDay ?? 'date unavailable';
  const current = (watts: number, label: string) => ({ value: power(watts)!, detail: `${label} · live`, available: true });
  const measured = (kwh: number | null, label: string) => ({ value: energy(kwh), detail: kwh === null ? 'Link a sensor in Settings' : `${label} · ${deviceDate}`, available: kwh !== null });
  if (device === 'solar') return live.solar_generation !== undefined ? current(live.solar_generation, 'Solar output') : measured(daily('solar_generation'), 'Solar meter');
  if (device === 'car') return live.ev_charger !== undefined ? current(live.ev_charger, 'Charger') : measured(daily('ev_charger'), 'Charger meter');
  if (device === 'battery') {
    if (live.battery_charge !== undefined && live.battery_charge > 20) return current(live.battery_charge, 'Charging');
    if (live.battery_discharge !== undefined && live.battery_discharge > 20) return current(live.battery_discharge, 'Supplying');
    if (live.battery_charge !== undefined || live.battery_discharge !== undefined) return current(live.battery_charge ?? live.battery_discharge!, 'Idle');
    const charge = daily('battery_charge');
    return measured(charge ?? daily('battery_discharge'), charge === null ? 'Discharged' : 'Charged');
  }
  if (device === 'home' && live.home_load !== undefined) return current(live.home_load, 'Home load');
  if (device === 'grid') {
    if (live.grid_import !== undefined && live.grid_import > 20) return current(live.grid_import, 'Importing');
    if (live.grid_export !== undefined && live.grid_export > 20) return current(live.grid_export, 'Exporting');
    if (live.grid_import !== undefined || live.grid_export !== undefined) return current(live.grid_import ?? live.grid_export!, 'Idle');
  }
  const kwh = scene?.meterImportKwh ?? null;
  // Whole-house imports are not total home consumption when solar/storage exists.
  return { value: energy(kwh), detail: kwh === null ? 'Daily imports unavailable' : `${scene?.dateSource === 'demo' ? 'Demo imports' : 'Meter imports'} · ${scene?.day ?? 'date unavailable'}`, available: kwh !== null };
}
