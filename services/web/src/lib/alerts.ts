/**
 * Bill-shock alert preferences, and the on-device model catalogue.
 *
 * The customer sets the percentages. They do not set the confidence floors — how certain
 * the forecast has to be before we escalate is an engineering property of the model, not
 * a taste, and exposing it would let somebody configure "ring me at 90% over, 10%
 * confidence" and then be rung on day three about a bill that never arrives. The
 * resulting distrust would land on the product, not on their setting. See
 * `services/api/app/alerts/preferences.py`.
 *
 * Everything here mirrors a Pydantic model on the server, which is where validation
 * actually happens. The client-side checks below are for the *message*, not the
 * guarantee: a 422 is a correct outcome, it is just a worse one to read.
 */

export type Tier = 1 | 2 | 3

export interface AlertPreferences {
  account_ref: string
  enabled: boolean
  /** Percent over expectation at which an email goes out. */
  tier1_pct: number
  /** …a text message. */
  tier2_pct: number
  /** …the assistant calls them. */
  tier3_pct: number
  /** Dollar floor under every tier. 20% over on a $40 cycle is $8, which nobody wants a
   *  text about. */
  min_overshoot_nzd: number
  email_enabled: boolean
  sms_enabled: boolean
  /** Opt-IN, unlike the other two. An automated call is the most intrusive thing this
   *  product can do and the one most easily mistaken for a scam. */
  voice_enabled: boolean
  email: string | null
  phone_e164: string | null
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  timezone: string
  offline_model_opt_in: boolean
}

export interface OfflineModelOption {
  id: string
  label: string
  /** The quantised download, not the parameter count — it is the number the customer is
   *  agreeing to spend. */
  download_mb: number
  ram_required_mb: number
  quantisation: string
  languages: string[]
  notes: string | null
}

export const MIN_THRESHOLD_PCT = 5
export const MAX_THRESHOLD_PCT = 200

/**
 * The threshold each channel offers, as a short list rather than a continuous range.
 *
 * These replaced a 5-200% slider. A slider implies the exact number matters and invites
 * the customer to land on 37%, which is a false precision: the thing being compared
 * against is a forecast with its own interval, so 35 and 40 are not distinguishable
 * claims. Four labelled steps say what the control actually decides — roughly how early
 * do you want to hear — and are a far better target on a phone than a 22px handle.
 *
 * The bands overlap at their edges on purpose. `ladderError` requires the tiers not to
 * *decrease*, not to differ, so a customer can put the text and the call both at 70% and
 * get both at once. Forbidding that would be a rule the product does not actually have.
 */
export const TIER_OPTIONS: Record<Tier, readonly number[]> = {
  1: [10, 20, 30, 40],
  2: [40, 50, 60, 70],
  3: [70, 80, 90, 100],
}

export const CHANNEL_LABEL: Record<Tier, string> = {
  1: 'Email',
  2: 'Text message',
  3: 'A call from Sparky',
}

/**
 * The ladder must increase. Returned as a message rather than a boolean so the form can
 * say which pair is wrong — "thresholds must increase" is true and unhelpful when three
 * sliders are on screen.
 */
export function ladderError(prefs: AlertPreferences): string | null {
  if (prefs.tier1_pct > prefs.tier2_pct) {
    return 'Text messages cannot start before emails do.'
  }
  if (prefs.tier2_pct > prefs.tier3_pct) {
    return 'Calls cannot start before text messages do.'
  }
  return null
}

/**
 * Keep the ladder ordered while a slider is being dragged.
 *
 * Pushes the neighbours rather than clamping the slider the customer is holding. Clamping
 * makes a slider feel broken — you drag it and it refuses to move, with the explanation
 * on a different row. Pushing does what the gesture asks and keeps the ladder valid, and
 * the customer can see the other handles move.
 */
export function withThreshold(prefs: AlertPreferences, tier: Tier, value: number): AlertPreferences {
  const clamped = Math.min(MAX_THRESHOLD_PCT, Math.max(MIN_THRESHOLD_PCT, Math.round(value)))
  const next = { ...prefs }
  if (tier === 1) {
    next.tier1_pct = clamped
    next.tier2_pct = Math.max(next.tier2_pct, clamped)
    next.tier3_pct = Math.max(next.tier3_pct, next.tier2_pct)
  } else if (tier === 2) {
    next.tier2_pct = clamped
    next.tier1_pct = Math.min(next.tier1_pct, clamped)
    next.tier3_pct = Math.max(next.tier3_pct, clamped)
  } else {
    next.tier3_pct = clamped
    next.tier2_pct = Math.min(next.tier2_pct, clamped)
    next.tier1_pct = Math.min(next.tier1_pct, next.tier2_pct)
  }
  return next
}

/**
 * What a threshold means in money, for a customer who has one cycle of history.
 *
 * Shown next to the percentage because a percentage is not what anybody budgets in. 71.4%
 * of surveyed customers asked for the warning in dollars, and the same reasoning applies
 * to the setting that produces it.
 *
 * Returns null when there is no expectation to apply it to — an estimate built on a
 * missing baseline would be a fabricated figure on a settings screen, which is the same
 * offence as one in an answer.
 */
export function thresholdInDollars(pct: number, expectedCostNzd: number | null): number | null {
  if (expectedCostNzd === null || !Number.isFinite(expectedCostNzd) || expectedCostNzd <= 0) {
    return null
  }
  return Math.round(expectedCostNzd * (1 + pct / 100))
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    // FastAPI puts the readable reason in `detail`; a 422 from the ladder validator is
    // the case worth surfacing verbatim rather than as "422 Unprocessable Entity".
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

export const getAlertPreferences = (customerId: string) =>
  json<AlertPreferences>(`/api/households/${encodeURIComponent(customerId)}/alert-preferences`)

export const saveAlertPreferences = (customerId: string, prefs: AlertPreferences) =>
  json<AlertPreferences>(`/api/households/${encodeURIComponent(customerId)}/alert-preferences`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...prefs, account_ref: customerId }),
  })

export const getOfflineModels = () => json<OfflineModelOption[]>('/api/offline/models')

export const formatMb = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`

/**
 * Where the sign-up answer is parked until there is an account to attach it to.
 *
 * Sign-up in this prototype does not create a customer — there is no `customer_id` yet,
 * so `PUT /alert-preferences` has nothing to key on. Recording the answer locally and
 * writing it through on first sign-in keeps the question at the moment it makes sense to
 * ask, without inventing an account id to hang it from.
 *
 * `null` means the question has not been asked, which is different from "asked and
 * declined": one warrants asking, the other must not re-prompt. A boolean alone cannot
 * carry that distinction, which is why this returns three states.
 */
const OFFLINE_OPT_IN_KEY = 'kea-offline-model-opt-in'

export const rememberOfflineOptIn = (optIn: boolean): void => {
  localStorage.setItem(OFFLINE_OPT_IN_KEY, String(optIn))
}

export const pendingOfflineOptIn = (): boolean | null => {
  const raw = localStorage.getItem(OFFLINE_OPT_IN_KEY)
  return raw === null ? null : raw === 'true'
}
