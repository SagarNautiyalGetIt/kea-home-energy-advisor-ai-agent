/**
 * Keeping the conversation across a page change.
 *
 * The assistant's thread lived in component state, so navigating to Usage and back
 * unmounted the page and took the conversation with it. Nothing warned you — the start
 * screen simply came back, and a question you had asked two minutes ago was gone along
 * with the answer. On a product whose whole value is a conversation about your own
 * account, that is the single most annoying thing it did.
 *
 * ## Why this is not fetched from the server
 *
 * The turns are already persisted: `app.conversation` and `app.turn` hold every message,
 * and `conversation_id` comes back on the `done` event. Restoring from there would also
 * carry the thread to a different device, which this does not.
 *
 * It would also need a read endpoint that returns one customer's conversation, which is
 * a new authenticated surface over stored chat — and the sign-in in front of it today is
 * `app/auth.py`, which says in its own docstring that it is not authentication. Building
 * a history endpoint against it would put every customer's past conversations one
 * guessed id away. So the thread stays on the device that produced it until there is a
 * real session to gate it with.
 *
 * ## Scoping
 *
 * Keyed by `customerId`, so signing in as a different demo account shows that account's
 * thread and never the previous one's. Cleared on logout, and by "New chat".
 */

const KEY = 'kea-assistant-thread'

/** Bumped when the stored shape changes, so an old blob is dropped rather than crashing
 *  the page it is read into. */
const VERSION = 1

export interface StoredThread<M> {
  version: number
  customerId: string
  messages: M[]
  started: boolean
  conversationId: number | null
  nextId: number
}

export function loadThread<M>(customerId: string): StoredThread<M> | null {
  if (!customerId) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredThread<M>
    // A thread belonging to another account is not this customer's to show, and a blob
    // from an older build is not worth guessing at.
    if (parsed.version !== VERSION || parsed.customerId !== customerId) return null
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

export function saveThread<M>(thread: Omit<StoredThread<M>, 'version'>): void {
  if (!thread.customerId) return
  try {
    // Upload extraction belongs to the active request, not a new persistent bill copy.
    const messages = thread.messages.map((message) => {
      if (!message || typeof message !== 'object') return message
      const displayed = { ...message } as Record<string, unknown>
      delete displayed.requestText
      return displayed
    })
    localStorage.setItem(KEY, JSON.stringify({ ...thread, messages, version: VERSION }))
  } catch {
    // A full quota must not take out the page. Losing the saved thread is the same
    // outcome as before this file existed, and the live one is untouched.
  }
}

export function clearThread(): void {
  localStorage.removeItem(KEY)
}
