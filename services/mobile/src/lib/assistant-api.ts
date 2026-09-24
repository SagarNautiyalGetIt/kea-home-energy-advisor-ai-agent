import { apiBase, apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

/**
 * The assistant's wire protocol, mirrored from `services/api/app/pipeline.py`.
 * Both ends change together or not at all.
 *
 * ## Why this uses XMLHttpRequest and not fetch
 *
 * The previous version read `response.body.getReader()`. That is correct in a browser
 * and does nothing here: **React Native's fetch has no `ReadableStream` body**, so
 * `response.body` is null on Hermes. The old code threw "Sparky returned an empty
 * response" on every single turn — the streaming path had never worked on a device.
 *
 * XHR does deliver incrementally in React Native: `onprogress` fires with `responseText`
 * holding everything received so far. It is more code than the web client needs and it
 * is the only thing that streams on this platform.
 */

/** One lookup the assistant made, for the transparency panel under an answer. */
export type SourceRef = {
  tool: string;
  arguments: Record<string, unknown> | null;
  /** The table or computation behind it, in words a customer can read. */
  source: string | null;
  /**
   * False when the lookup failed or this account has no such data. Shown rather than
   * hidden: "I couldn't check that" is a different answer from "I didn't look".
   */
  ok: boolean;
};

export type AssistantDone = {
  sources: SourceRef[];
  escalate_to_human: boolean;
  escalation_reason: string | null;
  conversation_id: number | null;
  latency_ms: number;
  tokens: number;
  /**
   * Who handled this turn: 1 the assistant alone, 2 the assistant with a Kea agent
   * watching, 3 a person only. Decided in Python on every channel — see
   * `services/api/app/hardship/`. Tier 3 means the text above is a handover, not an
   * answer, and the UI should present it that way.
   */
  tier?: number;
  tier_reason?: string | null;
};

export type AssistantHandlers = {
  /** Prose, as the assistant writes it. */
  onText: (text: string) => void;
  /**
   * Discard everything streamed since the last reset.
   *
   * The assistant works in rounds and may write a line ("Let me pull up your July
   * bill") before deciding it needs a lookup first. A client that ignores this shows
   * that preamble glued to the front of every answer.
   */
  onReset?: () => void;
  onTool?: (name: string) => void;
  onToolResult?: (name: string, ok: boolean) => void;
  onDone?: (event: AssistantDone) => void;
  /** No answer was produced. Show the message; never substitute one. */
  onError?: (message: string) => void;
};

/** Human-readable labels for the tool names. Kept in step with the web client's copy. */
const TOOL_LABELS: Record<string, string> = {
  get_account_summary: 'Looking up your account',
  get_daily_usage: 'Reading your daily meter data',
  get_bill_comparison: 'Comparing this bill with your last one',
  get_hourly_profile: 'Checking your usage through the day',
  compare_to_similar_homes: 'Comparing with similar homes',
  get_plan_options: 'Checking your plan against the alternatives',
  project_this_bill: 'Projecting the rest of your cycle',
  get_energy_breakdown: 'Checking your energy breakdown',
  discover_smart_devices: 'Looking for smart devices',
  answer_clarifying_question: 'Saving your answer',
  handoff_to_human: 'Bringing in a person',
};

export const toolLabel = (name: string): string =>
  TOOL_LABELS[name] ?? name.replace(/_/g, ' ');

/** Returned by `streamAssistantReply` so a caller can cancel — the RN AbortController. */
export type AssistantStream = { cancel: () => void };

export function streamAssistantReply(
  customerId: string,
  message: string,
  handlers: AssistantHandlers,
  conversationId?: number | null,
): AssistantStream {
  if (!customerId) {
    handlers.onError?.('Your account could not be identified. Please sign in again.');
    return { cancel: () => undefined };
  }

  const xhr = new XMLHttpRequest();
  xhr.timeout = 90_000;
  let consumed = 0;
  let cancelled = false;
  let finished = false;

  const drain = (buffer: string) => {
    const boundary = buffer.lastIndexOf('\n\n');
    if (boundary < 0 || boundary + 2 <= consumed) return;

    const complete = buffer.slice(consumed, boundary);
    consumed = boundary + 2;

    for (const frame of complete.split('\n\n')) {
      let event = '';
      let data = '';
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!event || !data) continue;

      let payload: any;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event) {
        case 'token': handlers.onText(payload.text); break;
        case 'reset': handlers.onReset?.(); break;
        case 'tool': handlers.onTool?.(payload.name); break;
        case 'result': handlers.onToolResult?.(payload.name, payload.ok); break;
        case 'done':
          if (!finished) { finished = true; handlers.onDone?.(payload as AssistantDone); }
          break;
        case 'error':
          if (!finished) { finished = true; handlers.onError?.(payload.message); }
          break;
      }
    }
  };

  xhr.open('POST', `${apiBase()}/api/chat/stream`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.onprogress = () => {
    if (!cancelled) drain(xhr.responseText);
  };
  xhr.onload = () => {
    if (cancelled) return;
    if (xhr.status === 404) {
      finished = true;
      handlers.onError?.('That account could not be found. Please sign in again.');
      return;
    }
    if (xhr.status >= 400) {
      finished = true;
      handlers.onError?.('Sparky is unavailable right now. Please try again shortly.');
      return;
    }
    drain(`${xhr.responseText}\n\n`);
    if (!finished) {
      finished = true;
      handlers.onError?.('Sparky did not finish its answer. Please try again.');
    }
  };
  xhr.onerror = () => {
    if (!cancelled && !finished) { finished = true; handlers.onError?.('Sparky could not reach the backend. Please check your connection and try again.'); }
  };
  xhr.ontimeout = () => {
    if (!cancelled && !finished) { finished = true; handlers.onError?.('Sparky took too long to respond. Please try again.'); }
  };
  xhr.send(
    JSON.stringify({
      customer_id: customerId,
      message,
      conversation_id: conversationId ?? null,
    }),
  );

  return {
    cancel: () => {
      cancelled = true;
      xhr.abort();
    },
  };
}


export function sendAssistantFeedback(customerId: string, messageId: number, feedback: 'like' | 'dislike') {
  const path = process.env.EXPO_PUBLIC_AI_FEEDBACK_PATH?.trim();
  if (!path) return Promise.reject(new Error('Assistant feedback is not supported by the current backend.'));
  return apiJson<void>(path, jsonRequest('POST', { customer_id: customerId, message_id: String(messageId), feedback }));
}

export function uploadAssistantAttachment(customerId: string, formData: FormData, signal?: AbortSignal) {
  const template = process.env.EXPO_PUBLIC_AI_ATTACHMENT_PATH?.trim();
  if (!template) return Promise.reject(new Error('Assistant attachments are not supported by the current backend.'));
  return apiJson<{ attachment_id: string }>(apiPath(template, { customer_id: customerId }), { method: 'POST', body: formData, signal });
}
