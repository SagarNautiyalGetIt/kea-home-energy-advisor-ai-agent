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
}

/** `event: meta` — arrives first, before any text. */
export interface MetaEvent {
  intent: string;
  escalate: boolean;
}

/** `event: token` — one per sentence, not one per word. */
export interface TokenEvent {
  text: string;
}

/**
 * `event: done` — the VerificationReport.
 *
 * READ THIS BEFORE USING `passed`. It answers one narrow question: did the
 * *model's draft* survive the number-checker? It is NOT "is this answer safe to
 * show". When the model is unavailable the server returns a template built
 * directly from verified facts — text that cannot contain an uncomputed number —
 * and `passed` is still false.
 *
 * Use `isSafeToDisplay()` below, never `passed` on its own. Rendering "verification
 * failed" on a correct answer undermines the claim the product is built on.
 */
export interface DoneEvent {
  passed: boolean;
  fell_back_to_template: boolean;
  checked?: string[];
  unverified?: string[];
  regenerated?: boolean;
}

/** The only correct test for "may I show this answer to a customer?". */
export const isSafeToDisplay = (r: DoneEvent): boolean =>
  r.passed || r.fell_back_to_template;

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
 * Read `reasons` before writing any copy: `above_comparable_homes` means the projection
 * exceeds what a *similar home* would spend. It does **not** mean "more than you usually
 * pay" — there is no billing history behind this, and claiming otherwise is the exact
 * fabrication the product exists to prevent. The backend repeats this in `caveats`.
 */
export interface BillShockWarning {
  customer_id: string;
  period: string;
  triggered: boolean;
  reasons: string[];
  days_elapsed: number;
  days_in_cycle: number;
  days_remaining: number;
  usage_so_far_kwh: number;
  cost_so_far_nzd: number;
  projected_cycle_cost_nzd: number;
  comparable_home_cost_nzd: number;
  overshoot_nzd: number;
  overshoot_pct: number;
  recent_trend_pct: number;
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
  onMeta?: (e: MetaEvent) => void;
  onToken?: (e: TokenEvent) => void;
  onDone?: (e: DoneEvent) => void;
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
      if (event === "meta") handlers.onMeta?.(payload as MetaEvent);
      else if (event === "token") handlers.onToken?.(payload as TokenEvent);
      else if (event === "done") handlers.onDone?.(payload as DoneEvent);
    }
  }
}
