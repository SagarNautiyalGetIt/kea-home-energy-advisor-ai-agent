import { ACCOUNTS, authFile } from '../fixtures/accounts'
import { expect, test } from '../fixtures/test'
import { readFileSync } from 'node:fs'
import { dollars, pdfLines } from '../pages/BillingPage'

/**
 * Billing — all four sections, the three modals and the generated PDF.
 *
 * Read `pages/BillingPage.ts` first. The short version: `BillingPage.tsx` imports
 * nothing from `lib/client`, and `contracts/openapi.json` has no billing endpoint for
 * it to call even if it wanted to. Apart from the customer's name and ID — wired to
 * the session in 0fada6e (#122) — every figure on this page is a module-level literal,
 * the same for all fourteen accounts. That single fact shapes everything below.
 *
 * ## Three kinds of test here, and they fail for different reasons
 *
 * 1. **Against Postgres** — "does the screen show THIS customer's bill". Expected to
 *    fail; the page never asked. Per-account, so the report shows the blast radius.
 * 2. **Against itself** — the totals box does not need a database to be wrong. Two of
 *    its five figures contradict the other three. Single-account: the literals are the
 *    same for everyone.
 * 3. **Against the interaction** — pay, preview, download, manage. These mostly pass;
 *    the page's own state machine is sound even though its data is not.
 *
 * ## A deliberate exception to "one root cause, N failures"
 *
 * `CONVENTIONS.md` §8 says a shared root cause still gets one failure per affected
 * account, and the per-account blocks follow that. The single-account blocks do NOT:
 * the "no API calls" check, the payment flow, the totals arithmetic, the history-table
 * structure, the modals and the PDF.
 *
 * The reason: §8's whole point is surfacing how many *different* customers a bug
 * reaches, when the expected value differs per customer (a name, a dollar figure).
 * Those are not that shape. They check the page's own JavaScript and its hardcoded
 * literals — whether a keystroke updates a sibling element, whether $152.14 and $32.36
 * add up — and the expected answer is identical regardless of who is signed in. Running
 * one of them fourteen times would re-verify the same DOM logic fourteen times, not
 * uncover thirteen more cases. They run once, against Tama Rewiri, chosen only because
 * the rest of this file already uses her as the running example.
 *
 * This is a judgement call, not a default — flagged here rather than applied quietly.
 */

const TAMA = ACCOUNTS.find((a) => a.customerId === 'DEMO-ACCT-223001')!

