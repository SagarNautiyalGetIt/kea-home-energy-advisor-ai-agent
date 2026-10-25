import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Car, Check, Compass, Crown, Cuboid, Gift, Leaf, MapPin, ShieldCheck, Sun, Timer, Trophy, Zap } from 'lucide-react'
import SparkyIcon from '../components/SparkyIcon'
import { ClashSignInError, getClashProgress, planClashQuest, type ClashProgress } from '../lib/clash-api'
import { clashDay, plannedQuest, planningAcknowledgement } from '../lib/clash-quest'
import { demoDistricts, demoLeaderboard, demoScoreParts, demoScoring, metricDetails, nearbyDemoDistrict, locationOutcomeCopy, type DemoDistrictId, type DemoMetrics, type MetricKey, type LocationOutcome } from '../lib/clash-preview'
import { loadSession } from '../lib/session'
import './PowerClashPage.css'

const categories: MetricKey[] = ['conservation', 'ev', 'offPeak', 'solar']
const sections = [{ id: 'quests', label: 'Quests', icon: Compass }, { id: 'arena', label: 'Arena', icon: Cuboid }, { id: 'league', label: 'League', icon: Trophy }] as const
const icons = { conservation: Leaf, ev: Car, offPeak: Timer, solar: Sun }
const tints = { conservation: '#22a76a', ev: '#4d8fe8', offPeak: '#ee9441', solar: '#b98c20' }
const pillars: { key: MetricKey; x: number; base: number; label: string }[] = [
  { key: 'ev', x: 104, base: 112, label: 'EV' }, { key: 'solar', x: 201, base: 112, label: 'SOL' },
  { key: 'conservation', x: 92, base: 171, label: 'USE' }, { key: 'offPeak', x: 206, base: 171, label: 'OFF' },
]

function metricAmount(key: MetricKey, values: DemoMetrics) {
  switch (key) {
    case 'conservation': return `${values.conservedKwh} kWh · ${values.reductionPercent}% vs baseline`
    case 'ev': return `${values.evAvoidedKg} kg CO₂e avoided · example`
    case 'offPeak': return `$${values.offPeakSavingsNzd} saved · example`
    case 'solar': return `${values.solarAvoidedKg} kg CO₂e avoided · example`
  }
}

