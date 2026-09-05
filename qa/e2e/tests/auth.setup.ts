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
 */

setup('the API offers exactly the accounts this suite covers', async ({ request }) => {
  const live = await getDemoAccounts(request)

  // The guard that makes a hardcoded list safe. A new fixture household must either be
  // added to ACCOUNTS or consciously excluded — it cannot slip past uncovered.
  expect(
    live.map((a) => a.customer_id).sort(),
    'GET /api/auth/demo-accounts disagrees with fixtures/accounts.ts. ' +
      'If Harvey or Akash added an account, add it to ACCOUNTS with the right `kind`.',
  ).toEqual(ACCOUNTS.map((a) => a.customerId).sort())

  for (const account of ACCOUNTS) {
    const card = live.find((a) => a.customer_id === account.customerId)
    expect(card?.display_name, `display name drifted for ${account.customerId}`).toBe(
      account.displayName,
    )
  }
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
