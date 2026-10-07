import type { LivePower } from './home-assistant';
import type { HomeTarget } from './home-card-reading';

/** Fixed, balanced Home snapshot scoped to the mobile presentation branch. */
export const MOBILE_PRESENTATION_HOME_POWER = Object.freeze({
  solar_generation: 4800,
  home_load: 1200,
  ev_charger: 3200,
  battery_charge: 1200,
  battery_discharge: 0,
  grid_import: 800,
  grid_export: 0,
} satisfies LivePower);

export const MOBILE_PRESENTATION_BATTERY_PERCENT = 76;

export function mobilePresentationHomeReading(device: HomeTarget): { value: string; detail: string } {
  const watts = {
    solar: MOBILE_PRESENTATION_HOME_POWER.solar_generation,
    home: MOBILE_PRESENTATION_HOME_POWER.home_load,
    car: MOBILE_PRESENTATION_HOME_POWER.ev_charger,
    battery: MOBILE_PRESENTATION_HOME_POWER.battery_charge,
    grid: MOBILE_PRESENTATION_HOME_POWER.grid_import,
  }[device];
  const detail = {
    solar: 'Solar generation',
    home: 'Home consumption',
    car: 'EV charging',
    battery: `Charging · ${MOBILE_PRESENTATION_BATTERY_PERCENT}%`,
    grid: 'Grid import',
  }[device];
  return { value: `${(watts / 1000).toFixed(1)} kW`, detail };
}
