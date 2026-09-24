import { CircleHelp, Info, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getEnergyBreakdown, type EnergyBreakdown } from '../lib/client'
import { energyBreakdownPresentation, unavailableBreakdownMessage } from '../lib/energyBreakdownPresentation'

/**
 * Where this household's power goes, split by behaviour.
 *
 * ## The two rules this component exists to hold
 *
 * **It never names an appliance.** The categories are behaviours — the always-on
 * background load, the separately metered circuit, the part of usage that moves with
 * temperature — and each is separately measurable from data the platform already holds.
 * "Heating" here is a fitted response to outdoor temperature, not a heat pump. Rewriting
 * a label to something friendlier is how that distinction gets lost, so the labels come
 * from the backend and are rendered as given.
 *
 * **A measured slice and an estimated one do not look the same.** Every category carries a
 * `confidence`, and a chart that renders a regression estimate identically to a meter
 * reading overstates what is known — which is precisely the failure this product is
 * organised against. So `fitted` slices are hatched and carry an "estimated" chip, and the
 * basis of every figure is one tap away.
 *
 * ## Unavailable is a state worth designing
 *
 * `available: false` is a real answer, not an error and not an empty chart. An account with
 * no half-hourly data genuinely cannot have its standing load separated from a day of
 * ordinary living, and the honest screen says that in the customer's words rather than
 * drawing one slice labelled "everything".
 */

const TONES: Record<string, string> = {
  always_on: 'breakdown-always-on',
  water_heating: 'breakdown-water',
  space_heating: 'breakdown-heating',
  everything_else: 'breakdown-other',
}

const CONFIDENCE_COPY: Record<string, string> = {
  measured: 'Measured',
  fitted: 'Estimated',
  residual: 'What’s left',
}

const CONFIDENCE_HINT: Record<string, string> = {
  measured: 'Read directly off your meter.',
  fitted:
    'Worked out from how your own usage moves with the weather, so it is an estimate rather than a reading.',
  residual:
    'Whatever is left once the others are accounted for, so it carries their uncertainty too.',
}

export default function EnergyBreakdownCard({ customerId }: { customerId: string }) {
  const [response, setResponse] = useState<EnergyBreakdown | null>(null)
  const [settled, setSettled] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openBasis, setOpenBasis] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setResponse(null)
    setSettled(false)
    setFailed(false)
    setOpenBasis(null)
    getEnergyBreakdown(customerId)
      .then((result) => { if (live) setResponse(result) })
      .catch(() => { if (live) setFailed(true) })
      .finally(() => { if (live) setSettled(true) })
    return () => { live = false }
  }, [customerId])

  const { data, isDemo } = energyBreakdownPresentation(customerId, response)

  if (failed && !isDemo) {
    return (
      <section className="card breakdown-card">
        <h2><CircleHelp aria-hidden="true"/>Where your power goes</h2>
        <p className="breakdown-empty">
          We couldn’t load your breakdown just now. Nothing is wrong with your account —
          try again in a moment.
        </p>
      </section>
    )
  }

  if (!settled || !data) {
    return (
      <section className="card breakdown-card">
        <h2><CircleHelp aria-hidden="true"/>Where your power goes</h2>
        <p className="breakdown-empty"><Loader2 className="spin" aria-hidden="true"/> Working it out…</p>
      </section>
    )
  }

  // Not an error and not an empty chart. See the component docstring.
  if (!data.available) {
    return (
      <section className="card breakdown-card">
        <h2><CircleHelp aria-hidden="true"/>Where your power goes</h2>
        <p className="breakdown-empty">{unavailableBreakdownMessage(data)}</p>
        <p className="breakdown-footnote">
          This is a limit of what your meter records, not a problem with your account.
        </p>
      </section>
    )
  }

  const blueOrangeBar = data.categories.length === 2
    && data.categories[0]?.key === 'always_on'
    && data.categories[1]?.key === 'everything_else'
    && data.categories.every((category) => category.confidence !== 'fitted')

  return (
    <section className="card breakdown-card">
      <h2><CircleHelp aria-hidden="true"/>Where your power goes</h2>
      <p className="breakdown-lede">
        {data.period} · {data.days} days · {data.total_kwh.toFixed(0)} units
        {isDemo && <><br/><small>Demo example · not live meter readings</small></>}
      </p>

      {/* One bar rather than a pie: shares of a whole are read more accurately along a
          line than around a circle, and a stacked bar keeps its labels legible at four
          categories where a pie needs leader lines. */}
      <div className={`breakdown-bar${blueOrangeBar ? ' breakdown-bar-blue-orange' : ''}`} role="img"
           aria-label={data.categories.map((c) => `${c.label} ${c.share_pct}%`).join(', ')}>
        {data.categories.map((category) => (
          <span
            key={category.key}
            className={`${TONES[category.key] ?? 'breakdown-other'} ${
              category.confidence === 'fitted' ? 'breakdown-estimated' : ''
            }`}
            style={{ width: `${Math.max(category.share_pct, 1)}%` }}
          />
        ))}
      </div>

      <ul className="breakdown-list">
        {data.categories.map((category) => (
          <li key={category.key}>
            <div className="breakdown-row">
              <span className={`breakdown-swatch ${TONES[category.key] ?? 'breakdown-other'} ${
                category.confidence === 'fitted' ? 'breakdown-estimated' : ''
              }`} aria-hidden="true"/>
              <div className="breakdown-label">
                <strong>{category.label}</strong>
                <small title={CONFIDENCE_HINT[category.confidence]}>
                  {CONFIDENCE_COPY[category.confidence] ?? category.confidence}
                </small>
              </div>
              <div className="breakdown-figures">
                <strong>${category.cost_nzd.toFixed(2)}</strong>
                <small>{category.share_pct}% · {category.kwh.toFixed(0)} units</small>
              </div>
              {/* The basis is the answer to "how do you know that", which is the most
                  common thing anybody asks a breakdown. One tap, not a footnote. */}
              <button
                type="button"
                className="breakdown-why"
                aria-expanded={openBasis === category.key}
                onClick={() => setOpenBasis(openBasis === category.key ? null : category.key)}
              >
                <Info aria-hidden="true"/><span className="sr-only">How was this worked out?</span>
              </button>
            </div>
            {openBasis === category.key && (
              <p className="breakdown-basis">
                {category.basis}
                {category.caveat && <><br/>{category.caveat}</>}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="breakdown-footnote">
        These are <strong>types of use</strong>, not individual appliances. One meter reads
        the whole house, so it can tell heating apart from your always-on load — but it
        cannot tell a heat pump from a heater. Connect a smart device and that device can
        be named.
      </p>

      {data.caveats.length > 0 && (
        <details className="breakdown-caveats">
          <summary>What this doesn’t cover</summary>
          <ul>{data.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
