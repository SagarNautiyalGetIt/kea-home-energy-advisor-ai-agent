import { cameraBearingFromHouse, getSkyPosition, projectCelestialPosition } from './astronomy.ts'
import type { Location, WeatherSnapshot } from './weather.ts'

export type ScenarioId = 'live' | 'sunny' | 'cloudy' | 'rain' | 'night' | 'starry'

export const SCENARIOS: { id: ScenarioId; label: string; shortLabel: string }[] = [
  { id: 'live', label: 'Live weather', shortLabel: 'Live' },
  { id: 'sunny', label: 'Sunshine', shortLabel: 'Sunshine' },
  { id: 'cloudy', label: 'Cloudy', shortLabel: 'Cloudy' },
  { id: 'rain', label: 'Rain', shortLabel: 'Rain' },
  { id: 'night', label: 'Moonlight', shortLabel: 'Night' },
  { id: 'starry', label: 'Starry night', shortLabel: 'Stars' },
]

export const DEFAULT_LOCATION: Location = {
  name: 'Auckland', latitude: -36.8485, longitude: 174.7633,
  timezone: 'Pacific/Auckland', country: 'New Zealand',
}

const HALF_HOUR_MS = 30 * 60 * 1000

// Preview times are real nearby instants. The live mode always uses the actual clock.
export function previewTime(
  scenario: ScenarioId,
  location: Location,
  now: Date,
  confirmedHouseFrontBearing?: number,
): Date {
  if (scenario === 'live') return now

  if (scenario === 'night') {
    const cameraBearing = confirmedHouseFrontBearing !== undefined && Number.isFinite(confirmedHouseFrontBearing)
      ? cameraBearingFromHouse(confirmedHouseFrontBearing) : null
    let firstMoonlitAt: number | null = null
    let bestMoonlit: Date | null = null
    let bestMoonlitScore = -Infinity
    let fallback = now
    let fallbackScore = Infinity

    // Allow half a lunar cycle, but choose the best moment during the FIRST qualifying night.
    for (let step = 0; step <= 14 * 48; step++) {
      const candidate = new Date(now.getTime() + step * HALF_HOUR_MS)
      const sky = getSkyPosition(candidate, location)
      if (step <= 2 * 48 && sky.sun.altitude < fallbackScore) {
        fallbackScore = sky.sun.altitude
        fallback = candidate
      }
      if (sky.sun.altitude >= -6 || sky.moon.altitude <= 3 || sky.moon.illuminatedFraction < 0.08) continue
      if (cameraBearing !== null) {
        const moon = projectCelestialPosition(sky.moon, cameraBearing)
        if (!moon.inFrontOfCamera || !moon.aboveHorizon) continue
      }
      if (firstMoonlitAt === null) firstMoonlitAt = candidate.getTime()
      if (candidate.getTime() - firstMoonlitAt > 14 * 60 * 60 * 1000) break
      const score = sky.darkness * 100 + Math.min(sky.moon.altitude, 70) * 0.35 + sky.moon.illuminatedFraction * 8
      if (score > bestMoonlitScore) {
        bestMoonlit = candidate
        bestMoonlitScore = score
      }
    }
    // If no Moon can be seen from this fixed camera soon, keep a truthful dark sky.
    return bestMoonlit ?? fallback
  }

  const starry = scenario === 'starry'
  const cameraBearing = !starry && confirmedHouseFrontBearing !== undefined && Number.isFinite(confirmedHouseFrontBearing)
    ? cameraBearingFromHouse(confirmedHouseFrontBearing) : null
  const fineSampling = starry || cameraBearing !== null
  const stepMs = fineSampling ? HALF_HOUR_MS : 2 * HALF_HOUR_MS
  const steps = fineSampling ? 2 * 48 : 48
  let best = now
  let bestScore = -Infinity
  let bestFront: Date | null = null
  let bestFrontScore = -Infinity
  for (let step = 0; step < steps; step++) {
    const candidate = new Date(now.getTime() + step * stepMs)
    const sky = getSkyPosition(candidate, location)
    // Moonlight has its own visible-Moon search; stars favour the deepest dark sky.
    const score = starry ? -sky.sun.altitude : sky.sun.altitude
    if (score > bestScore) { bestScore = score; best = candidate }
    if (cameraBearing !== null) {
      const sun = projectCelestialPosition(sky.sun, cameraBearing)
      if (sun.aboveHorizon && sun.inFrontOfCamera) {
        // Balance elevation with depth so a high Sun on the camera edge does not win.
        const frontScore = sky.sun.altitude * Math.sqrt(Math.max(0, sun.depth)) - step * 0.006
        if (frontScore > bestFrontScore) { bestFrontScore = frontScore; bestFront = candidate }
      }
    }
  }
  return bestFront ?? best
}

export function previewWeather(scenario: Exclude<ScenarioId, 'live'>, time: Date, location: Location): WeatherSnapshot {
  const night = scenario === 'night' || scenario === 'starry'
  const rain = scenario === 'rain'
  const cloudy = scenario === 'cloudy'
  return {
    observedAt: time.getTime(), fetchedAt: time.getTime(), intervalSeconds: 900,
    timezone: location.timezone ?? 'UTC', temperatureC: night ? 11 : rain ? 14 : cloudy ? 17 : 22,
    isDay: !night, weatherCode: rain ? 63 : cloudy ? 3 : 0,
    cloudCoverPercent: rain ? 98 : cloudy ? 85 : scenario === 'night' ? 30 : 4,
    precipitationMm: rain ? 2.4 : 0, rainMm: rain ? 2.4 : 0, snowfallCm: 0,
    windSpeedKmh: rain ? 19 : cloudy ? 12 : 7, windDirectionDegrees: 225,
    solarRadiationWm2: night ? 0 : rain ? 90 : cloudy ? 235 : 870,
    condition: rain ? 'rain' : cloudy ? 'cloudy' : 'clear',
  }
}
