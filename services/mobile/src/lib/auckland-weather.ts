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
export const WEATHER_FRESH_MS = 90 * 60 * 1000;
/** City-centre regional weather, not GPS or a claim about the customer's address. */
const aucklandLocation = { latitude: -36.84853, longitude: 174.76349 };
const locationsCache = new Map<string, { latitude: number; longitude: number }>();
const queryUrl = (base: string, parameters: Record<string, string>) => `${base}?${Object.entries(parameters).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;

export function isWeatherFresh(weather: AucklandWeather, now = Date.now()) {
  return weather.observedAt <= now + 60_000 && now - weather.observedAt < WEATHER_FRESH_MS;
}
export function restoreWeatherCache(body: unknown): AucklandWeather | null {
  const row = record(body);
  if (!row || !finite(row.observedAt) || !finite(row.fetchedAt) || typeof row.isDay !== 'boolean') return null;
  try {
    return parseAucklandWeather({ current: { time: row.observedAt / 1000, temperature_2m: row.temperatureC, is_day: row.isDay ? 1 : 0, weather_code: row.weatherCode, cloud_cover: row.cloudCoverPercent, shortwave_radiation_instant: row.solarRadiationWm2 }, daily: { sunrise: [finite(row.sunriseAt) ? row.sunriseAt / 1000 : null], sunset: [finite(row.sunsetAt) ? row.sunsetAt / 1000 : null] } }, row.fetchedAt);
  } catch { return null; }
}

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
  if ([95, 96, 97, 99].includes(code)) return { condition: 'storm', description: 'Thunderstorm' };
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
    const city = weatherCity(region).toLowerCase();
    let location = city === 'auckland' ? aucklandLocation : locationsCache.get(city);
    if (!location) {
      const search = queryUrl('https://geocoding-api.open-meteo.com/v1/search', { name: weatherCity(region), countryCode: 'NZ', count: '5' });
      const locationResponse = await fetch(search, { signal: controller.signal });
      if (!locationResponse.ok) throw new Error('Weather location could not be found.');
      const results = record(await locationResponse.json())?.results;
      const rows = Array.isArray(results) ? results.map(record).filter(item => item && item.country_code === 'NZ' && finite(item.latitude) && finite(item.longitude) && Math.abs(item.latitude) <= 90 && Math.abs(item.longitude) <= 180) : [];
      const item = rows.find(item => typeof item?.name === 'string' && item.name.toLowerCase() === city) ?? rows[0];
      if (!item) throw new Error('This account’s weather region could not be located in New Zealand.');
      location = { latitude: item.latitude as number, longitude: item.longitude as number };
      if (locationsCache.size >= 32) locationsCache.clear();
      locationsCache.set(city, location);
    }
    const url = queryUrl('https://api.open-meteo.com/v1/forecast', { latitude: String(location.latitude), longitude: String(location.longitude), current: 'temperature_2m,is_day,weather_code,cloud_cover,shortwave_radiation_instant', daily: 'sunrise,sunset', timezone: 'auto', timeformat: 'unixtime', forecast_days: '1', temperature_unit: 'celsius' });
    if (controller.signal.aborted) throw new Error('Regional weather request cancelled.');
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
    const weather = parseAucklandWeather(await response.json() as unknown);
    if (!isWeatherFresh(weather)) throw new Error('Weather service returned an outdated observation.');
    return weather;
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
