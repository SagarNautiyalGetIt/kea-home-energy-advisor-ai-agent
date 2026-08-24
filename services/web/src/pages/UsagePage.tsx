import { Activity, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import FeedbackState from '../components/FeedbackState'
import TimeRangeSelector, { type TimeRange } from '../components/TimeRangeSelector'
import ToggleButtons from '../components/ToggleButtons'
import UsageGraph, { type UsageUnit } from '../components/UsageGraph'
import UsageSummaryCard from '../components/UsageSummaryCard'
import { dailyUsage, hourlyUsage, monthlyUsage } from '../data/mockData'

type RangeData = {
  values: number[]
  labels: string[]
  total: number
  high: string
  low: string
  max: number
  trend: string
}

const ranges: Record<TimeRange, RangeData> = {
  Daily: { values: hourlyUsage, labels: ['12 AM','3 AM','6 AM','9 AM','12 PM','3 PM','6 PM','9 PM'], total: 4.2, high: '7:00 PM – 9:00 PM', low: '2:00 AM – 5:00 AM', max: 1.2, trend: '+2.45%' },
  Weekly: { values: dailyUsage, labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], total: 28.6, high: 'Friday', low: 'Sunday', max: 6, trend: '+4.45%' },
  Monthly: { values: monthlyUsage, labels: ['Week 1','Week 2','Week 3','Week 4'], total: 118.4, high: 'Mid-month', low: 'First week', max: 35, trend: '+8.20%' },
}

const tariff = 0.3

export default function UsagePage() {
  const [range, setRange] = useState<TimeRange>('Daily')
  const [unit, setUnit] = useState<UsageUnit>('kWh')
  const [compare, setCompare] = useState(false)
  const [date, setDate] = useState('2026-08-20')
  const [status, setStatus] = useState<'ready' | 'loading' | 'empty' | 'error'>('ready')
  const data = ranges[range]
  const multiplier = unit === '$' ? tariff : 1
  const graphValues = useMemo(() => data.values.map((value) => value * multiplier), [data.values, multiplier])
  const comparisonValues = useMemo(() => data.values.map((value,index) => Math.max(0,value*(index%2?0.88:0.94))*multiplier), [data.values,multiplier])
  const total = data.total * multiplier
  const periodTitle = range === 'Daily' ? "Today's total" : range === 'Weekly' ? "This week's total" : "This month's total"
  const formattedTotal = unit === '$' ? `$${total.toFixed(2)}` : `${total.toFixed(1)} kWh`
  const refresh = (nextRange: TimeRange = range) => { setRange(nextRange); setStatus('loading'); window.setTimeout(()=>setStatus(data.values.length?'ready':'empty'),450) }

  return (
    <>
      <div className="page-heading usage-page-heading"><h1>Usage</h1><p>Monitor your energy patterns and estimated costs.</p></div>
      <section className="usage-card card" aria-label="Electricity usage insights">
        <header className="usage-toolbar">
          <TimeRangeSelector value={range} onChange={refresh} />
          <div className="usage-toolbar-actions"><button className="refresh-usage" aria-label="Refresh usage" onClick={()=>refresh()}><RefreshCw/></button><label className="date-selector"><span>Date</span><input type="date" value={date} onChange={(event)=>{setDate(event.target.value);refresh()}}/></label><label className="compare-selector"><input type="checkbox" checked={compare} onChange={(event)=>setCompare(event.target.checked)}/><span>Compare previous</span></label><ToggleButtons
            className="unit-selector"
            ariaLabel="Graph metric"
            options={[{ value: 'kWh', label: 'kWh' }, { value: '$', label: '$' }]}
            value={unit}
            onChange={setUnit}
          /></div>
        </header>

        {status==='loading'?<FeedbackState state="loading" title="Refreshing usage" message="Preparing the selected period…"/>:status==='error'?<FeedbackState state="error" message="Usage could not be displayed." onRetry={()=>refresh()}/>:status==='empty'?<FeedbackState state="empty" message="No readings are available for this period."/>:<><UsageGraph
          values={graphValues}
          labels={data.labels}
          max={data.max * multiplier}
          unit={unit}
          ariaLabel={`${range} electricity usage in ${unit}`}
          comparisonValues={compare ? comparisonValues : undefined}
        />

        <div className="usage-summary-grid">
          <UsageSummaryCard title={periodTitle} value={formattedTotal} detail="Current selected period" trend={data.trend} icon={<Activity />} />
          <UsageSummaryCard title="Highest usage" value={data.high} detail="Peak consumption window" icon={<TrendingUp />} tone="coral" />
          <UsageSummaryCard title="Lowest usage" value={data.low} detail="Lowest consumption window" icon={<TrendingDown />} tone="teal" />
        </div></>}
      </section>
    </>
  )
}
