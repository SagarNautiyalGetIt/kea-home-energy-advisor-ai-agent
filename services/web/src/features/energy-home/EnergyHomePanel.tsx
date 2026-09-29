import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { Cloud, CloudRain, Compass, Moon, Sun } from 'lucide-react'
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
// Fixed illustrative production keeps the solar conduit visibly flowing in the
// embedded Usage preview, independently of the live sky and real meter data.
const DEMO_SOLAR_KW = 2.4
const DEMO_SOLAR_CAPACITY_KW = 6.5

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
 * Embedded scene from the complete Kea home prototype in energy-home-prototype/.
 * Weather, astronomical positioning, deterministic energy dispatch, SVG flow
 * animation, settings, and accessible device controls remain functional.
 */
export default function EnergyHomePanel() {
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
  }), [preferences.reservePercent])

  // Weather and flow changes can create fresh GSAP tweens while the scene is hidden.
  useEffect(syncSceneAnimation, [energy, sceneWeather, selectedDevice, syncSceneAnimation])

  const status = energy.gridImportKw > 0.05
    ? 'Grid assisting'
    : energy.batteryDischargeKw > 0.05
      ? 'Battery assisting'
      : 'Self-powered now'
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
            <div className="energy-home-weather">
              <span className="energy-home-weather-icon"><WeatherIcon weather={sceneWeather} night={night} /></span>
              <div>
                <strong>{weatherName(sceneWeather, night)}</strong>
                <small>{Math.round(sceneWeather.temperatureC)}°C · {Math.round(sceneWeather.cloudCoverPercent)}% clouds</small>
              </div>
            </div>
            <div className="energy-home-actions">
              {!preferences.orientationSet && (
                <button type="button" className="energy-home-direction" onClick={() => setSettingsOpen(true)}>
                  <Compass size={14} /> Set sky direction
                </button>
              )}
              <span className="energy-home-mode">
                <span className="energy-home-mode-dot" />
                {weather ? 'LIVE WEATHER · DEMO ENERGY' : 'LOCAL SKY · DEMO ENERGY'}
              </span>
            </div>
          </div>

          <EnergyHouse
            snapshot={energy}
            onDeviceSelect={setSelectedDevice}
            activeDevice={selectedDevice}
          />

          <div className="energy-home-bottomline">
            <div className="energy-home-status">
              <span className="energy-home-status-led" />
              <div><small>RIGHT NOW</small><strong>{status}</strong></div>
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
