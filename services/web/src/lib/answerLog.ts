/**
 * Demo line 6 — the evidence log.
 *
 * > *(operator shows the log)* — N answers, every figure traced to a source.
 * > The 61.9% concern, answered with evidence.
 *
 * ## What this records now, and why it changed
 *
 * It used to record the number-checker's verdict: how many numeric tokens in the
 * model's draft matched a fact in the bundle it had been handed. That was the right
 * evidence for the architecture it was built for, where the model could not see any
 * data and a figure outside the bundle could only have been invented.
 *
 * The assistant reads the data itself now, and is expected to work things out — a
 * bill up 14%, a daily load annualised to $263. Token-matching against a permitted
 * list would reject exactly the arithmetic that makes an explanation an explanation.
 *
 * So the claim changed shape, and it is the stronger one: **every answer names the
 * lookups behind it, and every lookup names its source.** Not "no figure outside a
 * list" but "here is the row this came from". That is what a customer disputing a
 * figure actually needs, and unlike the old verdict it survives the model getting
 * better at arithmetic.
 *
 * Deliberately in-memory and per-session. The durable record is the
 * `app.agent_tool_call` table the backend writes; this is the operator's window onto
 * the run happening right now, and a demo that reads its evidence out of a database
 * it also has to seed is a demo with one more thing to go wrong on stage.
 */

import type { DoneEvent, SourceRef } from './client'

export interface AnswerRecord {
  id: number
  at: Date
  customerId: string
  question: string
  /** Every lookup behind the answer, in the order it was made. */
  sources: SourceRef[]
  escalated: boolean
  latencyMs: number
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
const STORAGE_KEY = 'kea-answer-log'

const listeners = new Set<() => void>()
let records: AnswerRecord[] = load()
let nextId = records.reduce((max, r) => Math.max(max, r.id), 0) + 1

function load(): AnswerRecord[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    // `at` comes back as an ISO string; the UI calls Date methods on it.
    return (JSON.parse(raw) as AnswerRecord[]).map((r) => ({ ...r, at: new Date(r.at) }))
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

export function recordAnswer(entry: Omit<AnswerRecord, 'id' | 'at'>): AnswerRecord {
  const record: AnswerRecord = { ...entry, id: nextId++, at: new Date() }
  records.push(record)
  persist()
  listeners.forEach((fn) => fn())
  return record
}

export const fromDoneEvent = (
  done: DoneEvent,
  meta: { customerId: string; question: string },
) =>
  recordAnswer({
    customerId: meta.customerId,
    question: meta.question,
    sources: done.sources ?? [],
    escalated: done.escalate_to_human,
    latencyMs: done.latency_ms,
  })

export const getAnswerLog = (): readonly AnswerRecord[] => records

export function clearAnswerLog(): void {
  records = []
  persist()
  listeners.forEach((fn) => fn())
}

export function subscribeToAnswerLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export interface AnswerTally {
  answers: number
  lookups: number
  /**
   * Answers that consulted no data at all.
   *
   * The headline, and the reason this page can still report bad news. An answer with
   * no lookups behind it is one the model wrote from the system prompt — which is
   * exactly the failure the old architecture made structurally impossible and this
   * one has to detect instead. Anything above zero deserves a look.
   */
  unsourced: number
  /** Lookups that failed or found nothing. Not a fault — a declared gap. */
  gaps: number
  escalations: number
}

export function tally(log: readonly AnswerRecord[] = records): AnswerTally {
  return {
    answers: log.length,
    lookups: log.reduce((n, r) => n + r.sources.length, 0),
    unsourced: log.filter((r) => r.sources.filter((s) => s.ok).length === 0).length,
    gaps: log.reduce((n, r) => n + r.sources.filter((s) => !s.ok).length, 0),
    escalations: log.filter((r) => r.escalated).length,
  }
}
