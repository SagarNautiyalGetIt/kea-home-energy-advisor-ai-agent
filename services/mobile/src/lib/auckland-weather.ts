/** Current modelled Auckland conditions from Open-Meteo, not meter telemetry. */
export type AucklandWeather = {
  observedAt: number;
  fetchedAt: number;
  temperatureC: number;
  isDay: boolean;
  weatherCode: number;
  cloudCoverPercent: number;
  solarRadiationWm2: number | null;
  condition: 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' | 'unknown';
  description: string;
};

export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
export const WEATHER_SOURCE_URL = 'https://open-meteo.com/';

const AUCKLAND_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast?latitude=-36.8485&longitude=174.7633&current=temperature_2m,is_day,weather_code,cloud_cover,shortwave_radiation_instant&timezone=Pacific%2FAuckland&timeformat=unixtime&forecast_days=1&temperature_unit=celsius';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function weatherCodeDetails(code: number): Pick<AucklandWeather, 'condition' | 'description'> {
  if (code === 0) return { condition: 'clear', description: 'Clear sky' };
  if (code === 1) return { condition: 'clear', description: 'Mainly clear' };
  if (code === 2) return { condition: 'partly-cloudy', description: 'Partly cloudy' };
  if (code === 3) return { condition: 'cloudy', description: 'Overcast' };
  if (code === 45 || code === 48) return { condition: 'fog', description: 'Fog' };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: 'drizzle', description: 'Drizzle' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { condition: 'rain', description: 'Rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: 'snow', description: 'Snow' };
  if ([95, 96, 99].includes(code)) return { condition: 'storm', description: 'Thunderstorm' };
  return { condition: 'unknown', description: 'Conditions unavailable' };
}

/** Reject incomplete responses instead of presenting a guessed temperature as live. */
export function parseAucklandWeather(body: unknown, fetchedAt = Date.now()): AucklandWeather {
  const current = record(record(body)?.current);
  if (!current || !finite(current.time) || !finite(current.temperature_2m) ||
    !finite(current.is_day) || ![0, 1].includes(current.is_day) ||
    !finite(current.weather_code) || !Number.isInteger(current.weather_code) ||
    !finite(current.cloud_cover) || current.cloud_cover < 0 || current.cloud_cover > 100) {
    throw new Error('Current Auckland weather is unavailable.');
  }
  return {
    observedAt: current.time * 1000,
    fetchedAt,
    temperatureC: current.temperature_2m,
    isDay: current.is_day === 1,
    weatherCode: current.weather_code,
    cloudCoverPercent: current.cloud_cover,
    solarRadiationWm2: finite(current.shortwave_radiation_instant) ? current.shortwave_radiation_instant : null,
    ...weatherCodeDetails(current.weather_code),
  };
}

export async function fetchAucklandWeather(signal?: AbortSignal): Promise<AucklandWeather> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(AUCKLAND_FORECAST_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
    return parseAucklandWeather(await response.json() as unknown);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error('Auckland weather timed out.');
    throw error instanceof Error ? error : new Error('Auckland weather could not be loaded.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
