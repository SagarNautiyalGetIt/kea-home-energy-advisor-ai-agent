import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Compass, MapPin, Search, X } from 'lucide-react'
import { bearingLabel } from '../lib/astronomy'
import { fetchLocations, type Location } from '../lib/weather'
import type { Preferences } from '../lib/preferences'

interface Props { preferences: Preferences; onSave: (value: Preferences) => void; onClose: () => void }

export default function SettingsDialog({ preferences, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [location, setLocation] = useState(preferences.location)
  const [bearing, setBearing] = useState(preferences.frontBearing)
  const [orientationSet, setOrientationSet] = useState(preferences.orientationSet)
  const [reserve, setReserve] = useState(preferences.reservePercent)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Location[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const searchRequest = useRef<AbortController | null>(null)
  const [latitude, setLatitude] = useState(String(location.latitude))
  const [longitude, setLongitude] = useState(String(location.longitude))
  const [timezone, setTimezone] = useState(location.timezone ?? 'Pacific/Auckland')
  const [manual, setManual] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
    return () => { searchRequest.current?.abort() }
  }, [])

  const selectLocation = (next: Location) => {
    setLocation(next); setLatitude(String(next.latitude)); setLongitude(String(next.longitude))
    setTimezone(next.timezone ?? 'UTC'); setResults([]); setQuery(''); setSearched(false); setError(''); setManual(false)
  }
  const search = async () => {
    if (query.trim().length < 2) { setError('Enter at least two letters to find a place.'); return }
    searchRequest.current?.abort()
    const controller = new AbortController(); searchRequest.current = controller
    setLoading(true); setError(''); setSearched(false)
    try { setResults(await fetchLocations(query.trim(), controller.signal)); setSearched(true) }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Location search failed.') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  const save = () => {
    let next = location
    if (manual) {
      const lat = Number(latitude); const lon = Number(longitude)
      if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        setError('Enter latitude from −90 to 90 and longitude from −180 to 180.'); return
      }
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format() }
      catch { setError('Enter a valid time zone, for example Pacific/Auckland.'); return }
      next = { name: 'My home', latitude: lat, longitude: lon, timezone }
    }
    onSave({ location: next, frontBearing: bearing, orientationSet, reservePercent: reserve })
  }

  return <dialog ref={dialog} className="settings-dialog" onCancel={onClose} aria-labelledby="settings-title" onClick={(event) => { if (event.target === dialog.current) onClose() }}>
    <div className="dialog-content">
      <header><div><span className="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">Your home, your sky.</h2></div><button className="icon-button" aria-label="Close settings" onClick={onClose}><X size={21} /></button></header>
      <p className="dialog-intro">Set the location and direction your front door faces. The house stays fixed; the Sun and Moon follow your local sky.</p>
      <section className="settings-section">
        <h3><MapPin size={17} /> Home location</h3>
        <div className="chosen-location"><div><strong>{location.name}</strong><span>{location.country ?? 'Custom location'} · {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</span></div><Check size={18} /></div>
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <label className="sr-only" htmlFor="location-search">Search town or city</label>
          <Search size={17} /><input id="location-search" placeholder="Search a town or city" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          <button type="submit" disabled={loading}>{loading ? 'Finding…' : 'Find'}</button>
        </form>
        {loading && <div className="loading-line" role="status"><span className="lite-loader"><i /><i /><i /></span> Finding your location</div>}
        {results.length > 0 && <ul className="location-results">{results.map((l) => <li key={`${l.id}-${l.latitude}`}><button onClick={() => selectLocation(l)}><MapPin size={15} /><span><strong>{l.name}</strong><small>{[l.admin1, l.country].filter(Boolean).join(', ')}</small></span><ArrowUpRight size={16} /></button></li>)}</ul>}
        {searched && !results.length && <p className="field-note">No matching places. Try a nearby city or enter coordinates below.</p>}
        <button className="text-button" onClick={() => setManual(!manual)} aria-expanded={manual}>{manual ? 'Use the selected town instead' : 'Enter exact coordinates'}</button>
        {manual && <div className="coordinate-fields"><label>Latitude<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label><label>Longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label><label className="timezone-field">Time zone<input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Pacific/Auckland" /></label></div>}
        <p className="field-note">Town search uses its centre. Use exact coordinates for your house. Coordinates are sent to Open-Meteo for weather.</p>
      </section>
      <section className="settings-section">
        <h3><Compass size={17} /> Front door direction <output>{Math.round(bearing)}° {bearingLabel(bearing)}</output></h3>
        <label className="sr-only" htmlFor="house-bearing">Front door bearing in degrees from true north</label>
        <input id="house-bearing" type="range" min="0" max="359" value={bearing} onChange={(e) => { setBearing(Number(e.target.value)); setOrientationSet(true) }} />
        <div className="range-labels"><span>0° North</span><span>180° South</span><span>359°</span></div>
        <p className="field-note">The outward direction of the front door, measured from true north. The camera is fixed 35° around the house. Sky positions are calculated; house lighting is an illustration.</p>
        <button className="text-button" onClick={() => setOrientationSet(!orientationSet)}>{orientationSet ? 'Direction unknown — hide Sun and Moon' : 'Use this direction for the sky'}</button>
      </section>
      <section className="settings-section compact-section"><label className="reserve-label" htmlFor="reserve-setting">Keep in battery reserve <output>{reserve}%</output></label><input id="reserve-setting" type="range" min="0" max="100" step="5" value={reserve} onChange={(e) => setReserve(Number(e.target.value))} /></section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" onClick={save}>Use these settings <ArrowUpRight size={18} /></button>
      <p className="dialog-footnote">Saved only in this browser. Location search uses GeoNames via Open-Meteo.</p>
    </div>
  </dialog>
}
