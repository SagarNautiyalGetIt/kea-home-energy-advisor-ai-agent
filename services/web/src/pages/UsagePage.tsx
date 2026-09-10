import { Activity, Flame, Moon, RefreshCw, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import EnergyBreakdownCard from '../components/EnergyBreakdownCard'
import FeedbackState from '../components/FeedbackState'
import TimeRangeSelector, { type TimeRange } from '../components/TimeRangeSelector'
import ToggleButtons from '../components/ToggleButtons'
import UsageGraph, { type UsageUnit } from '../components/UsageGraph'
import UsageSummaryCard from '../components/UsageSummaryCard'
import { dailyUsage, hourlyUsage, monthlyUsage } from '../data/mockData'
import { loadSession } from '../lib/session'

type BandKey = 'peak' | 'offPeak' | 'night'

type RangeData = {
  values: number[]
  /* Monthly labels depend on the selected date, so that range resolves them at render time. */
  labels?: string[]
  total: number
  bands: Record<BandKey, number>
  max: number
  trend: string
}

const hourlyLabels = Array.from({ length: 24 }, (_, hour) => {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
})

const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1)
}
const addDays = (date: Date, days: number) => {
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() + days)
  return shifted
}
const shortDate = (date: Date) => `${date.getDate()} ${monthLabels[date.getMonth()]}`

/* The four Monday–Sunday weeks ending with the week that contains the selected date. */
const monthlyWeeks = (selected: string) => {
  const selectedDate = parseDate(selected)
  const weekStart = addDays(selectedDate, -((selectedDate.getDay() + 6) % 7))
  return Array.from({ length: 4 }, (_, index) => {
    const start = addDays(weekStart, (index - 3) * 7)
    return { start, end: addDays(start, 6) }
  })
}
const weekAxisLabel = ({ start, end }: { start: Date; end: Date }) => `${shortDate(start)} – ${shortDate(end)}`
const weekTooltipLabel = ({ start, end }: { start: Date; end: Date }) =>
  `${shortDate(start)} ${start.getFullYear()} – ${shortDate(end)} ${end.getFullYear()}`

/* New Zealand time-of-use bands: peak 7–11 AM and 5–9 PM, off-peak (shoulder)
   11 AM–5 PM and 9–11 PM, and night 11 PM–7 AM. */
const bandHours: Record<BandKey, number[]> = {
  peak: [7, 8, 9, 10, 17, 18, 19, 20],
  offPeak: [11, 12, 13, 14, 15, 16, 21, 22],
  night: [23, 0, 1, 2, 3, 4, 5, 6],
}

const bandMeta: { key: BandKey; title: string; window: string; tone: 'coral' | 'amber' | 'indigo'; icon: ReactNode }[] = [
  { key: 'peak', title: 'Peak usage', window: '7–11 AM · 5–9 PM', tone: 'coral', icon: <Flame /> },
  { key: 'offPeak', title: 'Off-peak usage', window: '11 AM–5 PM · 9–11 PM', tone: 'amber', icon: <Sun /> },
  { key: 'night', title: 'Night usage', window: '11 PM–7 AM', tone: 'indigo', icon: <Moon /> },
]

const sumHours = (hours: number[]) => hours.reduce((total, hour) => total + (hourlyUsage[hour] ?? 0), 0)

const dailyBands: Record<BandKey, number> = {
  peak: sumHours(bandHours.peak),
  offPeak: sumHours(bandHours.offPeak),
  night: sumHours(bandHours.night),
}
const dailyBandTotal = dailyBands.peak + dailyBands.offPeak + dailyBands.night

/* Weekly and monthly mock readings are not broken down by hour, so the daily
   band split stands in until the API returns real band totals. */
const splitByBand = (total: number): Record<BandKey, number> => ({
  peak: (total * dailyBands.peak) / dailyBandTotal,
  offPeak: (total * dailyBands.offPeak) / dailyBandTotal,
  night: (total * dailyBands.night) / dailyBandTotal,
})

const ranges: Record<TimeRange, RangeData> = {
  Daily: { values: hourlyUsage, labels: hourlyLabels, total: 4.2, bands: dailyBands, max: 0.5, trend: '+2.45%' },
  Weekly: { values: dailyUsage, labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], total: 28.6, bands: splitByBand(28.6), max: 6, trend: '+4.45%' },
  Monthly: { values: monthlyUsage, total: 118.4, bands: splitByBand(118.4), max: 35, trend: '+8.20%' },
}

const tariff = 0.3

