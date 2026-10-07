/**
 * The single place this app talks to the backend.
 *
 * Once you have run `make web-types`, the REST shapes are available as generated
 * types in `../api.d.ts` — prefer those over hand-written interfaces.
 *
 * The SSE event shapes below are the exception, and they are hand-written on
 * purpose: FastAPI's `StreamingResponse` carries no response schema, so
 * `/api/chat/stream` appears in openapi.json with an empty body. These three
 * interfaces ARE the contract for it. If the backend changes an event payload,
 * this file must change in the same PR.
 */

import { loadSession } from './session';
import { sendChatStream } from './chat-stream';

export interface ChatRequest {
  customer_id: string;
  message: string;
  /** Send back whatever the previous `done` returned, to keep the thread together. */
  conversation_id?: number | null;
  /** Bounded completed turns keep follow-ups coherent when persistence is disabled. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * `event: token` — prose as the assistant writes it.
 *
 * Genuinely per-chunk now, not per-sentence. The old endpoint could not stream at
 * all: verification was a whole-text check against a pre-computed fact bundle, so
 * the entire answer had to be generated and checked before the first word could be
 * sent. There is no bundle any more, so there is nothing to withhold.
 */
export interface TokenEvent {
  text: string;
}

/**
 * `event: reset` — discard the text streamed since the last reset.
 *
 * The assistant works in rounds: it may write a line ("Let me pull up your July
 * bill") and then decide it needs a lookup first. That line is a preamble, not the
 * answer. `reset` says the round it belonged to turned out to be a lookup — drop
 * what you rendered and show the tool activity instead.
 *
 * A client that ignores this shows "Let me check that." glued to the front of every
 * reply, which is the one visible symptom of getting this wrong.
 */

/** `event: tool` — a lookup started. Show it; this is the product working. */
export interface ToolEvent {
  name: string;
  arguments: Record<string, unknown>;
}

/** `event: result` — and what it found. */
export interface ToolResultEvent {
  name: string;
  /**
   * False means the lookup failed or this account has no such data. Worth showing
   * rather than hiding: "I couldn't check that" is a different answer from "I didn't
   * look", and only one of them is honest about a gap.
   */
  ok: boolean;
  source: string | null;
}

/** One plotted value. `highlight` marks the point the question was about. */
export interface ChartPoint {
  label: string;
  value: number;
  highlight: boolean;
}

/**
 * `event: chart` — a lookup's own figures, drawn. Optional and at most one per answer.
 *
 * Built server-side from the same result dict that is recorded as evidence, so the
 * chart and the prose beside it are two renderings of one lookup rather than two
 * answers to one question. `source` is that lookup's source and should be shown with
 * the chart for the same reason it is shown under the answer.
 */
export interface ChartEvent {
  kind: "bar" | "line";
  title: string;
  unit: "nzd" | "kwh";
  points: ChartPoint[];
  caveat: string | null;
  source: string | null;
}

/** `event: done` — the answer is complete and the evidence has been written. */
export interface DoneEvent {
  /** Every lookup behind this answer, in the order it was made. */
  sources: SourceRef[];
  escalate_to_human: boolean;
  escalation_reason: string | null;
  conversation_id: number | null;
  latency_ms: number;
  tokens: number;
  /** Shared API handling tier: 3 is a human handover, never model advice. */
  tier: 1 | 2 | 3;
  tier_reason: string | null;
  emotion: string | null;
  emotion_intensity: string | null;
}

/** `event: error` — no answer, and no invented one either. */
export interface ErrorEvent {
  message: string;
  retryable: boolean;
}

/**
 * One lookup the assistant made.
 *
 * This replaced the `facts` array and the verification verdict. Both described what
 * the backend had decided to compute *before* the model saw the question — the same
 * list for every customer who tripped the same keyword — so neither could say what a
 * particular answer was based on. This can.
 */
export interface SourceRef {
  tool: string;
  arguments: Record<string, unknown> | null;
  source: string | null;
  ok: boolean;
}

/** Human-readable labels for the tool names, for the activity line and the panel. */
export const TOOL_LABELS: Record<string, string> = {
  get_usage_history: 'Reading your dated usage and tariff bands',
  get_hourly_usage: 'Checking readings for the selected day',
  get_billing_records: 'Reading your invoice totals',
  get_plan_details: 'Checking plan rates and commitment terms',
  get_alert_status: 'Checking your warning settings and assessment',
  get_power_clash_progress: 'Reading your Power Clash progress',
  get_scheduled_outages: 'Checking the distributor schedule',
  get_account_summary: 'Looking up your account',
  get_daily_usage: 'Reading your daily meter data',
  get_bill_comparison: 'Comparing this bill with your last one',
  get_hourly_profile: 'Checking your usage through the day',
  compare_to_similar_homes: 'Comparing with similar homes',
  get_plan_options: 'Checking your plan against the alternatives',
  project_this_bill: 'Projecting the rest of your cycle',
  get_energy_breakdown: 'Working out where your power went',
  discover_smart_devices: 'Looking for smart devices on your network',
  search_help_topics: 'Checking Kea’s help articles',
  answer_clarifying_question: 'Noting your answer',
  update_alert_settings: 'Updating your alert settings',
  request_plan_change: 'Preparing your plan change',
  handoff_to_human: 'Bringing in a person',
};

export const toolLabel = (name: string): string =>
  TOOL_LABELS[name] ?? name.replace(/_/g, ' ');

export interface Health {
  status: string;
  provider: string;
  model: string;
  model_ready: boolean;
  /**
   * Render the mic button from `voice.ready`, not from the feature flag alone.
   * `enabled` only says someone set KEA_VOICE_ENABLED; `ready` says the binaries and
   * weights are actually on disk. Offering a mic that cannot work is worse than not
   * offering one.
   */
  voice: {
    enabled: boolean;
    ready: boolean;
    stt: { engine: string; model: string | null; available: boolean };
    tts: { engine: string; voice: string | null; sample_rate: number; available: boolean };
  };
}

export interface HouseholdSummary {
  customer_id: string;
  label: string;
  period: string;
  daily_kwh: number[];
  daily_dates?: string[];
  total_kwh: number;
  estimated_cost_nzd: number;
}

/**
 * The signed-in customer's own details.
 *
 * Every field but `customer_id` can be null, and the screen must show "Not on file"
 * rather than filling one in: the seeded households genuinely have no address or plan,
 * and a profile that invents one is showing somebody a fact about themselves that no
 * record holds.
 */
export interface CustomerProfile {
  customer_id: string;
  name: string | null;
  account_number: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  plan_name: string | null;
  user_type: string | null;
  icp_number: string | null;
  network_name: string | null;
}

async function getJSON<T>(path: string): Promise<T> {
  const token = loadSession()?.accessToken;
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const getCustomerProfile = (customerId: string) =>
  getJSON<CustomerProfile>(`/api/households/${encodeURIComponent(customerId)}/profile`);

/** What a model read off a photographed bill. Every money field may be null. */
export interface BillReading {
  is_electricity_bill: boolean;
  retailer: string | null;
  period_start: string | null;
  period_end: string | null;
  days_in_period: number | null;
  total_due_nzd: number | null;
  total_kwh: number | null;
  unit_rate_nzd_per_kwh: number | null;
  daily_charge_nzd: number | null;
  is_gst_inclusive: boolean | null;
  has_time_of_use_rates: boolean | null;
  confidence: "high" | "medium" | "low";
  unreadable_fields: string[];
  notes: string | null;
}

/** What that bill's usage would have cost on Kea, and whether that is a real saving. */
export interface BillComparison {
  comparable: boolean;
  reason: string | null;
  days: number | null;
  their_total_nzd: number | null;
  kea_total_nzd: number | null;
  kea_plan: string | null;
  period_saving_nzd: number | null;
  annual_saving_nzd: number | null;
  material: boolean | null;
  their_effective_rate_nzd: number | null;
  kea_unit_rate_nzd: number | null;
  kea_daily_charge_nzd: number | null;
  term_credit_nzd: number | null;
  term_exit_fee_max_nzd: number | null;
  caveats: string[];
}

export interface BillAnalysis {
  reading: BillReading;
  comparison: BillComparison;
}

/**
 * Send a photographed bill to be read and priced.
 *
 * A 422 is the normal failure here and its `detail` is written to be shown to the
 * customer as-is — wrong file type, too large, page unreadable. Anything else is ours.
 */
export async function analyseBill(file: File, customerId: string): Promise<BillAnalysis> {
  const body = new FormData();
  body.append("file", file);
  body.append("customer_id", customerId);
  const res = await fetch("/api/bills/analyse", { method: "POST", body });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { detail?: string }) => d.detail)
      .catch(() => null);
    throw new Error(detail ?? `Could not read that bill (${res.status}).`);
  }
  return (await res.json()) as BillAnalysis;
}