for (const account of ACCOUNTS) {
  test.describe(`Billing · ${account.displayName} (${account.customerId})`, () => {
    test.use({ storageState: authFile(account.customerId) })

    // ── Current balance ────────────────────────────────────────────────────────────

    test('the balance is this customer\'s own latest bill total', async ({
      billing,
      db,
    }) => {
      test.skip(
        account.kind !== 'mart',
        'seeded households have no billing.bill rows to compare against',
      )

      const bill = await db.latestBill(account.customerId)
      expect(bill, `no billing.bill row for ${account.customerId}`).not.toBeNull()

      await billing.goto()
      await expect(
        billing.balanceAmount,
        `the balance card shows $184.50 for every customer; ${account.customerId}'s ` +
          `real latest bill (${bill!.invoiceNumber}) totals ${dollars(bill!.totalCharges)}`,
      ).toHaveText(dollars(bill!.totalCharges))
    })

    test('the due date is this customer\'s own bill\'s due date', async ({
      billing,
      db,
    }) => {
      test.skip(
        account.kind !== 'mart',
        'seeded households have no billing.bill rows to compare against',
      )

      const bill = await db.latestBill(account.customerId)
      expect(bill, `no billing.bill row for ${account.customerId}`).not.toBeNull()

      await billing.goto()
      const shown = (await billing.balanceSubtext.textContent())?.trim() ?? ''
      const realYear = bill!.dueDate.slice(0, 4)

      // The failing assertion, not a sanity check: the card should carry THIS
      // customer's real due-date year and does not — it always reads 2026. Checking
      // the year is enough to prove the two cannot be the same due date, without this
      // file re-encoding `BillingPage.tsx`'s date-formatting rules just to build a
      // byte-identical string to compare against.
      expect(
        shown,
        `the balance card always reads "Due 1 Sep 2026"; ${account.customerId}'s ` +
          `real due date is ${bill!.dueDate} (their bill's period ended ` +
          `${bill!.periodEnd}, and real due dates in this dataset are period_end + 15 ` +
          `days, verified across every row in billing.bill — never +1)`,
      ).toContain(realYear)
    })

    // ── Payment method ─────────────────────────────────────────────────────────────

    test('the payment method reflects how this customer actually pays', async ({
      billing,
      db,
    }) => {
      test.skip(
        account.kind !== 'mart',
        'seeded households have no billing.account row to compare against',
      )

      const bill = await db.latestBill(account.customerId)
      expect(bill, `no billing.account row for ${account.customerId}`).not.toBeNull()

      await billing.goto()
      await expect(billing.paymentMethodLabel).toHaveText('Visa ending in 4242')

      // Not just the wrong card — there is no field anywhere in the schema that
      // could hold a card number or brand. `common.payment_method` is an enum of
      // direct_debit | bank_transfer | card | other, and every one of the nine
      // seeded accounts is `direct_debit`. The failing assertion: if the page's claim
      // were true, this account's own record would say `card`. It does not.
      expect(
        bill!.paymentMethod,
        `the page claims "Visa ending in 4242" (a card) for ${account.customerId}; ` +
          `their real payment_method is "${bill!.paymentMethod}", and no column in ` +
          `billing.account could ever hold a card number to begin with`,
      ).toBe('card')
    })

    // Fixed by Akash in 0fada6e (#122, KEA-120), the same commit that fixed the
    // Dashboard account-chip bug in AppShell.tsx and the Dashboard's "1 days left"
    // singular/plural bug — `BillingPage.tsx` now calls `loadSession()` rather than
    // holding a bare literal. This test is a regression guard, not a bug report: it
    // is expected to PASS. Kept per-account (not folded into the single-account block
    // below) because unlike the Manage-modal mechanics, this comparison target is a
    // real per-customer value — worth re-proving for all fourteen, not just one.
    test('the cardholder name is this customer\'s own name', async ({ billing, db }) => {
      await billing.goto()

      const expectedName =
        account.kind === 'mart'
          ? (await db.accountContext(account.customerId))?.customerName
          : account.displayName
      expect(expectedName, `no identity available for ${account.customerId}`).toBeTruthy()

      await expect(billing.paymentMethodCardholder).toHaveText(expectedName!)
    })

    // ── Invoice Details · against this customer's own bill ─────────────────────────

    test('the invoice panel describes this customer\'s own latest bill', async ({
      billing,
      db,
    }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.bill rows')

      const bill = (await db.latestBill(account.customerId))!
      await billing.goto()

      // Four fields, one assertion each, so a failure names the field rather than
      // "something in the panel is wrong". Every one of them is a literal in
      // BillingPage.tsx; none is read from anywhere.
      await expect(
        billing.invoiceDetailField('Total Amount Due'),
        `panel shows $184.50; ${bill.invoiceNumber} totals ${dollars(bill.totalCharges)}`,
      ).toHaveText(dollars(bill.totalCharges))

      await expect(
        billing.invoiceDetailField('Invoice No'),
        `panel shows invoice 367274627; this customer's latest is ${bill.invoiceNumber}`,
      ).toHaveText(bill.invoiceNumber)

      await expect(
        billing.invoiceDetailField('Due Date'),
        `panel shows 01/09/2026; the real due date is ${bill.dueDate}`,
      ).toHaveText(isoToSlashes(bill.dueDate))

      await expect(
        billing.invoiceDetailField('Period'),
        `panel shows 05/08/2026 – 19/08/2026; the real period is ` +
          `${bill.periodStart}..${bill.periodEnd}`,
      ).toHaveText(`${isoToSlashes(bill.periodStart)} – ${isoToSlashes(bill.periodEnd)}`)
    })

    test('the invoice totals match this customer\'s own bill', async ({ billing, db }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.bill rows')

      const bill = (await db.latestBill(account.customerId))!
      await billing.goto()

      await expect(
        billing.invoiceTotal('Electricity Charges'),
        `panel shows $152.14; charges_excl_gst on ${bill.invoiceNumber} is ` +
          `${dollars(bill.chargesExclGst)}`,
      ).toHaveText(dollars(bill.chargesExclGst))

      await expect(
        billing.invoiceTotal('GST'),
        `panel shows $32.36; gst_amount on ${bill.invoiceNumber} is ` +
          `${dollars(bill.gstAmount)} (gst_rate ${bill.gstRate} — the loader never ` +
          `populated GST on any of the 28 fixture bills)`,
      ).toHaveText(dollars(bill.gstAmount))

      await expect(
        billing.invoiceTotal('Total Charges for this Period'),
        `panel shows $184.50; total_charges is ${dollars(bill.totalCharges)}`,
      ).toHaveText(dollars(bill.totalCharges))
    })

    test('the late-payment figures come from this customer\'s bill', async ({
      billing,
      db,
    }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.bill rows')

      const bill = (await db.latestBill(account.customerId))!
      await billing.goto()

      // `late_payment_fee` is 0.00 and `total_if_paid_late` is NULL on all 28 rows —
      // Harvey's fixtures carry no late-payment data at all. So the panel's $37.21 and
      // $227.71 are not "the wrong customer's figures", they are figures with no
      // source. Worth raising with the data team as a gap before it is raised with the
      // frontend as a bug: there is currently nothing correct for the page to show.
      await expect(
        billing.invoiceTotal('Late Payment Fee'),
        `panel shows $37.21; late_payment_fee on ${bill.invoiceNumber} is ` +
          `${dollars(bill.latePaymentFee)} — no fixture bill carries a late fee`,
      ).toHaveText(dollars(bill.latePaymentFee))

      // Phrased as a claim about the screen, not about Harvey's table: the panel prints
      // a late total, so one must exist to print. It does not — `total_if_paid_late` is
      // NULL on all 28 fixture bills. Whoever picks this up needs to know the fix
      // starts in the data, not the component.
      const shownLateTotal = await billing
        .invoiceTotal('Total Amount Due if paid after')
        .textContent()
      expect(
        bill.totalIfPaidLate === null ? null : dollars(bill.totalIfPaidLate),
        `the panel prints ${shownLateTotal?.trim()} as the amount due if paid late; ` +
          `${bill.invoiceNumber} has no total_if_paid_late recorded at all (NULL, as on ` +
          `every one of the 28 fixture bills), so there is currently no correct value ` +
          `for this line to show`,
      ).toBe(shownLateTotal?.trim())
    })

    // Split from the address check on purpose. Name and ID were wired to the session in
    // 0fada6e (#122); folding them into a test that also checks the still-hardcoded
    // address would make Akash's own fix show up in the report as a red row.
    test('the invoice panel names this customer', async ({ billing, db }) => {
      await billing.goto()
      const context = account.kind === 'mart' ? await db.accountContext(account.customerId) : null

      await expect(billing.invoiceDetailField('Customer Name')).toHaveText(
        context?.customerName ?? account.displayName,
      )
      await expect(billing.invoiceDetailField('Customer ID')).toHaveText(account.customerId)
    })

    test('the invoice panel shows this customer\'s address', async ({ billing, db }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no address in Postgres')

      const context = (await db.accountContext(account.customerId))!
      await billing.goto()

      await expect(
        billing.invoiceDetailField('Customer Address'),
        `panel shows "6 Mount Street, Auckland Central, Auckland 1010, NZ" for every ` +
          `customer; ${account.customerId}'s real address is "${context.addressDisplay}"`,
      ).toHaveText(context.addressDisplay)
    })

    test('the invoice header names this customer\'s actual plan', async ({ billing, db }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no plan in Postgres')

      const context = (await db.accountContext(account.customerId))!
      await billing.goto()

      // Every one of the nine accounts is on a time-of-use plan (`is_tou = true`,
      // plan_name "Demo Standard Fixed TOU"). The invoice header instead announces
      // "Anytime Rate — The same usage rate at every time of day", which is not a
      // wrong label so much as a wrong description of how the customer is charged.
      await expect(
        billing.invoiceCard.locator('header h2'),
        `the invoice header reads "Anytime Rate" for everyone; ${account.customerId} ` +
          `is on "${context.planName}" (${context.planCode}), a time-of-use plan`,
      ).toHaveText(context.planName)
    })

    test('the invoice panel names how this customer actually pays', async ({
      billing,
      db,
    }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.account row')

      const bill = (await db.latestBill(account.customerId))!
      await billing.goto()

      // The same false claim as the payment-method card, in a second place on the same
      // page. Asserted separately rather than folded in, because a customer reads them
      // as two independent statements and a fix has to reach both.
      await expect(billing.invoiceDetailField('Payment Method')).toHaveText(
        'Visa ending in 4242',
      )
      expect(
        bill.paymentMethod,
        `the invoice panel also claims a Visa card; ${account.customerId} pays by ` +
          `"${bill.paymentMethod}"`,
      ).toBe('card')
    })

    // ── Invoice History · against this customer's own bills ────────────────────────

    test('invoice history lists this customer\'s own bills', async ({ billing, db }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.bill rows')

      const bills = await db.bills(account.customerId)
      expect(bills.length, `no bills at all for ${account.customerId}`).toBeGreaterThan(0)

      await billing.goto()

      // Deliberately NOT `toHaveCount(bills.length)`. The section is titled "Your latest
      // account documents", so a retailer could reasonably cap it at three — asserting
      // exact equality invites that objection and Rangi (13 bills) would make it stick.
      // The claim that cannot be argued with is narrower: whatever it lists has to be
      // this customer's.
      const shown = await billing.invoiceHistoryRows.locator('> strong').allTextContents()
      const real = bills.map((b) => b.invoiceNumber)

      expect(
        shown.map((n) => n.trim()).filter((n) => !real.includes(n)),
        `these invoice numbers are on ${account.customerId}'s Billing page but are not ` +
          `their invoices; their real bill(s) are ${real.join(', ')}`,
      ).toEqual([])
    })

    test('the table lists no more invoices than this customer has', async ({
      billing,
      db,
    }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.bill rows')

      const bills = await db.bills(account.customerId)
      await billing.goto()
      const shown = await billing.invoiceHistoryRows.count()

      // Separate from the test above because it survives the "we only show the latest
      // three" defence: capping a long history is a choice, inventing rows for a
      // customer who has fewer bills than that is not. Julia has one bill and is shown
      // three; Rangi has thirteen and is the only account this passes for.
      expect(
        shown,
        `the table shows ${shown} invoices; ${account.customerId} has only ` +
          `${bills.length}`,
      ).toBeLessThanOrEqual(bills.length)
    })

    test('the newest row is this customer\'s newest bill', async ({ billing, db }) => {
      test.skip(account.kind !== 'mart', 'seeded households have no billing.bill rows')

      const [newest] = await db.bills(account.customerId)
      await billing.goto()

      const firstRow = billing.invoiceHistoryRows.first()
      await expect(
        firstRow,
        `the top row is always invoice 367274627 at $184.50; ${account.customerId}'s ` +
          `newest bill is ${newest!.invoiceNumber} at ${dollars(newest!.totalCharges)} ` +
          `(${newest!.periodStart}..${newest!.periodEnd})`,
      ).toContainText(newest!.invoiceNumber)
      await expect(firstRow).toContainText(dollars(newest!.totalCharges))
    })

    // ── Internal consistency (expected to pass) ────────────────────────────────────

    test('the pay confirmation quotes the amount already on screen', async ({
      billing,
    }) => {
      await billing.goto()
      const cardAmount = (await billing.balanceAmount.textContent())?.trim()

      await billing.payBillButton.click()
      await expect(billing.dialog).toBeVisible()
      await expect(billing.payConfirmText).toContainText(cardAmount!)

      // Not a claim that the amount is CORRECT — layer above already covers that.
      // Only that the modal did not introduce a SECOND, independently wrong number.
    })
  })
}