export default function UsagePage() {
  // Read once rather than per render: `customerId` is the only field used here and it
  // cannot change without a re-login, which remounts the whole tree.
  const [session] = useState(loadSession)
  const [range, setRange] = useState<TimeRange>('Daily')
  // Dollars, not kWh. Almost nobody opens an energy app worried about kilowatt-hours —
  // they open it worried about the bill, and a first screen denominated in units they
  // do not price forces them to do the conversion before the page means anything. The
  // mobile app already defaulted to cost; the web did not, so the same customer got a
  // different first impression depending on which one they opened.
  const [unit, setUnit] = useState<UsageUnit>('$')
  const [compare, setCompare] = useState(false)
  const [date, setDate] = useState('2026-08-20')
  const [status, setStatus] = useState<'ready' | 'loading' | 'empty' | 'error'>('ready')
  const data = ranges[range]
  const multiplier = unit === '$' ? tariff : 1
  const graphValues = useMemo(() => data.values.map((value) => value * multiplier), [data.values, multiplier])
  const comparisonValues = useMemo(() => data.values.map((value,index) => Math.max(0,value*(index%2?0.88:0.94))*multiplier), [data.values,multiplier])
  const weeks = useMemo(() => monthlyWeeks(date), [date])
  const isMonthly = range === 'Monthly'
  const labels = isMonthly ? weeks.map(weekAxisLabel) : data.labels ?? []
  const tooltipLabels = isMonthly ? weeks.map(weekTooltipLabel) : undefined
  const periodTitle = range === 'Daily' ? "Today's total" : range === 'Weekly' ? "This week's total" : "This month's total"
  const formatAmount = (kwh: number) => (unit === '$' ? `$${(kwh * tariff).toFixed(2)}` : `${kwh.toFixed(1)} kWh`)
  const formattedTotal = formatAmount(data.total)
  const refresh = (nextRange: TimeRange = range) => { setRange(nextRange); setStatus('loading'); window.setTimeout(()=>setStatus(data.values.length?'ready':'empty'),450) }

  return (
    <>
      <div className="page-heading usage-page-heading"><h1>Usage</h1><p>Track your electricity usage patterns over time.</p></div>
      <section className="usage-card card" aria-label="Electricity usage insights">
        <header className="usage-toolbar">
          <TimeRangeSelector value={range} onChange={refresh} />
          <div className="usage-toolbar-actions"><button className="refresh-usage" aria-label="Refresh usage" onClick={()=>refresh()}><RefreshCw/></button><label className="date-selector"><span>Date</span><input type="date" value={date} onChange={(event)=>{setDate(event.target.value);refresh()}}/></label><label className="compare-selector"><input type="checkbox" checked={compare} onChange={(event)=>setCompare(event.target.checked)}/><span>Compare previous</span></label><ToggleButtons
            className="unit-selector"
            ariaLabel="Graph metric"
            /* Dollars first, so the selected option is the one on the left. A toggle
               that opens with its second segment lit reads as though something was
               changed for you. */
            options={[{ value: '$', label: '$' }, { value: 'kWh', label: 'kWh' }]}
            value={unit}
            onChange={setUnit}
          /></div>
        </header>

        {status==='loading'?<FeedbackState state="loading" title="Refreshing usage" message="Preparing the selected period…"/>:status==='error'?<FeedbackState state="error" message="Usage could not be displayed." onRetry={()=>refresh()}/>:status==='empty'?<FeedbackState state="empty" message="No readings are available for this period."/>:<><UsageGraph
          /* Remounting on any change to the selection replays the draw-in animation. */
          key={`${range}-${unit}-${date}-${compare}`}
          animate
          values={graphValues}
          labels={labels}
          tooltipLabels={tooltipLabels}
          max={data.max * multiplier}
          unit={unit}
          ariaLabel={`${range} electricity usage in ${unit}`}
          comparisonValues={compare ? comparisonValues : undefined}
        />

        <div className="usage-summary-grid">
          <UsageSummaryCard title={periodTitle} value={formattedTotal} detail="Current selected period" trend={data.trend} icon={<Activity />} />
          {bandMeta.map((band) => (
            <UsageSummaryCard
              key={band.key}
              title={band.title}
              value={formatAmount(data.bands[band.key])}
              detail={band.window}
              share={`${Math.round((data.bands[band.key] / data.total) * 100)}%`}
              icon={band.icon}
              tone={band.tone}
            />
          ))}
        </div></>}
      </section>

      {/* Sits under the usage chart rather than on its own page: "how much did I use" and
          "what was it for" are one question a customer asks in one breath, and splitting
          them across two tabs means the second is never found. Reads the real backend —
          the chart above is still on mock data, so the two will not always agree until
          that is wired, and the breakdown names its own period to make that obvious. */}
      {session && <EnergyBreakdownCard customerId={session.customerId} />}
    </>
  )
}
