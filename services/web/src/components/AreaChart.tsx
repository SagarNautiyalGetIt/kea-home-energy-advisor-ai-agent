import UsageGraph, { type UsageUnit } from './UsageGraph'

type AreaChartProps = {
  values: number[]
  labels: string[]
  max?: number
  compact?: boolean
  ariaLabel?: string
  xLabelInterval?: number
  showLegend?: boolean
  secondaryLabels?: string[]
  tooltipLabels?: string[]
  animate?: boolean
  /** Defaults to kWh for the callers that still plot energy. The dashboard passes '$',
   *  because the question people open this app with is what it is going to cost. */
  unit?: UsageUnit
}

export default function AreaChart({ unit = 'kWh', ...props }: AreaChartProps) {
  return <UsageGraph {...props} unit={unit} />
}
