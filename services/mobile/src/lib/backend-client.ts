import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Where the backend is, per platform.
 *
 * `localhost` means three different machines depending on where the app runs, and
 * getting it wrong presents as "the app is broken" rather than as a config problem:
 *
 *   iOS Simulator      http://localhost:8000        (shares the host's loopback)
 *   Android Emulator   http://10.0.2.2:8000         (10.0.2.2 IS the host)
 *   A physical phone   http://<your-wifi-ip>:8000   (loopback is the phone itself)
 *
 * The default picks correctly between the two emulators. A physical device has to be
 * told, because nothing in the app can discover the development machine's address — so
 * `apiBase()` is exported and surfaced on the Help screen, which turns "it doesn't work"
 * into "it is pointed at the wrong host".
 *
 * Previously this was `EXPO_PUBLIC_API_URL` with no fallback, and every call threw
 * "Backend service is not configured" on a fresh clone that had not copied .env.example.
 */
export function apiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
}

const apiBaseUrl = apiBase();
const TOKEN_KEY = 'kea-mobile-access-token';
const REFRESH_TOKEN_KEY = 'kea-mobile-refresh-token';
let memoryToken: string | null = null;
let memoryRefreshToken: string | null = null;
let refreshRequest: Promise<string | null> | null = null;

export function apiPath(template: string, values: Record<string, string> = {}) {
  return Object.entries(values).reduce((path, [key, value]) => path.replace(`{${key}}`, encodeURIComponent(value)), template);
}

export async function loadAccessToken() {
  if (memoryToken) return memoryToken;
  if (Platform.OS === 'web') return null;
  memoryToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return memoryToken;
}

export async function storeAccessToken(token: string | null) {
  memoryToken = token;
  if (Platform.OS === 'web') return;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function storeTokenPair(accessToken: string | null, refreshToken: string | null = null) {
  await storeAccessToken(accessToken);
  memoryRefreshToken = refreshToken;
  if (Platform.OS === 'web') return;
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

async function refreshAccessToken() {
  if (!memoryRefreshToken && Platform.OS !== 'web') memoryRefreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!memoryRefreshToken) return null;
  const path = process.env.EXPO_PUBLIC_REFRESH_TOKEN_PATH?.trim() || '/api/auth/refresh';
  const response = await fetch(`${apiBaseUrl}${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: memoryRefreshToken }) });
  if (!response.ok) return null;
  const body = await response.json() as Record<string, unknown>;
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  await storeTokenPair(accessToken, typeof body.refresh_token === 'string' ? body.refresh_token : memoryRefreshToken);
  return accessToken;
}

export async function apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (!path.startsWith('/')) throw new Error('API paths must be relative to EXPO_PUBLIC_API_URL.');
  const token = await loadAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', headers.get('Accept') ?? 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (response.status !== 401 || !retry) return response;
  refreshRequest ??= refreshAccessToken().finally(() => { refreshRequest = null; });
  const refreshed = await refreshRequest;
  return refreshed ? apiFetch(path, init, false) : response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const detail = await response.json().then((body: unknown) => {
      if (!body || typeof body !== 'object') return null;
      const value = (body as Record<string, unknown>).detail;
      return typeof value === 'string' ? value : null;
    }).catch(() => null);
    throw new Error(detail ?? `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
