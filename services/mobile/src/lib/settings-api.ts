import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

export type NotificationPreferences = { emailNotifications: boolean; smsNotifications: boolean; phoneNotifications: boolean };
const preferencesPath = process.env.EXPO_PUBLIC_NOTIFICATION_PREFERENCES_PATH?.trim() || '/api/households/{customer_id}/notification-preferences';
const pushTokenPath = process.env.EXPO_PUBLIC_PUSH_TOKEN_PATH?.trim() || '/api/households/{customer_id}/push-tokens';

function pathFor(template: string, customerId: string) {
  return apiPath(template, { customer_id: customerId });
}

export async function loadNotificationPreferences(customerId: string): Promise<NotificationPreferences> {
  const value = await apiJson<Record<string, unknown>>(pathFor(preferencesPath, customerId));
  return {
    emailNotifications: value.email_notifications === true,
    smsNotifications: value.sms_notifications === true,
    phoneNotifications: value.phone_notifications === true,
  };
}

export function saveNotificationPreferences(customerId: string, preferences: NotificationPreferences) {
  return apiJson<void>(pathFor(preferencesPath, customerId), jsonRequest('PUT', {
    customer_id: customerId,
    email_notifications: preferences.emailNotifications,
    sms_notifications: preferences.smsNotifications,
    phone_notifications: preferences.phoneNotifications,
  }));
}

export function registerPushToken(customerId: string, token: string, platform: string) {
  return apiJson<void>(pathFor(pushTokenPath, customerId), jsonRequest('POST', { customer_id: customerId, token, platform }));
}

export function unregisterPushToken(customerId: string, token: string) {
  return apiJson<void>(pathFor(pushTokenPath, customerId), jsonRequest('DELETE', { customer_id: customerId, token }));
}
