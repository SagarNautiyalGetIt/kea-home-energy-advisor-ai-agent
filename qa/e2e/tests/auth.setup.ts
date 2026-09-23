import { expect, test as setup } from '@playwright/test'
import { getDemoAccounts } from '../api/client'
import { ACCOUNTS, authFile } from '../fixtures/accounts'

/**
 * Signs in once per account and parks the session for the rest of the suite.
 *
 * Sign-in here is `localStorage['kea-demo-session']`, not a token
 * (`services/web/src/lib/session.ts`). Playwright's `storageState` captures
 * `localStorage`, so this works unchanged today and will keep working when the session
 * becomes a real one — which is the reason to go through the form rather than writing the
 * key directly. The form is also the app's only account switcher, so exercising it for
 * every account is coverage, not overhead.
 *
 * ## Only preconditions belong in this file
 *
 * Every project depends on `setup` (`playwright.config.ts`), and Playwright refuses to
 * START a dependent project when any test in its dependency failed. So a red test here
 * does not cost you one result — it costs you the whole run, reported as `did not run`
 * rather than as a failure.
 *
 * That power is correct for the sign-ins below: without a `storageState` file the tests
 * that consume it physically cannot execute, so skipping them is honest.
 *
 * It was wrong for the account-list guard that used to live here. That guard asserted the
 * API offers *exactly* the accounts `ACCOUNTS` covers — a statement about coverage, not
 * about whether anything can run. When Akash added `H-ZARA` and `H-AROHA` (two accounts
 * built for the assistant, unrelated to Dashboard or Billing), all fourteen sign-ins
 * still passed and every storageState file was written, and 565 perfectly runnable tests
 * were skipped anyway to report a stale list.
 *
 * That half of the check was removed, not relocated — see CONVENTIONS.md §12 for the
 * tradeoff that leaves and why it was judged acceptable for these two pages. What stays
 * here is the half that really is a precondition: an account this suite covers must
 * exist, or it cannot be signed into.
 */

setup('every account this suite covers is offered by the API', async ({ request }) => {
  const live = await getDemoAccounts(request)
  const offered = new Set(live.map((a) => a.customer_id))

  // Blocking on purpose, and narrowly: only accounts we are ABOUT TO SIGN IN AS. One that
  // vanished cannot be signed into, so the sign-in below would fail anyway — failing here
  // says why in one line instead of fourteen browser timeouts.
  //
  // This direction only: `ACCOUNTS ⊆ API`. The other direction — the API offering
  // something this suite does not cover — is not a precondition, is not checked
  // anywhere else either, and CONVENTIONS.md §12 says why.
  const missing = ACCOUNTS.map((a) => a.customerId).filter((id) => !offered.has(id))
  expect(
    missing,
    'these accounts are in fixtures/accounts.ts but GET /api/auth/demo-accounts no longer ' +
      'offers them, so there is no session to park for them. Remove them from ACCOUNTS, ' +
      'or find out who took them away.',
  ).toEqual([])
})

for (const account of ACCOUNTS) {
  setup(`sign in as ${account.displayName}`, async ({ page, request }) => {
    const card = (await getDemoAccounts(request)).find(
      (a) => a.customer_id === account.customerId,
    )
    expect(card, `no demo account for ${account.customerId}`).toBeDefined()

    await page.goto('/login')
    await page.getByLabel('Email').fill(card!.email)
    // Anchored: the eye toggle's aria-label is "Show password", which a bare
    // substring match would also hit and trip strict mode.
    await page.getByLabel(/^Password/).fill(card!.password)
    await page.getByRole('button', { name: 'Login' }).click()

    // Signed in when the app has left /login for the dashboard. Waiting on the URL rather
    // than a timeout is what keeps this honest on a slow CI runner.
    await page.waitForURL('**/dashboard')
    await expect(page.getByText(/^Welcome,\s+/)).toBeVisible()

    await page.context().storageState({ path: authFile(account.customerId) })
  })
}
