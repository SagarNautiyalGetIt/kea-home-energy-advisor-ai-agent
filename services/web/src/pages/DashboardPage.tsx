import { CircleAlert, DollarSign, ShieldCheck, Zap } from 'lucide-react'
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
import type { PageId } from '../types/navigation'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = ['12am', '4am', '8am', '12pm', '4pm', '8pm', '11pm']
const hourlyUsage = [1.1, 0.7, 1.4, 2.6, 3.9, 5.2, 3.7]
const articles = [
  { title: 'Electricity Repair', date: '16th Aug, 2026', style: 'article-sky', author: 'Chole Bennett', body: 'Planned electrical maintenance helps keep local equipment reliable. Check your network provider for confirmed outage and restoration information.' },
  { title: 'Electricity Cut Off', date: '10th Aug, 2026', style: 'article-orange', author: 'Chole Bennett', body: 'If your power is unexpectedly off, check whether neighbours are affected and consult your local network outage page before reporting a fault.' },
  { title: 'Electricity Plan Discounts', date: '8th Aug, 2026', style: 'article-purple', author: 'Chole Bennett', body: 'Time-of-use plans can reward households that shift flexible electricity use away from peak periods. Review eligibility and full plan terms before switching.' },
  { title: 'New Regulation', date: '1st Aug, 2026', style: 'article-violet', author: 'Ethan Parker', body: 'Clear bills and transparent usage information help customers compare plans and understand how their final charges are calculated.' },
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
  return { household: q.get('household'), day: Number.isFinite(day) && day > 0 ? day : undefined }
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
    <div className="page-heading"><h1>Dashboard</h1><p className="welcome-customer">Welcome, {profile.name}</p></div>
    <div className="metric-row">
      {/* Every figure here comes from /api/households and /bill-shock. They used to be
          literals, which put an invented "Projected Monthly Bill" on the same screen as
          a computed one — two numbers disagreeing in front of a judge. */}
      <article><i><DollarSign/></i><span>Latest day&rsquo;s cost<strong>{latest !== undefined ? money(latest * 0.30) : '—'}</strong></span></article>
      <article><i><Zap/></i><span>Usage so far<strong>{usageSoFar !== undefined ? `${usageSoFar.toFixed(1)} kWh` : '—'}</strong></span></article>
      <article><i><DollarSign/></i><span>Cost so far<strong>{shock ? money(shock.cost_so_far_nzd) : '—'}</strong></span></article>
      <article><i><DollarSign/></i><span>Projected this cycle<strong>{shock ? money(shock.projected_cycle_cost_nzd) : '—'}</strong></span></article>
    </div>
    <div className="dashboard-grid">
      <article className="card usage-summary"><header><div><span>Typical day, by hour</span><h2>{latest !== undefined ? `${latest.toFixed(1)} kWh` : '—'}</h2></div><em>latest day<small>illustrative shape</small></em></header><div className="bar-chart">{hourlyUsage.map((value,index)=><span key={hours[index]} style={{height:`${value*18}px`}} tabIndex={0} data-value={`${value.toFixed(1)} kWh`}><small>{hours[index]}</small></span>)}</div></article>
      <article className="card weekly-summary"><header><div><span>Last 7 days</span><h2>{recent.length ? `${recent.reduce((a,b)=>a+b,0).toFixed(1)} kWh` : '—'}</h2></div><em>{household?.period ?? ''}<small>from your meter</small></em></header><AreaChart compact values={recent.length?recent:[0]} labels={days.slice(0,recent.length||1)} max={Math.max(6,...recent)}/></article>
      {/* Only rendered when the assessment actually triggered. The previous version was
          always on and claimed "29% higher than your usual range" — a fabricated figure,
          and a claim we cannot make at all: there is no billing history behind this, so
          "your usual" is unknowable. The comparison is against similar homes and the
          wording now says so. */}
      {offline ? (
        <article className="card shock-card shock-offline"><h3><CircleAlert/>Usage data unavailable</h3><p>Kea can&rsquo;t reach your meter data right now, so there is no projection to show. Nothing here is estimated in the meantime.</p></article>
      ) : shock?.triggered ? (
        <article className="card shock-card"><h3><CircleAlert/>Bill shock warning</h3>
          <p>You are <strong>{shock.days_elapsed} of {shock.days_in_cycle} days</strong> into this cycle and on track for <strong>{money(shock.projected_cycle_cost_nzd)}</strong>. A comparable home would run to about {money(shock.comparable_home_cost_nzd)} — that is <strong>{money(shock.overshoot_nzd)}</strong> more, or {shock.overshoot_pct.toFixed(0)}%.</p>
          {shock.reasons.includes('rising_within_cycle') && (
            <p>Daily use is up {shock.recent_trend_pct.toFixed(0)}% since the start of the cycle.</p>
          )}
          <p><strong>{shock.days_remaining} days left</strong> in this cycle — enough to change the outcome.</p>
          <div><button onClick={()=>onNavigate('usage')}>View Usage</button><button onClick={()=>onNavigate('assistant')}>Ask AI Assistant</button></div>
          <small className="shock-basis">Compared with similar homes, not with your own past bills — Kea does not hold your billing history. Estimated at an illustrative 30c/kWh.</small>
        </article>
      ) : shock ? (
        <article className="card shock-card shock-ok"><h3><ShieldCheck/>No bill shock expected</h3>
          <p>You are {shock.days_elapsed} of {shock.days_in_cycle} days in and on track for <strong>{money(shock.projected_cycle_cost_nzd)}</strong>, which is in line with comparable homes at about {money(shock.comparable_home_cost_nzd)}.</p>
          <div><button onClick={()=>onNavigate('assistant')}>Ask AI Assistant</button></div>
          <small className="shock-basis">Compared with similar homes. Estimated at an illustrative 30c/kWh.</small>
        </article>
      ) : (
        <article className="card shock-card shock-ok"><h3>Checking your usage…</h3><p>Kea is looking at this cycle so far.</p></article>
      )}
    </div>
    <div className="article-grid">{articles.map((article)=><article className="article-card" key={article.title}><div className={`article-art ${article.style}`}><span/></div><h3>{article.title}</h3><p>By {article.author}</p><footer><small>Posted: {article.date}</small><button onClick={()=>{setSelectedArticle(article);onToast(`${article.title} opened`)}}>View</button></footer></article>)}</div>
    {selectedArticle&&<Modal title={selectedArticle.title} onClose={()=>setSelectedArticle(null)}><div className={`article-modal-art ${selectedArticle.style}`}/><p className="modal-meta">By {selectedArticle.author} · {selectedArticle.date}</p><p>{selectedArticle.body}</p></Modal>}
  </>
}
