import type { Locator, Page } from '@playwright/test'

/**
 * The Dashboard, as the tests see it.
 *
 * ## A note on the locators, because they break a rule on purpose
 *
 * `CONVENTIONS.md` §7 says role and label first, CSS class only when there is no
 * alternative. The four metric cards are that case: they are bare `<article>` elements
 * with the label and the value in an unlabelled `<span>`/`<strong>` pair — no heading, no
 * `aria-label`, no `data-testid` anywhere in the app.
 *
 * So each card is found by the label a customer can actually read, scoped to the metric
 * row so the bill-shock card (also an `<article>`) cannot match. That survives restyling
 * and reordering; it breaks if the label text changes, which is a change a test *should*
 * notice.
 *
 * The right fix is `data-testid` on the four values. That is `services/web/` — the
 * frontend team's code — so it belongs in a small PR of its own with them tagged on it,
 * not smuggled into a test change.
 */
export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    // No `?household=` — `demoParams()` treats that override as winning over the session,
    // and the whole point of these tests is that the SESSION decides whose data is shown.
    await this.page.goto('/dashboard')
  }

  /** "Welcome, Tama Rewiri" — the only place the signed-in identity is rendered. */
  get greeting(): Locator {
    return this.page.getByText(/^Welcome,\s+/)
  }

  /**
   * Matched with a RegExp, not a string, and that is not stylistic. The page renders
   * `Latest day&rsquo;s cost`, so the DOM holds a typographic apostrophe (U+2019) where a
   * hand-typed selector has U+0027. A string filter silently matches nothing and the test
   * fails as "element not found", which reads like a missing card rather than a bad
   * selector. Anchoring on the words avoids the whole class of problem.
   */
  private metric(label: RegExp): Locator {
    return this.page.locator('.metric-row article').filter({ hasText: label }).locator('strong')
  }

  /** Frontend-computed: `latest day kWh × 0.30`, not a figure the API returns. */
  get latestDayCost(): Locator {
    return this.metric(/Latest day/)
  }

  get usageSoFar(): Locator {
    return this.metric(/Usage so far/)
  }

  get costSoFar(): Locator {
    return this.metric(/Cost so far/)
  }

  get projectedThisCycle(): Locator {
    return this.metric(/Projected this cycle/)
  }

  /**
   * The account chip behind the avatar in the top bar.
   *
   * Lives in `AppShell.tsx`, so it is on every page rather than only this one. It is
   * asserted here because the Dashboard is where a customer first meets it, and because
   * keeping it beside the greeting makes the contradiction obvious in the report: one
   * name in the page heading, a different one behind the avatar, same screenshot.
   */
  async openProfileMenu(): Promise<void> {
    await this.page.getByRole('button', { name: 'Open profile menu' }).click()
    await this.page.locator('.profile-menu').waitFor()
  }

  /** `<strong>` in the chip header — the name. */
  get profileName(): Locator {
    return this.page.locator('.profile-menu header strong')
  }

  /** `<small>` in the chip header — rendered as `CID: 110733ap`. */
  get profileCid(): Locator {
    return this.page.locator('.profile-menu header small')
  }

  // ── The two charts ───────────────────────────────────────────────────────────────
  //
  // Both are `UsageGraph`, and it is unusually testable for an SVG: every plotted point
  // is rendered as a `<circle role="button" aria-label="7am: 0.5 kWh">`
  // (`UsageGraph.tsx:100`). So the series can be read back through the accessibility
  // tree, by the same names a screen-reader user hears, without a single `data-testid`
  // and without parsing path geometry. The chart already exposes what a test needs.

  /** The "Typical day, by hour" card. */
  get hourlyCard(): Locator {
    return this.page.locator('article.usage-summary')
  }

  /** The "Last 7 days" card. */
  get weeklyCard(): Locator {
    return this.page.locator('article.weekly-summary')
  }

  get hourlyHeadline(): Locator {
    return this.hourlyCard.locator('h2')
  }

  get weeklyHeadline(): Locator {
    return this.weeklyCard.locator('h2')
  }

  /** The `+9.10%` / `-0.30%` chip, whichever direction it rendered in. */
  get weeklyTrend(): Locator {
    return this.weeklyCard.locator('.trend-up, .trend-down')
  }

  /**
   * The plotted points as a Locator, for counting.
   *
   * Always assert `toHaveCount()` on this before calling `plottedPoints()`. The weekly
   * chart renders `values={recent.length ? recent : [0]}`, so between first paint and the
   * API resolving it legitimately holds ONE point at zero. `evaluateAll` does not retry,
   * so reading without waiting catches that pre-load state — which is CONVENTIONS.md §3
   * in miniature, and it surfaced on exactly one of fourteen accounts.
   */
  chartPoints(card: Locator): Locator {
    return card.locator('circle.chart-point')
  }

  /**
   * Every plotted point in a chart, in series order.
   *
   * ## Both charts plot money, and only money
   *
   * The requirement changed after the industry mentor review: these charts show customers
   * what they are spending, so both `AreaChart`s are passed `unit="$"` and
   * `values={…map(toCost)}`. `formatMetric` renders `$0.10` where it used to render
   * `1.5 kWh`, and an accessible name now reads `"12am: $0.10"`.
   *
   * Dollars is the ONLY accepted format, deliberately. Accepting kilowatt-hours as an
   * alternative would not be future-proofing — it would be accepting the state the
   * requirement now forbids. Worse, it pushes enforcement onto the caller: a helper that
   * parses both and hands back a bare number lets any test that forgets to check the unit
   * compare dollars against kilowatt-hours and pass, wrong by the tariff and entirely
   * plausible. One regex owns the rule, so a chart that reverts fails here, once, by name.
   *
   * `decimals` is reported because the chart picks its own precision (`formatMetric` uses
   * two for money). Rounding the expectation to what was actually rendered asserts the
   * value rather than the formatting rule.
   */
  async plottedPoints(card: Locator): Promise<{ label: string; value: number; decimals: number }[]> {
    const names = await card.locator('circle.chart-point').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('aria-label') ?? ''),
    )
    return names.map((name) => {
      // `"12am: $0.10"`, anchored at both ends so anything else is an error rather than a
      // partial match. A kWh label lands here, which is the intended failure.
      const match = /^(.*?):\s*\$([\d.]+)$/.exec(name)
      if (!match) {
        throw new Error(
          `chart point is not priced in dollars: "${name}". The Dashboard charts show ` +
            'spend, not consumption — see DashboardPage.tsx, both AreaChart props.',
        )
      }
      const rendered = match[2]!
      return {
        label: match[1]!.trim(),
        value: Number(rendered),
        decimals: rendered.includes('.') ? rendered.split('.')[1]!.length : 0,
      }
    })
  }

  /** The y-axis tick labels, bottom to top as rendered. */
  yAxisLabels(card: Locator): Locator {
    return card.locator('text.y-axis-label')
  }

  /** The x-axis labels — weekday or hour. */
  xAxisLabels(card: Locator): Locator {
    return card.locator('text.x-axis-label')
  }

  /** The second x-axis row `UsageGraph` renders when given `secondaryLabels`; the
   *  Dashboard passes none, so today this matches nothing. */
  xAxisDateLabels(card: Locator): Locator {
    return card.locator('text.x-axis-date-label')
  }

  // ── Power Bill Shock Warning ─────────────────────────────────────────────────────
  //
  // One `article.card.shock-card` renders in one of four mutually exclusive states, and
  // which one appears is the feature. A warning that fails to appear looks exactly like
  // a healthy page, so the state itself has to be asserted before any figure in it.
  //
  //   .shock-offline          the API could not be reached
  //   (no modifier)           TRIGGERED — the warning
  //   .shock-ok               assessed, not triggered, or still loading
  get shockCard(): Locator {
    return this.page.locator('article.card.shock-card')
  }

  get shockTitle(): Locator {
    return this.shockCard.locator('h3')
  }

  /** Every paragraph in the card, in order. */
  get shockParagraphs(): Locator {
    return this.shockCard.locator('p')
  }

  /** The small print under the buttons. */
  get shockBasis(): Locator {
    return this.shockCard.locator('small.shock-basis')
  }

  /** Red when the assessment triggered, green when it did not. */
  get shockAlertDot(): Locator {
    return this.shockCard.locator('.bill-status-dot-alert')
  }

  get shockNormalDot(): Locator {
    return this.shockCard.locator('.bill-status-dot-normal')
  }

  shockButton(name: 'View Usage' | 'Ask Sparky AI'): Locator {
    return this.shockCard.getByRole('button', { name })
  }

  /** Shown instead of the figures when the API cannot be reached. */
  get offlineCard(): Locator {
    return this.page.locator('.shock-offline')
  }
}