/**
 * The proactive half of the product.
 *
 * `triggered` is the only field to branch on. The figures are present either way, so a
 * calm "on track" state costs no extra request.
 *
 * **Read `expectation_basis` before writing any comparative copy.** It says what the
 * projection was compared against, and only two of the three values license "more than
 * you usually pay":
 *
 *   comparable_homes           → "more than similar homes". Nothing else. This is what
 *                                the seeded demo households return, because there is no
 *                                billing history behind them — claiming otherwise is the
 *                                exact fabrication the product exists to prevent.
 *   own_recent_cycles          → "more than your recent bills"
 *   own_same_period_last_year  → "more than the same time last year"
 *
 * The backend repeats this in `caveats`, and the narration layer is handed it as a rule
 * it may not break. The UI is the one surface with no such enforcement, so it is on you.
 */
export interface ForecastSummary {
  /** `weather_normalised` | `straight_line`. A figure without its method cannot be
   *  checked; the two disagree by real money on a cold cycle. */
  method: string;
  detail: string | null;
  /** 80% central prediction interval, not 95% — a 95% band on a fortnight of daily
   *  electricity is so wide it communicates nothing. */
  cost_p10_nzd: number;
  cost_p90_nzd: number;
  /** Interval width as a percent of the point estimate. Wide early, narrow late. Show the
   *  range instead of the single figure when this is above about 25%. */
  confidence_width_pct: number;
  base_load_kwh_per_day: number | null;
  heating_kwh_per_hdd: number | null;
  r_squared: number | null;
}

