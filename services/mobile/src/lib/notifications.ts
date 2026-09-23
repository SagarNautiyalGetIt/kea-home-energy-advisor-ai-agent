import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { notificationRoute } from '@/lib/notification-route';

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