function Quests({ onSignIn }: { onSignIn: () => void }) {
  const account = loadSession()?.customerId
  const [data, setData] = useState<ClashProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [revision, setRevision] = useState(0)
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const navigate = useNavigate()
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    setNeedsSignIn(false)
    setData(null)
    if (account) void getClashProgress(account, controller.signal).then((result) => { if (!controller.signal.aborted) setData(result) }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'Progress unavailable. Please retry.')
      setNeedsSignIn(failure instanceof ClashSignInError)
    })
    return () => controller.abort()
  }, [account, revision])
  const mission = data?.missions[index]
  const today = clashDay()
  const planned = Boolean(mission && plannedQuest(data?.events ?? [], mission.id, today))
  const plan = async () => {
    if (!account || !mission || planned || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setNotice('')
    try {
      const result = await planClashQuest(account, mission.id)
      setData(result)
      setNotice(planningAcknowledgement(result.events, mission.id, clashDay()))
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Your plan could not be saved.')
      setNeedsSignIn(failure instanceof ClashSignInError)
    } finally { inFlight.current = false; setSaving(false) }
  }
  return <div className="clash-grid">
    <section className="clash-card clash-journey">
      <div className="clash-eyebrow">YOUR ENERGY JOURNEY</div>
      <div className="clash-xp-row"><strong>{data ? `${data.total_xp} XP` : 'One good move'}</strong><span className="clash-token"><Zap aria-hidden="true" /></span></div>
      <p>{data ? `${data.planning_xp} planning · ${data.verified_xp} device verified` : error ?? 'Checking your progress…'}</p>
      <p className="clash-note">XP has no cash value. A saved plan is not proof of energy or money saved.</p>
      {data && <><div className="clash-verified"><ShieldCheck aria-hidden="true" /><span>Verified shifts<br/><strong>${Number(data.estimated_shift_savings_nzd).toFixed(2)}</strong> estimated tariff saving</span></div>{data.storage === 'memory' && <p className="clash-note">Development progress resets when the server restarts.</p>}</>}
      {error && <button className="clash-button" onClick={needsSignIn ? onSignIn : () => setRevision((v) => v + 1)}>{needsSignIn ? 'Sign in again' : 'Retry progress'}</button>}
      <div className="clash-next-move"><h3><Compass aria-hidden="true" />Make your next move</h3><p>Start with your usage, then ask Sparky for an idea that fits your day. Your comfort and essential needs come first.</p><div className="clash-actions"><Link className="clash-button" to="/usage">View usage</Link><Link className="clash-button clash-button-secondary" to="/assistant">Ask Sparky AI</Link></div></div>
    </section>
    <section className="clash-card clash-quest">
      <div className="clash-card-heading"><h2>Choose your next quest</h2>{data && <span>{index + 1} / {data.missions.length}</span>}</div>
      {mission && data ? <>
        <div className="clash-quest-selector" aria-label="Energy quests">{data.missions.map((item, i) => <button key={item.id} aria-pressed={i === index} onClick={() => { setIndex(i); setNotice('') }} disabled={saving}>{i + 1}<span>{item.title}</span></button>)}</div>
        <div className="clash-mission" key={mission.id}>
          <span className="clash-mission-icon">{mission.id === 'ev_off_peak' ? <Car/> : mission.id === 'review_energy_plan' ? <Trophy/> : <Timer/>}</span>
          <h3>{mission.title}</h3>
          <div className="clash-sparky-tip"><SparkyIcon aria-hidden="true" /><p>Let’s find a move that fits your day. Your comfort, essential needs and EV departure time come first.</p></div>
          <p className="clash-quest-xp">+{mission.planning_xp} planning XP · once per Auckland day</p>
          <div className="clash-actions"><button className="clash-button" onClick={() => navigate(`/assistant?question=${encodeURIComponent(mission.question)}`)}>Plan with Sparky</button><button className="clash-button clash-button-secondary" onClick={() => void plan()} disabled={saving || planned}>{planned ? <Check size={17}/> : null}{saving ? 'Saving…' : planned ? 'In your plan for today' : 'Add to my daily plan'}</button></div>
          <p className="clash-notice" role="status">{notice}</p>
          {needsSignIn && !error && <button className="clash-button" onClick={onSignIn}>Sign in again</button>}
        </div>
      </> : <div className="clash-empty"><Compass size={40}/><p>{error ? 'Your quests will appear once your progress is available.' : 'Loading your energy quests…'}</p></div>}
    </section>
    {Boolean(data?.events.length) && <details className="clash-card clash-history"><summary>Your recent actions <span>{data?.events.length} recorded</span></summary><ul>{data?.events.slice(0, 5).map((event) => <li key={event.key}><strong>+{event.xp} XP · {data.missions.find((m) => m.id === event.mission_id)?.title ?? event.mission_id.replaceAll('_', ' ')}</strong><small>{event.day} · {event.evidence} · {event.source}</small></li>)}</ul></details>}
  </div>
}

