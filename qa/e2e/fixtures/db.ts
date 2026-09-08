import { Pool } from 'pg'

/**
 * Read-only access to the application's Postgres, for resolving expected values.
 *
 * ## Which database
 *
 * There are two, and they are not synced:
 *
 * | port | what it is | who reads it |
 * |------|------------|--------------|
 * | 5432 | the application's Postgres (`infra/pg-local.sh`) | **the API — so, us** |
 * | 5433 | Harvey's warehouse (`kea-kea-serving-db-1`)      | Metabase |
 *
 * This connects to 5432, because the question these tests ask is "does the screen agree
 * with the data the API served", and the API reads 5432. Asserting against 5433 would
 * compare the UI to a database nothing in the request path has ever opened.
 *
 * ## Which credential
 *
 * `kea_app` — the role the schema ships with SELECT and nothing else. A test suite that
 * cannot write is a test suite that cannot corrupt the fixtures it is asserting against,
 * which matters more here than usual: these tests run against the same database the demo
 * runs on.
 *
 * ## Which tables, and why not more
 *
 * Only `kea.*` marts and the `billing.account` row needed to join to them. The marts are
 * pre-aggregated on purpose — reproducing that aggregation here (summing
 * `metering.meter_read_hh` by hand, applying tariffs) would mean a failing assertion has
 * three possible causes: the app, the mart, or this file's arithmetic. A query that only
 * reads a column has one.
 *
 * The exception is a straight `sum()` over a mart column, which is arithmetic simple
 * enough to be unambiguous. Anything past that belongs in dbt tests, not here.
 */

/** One row of `kea.mart_account_context` — "who am I talking to". */
export interface AccountContext {
  accountNumber: string
  customerName: string
  /** `billing.customer.customer_number`. Not the same as the account number, and for
   *  Julia Fox not even close to it — 196501 against DEMO-ACCT-221001. */
  customerNumber: string
  /** `kea.mart_account_context.address_display` — e.g. "8 Hataitai Road, Hataitai".
   *  Nothing like the "6 Mount Street, Auckland Central" the Billing page prints. */
  addressDisplay: string
  /** `plan_name` / `plan_code` from the same mart row. Every seeded account is on a
   *  time-of-use plan; the Billing page's invoice header says "Anytime Rate". */
  planName: string
  planCode: string
  icpId: number
  periodStart: string
  periodEnd: string
  isQuarantined: boolean
}

export interface KeaDb {
  /**
   * The `mart` account's identity row. Returns null for a `seed` account: those live in
   * `public.customer` and hold no name — see `fixtures/accounts.ts`.
   */
  accountContext(accountNumber: string): Promise<AccountContext | null>
  /**
   * Total `import_kwh` from `kea.mart_daily_usage` over an inclusive date range.
   *
   * Verified to reconcile: DEMO-ACCT-223001 over 2024-06-01..2024-06-30 sums to 447.3,
   * which is exactly the `usage_so_far_kwh` the bill-shock endpoint returns. That makes
   * this a genuine database-to-screen assertion rather than an API-to-screen one.
   *
   * `import_kwh` only — export is a separate direction, and adding it would quietly
   * inflate the figure for the one fixture that has solar.
   */
  importKwhBetween(accountNumber: string, from: string, to: string): Promise<number | null>
  /**
   * How many bills this account has, and how many of them the mart could compare with a
   * previous one.
   *
   * Exists to check a claim the UI makes about the data rather than a number it renders:
   * the warning card states "Kea does not hold your billing history". `billing.bill` is
   * where that would be false.
   */
  billHistory(accountNumber: string): Promise<{ bills: number; withPrior: number }>
  /**
   * This account's most recent real bill — the one the Billing page's "Current
   * balance" card claims to be showing.
   *
   * Returns null for a `seed` account: `billing.account` has no row for them, the
   * same reason `billHistory` returns zero. `payment_method` comes along for free
   * from the same join, because it is the fact that settles whether "Visa ending
   * in 4242" could ever be true — `common.payment_method` is an enum of
   * `direct_debit | bank_transfer | card | other`; there is no column anywhere in
   * the schema that could hold a card number or a card brand.
   */
  latestBill(accountNumber: string): Promise<LatestBill | null>
  /**
   * Every bill this account has, newest period first — what the Invoice History
   * table would show if it were reading anything.
   *
   * Counts differ per account and that is the point: Julia has one, Rangi has
   * thirteen, everyone else has two. The page renders exactly three rows for all of
   * them.
   */
  bills(accountNumber: string): Promise<Bill[]>
}

export interface Bill {
  invoiceNumber: string
  periodStart: string
  periodEnd: string
  /** ISO date string. Every real bill in this dataset is due exactly 15 days after
   *  `periodEnd` — verified across all 28 rows in `billing.bill`, not a guess. */
  dueDate: string
  totalCharges: number
  chargesExclGst: number
  /** Zero on every fixture row. The schema defaults `gst_rate` to 0.15, but the
   *  loader never populated it, so `gst_amount` is 0.00 and `total_charges` equals
   *  `charges_excl_gst` throughout. */
  gstAmount: number
  gstRate: number
  /** Zero on all 28 rows — Harvey's fixtures carry no late-payment data at all. */
  latePaymentFee: number
  /** NULL on all 28 rows, for the same reason. */
  totalIfPaidLate: number | null
  /** `common.bill_status`: draft | issued | paid | overdue | cancelled. Every
   *  fixture bill is `issued`; none is `paid`, which is a different vocabulary from
   *  the UI's own Due/Paid badge. */
  status: string
}

