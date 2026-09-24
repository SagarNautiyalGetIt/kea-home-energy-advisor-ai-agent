import type { EnergyBreakdown } from './client'

/**
 * The original Usage design's two-category example. Tama is a synthetic account
 * declared in services/api/app/auth.py. This fixture keeps its preview useful when
 * the local seed has no interval data; it is never a replacement for a real reading.
 * The displayed values are preserved from the supplied June 2024 design reference.
 */
const TAMA_PREVIEW: EnergyBreakdown = {
  customer_id: 'DEMO-ACCT-223001',
  available: true,
  reason: null,
  period: 'June 2024',
  days: 30,
  total_kwh: 447.3,
  total_cost_nzd: 163.17,
  categories: [
    {
      key: 'always_on',
      label: 'the always-on background load',
      kwh: 189.82,
      cost_nzd: 69.26,
      share_pct: 42.4,
      confidence: 'measured',
      basis: 'In this demo example, the overnight baseline represents the electricity used continuously through the month.',
      caveat: 'This is a saved demonstration, not a current meter reading.',
    },
    {
      key: 'everything_else',
      label: 'everything else',
      kwh: 257.48,
      cost_nzd: 93.91,
      share_pct: 57.6,
      confidence: 'residual',
      basis: 'The example’s total electricity use minus its always-on background load.',
      caveat: 'A whole-house meter cannot identify individual appliances within this remainder.',
    },
  ],
  caveats: ['This example groups all other use together; heating and individual appliances are not shown separately.'],
  heating_fit_r_squared: null,
  heating_not_reported_because: null,
  always_on_not_reported_because: null,
}

export function energyBreakdownPresentation(customerId: string, response: EnergyBreakdown | null) {
  if (response?.available) return { data: response, isDemo: false }
  if (customerId === TAMA_PREVIEW.customer_id) return { data: TAMA_PREVIEW, isDemo: true }
  return { data: response, isDemo: false }
}

/** Analytics reasons also contain guidance for Sparky, which is not customer copy. */
export function unavailableBreakdownMessage(data: EnergyBreakdown): string {
  const reason = `${data.always_on_not_reported_because ?? ''} ${data.reason ?? ''}`
  if (/no half-hourly|without half-hourly/i.test(reason)) {
    return 'Half-hourly meter readings are needed to separate your always-on background load from the rest of your electricity use. You can still see your daily usage in the chart above.'
  }
  return 'There isn’t enough meter and weather data to reliably separate your electricity use into categories yet. You can still see your usage patterns in the chart above.'
}