// ── Single-account: page-level and state-machine checks ─────────────────────────────
//
// See the file header for why these are not parametrised across all fourteen accounts.

test.describe('Billing · page-level checks', () => {
  test.use({ storageState: authFile(TAMA.customerId) })

  test('the page never calls the API for this customer\'s own billing data', async ({
    page,
  }) => {
    const apiCalls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/')) apiCalls.push(request.url())
    })

    await page.goto('/billing')
    await page.waitForLoadState('networkidle')

    expect(
      apiCalls,
      'BillingPage.tsx imports nothing from lib/client — every figure on this page ' +
        'is a hardcoded literal, and contracts/openapi.json has no billing endpoint ' +
        'for the frontend to call even if it wanted to',
    ).toEqual([])
  })

  test('paying the current invoice updates every part of the page that describes it', async ({
    page,
    billing,
  }) => {
    await billing.goto()

    // Read the invoice number and amount off the screen rather than hardcoding the
    // literals from BillingPage.tsx — if the fixture invoice ever changes, this test
    // should keep working without an edit.
    const amountBefore = (await billing.balanceAmount.textContent())!.trim()
    await billing.payBillButton.click()
    await expect(billing.dialog).toBeVisible()
    const invoiceNumber = (await billing.payConfirmInvoiceNote.textContent())!.match(
      /invoice (\d+)/,
    )?.[1]
    expect(invoiceNumber, 'could not read the invoice number out of the pay dialog').toBeTruthy()

    await billing.payConfirmButton.click()

    // 1. The toast.
    await expect(billing.toast(`Invoice ${invoiceNumber} paid successfully`)).toBeVisible()

    // 2. The balance card.
    await expect(billing.balanceAmount).toHaveText('$0.00')
    await expect(billing.balanceSubtext).toHaveText('Payment received')
    await expect(billing.payBillButton).toHaveText('Paid')
    await expect(billing.payBillButton).toBeDisabled()

    // 3. The Invoice Details panel — status badge and the Total Amount Due figure.
    await expect(billing.invoiceDetailStatusBadge).toHaveText('Paid')
    await expect(billing.invoiceDetailStatusBadge).toHaveClass(/status-paid/)
    await expect(billing.invoiceDetailTotalDue).toHaveText('$0.00')

    // 4. Invoice History — the same invoice's row.
    await expect(billing.invoiceHistoryStatusBadge(invoiceNumber!)).toHaveText('Paid')
    // The "pay" action only renders while an invoice is Due (BillingPage.tsx:
    // `statusFor(invoice)==='Due' && <button className="pay-action" .../>`), so once
    // paid it should be gone rather than merely disabled.
    await expect(billing.invoiceHistoryPayButton(invoiceNumber!)).toHaveCount(0)

    // Confirms this really is unpersisted client state, same failure mode as the
    // cardholder-name bug below: nothing here survives a reload.
    await page.reload()
    await expect(billing.balanceAmount).toHaveText(amountBefore)
  })
})

