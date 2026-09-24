import assert from 'node:assert/strict'
import test from 'node:test'
import { energyBreakdownPresentation, unavailableBreakdownMessage } from '../src/lib/energyBreakdownPresentation.ts'

const unavailable = {
  customer_id: 'REAL-ACCOUNT',
  available: false,
  reason: 'This account has no half-hourly data. Say which parts you cannot separate and why.',
  period: '',
  days: 0,
  total_kwh: 0,
  total_cost_nzd: 0,
  categories: [],
  caveats: [],
  heating_fit_r_squared: null,
  heating_not_reported_because: null,
  always_on_not_reported_because: 'This account has no half-hourly data.',
}

test('Tama’s unavailable preview restores the original two-category design, explicitly as an example', () => {
  const { data, isDemo } = energyBreakdownPresentation('DEMO-ACCT-223001', unavailable)
  assert.equal(isDemo, true)
  assert.equal(data?.period, 'June 2024')
  assert.equal(data?.days, 30)
  assert.equal(data?.total_kwh.toFixed(0), '447')
  assert.deepEqual(data?.categories.map((category) => [category.key, category.cost_nzd, category.share_pct, category.kwh.toFixed(0)]), [
    ['always_on', 69.26, 42.4, '190'],
    ['everything_else', 93.91, 57.6, '257'],
  ])
  assert.equal(data?.categories.reduce((sum, category) => sum + category.kwh, 0), data?.total_kwh)
})

test('available API data takes precedence over the saved demo example', () => {
  const available = { ...unavailable, customer_id: 'DEMO-ACCT-223001', available: true, total_kwh: 123 }
  assert.deepEqual(energyBreakdownPresentation(available.customer_id, available), { data: available, isDemo: false })
})

test('only the exact synthetic preview identity can use the example, including when the API is offline', () => {
  assert.equal(energyBreakdownPresentation('DEMO-ACCT-223001', null).isDemo, true)
  for (const account of ['REAL-ACCOUNT', 'DEMO-ACCT-222001', 'H-JUL']) {
    assert.deepEqual(energyBreakdownPresentation(account, unavailable), { data: unavailable, isDemo: false })
    assert.deepEqual(energyBreakdownPresentation(account, null), { data: null, isDemo: false })
  }
})

test('unavailable copy explains missing readings without leaking analytics instructions', () => {
  const message = unavailableBreakdownMessage(unavailable)
  assert.match(message, /Half-hourly meter readings are needed/)
  assert.doesNotMatch(message, /Say which parts|negative|kWh\/HDD/)
  assert.match(unavailableBreakdownMessage({ ...unavailable, reason: null, always_on_not_reported_because: null }), /isn’t enough meter and weather data/)
})
