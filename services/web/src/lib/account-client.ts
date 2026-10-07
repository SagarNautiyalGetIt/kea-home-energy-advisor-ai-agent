import type { components } from '../api'
import { loadSession } from './session'

export type Billing = components['schemas']['HouseholdBilling']
export type Plans = components['schemas']['MobilePlansView']
export type Usage = components['schemas']['HouseholdUsageSeries']
export type Hours = components['schemas']['HouseholdHourlyUsage']

export async function accountRequest<T>(suffix: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const session = loadSession()
  if (!session) throw new Error('Sign in to view your account.')
  const response = await fetch(`/api/households/${encodeURIComponent(session.customerId)}/${suffix}`, {
    signal, method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Account request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}
