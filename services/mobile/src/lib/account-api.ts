import { apiJson } from '@/lib/backend-client';

export type DemoAccount = {
  email: string;
  password: string;
  customer_id: string;
  display_name: string;
  scenario: string;
};

function isDemoAccount(value: unknown): value is DemoAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return ['email', 'password', 'customer_id', 'display_name', 'scenario'].every((key) => typeof account[key] === 'string' && account[key].trim());
}

export const FALLBACK_DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'july@kea.example', password: 'julyhouse24', customer_id: 'H-JUL', display_name: 'July Household', scenario: "High standing load — the flagship 'why is my bill high' case." },
  { email: 'cold@kea.example', password: 'coldsnap24', customer_id: 'H-COLD', display_name: 'Cold Snap Household', scenario: 'Cold-snap driven, not behaviour. Trips the bill-shock warning at day 6.' },
  { email: 'spike@kea.example', password: 'spikeday24', customer_id: 'H-SPIKE', display_name: 'Spike Household', scenario: "One genuine behavioural spike — good for 'which day was highest'." },
  { email: 'drop@kea.example', password: 'hardship24', customer_id: 'H-DROP', display_name: 'Usage Collapse Household', scenario: 'The hardship signal. Sparky recommends verified human support.' },
  { email: 'tariff@kea.example', password: 'lowfixed24', customer_id: 'H-TARIFF', display_name: 'Low User Household', scenario: 'Low steady user, better off on another plan. Exercises the tariff check.' },
  { email: 'zara@kea.example', password: 'steady24', customer_id: 'H-ZARA', display_name: 'Zara Duncan', scenario: "Nothing is wrong. The account to check the agent doesn't invent a cause." },
  { email: 'aroha@kea.example', password: 'climbing24', customer_id: 'H-AROHA', display_name: 'Aroha Fraser', scenario: 'Usage drifts up all month with no alarming day. Trips the forecast, not a spike.' },
  { email: 'julia@kea.example', password: 'invoice24', customer_id: 'DEMO-ACCT-221001', display_name: 'Julia Fox', scenario: 'The printed-invoice fixture — August 2024.' },
  { email: 'ana@kea.example', password: 'fullhouse24', customer_id: 'DEMO-ACCT-222001', display_name: 'Ana Whitiora', scenario: 'Family home — high evening usage.' },
  { email: 'tama@kea.example', password: 'flatmate24', customer_id: 'DEMO-ACCT-223001', display_name: 'Tama Rewiri', scenario: 'Flatting situation with split bills.' },
  { email: 'mere@kea.example', password: 'solaruser24', customer_id: 'DEMO-ACCT-224001', display_name: 'Mere Kahu', scenario: 'Solar exporter with daytime generation.' },
];

export async function loadDemoAccounts(): Promise<DemoAccount[]> {
  const useRealData = process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'false';
  try {
    const value: unknown = await apiJson('/api/auth/demo-accounts');
    if (Array.isArray(value) && value.every(isDemoAccount)) return value;
    if (useRealData) throw new Error('Demo accounts response was invalid.');
  } catch {
    if (useRealData) throw new Error('Demo accounts are unavailable from the backend.');
  }
  return FALLBACK_DEMO_ACCOUNTS;
}

/**
 * The official backend intentionally exposes demo sign-in only.  Registration and
 * password-management endpoints do not exist in its contract, so these functions
 * fail locally rather than sending passwords to invented URLs.
 */
const unavailable = (action: string) => Promise.reject(new Error(`${action} is not available from the current Kea backend.`));

export function requestPasswordReset(_email: string) {
  return unavailable('Password reset');
}

export function changeAccountPassword(_customerId: string, _currentPassword: string, _newPassword: string) {
  return unavailable('Password changes');
}