test.describe('Billing · invoice totals add up', () => {
  test.use({ storageState: authFile(TAMA.customerId) })

  // These need no database and no API. Every figure in the totals box is a literal, so
  // the only question is whether the literals agree with each other — and two of them
  // do not. A customer with a calculator finds these without knowing anything about
  // Kea's data model, which is what makes them worth reporting ahead of the mismatches.

  test('GST is 15% of the charges shown', async ({ billing }) => {
    await billing.goto()
    const charges = money(await billing.invoiceTotal('Electricity Charges').textContent())
    const gst = money(await billing.invoiceTotal('GST').textContent())

    // $32.36 is exactly the `gst_amount` in the schema's own worked example, where it
    // pairs with a $215.71 base (215.71 × 0.15 = 32.36). The base on this page was
    // changed to $152.14 to make the subtotal land on $184.50; the GST line was not.
    expect(
      gst,
      `GST is shown as ${dollars(gst)} on charges of ${dollars(charges)}. At the NZ ` +
        `rate — 15%, which is also the schema default for billing.bill.gst_rate — it ` +
        `should be ${dollars(round2(charges * 0.15))}.`,
    ).toBeCloseTo(round2(charges * 0.15), 2)
  })

  test('charges plus GST equals the period total', async ({ billing }) => {
    await billing.goto()
    const charges = money(await billing.invoiceTotal('Electricity Charges').textContent())
    const gst = money(await billing.invoiceTotal('GST').textContent())
    const total = money(await billing.invoiceTotal('Total Charges for this Period').textContent())

    expect(round2(charges + gst)).toBeCloseTo(total, 2)
  })

  test('the period total plus the late fee equals the late total', async ({ billing }) => {
    await billing.goto()
    const total = money(await billing.invoiceTotal('Total Charges for this Period').textContent())
    const fee = money(await billing.invoiceTotal('Late Payment Fee').textContent())
    const late = money(await billing.invoiceTotal('Total Amount Due if paid after').textContent())

    expect(
      late,
      `the panel shows ${dollars(total)} + ${dollars(fee)} = ${dollars(late)}, which is ` +
        `${dollars(round2(late - total - fee))} more than those two figures add up to`,
    ).toBeCloseTo(round2(total + fee), 2)
  })

  test('the late-fee labels quote the invoice\'s own due date', async ({ billing }) => {
    await billing.goto()
    // "01/09/2026" in the field, "1 Sep 2026" in the two labels — same day, two
    // formats, so this compares the parts rather than the strings.
    const dueDate = (await billing.invoiceDetailField('Due Date').textContent())!.trim()
    const [day, monthNumber, year] = dueDate.split('/')
    const month = MONTHS[Number(monthNumber) - 1]!
    const expected = `${Number(day)} ${month} ${year}`

    await expect(billing.invoiceTotalLabel('Late Payment Fee')).toContainText(expected)
    await expect(billing.invoiceTotalLabel('Total Amount Due if paid after')).toContainText(
      expected,
    )
  })
})

