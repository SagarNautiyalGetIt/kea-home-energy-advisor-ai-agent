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
  xLabelInterval?: number
  showLegend?: boolean
  secondaryLabels?: string[]
  tooltipLabels?: string[]
  animate?: boolean
}

const formatMetric = (value: number, unit: UsageUnit, max: number) => {
  const decimals = max <= 2 ? 1 : 0
  return unit === '$' ? `$${value.toFixed(decimals)}` : `${value.toFixed(decimals)} kWh`
}

export default function UsageGraph({ values, labels, unit, max, compact = false, ariaLabel = 'Electricity usage chart', comparisonValues, xLabelInterval = 1, showLegend = true, secondaryLabels, tooltipLabels, animate = false }: UsageGraphProps) {
  const gradientId = `usage-fill-${useId().replaceAll(':', '')}`
  const graphRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const height = compact ? 180 : 350
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

        <g>
          <path d={areaPath} fill={`url(#${gradientId})`} className={animate ? 'chart-area-reveal' : undefined} />
          {comparisonPath&&<path d={comparisonPath} pathLength={animate ? 1 : undefined} className={`comparison-line ${animate ? 'chart-line-reveal' : ''}`}/>}
          <path d={linePath} pathLength={animate ? 1 : undefined} className={`chart-line ${animate ? 'chart-line-reveal' : ''}`} />
          <g className={animate ? 'chart-points-reveal' : undefined}>
          {points.map((point, index) => {
            const value = safeValues[index] ?? 0
            return <circle key={`${point.x}-${index}`} cx={point.x} cy={point.y} r={activeIndex===index?6:compact?3:4} className="chart-point interactive-point" tabIndex={0} role="button" aria-label={`${tooltipLabels?.[index] ?? labels[index] ?? `Point ${index+1}`}: ${formatMetric(value,unit,ceiling)}`} onMouseEnter={()=>setActiveIndex(index)} onFocus={()=>setActiveIndex(index)} onBlur={()=>setActiveIndex(null)} />
          })}
          </g>
        </g>
        {activeIndex!==null&&(() => {
          const activePoint = points[activeIndex]
          const activeValue = safeValues[activeIndex] ?? 0
          if (!activePoint) return null
          const tooltipLabel = tooltipLabels?.[activeIndex] ?? labels[activeIndex] ?? `Point ${activeIndex + 1}`
          const tooltipWidth = tooltipLabels ? 190 : 116
          const tooltipX = Math.min(width-tooltipWidth-4,Math.max(4,activePoint.x-tooltipWidth/2))
          return <g className="chart-tooltip" pointerEvents="none"><line x1={activePoint.x} x2={activePoint.x} y1={margin.top} y2={baseline}/><rect x={tooltipX} y={Math.max(4,activePoint.y-47)} width={tooltipWidth} height="34" rx="8"/><text x={tooltipX+tooltipWidth/2} y={Math.max(25,activePoint.y-25)} textAnchor="middle">{tooltipLabel} · {formatMetric(activeValue,unit,ceiling)}</text></g>
        })()}
        {labels.map((label, index) => {
          if (index % xLabelInterval !== 0) return null
          const x = margin.left + (index * chartWidth) / Math.max(labels.length - 1, 1)
          const textAnchor = index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'
          return <g key={`${label}-${index}`}>
            <text x={x} y={secondaryLabels ? height - 20 : height - 10} textAnchor={textAnchor} className="axis-label x-axis-label">{label}</text>
            {secondaryLabels?.[index]&&<text x={x} y={height - 7} textAnchor={textAnchor} className="axis-label x-axis-date-label">{secondaryLabels[index]}</text>}
          </g>
        })}
      </svg>
      {showLegend&&<div className="chart-legend"><span><i className="legend-current"/>Current period</span>{comparisonValues&&<span><i className="legend-previous"/>Previous period</span>}</div>}
      <p className="sr-only">{ariaLabel}. Highest value is {formatMetric(Math.max(...safeValues),unit,ceiling)} and lowest value is {formatMetric(Math.min(...safeValues),unit,ceiling)}.</p>
    </div>
  )
}
