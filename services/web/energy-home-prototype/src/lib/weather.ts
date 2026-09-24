/** Modelled current weather; power telemetry is deliberately independent of this module. */
export interface Location {
  id?: number
  name: string
  latitude: number
  longitude: number
  timezone?: string
  country?: string
  admin1?: string
}

export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'unknown'

export interface WeatherSnapshot {
  /** Valid time of the weather model's current interval, in Unix milliseconds. */
  observedAt: number
  fetchedAt: number
  intervalSeconds: number
  timezone: string
  temperatureC: number
  isDay: boolean
  weatherCode: number
  cloudCoverPercent: number
  precipitationMm: number
  rainMm: number
  snowfallCm: number
  windSpeedKmh: number
  windDirectionDegrees: number
  /** Instantaneous modelled horizontal irradiance, not a solar-panel reading. */
  solarRadiationWm2: number | null
  condition: WeatherCondition
}

export const WEATHER_ATTRIBUTION = {
  label: 'Weather data by Open-Meteo',
  url: 'https://open-meteo.com/',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  termsUrl: 'https://open-meteo.com/en/terms',
  description: 'Weather model estimates; scene appearance is adapted from the data.',
} as const

export const LOCATION_ATTRIBUTION = {
  label: 'Location data by GeoNames via Open-Meteo',
  url: 'https://www.geonames.org/',
} as const

export const WEATHER_REFRESH_MS = 15 * 60 * 1000

export class WeatherServiceError extends Error {
  readonly code: 'network' | 'http' | 'invalid-data'

  constructor(message: string, code: WeatherServiceError['code']) {
    super(message)
    this.name = 'WeatherServiceError'
    this.code = code
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function requiredNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (!finite(value)) {
    throw new WeatherServiceError('The weather service returned incomplete current conditions.', 'invalid-data')
  }
  return value
}

export function validateCoordinates(location: Pick<Location, 'latitude' | 'longitude'>): void {
  if (
    !finite(location.latitude) || Math.abs(location.latitude) > 90 ||
    !finite(location.longitude) || Math.abs(location.longitude) > 180
  ) {
    throw new WeatherServiceError('Choose a location with valid latitude and longitude.', 'invalid-data')
  }
}

async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', forwardAbort, { once: true })
  if (signal?.aborted) forwardAbort()
  const timeout = setTimeout(() => controller.abort(new DOMException('Weather request timed out.', 'TimeoutError')), 12000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new WeatherServiceError(
        response.status === 429
          ? 'The weather service is busy. Try again in a few minutes.'
          : 'The weather service is unavailable. Try again shortly.',
        'http',
      )
    }
    try {
      return await response.json() as unknown
    } catch {
      throw new WeatherServiceError('The weather service returned an unreadable response.', 'invalid-data')
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Request cancelled.', 'AbortError')
    if (error instanceof WeatherServiceError) throw error
    throw new WeatherServiceError('Weather could not be reached. Check your connection and try again.', 'network')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Open-Meteo's documented WMO interpretation groups; unknown codes stay unknown. */
export function conditionFromWeatherCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2) return 'partly-cloudy'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  if ([95, 96, 99].includes(code)) return 'storm'
  return 'unknown'
}

export function describeWeatherCode(code: number): string {
  const descriptions: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
    85: 'Light snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
  }
  return descriptions[code] ?? 'Weather unavailable'
}

export async function fetchWeather(location: Location, signal?: AbortSignal): Promise<WeatherSnapshot> {
  validateCoordinates(location)
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: [
      'temperature_2m', 'is_day', 'precipitation', 'rain', 'showers', 'snowfall',
      'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m',
      'shortwave_radiation_instant',
    ].join(','),
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '1',
    wind_speed_unit: 'kmh',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  }).toString()

  const body = record(await fetchJson(url, signal))
  const current = record(body?.current)
  if (!body || !current || typeof body.timezone !== 'string') {
    throw new WeatherServiceError('The weather service returned no current conditions.', 'invalid-data')
  }
  const isDay = requiredNumber(current, 'is_day')
  const weatherCode = requiredNumber(current, 'weather_code')
  const cloudCover = requiredNumber(current, 'cloud_cover')
  if ((isDay !== 0 && isDay !== 1) || !Number.isInteger(weatherCode) || cloudCover < 0 || cloudCover > 100) {
    throw new WeatherServiceError('The weather service returned invalid current conditions.', 'invalid-data')
  }

  return {
    observedAt: requiredNumber(current, 'time') * 1000,
    fetchedAt: Date.now(),
    intervalSeconds: requiredNumber(current, 'interval'),
    timezone: body.timezone,
    temperatureC: requiredNumber(current, 'temperature_2m'),
    isDay: isDay === 1,
    weatherCode,
    cloudCoverPercent: cloudCover,
    precipitationMm: requiredNumber(current, 'precipitation'),
    rainMm: requiredNumber(current, 'rain') + requiredNumber(current, 'showers'),
    snowfallCm: requiredNumber(current, 'snowfall'),
    windSpeedKmh: requiredNumber(current, 'wind_speed_10m'),
    windDirectionDegrees: requiredNumber(current, 'wind_direction_10m'),
    solarRadiationWm2: finite(current.shortwave_radiation_instant) ? current.shortwave_radiation_instant : null,
    condition: conditionFromWeatherCode(weatherCode),
  }
}

export async function fetchLocations(query: string, signal?: AbortSignal): Promise<Location[]> {
  const name = query.trim()
  if (name.length < 2) return []
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.search = new URLSearchParams({ name, count: '6', language: 'en', format: 'json' }).toString()
  const body = record(await fetchJson(url, signal))
  if (!body) throw new WeatherServiceError('Location search returned an unreadable response.', 'invalid-data')
  if (body.results === undefined) return []
  if (!Array.isArray(body.results)) throw new WeatherServiceError('Location search returned invalid results.', 'invalid-data')

  return body.results.flatMap((item: unknown): Location[] => {
    const result = record(item)
    if (!result || typeof result.name !== 'string' || !finite(result.latitude) || !finite(result.longitude)) return []
    if (Math.abs(result.latitude) > 90 || Math.abs(result.longitude) > 180) return []
    return [{
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      ...(finite(result.id) ? { id: result.id } : {}),
      ...(typeof result.timezone === 'string' ? { timezone: result.timezone } : {}),
      ...(typeof result.country === 'string' ? { country: result.country } : {}),
      ...(typeof result.admin1 === 'string' ? { admin1: result.admin1 } : {}),
    }]
  })
}