test.describe('Billing · invoice history table', () => {
  test.use({ storageState: authFile(TAMA.customerId) })

  test('each row carries an invoice number, period, amount and status', async ({
    billing,
  }) => {
    await billing.goto()
    const rows = billing.invoiceHistoryRows
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)

    for (let index = 0; index < count; index += 1) {
      const cells = await rows.nth(index).locator('> strong, > span').allTextContents()
      const [invoiceNumber, period, amount, status] = cells.map((c) => c.trim())

      expect(invoiceNumber, `row ${index + 1} has no invoice number`).toMatch(/^\d+$/)
      expect(period, `row ${index + 1} has no billing period`).toMatch(
        /^\d{2} \w{3} \d{4} – \d{2} \w{3} \d{4}$/,
      )
      expect(amount, `row ${index + 1} has no amount`).toMatch(/^\$\d+\.\d{2}$/)
      expect(['Due', 'Paid'], `row ${index + 1} has an unexpected status`).toContain(status)
    }
  })

  test('only unpaid rows offer a pay action', async ({ billing }) => {
    await billing.goto()
    const rows = billing.invoiceHistoryRows
    const count = await rows.count()

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      const invoiceNumber = (await row.locator('> strong').textContent())!.trim()
      const status = (await row.locator('.status-badge').textContent())!.trim()

      // View and Download are always available; Pay is conditional on the status —
      // `statusFor(invoice)==='Due' && <button className="pay-action" .../>`.
      await expect(billing.invoiceHistoryViewButton(invoiceNumber)).toBeVisible()
      await expect(billing.invoiceHistoryDownloadButton(invoiceNumber)).toBeVisible()
      await expect(
        billing.invoiceHistoryPayButton(invoiceNumber),
        `invoice ${invoiceNumber} is "${status}" — a pay action should only exist while Due`,
      ).toHaveCount(status === 'Due' ? 1 : 0)
    }
  })

  test('the preview modal repeats the row it was opened from', async ({ billing }) => {
    await billing.goto()
    const row = billing.invoiceHistoryRows.first()
    const [invoiceNumber, period, amount] = (
      await row.locator('> strong, > span').allTextContents()
    ).map((c) => c.trim())
    const status = (await row.locator('.status-badge').textContent())!.trim()

    await billing.invoiceHistoryViewButton(invoiceNumber!).click()
    await expect(billing.dialog).toBeVisible()

    await expect(billing.dialogTitle).toHaveText(`Invoice ${invoiceNumber}`)
    await expect(billing.previewAmount).toHaveText(amount!)
    await expect(billing.previewPeriod).toHaveText(period!)
    await expect(billing.previewField('Status')).toHaveText(status)
    await expect(billing.previewField('Customer ID')).toHaveText(TAMA.customerId)
    await expect(billing.previewField('Payment method')).toHaveText('Visa ending in 4242')
  })

  test('the downloaded PDF repeats what the row and panel show', async ({
    billing,
    page,
  }) => {
    await billing.goto()
    const row = billing.invoiceHistoryRows.first()
    const [invoiceNumber, period, amount] = (
      await row.locator('> strong, > span').allTextContents()
    ).map((c) => c.trim())

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      billing.invoiceHistoryDownloadButton(invoiceNumber!).click(),
    ])

    expect(download.suggestedFilename()).toBe(`kea-invoice-${invoiceNumber}.pdf`)

    const path = await download.path()
    const lines = pdfLines(readFileSync(path))

    expect(lines[0]).toBe('KEA ENERGY INVOICE')
    expect(lines).toContain(`Invoice: ${invoiceNumber}`)
    // `downloadTextPdf` replaces every non-ASCII character with a hyphen, so the en
    // dash in the period becomes "-" in the PDF even though the table shows "–".
    expect(lines).toContain(`Billing period: ${period!.replace('–', '-')}`)
    expect(lines).toContain(`Total: ${amount}`)
    expect(lines).toContain(`Customer: ${TAMA.displayName}`)
    expect(lines).toContain(`Customer ID: ${TAMA.customerId}`)
    expect(lines).toContain('Status: Due')
    expect(lines).toContain('Cost basis: illustrative rate of 30c/kWh.')
  })

  test('paying from the history row updates the row in place', async ({ billing }) => {
    await billing.goto()
    const row = billing.invoiceHistoryRows.first()
    const invoiceNumber = (await row.locator('> strong').textContent())!.trim()

    await billing.invoiceHistoryPayButton(invoiceNumber).click()
    await expect(billing.dialog).toBeVisible()
    await expect(billing.dialogTitle).toHaveText(`Pay invoice ${invoiceNumber}`)
    await billing.payConfirmButton.click()

    // The three changes a customer would look for after paying from this table.
    await expect(billing.toast(`Invoice ${invoiceNumber} paid successfully`)).toBeVisible()
    await expect(billing.invoiceHistoryStatusBadge(invoiceNumber)).toHaveText('Paid')
    await expect(billing.invoiceHistoryPayButton(invoiceNumber)).toHaveCount(0)
  })
})

