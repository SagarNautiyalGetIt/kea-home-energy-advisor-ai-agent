import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'
import EnergyBreakdownCard from '../components/EnergyBreakdownCard'
import FeedbackState from '../components/FeedbackState'
import TimeRangeSelector, { type TimeRange } from '../components/TimeRangeSelector'
import ToggleButtons from '../components/ToggleButtons'
import UsageGraph, { type UsageUnit } from '../components/UsageGraph'
import UsageSummaryCard from '../components/UsageSummaryCard'
import { accountRequest, type Usage, type Hours } from '../lib/account-client'
import { getHousehold } from '../lib/client'
import { loadSession } from '../lib/session'

export default function UsagePage() {
  const [session] = useState(loadSession)
  const [range, setRange] = useState<TimeRange>('Daily')
  const [unit, setUnit] = useState<UsageUnit>('$')
  const [date, setDate] = useState('')
  const [data, setData] = useState<{ values: number[]; labels: string[]; rate: number; total: number; source: string } | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    if (!session) return
    void getHousehold(session.customerId).then(household => {
      if (active) setDate(household.daily_dates?.at(-1) ?? '')
    }).catch((failure: Error) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [session])
  useEffect(() => {
    if (!date) return
    const controller = new AbortController()
    setData(null); setError('')
    const first = new Date(`${date}T12:00:00Z`)
    first.setUTCDate(first.getUTCDate() - (range === 'Weekly' ? 6 : range === 'Monthly' ? 29 : 0))
    void accountRequest<Usage>(`usage-series?start=${first.toISOString().slice(0,10)}&end=${date}`, controller.signal).then(async series => {
      if (!series.daily_dates.length && series.available_to && series.available_to !== date) {
        if (!controller.signal.aborted) setDate(series.available_to)
        return
      }
      let values = series.daily_kwh
      let labels = series.daily_dates.map(day => day.slice(5))
      let source = series.date_source === 'demo' ? 'Illustrative fixture readings' : series.daily_quality.includes('estimated') ? 'Includes estimated readings' : 'Account meter readings'
      if (range === 'Daily') {
        const hours = await accountRequest<Hours>(`hourly-usage?day=${date}`, controller.signal)
        if (hours.hours.some(hour => hour.kwh == null) || !hours.hours.length) throw new Error(hours.note || 'Hourly readings are incomplete for this date.')
        values = hours.hours.map(hour => hour.kwh!)
        labels = hours.hours.map(hour => hour.label)
        source = hours.note
      } else if (series.daily_dates.length !== (range === 'Weekly' ? 7 : 30)) {
        throw new Error('This period has missing readings. Choose a shorter range or another date.')
      }
      if (!controller.signal.aborted) setData({ values, labels, rate: series.total_kwh > 0 ? series.estimated_cost_nzd / series.total_kwh : 0,
        total: values.reduce((total, value) => total + value, 0), source })
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [date, range, reload])
  const values = data?.values.map(value => value * (unit === '$' ? data.rate : 1)) ?? []
  return <>
    <div className="page-heading usage-page-heading"><h1>Usage</h1><p>Explore your dated electricity readings.</p></div>
    <section className="usage-card card"><header className="usage-toolbar"><label>Date <input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><ToggleButtons ariaLabel="Graph metric" options={[{value:'$',label:'$'},{value:'kWh',label:'kWh'}]} value={unit} onChange={setUnit}/><TimeRangeSelector value={range} onChange={setRange}/></header>
      {error ? <FeedbackState state="error" message={error} onRetry={() => setReload(value => value + 1)}/> : !data ? <FeedbackState state="loading" title="Loading usage" message="Reading the selected period…"/> : <><UsageGraph key={`${range}-${unit}-${date}`} animate values={values} labels={data.labels} max={Math.max(1,...values)*1.15} unit={unit} ariaLabel={`${range} electricity usage`} showLegend={false}/><div className="usage-summary-grid"><UsageSummaryCard title="Selected period" value={unit === '$' ? `$${(data.total*data.rate).toFixed(2)}` : `${data.total.toFixed(1)} kWh`} detail={unit === '$' ? 'Estimated energy cost; excludes daily charges' : 'Total electricity imported'} icon={<Activity/>}/></div><p>{data.source}</p></>}
    </section>
    {session && <EnergyBreakdownCard customerId={session.customerId}/>}
  </>
}
