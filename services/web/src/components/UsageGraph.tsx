import { useEffect, useId, useRef, useState } from 'react'

export type UsageUnit = 'kWh' | '$'

export type UsageGraphProps = {
  values: number[]
  labels: string[]
  unit: UsageUnit
  max?: number
  compact?: boolean
  ariaLabel?: string
  comparisonValues?: number[]
}

const formatMetric = (value: number, unit: UsageUnit, max: number) => {
  const decimals = max <= 2 ? 1 : 0
  return unit === '$' ? `$${value.toFixed(decimals)}` : `${value.toFixed(decimals)} kWh`
}

export default function UsageGraph({ values, labels, unit, max, compact = false, ariaLabel = 'Electricity usage chart', comparisonValues }: UsageGraphProps) {
  const gradientId = `usage-fill-${useId().replaceAll(':', '')}`
  const graphRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const height = compact ? 180 : 230
  const margin = { top: 14, right: 16, bottom: 36, left: width < 480 ? 52 : 64 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  const safeValues = values.length ? values : [0]
  const ceiling = Math.max(max ?? Math.max(...safeValues) * 1.15, 1)
  const baseline = margin.top + chartHeight

  const points = safeValues.map((value, index) => ({
    x: margin.left + (index * chartWidth) / Math.max(safeValues.length - 1, 1),
    y: baseline - (Math.max(0, value) / ceiling) * chartHeight,
  }))
  const firstPoint = points[0] ?? { x: margin.left, y: baseline }
  const lastPoint = points.at(-1) ?? firstPoint

  const linePath = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`
    const previous = points[index - 1] ?? point
    const controlX = (previous.x + point.x) / 2
    return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`
  }, '')
  const areaPath = `${linePath} L ${lastPoint.x} ${baseline} L ${firstPoint.x} ${baseline} Z`
  const yTicks = [0, 0.25, 0.5, 0.75, 1]
  const comparisonPoints = comparisonValues?.map((value, index) => ({ x: margin.left + (index * chartWidth) / Math.max(comparisonValues.length - 1, 1), y: baseline - (Math.max(0, value) / ceiling) * chartHeight }))
  const comparisonPath = comparisonPoints?.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ')

  useEffect(() => {
    const element = graphRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={graphRef} className={`usage-graph ${compact ? 'usage-graph-compact' : ''}`} onMouseLeave={()=>setActiveIndex(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7259ff" stopOpacity=".38" />
            <stop offset="1" stopColor="#7259ff" stopOpacity=".03" />
          </linearGradient>
        </defs>

        {yTicks.map((ratio) => {
          const y = margin.top + ratio * chartHeight
          const value = ceiling * (1 - ratio)
          return (
            <g key={ratio}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="grid-line" />
              <text x={margin.left - 10} y={y + 4} textAnchor="end" className="axis-label y-axis-label">{formatMetric(value, unit, ceiling)}</text>
            </g>
          )
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        {comparisonPath&&<path d={comparisonPath} className="comparison-line"/>}
        <path d={linePath} className="chart-line" />
        {points.map((point, index) => {
          const value = safeValues[index] ?? 0
          return <circle key={`${point.x}-${index}`} cx={point.x} cy={point.y} r={activeIndex===index?6:compact?3:4} className="chart-point interactive-point" tabIndex={0} role="button" aria-label={`${labels[index] ?? `Point ${index+1}`}: ${formatMetric(value,unit,ceiling)}`} onMouseEnter={()=>setActiveIndex(index)} onFocus={()=>setActiveIndex(index)} onBlur={()=>setActiveIndex(null)} />
        })}
        {activeIndex!==null&&(() => {
          const activePoint = points[activeIndex]
          const activeValue = safeValues[activeIndex] ?? 0
          if (!activePoint) return null
          return <g className="chart-tooltip" pointerEvents="none"><line x1={activePoint.x} x2={activePoint.x} y1={margin.top} y2={baseline}/><rect x={Math.min(width-126,Math.max(4,activePoint.x-57))} y={Math.max(4,activePoint.y-47)} width="116" height="34" rx="8"/><text x={Math.min(width-68,Math.max(62,activePoint.x))} y={Math.max(25,activePoint.y-25)} textAnchor="middle">{labels[activeIndex] ?? `Point ${activeIndex + 1}`} · {formatMetric(activeValue,unit,ceiling)}</text></g>
        })()}
        {labels.map((label, index) => {
          const x = margin.left + (index * chartWidth) / Math.max(labels.length - 1, 1)
          return <text key={`${label}-${index}`} x={x} y={height - 10} textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'} className="axis-label x-axis-label">{label}</text>
        })}
      </svg>
      <div className="chart-legend"><span><i className="legend-current"/>Current period</span>{comparisonValues&&<span><i className="legend-previous"/>Previous period</span>}</div>
      <p className="sr-only">{ariaLabel}. Highest value is {formatMetric(Math.max(...safeValues),unit,ceiling)} and lowest value is {formatMetric(Math.min(...safeValues),unit,ceiling)}.</p>
    </div>
  )
}