function Arena({ metrics, selected, onSelect, motion, reduced, onMotionChange }: { metrics: DemoMetrics; selected: MetricKey; onSelect: (key: MetricKey) => void; motion: boolean; reduced: boolean; onMotionChange: (enabled: boolean) => void }) {
  const parts = demoScoreParts(metrics)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  return <div className="clash-grid">
    <section className="clash-card">
      <div className="clash-card-heading"><h2>The score arena</h2><span className="clash-badge">SAMPLE SCORES</span></div>
      <p>Click a pillar to explore its score{motion ? ' · move your pointer to tilt' : ''}.</p>
      <div className="clash-arena" onPointerMove={(event) => { if (!motion || event.pointerType !== 'mouse') return; const rect = event.currentTarget.getBoundingClientRect(); setTilt({ x: -(event.clientY - rect.top - rect.height / 2) / rect.height * 12, y: (event.clientX - rect.left - rect.width / 2) / rect.width * 18 }) }} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
        <label className="clash-motion-toggle"><input type="checkbox" checked={motion} disabled={reduced} onChange={(event) => onMotionChange(event.target.checked)}/>{reduced ? 'Reduced motion' : 'Game motion'}</label>
        <svg viewBox="0 0 300 245" aria-label="Interactive example energy score arena" style={motion ? { transform: `perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` } : undefined}>
          <polygon className="clash-board-side" points="15,105 150,211 150,230 15,124"/><polygon className="clash-board-side" points="150,211 285,105 285,124 150,230"/>
          <polygon className="clash-board-top" points="150,29 285,105 150,211 15,105"/>
          <polygon className="clash-board-line" points="150,47 265,108 150,194 35,108"/>
          {pillars.map(({ key, x, base, label }) => {
            const active = selected === key
            const bottom = base - (active ? 5 : 0)
            const top = bottom - 27 - 37 * parts[key] / demoScoring[key].weight
            return <g key={key} role="button" tabIndex={0} aria-pressed={active} aria-label={`${metricDetails[key].label}: ${parts[key].toFixed(1)} of ${demoScoring[key].weight} sample points`} onClick={() => onSelect(key)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(key) } }} className="clash-pillar">
              <polygon fill={tints[key]} fillOpacity=".8" points={`${x-23},${top} ${x},${top+11} ${x},${bottom+11} ${x-23},${bottom}`}/>
              <polygon fill={tints[key]} fillOpacity=".55" points={`${x},${top+11} ${x+23},${top} ${x+23},${bottom} ${x},${bottom+11}`}/>
              <polygon fill={tints[key]} stroke={active ? 'var(--ink)' : tints[key]} strokeWidth={active ? 2 : 1} points={`${x},${top-11} ${x+23},${top} ${x},${top+11} ${x-23},${top}`}/>
              <text x={x} y={top+3} textAnchor="middle" fill="#fff" fontSize="8" fontWeight="800">{label}</text>
            </g>
          })}
        </svg>
      </div>
      <div className="clash-readout"><span>{metricDetails[selected].label}</span><strong>{parts[selected].toFixed(1)} / {demoScoring[selected].weight} pts</strong></div>
      <p className="clash-note">Sample weighted points are separate from your quest XP.</p>
    </section>
    <section className="clash-card"><h2>How the score adds up</h2><p>Four example categories. Choose one to see what verified data it would need.</p>
      <div className="clash-metrics">{categories.map((key) => { const Icon = icons[key]; return <button key={key} aria-pressed={key === selected} onClick={() => onSelect(key)} style={{ '--metric-tint': tints[key] } as CSSProperties}><Icon aria-hidden="true"/><span><strong>{metricDetails[key].label}</strong><small>{metricAmount(key, metrics)}</small></span><b>{parts[key].toFixed(1)}<small> /{demoScoring[key].weight}</small></b><span className="clash-track"><i style={{ width: `${parts[key] / demoScoring[key].weight * 100}%` }}/></span></button> })}</div>
      <div className="clash-method"><strong>How {metricDetails[selected].label.toLowerCase()} would work</strong><p>{metricDetails[selected].method}</p></div>
      <p className="clash-note">Sample weights: conservation 35%, EV 20%, off-peak 25%, solar 20%. Real scoring must account fairly for homes without EV or solar.</p>
    </section>
  </div>
}

