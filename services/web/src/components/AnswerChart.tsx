import { useState } from 'react'
import type { ChartEvent } from '../lib/client'
import UsageGraph from './UsageGraph'

/**
 * The picture for one answer.
 *
 * The server decides whether there is a chart and what is in it (`app/charts.py`); this
 * only draws what arrived. That split is deliberate — the values come from the same
 * lookup the answer was written from and the same one recorded as evidence, so the
 * chart cannot quietly become a second, disagreeing answer. Nothing here computes a
 * figure, and a spec with no points renders nothing rather than an empty axis.
 *
 * ## Why the bars are horizontal
 *
 * The labels are the tool's own and they are sentences, not words — "heating, as far as
 * the weather explains it", "the always-on background load". Vertical bars would give
 * each of those about forty pixels of width, so they would be rotated or truncated, and
 * a truncated label on a chart about somebody's money is worse than no chart. Horizontal
 * bars give the label a whole line and reflow to any width, which is also what makes
 * this readable on a phone without a second layout.
 *
 * Line charts reuse `UsageGraph` — a month of daily totals is exactly what it was built
 * for, and it already carries the axis, the tooltip and the screen-reader summary.
 */

const money = (value: number) => `$${value.toFixed(2)}`
const energy = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)} kWh`

export default function AnswerChart({ spec }: { spec: ChartEvent }) {
  const [showSource, setShowSource] = useState(false)
  if (!spec.points.length) return null

  const format = spec.unit === 'nzd' ? money : energy
  const values = spec.points.map((p) => p.value)

  return (
    <figure className="answer-chart">
      <figcaption>{spec.title}</figcaption>

      {spec.kind === 'line' ? (
        <UsageGraph
          values={values}
          labels={spec.points.map((p) => p.label)}
          unit={spec.unit === 'nzd' ? '$' : 'kWh'}
          compact
          showLegend={false}
          // A month of dates or 24 hours: label every fifth tick so they do not collide.
          xLabelInterval={Math.max(1, Math.ceil(spec.points.length / 6))}
          ariaLabel={spec.title}
        />
      ) : (
        <BarList points={spec.points} format={format} />
      )}

      {spec.caveat && <p className="answer-chart-caveat">{spec.caveat}</p>}

      {spec.source && (
        <div className="answer-chart-source">
          <button type="button" onClick={() => setShowSource((open) => !open)} aria-expanded={showSource}>
            {showSource ? 'Hide where this came from' : 'Where this came from'}
          </button>
          {showSource && <p>{spec.source}</p>}
        </div>
      )}
    </figure>
  )
}

function BarList({
  points,
  format,
}: {
  points: ChartEvent['points']
  format: (value: number) => string
}) {
  // Scale against the largest bar, not against zero-to-max-of-axis. A $232 plan next to
  // a $234 plan should look nearly equal, because it is — stretching the difference to
  // fill the width would make a $2 gap look like a reason to switch.
  const ceiling = Math.max(...points.map((p) => Math.abs(p.value)), 0) || 1

  return (
    <ul className="answer-chart-bars">
      {points.map((point, i) => (
        <li key={`${point.label}-${i}`} className={point.highlight ? 'highlight' : undefined}>
          <span className="bar-label">{point.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(2, (Math.abs(point.value) / ceiling) * 100)}%` }}
            />
          </span>
          <span className="bar-value">{format(point.value)}</span>
        </li>
      ))}
    </ul>
  )
}
