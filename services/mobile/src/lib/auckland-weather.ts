/** Regional modelled conditions from Open-Meteo, never electricity telemetry. */
export type AucklandWeather = {
  observedAt: number;
  fetchedAt: number;
  temperatureC: number;
  isDay: boolean;
  weatherCode: number;
  cloudCoverPercent: number;
  solarRadiationWm2: number | null;
  sunriseAt: number | null;
  sunsetAt: number | null;
  condition: 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' | 'unknown';
  description: string;
};

export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
export const WEATHER_SOURCE_URL = 'https://open-meteo.com/';

const regionalCity: Record<string, string> = {
  northland: 'Whangarei', auckland: 'Auckland', waikato: 'Hamilton',
  'bay of plenty': 'Tauranga', taranaki: 'New Plymouth', 'hawkes bay': 'Napier',
  manawatu: 'Palmerston North', wellington: 'Wellington', nelson: 'Nelson',
  canterbury: 'Christchurch', otago: 'Dunedin', southland: 'Invercargill',
};

function weatherCity(region: string) {
  const key = region.trim().toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ');
  return regionalCity[key] ?? region.trim();
}

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
  const daily = record(record(body)?.daily);
  const sunrise = Array.isArray(daily?.sunrise) ? daily.sunrise[0] : null;
  const sunset = Array.isArray(daily?.sunset) ? daily.sunset[0] : null;
  if (!current || !finite(current.time) || !finite(current.temperature_2m) ||
    !finite(current.is_day) || ![0, 1].includes(current.is_day) ||
    !finite(current.weather_code) || !Number.isInteger(current.weather_code) ||
    !finite(current.cloud_cover) || current.cloud_cover < 0 || current.cloud_cover > 100) {
    throw new Error('Current regional weather is unavailable.');
  }
  return {
    observedAt: current.time * 1000,
    fetchedAt,
    temperatureC: current.temperature_2m,
    isDay: current.is_day === 1,
    weatherCode: current.weather_code,
    cloudCoverPercent: current.cloud_cover,
    solarRadiationWm2: finite(current.shortwave_radiation_instant) ? current.shortwave_radiation_instant : null,
    sunriseAt: finite(sunrise) ? sunrise * 1000 : null,
    sunsetAt: finite(sunset) ? sunset * 1000 : null,
    ...weatherCodeDetails(current.weather_code),
  };
}

export async function fetchHouseholdWeather(region: string, signal?: AbortSignal): Promise<AucklandWeather> {
  if (!region.trim()) throw new Error('This account has no region for weather.');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const search = new URL('https://geocoding-api.open-meteo.com/v1/search');
    search.searchParams.set('name', weatherCity(region));
    search.searchParams.set('countryCode', 'NZ');
    search.searchParams.set('count', '5');
    const locationResponse = await fetch(search.toString(), { signal: controller.signal });
    if (!locationResponse.ok) throw new Error('Weather location could not be found.');
    const locations = await locationResponse.json() as { results?: { name: string; latitude: number; longitude: number }[] };
    const city = weatherCity(region).toLowerCase();
    const location = locations.results?.find((item) => item.name.toLowerCase() === city) ?? locations.results?.[0];
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error('This account’s weather region could not be located.');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', 'temperature_2m,is_day,weather_code,cloud_cover,shortwave_radiation_instant');
    url.searchParams.set('daily', 'sunrise,sunset');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('timeformat', 'unixtime');
    url.searchParams.set('forecast_days', '1');
    url.searchParams.set('temperature_unit', 'celsius');
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
    return parseAucklandWeather(await response.json() as unknown);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error('Regional weather timed out.');
    throw error instanceof Error ? error : new Error('Regional weather could not be loaded.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** Compatibility for existing previews and tests; the Home scene uses the account region. */
export function fetchAucklandWeather(signal?: AbortSignal) {
  return fetchHouseholdWeather('Auckland', signal);
}
