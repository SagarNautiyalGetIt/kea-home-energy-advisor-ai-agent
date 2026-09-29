import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import gsap from 'gsap'
import { AlarmClock, BatteryCharging, Cloud, CloudRain, Compass, Gauge, Moon, Sun, UtilityPole } from 'lucide-react'
import EnergyHouse, { type EnergyDevice } from './components/EnergyHouse'
import SettingsDialog from './components/SettingsDialog'
import WeatherSky from './components/WeatherSky'
import { getSkyPosition } from './lib/astronomy'
import { calculateEnergy } from './lib/energy'
import { loadPreferences, savePreferences, type Preferences } from './lib/preferences'
import { previewWeather } from './lib/scenarios'
import { fetchWeather, WEATHER_REFRESH_MS, type WeatherSnapshot } from './lib/weather'
import './EnergyHomePanel.css'

const HOME_DEMAND_KW = 1.2
const BATTERY_PERCENT = 68
// Fixed illustrative production keeps the solar conduit visibly flowing in the dashboard
// scene, independently of the live sky and real meter data.
const DEMO_SOLAR_KW = 2.4
const DEMO_SOLAR_CAPACITY_KW = 6.5
// The grid figure is not a number that can be set: `calculateEnergy` derives it from
// whatever solar and the battery cannot cover, so the only way to light the grid conduit
// is to give the house more to do than those two can carry. A 7.2 kW charger (32 A on a
// single phase, the usual home wallbox) against a 4 kW battery inverter does exactly
// that, and leaves all three sources feeding the house at once — which is the state this
// diagram exists to show. Drop the charger back to 3.2 and the battery alone covers it,
// the grid reads 0.0 and its conduit goes dark.
const DEMO_EV_KW = 7.2
const DEMO_BATTERY_MAX_DISCHARGE_KW = 4

// The top-right corner of the scene now leads to the bill-shock warning, so the two
// things that used to sit there are hidden rather than deleted. The direction button is
// the only way into the settings dialog; flip its flag to bring it back. The badge said the
// energy figures are illustrative; that job now belongs to the "Illustrative flow" tag on
// the status chip, which is always shown (see below).
const SHOW_SKY_DIRECTION_BUTTON = false
const SHOW_DATA_MODE_BADGE = false

function weatherName(weather: WeatherSnapshot, night: boolean) {
  if (night) return weather.cloudCoverPercent < 20 ? 'Clear night' : 'Night sky'
  return ({
    clear: 'Sunny',
    'partly-cloudy': 'Partly cloudy',
    cloudy: 'Cloudy',
    fog: 'Foggy',
    drizzle: 'Drizzle',
    rain: 'Raining',
    snow: 'Snowing',
    storm: 'Stormy',
    unknown: 'Current conditions',
  })[weather.condition]
}

function WeatherIcon({ weather, night }: { weather: WeatherSnapshot; night: boolean }) {
  const Icon = night
    ? Moon
    : ['rain', 'drizzle', 'storm'].includes(weather.condition)
      ? CloudRain
      : ['cloudy', 'partly-cloudy', 'fog'].includes(weather.condition)
        ? Cloud
        : Sun
  return <Icon size={20} strokeWidth={1.7} />
}

/**
 * A popover anchored inside the scene, not a modal: it closes on the next click anywhere
 * else, or on Escape, or it would sit over the house until its button is found again.
 */
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

/**
 * Embedded scene from the complete Kea home prototype in energy-home-prototype/.
 * Weather, astronomical positioning, deterministic energy dispatch, SVG flow
 * animation, settings, and accessible device controls remain functional.
 *
 * The two top corners open the page's own data, which the page supplies because it is
 * the page's, not the scene's; without it that corner's chip is not drawn. `summary` is
 * what the chip in the top-left corner opens, and `billShock` what the warning chip in
 * the top-right corner opens. `billShockTriggered` makes that chip's alarm clock ring,
 * so it only rings when there is actually something to warn about.
 */
