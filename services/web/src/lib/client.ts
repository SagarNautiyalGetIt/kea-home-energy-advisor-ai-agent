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

export const getHealth = () => getJSON<Health>("/api/health");
export const getHouseholds = () => getJSON<HouseholdSummary[]>("/api/households");

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
