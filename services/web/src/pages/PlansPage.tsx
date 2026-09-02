import { Check, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import { commitmentTerms, currentPlan, planInclusions, pricingStyles, type CommitmentTermId, type PricingStyleId } from '../data/mockData'

const rateSummary = (styleId: PricingStyleId) => {
  const style = pricingStyles.find((item) => item.id === styleId)
  if (!style) return ''
  return style.rates.map((rate) => `${rate.value}${rate.unit} ${rate.label.toLowerCase()}`).join(' · ')
}

export default function PlansPage({ onToast }: { onToast:(message:string,tone?:'success'|'info'|'warning')=>void }) {
  const navigate = useNavigate()
  const [styleId, setStyleId] = useState<PricingStyleId>(currentPlan.pricingStyle)
  const [termId, setTermId] = useState<CommitmentTermId>(currentPlan.term)
  const [ratesOpen, setRatesOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)

  const style = pricingStyles.find((item) => item.id === styleId) ?? pricingStyles[0]!
  const term = commitmentTerms.find((item) => item.id === termId) ?? commitmentTerms[0]!
  const isCurrent = styleId === currentPlan.pricingStyle && termId === currentPlan.term

  const askAi = () => {
    localStorage.setItem('kea-ai-plan-question', `${style.name} (${term.name})`)
    navigate('/assistant')
  }

  return <>
    <div className="page-heading plans-heading">
      <div>
        <h1>Plans</h1>
        <p className="plans-description">Build your plan in two steps — three pricing styles and three terms make nine combinations.</p>
      </div>
      <button className="compare-action" onClick={askAi}><MessagesSquare/>Ask Sparky to recommend a plan</button>
    </div>

    <section className="plan-step card" aria-labelledby="plan-step-pricing">
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
                onClick={() => setStyleId(option.id)}
              >{selected ? <><Check aria-hidden="true"/>Selected</> : `Choose ${option.name}`}</button>
            </article>
          )
        })}
      </div>
    </section>

    <section className="plan-step card" aria-labelledby="plan-step-term">
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

    <section className="plan-summary" aria-live="polite">
      <div className="plan-summary-main">
        <span>Your plan</span>
        <strong>{style.name}</strong>
        <small>{term.name} · {term.priceTreatment.toLowerCase()}</small>
      </div>
      <dl className="plan-summary-stats">
        <div><dt>Daily charge</dt><dd>{style.dailyCharge}</dd></div>
        <div><dt>Usage rates</dt><dd>{rateSummary(style.id)}</dd></div>
        <div><dt>Monthly credit</dt><dd>{term.monthlyCredit}</dd></div>
        <div><dt>Credit over term</dt><dd>{term.totalCredit}</dd></div>
        <div><dt>Early exit fee</dt><dd>{term.earlyExitFee}</dd></div>
      </dl>
      <div className="plan-summary-actions">
        <button
          className="plan-summary-cta"
          disabled={isCurrent}
          onClick={() => onToast(`Switch to ${style.name} on the ${term.name} term requested`)}
        >{isCurrent ? "You're on this plan" : 'Switch to this plan'}</button>
        <span className="plan-summary-links">
          <button onClick={() => setRatesOpen(true)}>Compare all rates</button>
          <button onClick={() => setTermsOpen(true)}>Terms &amp; Conditions</button>
        </span>
      </div>
    </section>

    <ul className="plan-inclusions">
      {planInclusions.map((item) => <li key={item}><Check aria-hidden="true"/>{item}</li>)}
    </ul>

    {ratesOpen && <Modal title="Compare all rates" wide onClose={() => setRatesOpen(false)} footer={<button className="primary-action" onClick={() => setRatesOpen(false)}>Done</button>}>
      <div className="plan-rate-tables">
        <h3>Pricing styles</h3>
        <div className="plan-rate-table" role="table">
          <div role="row"><span>Charge</span>{pricingStyles.map((option) => <span key={option.id}>{option.name}</span>)}</div>
          {['Daily charge', 'Anytime rate', 'Peak rate', 'Off-peak rate', 'Night rate', 'Free period'].map((row) => (
            <div role="row" key={row}>
              <span>{row}</span>
              {pricingStyles.map((option) => {
                if (row === 'Daily charge') return <span key={option.id}>{option.dailyCharge}</span>
                const rate = option.rates.find((item) => `${item.label} rate` === row || item.label === row.replace(' rate', ''))
                return <span key={option.id}>{rate ? `${rate.value}${rate.unit}` : '—'}</span>
              })}
            </div>
          ))}
        </div>
        <h3>Commitment terms</h3>
        <div className="plan-rate-table plan-rate-table-terms" role="table">
          <div role="row"><span>Term</span><span>Price treatment</span><span>Monthly credit</span><span>Total credit</span><span>Early exit fee</span></div>
          {commitmentTerms.map((option) => (
            <div role="row" key={option.id}>
              <span>{option.name}</span><span>{option.priceTreatment}</span><span>{option.monthlyCredit}</span><span>{option.totalCredit}</span><span>{option.earlyExitFee}</span>
            </div>
          ))}
        </div>
        <p className="prototype-note">Rates are indicative prototype figures and include GST. Final pricing depends on your address and meter.</p>
      </div>
    </Modal>}

    {termsOpen && <Modal title={`${style.name} · ${term.name} — Terms & Conditions`} wide onClose={() => setTermsOpen(false)} footer={<button className="primary-action" onClick={() => setTermsOpen(false)}>Done</button>}>
      <div className="terms-content">
        <p>These terms explain eligibility, billing, and how your pricing style and commitment term apply to your account.</p>
        <h3>Pricing style — {style.name}</h3>
        <ul>
          <li>{style.summary}</li>
          {style.rates.map((rate) => <li key={rate.label}>{rate.label}: {rate.value}{rate.unit}{rate.window ? ` (${rate.window})` : ''}</li>)}
          <li>Daily charge: {style.dailyCharge} per day.</li>
        </ul>
        <h3>Commitment — {term.name}</h3>
        <ul>
          <li>{term.priceTreatment}.</li>
          <li>{term.creditNote}, applied to your bill as {term.totalCredit} over the term.</li>
          <li>Leaving early: {term.earlyExitFee.toLowerCase()}.</li>
        </ul>
        <h3>Important conditions</h3>
        <ul>
          <li>A communicating smart meter is required at your address.</li>
          <li>Your account must remain active and payments made by the due date.</li>
          <li>Plan benefits apply only during the advertised times and periods.</li>
          <li>You can request a plan change through Customer Care at any time.</li>
        </ul>
      </div>
    </Modal>}
  </>
}