export default function EnergyHomePanel({ summary, billShock, billShockTriggered = false }: { summary?: ReactNode; billShock?: ReactNode; billShockTriggered?: boolean }) {
  const sceneRef = useRef<HTMLDivElement>(null)
  const sceneInView = useRef(true)
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<EnergyDevice>('solar')
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)
  const [clock, setClock] = useState(() => new Date())

  const syncSceneAnimation = useCallback(() => {
    const scene = sceneRef.current
    if (!scene) return
    const active = sceneInView.current && !document.hidden
    gsap.getTweensOf(scene.querySelectorAll('*')).forEach((tween) => tween.paused(!active))
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      sceneInView.current = entries[0]?.isIntersecting ?? false
      syncSceneAnimation()
    }, { rootMargin: '120px' })
    observer?.observe(scene)
    document.addEventListener('visibilitychange', syncSceneAnimation)
    syncSceneAnimation()
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', syncSceneAnimation)
    }
  }, [syncSceneAnimation])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      void fetchWeather(preferences.location, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setWeather(next)
        })
        .catch(() => {
          // The panel intentionally keeps a deterministic sky when the network is
          // unavailable, so the Usage page never collapses into an error state.
        })
    }
    load()
    const interval = window.setInterval(load, WEATHER_REFRESH_MS)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [preferences.location])

  const sky = useMemo(
    () => getSkyPosition(clock, preferences.location),
    [clock, preferences.location],
  )
  const night = sky.sun.altitude < -0.267
  const fallbackWeather = useMemo(
    () => previewWeather(night ? 'starry' : 'sunny', clock, preferences.location),
    [clock, night, preferences.location],
  )
  const sceneWeather = weather ?? fallbackWeather
  const energy = useMemo(() => calculateEnergy({
    solarPotential: DEMO_SOLAR_KW / DEMO_SOLAR_CAPACITY_KW,
    batteryPercent: BATTERY_PERCENT,
    reservePercent: preferences.reservePercent,
    evEnabled: true,
    gridConnected: true,
    homeDemandKw: HOME_DEMAND_KW,
    evDemandKw: DEMO_EV_KW,
    batteryMaxDischargeKw: DEMO_BATTERY_MAX_DISCHARGE_KW,
  }), [preferences.reservePercent])

  // Weather and flow changes can create fresh GSAP tweens while the scene is hidden.
  useEffect(syncSceneAnimation, [energy, sceneWeather, selectedDevice, syncSceneAnimation])

  // The source topping the house up right now. The bottom-right chip shows that source's
  // icon in its legend colour, so "Grid assisting" reads grid orange rather than a fixed
  // green that said "solar" whatever the text said.
  const statusSource = energy.gridImportKw > 0.05
    ? 'grid'
    : energy.batteryDischargeKw > 0.05
      ? 'battery'
      : 'solar'
  const status = { grid: 'Grid assisting', battery: 'Battery assisting', solar: 'Self-powered now' }[statusSource]
  const StatusIcon = { grid: UtilityPole, battery: BatteryCharging, solar: Sun }[statusSource]
  const summaryPopover = usePopover()
  const alertPopover = usePopover()

  const saveSettings = (next: Preferences) => {
    savePreferences(next)
    setPreferences(next)
    setSettingsOpen(false)
  }

  return (
    <div className="energy-home-panel">
      <section className="energy-home-scene-shell" aria-label="Interactive home energy and weather visualisation">
        <div ref={sceneRef} className={`energy-home-scene energy-home-scene--${sceneWeather.condition} ${night ? 'energy-home-scene--night' : 'energy-home-scene--day'}`}>
          <WeatherSky
            weather={sceneWeather}
            time={clock}
            location={preferences.location}
            houseFrontBearing={preferences.frontBearing}
            scenario="live"
            orientationSet={preferences.orientationSet}
          />
          <div className="energy-home-ground" aria-hidden="true"><span /></div>

          <div className="energy-home-topline">
            {/* Styled like the weather chip, which now sits in the bottom-left corner. The
                gauge reads as a meter, so it is not mistaken for the sidebar's Usage page. */}
            {summary && (
              <div className="energy-home-summary" ref={summaryPopover.ref}>
                <button
                  type="button"
                  className="energy-home-weather energy-home-summary-trigger"
                  aria-expanded={summaryPopover.open}
                  aria-controls="energy-home-summary-detail"
                  onClick={() => summaryPopover.setOpen((open) => !open)}
                >
                  <span className="energy-home-weather-icon"><Gauge size={19} /></span>
                  <div>
                    <strong>Usage &amp; Costs</strong>
                    <small>This cycle so far</small>
                  </div>
                </button>
                {summaryPopover.open && (
                  <div className="energy-home-summary-detail" id="energy-home-summary-detail">
                    {summary}
                  </div>
                )}
              </div>
            )}
            <div className="energy-home-actions">
              {SHOW_SKY_DIRECTION_BUTTON && !preferences.orientationSet && (
                <button type="button" className="energy-home-direction" onClick={() => setSettingsOpen(true)}>
                  <Compass size={14} /> Set sky direction
                </button>
              )}
              {/* The mirror image of the summary chip opposite: text then circle, rather
                  than circle then text, so the two corners frame the house instead of
                  pointing the same way. The popover shows the page's bill-shock
                  assessment, the same content the dashboard card used to hold. */}
              {billShock && (
                <div className="energy-home-alert" ref={alertPopover.ref}>
                  <button
                    type="button"
                    className={`energy-home-weather energy-home-alert-trigger${billShockTriggered ? ' is-ringing' : ''}`}
                    aria-expanded={alertPopover.open}
                    aria-controls="energy-home-alert-detail"
                    onClick={() => alertPopover.setOpen((open) => !open)}
                  >
                    <div>
                      <strong>Power Bill Shock Warning</strong>
                      <small>Projection for this cycle</small>
                    </div>
                    <span className="energy-home-weather-icon"><AlarmClock size={19} /></span>
                  </button>
                  {alertPopover.open && (
                    <div className="energy-home-alert-detail" id="energy-home-alert-detail">
                      {billShock}
                    </div>
                  )}
                </div>
              )}
              {SHOW_DATA_MODE_BADGE && (
                <span className="energy-home-mode">
                  <span className="energy-home-mode-dot" />
                  {weather ? 'LIVE WEATHER · DEMO ENERGY' : 'LOCAL SKY · DEMO ENERGY'}
                </span>
              )}
            </div>
          </div>

          <EnergyHouse
            snapshot={energy}
            onDeviceSelect={setSelectedDevice}
            activeDevice={selectedDevice}
          />

          <div className="energy-home-bottomline">
            <div className="energy-home-weather">
              <span className="energy-home-weather-icon"><WeatherIcon weather={sceneWeather} night={night} /></span>
              <div>
                <strong>{weatherName(sceneWeather, night)}</strong>
                <small>{Math.round(sceneWeather.temperatureC)}°C · {Math.round(sceneWeather.cloudCoverPercent)}% clouds</small>
              </div>
            </div>
            <div className={`energy-home-weather energy-home-now energy-home-now--${statusSource}`}>
              <div>
                {/* Always shown, never behind a flag. The flow and this status are worked out
                    from fixed demo figures (DEMO_*), not this household's meters, and the
                    scene sits beside live account figures, so without it "Grid assisting"
                    reads as this home's power right now. */}
                <span className="energy-home-illustrative">Illustrative flow</span>
                <strong>{status}</strong>
                <small className="energy-home-legend" role="group" aria-label="Energy flow colours: solar green, battery blue, grid orange">
                  <span className="energy-home-legend-solar"><i />Solar</span>
                  <span className="energy-home-legend-battery"><i />Battery</span>
                  <span className="energy-home-legend-grid"><i />Grid</span>
                </small>
              </div>
              <span className="energy-home-weather-icon"><StatusIcon size={19} /></span>
            </div>
          </div>
        </div>
      </section>
      {settingsOpen && (
        <SettingsDialog
          preferences={preferences}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
