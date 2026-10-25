/** Appearance belongs to this sign-in, not the account or a future sign-in. */
export type Theme = 'light' | 'dark'

const KEY = 'kea-session-theme'
const LEGACY_KEY = 'kea-theme'
export const THEME_CHANGE_EVENT = 'kea-theme-change'
let currentTheme: Theme = 'light'
let storageFailed = false

export function getTheme(): Theme {
  if (storageFailed) return currentTheme
  try {
    return sessionStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    storageFailed = true
    return currentTheme
  }
}

function paintTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute(
    'href',
    theme === 'dark' ? '/assets/brand/kea-favicon.svg' : '/assets/brand/kea-favicon-light.svg',
  )
}

export function setTheme(theme: Theme): void {
  currentTheme = theme
  try {
    sessionStorage.setItem(KEY, theme)
  } catch {
    // Switching still works when this browser disallows session storage.
    storageFailed = true
  }
  paintTheme(theme)
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

function forgetLegacyTheme(): void {
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Old persistent preferences are never read, even if they cannot be removed.
  }
}

export function resetTheme(): void {
  currentTheme = 'light'
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // The in-memory value still resets for this sign-in.
    storageFailed = true
  }
  forgetLegacyTheme()
  paintTheme('light')
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

/** Run before React renders so a signed-out page never flashes the previous theme. */
export function initializeTheme(signedIn: boolean): void {
  forgetLegacyTheme()
  if (!signedIn) {
    resetTheme()
    return
  }
  currentTheme = getTheme()
  paintTheme(currentTheme)
}
