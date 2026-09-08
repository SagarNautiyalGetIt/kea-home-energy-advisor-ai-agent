import { apiFetch, apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

export type AssistantMeta = {
  intent: string;
  escalate: boolean;
};

export type AssistantDone = {
  passed: boolean;
  fell_back_to_template: boolean;
  checked?: string[];
  unverified?: string[];
  regenerated?: boolean;
};

type AssistantHandlers = {
  onMeta?: (event: AssistantMeta) => void;
  onText: (text: string) => void;
  onDone?: (event: AssistantDone) => void;
};

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

function dispatchFrame(frame: string, handlers: AssistantHandlers) {
  let eventName = 'message';
  let data = '';

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }

  if (!data) return;
  const payload: unknown = JSON.parse(data);
  if (eventName === 'meta') handlers.onMeta?.(payload as AssistantMeta);
  else if (eventName === 'token') handlers.onText((payload as { text: string }).text);
  else if (eventName === 'done') handlers.onDone?.(payload as AssistantDone);
}

export function isAssistantAnswerSafe(result: AssistantDone) {
  return result.passed || result.fell_back_to_template;
}

export async function streamAssistantReply(
  customerId: string,
  message: string,
  handlers: AssistantHandlers,
  signal?: AbortSignal,
) {
  if (!apiBaseUrl) throw new Error('Sparky is currently unavailable. Please try again later.');
  if (!customerId) throw new Error('Your customer account could not be identified. Please sign in again.');

  const response = await apiFetch('/api/chat/stream', {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id: customerId, message }),
    signal,
  });

  if (!response.ok) throw new Error('Sparky could not answer right now. Please try again.');
  if (!response.body) throw new Error('Sparky returned an empty response. Please try again.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    frames.forEach((frame) => dispatchFrame(frame, handlers));
    if (done) break;
  }

  if (buffer.trim()) dispatchFrame(buffer, handlers);
}

export function sendAssistantFeedback(customerId: string, messageId: number, feedback: 'like' | 'dislike') {
  const path = process.env.EXPO_PUBLIC_AI_FEEDBACK_PATH?.trim() || '/api/chat/feedback';
  return apiJson<void>(path, jsonRequest('POST', { customer_id: customerId, message_id: String(messageId), feedback }));
}

export function uploadAssistantAttachment(customerId: string, formData: FormData, signal?: AbortSignal) {
  const template = process.env.EXPO_PUBLIC_AI_ATTACHMENT_PATH?.trim() || '/api/households/{customer_id}/chat/attachments';
  return apiJson<{ attachment_id: string }>(apiPath(template, { customer_id: customerId }), { method: 'POST', body: formData, signal });
}
