import '../solar.css'
import { CalendarClock, Check, Info, Receipt, ShieldCheck } from 'lucide-react'
import SparkyIcon from '../components/SparkyIcon'
import SolarSunArt from '../components/SolarSunArt'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import type { CommitmentTerm, PricingStyle, CommitmentTermId, PricingStyleId } from '../data/mockData'
import { accountRequest, type Plans } from '../lib/account-client'
import { loadSession } from '../lib/session'
import FeedbackState from '../components/FeedbackState'
const planInclusions: string[] = []

// The row of plan inclusions under the solar card (AI usage tracking, saving tips, digital
// bills, smart meter required) is hidden for now: it read as unrelated to choosing a plan.
const SHOW_PLAN_INCLUSIONS = false

export default function PlansPage({ onToast }: { onToast:(message:string,tone?:'success'|'info'|'warning')=>void }) {
  const navigate = useNavigate()
  const [catalogue, setCatalogue] = useState<Plans | null>(null)
  const [error, setError] = useState('')
  const [requesting, setRequesting] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void accountRequest<Plans>('plans', controller.signal).then(data => {
      setCatalogue(data)
      setStyleId((data.current_plan.pricing_style ?? data.pricing_styles[0]?.id ?? 'anytime') as PricingStyleId)
      setTermId((data.current_plan.term ?? 'flexible') as CommitmentTermId)
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [])
  const currentPlan = { pricingStyle: catalogue?.current_plan.pricing_style, term: catalogue?.current_plan.term }
  const pricingStyles: PricingStyle[] = (catalogue?.pricing_styles ?? []).map(item => ({
    id: item.id as PricingStyleId, name:item.name, eyebrow:item.eyebrow,
    summary:item.best_for, dailyCharge:item.daily, rates:item.rates.map(rate => ({...rate, window:rate.window ?? undefined})),
    highlights:item.highlights, bestFor:item.best_for,
  }))
  const commitmentTerms: CommitmentTerm[] = (catalogue?.commitment_terms ?? []).map(item => ({
    id:item.id as CommitmentTermId, name:item.name, priceTreatment:item.price_treatment,
    monthlyCredit:item.monthly_credit, creditNote:item.credit_note, totalCredit:item.total_credit, earlyExitFee:item.early_exit_fee,
  }))
  const rateSummary = (id: PricingStyleId) => pricingStyles.find(item => item.id === id)?.rates ?? []
  const requestSwitch = async () => {
    setRequesting(true)
    try {
      await accountRequest('plan-change-requests', undefined, {customer_id:loadSession()?.customerId, pricing_style:styleId, commitment_term:termId})
      onToast('Plan request recorded for Customer Care review. Your current plan remains active.', 'info')
    } catch (failure) { onToast(failure instanceof Error ? failure.message : 'Request could not be saved.', 'warning') }
    finally { setRequesting(false) }
  }
  const [styleId, setStyleId] = useState<PricingStyleId>('anytime')
  const [termId, setTermId] = useState<CommitmentTermId>('flexible')
  const [ratesOpen, setRatesOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const termStepRef = useRef<HTMLElement>(null)

  const style = pricingStyles.find((item) => item.id === styleId) ?? pricingStyles[0]!
  const term = commitmentTerms.find((item) => item.id === termId) ?? commitmentTerms[0]!
  const isCurrent = styleId === currentPlan.pricingStyle && termId === currentPlan.term

  // Choosing a pricing style finishes step 1, so the page glides down to step 2 instead of
  // leaving the customer to find it. The short pause lets the new selection show first.
  // Reduced motion jumps there instead of gliding.
  const chooseStyle = (id: PricingStyleId) => {
    setStyleId(id)
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    window.setTimeout(() => termStepRef.current?.scrollIntoView({ behavior, block: 'start' }), 250)
  }

  const askAi = () => {
    localStorage.setItem('kea-ai-plan-question', `${style.name} (${term.name})`)
    navigate('/assistant')
  }

  if (error) return <FeedbackState state="error" message={error}/>
  if (!catalogue || !style || !term) return <FeedbackState state="loading" title="Loading plans" message="Reading the published catalogue…"/>
  return <>
    <div className="page-heading plans-heading">
      <div>
        <h1>Plans</h1>
        <p className="plans-description">Build your plan in two steps — three pricing styles and three terms make nine combinations.</p>
      </div>
      <button className="compare-action" onClick={askAi}><SparkyIcon/>Ask Sparky to recommend a plan</button>
    </div>

    {/* Both steps in one panel, split by a divider, so choosing a plan reads as one task. */}
    <div className="card plan-builder">
      <section className="plan-step" aria-labelledby="plan-step-pricing">
        <header className="plan-step-head">
          <span className="plan-step-index">Step 1</span>
          <h2 id="plan-step-pricing">Choose how you pay for power</h2>
          <p>Your daily charge and usage rates come from this choice.</p>
        </header>
        <div className="pricing-grid" role="radiogroup" aria-label="Pricing style">
          {pricingStyles.map((option) => {
            const selected = option.id === styleId
            return (
              <article key={option.id} className={`pricing-card ${selected ? 'pricing-card-selected' : ''}`}>
                {option.flag && <span className="pricing-flag">{option.flag}</span>}
                {option.id === currentPlan.pricingStyle && <span className="pricing-current">Your current style</span>}
                <span className="pricing-eyebrow">{option.eyebrow}</span>
                <h3>{option.name}</h3>
                <p className="pricing-summary">{option.summary}</p>
                <dl className="pricing-rates">
                  {option.rates.map((rate) => (
                    <div key={rate.label}>
                      <dt>{rate.label}{rate.window && <small>{rate.window}</small>}</dt>
                      <dd>{rate.value}<small>{rate.unit}</small></dd>
                    </div>
                  ))}
                  <div className="pricing-daily">
                    <dt>Daily charge</dt>
                    <dd>{option.dailyCharge}<small>/day</small></dd>
                  </div>
                </dl>
                <ul className="pricing-points">
                  {option.highlights.map((item) => <li key={item}><Check aria-hidden="true"/>{item}</li>)}
                </ul>
                <p className="pricing-bestfor"><span>Best for</span><strong>{option.bestFor}</strong></p>
                <button
                  className="pricing-choose"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseStyle(option.id)}
                >{selected ? <><Check aria-hidden="true"/>Selected</> : `Choose ${option.name}`}</button>
              </article>
            )
          })}
        </div>
      </section>

      <section ref={termStepRef} className="plan-step" aria-labelledby="plan-step-term">
        <header className="plan-step-head">
          <span className="plan-step-index">Step 2</span>
          <h2 id="plan-step-term">Choose your commitment</h2>
          <p>Your rates stay the same. A longer term locks them in and earns a monthly bill credit.</p>
        </header>
        <div className="term-grid">
          {commitmentTerms.map((option) => (
            <label key={option.id} className={`term-card ${option.id === termId ? 'term-card-selected' : ''}`}>
              <input type="radio" name="plan-term" checked={option.id === termId} onChange={() => setTermId(option.id)}/>
              {option.flag && <span className="term-flag">{option.flag}</span>}
              <span className="term-name">{option.name}</span>
              <strong className="term-credit">{option.monthlyCredit}<small>{option.monthlyCredit === 'No credit' ? '' : ' / month'}</small></strong>
              <span className="term-line">{option.priceTreatment}</span>
              <span className="term-line term-total">{option.totalCredit} total credit</span>
              <span className="term-line">Early exit fee: {option.earlyExitFee.toLowerCase()}</span>
            </label>
          ))}
        </div>
      </section>
    </div>

    {/* The "Your plan" bar and the solar card share one set of columns (see .plan-closing)
        so the two are the same height and their buttons line up. */}
    <div className="plan-closing">
      <section className="plan-summary" aria-live="polite">
        <div className="plan-summary-main">
          <span>{isCurrent ? 'Your current plan' : 'Your selection'}</span>
          <strong>{style.name}</strong>
          <small>{term.name} · {term.priceTreatment.toLowerCase()}</small>
        </div>
        <dl className="plan-summary-stats">
          <div><dt>Usage rates</dt><dd className="plan-usage-rates">{rateSummary(style.id).map((rate) => <span key={rate.label}>{rate.value}{rate.unit} {rate.label.toLowerCase()}</span>)}</dd></div>
          <div><dt>Daily charge</dt><dd>{style.dailyCharge}</dd></div>
          <div><dt>Monthly credit</dt><dd>{term.monthlyCredit}</dd></div>
          <div><dt>Credit over term</dt><dd>{term.totalCredit}</dd></div>
          <div><dt>Early exit fee</dt><dd>{term.earlyExitFee}</dd></div>
        </dl>
        <div className="plan-summary-actions">
          <button
            className="plan-summary-cta"
            disabled={isCurrent || requesting}
            onClick={() => void requestSwitch()}
          >{isCurrent ? "You're on this plan" : requesting ? 'Sending request…' : 'Request this plan'}</button>
          <span className="plan-summary-links">
            <button onClick={() => setRatesOpen(true)}>Compare all rates</button>
            <button onClick={() => setTermsOpen(true)}>Terms &amp; Conditions</button>
          </span>
        </div>
      </section>

      <section className="card solar-entry plan-solar"><div><SolarSunArt className="plan-solar-sun"/><h2>Could solar lower your bills?</h2><p>Estimate your potential savings and how long rooftop solar could take to pay for itself.</p></div><button className="plan-solar-cta" onClick={() => navigate('/solar?plan=' + styleId)}>Explore solar savings</button></section>
    </div>
    {SHOW_PLAN_INCLUSIONS && <ul className="plan-inclusions">
      {planInclusions.map((item) => <li key={item}><Check aria-hidden="true"/>{item}</li>)}
    </ul>}

    {ratesOpen && <Modal title="Compare all rates" wide onClose={() => setRatesOpen(false)} footer={<button className="primary-action" onClick={() => setRatesOpen(false)}>Done</button>}>
      <div className="plan-rate-tables">
        <h3>Pricing styles</h3>
        <div className="plan-rate-table" role="table">
          {/* The style and term picked on the page are tinted, with a check in the header,
              so the table reads against the customer's own choice. */}
          <div role="row"><span>Charge</span>{pricingStyles.map((option) => <span key={option.id} className={option.id === styleId ? 'is-picked' : undefined}>{option.id === styleId && <Check aria-hidden="true"/>}{option.name}</span>)}</div>
          {['Daily charge', 'Anytime rate', 'Peak rate', 'Off-peak rate', 'Night rate', 'Free period'].map((row) => (
            <div role="row" key={row}>
              <span>{row}</span>
              {pricingStyles.map((option) => {
                const picked = option.id === styleId ? 'is-picked' : undefined
                if (row === 'Daily charge') return <span key={option.id} className={picked}>{option.dailyCharge}</span>
                // A rate's label is either the row's name ("Anytime rate", "Free period") or its
                // name without " rate" ("Peak"). This read only the second form, so the Anytime
                // rate row showed a dash for Anytime Rate and Free Weekends alike.
                const rate = option.rates.find((item) => item.label === row || `${item.label} rate` === row)
                return <span key={option.id} className={picked}>{rate ? `${rate.value}${rate.unit}` : '—'}</span>
              })}
            </div>
          ))}
        </div>
        <h3>Commitment terms</h3>
        <div className="plan-rate-table plan-rate-table-terms" role="table">
          <div role="row"><span>Term</span><span>Price treatment</span><span>Monthly credit</span><span>Total credit</span><span>Early exit fee</span></div>
          {commitmentTerms.map((option) => (
            <div role="row" key={option.id} className={option.id === termId ? 'is-picked' : undefined}>
              <span>{option.id === termId && <Check aria-hidden="true"/>}{option.name}</span><span>{option.priceTreatment}</span><span>{option.monthlyCredit}</span><span>{option.totalCredit}</span><span>{option.earlyExitFee}</span>
            </div>
          ))}
        </div>
        <p className="prototype-note"><Info aria-hidden="true"/>Rates are indicative prototype figures and include GST. Final pricing depends on your address and meter.</p>
      </div>
    </Modal>}

    {termsOpen && <Modal title="Terms & Conditions" wide onClose={() => setTermsOpen(false)} footer={<button className="primary-action" onClick={() => setTermsOpen(false)}>Done</button>}>
      {/* The plan these terms are for, as a tag, instead of in a title too long for one line;
          then the three groups of terms as panels, each with its own icon. */}
      <div className="plan-terms">
        <span className="plan-terms-tag">{style.name} · {term.name}</span>
        <p className="plan-terms-lede">These terms explain eligibility, billing, and how your pricing style and commitment term apply to your account.</p>
        <section>
          <h3><Receipt aria-hidden="true"/>Pricing style — {style.name}</h3>
          <ul>
            <li>{style.summary}</li>
            {style.rates.map((rate) => <li key={rate.label}>{rate.label}: {rate.value}{rate.unit}{rate.window ? ` (${rate.window})` : ''}</li>)}
            <li>Daily charge: {style.dailyCharge} per day.</li>
          </ul>
        </section>
        <section>
          <h3><CalendarClock aria-hidden="true"/>Commitment — {term.name}</h3>
          <ul>
            <li>{term.priceTreatment}.</li>
            <li>{term.creditNote}, applied to your bill as {term.totalCredit} over the term.</li>
            <li>Leaving early: {term.earlyExitFee.toLowerCase()}.</li>
          </ul>
        </section>
        <section>
          <h3><ShieldCheck aria-hidden="true"/>Important conditions</h3>
          <ul>
            <li>A communicating smart meter is required at your address.</li>
            <li>Your account must remain active and payments made by the due date.</li>
            <li>Plan benefits apply only during the advertised times and periods.</li>
            <li>You can request a plan change through Customer Care at any time.</li>
          </ul>
        </section>
      </div>
    </Modal>}
  </>
}
