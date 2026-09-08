import { apiFetch, apiPath } from '@/lib/backend-client';

export type CustomerProfile = {
  customerId: string;
  name: string;
  address: string;
  phone: string;
  email: string;
};

export type ProfileLoadResult =
  | { state: 'ready'; data: CustomerProfile }
  | { state: 'unavailable'; data: CustomerProfile; message: string };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
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

function profileFromResponse(value: unknown, expectedCustomerId: string): CustomerProfile {
  if (!isRecord(value)) throw new Error('Profile response is invalid.');
  const customerId = requiredString(value.customer_id ?? value.customerId, 'customer ID');
  if (customerId !== expectedCustomerId) throw new Error('Profile response belongs to a different customer.');
  return {
    customerId,
    name: requiredString(value.name ?? value.display_name, 'name'),
    address: requiredString(value.address ?? value.supply_address, 'address'),
    phone: requiredString(value.phone ?? value.contact_number, 'contact number'),
    email: requiredString(value.email, 'email'),
  };
}

async function profileRequest(method: 'GET' | 'PATCH', expectedCustomerId: string, signal: AbortSignal, profile?: CustomerProfile) {
  if (!apiBaseUrl) throw new Error('Profile service is not configured.');
  const response = await apiFetch(apiPath(profilePath, { customer_id: expectedCustomerId }), {
    method,
    credentials: 'include',
    headers: profile ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    body: profile ? JSON.stringify({ name: profile.name, address: profile.address, phone: profile.phone, email: profile.email }) : undefined,
    signal,
  });
  if (!response.ok) throw new Error(`Profile request failed (${response.status}).`);
  return profileFromResponse(await response.json(), expectedCustomerId);
}

export async function loadCustomerProfile(customerId: string, displayName: string, email: string, signal: AbortSignal): Promise<ProfileLoadResult> {
  const empty = emptyCustomerProfile(customerId, displayName, email);
  if (!apiBaseUrl) return { state: 'unavailable', data: empty, message: 'Profile details will appear when the profile service is connected.' };
  if (!customerId) throw new Error('A signed-in customer is required to load a profile.');
  return { state: 'ready', data: await profileRequest('GET', customerId, signal) };
}

export function updateCustomerProfile(profile: CustomerProfile, signal: AbortSignal): Promise<CustomerProfile> {
  return profileRequest('PATCH', profile.customerId, signal, profile);
}