test.describe('Billing · the sections agree with each other', () => {
  test.use({ storageState: authFile(TAMA.customerId) })

  // Every figure on this page appears in several places at once. Today they agree
  // trivially, because they are all the same literal — so most of this block passes.
  // Its value is on the day somebody wires ONE of them to the API: a page showing
  // $163.19 on the balance card and $184.50 in the invoice panel is worse than one
  // showing the wrong figure consistently, and nothing else in this suite would catch
  // a half-finished fix. These are the regression guards for that work.

  test('every place that quotes the amount agrees', async ({ billing }) => {
    await billing.goto()

    const balance = money(await billing.balanceAmount.textContent())
    const panelDue = money(await billing.invoiceDetailField('Total Amount Due').textContent())
    const panelTotal = money(
      await billing.invoiceTotal('Total Charges for this Period').textContent(),
    )
    const historyRow = billing.invoiceHistoryRows.first()
    const rowAmount = money((await historyRow.locator('> span').nth(1).textContent()))

    expect({ panelDue, panelTotal, rowAmount }).toEqual({
      panelDue: balance,
      panelTotal: balance,
      rowAmount: balance,
    })

    // ...and the two modals that echo it.
    await billing.payBillButton.click()
    await expect(billing.dialog).toBeVisible()
    await expect(billing.payConfirmText).toContainText(dollars(balance))
    await billing.payConfirmCancelButton.click()

    const invoiceNumber = (await historyRow.locator('> strong').textContent())!.trim()
    await billing.invoiceHistoryViewButton(invoiceNumber).click()
    await expect(billing.previewAmount).toHaveText(dollars(balance))
  })

  test('every place that quotes the due date agrees', async ({ billing }) => {
    await billing.goto()

    // Four places, three formats: "Due 1 Sep 2026", "01/09/2026", "...if paid after
    // 1 Sep 2026", "01 Sep 2026". Normalised to ISO so the comparison is about the
    // day, not the formatting.
    const fromBalance = toIsoDate(await billing.balanceSubtext.textContent())
    const fromPanel = toIsoDate(await billing.invoiceDetailField('Due Date').textContent())
    const fromLateFee = toIsoDate(await billing.invoiceTotalLabel('Late Payment Fee').textContent())

    expect({ fromPanel, fromLateFee }).toEqual({
      fromPanel: fromBalance,
      fromLateFee: fromBalance,
    })

    const invoiceNumber = (
      await billing.invoiceHistoryRows.first().locator('> strong').textContent()
    )!.trim()
    await billing.invoiceHistoryViewButton(invoiceNumber).click()
    expect(toIsoDate(await billing.previewField('Due date').textContent())).toBe(fromBalance)
  })

  test('every place that quotes the invoice number agrees', async ({ billing }) => {
    await billing.goto()

    const fromPanel = (await billing.invoiceDetailField('Invoice No').textContent())!.trim()
    const fromRow = (
      await billing.invoiceHistoryRows.first().locator('> strong').textContent()
    )!.trim()
    expect(fromRow).toBe(fromPanel)

    await billing.payBillButton.click()
    await expect(billing.dialogTitle).toHaveText(`Pay invoice ${fromPanel}`)
    await expect(billing.payConfirmInvoiceNote).toContainText(fromPanel)
    await billing.payConfirmCancelButton.click()

    await billing.invoiceHistoryViewButton(fromPanel).click()
    await expect(billing.dialogTitle).toHaveText(`Invoice ${fromPanel}`)
  })

  test('every place that quotes the payment method agrees', async ({ billing }) => {
    await billing.goto()

    const fromCard = (await billing.paymentMethodLabel.textContent())!.trim()
    await expect(billing.invoiceDetailField('Payment Method')).toHaveText(fromCard)

    await billing.payBillButton.click()
    await expect(billing.payConfirmText).toContainText(fromCard)
    await billing.payConfirmCancelButton.click()

    const invoiceNumber = (
      await billing.invoiceHistoryRows.first().locator('> strong').textContent()
    )!.trim()
    await billing.invoiceHistoryViewButton(invoiceNumber).click()
    await expect(billing.previewField('Payment method')).toHaveText(fromCard)
  })

  test('paying settles every status indicator on the page', async ({ billing }) => {
    await billing.goto()
    const invoiceNumber = (
      await billing.invoiceHistoryRows.first().locator('> strong').textContent()
    )!.trim()

    await billing.payBillButton.click()
    await billing.payConfirmButton.click()
    await expect(billing.toast(`Invoice ${invoiceNumber} paid successfully`)).toBeVisible()

    await expect(billing.payBillButton).toHaveText('Paid')
    await expect(billing.invoiceDetailStatusBadge).toHaveText('Paid')
    await expect(billing.invoiceHistoryStatusBadge(invoiceNumber)).toHaveText('Paid')

    // The preview modal reads `statusFor(selected)` too, so it should agree.
    await billing.invoiceHistoryViewButton(invoiceNumber).click()
    await expect(billing.previewField('Status')).toHaveText('Paid')
  })

  test('paying clears the late-payment warning as well', async ({ billing }) => {
    await billing.goto()
    await billing.payBillButton.click()
    await billing.payConfirmButton.click()
    await expect(billing.balanceAmount).toHaveText('$0.00')

    // `currentPaid` drives six things on this page. The totals box is not one of them
    // — it holds no reference to it at all — so a customer who has just paid is still
    // shown "Total Amount Due if paid after 1 Sep 2026 $227.71" directly beneath
    // "Total Amount Due $0.00". Two figures for the same invoice, in the same panel,
    // one of them threatening a late fee on a bill that is settled.
    await expect(
      billing.invoiceTotal('Total Amount Due if paid after'),
      'the invoice is paid, but the panel still quotes a late-payment total for it',
    ).toHaveText('$0.00')
  })
})

