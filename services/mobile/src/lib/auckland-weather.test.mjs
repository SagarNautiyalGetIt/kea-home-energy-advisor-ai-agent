import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAucklandWeather, weatherCodeDetails, fetchHouseholdWeather, restoreWeatherCache, isWeatherFresh } from './auckland-weather.ts';

describe('Auckland weather', () => {
  it('maps a valid current interval to a labelled Auckland condition', () => {
    const result = parseAucklandWeather({ current: {
      time: 1790213400,
      temperature_2m: 13.3,
      is_day: 1,
      weather_code: 2,
      cloud_cover: 40,
      shortwave_radiation_instant: 423.2,
    } }, 123);
    assert.equal(result.observedAt, 1790213400000);
    assert.equal(result.fetchedAt, 123);
    assert.equal(result.temperatureC, 13.3);
    assert.equal(result.description, 'Partly cloudy');
    assert.equal(result.solarRadiationWm2, 423.2);
  });

  it('rejects missing temperature and out-of-range cloud cover', () => {
    const current = { time: 1790213400, temperature_2m: 13.3, is_day: 1, weather_code: 0, cloud_cover: 0 };
    assert.throws(() => parseAucklandWeather({ current: { ...current, temperature_2m: null } }));
    assert.throws(() => parseAucklandWeather({ current: { ...current, cloud_cover: 110 } }));
  });

  it('treats missing irradiance as unavailable and unknown WMO codes as unknown', () => {
    const result = parseAucklandWeather({ current: {
      time: 1790213400, temperature_2m: 13.3, is_day: 0, weather_code: 999, cloud_cover: 0,
    } });
    assert.equal(result.solarRadiationWm2, null);
    assert.equal(result.condition, 'unknown');
    assert.equal(weatherCodeDetails(95).description, 'Thunderstorm');
  });
});

it('uses one native-safe Auckland forecast request and validates freshness', async () => {
  const originalFetch = globalThis.fetch, OriginalURL = globalThis.URL;
  const requests = [];
  const body = { current: { time: Math.floor(Date.now() / 1000), temperature_2m: 13, is_day: 0, weather_code: 51, cloud_cover: 100 } };
  try {
    globalThis.URL = class { constructor() { throw new Error('native URL mutation unavailable'); } };
    globalThis.fetch = async (url, options) => { requests.push([url, options]); return { ok: true, json: async () => body }; };
    const weather = await fetchHouseholdWeather(' Auckland ');
    assert.equal(requests.length, 1);
    assert.match(requests[0][0], /^https:\/\/api.open-meteo.com\/v1\/forecast\?/);
    assert.match(requests[0][0], /latitude=-36.84853&longitude=174.76349/);
    assert.ok(requests[0][1].signal instanceof AbortSignal);
    assert.equal(weather.condition, 'drizzle');
    assert.ok(isWeatherFresh(weather));
    body.current.time -= 7200;
    await assert.rejects(fetchHouseholdWeather('Auckland'), /outdated/);
    const aborted = new AbortController(); aborted.abort();
    const count = requests.length;
    await assert.rejects(fetchHouseholdWeather('Auckland', aborted.signal), /cancelled/);
    assert.equal(requests.length, count);
  } finally { globalThis.fetch = originalFetch; globalThis.URL = OriginalURL; }
});
it('rejects incorrect-country/malformed geocoding and exposes provider failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [{ country_code: 'AU', latitude: -33, longitude: 151 }] }) });
    await assert.rejects(fetchHouseholdWeather('Unknown Region'), /New Zealand/);
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(fetchHouseholdWeather('Auckland'), /HTTP 429/);
    await assert.rejects(fetchHouseholdWeather(''), /no region/);
  } finally { globalThis.fetch = originalFetch; }
});
it('validated last-known cache retains its original time and cannot pass as current', () => {
  const weather = parseAucklandWeather({ current: { time: 100, temperature_2m: 13, is_day: 0, weather_code: 0, cloud_cover: 0 } }, 101_000);
  assert.deepEqual(restoreWeatherCache(weather), weather);
  assert.equal(isWeatherFresh(weather, 100_000), true);
  assert.equal(isWeatherFresh(weather, 100_000 + 90 * 60 * 1000), false);
  assert.equal(isWeatherFresh(weather, 0), false);
  assert.equal(restoreWeatherCache({ ...weather, temperatureC: null }), null);
});
