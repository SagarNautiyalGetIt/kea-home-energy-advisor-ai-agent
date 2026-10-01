import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Sun, ArrowLeft, Info, Check, ChevronDown } from 'lucide-react'
import SolarSunArt from '../components/SolarSunArt'
import SparkyIcon from '../components/SparkyIcon'
import { pricingStyles } from '../data/mockData'
import { getAnnualDemand, getCustomerProfile } from '../lib/client'
import { loadSession } from '../lib/session'
import { calculateSolar, centsToNzd, energy, money, numeric, solarConfig, type SolarContext } from '../lib/solar'
import '../solar.css'

const inputLabels: Record<string, string> = { panelKw: 'Panel capacity (kW DC)', installedCost: 'Installed price (NZD incl. GST)', annualDemand: 'Annual demand (kWh)', location: 'Reference location', generationOverride: 'Installer generation (kWh/year)', selfUse: 'Assumed solar self-use', importRate: 'Import before (NZD/kWh)', solarImportRate: 'Import after (NZD/kWh)', exportRate: 'Export (NZD/kWh)', baselineDaily: 'Daily charge before (NZD)', solarDaily: 'Daily charge after (NZD)', baselineCredit: 'Annual credit before (NZD)', solarCredit: 'Annual credit after (NZD)', operatingCost: 'Maintenance and replacement allowance (NZD/year)' }
// One option in a row of choices: a radio drawn as a chip, with a check once chosen. The
// small sets on this page (mode, example system, city, self-use) all use it; the system and
// city were dropdowns, whose native option list did not match the page.
const Choice = ({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) =>
  <label><input type="radio" name={name} checked={checked} onChange={onChange}/><Check aria-hidden="true"/>{children}</label>

type Fields = Record<'kw' | 'cost' | 'demand' | 'generation' | 'importCents' | 'solarImportCents' | 'exportCents' | 'daily' | 'solarDaily' | 'credit' | 'solarCredit', string>
/** Tama is a synthetic account (services/api/app/auth.py); this fills its annual demand when the API cannot supply one. */
const TAMA_DEMAND = { customerId: 'DEMO-ACCT-223001', kwh: 4324.5 }
export default function SolarPage() {
  const resultsRef = useRef<HTMLElement>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const selectedPlan = pricingStyles.find(plan => plan.id === params.get('plan')) ?? pricingStyles[0]!
  const flat = selectedPlan.id === 'anytime'
  const startingCents = flat ? Number(selectedPlan.rates[0]!.value.replace('$', '')) * 100 : solarConfig.exampleImportRate * 100
  const [mode, setMode] = useState('example')
  const [location, setLocation] = useState('Auckland')
  const [locationOrigin, setLocationOrigin] = useState('Example city; confirm for your roof')
  const [demandOrigin, setDemandOrigin] = useState('Customer-provided representative annual demand')
  const [selfUse, setSelfUse] = useState(0.5)
  const [fields, setFields] = useState<Fields>({ kw: '5', cost: '11500', demand: '', generation: '', importCents: String(startingCents), solarImportCents: String(startingCents), exportCents: '15', daily: selectedPlan.dailyCharge.replace('$', ''), solarDaily: selectedPlan.dailyCharge.replace('$', ''), credit: '0', solarCredit: '0' })
  const [context, setContext] = useState<SolarContext | null>(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const [accountDemand, setAccountDemand] = useState<number | null>(null)
  const [accountNote, setAccountNote] = useState('Checking this account’s usage history…')
  const [profileNote, setProfileNote] = useState('')
  const customerId = loadSession()?.customerId ?? ''
  useEffect(() => {
    let active = true
    if (!customerId) {
      setAccountNote('Sign in to load annual demand from account meter history, or enter a representative annual value.')
      return () => { active = false }
    }
    void getCustomerProfile(customerId).then(profile => {
      if (!active) return
      setProfileNote(`${profile.plan_name ? `Account plan: ${profile.plan_name}. ` : ''}${profile.address ? `Account location: ${profile.address}. Choose the matching reference city below.` : 'No account location is available; confirm a reference city.'}`)
    }).catch(() => { /* Demand can still load when profile details are unavailable. */ })
    const fillTamaDemand = () => {
      if (customerId !== TAMA_DEMAND.customerId) return
      setAccountDemand(TAMA_DEMAND.kwh)
      setFields(prev => ({ ...prev, demand: String(TAMA_DEMAND.kwh) }))
    }
    void getAnnualDemand(customerId).then(summary => {
      if (!active) return
      if (summary.available && summary.annual_kwh !== null) {
        const roundedDemand = Math.round(summary.annual_kwh * 10) / 10
        const value = String(roundedDemand)
        setAccountDemand(roundedDemand)
        setFields(prev => ({ ...prev, demand: value }))
        setAccountNote('Annual demand was loaded automatically from this account’s usage history.')
        setDemandOrigin(summary.note)
      } else {
        setAccountNote(summary.note)
        fillTamaDemand()
      }
    }).catch(() => {
      if (!active) return
      setAccountNote('Annual account demand could not be loaded. Enter a representative annual value.')
      fillTamaDemand()
    })
    return () => { active = false }
  }, [customerId])
  const changed = () => { setStale(true); setError('') }
  const update = (key: keyof Fields, value: string) => { setFields(prev => ({ ...prev, [key]: value })); changed() }
  const result = context?.result
  const field = (key: keyof Fields, label: string, optional = false) => <label className="solar-field" htmlFor={`solar-${key}`}><span>{label}</span><input id={`solar-${key}`} type="number" min="0" step="any" inputMode="decimal" value={fields[key]} required={!optional} onChange={event => { update(key, event.target.value); if (key === 'demand') setDemandOrigin('Customer-provided representative annual demand') }}/></label>
  const calculate = () => {
    try {
      const n = (key: keyof Fields) => numeric(fields[key], key)
      const calculated = calculateSolar({ panelKw: n('kw'), installedCost: n('cost'), annualDemand: n('demand'), location,
        generationOverride: fields.generation.trim() ? n('generation') : null, selfUse,
        importRate: centsToNzd(n('importCents')), solarImportRate: centsToNzd(n('solarImportCents')), exportRate: centsToNzd(n('exportCents')),
        baselineDaily: n('daily'), solarDaily: n('solarDaily'), baselineCredit: n('credit'), solarCredit: n('solarCredit'), operatingCost: solarConfig.annualMaintenanceAllowance })
      setContext({ customerId, result: calculated, tariffLabel: flat ? `${selectedPlan.name} demonstration catalog, editable rates` : `${selectedPlan.name}: example flat-rate calculation, not an account-specific forecast`,
        origins: { demand: demandOrigin, location: locationOrigin, capacityAndPrice: mode === 'example' ? 'S1 national example including standard installation and GST' : 'Customer quote including GST', generation: fields.generation.trim() ? 'Installer estimate; overrides city generation' : 'S2 city-site model', selfUse: 'Product assumption, not a researched average', importRate: 'Editable annual scenario; catalog rate for Anytime only', exportRate: 'Editable Kea example, not a commercial offer', chargesAndCredits: 'Catalog daily charge initially; user must confirm fees, credit eligibility and expiry' } })
      setStale(false); setError('')
      requestAnimationFrame(() => { resultsRef.current?.focus({ preventScroll: true }); resultsRef.current?.scrollIntoView({ block: 'start' }) })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check your inputs.'); setStale(true) }
  }
  return <div className="solar-page">
    {/* "Back to plans" sits at the right of the heading, where Plans has its "Ask Sparky"
        button and in the same style. It is its own bar rather than part of the heading so
        that, on a wide screen, it stays in view with the results card under it while the
        form scrolls (see .solar-back-bar). */}
    <div className="solar-back-bar"><Link className="compare-action solar-back" to="/plans"><ArrowLeft aria-hidden="true"/>Back to plans</Link></div>
    <div className="page-heading solar-heading">
      <div><h1>Explore solar savings</h1><p className="solar-description">See how rooftop solar could affect your bill, based on your usage and your home.</p></div>
    </div>
    <div className="solar-grid">
      <form className="card solar-inputs" onSubmit={event => { event.preventDefault(); calculate() }}>
        <h2><Sun/>Your solar scenario</h2>
        <fieldset><legend>How would you like to explore?</legend><div className="solar-choice">{[['example', 'Explore an example system'], ['quote', 'Enter my solar quote']].map(([value, label]) => <Choice key={value} name="solar-mode" checked={mode === value} onChange={() => { setMode(value!); if (value === 'example') setFields(prev => ({ ...prev, kw: '5', cost: '11500' })); changed() }}>{label}</Choice>)}</div></fieldset>
        {mode === 'example' ? <><fieldset><legend>Example system</legend><div className="solar-choice">{solarConfig.systems.map(system => <Choice key={system.kw} name="solar-system" checked={fields.kw === String(system.kw)} onChange={() => { setFields(prev => ({ ...prev, kw: String(system.kw), cost: String(system.cost) })); changed() }}>{system.kw} kW DC — {money(system.cost)}</Choice>)}</div></fieldset><p className="solar-help">Indicative national costs, including standard installation and GST. Not supplier offers; extra roof or electrical work may cost more.</p></> : <><div className="solar-pair">{field('kw', 'Panel capacity (kW DC)')}{field('cost', 'Total installed price (NZD, incl. GST)')}</div><p className="solar-help">Confirm your quote includes all installation work. GST is already included.</p></>}
        <fieldset><legend>Reference location</legend><div className="solar-choice">{[...Object.keys(solarConfig.locations), 'Other location'].map(city => <Choice key={city} name="solar-location" checked={location === city} onChange={() => { setLocation(city); setLocationOrigin('Customer-selected reference location'); changed() }}>{city}</Choice>)}</div></fieldset>
        <p className="solar-help">These represent example city conditions. Modelled generation assumes a north-facing, 30-degree roof and equal panel DC / inverter AC capacity (loading ratio 1.0). Shading and roof suitability need an installer assessment.</p>
        {field('generation', `Installer annual generation (kWh${location === 'Other location' ? ', required' : ', optional'})`, location !== 'Other location')}
        <p className="solar-help">An installer estimate replaces modelled generation; no location factor or extra efficiency deduction is applied.</p>
        <h3>Electricity you use</h3><p className="solar-help">{accountNote} {profileNote}</p>
        {field('demand', 'Annual household demand (kWh)')}
        {accountDemand !== null && Number(fields.demand) !== accountDemand && <button type="button" className="solar-text-button" onClick={() => { update('demand', String(Math.round(accountDemand * 10) / 10)); setDemandOrigin('Restored from this account’s usage history') }}>Restore account demand: {energy(accountDemand)}/year</button>}
        <p className="solar-help">We use your 365-day electricity history when available. Otherwise, we estimate annual use from your available daily usage. A shorter history may miss seasonal changes. {demandOrigin}</p>
        <fieldset><legend>Solar self-use assumption</legend><p className="solar-help">Solar self-use is the share of generated electricity you use directly at home.</p><div className="solar-choice">{solarConfig.scenarios.map(item => <Choice key={item.label} name="self-use" checked={selfUse === item.fraction} onChange={() => { setSelfUse(item.fraction); changed() }}>{item.label} {item.fraction * 100}%</Choice>)}</div><p className="solar-help">Scenarios, not researched averages or occupancy predictions. Annual matching cannot establish when electricity is consumed.</p></fieldset>
        <h3>Rates and running costs</h3>
        <p className="solar-callout">{flat ? `${selectedPlan.name}: using its demonstration marginal energy rate, not total bill divided by usage.` : `${selectedPlan.name} needs interval pricing. This is an example flat-rate calculation, not your account-specific bill forecast; it does not price free weekend hours or time-of-use bands.`}</p>
        <div className="solar-pair">{field('importCents', 'Import rate before solar (c/kWh)')}{field('solarImportCents', 'Import rate after solar (c/kWh)')}</div>
        {field('exportCents', 'Kea example export rate (c/kWh)')}<p className="solar-help">Default 15c/kWh ($0.15): a prototype assumption, not a confirmed Kea offer. No GST is added to export payments for non-GST-registered households.</p>
        <details><summary>Daily charges and eligible credits<ChevronDown aria-hidden="true"/></summary><p className="solar-help">Fixed charges continue after solar. Enter only credits you remain eligible for during this 365-day scenario, accounting for their expiry. Credits default to zero because eligibility and remaining term are not verified. Do not include export credits here.</p><div className="solar-pair">{field('daily', 'Daily charge before (NZD)')}{field('solarDaily', 'Daily charge after (NZD)')}{field('credit', 'Eligible annual credits before (NZD)')}{field('solarCredit', 'Eligible annual credits after (NZD)')}</div></details>

        <p className="solar-help solar-maintenance-note">Includes an assumed {money(solarConfig.annualMaintenanceAllowance)} per year for maintenance and replacements.</p>
        {error && <p role="alert" className="solar-error">{error}</p>}
        <button className="primary-action" type="submit">Calculate solar savings</button>
      </form>
      <section ref={resultsRef} tabIndex={-1} className="card solar-results" aria-label="Solar calculation results" aria-live="polite">
        <span className="solar-badge">Based on assumed solar self-use</span>
        <h2>Your estimated savings</h2>
        {!result ? <div className="solar-hero solar-hero-empty"><SolarSunArt/><p>Choose your inputs and calculate to see annual savings and simple payback.</p></div> : stale ? <div className="solar-callout" role="status"><h3>Results are outdated</h3><p>Your inputs changed. Recalculate to see updated figures or ask Sparky AI about them.</p></div> : <>
          <p className="solar-help">{context.tariffLabel}. {context.origins.demand}.</p>
          <div className="solar-hero"><SolarSunArt/><span>Estimated annual net savings</span><strong>{result.display.netBenefit}</strong><span>After {money(result.input.operatingCost)}/year maintenance and replacement allowance</span></div>
          <dl className="solar-stats"><div><dt>Estimated simple payback</dt><dd>{result.display.payback}</dd></div><div><dt>Upfront system cost</dt><dd>{result.display.upfront}</dd></div><div><dt>Annual bill savings before maintenance</dt><dd>{result.display.saving}</dd></div><div><dt>Annual solar generation</dt><dd>{energy(result.raw.generation)}</dd></div><div><dt>Solar used at home</dt><dd>{energy(result.raw.selfUsed)}</dd></div><div><dt>Solar exported</dt><dd>{energy(result.raw.exported)}</dd></div><div><dt>Remaining grid imports</dt><dd>{energy(result.raw.gridImports)}</dd></div></dl>
          <h3>Annual bill comparison</h3><p className="solar-help">Scenario bills, not verified account forecasts. Import charges include GST.</p>
          {[['Before solar', result.raw.baselineBill], ['After solar', result.raw.solarBill]].map(([label, amount]) => <div className="solar-bar-row" key={label}><span>{label}</span><strong>{money(Number(amount))}</strong><div className="solar-bar-track"><div style={{ width: `${Math.abs(Number(amount)) / Math.max(Math.abs(result.raw.baselineBill), Math.abs(result.raw.solarBill), 1) * 100}%` }}/></div></div>)}
          {result.raw.solarBill < 0 && <p className="solar-help">A negative bill is net credit under these assumptions, subject to retailer settlement terms—not an automatic cash payout.</p>}
          {result.raw.selfUsed === result.input.annualDemand && <p className="solar-help">Self-use is capped by annual demand. This does not prove that demand and generation coincide.</p>}
          <button className="primary-action" onClick={() => navigate('/assistant', { state: { solarContext: context } })}><SparkyIcon aria-hidden="true"/>Ask Sparky about these results</button>
          <details><summary>How we calculated this<ChevronDown aria-hidden="true"/></summary><p className="solar-help">{result.modelVersion} · reference checked {solarConfig.referenceDate}. Figures are rounded for display; calculations retain full precision.</p><dl className="solar-stats">{Object.entries(result.input).map(([key, value]) => <div key={key}><dt>{inputLabels[key]}</dt><dd>{key === 'selfUse' ? Number(value) * 100 + '%' : value ?? 'Not supplied'}</dd></div>)}</dl><h3>Input origins</h3><ul>{Object.entries(context.origins).map(([key, value]) => <li key={key}>{key}: {value}</li>)}</ul><p>Self-used solar = smaller of generation × self-use assumption and annual demand. Export = generation − self-use. Grid imports = demand − self-use.</p><p>Each bill = imports × its import rate + 365 × its daily charge − eligible annual credits. The solar bill also subtracts export value once. Bill saving = before − after. Annual net savings = bill saving − maintenance and replacement allowance. Simple payback = installed cost ÷ positive annual net savings.</p><p>Export credit: {money(result.raw.exportCredit)}. Avoided purchases at the original import rate: {money(result.raw.avoidedImportValue)}. Any change in the remaining import rate is separately reflected in the two bills.</p><ul>{solarConfig.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.id}: {source.title}</a> — {source.date}</li>)}</ul></details>
        </>}
        <p className="solar-callout"><Info aria-hidden="true"/>These are indicative estimates, not an installation quote or guaranteed return. Roof suitability requires an installer assessment.</p>
        <p className="solar-help">For non-GST-registered households. Excludes batteries, EV modelling, financing, future tariff changes and degradation. Maintenance and replacements are covered only by the assumed annual allowance; individual replacement events are not modelled. No lifetime profit or optimal system size is calculated. The 25-year display horizon is not a warranty or a validated lifetime forecast.</p>
      </section>
    </div>
  </div>
}
