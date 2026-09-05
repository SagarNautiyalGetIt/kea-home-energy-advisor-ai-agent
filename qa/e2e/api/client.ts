import type { APIRequestContext } from '@playwright/test'

/**
 * The eight endpoints, typed.
 *
 * `contracts/openapi.json` is the interface between the services — neither imports the
 * other's source — which makes it the right place to hang expectations. These shapes are
 * transcribed from it; when an endpoint changes, the `contract is up to date` CI job
 * fails first and this file is the second thing to update.
 *
 * Everything goes through Playwright's `request` fixture rather than `fetch`, so calls
 * share the config's `baseURL` and appear in the trace next to the page actions that
 * they are being compared against. Vite proxies `/api` to :8000, so one origin reaches
 * both the UI and the API.
 */

export interface HouseholdSummary {
  customer_id: string
  label: string
  period: string
  daily_kwh: number[]
  total_kwh: number
  estimated_cost_nzd: number
}

export interface BillShockWarning {
  customer_id: string
  period: string
  triggered: boolean
  reasons: string[]
  days_elapsed: number
  days_in_cycle: number
  days_remaining: number
  usage_so_far_kwh: number
  cost_so_far_nzd: number
  projected_cycle_cost_nzd: number
  expected_cost_nzd: number
  expectation_basis: string
  overshoot_nzd: number
  overshoot_pct: number
  recent_trend_pct: number
  facts: string[]
  caveats: string[]
}

export interface DemoAccountCard {
  email: string
  password: string
  customer_id: string
  display_name: string
  scenario: string
}

async function json<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  if (!response.ok()) {
    throw new Error(`GET ${path} → ${response.status()} ${response.statusText()}`)
  }
  return (await response.json()) as T
}

/**
 * The fourteen sign-ins, with their passwords.
 *
 * Returns 503 when `KEA_DEMO_LOGINS` is unset — that is the single most common reason a
 * whole suite fails at sign-in, and it is a configuration problem, not a test one.
 */
export const getDemoAccounts = (request: APIRequestContext) =>
  json<DemoAccountCard[]>(request, '/api/auth/demo-accounts')

export const getHouseholds = (request: APIRequestContext) =>
  json<HouseholdSummary[]>(request, '/api/households')

/** `customerId` is the ACCOUNT NUMBER — `DEMO-ACCT-223001`, not an email. */
export const getHousehold = (request: APIRequestContext, customerId: string) =>
  json<HouseholdSummary>(request, `/api/households/${customerId}`)

export const getBillShock = (request: APIRequestContext, customerId: string) =>
  json<BillShockWarning>(request, `/api/households/${customerId}/bill-shock`)

/**
 * Reproduces `DashboardPage.tsx`'s truncation: the daily series is cut to the point in
 * the cycle the warning was assessed at, so a full-month usage total never appears beside
 * a six-day cost. "Latest day" means the last day of that truncated series, not the last
 * day the meter reported.
 */
export function latestDayKwh(household: HouseholdSummary, shock: BillShockWarning): number | undefined {
  const daily = household.daily_kwh.slice(0, shock.days_elapsed)
  return daily.length ? daily[daily.length - 1] : undefined
}

/**
 * The seven points the weekly card plots: the last seven days of the truncated series.
 *
 * Mirrors `DashboardPage.tsx` — `daily.slice(-7)` where `daily` is already cut to
 * `days_elapsed`. Every demo account is at least ten days into its cycle, so this always
 * returns seven, but the slice is written defensively rather than assuming that.
 */
export function lastSevenDays(household: HouseholdSummary, shock: BillShockWarning): number[] {
  return household.daily_kwh.slice(0, shock.days_elapsed).slice(-7)
}
