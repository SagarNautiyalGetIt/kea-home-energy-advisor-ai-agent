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
  /**
   * The §8.5 decomposition of this account's most recent bill against the one before
   * it — the ground truth the Sparky page's bill explainer is measured against.
   *
   * Returns null when there is nothing to explain, and the two ways that happens are
   * different findings:
   *
   * - **No prior bill.** Julia has exactly one bill, so `prior_bill_id` is NULL and
   *   every driver column with it. Nothing is wrong; there is simply no comparison to
   *   make, and the correct product behaviour is to say so.
   * - **No row at all.** Mereana has two bills and zero rows in
   *   `kea.mart_bill_explanation`. That is a gap in the ELT, not a property of the
   *   household, and `billExplanation` returning null for her is how the suite reports
   *   it rather than hiding it behind the same "cannot explain" branch.
   *
   * `explanations()` distinguishes the two.
   */
  billExplanation(accountNumber: string): Promise<BillExplanation | null>
  /** Every explained period for this account, oldest first. Rangi has twelve. */
  explanations(accountNumber: string): Promise<BillExplanation[]>
  /**
   * The same period's heating demand measured three ways, so a test can tell a base
   * disagreement apart from a mild winter.
   *
   * `stored` is `mart_daily_usage.heating_degree_days` as the warehouse wrote it.
   * `atBase16` and `atBase18` are both recomputed from `temp_mean_c` — the temperature
   * carries no base, so it is the only figure here the two conventions agree on.
   *
   * Exists because "is the observed figure below the normal?" has two very different
   * causes, and one number cannot distinguish them: a genuinely mild month, or a base-16
   * observation being scored against a base-18 normal. Reading the same days at both
   * bases separates them.
   */
  heatingDemandByBase(
    accountNumber: string,
  ): Promise<{ days: number; stored: number; atBase16: number; atBase18: number } | null>
  /**
   * The single highest-usage day inside a date range, inclusive.
   *
   * Exists so "which day was my highest usage?" can be checked against the period the
   * customer is actually billed for rather than against whatever window the API happened
   * to pick. Ties take the earliest day, matching `build_peak_usage`'s own rule — worth
   * copying, because Daniel has two days at exactly 14.31 kWh and an arbitrary tiebreak
   * would make his result depend on Postgres's row order.
   */
  peakDayInPeriod(
    accountNumber: string,
    from: string,
    to: string,
  ): Promise<{ date: string; kwh: number } | null>
}

/**
 * One row of `kea.mart_bill_explanation` — §8.5 of `kea-data-platform-design.md`.
 *
 * ## The invariant worth knowing before asserting on any of this
 *
 * The five deltas sum to `amountDelta` **exactly**. The document states it as a schema
 * assertion, and it is what makes `unexplained` a residual rather than a leftover: it
 * absorbs whatever the four named drivers over- or under-shoot by. So it is routinely
 * negative — Tama's is −9.34 — and a test that asserted the drivers were individually
 * "right" would be asserting something the design deliberately does not promise.
 *
 * ## Order, not proportion
 *
 * The drivers are computed sequentially, `periodLength` first, each measured after the
 * ones above it are removed. A 43-day bill looks like a 40% consumption rise and is not
 * one; Daniel is that fixture, and his `periodLength` of 48.86 against an 76.85 movement
 * is the reason the order is not a preference.
 */
export interface BillExplanation {
  invoiceNumber: string
  periodStart: string
  periodEnd: string
  periodDays: number
  totalAmount: number
  priorTotalAmount: number | null
  /** `total_amount − prior_total_amount`. Negative when the bill went DOWN — Rangi has
   *  five of those, and "why is my bill so high" against a bill that fell is its own
   *  test case. */
  amountDelta: number | null
  periodLength: number | null
  weather: number | null
  baseLoad: number | null
  tariff: number | null
  unexplained: number | null
  hddThis: number | null
  hddPrior: number | null
  sensitivity: number | null
  /** True only when the named drivers cover ≥60% of the movement AND the period holds
   *  no estimated or missing intervals. It gates the *claim*, not the arithmetic — and
   *  it is the field that decides whether the assistant owes the customer a question. */
  isExplainable: boolean
  hasPrior: boolean
}

/** The four named drivers, largest absolute movement first. Empty when there is no
 *  prior bill to compare against. */
export function driversOf(
  explanation: BillExplanation,
): Array<{ driver: 'period_length' | 'weather' | 'base_load' | 'tariff'; nzd: number }> {
  if (!explanation.hasPrior) return []
  return (
    [
      { driver: 'period_length' as const, nzd: explanation.periodLength ?? 0 },
      { driver: 'weather' as const, nzd: explanation.weather ?? 0 },
      { driver: 'base_load' as const, nzd: explanation.baseLoad ?? 0 },
      { driver: 'tariff' as const, nzd: explanation.tariff ?? 0 },
    ] satisfies Array<{ driver: string; nzd: number }> as Array<{
      driver: 'period_length' | 'weather' | 'base_load' | 'tariff'
      nzd: number
    }>
  ).sort((a, b) => Math.abs(b.nzd) - Math.abs(a.nzd))
}