export interface CauseBreakdown {
  /** False means the weather fit was not usable and the whole overshoot is unattributed.
   *  Do not draw a cause chart in that state — a confident breakdown of an unexplained
   *  overshoot is worse than showing none. */
  explained: boolean;
  weather_nzd: number;
  higher_use_nzd: number;
  everyday_load_nzd: number;
  /** `weather` | `behaviour` | `everyday_load`, or null when no single cause reaches 35%.
   *  Null is a real answer, not a missing one. */
  dominant: string | null;
}

/**
 * The disclosure that must appear wherever a comparison does.
 *
 * Driven by `expectation_basis` rather than hard-coded, because the sentence that is
 * true depends on what the projection was actually compared against. The previous
 * version printed "compared with similar homes" unconditionally — correct while only one
 * basis existed, and a false statement the moment billing history lands.
 *
 * The unknown-value branch says the least, not the most. A basis this client does not
 * recognise is a server ahead of it, and inventing a comparison to describe it is the
 * one thing that must not happen on a disclosure line.
 */
export const basisNote = (basis: string): string => {
  switch (basis) {
    case 'own_same_period_last_year':
      return 'Compared with your own bill for the same period last year.';
    case 'own_recent_cycles':
      return 'Compared with your own average across recent billing periods.';
    case 'comparable_homes':
      // Only reached by an account with no completed prior cycle — a first bill, or one
      // of the seeded households, which hold a single month. The wording used to say
      // Kea "does not hold your billing history" as a blanket statement; that was true
      // when nothing populated the own-history branch and is now specific to accounts
      // that genuinely have none.
      return 'Compared with similar homes — there is not yet a full billing period of your own to compare against.';
    default:
      return 'Compared with a reference figure for this cycle.';
  }
};