test.describe('Billing · Manage payment method modal', () => {
  test.use({ storageState: authFile(TAMA.customerId) })

  test('typing updates the card before Save, and Cancel does not roll it back', async ({
    page,
    billing,
  }) => {
    await billing.goto()
    const original = (await billing.paymentMethodCardholder.textContent())!.trim()
    const typed = 'Test Cardholder'
    expect(typed).not.toBe(original)

    await billing.manageButton.click()
    await expect(billing.dialog).toBeVisible()
    await billing.cardholderNameInput.fill(typed)

    // Still open, Save not clicked. `cardName` is written on every keystroke
    // (`onChange={(event)=>setCardName(event.target.value)}`), so the card behind the
    // modal has already changed — there is no gate on it at all, let alone Save.
    await expect(
      billing.paymentMethodCardholder,
      'the cardholder line changed before Save was clicked',
    ).toHaveText(typed)

    await billing.manageCancelButton.click()
    await expect(billing.dialog).not.toBeVisible()

    // Cancel calls only `setMethodOpen(false)` — it never resets `cardName`, so the
    // value typed a moment ago survives a click whose entire purpose is to discard it.
    await expect(
      billing.paymentMethodCardholder,
      'Cancel closed the dialog but did not discard the typed name',
    ).toHaveText(typed)

    // Nothing was ever sent anywhere — `cardName` is a plain `useState`, gone the
    // moment the component remounts. This is what "not really saved" looks like from
    // outside: the bug from the two assertions above disappears on reload, which is
    // not the same thing as the bug being fixed.
    await page.reload()
    await expect(
      billing.paymentMethodCardholder,
      'a real save would survive a reload; this one does not exist',
    ).toHaveText(original)
  })

  test('Save closes the dialog and confirms with a toast', async ({ billing }) => {
    await billing.goto()
    await billing.manageButton.click()
    await expect(billing.dialog).toBeVisible()
    await billing.cardholderNameInput.fill('Another Name')

    await billing.manageSaveButton.click()

    await expect(billing.dialog).not.toBeVisible()
    await expect(billing.toast('Payment method updated')).toBeVisible()
  })
})

