import { CircleAlert, DollarSign, ShieldCheck, Triangle, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import AreaChart from '../components/AreaChart'
import Modal from '../components/Modal'
import { profile } from '../data/mockData'
import {
  getBillShock,
  getHouseholds,
  type BillShockWarning,
  type HouseholdSummary,
} from '../lib/client'
import { loadSession } from '../lib/session'
import type { PageId } from '../types/navigation'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// #69's `weekDates` / `weekTooltipLabels` are gone with the chart that used them: they
// hardcoded 17–23 Aug 2026, and the weekly card now plots the last seven days of whatever
// cycle the API returned. Fixed date labels over live data is a mislabelled chart.
const formatHour = (hour: number, compact = false) => {
  const period = hour < 12 ? 'am' : 'pm'
  const displayHour = hour % 12 || 12
  return `${displayHour}${compact ? period[0] : period}`
}
const hours = Array.from({ length: 24 }, (_, hour) => formatHour(hour))
const hourlyUsage = [0.32, 0.27, 0.21, 0.19, 0.18, 0.21, 0.32, 0.48, 0.58, 0.64, 0.69, 0.74, 0.8, 0.85, 0.9, 0.96, 1.06, 1.17, 1.33, 1.49, 1.59, 1.43, 1.17, 1.02]
const articles = [
  {
    title: 'New Consumer Protection Standards',
    date: '24 Aug 2026',
    image: '/assets/news/consumer-protection-policy.jpg',
    imageAlt: 'Policy document and shield representing new consumer protections',
    body: 'New consumer care standards are being introduced to make electricity information clearer and support easier to access. Kea Energy is updating customer communications and support processes to reflect the new requirements.',
  },
  {
    title: 'Off-Peak Discount Coming Soon',
    date: '21 Aug 2026',
    image: '/assets/news/off-peak-discount.jpg',
    imageAlt: 'Clock and electricity symbols representing an off-peak discount',
    body: 'Kea Energy is preparing a new off-peak discount for eligible customers who can shift flexible electricity use away from busy periods. Full eligibility, timing and plan terms will be shared before launch.',
  },
  {
    title: 'Winter Energy Support Available',
    date: '18 Aug 2026',
    image: '/assets/news/winter-energy-support.jpg',
    imageAlt: 'Warm energy-efficient home representing winter support',
    body: 'Our winter support programme offers practical energy-saving guidance and account assistance to customers who need extra help during colder months. Contact Consumer Care to learn about available support.',
  },
  {
    title: 'Planned Network Maintenance',
    date: '15 Aug 2026',
    image: '/assets/news/network-maintenance.jpg',
    imageAlt: 'Power lines and maintenance equipment representing planned network work',
    body: 'Planned network maintenance will take place in selected areas this weekend. Customers affected by an interruption will receive advance notice with timing and restoration information.',
  },
]

/**
 * Reads the demo household and the point in the cycle off the query string, so the
 * operator can show a live warning without editing code:
 *
 *     /dashboard?household=H-COLD&day=6
 *
 * Day 6 on H-COLD is the one worth showing — the cold snap has started, both signals
 * fire, and there are still 25 days left to act on it.
 */
function demoParams(): { household: string | null; day: number | undefined } {
  const q = new URLSearchParams(window.location.search)
  const day = Number(q.get('day'))
  // ?household= still wins, so the operator can jump to any scenario mid-demo without
  // signing out. With no override it falls back to whoever is signed in.
  const wanted = q.get('household') ?? loadSession()?.customerId ?? null
  return { household: wanted, day: Number.isFinite(day) && day > 0 ? day : undefined }
}

export default function DashboardPage({ onNavigate, onToast }: { onNavigate: (page: PageId) => void; onToast: (message: string) => void }) {
  const [selectedArticle, setSelectedArticle] = useState<(typeof articles)[number] | null>(null)
  const [household, setHousehold] = useState<HouseholdSummary | null>(null)
  const [shock, setShock] = useState<BillShockWarning | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let cancelled = false
    const { household: wanted, day } = demoParams()
    getHouseholds()
      .then(async (hs) => {
        const chosen = hs.find((h) => h.customer_id === wanted) ?? hs[0]
        if (!chosen) throw new Error('no households')
        const warning = await getBillShock(chosen.customer_id, day)
        if (cancelled) return
        setHousehold(chosen)
        setShock(warning)
      })
      .catch(() => { if (!cancelled) setOffline(true) })
    return () => { cancelled = true }
  }, [])

  // Truncated to the same point in the cycle the warning was assessed at. Without this
  // the row mixes a full-month usage total with a six-day cost — two figures on one
  // screen that cannot both be true, which is the failure this whole page is about.
  const daily = (household?.daily_kwh ?? []).slice(0, shock?.days_elapsed ?? undefined)
  const recent = daily.slice(-7)
  const latest = daily.length ? daily[daily.length - 1] : undefined
  const usageSoFar = shock?.usage_so_far_kwh ?? (daily.length ? daily.reduce((a, b) => a + b, 0) : undefined)
  const money = (n: number) => `${n.toFixed(2)} NZD`

  return <>
    <div className="page-heading"><h1>Dashboard</h1><p className="welcome-customer">Welcome, {loadSession()?.displayName ?? profile.name}</p></div>
    <div className="metric-row">
      {/* Every figure here comes from /api/households and /bill-shock. They used to be
          literals, which put an invented "Projected Monthly Bill" on the same screen as
          a computed one — two numbers disagreeing in front of a judge. #69's refined
          visuals are kept; its hardcoded figures are not. */}
      <article><i><DollarSign/></i><span>Latest day&rsquo;s cost<strong>{latest !== undefined ? money(latest * 0.30) : '—'}</strong></span></article>
      <article><i><Zap/></i><span>Usage so far<strong>{usageSoFar !== undefined ? `${usageSoFar.toFixed(1)} kWh` : '—'}</strong></span></article>
      <article><i><DollarSign/></i><span>Cost so far<strong>{shock ? money(shock.cost_so_far_nzd) : '—'}</strong></span></article>
      <article><i><DollarSign/></i><span>Projected this cycle<strong>{shock ? money(shock.projected_cycle_cost_nzd) : '—'}</strong></span></article>
    </div>
    <div className="dashboard-grid">
      <article className="card usage-summary">
        <header>
          <div><span>Typical day, by hour</span><h2>{latest !== undefined ? `${latest.toFixed(1)} kWh` : '—'}</h2></div>
          <em>latest day<small>illustrative shape</small></em>
        </header>
        <AreaChart compact animate values={hourlyUsage} labels={hours} max={2} xLabelInterval={3} showLegend={false} ariaLabel="An illustrative daily usage shape in one-hour intervals, measured in kilowatt-hours"/>
      </article>
      <article className="card weekly-summary">
        <header>
          <div><span>Last 7 days</span><h2>{recent.length ? `${recent.reduce((a,b)=>a+b,0).toFixed(1)} kWh` : '—'}</h2></div>
          {/* The only trend figure on this page that is computed rather than asserted —
              `recent_trend_pct` is layer 1's, off the same assessment as the warning. */}
          <em>{shock ? <span className={shock.recent_trend_pct >= 0 ? 'trend-up' : 'trend-down'}><Triangle aria-hidden="true"/>{shock.recent_trend_pct >= 0 ? '+' : ''}{shock.recent_trend_pct.toFixed(2)}%</span> : <span>{household?.period ?? ''}</span>}<small>{shock ? 'vs start of cycle' : 'from your meter'}</small></em>
        </header>
        <AreaChart compact animate values={recent.length?recent:[0]} labels={days.slice(0,recent.length||1)} max={Math.max(6,...recent)} showLegend={false} ariaLabel="Daily electricity usage over the last seven days of the cycle, measured in kilowatt-hours"/>
      </article>
      {/* Only rendered when the assessment actually triggered. The previous version was
          always on and claimed "29% higher than your usual range" — a fabricated figure,
          and a claim we cannot make at all: there is no billing history behind this, so
          "your usual" is unknowable. The comparison is against similar homes and the
          wording now says so. #69's status dot is driven by that assessment rather than
          being hardcoded to `alert`, which is what its own comment asked for. */}
      {offline ? (
        <article className="card shock-card shock-offline"><h3><CircleAlert/>Usage data unavailable</h3><p>Kea can&rsquo;t reach your meter data right now, so there is no projection to show. Nothing here is estimated in the meantime.</p></article>
      ) : shock?.triggered ? (
        <article className="card shock-card"><h3><span className="bill-status-dot bill-status-dot-alert" aria-hidden="true"/>Power Bill Shock Warning</h3>
          <p>You are <strong>{shock.days_elapsed} of {shock.days_in_cycle} days</strong> into this cycle and on track for <strong>{money(shock.projected_cycle_cost_nzd)}</strong>. A comparable home would run to about {money(shock.comparable_home_cost_nzd)} — that is <strong>{money(shock.overshoot_nzd)}</strong> more, or {shock.overshoot_pct.toFixed(0)}%.</p>
          {shock.reasons.includes('rising_within_cycle') && (
            <p>Daily use is up {shock.recent_trend_pct.toFixed(0)}% since the start of the cycle.</p>
          )}
          {/* At day 31 of 31 there is nothing left to prevent, and the old copy said
              "0 days left in this cycle — enough to change the outcome", which is both
              self-contradicting and the exact thing the endpoint warns about: a warning
              delivered on the last day is not a warning, it is a bill. The dashboard
              lands here by default because no ?day= is set, so this is the sentence a
              judge reads first. */}
          {shock.days_remaining > 0 ? (
            <p><strong>{shock.days_remaining} days left</strong> in this cycle — enough to change the outcome.</p>
          ) : (
            <p>This cycle has closed, so this is what the bill will reflect. The figures below are what drove it.</p>
          )}
          <div><button onClick={()=>onNavigate('usage')}>View Usage</button><button onClick={()=>onNavigate('assistant')}>Ask AI Assistant</button></div>
          <small className="shock-basis">Compared with similar homes, not with your own past bills — Kea does not hold your billing history. Estimated at an illustrative 30c/kWh.</small>
        </article>
      ) : shock ? (
        <article className="card shock-card shock-ok"><h3><span className="bill-status-dot bill-status-dot-normal" aria-hidden="true"/><ShieldCheck/>No bill shock expected</h3>
          <p>You are {shock.days_elapsed} of {shock.days_in_cycle} days in and on track for <strong>{money(shock.projected_cycle_cost_nzd)}</strong>, which is in line with comparable homes at about {money(shock.comparable_home_cost_nzd)}.</p>
          <div><button onClick={()=>onNavigate('assistant')}>Ask AI Assistant</button></div>
          <small className="shock-basis">Compared with similar homes. Estimated at an illustrative 30c/kWh.</small>
        </article>
      ) : (
        <article className="card shock-card shock-ok"><h3>Checking your usage…</h3><p>Sparky is looking at this cycle so far.</p></article>
      )}
    </div>
    <section className="article-grid" aria-label="Kea Energy news">{articles.map((article)=><article className="article-card" key={article.title}><div className="article-art"><img src={article.image} alt={article.imageAlt} loading="lazy" decoding="async"/></div><h3>{article.title}</h3><footer><small>{article.date}</small><button onClick={()=>{setSelectedArticle(article);onToast(`${article.title} opened`)}}>View</button></footer></article>)}</section>
    {selectedArticle&&<Modal title={selectedArticle.title} onClose={()=>setSelectedArticle(null)}><img className="article-modal-art" src={selectedArticle.image} alt={selectedArticle.imageAlt}/><p className="modal-meta">{selectedArticle.date}</p><p>{selectedArticle.body}</p></Modal>}
  </>
}
