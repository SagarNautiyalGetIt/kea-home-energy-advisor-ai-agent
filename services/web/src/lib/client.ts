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

export interface ChatRequest {
  customer_id: string;
  message: string;
  /** Send back whatever the previous `done` returned, to keep the thread together. */
  conversation_id?: number | null;
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

/** `event: done` — the answer is complete and the evidence has been written. */
export interface DoneEvent {
  /** Every lookup behind this answer, in the order it was made. */
  sources: SourceRef[];
  escalate_to_human: boolean;
  escalation_reason: string | null;
  conversation_id: number | null;
  latency_ms: number;
  tokens: number;
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
  get_account_summary: 'Looking up your account',
  get_daily_usage: 'Reading your daily meter data',
  get_bill_comparison: 'Comparing this bill with your last one',
  get_hourly_profile: 'Checking your usage through the day',
  compare_to_similar_homes: 'Comparing with similar homes',
  get_plan_options: 'Checking your plan against the alternatives',
  project_this_bill: 'Projecting the rest of your cycle',
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
  total_kwh: number;
  estimated_cost_nzd: number;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
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
      return 'Compared with your own recent bills.';
    case 'comparable_homes':
      return 'Compared with similar homes, not with your own past bills — Kea does not hold your billing history.';
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

/** `asAtDay` truncates the cycle — a warning delivered on day 31 is a bill, not a warning. */
export const getBillShock = (customerId: string, asAtDay?: number) =>
  getJSON<BillShockWarning>(
    `/api/households/${encodeURIComponent(customerId)}/bill-shock` +
      (asAtDay ? `?as_at_day=${asAtDay}` : ""),
  );

export interface StreamHandlers {
  onToken?: (e: TokenEvent) => void;
  /** Drop the text streamed since the last reset — see the `reset` docs above. */
  onReset?: () => void;
  onTool?: (e: ToolEvent) => void;
  onToolResult?: (e: ToolResultEvent) => void;
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
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) throw new Error(`chat/stream → ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("chat/stream returned no body");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line. A chunk can split a frame in the
    // middle, so anything after the last "\n\n" stays in the buffer for next time.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;

      const payload: unknown = JSON.parse(data);
      switch (event) {
        case "token":
          handlers.onToken?.(payload as TokenEvent);
          break;
        case "reset":
          handlers.onReset?.();
          break;
        case "tool":
          handlers.onTool?.(payload as ToolEvent);
          break;
        case "result":
          handlers.onToolResult?.(payload as ToolResultEvent);
          break;
        case "done":
          handlers.onDone?.(payload as DoneEvent);
          break;
        case "error":
          handlers.onError?.(payload as ErrorEvent);
          break;
      }
    }
  }
}
