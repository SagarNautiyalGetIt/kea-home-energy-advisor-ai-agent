import {
  getBillShock,
  getHousehold,
  getHouseholds,
  lastSevenDays,
  latestDayKwh,
} from '../api/client'
import { ACCOUNTS, authFile } from '../fixtures/accounts'
import { expect, test } from '../fixtures/test'
import { dollars, kwh, money, rateFrom } from '../pages/DashboardPage'

/**
 * Dashboard — identity and the four metric cards.
 *
 * Every account gets its own describe block. That is not thoroughness for its own sake:
 * the one thing this page has to get right is *whose* data it shows, and a defect in that
 * only appears when you sign in as somebody other than the first household in the list.
 * Covering one account would leave exactly the failure that matters untested.
 *
 * ## What is asserted against what, and why it differs by account
 *
 * The five `seed` households hold **no name in Postgres** — `auth.py` says so explicitly,
 * and it is a privacy decision, not an omission. Their identity can therefore only be
 * checked against the API. The nine `mart` accounts have a real `kea.mart_account_context`
 * row, so theirs is checked against the database.
 *
 * The four card *figures* are checked against the API rather than recomputed from
 * `metering.meter_read_hh`, because reproducing the tariff and cycle arithmetic here would
 * give a failure three possible causes — the app, the mart, or this file. `usage so far`
 * is the exception and gets a real database assertion, because a `sum()` over a
 * pre-aggregated mart column is unambiguous arithmetic. That one test is the whole
 * database-to-screen chain in a single assertion.
 *
 * ## Preconditions
 *
 * The API must run with `KEA_PERSIST=1`. Without it the nine `mart` accounts sign in
 * successfully and then resolve to nothing — see the third test in each block.
 */

/** Largest observed API-vs-database gap across all nine mart accounts is 0.0100 kWh:
 *  the endpoint rounds, the mart does not. 0.05 is five times that and still far tighter
 *  than any real discrepancy would be. */
const KWH_TOLERANCE = 0.05

