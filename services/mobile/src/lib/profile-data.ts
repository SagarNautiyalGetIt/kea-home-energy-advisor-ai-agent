import { apiFetch, apiPath } from '@/lib/backend-client';
import { demoProfileData } from '@/data/mock';

export type CustomerProfile = {
  customerId: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  icpNumber?: string;
  networkName?: string;
  planName?: string;
  accountNumber?: string;
  userType?: string;
};

export type ProfileLoadResult =
  | { state: 'ready'; data: CustomerProfile; canEdit: boolean }
  | { state: 'unavailable'; data: CustomerProfile; message: string; canEdit: false };

const profilePath = process.env.EXPO_PUBLIC_PROFILE_PATH?.trim() || '/api/households/{customer_id}/profile';

export function emptyCustomerProfile(customerId = '', name = '', email = ''): CustomerProfile {
  return { customerId, name, address: '', phone: '', email };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Profile response is missing ${field}.`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error(`Profile response has an invalid ${field}.`);
  return value.trim();
}

function profileFromResponse(value: unknown, expectedCustomerId: string, fallbackName = '', fallbackEmail = ''): CustomerProfile {
  if (!isRecord(value)) throw new Error('Profile response is invalid.');
  const customerId = requiredString(value.customer_id ?? value.customerId, 'customer ID');
  if (customerId !== expectedCustomerId) throw new Error('Profile response belongs to a different customer.');
  return {
    customerId,
    name: optionalString(value.name ?? value.display_name, 'name') || fallbackName || 'Kea customer',
    address: optionalString(value.address ?? value.supply_address, 'address'),
    phone: optionalString(value.phone ?? value.contact_number, 'contact number'),
    email: optionalString(value.email, 'email') || fallbackEmail,
    icpNumber: optionalString(value.icp_number ?? value.icpNumber, 'ICP number'),
    networkName: optionalString(value.network_name ?? value.networkName, 'network name'),
    planName: optionalString(value.plan_name ?? value.planName, 'plan name'),
    accountNumber: optionalString(value.account_number ?? value.accountNumber, 'account number'),
    userType: optionalString(value.user_type ?? value.userType, 'user type'),
  };
}

async function profileRequest(expectedCustomerId: string, displayName: string, email: string, signal: AbortSignal) {
  const response = await apiFetch(apiPath(profilePath, { customer_id: expectedCustomerId }), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Profile request failed (${response.status}).`);
  return profileFromResponse(await response.json(), expectedCustomerId, displayName, email);
}

export async function loadCustomerProfile(customerId: string, displayName: string, email: string, signal: AbortSignal): Promise<ProfileLoadResult> {
  const useRealData = process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'false';
  const fallbackProfile: CustomerProfile = {
    ...demoProfileData,
    customerId: customerId || demoProfileData.customerId,
    name: displayName || demoProfileData.name,
    email: email || demoProfileData.email,
  };

  if (!useRealData) {
    return { state: 'ready', data: fallbackProfile, canEdit: true };
  }
  if (!customerId) return { state: 'unavailable', data: emptyCustomerProfile(), message: 'A signed-in customer is required to load profile details.', canEdit: false };
  try {
    return { state: 'ready', data: await profileRequest(customerId, displayName, email, signal), canEdit: false };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return { state: 'unavailable', data: emptyCustomerProfile(customerId, displayName, email), message: error instanceof Error ? error.message : 'Profile details are unavailable right now.', canEdit: false };
  }
}

export async function updateCustomerProfile(profile: CustomerProfile, signal: AbortSignal): Promise<CustomerProfile> {
  const useRealData = process.env.EXPO_PUBLIC_USE_REAL_DATA !== 'false';
  if (!useRealData) {
    return profile;
  }
  throw new Error('Profile updates are not supported by the current backend.');
}
