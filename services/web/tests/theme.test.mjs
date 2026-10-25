import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Exercise the production modules, as solar.test.mjs does, without generating JS files.
let moduleInstance = 0
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText + `\n// Test instance ${moduleInstance++}\n`,
).toString('base64')

async function loadModules() {
  const themeUrl = moduleUrl(readFileSync(new URL('../src/lib/theme.ts', import.meta.url), 'utf8'))
  const theme = await import(themeUrl)
  const sessionSource = readFileSync(new URL('../src/lib/session.ts', import.meta.url), 'utf8')
    .replace(/from\s+(['"])\.\/theme\1/, `from ${JSON.stringify(themeUrl)}`)
  const session = await import(moduleUrl(sessionSource))
  return { theme, session }
}

class MemoryStorage {
  constructor(items = {}, failures = []) {
    this.items = new Map(Object.entries(items))
    this.failures = new Set(failures)
  }

  check(operation) {
    if (this.failures.has(operation)) throw new DOMException('Storage unavailable', 'QuotaExceededError')
  }

  getItem(key) { this.check('read'); return this.items.get(key) ?? null }
  setItem(key, value) { this.check('write'); this.items.set(key, String(value)) }
  removeItem(key) { this.check('remove'); this.items.delete(key) }
}

function browser(t, { local = {}, tab = {}, localFailures = [], tabFailures = [] } = {}) {
  const localStorage = new MemoryStorage(local, localFailures)
  const sessionStorage = new MemoryStorage(tab, tabFailures)
  const favicon = { href: '', setAttribute(name, value) { this[name] = value } }
  const document = { documentElement: { dataset: {} }, querySelector: () => favicon }
  const window = new EventTarget()
  Object.assign(window, { localStorage, sessionStorage })
  const values = { localStorage, sessionStorage, document, window }
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { ...values, favicon }
}

function expectAppearance(environment, theme, expected) {
  assert.equal(theme.getTheme(), expected)
  assert.equal(environment.document.documentElement.dataset.theme, expected)
  assert.equal(environment.favicon.href, `/assets/brand/kea-favicon${expected === 'light' ? '-light' : ''}.svg`)
}

const accountA = { customerId: 'ACCOUNT-A', accessToken: 'test-token-a', displayName: 'Account A', scenario: 'theme test' }
const accountB = { customerId: 'ACCOUNT-B', accessToken: 'test-token-b', displayName: 'Account B', scenario: 'theme test' }

test('signed-out pages discard old persistent and tab themes before showing light', async (t) => {
  const environment = browser(t, { local: { 'kea-theme': 'dark' }, tab: { 'kea-session-theme': 'dark' } })
  const { theme } = await loadModules()
  theme.initializeTheme(false)
  expectAppearance(environment, theme, 'light')
  assert.equal(environment.localStorage.getItem('kea-theme'), null)
  assert.equal(environment.sessionStorage.getItem('kea-session-theme'), null)
})

test('legacy account/device theme cannot choose the appearance of a fresh sign-in', async (t) => {
  const environment = browser(t, { local: { 'kea-theme': 'dark' } })
  const { theme } = await loadModules()
  theme.initializeTheme(true)
  expectAppearance(environment, theme, 'light')
  assert.equal(environment.localStorage.getItem('kea-theme'), null)
})

test('same-tab refresh retains the current sign-in choice and ignores conflicting legacy themes', async (t) => {
  const environment = browser(t)
  let { theme } = await loadModules()
  theme.initializeTheme(true)
  theme.setTheme('dark')
  environment.localStorage.setItem('kea-theme', 'light')
  ;({ theme } = await loadModules())
  theme.initializeTheme(true)
  expectAppearance(environment, theme, 'dark')
  assert.equal(environment.localStorage.getItem('kea-theme'), null)

  theme.setTheme('light')
  environment.localStorage.setItem('kea-theme', 'dark')
  ;({ theme } = await loadModules())
  theme.initializeTheme(true)
  expectAppearance(environment, theme, 'light')
})

test('successful login resets dark for both the same account and a different account', async (t) => {
  const environment = browser(t)
  const { theme, session } = await loadModules()
  for (const account of [accountA, accountA, accountB]) {
    theme.setTheme('dark')
    session.signIn(account)
    assert.deepEqual(session.loadSession(), account)
    expectAppearance(environment, theme, 'light')
    assert.equal(environment.sessionStorage.getItem('kea-session-theme'), null)
  }
})

test('logout removes the identity and resets the login appearance immediately', async (t) => {
  const environment = browser(t)
  const { theme, session } = await loadModules()
  session.signIn(accountA)
  theme.setTheme('dark')
  session.signOut()
  assert.equal(session.loadSession(), null)
  expectAppearance(environment, theme, 'light')
  assert.equal(environment.sessionStorage.getItem('kea-session-theme'), null)
})

test('missing and malformed authentication never restore a stale dark tab theme', async (t) => {
  const environment = browser(t)
  const { theme, session } = await loadModules()
  for (const stored of [null, 'true', '{broken', 'null', '{}', '{"displayName":"Old account"}']) {
    if (stored === null) environment.localStorage.removeItem('kea-demo-session')
    else environment.localStorage.setItem('kea-demo-session', stored)
    theme.setTheme('dark')
    const restored = session.loadSession()
    assert.equal(restored, null, `invalid session ${stored}`)
    theme.initializeTheme(Boolean(restored))
    expectAppearance(environment, theme, 'light')
  }
})

test('unknown stored appearances fall back to light', async (t) => {
  const environment = browser(t)
  const { theme } = await loadModules()
  for (const stored of ['', 'sepia', 'DARK', 'null', '{}']) {
    environment.sessionStorage.setItem('kea-session-theme', stored)
    theme.initializeTheme(true)
    expectAppearance(environment, theme, 'light')
  }
})

test('theme events let multiple controls read the painted appearance immediately', async (t) => {
  const environment = browser(t)
  const { theme } = await loadModules()
  theme.initializeTheme(false)
  assert.equal(theme.THEME_CHANGE_EVENT, 'kea-theme-change')
  const firstControl = []
  const secondControl = []
  environment.window.addEventListener(theme.THEME_CHANGE_EVENT, () => {
    expectAppearance(environment, theme, theme.getTheme())
    firstControl.push(theme.getTheme())
  })
  environment.window.addEventListener(theme.THEME_CHANGE_EVENT, () => secondControl.push(theme.getTheme()))
  theme.setTheme('dark')
  theme.setTheme('light')
  theme.resetTheme()
  assert.deepEqual(firstControl, ['dark', 'light', 'light'])
  assert.deepEqual(secondControl, firstControl)
})

test('blocked browser storage still allows switching and resetting the current page', async (t) => {
  const environment = browser(t, { localFailures: ['read', 'write', 'remove'], tabFailures: ['read', 'write', 'remove'] })
  const { theme } = await loadModules()
  theme.initializeTheme(true)
  expectAppearance(environment, theme, 'light')
  theme.setTheme('dark')
  expectAppearance(environment, theme, 'dark')
  theme.resetTheme()
  expectAppearance(environment, theme, 'light')
  theme.initializeTheme(false)
  expectAppearance(environment, theme, 'light')
})

test('a full storage quota cannot make controls disagree with the newly painted theme', async (t) => {
  const environment = browser(t, { tab: { 'kea-session-theme': 'light' }, tabFailures: ['write'] })
  const { theme } = await loadModules()
  theme.initializeTheme(true)
  const observed = []
  environment.window.addEventListener(theme.THEME_CHANGE_EVENT, () => observed.push(theme.getTheme()))
  theme.setTheme('dark')
  expectAppearance(environment, theme, 'dark')
  assert.deepEqual(observed, ['dark'])
})

test('failed storage removal cannot carry dark into logout or the next login', async (t) => {
  const environment = browser(t, { tabFailures: ['remove'] })
  const { theme, session } = await loadModules()
  theme.initializeTheme(true)
  theme.setTheme('dark')
  session.signOut()
  expectAppearance(environment, theme, 'light')
  session.signIn(accountB)
  expectAppearance(environment, theme, 'light')
})

test('storing a refreshed session mid-visit keeps the chosen theme', async (t) => {
  const environment = browser(t)
  const { theme, session } = await loadModules()
  session.signIn(accountA)
  theme.setTheme('dark')
  session.saveSession({ ...accountA, displayName: 'Renamed' })
  expectAppearance(environment, theme, 'dark')
  session.clearSession()
  expectAppearance(environment, theme, 'dark')
})
