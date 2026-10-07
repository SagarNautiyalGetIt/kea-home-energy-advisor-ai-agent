import { apiBase, apiJson, apiPath, jsonRequest, loadAccessToken } from '@/lib/backend-client';
import { sendAuthenticatedStream } from '@/lib/assistant-auth-stream';
import type { HistoryTurn } from '@/lib/assistant-history';
import { parseChartEvent, parseSseFrames, type ChartEvent } from '@/lib/assistant-stream';

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
   * Handling tier: 1 assistant answer, 2 concern recorded for review, 3 stop and
   * direct the customer to Customer Care. No tier implies a staff member has received
   * this chat. Decided by the same API pipeline as web and voice.
   */
  tier?: number;
  tier_reason?: string | null;
  /** Read by the shared API tone layer; never use this to diagnose the customer in UI. */
  emotion?: string | null;
  emotion_intensity?: string | null;
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
  /** Server-selected picture built from the same recorded lookup as the answer. */
  onChart?: (chart: ChartEvent | null) => void;
  onDone?: (event: AssistantDone) => void;
  /** No answer was produced. Show the message; never substitute one. */
  onError?: (message: string) => void;
};

/** Human-readable labels for the tool names. Kept in step with the web client's copy. */
const TOOL_LABELS: Record<string, string> = {
  get_usage_history: 'Reading your dated usage and tariff bands',
  get_hourly_usage: 'Checking readings for the selected day',
  get_billing_records: 'Reading your invoice totals',
  get_plan_details: 'Checking plan rates and commitment terms',
  get_alert_status: 'Checking your warning settings and assessment',
  get_power_clash_progress: 'Reading your Power Clash progress',
  get_scheduled_outages: 'Checking the distributor schedule',
  update_alert_settings: 'Updating your warning settings',
  request_plan_change: 'Checking your plan change request',
  get_account_summary: 'Looking up your account',
  get_daily_usage: 'Reading your daily meter data',
  get_bill_comparison: 'Comparing this bill with your last one',
  get_hourly_profile: 'Checking your usage through the day',
  compare_to_similar_homes: 'Comparing with similar homes',
  get_plan_options: 'Checking your plan against the alternatives',
  project_this_bill: 'Projecting the rest of your cycle',
  get_energy_breakdown: 'Checking your energy breakdown',
  get_connected_device_energy: 'Checking connected device measurements',
  discover_smart_devices: 'Looking for smart devices',
  search_help_topics: 'Checking Kea help information',
  answer_clarifying_question: 'Saving your answer',
  handoff_to_human: 'Checking whether human support is needed',
};

export const toolLabel = (name: string): string =>
  TOOL_LABELS[name] ?? name.replace(/_/g, ' ');

const SOURCE_LABELS: Record<string, string> = {
  get_usage_history: 'dated usage',
  get_hourly_usage: 'dated hourly readings',
  get_billing_records: 'invoice records',
  get_plan_details: 'plan terms',
  get_alert_status: 'warning preferences and assessment',
  get_power_clash_progress: 'Power Clash receipts',
  get_scheduled_outages: 'distributor schedule',
  get_account_summary: 'account',
  get_daily_usage: 'daily meter readings',
  get_bill_comparison: 'bills',
  get_hourly_profile: 'hourly meter readings',
  compare_to_similar_homes: 'similar homes in this data set',
  get_plan_options: 'plan prices',
  project_this_bill: 'bill projection',
  get_energy_breakdown: 'energy breakdown',
  get_connected_device_energy: 'connected device measurements',
  discover_smart_devices: 'network device names',
  search_help_topics: 'Kea help information',
};

/** Short noun labels fit under a chat answer without implying every source is a meter. */
export const sourceLabel = (name: string): string => SOURCE_LABELS[name] ?? name.replace(/_/g, ' ');

/** Returned by `streamAssistantReply` so a caller can cancel — the RN AbortController. */
export type AssistantStream = { cancel: () => void };

export function streamAssistantReply(
  customerId: string,
  message: string,
  handlers: AssistantHandlers,
  conversationId?: number | null,
  history: HistoryTurn[] = [],
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
    if (finished) return;
    const parsed = parseSseFrames(buffer, consumed);
    consumed = parsed.offset;
    for (const { event, payload: raw } of parsed.frames) {
      if (finished) break;
      if (!raw || typeof raw !== 'object') continue;
      const payload = raw as Record<string, any>;
      switch (event) {
        case 'token':
          if (typeof payload.text === 'string') handlers.onText(payload.text);
          break;
        case 'reset': handlers.onReset?.(); break;
        case 'tool':
          if (typeof payload.name === 'string') handlers.onTool?.(payload.name);
          break;
        case 'result':
          if (typeof payload.name === 'string' && typeof payload.ok === 'boolean') {
            handlers.onToolResult?.(payload.name, payload.ok);
          }
          break;
        case 'chart': handlers.onChart?.(parseChartEvent(payload)); break;
        case 'done':
          if (!finished) {
            finished = true;
            const validSources = Array.isArray(payload.sources) && payload.sources.every((source: unknown) =>
              source !== null && typeof source === 'object' &&
              typeof (source as SourceRef).tool === 'string' &&
              typeof (source as SourceRef).ok === 'boolean');
            if (validSources && typeof payload.escalate_to_human === 'boolean' &&
                typeof payload.tier === 'number') handlers.onDone?.(payload as AssistantDone);
            else handlers.onError?.('Sparky returned an incomplete answer. Please try again.');
          }
          break;
        case 'error':
          if (!finished) {
            finished = true;
            handlers.onError?.(typeof payload.message === 'string'
              ? payload.message : 'Sparky could not answer right now. Please try again.');
          }
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
      handlers.onError?.('Your household data is unavailable. Ask the demo operator to check that it has been loaded.');
      return;
    }
    if (xhr.status >= 400) {
      finished = true;
      handlers.onError?.(xhr.status === 401 || xhr.status === 403
        ? 'Your session cannot access this account. Please sign in again.'
        : 'Sparky is unavailable right now. Please try again shortly.');
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
  void sendAuthenticatedStream(xhr,
    JSON.stringify({
      customer_id: customerId,
      message,
      conversation_id: conversationId ?? null,
      history,
    }), loadAccessToken, () => cancelled || finished, () => {
      finished = true;
      handlers.onError?.('Sparky could not read your session. Please sign in again.');
    },
  );

  return {
    cancel: () => {
      cancelled = true;
      xhr.abort();
    },
  };
}


export function sendAssistantFeedback(customerId: string, messageId: number, feedback: 'like' | 'dislike') {
  const path = process.env.EXPO_PUBLIC_AI_FEEDBACK_PATH?.trim() || '/api/assistant/feedback';
  if (!path) return Promise.reject(new Error('Assistant feedback is not supported by the current backend.'));
  return apiJson<void>(path, jsonRequest('POST', { customer_id: customerId, message_id: String(messageId), feedback }));
}

export function uploadAssistantAttachment(customerId: string, formData: FormData, signal?: AbortSignal) {
  const template = process.env.EXPO_PUBLIC_AI_ATTACHMENT_PATH?.trim() || '/api/households/{customer_id}/assistant/attachments';
  if (!template) return Promise.reject(new Error('Assistant attachments are not supported by the current backend.'));
  return apiJson<{ attachment_id: string }>(apiPath(template, { customer_id: customerId }), { method: 'POST', body: formData, signal });
}