export interface BillShockWarning {
  customer_id: string;
  period: string;
  triggered: boolean;
  /** `above_expectation` | `colder_than_normal` | `higher_daily_use`. */
  reasons: string[];
  days_elapsed: number;
  days_in_cycle: number;
  days_remaining: number;
  usage_so_far_kwh: number;
  cost_so_far_nzd: number;
  projected_cycle_cost_nzd: number;
  expected_cost_nzd: number;
  expectation_basis: string;
  overshoot_nzd: number;
  overshoot_pct: number;
  /** Opening third of the cycle against the closing third. Shown beside the usage chart.
   *  Deliberately NOT a trigger — a rising trend says the cycle is getting worse, not
   *  that it is already expensive. Computed by layer 1 like every other figure; do not
   *  derive a trend in the browser. */
  recent_trend_pct: number;
  forecast: ForecastSummary;
  causes: CauseBreakdown;
  /** The customer's own thresholds, keyed by tier. Show the warning against the level
   *  they set, not a hard-coded one. */
  thresholds_pct: Record<string, number>;
  tier_probabilities: Record<string, number>;
  facts: { key: string; value: number; unit: string; label: string; display: string }[];
  caveats: string[];
}

export interface LoginResponse {
  customer_id: string;
  display_name: string;
  scenario: string;
  access_token?: string;
}

export interface DemoAccountCard extends LoginResponse {
  email: string;
  password: string;
}

/** Demo sign-in. Throws with the server's message so the form can show it verbatim —
 *  401 "Email or password is incorrect." and 503 "demo logins are disabled" are
 *  different problems and the user should be told which one they have. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((b) => b?.detail as string | undefined)
      .catch(() => undefined);
    throw new Error(detail ?? "Could not sign in. Is the API running?");
  }
  return response.json() as Promise<LoginResponse>;
}

/** Every demo sign-in, passwords included. 503 when KEA_DEMO_LOGINS is off, which the
 *  login page treats as "hide the panel" rather than as an error. */
export const getDemoAccounts = () => getJSON<DemoAccountCard[]>("/api/auth/demo-accounts");

export const getHealth = () => getJSON<Health>("/api/health");
export const getHouseholds = () => getJSON<HouseholdSummary[]>("/api/households");
/** One account's household. Prefer this to picking an account out of `getHouseholds()`. */
export const getHousehold = (customerId: string) =>
  getJSON<HouseholdSummary>(`/api/households/${encodeURIComponent(customerId)}`);

export interface AnnualDemandSummary {
  customer_id: string;
  available: boolean;
  annual_kwh: number | null;
  period_start: string | null;
  period_end: string | null;
  days_available: number;
  days_required: number;
  estimated_read_pct: number | null;
  source: string;
  note: string;
}

export const getAnnualDemand = (customerId: string) =>
  getJSON<AnnualDemandSummary>(
    `/api/households/${encodeURIComponent(customerId)}/annual-demand`,
  );

/** `asAtDay` truncates the cycle — a warning delivered on day 31 is a bill, not a warning. */
export const getBillShock = (customerId: string, asAtDay?: number) =>
  getJSON<BillShockWarning>(
    `/api/households/${encodeURIComponent(customerId)}/bill-shock` +
      (asAtDay ? `?as_at_day=${asAtDay}` : ""),
  );

/**
 * One slice of the energy breakdown.
 *
 * **`confidence` is not decoration and the UI has to honour it.** A `measured` slice came
 * off a meter. A `fitted` slice came off this household's own regression and is an
 * estimate — rendering it identically to a measured one is a chart that overstates what is
 * known, which is the failure this whole product is organised against. A `residual` slice
 * is what is left after the others, so it carries their error too and must read as
 * "everything else" rather than as a finding.
 */