/**
 * The driver that carries the movement, or null when none of them does.
 *
 * "Dominant" is deliberately a *share of the movement* rather than "the largest of the
 * four": a household where weather is the biggest of four small terms and the residual
 * holds most of the increase has no dominant driver, and an assistant that named one
 * anyway would be doing exactly what §8.5's `delta_unexplained` note forbids.
 *
 * The 50% floor is this suite's own choice and is not in the document. It sits above the
 * 60% `is_explainable` gate applies to the four drivers *together*, so a bill can be
 * explainable with no single dominant driver — Rangi's Decembers are like that, and the
 * honest answer there names two.
 */
export function dominantDriver(explanation: BillExplanation): string | null {
  const delta = explanation.amountDelta
  if (!explanation.hasPrior || delta === null || delta === 0) return null
  const [top] = driversOf(explanation)
  if (!top) return null
  return Math.abs(top.nzd) / Math.abs(delta) >= 0.5 ? top.driver : null
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

/** Shared by `billExplanation` and `explanations` so the two can never select different
 *  columns. Joins to `billing.bill` for the invoice number, which the mart does not hold
 *  and which is the only handle a report can quote back at Harvey. */
async function explanationRows(
  pool: Pool,
  accountNumber: string,
  direction: 'asc' | 'desc',
  limit?: number,
): Promise<BillExplanation[]> {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  const { rows } = await pool.query(
    // Dates cast to text in SQL for the timezone reason on `accountContext`.
    `select b.invoice_number,
            x.period_start::text as period_start,
            x.period_end::text   as period_end,
            x.period_days, x.total_amount, x.prior_total_amount, x.prior_bill_id,
            x.amount_delta, x.delta_from_period_length, x.delta_from_weather,
            x.delta_from_base_load, x.delta_from_tariff, x.delta_unexplained,
            x.hdd_this_period, x.hdd_prior_period,
            x.heating_sensitivity_kwh_per_hdd, x.is_explainable
       from kea.mart_bill_explanation x
       join billing.account a on a.account_id = x.account_id
       join billing.bill    b on b.bill_id    = x.bill_id
      where a.account_number = $1
      order by x.period_end ${direction === 'asc' ? 'asc' : 'desc'}
      ${limit ? `limit ${Number(limit)}` : ''}`,
    [accountNumber],
  )
  return rows.map((r) => ({
    invoiceNumber: r.invoice_number as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    periodDays: Number(r.period_days),
    totalAmount: Number(r.total_amount),
    priorTotalAmount: num(r.prior_total_amount),
    amountDelta: num(r.amount_delta),
    periodLength: num(r.delta_from_period_length),
    weather: num(r.delta_from_weather),
    baseLoad: num(r.delta_from_base_load),
    tariff: num(r.delta_from_tariff),
    unexplained: num(r.delta_unexplained),
    hddThis: num(r.hdd_this_period),
    hddPrior: num(r.hdd_prior_period),
    sensitivity: num(r.heating_sensitivity_kwh_per_hdd),
    isExplainable: Boolean(r.is_explainable),
    hasPrior: r.prior_bill_id !== null,
  }))
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

    async heatingDemandByBase(accountNumber) {
      // Scoped to the billed period, via the same mart the API reads. Days with no
      // weather join are excluded rather than zero-filled: the API zero-fills because a
      // regression needs one value per day, but averaging those zeros in here would
      // understate every base equally and hide the very difference being measured.
      const { rows } = await pool.query(
        `select count(*)::int                                          as days,
                avg(u.heating_degree_days)                             as stored,
                avg(greatest(16.0 - u.temp_mean_c, 0))                 as at_base_16,
                avg(greatest(18.0 - u.temp_mean_c, 0))                 as at_base_18
           from kea.mart_daily_usage u
           join kea.mart_account_context c on c.icp_id = u.icp_id
           join kea.mart_bill_explanation x on x.icp_id = u.icp_id
          where c.account_number = $1
            and u.temp_mean_c is not null
            and u.usage_date between x.period_start and x.period_end
            and x.period_end = (select max(period_end)
                                  from kea.mart_bill_explanation
                                 where icp_id = u.icp_id)`,
        [accountNumber],
      )
      if (!rows.length || !rows[0].days) return null
      return {
        days: Number(rows[0].days),
        stored: Number(rows[0].stored),
        atBase16: Number(rows[0].at_base_16),
        atBase18: Number(rows[0].at_base_18),
      }
    },

    async billExplanation(accountNumber) {
      const rows = await explanationRows(pool, accountNumber, 'desc', 1)
      return rows[0] ?? null
    },

    async explanations(accountNumber) {
      return explanationRows(pool, accountNumber, 'asc')
    },

    async peakDayInPeriod(accountNumber, from, to) {
      const { rows } = await pool.query(
        // Bounds are passed as text and cast in SQL, for the timezone reason on
        // `accountContext` — a JS Date built from '2024-04-01' in NZ is 2024-03-31T12:00Z
        // and would silently shift the window by a day at each end.
        `select u.usage_date::text as usage_date, u.import_kwh
           from kea.mart_daily_usage u
           join billing.account a on a.icp_id = u.icp_id
          where a.account_number = $1
            and u.usage_date between $2::date and $3::date
            and u.import_kwh is not null
          order by u.import_kwh desc, u.usage_date asc
          limit 1`,
        [accountNumber, from, to],
      )
      if (!rows.length) return null
      return { date: rows[0].usage_date as string, kwh: Number(rows[0].import_kwh) }
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
