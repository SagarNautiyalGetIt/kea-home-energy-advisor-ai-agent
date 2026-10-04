import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

/** Mobile view of the supported AlertPreferences contract. Phone alerts are voice calls, not device push notifications. */
export type NotificationPreferences = {
  accountRef: string;
  enabled: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
  phoneNotifications: boolean;
  billReminders: boolean;
  tier1Pct: number;
  tier2Pct: number;
  tier3Pct: number;
  minOvershootNzd: number;
  offlineModelOptIn: boolean;
  email: string | null;
  phoneE164: string | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  quietHoursStartMinute: number;
  quietHoursEndMinute: number;
  timezone: string;
  theme: 'light' | 'dark';
};
const preferencesPath = '/api/households/{customer_id}/alert-preferences';

function pathFor(template: string, customerId: string) {
  return apiPath(template, { customer_id: customerId });
}

export async function loadNotificationPreferences(customerId: string): Promise<NotificationPreferences> {
  const value = await apiJson<Record<string, unknown>>(pathFor(preferencesPath, customerId));
  return {
    accountRef: typeof value.account_ref === 'string' ? value.account_ref : customerId,
    enabled: value.enabled !== false,
    emailNotifications: value.email_enabled === true,
    smsNotifications: value.sms_enabled === true,
    phoneNotifications: value.voice_enabled === true,
    billReminders: value.bill_reminders !== false,
    tier1Pct: typeof value.tier1_pct === 'number' ? value.tier1_pct : 15,
    tier2Pct: typeof value.tier2_pct === 'number' ? value.tier2_pct : 40,
    tier3Pct: typeof value.tier3_pct === 'number' ? value.tier3_pct : 75,
    minOvershootNzd: typeof value.min_overshoot_nzd === 'number' ? value.min_overshoot_nzd : 20,
    offlineModelOptIn: value.offline_model_opt_in === true,
    email: typeof value.email === 'string' ? value.email : null,
    phoneE164: typeof value.phone_e164 === 'string' ? value.phone_e164 : null,
    quietHoursStart: typeof value.quiet_hours_start === 'number' ? value.quiet_hours_start : null,
    quietHoursEnd: typeof value.quiet_hours_end === 'number' ? value.quiet_hours_end : null,
    quietHoursStartMinute: typeof value.quiet_hours_start_minute === 'number' ? value.quiet_hours_start_minute : 0,
    quietHoursEndMinute: typeof value.quiet_hours_end_minute === 'number' ? value.quiet_hours_end_minute : 0,
    timezone: typeof value.timezone === 'string' ? value.timezone : 'Pacific/Auckland',
    theme: value.theme === 'light' ? 'light' : 'dark',
  };
}

export function saveNotificationPreferences(customerId: string, preferences: NotificationPreferences) {
  return apiJson<void>(pathFor(preferencesPath, customerId), jsonRequest('PUT', {
    account_ref: preferences.accountRef || customerId,
    enabled: preferences.enabled,
    tier1_pct: preferences.tier1Pct,
    tier2_pct: preferences.tier2Pct,
    tier3_pct: preferences.tier3Pct,
    min_overshoot_nzd: preferences.minOvershootNzd,
    email_enabled: preferences.emailNotifications,
    sms_enabled: preferences.smsNotifications,
    voice_enabled: preferences.phoneNotifications,
    bill_reminders: preferences.billReminders,
    offline_model_opt_in: preferences.offlineModelOptIn,
    email: preferences.email,
    phone_e164: preferences.phoneE164,
    quiet_hours_start: preferences.quietHoursStart,
    quiet_hours_end: preferences.quietHoursEnd,
    quiet_hours_start_minute: preferences.quietHoursStartMinute,
    quiet_hours_end_minute: preferences.quietHoursEndMinute,
    timezone: preferences.timezone,
    theme: preferences.theme,
  }));
}
