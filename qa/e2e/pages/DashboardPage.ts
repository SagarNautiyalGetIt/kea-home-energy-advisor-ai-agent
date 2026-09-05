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
   * The value is parsed out of the accessible name rather than compared as a string,
   * because the chart picks its own precision — one decimal when the axis ceiling is 2
   * or less, none above it (`formatMetric`). Returning the digits that were actually
   * rendered lets a caller round its expectation to the same precision instead of
   * hardcoding the rule.
   */
  async plottedPoints(card: Locator): Promise<{ label: string; value: number; decimals: number }[]> {
    const names = await card.locator('circle.chart-point').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('aria-label') ?? ''),
    )
    return names.map((name) => {
      const match = /^(.*?):\s*([\d.]+)\s*kWh$/.exec(name)
      if (!match) throw new Error(`chart point has an unreadable accessible name: "${name}"`)
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

/** `money()` in `DashboardPage.tsx` — two decimals and a NZD suffix. */
export const money = (n: number): string => `${n.toFixed(2)} NZD`

/** The usage tile's format — one decimal, kWh. */
export const kwh = (n: number): string => `${n.toFixed(1)} kWh`