function League({ districtId, onDistrict }: { districtId: DemoDistrictId; onDistrict: (id: DemoDistrictId) => void }) {
  const [locationBusy, setLocationBusy] = useState(false)
  const [outcome, setOutcome] = useState<LocationOutcome | null>(null)
  const standings = demoLeaderboard(districtId)
  const you = standings.find((item) => item.id === 'you')!
  const district = demoDistricts.find((item) => item.id === districtId)!
  const suggestNearby = () => {
    if (!navigator.geolocation) { setOutcome('unavailable'); return }
    setLocationBusy(true)
    navigator.geolocation.getCurrentPosition((position) => {
      const suggestion = nearbyDemoDistrict(position.coords.latitude, position.coords.longitude)
      if (suggestion) onDistrict(suggestion.id)
      setOutcome(suggestion ? 'nearby' : 'outside')
      setLocationBusy(false)
    }, (error) => { setOutcome(error.code === 1 ? 'denied' : 'unavailable'); setLocationBusy(false) }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
  }
  return <div className="clash-grid">
    <section className="clash-card">
      <div className="clash-eyebrow">MONTHLY SAMPLE LEAGUE</div><h2>{district.name}</h2>
      <div className="clash-league-stats"><div><strong>#{you.rank}</strong><span>of {standings.length} sample players</span></div><div><strong>{you.score.toFixed(1)}</strong><span>sample points / 100</span></div></div>
      <h3>Choose a demo suburb</h3><p>Explore sample standings. This does not enrol your account.</p>
      <div className="clash-districts">{demoDistricts.map((item) => <button key={item.id} aria-pressed={item.id === districtId} onClick={() => onDistrict(item.id)}>{item.name}</button>)}</div>
      <div className="clash-location"><h3><MapPin size={19}/>Find a nearby example</h3><p className="clash-note">Optional, one-time approximate location. Coordinates stay in memory and are never saved or sent.</p><button className="clash-button clash-button-secondary" onClick={suggestNearby} disabled={locationBusy}>{locationBusy ? 'Checking nearby suburbs…' : 'Use location once'}</button><p role="status" className="clash-note">{outcome ? locationOutcomeCopy(outcome) : ''}</p></div>
    </section>
    <section className="clash-card"><div className="clash-card-heading"><h2>Suburb leaderboard</h2><Trophy aria-hidden="true"/></div><p>{district.name} · sample monthly standings</p><ol className="clash-leaderboard">{standings.map((player) => <li key={player.id} className={player.id === 'you' ? 'clash-you' : ''}><span className="clash-rank">{player.rank === 1 ? <Crown size={20}/> : `#${player.rank}`}</span><strong>{player.label}</strong><b>{player.score.toFixed(1)}<small> pts</small></b></li>)}</ol><p className="clash-note">Illustrative players and scores. These are not customer readings or real ranks.</p></section>
    <section className="clash-card clash-reward"><Gift aria-hidden="true"/><div><div className="clash-eyebrow">PLANNED MONTHLY REWARD</div><h3>Bill credit for the top three</h3><p>The highest eligible scores in each suburb would receive a bill credit after the month closes.</p><span className="clash-badge">Preview only · no real rewards active</span></div></section>
    <section className="clash-card clash-boundary"><ShieldCheck aria-hidden="true"/><div><h3>What is needed for real rankings</h3><p>Verified meters, EV charger and solar evidence, actual tariffs, fair scoring, consent, and an approved bill-credit programme. No real score, carbon claim, rank, or credit is calculated here.</p></div></section>
  </div>
}

export default function PowerClashPage({ onSignIn }: { onSignIn: () => void }) {
  const [view, setView] = useState<'quests' | 'arena' | 'league'>('quests')
  const [district, setDistrict] = useState<DemoDistrictId>('grey-lynn')
  const [metric, setMetric] = useState<MetricKey>('conservation')
  const [motion, setMotion] = useState(() => localStorage.getItem('kea.clash.motion.v1') !== 'off')
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true')
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(preference.matches || document.documentElement.dataset.reducedMotion === 'true')
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] })
    preference.addEventListener('change', update)
    return () => { preference.removeEventListener('change', update); observer.disconnect() }
  }, [])
  const you = demoLeaderboard(district).find((player) => player.id === 'you')!
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = sections.findIndex((section) => section.id === view)
    const next = event.key === 'ArrowRight' ? (current + 1) % sections.length : event.key === 'ArrowLeft' ? (current + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const section = sections[next]
    if (!section) return
    const id = section.id
    setView(id)
    document.getElementById(`clash-tab-${id}`)?.focus()
  }
  return <div className={`power-clash-page${motion && !reduced ? ' clash-motion' : ''}`}>
    <div className="page-heading"><h1>Power Clash</h1><p>Small energy moves. Sparky quests. A sample suburb league.</p></div>
    {/* One card holds the tabs and whichever section is open, as one card holds each other
        page's content, so its top edge falls at the same height over the background. */}
    <div className="card clash-shell">
    <div className="clash-toolbar"><div className="clash-tabs" role="tablist" aria-label="Power Clash sections">{sections.map((tab) => <button key={tab.id} id={`clash-tab-${tab.id}`} role="tab" tabIndex={view === tab.id ? 0 : -1} aria-selected={view === tab.id} aria-controls={`clash-panel-${tab.id}`} onKeyDown={moveTab} onClick={() => setView(tab.id)}><tab.icon size={19}/>{tab.label}</button>)}</div></div>
    <div role="tabpanel" id={`clash-panel-${view}`} aria-labelledby={`clash-tab-${view}`} className="clash-panel" key={view}>
      {view === 'quests' ? <Quests onSignIn={onSignIn}/> : view === 'arena' ? <Arena metrics={you.metrics} selected={metric} onSelect={setMetric} motion={motion && !reduced} reduced={reduced} onMotionChange={(enabled) => { setMotion(enabled); localStorage.setItem('kea.clash.motion.v1', enabled ? 'on' : 'off') }}/> : <League districtId={district} onDistrict={setDistrict}/>}
    </div>
    </div>
  </div>
}