export interface LatestBill extends Bill {
  /** `common.payment_method`: direct_debit | bank_transfer | card | other. Every one
   *  of the nine seeded accounts is `direct_debit`. */
  paymentMethod: string
}

/** Shared select list, so `latestBill` and `bills` can never drift apart. Dates are
 *  cast to text in SQL for the timezone reason explained on `accountContext`. */
const BILL_COLUMNS = `select b.invoice_number,
                b.period_start::text as period_start,
                b.period_end::text   as period_end,
                b.due_date::text     as due_date,
                b.total_charges, b.charges_excl_gst, b.gst_amount, b.gst_rate,
                b.late_payment_fee, b.total_if_paid_late, b.status::text as status`

function toBill(r: Record<string, unknown>): Bill {
  return {
    invoiceNumber: r.invoice_number as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    dueDate: r.due_date as string,
    totalCharges: Number(r.total_charges),
    chargesExclGst: Number(r.charges_excl_gst),
    gstAmount: Number(r.gst_amount),
    gstRate: Number(r.gst_rate),
    latePaymentFee: Number(r.late_payment_fee),
    totalIfPaidLate: r.total_if_paid_late === null ? null : Number(r.total_if_paid_late),
    status: r.status as string,
  }
}

export function createDb(): { db: KeaDb; close: () => Promise<void> } {
  // Defaults match `infra/pg-local.sh`. Overridable so the same suite can point at a
  // deployed database without editing a test.
  const pool = new Pool({
    host: process.env.KEA_DB_HOST ?? 'localhost',
    port: Number(process.env.KEA_DB_PORT ?? 5432),
    user: process.env.KEA_DB_USER ?? 'kea_app',
    password: process.env.KEA_DB_PASSWORD ?? 'kea_app',
    database: process.env.KEA_DB_NAME ?? 'kea',
    max: 2,
  })

  const db: KeaDb = {
    async accountContext(accountNumber) {
      const { rows } = await pool.query(
        // Cast to text in SQL rather than converting in JS. node-postgres parses a
        // Postgres `date` into a JS Date at LOCAL midnight; calling .toISOString() on
        // that in NZ (UTC+12) rolls the calendar date back a day, which silently shortens
        // every period by one and made this suite under-count usage by ~13 kWh. The
        // database already stores exactly the string we want.
        `select account_number, customer_name, customer_number::text as customer_number,
                address_display, plan_name, plan_code, icp_id,
                current_period_start::text as current_period_start,
                current_period_end::text   as current_period_end,
                is_quarantined
           from kea.mart_account_context
          where account_number = $1`,
        [accountNumber],
      )
      if (!rows.length) return null
      const r = rows[0]
      return {
        accountNumber: r.account_number,
        customerName: r.customer_name,
        customerNumber: r.customer_number,
        addressDisplay: r.address_display,
        planName: r.plan_name,
        planCode: r.plan_code,
        icpId: Number(r.icp_id),
        periodStart: r.current_period_start,
        periodEnd: r.current_period_end,
        isQuarantined: r.is_quarantined,
      }
    },

    async billHistory(accountNumber) {
      const { rows } = await pool.query(
        `select count(distinct b.bill_id)::int as bills,
                count(distinct e.bill_id) filter (where e.prior_bill_id is not null)::int
                  as with_prior
           from billing.account a
           left join billing.bill b on b.account_id = a.account_id
           left join kea.mart_bill_explanation e on e.bill_id = b.bill_id
          where a.account_number = $1`,
        [accountNumber],
      )
      return { bills: rows[0]?.bills ?? 0, withPrior: rows[0]?.with_prior ?? 0 }
    },

    async latestBill(accountNumber) {
      const { rows } = await pool.query(
        `${BILL_COLUMNS}, a.payment_method::text as payment_method
           from billing.bill b
           join billing.account a on a.account_id = b.account_id
          where a.account_number = $1
          order by b.period_end desc
          limit 1`,
        [accountNumber],
      )
      if (!rows.length) return null
      return { ...toBill(rows[0]), paymentMethod: rows[0].payment_method }
    },

    async bills(accountNumber) {
      const { rows } = await pool.query(
        `${BILL_COLUMNS}
           from billing.bill b
           join billing.account a on a.account_id = b.account_id
          where a.account_number = $1
          order by b.period_end desc`,
        [accountNumber],
      )
      return rows.map(toBill)
    },

    async importKwhBetween(accountNumber, from, to) {
      const { rows } = await pool.query(
        `select sum(u.import_kwh) as total
           from kea.mart_daily_usage u
           join billing.account a on a.icp_id = u.icp_id
          where a.account_number = $1
            and u.usage_date between $2::date and $3::date`,
        [accountNumber, from, to],
      )
      const total = rows[0]?.total
      return total === null || total === undefined ? null : Number(total)
    },
  }

  return { db, close: () => pool.end() }
}
