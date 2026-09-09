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

/**
 * One figure computed by the analytics. Still on `/bill-shock`, which is proactive and
 * therefore still fact-shaped — nobody asks a question to receive a warning.
 *
 * `display` is the string to compare screen text against; `value` is a float and `2.72`
 * never appears on screen.
 */
export interface Fact {
  key: string
  value: number
  unit: string
  label: string
  display: string
}

/**
 * One lookup the assistant made.
 *
 * This replaced `facts` and the verification verdict on the chat response (ADR-0011).
 * Both described what the backend had decided to compute *before* the model saw the
 * question — the same list for everyone who tripped the same keyword — so neither could
 * say what a particular answer rested on. This can.
 */
export interface SourceRef {
  tool: string
  arguments: Record<string, unknown> | null
  source: string | null
  /** False when the lookup failed or this account has no such data. A declared gap. */
  ok: boolean
}

export interface ChatResponse {
  customer_id: string
  text: string
  sources: SourceRef[]
  escalate_to_human: boolean
  escalation_reason: string | null
  conversation_id: number | null
  latency_ms: number
  /** 1 autonomous · 2 monitored · 3 human only. See `services/api/app/hardship/`. */
  tier: number
  tier_reason: string | null
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

// ── The assistant ──────────────────────────────────────────────────────────────────
//
// ## The one rule that makes every assertion below sound
//
// **The DATA is deterministic; the answer is not.** The tools are pure reads over the
// same rows every time, and the model that turns them into prose is not seeded.
//
// This used to be phrased as "`facts` are deterministic" and compared the screen against
// the `facts` of a separate call. There are no `facts` on the chat response now, so the
// deterministic thing to compare against is the data the tools serve —
// `/api/households/{id}` and `/api/households/{id}/bill-shock` read the same rows the
// assistant does.
//
// The rule itself is unchanged and still the important one: a test may compare the screen
// against DATA, and must never compare it against the `text` of a second generation.
// Asserting two generations match is asserting the model is deterministic, and the test
// would fail on a correct application roughly whenever it felt like it.
//
// When a test needs what backed the answer ON SCREEN — not an equivalent one — it reads
// the page's own `done` event off the network. `AssistantPage.ask()` does that.

/**
 * Ask the assistant, through the same endpoint the page uses for its non-streaming path.
 *
 * `conversation_id` threads the conversation. The finding this comment used to record —
 * that it reached the recorder and nowhere else — is fixed: history now reaches the model,
 * so a follow-up resolves against the turn before it. Send back what the previous response
 * returned.
 */
export async function chat(
  request: APIRequestContext,
  body: { customer_id: string; message: string; conversation_id?: number | null },
): Promise<ChatResponse> {
  const response = await request.post('/api/chat', { data: body, timeout: 120_000 })
  if (!response.ok()) {
    throw new Error(`POST /api/chat → ${response.status()} ${response.statusText()}`)
  }
  return (await response.json()) as ChatResponse
}

/**
 * Every numeric claim in a piece of prose, as the digits alone.
 *
 * Ported from `_TOKEN` in `verification/number_checker.py` rather than invented here —
 * a looser pattern of my own found `"$131,"` in "…was $131, for a total of…", which is
 * the sentence comma, not part of the figure. Thousands separators are only accepted
 * inside a well-formed group (`1,234`), exactly as the checker accepts them.
 *
 * Two of the checker's exclusions come with it, because without them every answer
 * reports figures it never claimed:
 *
 * - **Bare integers ≤ 12** are prose structure, not claims (`STRUCTURAL_INT_MAX`). The
 *   checker's rule; "day 7" is not a number the model could have invented into existence.
 * - **Bare four-digit years.** "June 2024" is the period label and appears in every
 *   answer.
 *
 * The `$`, `%` and `kWh` markers are stripped rather than kept. Keeping them would be a
 * stricter test, and it would also fail on `$131` against a fact whose display is `$131`
 * only when the model writes `131 dollars` — a wording difference, which §5 says is not
 * ours to assert on. The digits are the part that can be fabricated.
 */
export function numericTokens(text: string): string[] {
  const token = /(\$)?(\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+)\s*(%|×|x\b|kWh|kwh|KWH)?/g
  const out: string[] = []
  for (const match of text.matchAll(token)) {
    const [, currency, number, unit] = match
    const digits = number!.replace(/,/g, '')
    if (!currency && !unit) {
      if (/^(19|20)\d{2}$/.test(digits)) continue
      if (!digits.includes('.') && Number(digits) <= 12) continue
    }
    out.push(digits)
  }
  return out
}

/** A fact's `display` reduced to its digits, so it can be compared with `numericTokens`.
 *  `$294 a year` → `294`; `2.7 kWh a day` → `2.7`. */
export function displayDigits(display: string): string[] {
  return (display.match(/\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+/g) ?? []).map((d) => d.replace(/,/g, ''))
}

/**
 * The test that replaced `isSafeToDisplay`.
 *
 * There is no verification verdict any more, and the reason is worth keeping in the
 * suite: the number-checker matched figures against a permitted list, which was a strong
 * guarantee about *fabrication* and said nothing about whether a figure meant anything.
 * Stephen's own #141 §4 is the sharpest statement of that — Julia got "a steady 0.0 kWh a
 * day ... costs $0.00" with a badge reading "every figure checked", and every figure in it
 * WAS checked.
 *
 * What is assertable now is provenance: an answer is trustworthy when it consulted this
 * household's data and says which lookups it used. An answer with **no** successful
 * lookup is the one state that is not safe — that is prose written from the system prompt
 * with nothing behind it, and it is the shape a confident, fluent, entirely unfounded
 * answer takes.
 */
export function isGrounded(response: Pick<ChatResponse, 'sources'>): boolean {
  return response.sources.some((source) => source.ok)
}

/** Lookups that found nothing. A declared gap, not a failure — the assistant is required
 *  to say so rather than fill it, so a test may assert on the saying. */
export function declaredGaps(response: Pick<ChatResponse, 'sources'>): string[] {
  return response.sources.filter((source) => !source.ok).map((source) => source.tool)
}
