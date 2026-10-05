import { loadSession } from './session'

export type ClashProgress = {
  total_xp: number
  planning_xp: number
  verified_xp: number
  estimated_shift_savings_nzd: string | number
  storage: 'database' | 'memory'
  missions: { id: string; title: string; question: string; planning_xp: number }[]
  events: { key: string; mission_id: string; evidence: string; xp: number; day: string; source: string }[]
}

export class ClashSignInError extends Error {}

async function requestClash(account: string, missionId?: string, signal?: AbortSignal): Promise<ClashProgress> {
  const session = loadSession()
  if (session?.customerId !== account || !session.accessToken) {
    throw new ClashSignInError('Sign in again to load your quest progress.')
  }
  const response = await fetch(`/api/households/${encodeURIComponent(account)}/clash${missionId ? '/plans' : ''}`, {
    method: missionId ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}`, ...(missionId ? { 'Content-Type': 'application/json' } : {}) },
    body: missionId ? JSON.stringify({ mission_id: missionId }) : undefined,
    signal,
  })
  if (response.status === 401) throw new ClashSignInError('Your session has expired. Sign in again to continue.')
  if (!response.ok) throw new Error('Your quest progress is unavailable. Please try again.')
  return response.json() as Promise<ClashProgress>
}

export const getClashProgress = (account: string, signal?: AbortSignal) => requestClash(account, undefined, signal)
export const planClashQuest = (account: string, missionId: string) => requestClash(account, missionId)
