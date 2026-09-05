import { test as base } from '@playwright/test'
import { createDb, type KeaDb } from './db'
import { DashboardPage } from '../pages/DashboardPage'

/**
 * The `test` every spec imports, instead of `@playwright/test` directly.
 *
 * Two fixtures, and the scope of each is the whole point:
 *
 * - **`db` is worker-scoped.** One connection pool per worker, opened on first use and
 *   closed when the worker exits. A test-scoped pool would open and tear down a Postgres
 *   connection for every test — for fourteen accounts × several tests that is a hundred
 *   handshakes to read a handful of rows, and the suite would spend longer connecting
 *   than asserting.
 * - **`dashboard` is test-scoped**, because it wraps a `page`, and pages are.
 */
export const test = base.extend<{ dashboard: DashboardPage }, { db: KeaDb }>({
  db: [
    async ({}, use) => {
      const { db, close } = createDb()
      await use(db)
      await close()
    },
    { scope: 'worker' },
  ],

  dashboard: async ({ page }, use) => {
    await use(new DashboardPage(page))
  },
})

export { expect } from '@playwright/test'
