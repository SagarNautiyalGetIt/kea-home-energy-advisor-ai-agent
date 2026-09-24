import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraBearingFromHouse, getSkyPosition, projectCelestialPosition } from '../src/lib/astronomy.ts'
import { DEFAULT_LOCATION, previewTime, previewWeather } from '../src/lib/scenarios.ts'

test('Moonlight preview chooses a real dark Moon in front of the calibrated Auckland camera', () => {
  const now = new Date('2026-09-16T00:00:00Z')
  assert.equal(previewTime('live', DEFAULT_LOCATION, now, 0), now)

  const selected = previewTime('night', DEFAULT_LOCATION, now, 0)
  const sky = getSkyPosition(selected, DEFAULT_LOCATION)
  const moon = projectCelestialPosition(sky.moon, cameraBearingFromHouse(0))
  assert.ok(selected.getTime() >= now.getTime())
  assert.ok(selected.getTime() <= now.getTime() + 14 * 24 * 60 * 60 * 1000)
  assert.ok(sky.sun.altitude < -6)
  assert.ok(moon.aboveHorizon && moon.inFrontOfCamera)
  assert.ok(sky.moon.illuminatedFraction >= 0.08)
})

test('Starry preview chooses deep darkness with clear preview conditions', () => {
  const selected = previewTime('starry', DEFAULT_LOCATION, new Date('2026-09-16T00:00:00Z'), 0)
  const sky = getSkyPosition(selected, DEFAULT_LOCATION)
  const weather = previewWeather('starry', selected, DEFAULT_LOCATION)
  assert.ok(sky.sun.altitude < -18)
  assert.ok(weather.cloudCoverPercent <= 5)
  assert.equal(weather.rainMm, 0)
})

test('Calibrated Sunshine preview places the real Sun in front of the Auckland camera', () => {
  const now = new Date('2026-09-16T00:00:00Z')
  const selected = previewTime('sunny', DEFAULT_LOCATION, now, 0)
  const sky = getSkyPosition(selected, DEFAULT_LOCATION)
  const sun = projectCelestialPosition(sky.sun, cameraBearingFromHouse(0))
  assert.ok(selected.getTime() >= now.getTime())
  assert.ok(selected.getTime() < now.getTime() + 48 * 60 * 60 * 1000)
  assert.ok(sun.aboveHorizon && sun.inFrontOfCamera)
  assert.ok(sky.sun.altitude > 10)
})
