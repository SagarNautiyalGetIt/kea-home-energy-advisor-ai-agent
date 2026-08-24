import UsageGraph from './UsageGraph'

type AreaChartProps = { values: number[]; labels: string[]; max?: number; compact?: boolean }

export default function AreaChart(props: AreaChartProps) {
  return <UsageGraph {...props} unit="kWh" />
}