/** `2024-07-15` → `15/07/2024`, the format the Invoice Details panel prints dates in. */
function isoToSlashes(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "$184.50" → 184.5. Throws rather than returning NaN, so a missing element fails
 *  with a readable message instead of an arithmetic comparison against NaN. */
function money(text: string | null): number {
  const value = Number((text ?? '').replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(value)) throw new Error(`not a money value: ${JSON.stringify(text)}`)
  return value
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Normalise the several date formats this page uses into `YYYY-MM-DD`.
 *
 * "Due 1 Sep 2026", "01/09/2026", "...if paid after 1 Sep 2026" and "01 Sep 2026" are
 * all the same day written four ways; comparing them as strings would fail on the
 * formatting rather than on the date.
 */
function toIsoDate(text: string | null): string {
  const source = text ?? ''
  const slashes = /(\d{2})\/(\d{2})\/(\d{4})/.exec(source)
  if (slashes) return `${slashes[3]}-${slashes[2]}-${slashes[1]}`

  const words = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(source)
  if (words) {
    const month = MONTHS.indexOf(words[2]!) + 1
    if (month > 0) {
      return `${words[3]}-${String(month).padStart(2, '0')}-${words[1]!.padStart(2, '0')}`
    }
  }
  throw new Error(`no date found in ${JSON.stringify(text)}`)
}
