import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAucklandWeather, weatherCodeDetails } from './auckland-weather.ts';

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
