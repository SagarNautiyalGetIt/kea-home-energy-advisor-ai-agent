import type { Locator, Page } from '@playwright/test'

/**
 * The Billing page, as the tests see it.
 *
 * ## Why this page is unlike Dashboard
 *
 * `DashboardPage` fetches real data for parts of itself. `BillingPage.tsx` imports
 * nothing from `lib/client` — but it is not 100% literal either. `customer.name` and
 * `customer.id` now come from `loadSession()` (fixed in 0fada6e, #122); everything
 * else on this page — `invoices`, the balance, the due date, `customer.payment`
 * ("Visa ending in 4242") — is still a module-level literal, identical regardless of
 * which of the fourteen demo accounts is signed in. Most of what these tests check is
 * "does the screen agree with THIS customer's row in Postgres", which is expected to
 * fail for everything EXCEPT the name/ID fields — check each test's own comment for
 * which side of that line it falls on before assuming red means broken.
 *
 * ## Sections
 *
 * All four are covered: the balance card, the payment-method card, the Invoice Details
 * panel and the Invoice History table, plus the three modals (pay, preview, manage) and
 * the generated PDF. `pdfLines()` at the bottom of this file is what makes the download
 * checkable without a PDF library.
 */
export class BillingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/billing')
  }

  // ── Current balance card ─────────────────────────────────────────────────────────

  get balanceCard(): Locator {
    return this.page.locator('article.balance-card')
  }

  get balanceAmount(): Locator {
    return this.balanceCard.locator('strong')
  }

  /** "Due 1 Sep 2026" before payment, "Payment received" after. */
  get balanceSubtext(): Locator {
    return this.balanceCard.locator('small')
  }

  get payBillButton(): Locator {
    return this.balanceCard.getByRole('button')
  }

  // ── Payment method card ───────────────────────────────────────────────────────────

  get paymentMethodCard(): Locator {
    return this.page.locator('article.payment-method')
  }

  /** "Visa ending in 4242" — the claim with no field in the schema that could hold it. */
  get paymentMethodLabel(): Locator {
    return this.paymentMethodCard.locator('strong')
  }

  /** The cardholder name — `cardName` state, seeded from the literal `customer.name`. */
  get paymentMethodCardholder(): Locator {
    return this.paymentMethodCard.locator('small')
  }

  get manageButton(): Locator {
    return this.paymentMethodCard.getByRole('button', { name: 'Manage' })
  }

  // ── Modals ────────────────────────────────────────────────────────────────────────
  //
  // `previewOpen`, `paymentOpen` and `methodOpen` are independent booleans in
  // `BillingPage.tsx`, so nothing stops two dialogs existing at once in principle.
  // These tests only ever drive one flow at a time, so a single `role=dialog` is safe,
  // but every locator below is still scoped through `dialog` rather than the page —
  // scoping to the page would also match the (still-present, merely covered) trigger
  // button behind the backdrop.

  get dialog(): Locator {
    return this.page.getByRole('dialog')
  }

  /** The modal's own `<h2 id="modal-title">`.
   *
   * Not `getByRole('heading')` — the invoice preview puts an `<h3>` with the amount
   * inside the same dialog, so a role-only lookup matches two elements and trips
   * strict mode. */
  get dialogTitle(): Locator {
    return this.dialog.locator('#modal-title')
  }

  async closeDialog(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Close' }).click()
  }

  // Pay confirmation modal — opened by the balance card's "Pay bill" button.

  get payConfirmText(): Locator {
    return this.dialog.locator('.payment-confirm p')
  }

  get payConfirmInvoiceNote(): Locator {
    return this.dialog.locator('.payment-confirm small')
  }

  /** Accessible name is dynamic — "Pay $184.50" — because it echoes the invoice amount. */
  get payConfirmButton(): Locator {
    return this.dialog.getByRole('button', { name: /^Pay \$/ })
  }

  get payConfirmCancelButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Cancel' })
  }

  // Manage payment method modal.

  get cardholderNameInput(): Locator {
    return this.dialog.getByLabel('Cardholder name')
  }

  get savedCardInput(): Locator {
    return this.dialog.getByLabel('Saved card')
  }

  get manageSaveButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Save' })
  }

  get manageCancelButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Cancel' })
  }

  // ── Toast ─────────────────────────────────────────────────────────────────────────

  toast(message: string): Locator {
    return this.page.locator('.toast-stack .toast').filter({ hasText: message })
  }

  // ── Invoice Details panel ────────────────────────────────────────────────────────

  get invoiceCard(): Locator {
    return this.page.locator('article.invoice.card')
  }

  /** The status badge in the Invoice Details header ("Due" → "Paid"). */
  get invoiceDetailStatusBadge(): Locator {
    return this.invoiceCard.locator('header .status-badge')
  }

  /**
   * One `dd` from the two definition lists, addressed by its `dt` label.
   *
   * `dt`/`dd` pairs are siblings inside a `<dl>`, not nested — `+ dd` is not something
   * `.locator()` chains onto (chaining searches descendants), so the sibling has to be
   * reached via a relative xpath axis. The label is anchored rather than matched as a
   * substring because "Due Date" and "Total Amount Due" would otherwise collide.
   */
  invoiceDetailField(label: string): Locator {
    return this.invoiceCard
      .locator('dt')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('xpath=following-sibling::dd[1]')
  }

  get invoiceDetailTotalDue(): Locator {
    return this.invoiceDetailField('Total Amount Due')
  }

  /**
   * One figure from the totals box on the right of the panel.
   *
   * Each row is a `<span>` holding the label text and a `<strong>` with the amount,
   * so the row is found by its label and the value read off the `<strong>` inside it.
   */
  invoiceTotal(label: string): Locator {
    return this.invoiceCard
      .locator('.invoice-totals > span')
      .filter({ hasText: label })
      .locator('strong')
  }

  /** The full label text of a totals row, including the date the late fee applies from. */
  invoiceTotalLabel(label: string): Locator {
    return this.invoiceCard.locator('.invoice-totals > span').filter({ hasText: label })
  }

  // ── Invoice History ──────────────────────────────────────────────────────────────

  /**
   * The data rows only.
   *
   * The header is also `role="row"` (`<div className="invoice-table-head" role="row">`),
   * so a bare `[role="row"]` would count it as a fourth invoice.
   */
  get invoiceHistoryRows(): Locator {
    return this.page.locator('.invoice-table [role="row"]:not(.invoice-table-head)')
  }

  /** One row of the Invoice History table, by invoice number. */
  invoiceHistoryRow(invoiceNumber: string): Locator {
    return this.invoiceHistoryRows.filter({ hasText: invoiceNumber })
  }

  invoiceHistoryStatusBadge(invoiceNumber: string): Locator {
    return this.invoiceHistoryRow(invoiceNumber).locator('.status-badge')
  }

  /**
   * The cells of one row, in render order: invoice number, period, amount, status,
   * actions. `<strong>` for the number and `<span>` for the rest, so this reads the
   * row's direct children rather than trying to name each one.
   */
  invoiceHistoryCells(invoiceNumber: string): Locator {
    return this.invoiceHistoryRow(invoiceNumber).locator('> strong, > span')
  }

  invoiceHistoryViewButton(invoiceNumber: string): Locator {
    return this.page.getByRole('button', { name: `View invoice ${invoiceNumber}` })
  }

  invoiceHistoryDownloadButton(invoiceNumber: string): Locator {
    return this.page.getByRole('button', { name: `Download invoice ${invoiceNumber} as PDF` })
  }

  /** Only rendered while the invoice is still `Due`; disappears once paid. */
  invoiceHistoryPayButton(invoiceNumber: string): Locator {
    return this.page.getByRole('button', { name: `Pay invoice ${invoiceNumber}` })
  }

  // ── Invoice preview modal (the eye button) ───────────────────────────────────────

  get previewAmount(): Locator {
    return this.dialog.locator('.invoice-preview h3')
  }

  get previewPeriod(): Locator {
    return this.dialog.locator('.invoice-preview > p')
  }

  /** One `dd` from the preview's definition list, addressed by its `dt` label. */
  previewField(label: string): Locator {
    return this.dialog
      .locator('.invoice-preview dt')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('xpath=following-sibling::dd[1]')
  }

  get previewDownloadButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Download PDF' })
  }
}

/**
 * Pull the visible text back out of a PDF produced by `utils/downloadPdf.ts`.
 *
 * That helper writes an uncompressed PDF 1.4 whose content stream is a plain list of
 * `(text) Tj` operators, so the lines can be recovered with a regex instead of a PDF
 * library. It also replaces every non-ASCII character with `-`, which is why an en
 * dash in a billing period comes back as a hyphen.
 */
export function pdfLines(bytes: Buffer): string[] {
  return [...bytes.toString('latin1').matchAll(/\((.*?)\)\s*Tj/g)]
    .map((m) => m[1]!.replace(/\\([()\\])/g, '$1'))
    .filter((line) => line.length > 0)
}

/** The page's own money format — `$184.50`. Distinct from Dashboard's `money()`
 *  (`184.50 NZD`); the two pages were built independently and never reconciled. */
export const dollars = (n: number): string => `$${n.toFixed(2)}`