/** `money()` in `DashboardPage.tsx` — two decimals and a NZD suffix. Used by the metric
 *  tiles and, since the charts switched to money, by both chart headlines. */
export const money = (n: number): string => `${n.toFixed(2)} NZD`

/** A plotted point's own format — `$0.10`, always two decimals (`formatMetric`). */
export const dollars = (n: number): string => `$${n.toFixed(2)}`

/** The usage tile's format — one decimal, kWh. Still correct for "Usage so far", which
 *  is the one figure on this page the requirement change left in kilowatt-hours. */
export const kwh = (n: number): string => `${n.toFixed(1)} kWh`

/**
 * `DashboardPage.tsx`'s fallback price when a cycle has no usage yet to derive a rate
 * from. A copy of the app's own literal, not a value any endpoint supplies — the API
 * has no concept of "the anytime rate", only `cost_so_far_nzd` and `usage_so_far_kwh`.
 *
 * That makes this the one piece of duplication in `rateFrom()` below, and an untested
 * one: every demo account has usage by the time it can sign in, so no test in this suite
 * ever exercises the branch that reads this constant. If the app's literal changes, this
 * copy has to be updated by hand — nothing will fail to say so.
 */
export const ANYTIME_RATE_NZD = 0.325

/**
 * The rate the page converts kilowatt-hours to dollars with, when there IS usage to
 * derive one from.
 *
 * ## Why this mirrors the app instead of asserting against a constant
 *
 * The API returns usage in kWh and the charts now plot dollars, so a test comparing the
 * two needs the conversion. For the branch this function shares with the app —
 * `cost_so_far_nzd / usage_so_far_kwh` — mirroring the formula is acceptable, narrowly,
 * because it is a division of two fields the same API response already carries rather
 * than a business rule reimplemented: there is no third source it could disagree with.
 *
 * The `ANYTIME_RATE_NZD` fallback is a different case and is NOT covered by that
 * argument — see its own comment for why.
 */
export function rateFrom(shock: { cost_so_far_nzd: number; usage_so_far_kwh: number }): number {
  return shock.usage_so_far_kwh > 0 ? shock.cost_so_far_nzd / shock.usage_so_far_kwh : ANYTIME_RATE_NZD
}