export interface EnergyCategory {
  key: string;
  label: string;
  kwh: number;
  cost_nzd: number;
  share_pct: number;
  /** `measured` | `fitted` | `residual` */
  confidence: string;
  /** How the figure was arrived at, in one clause. Show it — it is the whole point. */
  basis: string;
  caveat: string | null;
}

/**
 * Where a household's power goes.
 *
 * **This does not identify appliances**, and no copy on this screen may imply it does. A
 * whole-house meter reads one number for the whole house; these categories are behaviours
 * that are each separately measurable, which is a different claim and the only honest one.
 *
 * `available: false` is a real response and must render as an explanation, not as an empty
 * chart or a spinner. An account with no half-hourly data genuinely cannot have its
 * standing load separated, and `reason` says so in words a customer can read.
 */
export interface EnergyBreakdown {
  customer_id: string;
  available: boolean;
  reason: string | null;
  period: string;
  days: number;
  total_kwh: number;
  total_cost_nzd: number;
  categories: EnergyCategory[];
  caveats: string[];
  heating_fit_r_squared: number | null;
  heating_not_reported_because: string | null;
  always_on_not_reported_because: string | null;
}

export const getEnergyBreakdown = (customerId: string) =>
  getJSON<EnergyBreakdown>(
    `/api/households/${encodeURIComponent(customerId)}/energy-breakdown`,
  );

/**
 * One device found on the local network.
 *
 * There is no energy field here and there must not be one. An mDNS announcement carries a
 * name and a service type and nothing else — attaching a kWh or a dollar figure to any of
 * this would be a fabrication with a device name stapled to it.
 */
export interface DiscoveredDevice {
  name: string;
  kind: string;
  /** Which platform could be connected to actually read it. Null when there is none. */
  could_connect_via: string | null;
  note: string;
  address: string | null;
}

export interface SmartDeviceScan {
  scanned: boolean;
  error: string | null;
  method: string;
  /**
   * True for the stdlib one-shot scan, which finds devices that answer promptly and misses
   * ones that only announce on a slow cycle. Say so — a household with a quiet device must
   * be told the scan was quick, not told they have nothing.
   */
  scan_was_shallow: boolean;
  devices_found: number;
  devices: DiscoveredDevice[];
  by_platform: Record<string, number>;
  platforms_worth_connecting: string[];
}

/**
 * A POST despite reading nothing, deliberately: it puts multicast traffic on the customer's
 * network and takes a couple of seconds. A GET invites a proxy or a dashboard poll to
 * repeat it, and a network scan running on every page load is a scan nobody asked for.
 *
 * Only ever call this from an explicit click.
 */
export async function discoverSmartDevices(): Promise<SmartDeviceScan> {
  const res = await fetch("/api/homelink/discover", { method: "POST" });
  if (!res.ok) {
    if (res.status === 503) throw new Error('local network discovery is unavailable here');
    throw new Error('the scan could not be started');
  }
  return (await res.json()) as SmartDeviceScan;
}

export interface StreamHandlers {
  onToken?: (e: TokenEvent) => void;
  /** Drop the text streamed since the last reset — see the `reset` docs above. */
  onReset?: () => void;
  onTool?: (e: ToolEvent) => void;
  onToolResult?: (e: ToolResultEvent) => void;
  onChart?: (e: ChartEvent) => void;
  onDone?: (e: DoneEvent) => void;
  onError?: (e: ErrorEvent) => void;
}

/**
 * Stream a chat answer.
 *
 * The browser `EventSource` API cannot issue a POST, and this endpoint needs a
 * JSON body — so we read the SSE frames off a fetch stream by hand. Pass an
 * `AbortSignal` to cancel; without one, an unmounted component keeps reading.
 */
export async function streamChat(
  req: ChatRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await sendChatStream(req, handlers, loadSession()?.accessToken, signal);
}
