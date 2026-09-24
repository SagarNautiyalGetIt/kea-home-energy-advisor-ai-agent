import * as SunCalc from 'suncalc'

/** All angles use SunCalc 2 conventions: degrees; azimuth clockwise from true north. */
export interface CelestialPosition {
  azimuth: number
  altitude: number
}

export interface SkyPosition {
  sun: CelestialPosition
  moon: CelestialPosition & {
    illuminatedFraction: number
    phase: number
    waxing: boolean
    brightLimbAngle: number
  }
  /** Civil twilight lasts while the Sun is within six degrees below the horizon. */
  isDay: boolean
  isTwilight: boolean
  /** Geometric darkness only; cloud cover and local light pollution are separate. */
  darkness: number
}

export interface CelestialProjection {
  /** Unit horizontal offset: -1 left, +1 right of the direction the camera faces. */
  x: number
  /** Unit vertical elevation: 0 horizon, 1 zenith, -1 nadir. */
  y: number
  /** Forward component: negative means the object is behind the camera. */
  depth: number
  relativeBearingDegrees: number
  aboveHorizon: boolean
  inFrontOfCamera: boolean
}

export const ASTRONOMY_ATTRIBUTION = {
  label: 'Sun and Moon positions calculated with SunCalc',
  url: 'https://github.com/mourner/suncalc',
  licenceUrl: 'https://github.com/mourner/suncalc/blob/master/LICENSE',
} as const

export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/**
 * Convert the house's front-wall OUTWARD bearing to the camera's viewing bearing.
 * Camera offset is measured clockwise around the house from that front normal.
 * The supplied image views both front and right walls; its default offset is 35°.
 */
export function cameraBearingFromHouse(frontBearingDegrees: number, cameraOffsetDegrees = 35): number {
  return normalizeBearing(frontBearingDegrees + cameraOffsetDegrees + 180)
}

export function getSkyPosition(
  date: Date,
  location: { latitude: number; longitude: number },
): SkyPosition {
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
    !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180
  ) {
    throw new RangeError('A valid date, latitude, and longitude are required for sky positions.')
  }
  const sun = SunCalc.getPosition(date, location.latitude, location.longitude)
  const moon = SunCalc.getMoonPosition(date, location.latitude, location.longitude)
  const illumination = SunCalc.getMoonIllumination(date)
  return {
    sun: { azimuth: normalizeBearing(sun.azimuth), altitude: sun.altitude },
    moon: {
      azimuth: normalizeBearing(moon.azimuth),
      altitude: moon.altitude,
      illuminatedFraction: illumination.fraction,
      phase: illumination.phase,
      waxing: illumination.waxing,
      brightLimbAngle: illumination.angle - moon.parallacticAngle,
    },
    // The upper limb can be visible when the apparent centre is just below zero.
    isDay: sun.altitude >= -0.2667,
    isTwilight: sun.altitude < -0.2667 && sun.altitude > -6,
    darkness: Math.min(1, Math.max(0, (-sun.altitude - 6) / 12)),
  }
}

/** Orthographic sky-dome projection; keep depth to avoid showing objects behind the viewer. */
export function projectCelestialPosition(
  position: CelestialPosition,
  cameraBearingDegrees: number,
): CelestialProjection {
  const relativeBearingDegrees = normalizeBearing(position.azimuth - cameraBearingDegrees + 180) - 180
  const bearing = relativeBearingDegrees * Math.PI / 180
  const altitude = position.altitude * Math.PI / 180
  const depth = Math.cos(bearing) * Math.cos(altitude)
  return {
    x: Math.sin(bearing) * Math.cos(altitude),
    y: Math.sin(altitude),
    depth,
    relativeBearingDegrees,
    aboveHorizon: position.altitude > 0,
    inFrontOfCamera: depth >= 0,
  }
}

export function bearingLabel(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return directions[Math.round(normalizeBearing(degrees) / 45) % 8] ?? 'N'
}

/** A visual estimate, not an observation of visible stars or local light pollution. */
export function starVisibility(sunAltitudeDegrees: number, cloudCoverPercent: number): number {
  const darkness = Math.min(1, Math.max(0, (-sunAltitudeDegrees - 6) / 12))
  const clearFraction = 1 - Math.min(100, Math.max(0, cloudCoverPercent)) / 100
  return darkness * clearFraction ** 2
}
