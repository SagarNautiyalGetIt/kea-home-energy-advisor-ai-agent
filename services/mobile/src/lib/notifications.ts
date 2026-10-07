import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { notificationRoute } from '@/lib/notification-route';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiJson, jsonRequest } from '@/lib/backend-client';

const PUSH_KEY = 'kea:device-push-registration';
type Registration = { customerId: string; token: string };
async function registration(): Promise<Registration | null> {
  const raw = await AsyncStorage.getItem(PUSH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Registration; } catch { return null; }
}
export async function devicePushEnabled(customerId: string) {
  return (await registration())?.customerId === customerId;
}
export async function setDevicePush(customerId: string, enabled: boolean) {
  const prior = await registration();
  if (enabled && await requestPhoneNotificationPermission() !== 'granted') throw new Error('Device notifications need permission and a Kea development build.');
  const token = enabled ? await getPhonePushToken() : prior?.token;
  if (!token) {
    if (enabled) throw new Error('This build cannot register push notifications.');
    return;
  }
  await apiJson(`/api/households/${encodeURIComponent(customerId)}/push-tokens`, jsonRequest('POST', { token, enabled }));
  if (enabled) await AsyncStorage.setItem(PUSH_KEY, JSON.stringify({ customerId, token }));
  else await AsyncStorage.removeItem(PUSH_KEY);
}
export function usePushRegistration(customerId?: string) {
  useEffect(() => {
    if (!customerId) return;
    const refresh = async () => {
      if (!(await devicePushEnabled(customerId))) return;
      await setDevicePush(customerId, await hasPhoneNotificationPermission());
    };
    const attempt = () => { void refresh().catch(() => undefined); };
    attempt();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') attempt(); });
    const timer = setInterval(attempt, 60 * 60 * 1000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [customerId]);
}

/** Expo Go may not include the native notifications module. Keep notification
 * routing optional so a preview app still opens normally. */
let notifications: typeof import('expo-notifications') | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    notifications = null;
  }
}

export async function hasPhoneNotificationPermission() {
  if (!notifications) return false;
  try {
    const permission = await notifications.getPermissionsAsync();
    return permission.granted;
  } catch {
    return false;
  }
}

export async function requestPhoneNotificationPermission() {
  if (!notifications) return 'unavailable' as const;
  try {
    const current = await notifications.getPermissionsAsync();
    if (current.granted) return 'granted' as const;
    const requested = await notifications.requestPermissionsAsync();
    return requested.granted ? 'granted' as const : 'denied' as const;
  } catch {
    return 'unavailable' as const;
  }
}

export async function getPhonePushToken() {
  if (!notifications) return null;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (!projectId) throw new Error('EXPO_PUBLIC_EAS_PROJECT_ID is required for push notifications.');
  const result = await notifications.getExpoPushTokenAsync({ projectId });
  return result.data;
}

export function useNotificationResponseRouting() {
  useEffect(() => {
    if (!notifications) return;
    const subscription = notifications.addNotificationResponseReceivedListener((response) => {
      const destination = notificationRoute(response.notification.request.content.data?.screen);
      if (destination) router.push(destination);
    });
    return () => subscription.remove();
  }, []);
}
