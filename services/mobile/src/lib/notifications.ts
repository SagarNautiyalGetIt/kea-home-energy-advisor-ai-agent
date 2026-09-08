import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { notificationRoute } from '@/lib/notification-route';

export async function hasPhoneNotificationPermission() {
  if (Platform.OS === 'web') return false;
  try {
    const permission = await Notifications.getPermissionsAsync();
    return permission.granted;
  } catch {
    return false;
  }
}

export async function requestPhoneNotificationPermission() {
  if (Platform.OS === 'web') return 'unavailable' as const;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted' as const;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted ? 'granted' as const : 'denied' as const;
  } catch {
    return 'unavailable' as const;
  }
}

export async function getPhonePushToken() {
  if (Platform.OS === 'web') return null;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (!projectId) throw new Error('EXPO_PUBLIC_EAS_PROJECT_ID is required for push notifications.');
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result.data;
}

export function useNotificationResponseRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const destination = notificationRoute(response.notification.request.content.data?.screen);
      if (destination) router.push(destination);
    });
    return () => subscription.remove();
  }, []);
}
