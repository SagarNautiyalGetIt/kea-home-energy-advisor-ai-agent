import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Battery, CarFront, Check, Cloud, CloudRain, Compass, House, MapPin, Moon, RotateCw, Settings2, Sun, Zap } from 'lucide-react'
import EnergyHouse from './components/EnergyHouse'
import WeatherSky from './components/WeatherSky'
import SettingsDialog from './components/SettingsDialog'
import { calculateEnergy, type EnergySnapshot } from './lib/energy'
import { getSkyPosition, bearingLabel } from './lib/astronomy'
import { loadPreferences, savePreferences, type Preferences } from './lib/preferences'
import { SCENARIOS, previewTime, previewWeather, type ScenarioId } from './lib/scenarios'
import { fetchWeather, WEATHER_ATTRIBUTION, LOCATION_ATTRIBUTION, WEATHER_REFRESH_MS, type WeatherSnapshot } from './lib/weather'

type Device = 'solar' | 'home' | 'car' | 'battery' | 'grid'
const devices: Device[] = ['solar', 'home', 'car', 'battery', 'grid']
const deviceLabels: Record<Device, string> = { solar: 'Solar', home: 'Home', car: 'Electric car', battery: 'Kea battery', grid: 'Grid' }
const icons = { solar: Sun, home: House, car: CarFront, battery: Battery, grid: Zap }
function power(value: number) { return value < 0.05 ? '0.0' : value.toFixed(1) }
function localTime(time: number, timezone: string) {
  try { return new Intl.DateTimeFormat('en-NZ', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(time) }
  catch { return new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true }).format(time) }
}
function weatherName(weather: WeatherSnapshot | null, night: boolean) {
  if (!weather) return 'Weather unavailable'
  if (night) return weather.cloudCoverPercent < 20 ? 'Clear night' : 'Night sky'
  return ({ clear: 'Sunny', 'partly-cloudy': 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', drizzle: 'Drizzle', rain: 'Raining', snow: 'Snowing', storm: 'Stormy', unknown: 'Current conditions' })[weather.condition]
}
function WeatherIcon({ weather, night }: { weather: WeatherSnapshot | null; night: boolean }) {
  const Icon = night ? Moon : ['rain', 'drizzle', 'storm'].includes(weather?.condition ?? '') ? CloudRain : ['cloudy', 'partly-cloudy', 'fog'].includes(weather?.condition ?? '') ? Cloud : Sun
  return <Icon size={20} strokeWidth={1.7} />
}
function reading(snapshot: EnergySnapshot | null, device: Device) {
  if (!snapshot) return { kw: '—', status: 'Waiting' }
  switch (device) {
    case 'solar': return { kw: power(snapshot.solarKw), status: snapshot.solarKw > 0.05 ? 'Generating' : 'Not generating' }
    case 'home': return { kw: power(snapshot.homeServedKw), status: snapshot.homeState === 'powered' ? 'Powered' : 'Power limited' }
    case 'car': return { kw: power(snapshot.evServedKw), status: !snapshot.evDemandKw ? 'Not charging' : snapshot.evServedKw > 0.05 ? 'Charging' : 'Power limited' }
    case 'battery': return { kw: power(Math.max(snapshot.batteryChargeKw, snapshot.batteryDischargeKw)), status: `${snapshot.batteryPercent.toFixed(0)}% · ${snapshot.batteryState}` }
    case 'grid': return { kw: power(Math.max(snapshot.gridImportKw, snapshot.gridExportKw)), status: snapshot.gridState === 'outage' ? 'Disconnected' : snapshot.gridState === 'balanced' ? 'Idle' : snapshot.gridState }
  }
}
function explanation(snapshot: EnergySnapshot | null, device: Device, weather: WeatherSnapshot | null) {
  if (!snapshot) return 'Your energy preview will appear when weather conditions are available.'
  switch (device) {
    case 'solar': return weather?.isDay ? `${Math.round(weather.cloudCoverPercent)}% cloud cover helps explain this illustrative output. Roof direction, shading and actual panel efficiency are not measured.` : 'The Sun is below the horizon, so the panels cannot produce power in this view.'
    case 'home': return `The home asks for ${power(snapshot.homeDemandKw)} kW. Solar sends ${power(snapshot.flows.solarToHomeKw)} kW, and battery or grid covers the remaining demand.`
    case 'car': return snapshot.evDemandKw ? `The charger asks for ${power(snapshot.evDemandKw)} kW. The visible cable carries the supplied power into the car.` : 'Turn on car charging below to see the cable light up.'
    case 'battery': return `The example 13.5 kWh battery holds ${snapshot.batteryPercent.toFixed(0)}% charge. Discharging stops at the ${snapshot.reservePercent.toFixed(0)}% reserve.`
    case 'grid': return snapshot.gridState === 'outage' ? 'In an outage, solar and the battery support the home until the saved reserve is reached.' : snapshot.gridImportKw > 0.05 ? 'The grid supplies energy when solar and battery cannot cover the house and car.' : snapshot.gridExportKw > 0.05 ? 'Surplus power left after charging the battery goes out through the grid service pipe.' : 'The grid pipe is idle right now.'
  }
}
function summary(snapshot: EnergySnapshot | null, weather: WeatherSnapshot | null) {
  if (!snapshot || !weather) return 'The house is ready. Choose a preview while live weather loads.'
  if (snapshot.unservedKw > 0.05) return 'Backup is limited. Some demand cannot be supplied in this outage preview.'
  if (snapshot.gridImportKw > 0.05) return snapshot.batteryDischargeKw > 0.05
    ? weather.isDay ? 'The panels need help today. The battery and grid cover the remaining demand.' : 'After dark, the battery and grid share the remaining demand.'
    : weather.isDay ? 'The grid covers demand that the panels cannot supply while the battery holds its reserve.' : 'After dark, the grid supplies the house and car while the battery holds its reserve.'
  if (snapshot.gridExportKw > 0.05) return 'Your panels cover the house and car, charge the battery, then share the rest with the grid.'
  if (snapshot.batteryChargeKw > 0.05) return 'Solar powers your house and car. Spare sunlight charges the battery.'
  if (snapshot.batteryDischargeKw > 0.05) return 'The battery is supplying what the panels cannot right now.'
  return snapshot.solarKw > 0.05 ? 'Your panels are supplying your home.' : 'Your home is in balance.'
}

export default function App() {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scenario, setScenario] = useState<ScenarioId>('live')
  const [selected, setSelected] = useState<Device>('solar')
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)
  const [weatherError, setWeatherError] = useState('')
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [clock, setClock] = useState(() => new Date())
  const [batteryPercent, setBatteryPercent] = useState(68)
  const [evEnabled, setEvEnabled] = useState(true)
  const [gridConnected, setGridConnected] = useState(true)
  const [homeDemandKw, setHomeDemandKw] = useState(1.2)

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    const controller = new AbortController()
    setWeather(null); setWeatherError(''); setWeatherLoading(true)
    const load = () => { void fetchWeather(preferences.location, controller.signal)
      .then((next) => { if (!controller.signal.aborted) { setWeather(next); setWeatherError(''); setWeatherLoading(false) } })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setWeatherError(error instanceof Error ? error.message : 'Live weather could not load.'); setWeatherLoading(false) } }) }
    load()
    const interval = window.setInterval(load, WEATHER_REFRESH_MS)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [preferences.location, refresh])

  const time = useMemo(() => previewTime(scenario, preferences.location, clock, preferences.orientationSet ? preferences.frontBearing : undefined), [scenario, preferences.location, preferences.orientationSet, preferences.frontBearing, clock])
  const sceneWeather = useMemo(() => scenario === 'live' ? weather : previewWeather(scenario, time, preferences.location), [scenario, weather, time, preferences.location])
  const sky = useMemo(() => getSkyPosition(time, preferences.location), [time, preferences.location])
  const solarPotential = sceneWeather && sky.sun.altitude > 0 ? Math.min(1, Math.max(0, (sceneWeather.solarRadiationWm2 ?? 850 * (1 - sceneWeather.cloudCoverPercent / 100 * 0.82)) / 1000)) : 0
  const energy = useMemo(() => sceneWeather ? calculateEnergy({ solarPotential, batteryPercent, reservePercent: preferences.reservePercent, evEnabled, gridConnected, homeDemandKw }) : null,
    [sceneWeather, solarPotential, batteryPercent, preferences.reservePercent, evEnabled, gridConnected, homeDemandKw])
  const night = sky.sun.altitude < -0.267
  const timezone = preferences.location.timezone ?? 'UTC'
  const current = reading(energy, selected)
  const status = energy?.unservedKw && energy.unservedKw > 0.05 ? 'Power limited' : energy?.gridImportKw && energy.gridImportKw > 0.05 ? 'Grid assisting' : energy?.batteryDischargeKw && energy.batteryDischargeKw > 0.05 ? 'Battery assisting' : 'Self-powered now'
  const modeLabel = scenario === 'live' ? sceneWeather ? 'LIVE WEATHER · DEMO ENERGY' : 'LIVE WEATHER UNAVAILABLE' : 'WEATHER + ENERGY PREVIEW'
  const saveSettings = (next: Preferences) => { savePreferences(next); setPreferences(next); setSettingsOpen(false) }

  return <div className="kea-app">
    <header className="site-header"><div className="header-inner">
      <div className="brand" aria-label="Kea Energy"><span className="brand-mark">k<span>e</span>a<span className="brand-dot">.</span></span><span className="brand-divider" /><span className="brand-word">ENERGY</span></div>
      <nav className="header-nav" aria-label="Page"><span className="nav-active"><House size={17} /> My home</span><span className="nav-separator" /><span className="nav-caption">Energy view</span></nav>
      <div className="header-actions"><span className="prototype-tag">INTERACTIVE PROTOTYPE</span><button className="settings-open icon-action" onClick={() => setSettingsOpen(true)} aria-label="Home settings"><Settings2 size={20} /></button></div>
    </div></header>
    <main className="dashboard">
      <div className="page-heading"><div><span className="eyebrow">YOUR KEA HOME</span><h1>Energy, in its element.</h1><p>See how your home responds to the sky above it.</p></div>
        <button className="location-button" onClick={() => setSettingsOpen(true)}><MapPin size={18} /><span><strong>{preferences.location.name}</strong><small>{localTime(time.getTime(), timezone)} · {scenario === 'live' ? 'Live sky' : 'Preview sky'}</small></span><ArrowUpRight size={16} /></button></div>
      <section className="scene-shell" aria-label="Home energy and weather visualisation"><div className={`scene-backdrop scene-${sceneWeather?.condition ?? 'unavailable'} ${night ? 'scene-night' : 'scene-day'}`}>
        <WeatherSky weather={sceneWeather} time={time} location={preferences.location} houseFrontBearing={preferences.frontBearing} scenario={scenario} orientationSet={preferences.orientationSet} />
        <div className="scene-ground" aria-hidden="true"><span /></div>
        <div className="scene-topline"><div className="scene-weather"><span className="weather-icon"><WeatherIcon weather={sceneWeather} night={night} /></span><div><strong>{weatherName(sceneWeather, night)}</strong><small>{sceneWeather ? `${Math.round(sceneWeather.temperatureC)}°C · ${Math.round(sceneWeather.cloudCoverPercent)}% clouds` : weatherLoading ? 'Reading local weather…' : 'Choose a preview below'}</small></div></div>
          <div className="scene-top-actions">{!preferences.orientationSet && <button className="sky-direction-action" onClick={() => setSettingsOpen(true)}><Compass size={14} /> Set sky direction</button>}<span className="data-mode"><span className="mode-dot" />{modeLabel}</span></div></div>
        <EnergyHouse snapshot={energy} onDeviceSelect={setSelected} activeDevice={selected} />
        <div className="scene-bottomline"><div className="scene-status"><span className="status-led" /><div><small>RIGHT NOW</small><strong>{energy ? status : 'Awaiting weather'}</strong></div></div>{preferences.orientationSet && <div className="scene-orientation"><Compass size={15} />Front faces {bearingLabel(preferences.frontBearing)} · {Math.round(preferences.frontBearing)}°</div>}</div>
      </div></section>
      <div className="mobile-data-mode"><span className="mode-dot" />{modeLabel}</div>
      {scenario === 'live' && weatherError && <div className="weather-alert" role="status"><Cloud size={18} /><span>{weatherError} Weather previews still work.</span><button onClick={() => setRefresh((value) => value + 1)}><RotateCw size={15} /> Retry</button></div>}
      <section className="scenario-strip" aria-label="Weather mode"><div className="strip-heading"><span className="eyebrow">EXPLORE THE ELEMENTS</span><span>Change the sky, see the flow.</span></div><div className="scenario-tabs" role="group" aria-label="Weather previews">{SCENARIOS.map((item) => {
        const Icon = item.id === 'sunny' ? Sun : item.id === 'rain' ? CloudRain : item.id === 'cloudy' ? Cloud : item.id === 'night' ? Moon : item.id === 'starry' ? Moon : RotateCw
        return <button key={item.id} aria-pressed={scenario === item.id} className={scenario === item.id ? 'active' : ''} onClick={() => setScenario(item.id)}><Icon size={17} />{item.label}</button>
      })}</div></section>
      <section className="system-section" aria-label="Energy system"><div className="system-title"><div><span className="eyebrow">THE WHOLE SYSTEM</span><h2>Every watt has a way.</h2></div><p>{summary(energy, sceneWeather)}</p></div>
        <div className="device-grid">{devices.map((device) => { const metric = reading(energy, device); const Icon = icons[device]; return <button key={device} className={`device-cell ${selected === device ? 'selected' : ''}`} onClick={() => setSelected(device)} aria-pressed={selected === device}><span className="device-top"><Icon size={19} /><span>{deviceLabels[device]}</span></span><span className="device-reading"><strong>{metric.kw}</strong><small>kW</small></span><span className="device-state">{metric.status}</span></button> })}</div>
      </section>
      <section className="insight-section"><div className="insight-copy"><span className="eyebrow">A CLOSER LOOK</span><h2>{deviceLabels[selected]}</h2><p>{explanation(energy, selected, sceneWeather)}</p><div className="insight-facts"><span><strong>{current.kw} kW</strong><small>{current.status}</small></span>{selected === 'solar' && sceneWeather?.solarRadiationWm2 != null && <span><strong>{Math.round(sceneWeather.solarRadiationWm2)} W/m²</strong><small>{scenario === 'live' ? 'Modelled sunlight' : 'Example sunlight'}</small></span>}{selected === 'battery' && <span><strong>{batteryPercent}%</strong><small>Example charge</small></span>}</div></div>
        <div className="demo-controls"><div className="control-heading"><span className="eyebrow">TRY A DIFFERENT STATE</span><small>These inputs are examples, not meter readings.</small></div>
          <label className="slider-control" htmlFor="battery-level"><span><Battery size={16} /> Battery charge</span><output>{batteryPercent}%</output></label><input id="battery-level" type="range" min="0" max="100" value={batteryPercent} onChange={(e) => setBatteryPercent(Number(e.target.value))} /><p className="control-hint">Reserve: {preferences.reservePercent}% · <button onClick={() => setSettingsOpen(true)}>Change <ArrowUpRight size={12} /></button></p>
          <label className="slider-control" htmlFor="home-demand"><span><House size={16} /> Home demand</span><output>{homeDemandKw.toFixed(1)} kW</output></label><input id="home-demand" type="range" min="0.4" max="5" step="0.1" value={homeDemandKw} onChange={(e) => setHomeDemandKw(Number(e.target.value))} />
          <div className="switch-row"><span><CarFront size={16} /> Charge electric car</span><label className="switch"><input type="checkbox" checked={evEnabled} onChange={(e) => setEvEnabled(e.target.checked)} aria-label="Charge electric car" /><span /></label></div>
          <div className="switch-row"><span><Zap size={16} /> Grid connected</span><label className="switch"><input type="checkbox" checked={gridConnected} onChange={(e) => setGridConnected(e.target.checked)} aria-label="Grid connected" /><span /></label></div>
        </div>
      </section>
      <footer className="page-footer"><div><Check size={15} /><span>Your supplied house anchors this scene. Weather follows a model; energy readings show a balanced demo, not a connected meter.</span></div><div className="credits"><a href={WEATHER_ATTRIBUTION.url} target="_blank" rel="noreferrer">{WEATHER_ATTRIBUTION.label}</a><a href={LOCATION_ATTRIBUTION.url} target="_blank" rel="noreferrer">GeoNames</a><a href="https://github.com/mourner/suncalc" target="_blank" rel="noreferrer">SunCalc</a></div></footer>
    </main>
    {settingsOpen && <SettingsDialog preferences={preferences} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
  </div>
}
