import { DEFAULT_LOCATION } from './scenarios'
import type { Location } from './weather'

export interface Preferences {
  location: Location
  frontBearing: number
  orientationSet: boolean
  reservePercent: number
}

const defaults: Preferences = { location: DEFAULT_LOCATION, frontBearing: 0, orientationSet: false, reservePercent: 20 }
export function loadPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('kea-home-preferences') ?? 'null')
    if (!saved || typeof saved !== 'object') return defaults
    const p = saved as Partial<Preferences>
    const l = p.location
    if (!l || typeof l.name !== 'string' || !Number.isFinite(l.latitude) || !Number.isFinite(l.longitude) || Math.abs(l.latitude) > 90 || Math.abs(l.longitude) > 180) return defaults
    if (l.timezone) new Intl.DateTimeFormat('en', { timeZone: l.timezone }).format()
    return {
      location: l, frontBearing: typeof p.frontBearing === 'number' && Number.isFinite(p.frontBearing) ? ((p.frontBearing % 360) + 360) % 360 : 0,
      orientationSet: p.orientationSet === true,
      reservePercent: typeof p.reservePercent === 'number' && Number.isFinite(p.reservePercent) ? Math.max(0, Math.min(100, p.reservePercent)) : 20,
    }
  } catch { return defaults }
}
export function savePreferences(preferences: Preferences): void {
  try { localStorage.setItem('kea-home-preferences', JSON.stringify(preferences)) } catch { /* Session remains usable with storage disabled. */ }
}
