import { loadAccessToken } from './backend-client';

export type VoiceSocketHandlers = { onMessage: (data: unknown) => void; onError?: () => void; onClose?: () => void };

export async function openAssistantVoiceSession(customerId: string, handlers: VoiceSocketHandlers) {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
  const voicePath = process.env.EXPO_PUBLIC_VOICE_PATH?.trim() || '/api/voice/stream';
  if (!apiUrl || !customerId) throw new Error('Voice service is not configured.');
  const token = await loadAccessToken();
  if (!token) throw new Error("Sign in to use voice.");
  const socket = new WebSocket(`${apiUrl.replace(/^http/, 'ws')}${voicePath}`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', customer_id: customerId, access_token: token }));
  socket.onmessage = (event) => {
    try { handlers.onMessage(JSON.parse(String(event.data))); } catch { handlers.onMessage(event.data); }
  };
  socket.onerror = () => handlers.onError?.();
  socket.onclose = () => handlers.onClose?.();
  return socket;
}
