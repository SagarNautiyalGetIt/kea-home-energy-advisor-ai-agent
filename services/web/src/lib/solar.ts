/** Annual scenario model; see the supplied Kea solar reference, 14 September 2026. */
export const solarConfig = {
  version: 'annual-solar-v1', referenceDate: '2026-09-14', days: 365, horizon: 25,
  locations: { Auckland: 1322.76, Wellington: 1296.48, Christchurch: 1296.48, Queenstown: 1436.64 },
  systems: [{ kw: 3, cost: 8500 }, { kw: 5, cost: 11500 }, { kw: 10, cost: 20000 }],
  scenarios: [{ label: 'Lower', fraction: 0.3 }, { label: 'Middle', fraction: 0.5 }, { label: 'Higher', fraction: 0.7 }],
  exportRate: 0.15, exampleImportRate: 0.30, exampleDemand: 7000,
  annualMaintenanceAllowance: 100, // NZD/year: product assumption, not a verified NZ average.
  sources: [
    { id: 'S1', title: 'EECA — Solar costs and savings', date: 'Accessed 14 September 2026', url: 'https://www.eeca.govt.nz/for-homes/solar-for-homes/solar-costs-and-savings/' },
    { id: 'S2', title: 'EECA — Appendix Seven, Table 1(b), page 6', date: '31 January 2025', url: 'https://www.eeca.govt.nz/assets/EECA-Resources/Research-papers-guides/Appendix-Seven-Solar-PV-data-and-performance.pdf' },
    { id: 'S3', title: 'Meridian — Plans and pricing (export context only)', date: 'Accessed 14 September 2026', url: 'https://www.meridianenergy.co.nz/for-home/pricing-rates' },
    { id: 'S4', title: 'EECA — Detailed solar calculator', date: 'Reference for future comparison; not our model', url: 'https://www.eeca.govt.nz/for-homes/solar-for-homes/solar-power-calculator/' },
    { id: 'S5', title: 'EECA — Planning the right home solar system', date: 'Accessed 22 September 2026', url: 'https://www.eeca.govt.nz/for-homes/solar-for-homes/plan-your-solar-system/' },
  ],
} as const

export type SolarInput = {
  panelKw: number; installedCost: number; annualDemand: number; location: string;
  generationOverride: number | null; selfUse: number; importRate: number; solarImportRate: number;
  exportRate: number; baselineDaily: number; solarDaily: number;
  baselineCredit: number; solarCredit: number; operatingCost: number;
}
export const money = (value: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 2 }).format(value)
export const energy = (value: number) => `${new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 0 }).format(value)} kWh`
export function numeric(value: string, label: string): number {
  if (!value.trim()) throw new Error(`${label} is required.`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`)
  return number
}
export function centsToNzd(cents: number): number {
  if (!Number.isFinite(cents) || cents < 0) throw new Error('Invalid cents per kWh.')
  return cents / 100
}

export function calculateSolar(input: SolarInput) {
  for (const [key, value] of Object.entries(input)) {
    if (key === 'location' || key === 'generationOverride') continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${key} must be a finite, non-negative number.`)
  }
  if (!(input.panelKw > 0) || !(input.installedCost > 0)) throw new Error('Panel capacity and installed price must be greater than zero.')
  if (input.selfUse > 1) throw new Error('Solar self-use must be between 0% and 100%.')
  const yieldPerKw = solarConfig.locations[input.location as keyof typeof solarConfig.locations]
  if (input.generationOverride !== null && (!Number.isFinite(input.generationOverride) || input.generationOverride <= 0)) throw new Error('Installer annual generation must be greater than zero.')
  if (input.generationOverride === null && !yieldPerKw) throw new Error('Other location requires installer-estimated annual generation.')
  const generation = input.generationOverride ?? input.panelKw * yieldPerKw!
  const selfUsed = Math.min(generation * input.selfUse, input.annualDemand)
  const exported = generation - selfUsed
  const gridImports = input.annualDemand - selfUsed
  const avoidedImportValue = selfUsed * input.importRate
  const exportCredit = exported * input.exportRate
  const baselineBill = input.annualDemand * input.importRate + solarConfig.days * input.baselineDaily - input.baselineCredit
  const solarBill = gridImports * input.solarImportRate + solarConfig.days * input.solarDaily - input.solarCredit - exportCredit
  const saving = baselineBill - solarBill
  const netBenefit = saving - input.operatingCost
  const payback = netBenefit > 0 ? input.installedCost / netBenefit : null
  const status = payback === null ? 'no_payback' : payback > solarConfig.horizon ? 'beyond_horizon' : 'payback'
  const raw = { generation, selfUsed, exported, gridImports, avoidedImportValue, exportCredit, baselineBill, solarBill, saving, netBenefit, payback }
  if (Object.values(raw).some(value => value !== null && !Number.isFinite(value))) throw new Error('Inputs are too large to calculate safely.')
  return {
    input: { ...input }, raw, status, modelVersion: solarConfig.version,
    sourceIds: ['S1', 'S2', 'S3', 'S5'],
    assumptions: ['Based on assumed solar self-use', '365-day reference year', 'Annual matching cannot establish when electricity is consumed', 'North-facing, 30-degree roof; inverter loading ratio 1.0 for modelled generation', `Maintenance and replacements: NZD ${input.operatingCost} annual allowance deducted from bill savings; actual costs and timing vary`, 'No batteries, financing, future tariff changes or degradation; individual replacement events are not modelled'],
    display: { saving: money(saving), upfront: money(input.installedCost), netBenefit: money(netBenefit), generation: energy(generation),
      payback: status === 'no_payback' ? 'No payback under these assumptions.' : status === 'beyond_horizon' ? 'More than 25 years under these assumptions.' : `${payback!.toFixed(1)} years` },
  }
}
export type SolarResult = ReturnType<typeof calculateSolar>
export type SolarContext = { customerId: string; result: SolarResult; origins: Record<string, string>; tariffLabel: string }
export function solarPrompt(context: SolarContext) {
  return `Explain this indicative solar scenario, using only the supplied deterministic results. Do not invent figures, alter inputs, recommend an optimal size, or guarantee returns. This is not account billing history. Explain self-use, export credits and simple payback, not IRR. For any numerical what-if, direct the customer to adjust and recalculate at /solar; there is no solar calculation tool in chat. Do not calculate new numbers.\nSOLAR_RESULT_JSON:\n${JSON.stringify(context)}`
}
