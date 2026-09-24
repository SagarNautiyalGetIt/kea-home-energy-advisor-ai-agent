import test from 'node:test'
import assert from 'node:assert/strict'
import {
  conditionFromWeatherCode,
  fetchLocations,
  fetchWeather,
  WeatherServiceError,
} from '../src/lib/weather.ts'
import {
  cameraBearingFromHouse,
  getSkyPosition,
  projectCelestialPosition,
  starVisibility,
} from '../src/lib/astronomy.ts'

const auckland = { name: 'Auckland', latitude: -36.8485, longitude: 174.7633 }
const validResponse = {
  timezone: 'Pacific/Auckland',
  current: {
    time: 1789459200, interval: 900, temperature_2m: 15.3, is_day: 1,
    weather_code: 63, cloud_cover: 98, precipitation: 0.3, rain: 0.2,
    showers: 0.1, snowfall: 0, wind_speed_10m: 12.4, wind_direction_10m: 215,
    shortwave_radiation_instant: 128,
  },
}

test('current weather requests numeric UTC times and preserves measured units', async (context) => {
  let requestedUrl: URL | undefined
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requestedUrl = input instanceof URL ? input : new URL(String(input))
    return new Response(JSON.stringify(validResponse), { status: 200 })
  })
  const weather = await fetchWeather(auckland)
  assert.equal(weather.observedAt, validResponse.current.time * 1000)
  assert.equal(weather.timezone, 'Pacific/Auckland')
  assert.equal(weather.condition, 'rain')
  assert.equal(weather.temperatureC, 15.3)
  assert.equal(weather.cloudCoverPercent, 98)
  assert.equal(weather.solarRadiationWm2, 128)
  assert.ok(Math.abs(weather.rainMm - 0.3) < 1e-10)
  assert.equal(requestedUrl?.searchParams.get('timeformat'), 'unixtime')
  assert.equal(requestedUrl?.searchParams.get('latitude'), String(auckland.latitude))
  assert.ok(requestedUrl?.searchParams.get('current')?.includes('shortwave_radiation_instant'))
})

test('missing radiation stays unavailable, while missing core weather fails explicitly', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    ...validResponse, current: { ...validResponse.current, shortwave_radiation_instant: null },
  })))
  assert.equal((await fetchWeather(auckland)).solarRadiationWm2, null)
  context.mock.restoreAll()
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    ...validResponse, current: { ...validResponse.current, temperature_2m: null },
  })))
  await assert.rejects(fetchWeather(auckland), { name: 'WeatherServiceError', code: 'invalid-data' })
})

test('network and rate-limit failures never become pretend weather', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }))
  await assert.rejects(fetchWeather(auckland), (error: unknown) => error instanceof WeatherServiceError && error.code === 'http')
  context.mock.restoreAll()
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network failed') })
  await assert.rejects(fetchWeather(auckland), { name: 'WeatherServiceError', code: 'network' })
})

test('cancelled requests preserve cancellation instead of reporting fake weather', async (context) => {
  const controller = new AbortController()
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, true)
    throw init?.signal?.reason
  })
  controller.abort()
  await assert.rejects(fetchWeather(auckland, controller.signal), { name: 'AbortError' })
})

test('geocoding safely encodes names and rejects malformed coordinates', async (context) => {
  let requestedUrl: URL | undefined
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requestedUrl = input instanceof URL ? input : new URL(String(input))
    return new Response(JSON.stringify({ results: [
      { id: 2193733, ...auckland, timezone: 'Pacific/Auckland', country: 'New Zealand' },
      { name: 'Malformed', latitude: null, longitude: 5 },
    ] }))
  })
  const locations = await fetchLocations('Auckland & nearby')
  assert.equal(requestedUrl?.searchParams.get('name'), 'Auckland & nearby')
  assert.equal(locations.length, 1)
  assert.equal(locations[0]?.name, 'Auckland')
  assert.deepEqual(await fetchLocations('a'), [])
  await assert.rejects(fetchWeather({ ...auckland, latitude: 91 }), { code: 'invalid-data' })
})

test('WMO precipitation distinctions include fog, snow and freezing conditions', () => {
  for (const code of [51, 53, 55, 56, 57]) assert.equal(conditionFromWeatherCode(code), 'drizzle')
  for (const code of [61, 63, 65, 66, 67, 80, 81, 82]) assert.equal(conditionFromWeatherCode(code), 'rain')
  for (const code of [71, 73, 75, 77, 85, 86]) assert.equal(conditionFromWeatherCode(code), 'snow')
  for (const code of [95, 96, 99]) assert.equal(conditionFromWeatherCode(code), 'storm')
  assert.equal(conditionFromWeatherCode(48), 'fog')
  assert.equal(conditionFromWeatherCode(999), 'unknown')
})

test('SunCalc uses degrees and separates Auckland summer noon from midnight', () => {
  const noon = getSkyPosition(new Date('2026-01-15T00:00:00Z'), auckland)
  const midnight = getSkyPosition(new Date('2026-01-15T12:00:00Z'), auckland)
  assert.ok(noon.sun.altitude > 60, `Summer noon altitude was ${noon.sun.altitude}`)
  assert.ok(midnight.sun.altitude < -20)
  assert.equal(noon.isDay, true)
  assert.equal(midnight.isDay, false)
  assert.equal(noon.darkness, 0)
  assert.equal(midnight.darkness, 1)
  assert.ok(noon.moon.illuminatedFraction >= 0 && noon.moon.illuminatedFraction <= 1)
  assert.ok(noon.moon.azimuth >= 0 && noon.moon.azimuth < 360)
})

test('camera projection respects compass directions and the back of the viewer', () => {
  const east = projectCelestialPosition({ azimuth: 90, altitude: 0 }, 0)
  assert.ok(Math.abs(east.x - 1) < 1e-10)
  const west = projectCelestialPosition({ azimuth: 270, altitude: 0 }, 0)
  assert.ok(Math.abs(west.x + 1) < 1e-10)
  assert.equal(projectCelestialPosition({ azimuth: 180, altitude: 30 }, 0).inFrontOfCamera, false)
  assert.equal(projectCelestialPosition({ azimuth: 0, altitude: -20 }, 0).aboveHorizon, false)
  assert.equal(cameraBearingFromHouse(0, 0), 180)
  assert.equal(cameraBearingFromHouse(360, 35), 215)
  assert.equal(starVisibility(20, 0), 0)
  assert.equal(starVisibility(-20, 100), 0)
  assert.equal(starVisibility(-20, 0), 1)
})
