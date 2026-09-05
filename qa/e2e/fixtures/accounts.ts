/**
 * The demo sign-ins, and which database each one lives in.
 *
 * ## Why 14 and not 9
 *
 * Harvey's ELT loads **nine** fixture households into `kea.*` — one row each in
 * `kea.mart_account_context`, and those are the nine on the Metabase dashboard. The API
 * team seeds a **further five** hand-shaped households into `public.customer` with
 * `make api-seed`. `services/api/app/auth.py` offers all fourteen as sign-ins, so the
 * login page shows fourteen and the database shows nine. Both counts are right; they are
 * counting different things.
 *
 * That split is not cosmetic — it decides what a test may assert against:
 *
 * | kind     | rows in                      | name in the database? |
 * |----------|------------------------------|-----------------------|
 * | `mart`   | `kea.mart_account_context`   | yes, `customer_name`  |
 * | `seed`   | `public.customer`            | **no** — deliberately |
 *
 * `auth.py` explains the `seed` case: those customers "carry no name in the database,
 * because 47.6% of surveyed customers said they would not trust an AI with their data".
 * The names are labels in the Python file and are never written back. So a `seed`
 * account's greeting can only be checked against the API; a `mart` account's can and
 * should be checked against Postgres.
 *
 * ## Why this list is hardcoded, and why that is safe
 *
 * Playwright needs the account list **at collection time** to generate one describe block
 * per account, which rules out an `await` on `/api/auth/demo-accounts`. The usual failure
 * of a hardcoded list is that it goes stale silently — a new fixture household is added
 * and the suite keeps passing while covering one account less.
 *
 * `auth.setup.ts` closes that hole: it fails if the API's list and this one disagree. So
 * this is a snapshot of a contract with a guard on it, not a copy of the credentials.
 * Passwords are deliberately absent — setup reads those from the API at run time.
 */

export type AccountKind = 'mart' | 'seed'

export interface DemoAccount {
  /** The account NUMBER. This — never the email — is the key that joins a signed-in
   *  session to a database row; `billing.customer.email` is NULL for all nine fixtures. */
  customerId: string
  displayName: string
  kind: AccountKind
}

export const ACCOUNTS: DemoAccount[] = [
  // public.customer — seeded by `make api-seed`, no name held in the database
  { customerId: 'H-JUL', displayName: 'July Household', kind: 'seed' },
  { customerId: 'H-COLD', displayName: 'Cold Snap Household', kind: 'seed' },
  { customerId: 'H-SPIKE', displayName: 'Spike Household', kind: 'seed' },
  { customerId: 'H-DROP', displayName: 'Usage Collapse Household', kind: 'seed' },
  { customerId: 'H-TARIFF', displayName: 'Low User Household', kind: 'seed' },
  // kea.mart_account_context — Harvey's nine, loaded by `make data-load`
  { customerId: 'DEMO-ACCT-221001', displayName: 'Julia Fox', kind: 'mart' },
  { customerId: 'DEMO-ACCT-222001', displayName: 'Ana Whitiora', kind: 'mart' },
  { customerId: 'DEMO-ACCT-223001', displayName: 'Tama Rewiri', kind: 'mart' },
  { customerId: 'DEMO-ACCT-224001', displayName: 'Mere Kahu', kind: 'mart' },
  { customerId: 'DEMO-ACCT-225001', displayName: 'Josh Fuller', kind: 'mart' },
  { customerId: 'DEMO-ACCT-226001', displayName: 'Priya Raman', kind: 'mart' },
  { customerId: 'DEMO-ACCT-227001', displayName: 'Daniel Okafor', kind: 'mart' },
  { customerId: 'DEMO-ACCT-228001', displayName: 'Rangi Paterson', kind: 'mart' },
  { customerId: 'DEMO-ACCT-229001', displayName: 'Mereana Tipene', kind: 'mart' },
]

/** Where `auth.setup.ts` parks the signed-in state for one account. */
export function authFile(customerId: string): string {
  return `playwright/.auth/${customerId}.json`
}