for (const account of ACCOUNTS) {
  test.describe(`Dashboard · ${account.displayName} (${account.customerId})`, () => {
    test.use({ storageState: authFile(account.customerId) })

    test('greets the signed-in customer by their own name', async ({ dashboard, db }) => {
      await dashboard.goto()

      const expectedName =
        account.kind === 'mart'
          ? (await db.accountContext(account.customerId))?.customerName
          : account.displayName

      expect(
        expectedName,
        `no kea.mart_account_context row for ${account.customerId} — has \`make data-load\` run?`,
      ).toBeTruthy()

      await expect(dashboard.greeting).toHaveText(`Welcome, ${expectedName}`)
    })

    test('the four metric cards show the figures the API served', async ({
      dashboard,
      request,
    }) => {
      const [household, shock] = await Promise.all([
        getHousehold(request, account.customerId),
        getBillShock(request, account.customerId),
      ])

      await dashboard.goto()

      // Still computed in the browser rather than returned by any endpoint, but no longer
      // at a flat 30c: the page derives its rate from the bill-shock figures and falls
      // back to a published anytime rate, so the expectation follows `rateFrom`. Asserted
      // anyway, because it is a dollar figure on a product whose stated promise is that
      // dollar figures come from a deterministic service — see the note below.
      const latest = latestDayKwh(household, shock)
      expect(latest, `${account.customerId} has no daily readings in the cycle`).toBeDefined()
      await expect(dashboard.latestDayCost).toHaveText(money(latest! * rateFrom(shock)))

      await expect(dashboard.usageSoFar).toHaveText(kwh(shock.usage_so_far_kwh))
      await expect(dashboard.costSoFar).toHaveText(money(shock.cost_so_far_nzd))

      // For a cycle that has run to its end the projection collapses onto the cost so far
      // — there is nothing left to project. Mid-cycle accounts (Julia at 24/31, Daniel at
      // 12/31, Mereana at 10/31) are the ones where the two figures genuinely differ, and
      // they are why this card is worth asserting separately rather than assuming.
      await expect(dashboard.projectedThisCycle).toHaveText(money(shock.projected_cycle_cost_nzd))

      if (shock.days_elapsed >= shock.days_in_cycle) {
        expect(
          shock.projected_cycle_cost_nzd,
          'a closed cycle should project to exactly what it cost',
        ).toBeCloseTo(shock.cost_so_far_nzd, 2)
      } else {
        expect(
          shock.projected_cycle_cost_nzd,
          'a cycle with days left should project above the cost so far',
        ).toBeGreaterThan(shock.cost_so_far_nzd)
      }
    })

    test('usage so far reconciles with kea.mart_daily_usage', async ({
      dashboard,
      request,
      db,
    }) => {
      test.skip(
        account.kind !== 'mart',
        'seeded households live in public.customer and have no mart_daily_usage rows',
      )

      const context = await db.accountContext(account.customerId)
      expect(context, `no mart_account_context row for ${account.customerId}`).not.toBeNull()

      const shock = await getBillShock(request, account.customerId)

      // Summed from the period start over `days_elapsed` days rather than across the whole
      // mart period. The two agree for eight of the nine; Daniel Okafor's mart period runs
      // 2024-05-01 to 2024-06-12 (43 days) while the endpoint reports a 31-day cycle, so
      // the whole-period sum is 518.2 against a reported 142.5. Same data, different
      // notion of "period" — worth knowing before trusting a cross-table comparison.
      const from = context!.periodStart
      const to = addDays(from, shock.days_elapsed - 1)
      const total = await db.importKwhBetween(account.customerId, from, to)

      expect(total, `no daily usage rows for ${account.customerId} in ${from}..${to}`).not.toBeNull()
      expect(
        total!,
        `kea.mart_daily_usage disagrees with /bill-shock for ${account.customerId}`,
      ).toBeCloseTo(shock.usage_so_far_kwh, 1)
      expect(Math.abs(total! - shock.usage_so_far_kwh)).toBeLessThanOrEqual(KWH_TOLERANCE)

      // ...and the same number, formatted, is what the customer sees. Database → API →
      // screen, closed in one test.
      await dashboard.goto()
      await expect(dashboard.usageSoFar).toHaveText(kwh(shock.usage_so_far_kwh))
    })

    test('resolves to this customer, not to a fallback household', async ({ request }) => {
      // `DashboardPage.tsx` picks `hs.find(h => h.customer_id === wanted) ?? hs[0]`. When
      // the signed-in customer is not in the list that `??` silently substitutes the FIRST
      // household — the page then shows one customer's name above another customer's
      // usage and cost, with no error anywhere. On a retailer's own portal that is worse
      // than a blank screen.
      //
      // It happens whenever the API runs on fixtures: sign-in comes from a static list of
      // fourteen in auth.py, while /api/households returns only the five seeded ones.
      const households = await getHouseholds(request)
      expect(
        households.map((h) => h.customer_id),
        `${account.customerId} can sign in but is not in /api/households, so the dashboard ` +
          `falls back to ${households[0]?.customer_id ?? 'nothing'} and shows the wrong ` +
          `customer's figures. Start the API with KEA_PERSIST=1.`,
      ).toContain(account.customerId)
    })

    /**
     * The account chip behind the avatar, asserted for every account rather than once.
     *
     * `AppShell.tsx:128` renders `<strong>Adela Parkson</strong><small>CID: 110733ap</small>`
     * as literals, so this fails identically for all fourteen. That is deliberate: one
     * root cause with fourteen red rows tells a developer the chip is wrong for *every*
     * customer, where a single row invites the reading that one account is misconfigured.
     * The report is a list of what a customer would actually hit, not a deduplicated list
     * of code defects.
     *
     * Logged in Sprint 2 as "Billing details are not matching with dashboard name (for
     * account Josh)" and still open. `BillingPage.tsx:14` carries the same literal.
     */
    test('the account chip names the signed-in customer', async ({ dashboard, db }) => {
      await dashboard.goto()

      const expectedName =
        account.kind === 'mart'
          ? (await db.accountContext(account.customerId))?.customerName
          : account.displayName

      await dashboard.openProfileMenu()
      await expect(
        dashboard.profileName,
        `the page heading greets ${expectedName}; the account chip should agree`,
      ).toHaveText(expectedName!)
    })

    test('the account chip shows this customer\'s own ID', async ({ dashboard, db }) => {
      await dashboard.goto()

      // Which identifier belongs in a field labelled "CID" is genuinely unspecified: the
      // session carries the ACCOUNT number, while `customer_number` is the customer's own
      // and for Julia Fox the two differ entirely (196501 vs DEMO-ACCT-221001). Rather
      // than invent a requirement, this accepts either and only insists the value belong
      // to the signed-in customer. Worth pinning down with Adi before the chip is fixed.
      const context = account.kind === 'mart' ? await db.accountContext(account.customerId) : null
      const acceptable = [account.customerId, context?.customerNumber].filter(Boolean) as string[]

      await dashboard.openProfileMenu()
      const cid = (await dashboard.profileCid.textContent())?.trim() ?? ''

      expect(
        cid,
        `the chip shows the hardcoded "CID: 110733ap" for every customer ` +
          `(AppShell.tsx:128). For ${account.customerId} it should carry one of ` +
          `${acceptable.join(' or ')}.`,
      ).not.toContain('110733ap')

      expect(
        acceptable.some((id) => cid.includes(id)),
        `"${cid}" contains none of this customer's identifiers (${acceptable.join(', ')})`,
      ).toBe(true)
    })

    // ── The charts are priced, not metered ────────────────────────────────────────
    //
    // The requirement changed: customers are shown dollars. Both charts and both chart
    // headlines now render `toCost(kwh)`, and only the "Usage so far" tile is still in
    // kilowatt-hours. Every chart assertion below therefore converts, and this test
    // exists so the conversion has somewhere to fail on its own.
    //
    // The rate itself is derived (`cost_so_far_nzd / usage_so_far_kwh`), not returned by
    // any endpoint — see `rateFrom()` for why that is a safe thing to mirror here and
    // what it does not cover.

    test("the charts price kWh at this account's own derived rate", async ({
      dashboard,
      request,
    }) => {
      const [household, shock] = await Promise.all([
        getHousehold(request, account.customerId),
        getBillShock(request, account.customerId),
      ])
      const latest = latestDayKwh(household, shock)!

      await dashboard.goto()
      await expect(dashboard.hourlyHeadline).not.toHaveText('—')
      const headline = (await dashboard.hourlyHeadline.innerText()).trim()

      // Reading the rate back off the screen rather than asserting the page agrees with a
      // number this file also computed. If someone swaps the derivation, this is the test
      // that says "the rate moved from X to Y" — one clear failure — instead of every
      // plotted point being wrong by an unexplained multiple.
      //
      // This exercises `cost_so_far_nzd / usage_so_far_kwh` only. It says nothing about
      // the `ANYTIME_RATE_NZD` fallback below — every demo account has usage by the time
      // it signs in, so the fallback branch has no account to run this test against, and
      // that gap is documented on the constant rather than papered over here.
      const shown = Number(headline.replace(/[^\d.]/g, ''))
      const impliedRate = shown / latest
      expect(
        impliedRate,
        `the hourly headline reads ${headline} for a ${latest} kWh day, which prices ` +
          `electricity at ${impliedRate.toFixed(4)} NZD/kWh. The page should be using ` +
          `${rateFrom(shock).toFixed(4)} — cost_so_far_nzd / usage_so_far_kwh.`,
      ).toBeCloseTo(rateFrom(shock), 3)
    })

    // ── Chart 1 · "Typical day, by hour" ──────────────────────────────────────────

    test('the hourly chart headline is this customer\'s latest day', async ({
      dashboard,
      request,
    }) => {
      const [household, shock] = await Promise.all([
        getHousehold(request, account.customerId),
        getBillShock(request, account.customerId),
      ])
      const latest = latestDayKwh(household, shock)

      await dashboard.goto()
      // The headline is money now, not kilowatt-hours: `money(toCost(latest))`. The API
      // still reports the day in kWh, so the expectation converts at the page's own rate.
      await expect(dashboard.hourlyHeadline).toHaveText(money(latest! * rateFrom(shock)))
    })

    test('the hourly chart plots 24 points, midnight to 11pm', async ({ dashboard }) => {
      await dashboard.goto()
      await expect(dashboard.chartPoints(dashboard.hourlyCard)).toHaveCount(24)
      const points = await dashboard.plottedPoints(dashboard.hourlyCard)

      expect(points[0]!.label).toBe('12am')
      expect(points[12]!.label).toBe('12pm')
      expect(points[23]!.label).toBe('11pm')
    })

    test.fixme('the hourly points add up to the headline for this customer', async ({
      dashboard,
      request,
    }) => {
      const [household, shock] = await Promise.all([
        getHousehold(request, account.customerId),
        getBillShock(request, account.customerId),
      ])
      const latest = latestDayKwh(household, shock)!
      const want = latest * rateFrom(shock)

      await dashboard.goto()
      await expect(dashboard.chartPoints(dashboard.hourlyCard)).toHaveCount(24)
      const points = await dashboard.plottedPoints(dashboard.hourlyCard)
      const plotted = points.reduce((sum, p) => sum + p.value, 0)

      // A chart of one day, broken into hours, has exactly one arithmetic obligation:
      // the hours must add up to the day. They do not, and they cannot — the series is
      // the literal on `DashboardPage.tsx:25`, twenty-four numbers that every customer is
      // shown regardless of what they actually used. The card's own subtitle admits it
      // ("illustrative shape"), but the headline beside it is real, so the two halves of
      // one card disagree.
      //
      // Switching the axis to dollars did not change that: `toCost` multiplies the same
      // hardcoded shape by a rate, so the plotted hours are now a fixed shape in money
      // instead of a fixed shape in kilowatt-hours. The y-axis follows from the same
      // cause — `max={toCost(2)}` still derives from a literal 2. Fixing the series fixes
      // the axis; there is nothing separate to do.
      expect(
        plotted,
        `the 24 plotted hours total $${plotted.toFixed(2)} but the headline says ` +
          `${want.toFixed(2)} NZD. The series is hardcoded at DashboardPage.tsx:25 and is ` +
          `identical for all fourteen accounts.`,
      ).toBeCloseTo(want, 2)
    })

    test.fixme('the API exposes hourly usage for this customer', async ({ request }) => {
      const household = await getHousehold(request, account.customerId)

      // The root cause behind the test above, stated where a backend reviewer will see
      // it. `HouseholdSummary` carries `daily_kwh` and nothing finer, and there is no
      // hourly endpoint in `contracts/openapi.json` — so the frontend has nothing to
      // plot even if it wanted to. `kea.mart_hourly_profile` holds exactly this data;
      // it is simply not reachable over HTTP.
      expect(
        Object.keys(household),
        'no hourly field on /api/households/{id}; kea.mart_hourly_profile is not exposed ' +
          'by any endpoint, so the hourly chart cannot be wired up by the frontend alone',
      ).toContain('hourly_kwh')
    })

    // ── Chart 2 · "Last 7 days" ───────────────────────────────────────────────────

    test('the weekly headline totals the seven plotted days', async ({
      dashboard,
      request,
    }) => {
      const [household, shock] = await Promise.all([
        getHousehold(request, account.customerId),
        getBillShock(request, account.customerId),
      ])
      const week = lastSevenDays(household, shock)
      const total = week.reduce((sum, value) => sum + value, 0)

      await dashboard.goto()
      // Money, for the same reason as the hourly headline above.
      await expect(dashboard.weeklyHeadline).toHaveText(money(total * rateFrom(shock)))
    })

    test('the weekly chart plots this customer\'s own last seven days', async ({
      dashboard,
      request,
    }) => {
      const [household, shock] = await Promise.all([
        getHousehold(request, account.customerId),
        getBillShock(request, account.customerId),
      ])
      const expected = lastSevenDays(household, shock)
      const rate = rateFrom(shock)

      await dashboard.goto()
      // Waits for the series to arrive: the card paints a single zero point before the
      // API resolves, and `plottedPoints` reads once without retrying.
      await expect(dashboard.chartPoints(dashboard.weeklyCard)).toHaveCount(expected.length)
      const points = await dashboard.plottedPoints(dashboard.weeklyCard)

      points.forEach((point, index) => {
        // No unit check here: `plottedPoints` only parses dollars, so a chart that
        // reverted to kilowatt-hours never reaches this loop. One place owns that rule.
        //
        // Rounded to whatever precision the chart chose to render, so this asserts the
        // value rather than the formatting rule.
        const want = Number((expected[index]! * rate).toFixed(point.decimals))
        expect(
          point.value,
          `point ${index + 1} (${point.label}) plots ${dollars(point.value)}; the API ` +
            `returned ${expected[index]} kWh for that day, which is ${dollars(want)} at ` +
            `the ${rate.toFixed(4)} NZD/kWh this page converts with`,
        ).toBe(want)
      })
    })

    test('the weekly trend matches the figure the API assessed', async ({
      dashboard,
      request,
    }) => {
      const shock = await getBillShock(request, account.customerId)
      const sign = shock.recent_trend_pct >= 0 ? '+' : ''

      await dashboard.goto()
      await expect(dashboard.weeklyTrend).toHaveText(
        `${sign}${shock.recent_trend_pct.toFixed(2)}%`,
      )
    })

    test.fixme('the weekly x-axis carries a date under each weekday', async ({ dashboard }) => {
      await dashboard.goto()
      const weekdays = await dashboard.xAxisLabels(dashboard.weeklyCard).allTextContents()
      const dates = await dashboard.xAxisDateLabels(dashboard.weeklyCard).allTextContents()

      expect(weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])

      // "Mon" on its own does not say which Monday, and the seven days plotted are the
      // last seven of a 2024 billing cycle rather than this week — so the label is not
      // merely vague, it points at the wrong week.
      //
      // `UsageGraph` already supports this: pass `secondaryLabels` and it renders a
      // second row of `<text class="x-axis-date-label">` (UsageGraph.tsx:119). The
      // Dashboard passes none. The blocker is upstream — `HouseholdSummary` returns
      // `daily_kwh` as a bare array with no dates and only a `period` string like
      // "July 2026", so the frontend has no date to print. Compare the comment at
      // DashboardPage.tsx:16, where the team removed the previous hardcoded
      // "17–23 Aug 2026" labels for exactly this reason.
      expect(
        dates,
        'no date row under the weekday labels; UsageGraph supports `secondaryLabels` but ' +
          'the API returns daily_kwh without dates, so there is nothing to pass it',
      ).toHaveLength(7)
    })

    // ── Power Bill Shock Warning ──────────────────────────────────────────────────
    //
    // Five layers, because the card fails in five different ways and only the first two
    // are about what is printed on it.

    // Layer 1 — which state rendered. Nothing else on the card means anything until this
    // is right, and a warning that silently fails to appear looks like a healthy page.
    test('the shock card renders the state the API assessed', async ({
      dashboard,
      request,
    }) => {
      const shock = await getBillShock(request, account.customerId)

      await dashboard.goto()
      await expect(dashboard.shockCard).toBeVisible()

      if (shock.triggered) {
        await expect(dashboard.shockTitle).toHaveText('Power Bill Shock Warning')
        await expect(dashboard.shockAlertDot).toBeVisible()
        await expect(dashboard.shockCard).not.toHaveClass(/shock-ok|shock-offline/)
      } else {
        await expect(dashboard.shockTitle).toContainText('No bill shock expected')
        await expect(dashboard.shockNormalDot).toBeVisible()
      }
    })

    // Layer 2 — every figure on the card against the assessment that produced it.
    test('the shock card quotes the figures the API assessed', async ({
      dashboard,
      request,
    }) => {
      const shock = await getBillShock(request, account.customerId)

      await dashboard.goto()
      const first = dashboard.shockParagraphs.first()

      if (shock.triggered) {
        await expect(first).toHaveText(
          `You are ${shock.days_elapsed} of ${shock.days_in_cycle} days into this cycle ` +
            `and on track for ${money(shock.projected_cycle_cost_nzd)}. You would normally expect about ` +
            `${money(shock.expected_cost_nzd)} — that is ` +
            `${money(shock.overshoot_nzd)} more, or ${shock.overshoot_pct.toFixed(0)}%.`,
        )
      } else {
        await expect(first).toHaveText(
          `You are ${shock.days_elapsed} of ${shock.days_in_cycle} days in and on track ` +
            `for ${money(shock.projected_cycle_cost_nzd)}, which is in line with the ` +
            `${money(shock.expected_cost_nzd)} you would normally expect.`,
        )
      }
    })

    test('the rising-usage sentence appears exactly when that reason fired', async ({
      dashboard,
      request,
    }) => {
      const shock = await getBillShock(request, account.customerId)
      const rising = shock.reasons.includes('rising_within_cycle')

      await dashboard.goto()
      const sentence = dashboard.shockCard.getByText(/Daily use is up/)

      if (shock.triggered && rising) {
        await expect(sentence).toHaveText(
          `Daily use is up ${shock.recent_trend_pct.toFixed(0)}% since the start of the cycle.`,
        )
      } else {
        await expect(sentence).toHaveCount(0)
      }
    })

    // Layer 3 — arithmetic that must hold whatever the API returned. Layer 2 compares the
    // screen with the endpoint; if the endpoint is internally inconsistent, layer 2 still
    // passes and this does not.
    test('the overshoot arithmetic reconstructs', async ({ request }) => {
      const shock = await getBillShock(request, account.customerId)

      // Tolerances measured, not guessed. Each figure is rounded independently before it
      // leaves the endpoint, so reconstructing one from the others cannot be exact:
      // across all fourteen accounts the money drifts by at most 0.0100 NZD and the
      // percentage by at most 0.0538 pp — the latter because `overshoot_pct` carries one
      // decimal, so ±0.05 is baked in before any arithmetic. The allowances below are
      // roughly double and triple those, which still catches a real error by an order of
      // magnitude. The two-cent money allowance is also the precedent the data team set
      // in `tests/assert_bill_explanation_decomposes.sql`.
      expect(
        Math.abs(
          shock.projected_cycle_cost_nzd - shock.expected_cost_nzd - shock.overshoot_nzd,
        ),
        'overshoot must be the projection minus the expected cost',
      ).toBeLessThanOrEqual(0.02)

      if (shock.expected_cost_nzd > 0) {
        const derived = (shock.overshoot_nzd / shock.expected_cost_nzd) * 100
        expect(
          Math.abs(derived - shock.overshoot_pct),
          `overshoot_pct says ${shock.overshoot_pct} but the dollar figures give ${derived.toFixed(4)}`,
        ).toBeLessThanOrEqual(0.15)
      }

      expect(
        shock.days_in_cycle - shock.days_elapsed,
        'days_remaining must be what is left of the cycle',
      ).toBe(shock.days_remaining)
    })

    test('the card and the metric tile quote the same projection', async ({ dashboard }) => {
      await dashboard.goto()

      // Two components, one figure. The code comment on the metric row names this exact
      // failure — "two numbers disagreeing in front of a judge" — so it is worth an
      // assertion that reads the screen twice and never consults the API.
      // Wait for the figure before reading it. The tile renders an em dash until the
      // bill-shock call resolves (`{shock ? money(...) : '—'}`), and `textContent()` does
      // not retry — the second time this suite has been caught by CONVENTIONS.md §3, and
      // both times only on one account out of fourteen.
      await expect(dashboard.projectedThisCycle).not.toHaveText('—')
      const tile = (await dashboard.projectedThisCycle.textContent())?.trim()
      await expect(
        dashboard.shockParagraphs.first(),
        `the metric tile says ${tile}; the warning card must say the same`,
      ).toContainText(tile!)
    })

    // Layer 4 — the cycle the card describes against the cycle the customer is actually on.
    test.fixme('the cycle length matches this customer\'s billing period', async ({
      request,
      db,
    }) => {
      test.skip(
        account.kind !== 'mart',
        'seeded households have no billing period in Postgres to compare against',
      )

      const context = (await db.accountContext(account.customerId))!
      const start = new Date(`${context.periodStart}T00:00:00Z`)
      const end = new Date(`${context.periodEnd}T00:00:00Z`)
      const realDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1

      const shock = await getBillShock(request, account.customerId)

      // `routes.py:182` passes `DAYS_IN_JULY` — the literal 31 from `pipeline.py:60` —
      // as the cycle length for every customer. It is also the multiplier in
      // `projected = mean_kwh * days_in_cycle * price`, so a wrong cycle length does not
      // just mislabel the sentence, it inflates the headline dollar figure.
      expect(
        shock.days_in_cycle,
        `${account.customerId} bills ${context.periodStart}..${context.periodEnd} ` +
          `(${realDays} days), but the assessment used ${shock.days_in_cycle}`,
      ).toBe(realDays)
    })

    test.fixme('the closing line matches whether the cycle can still be changed', async ({
      dashboard,
      request,
      db,
    }) => {
      const shock = await getBillShock(request, account.customerId)
      test.skip(!shock.triggered, 'the closing line only renders on the warning variant')

      await dashboard.goto()

      if (shock.days_remaining > 0) {
        // "enough to change the outcome" is a promise that there is still time to act.
        // For a mart account it is checkable against the real period end: eight of the
        // nine are assessed on a 31-day cycle they are not on, so this sentence offers
        // headroom on a bill that has already closed.
        await expect(dashboard.shockCard.getByText(/left in this cycle/)).toBeVisible()

        if (account.kind === 'mart') {
          const context = (await db.accountContext(account.customerId))!
          const end = new Date(`${context.periodEnd}T00:00:00Z`)
          const start = new Date(`${context.periodStart}T00:00:00Z`)
          const realDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
          expect(
            shock.days_elapsed,
            `the card offers ${shock.days_remaining} more days to act, but this cycle ` +
              `(${context.periodStart}..${context.periodEnd}) is only ${realDays} days ` +
              `long and day ${shock.days_elapsed} is its last`,
          ).toBeLessThan(realDays)
        }
      } else {
        await expect(dashboard.shockCard.getByText(/This cycle has closed/)).toBeVisible()
      }
    })

    test('the days-left sentence agrees in number', async ({ dashboard, request }) => {
      const shock = await getBillShock(request, account.customerId)
      test.skip(!shock.triggered || shock.days_remaining !== 1, 'only the singular case')

      await dashboard.goto()
      await expect(
        dashboard.shockCard.getByText(/left in this cycle/),
        'renders "1 days left"; the template does not handle the singular',
      ).toContainText('1 day left')
    })

    // Layer 5 — a claim the card makes about the data, checked against the data.
    test.fixme('the "no billing history" claim is true for this customer', async ({
      dashboard,
      request,
      db,
    }) => {
      const shock = await getBillShock(request, account.customerId)
      test.skip(!shock.triggered, 'the claim only appears on the warning variant')

      await dashboard.goto()
      const basis = (await dashboard.shockBasis.textContent()) ?? ''
      if (!/does not hold your billing history/.test(basis)) return

      const history = account.kind === 'mart'
        ? await db.billHistory(account.customerId)
        : { bills: 0, withPrior: 0 }

      // The stated reason for comparing against peers instead of the customer's own past
      // is in `assess_bill_shock`: "the seeded data is a single cycle and there is no
      // prior month to compare with". That was true when it was written. It is not now —
      // `kea.mart_bill_explanation` already holds a full five-driver attribution against
      // the previous bill for most of these accounts.
      expect(
        history.bills,
        `the card tells this customer Kea holds no billing history, but billing.bill has ` +
          `${history.bills} bill(s) for them and mart_bill_explanation has ` +
          `${history.withPrior} with a prior-period comparison already computed`,
      ).toBe(0)
    })

    test('the shock card actions go where they say', async ({ dashboard, request, page }) => {
      const shock = await getBillShock(request, account.customerId)
      test.skip(!shock.triggered, 'View Usage only renders on the warning variant')

      await dashboard.goto()
      await dashboard.shockButton('View Usage').click()
      await expect(page).toHaveURL(/\/usage$/)

      await dashboard.goto()
      await dashboard.shockButton('Ask Sparky AI').click()
      await expect(page).toHaveURL(/\/assistant$/)
    })
  })
}

/** `2024-06-01` + n days, staying in UTC so a local timezone cannot shift the date. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
