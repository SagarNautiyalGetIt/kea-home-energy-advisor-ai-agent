/**
 * Who is signed in, and which household that means.
 *
 * The prototype session used to be `localStorage['kea-demo-session'] === 'true'` — a
 * boolean. Every page then picked `households[0]`, so all fourteen logins showed the
 * same customer and the app had no concept of "you". This holds the identity instead.
 *
 * Still `localStorage`, still no token, still not authentication: see
 * `services/api/app/auth.py` for why that is acceptable against synthetic accounts and
 * what has to replace it before a real one. The single rule worth keeping is that
 * `customerId` is read from here rather than guessed, so when the session becomes real
 * there is one place to change.
 */

const KEY = 'kea-demo-session'

export interface Session {
  customerId: string
  displayName: string
  /** What this account is for — shown on the profile chip so a tester knows which
   *  scenario they are looking at without cross-referencing the credentials list. */
  scenario: string
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Session>
    // A session without a customerId is worse than none: pages would fall back to
    // households[0] and silently show the wrong person's usage.
    if (!parsed.customerId) return null
    return {
      customerId: parsed.customerId,
      displayName: parsed.displayName ?? parsed.customerId,
      scenario: parsed.scenario ?? '',
    }
  } catch {
    // Pre-session-object value ("true") from an older build. Treat as signed out
    // rather than crashing every page on load.
    return null
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
}
