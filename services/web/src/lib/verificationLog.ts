/**
 * Demo line 6 — the verification log.
 *
 * > *(operator shows the verification log)* — N prompts, 0 fabricated figures.
 * > The 61.9% concern, answered with evidence.
 *
 * The golden set proves this property in CI against fixed cases. This proves it live,
 * against whatever the judge actually typed, which is the version that survives someone
 * asking "yes, but does it do that on my question?".
 *
 * Deliberately in-memory and per-session. The durable record is the `verification` table
 * the backend writes; this is the operator's window onto the run happening right now, and
 * a demo that reads its evidence out of a database it also has to seed is a demo with one
 * more thing to go wrong on stage.
 */

import type { DoneEvent } from './client'

export interface VerificationRecord {
  id: number
  at: Date
  customerId: string
  question: string
  intent: string
  /** The model's draft survived the number-checker. */
  passed: boolean
  /**
   * The answer was built directly from computed facts, bypassing the model.
   * Not a failure — text that cannot contain an uncomputed number.
   */
  fellBackToTemplate: boolean
  checked: string[]
  unverified: string[]
}

/**
 * Persisted to `sessionStorage`, not held only in memory.
 *
 * Found by running the demo rather than by reading the code: the operator reaches this
 * view by typing `/verification`, which is a full page load and wiped the log every
 * time. The evidence for line 6 disappearing at the moment it is shown is the worst
 * possible failure. `sessionStorage` survives a reload and still clears with the tab,
 * which is the right lifetime for "this session".
 */
const STORAGE_KEY = 'kea-verification-log'

const listeners = new Set<() => void>()
let records: VerificationRecord[] = load()
let nextId = records.reduce((max, r) => Math.max(max, r.id), 0) + 1

function load(): VerificationRecord[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    // `at` comes back as an ISO string; the UI calls Date methods on it.
    return (JSON.parse(raw) as VerificationRecord[]).map((r) => ({ ...r, at: new Date(r.at) }))
  } catch {
    return []
  }
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // Private browsing, or quota. The log still works for this page view — degrading to
    // in-memory is much better than taking the page down mid-demo.
  }
}

export function recordVerification(
  entry: Omit<VerificationRecord, 'id' | 'at'>,
): VerificationRecord {
  const record: VerificationRecord = { ...entry, id: nextId++, at: new Date() }
  records.push(record)
  persist()
  listeners.forEach((fn) => fn())
  return record
}

export const fromDoneEvent = (
  done: DoneEvent,
  meta: { customerId: string; question: string; intent: string },
) =>
  recordVerification({
    customerId: meta.customerId,
    question: meta.question,
    intent: meta.intent,
    passed: done.passed,
    fellBackToTemplate: done.fell_back_to_template,
    checked: done.checked ?? [],
    unverified: done.unverified ?? [],
  })

export const getVerificationLog = (): readonly VerificationRecord[] => records

export function clearVerificationLog(): void {
  records = []
  persist()
  listeners.forEach((fn) => fn())
}

export function subscribeToVerificationLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export interface VerificationTally {
  answers: number
  figuresChecked: number
  /** The headline. Anything above zero and the claim is false — say so, loudly. */
  fabricated: number
  templateAnswers: number
}

export function tally(log: readonly VerificationRecord[] = records): VerificationTally {
  return {
    answers: log.length,
    figuresChecked: log.reduce((n, r) => n + r.checked.length, 0),
    fabricated: log.reduce((n, r) => n + r.unverified.length, 0),
    templateAnswers: log.filter((r) => r.fellBackToTemplate).length,
  }
}
