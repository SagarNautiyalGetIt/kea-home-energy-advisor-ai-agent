import UsageGraph from './UsageGraph'

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
}

export default function AreaChart(props: AreaChartProps) {
  return <UsageGraph {...props} unit="kWh" />
}
