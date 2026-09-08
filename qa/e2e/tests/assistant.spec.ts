import { expect, test } from '../fixtures/test'
import { ACCOUNTS, authFile } from '../fixtures/accounts'
import { chat, displayDigits, getDemoAccounts, isSafeToDisplay, numericTokens } from '../api/client'

/**
 * The Sparky AI page — mechanics, and the three starter questions the product demos.
 *
 * ## What is asserted, and what is deliberately not
 *
 * Layer 2 is `gemma3:4b` with no seed pinned: the same question against the same account
 * produces different wording every time. So nothing here matches a sentence. What it
 * matches is the contract underneath the sentence — CONVENTIONS.md §5:
 *
 * | asserted | not asserted |
 * |---|---|
 * | the routed intent | the phrasing |
 * | every number on screen came from a fact | the order the numbers appear in |
 * | the badge appears exactly when there are figures | the badge's copy |
 * | a figure matches Postgres | that two generations match each other |
 *
 * A test that fails here fails for a reason that will still be true tomorrow.
 *
 * ## The fourth starter chip is out of scope on purpose
 *
 * "Could another plan save me money?" routes to `tariff_check`, which prices two
 * hardcoded plans (`STANDARD_PLAN`, `LOW_FIXED_PLAN` in `analytics/engine.py`) rather
 * than the 64-code catalogue. The Plans page has no backend yet, so an assertion here
 * would pin down a comparison that is about to be replaced. Excluded by decision, not by
 * omission — see the `plans` test at the bottom, which asserts only that it still routes.
 *
 * ## Timeouts, and why they are this large
 *
 * A single answer takes about 4-6 seconds. That is not what sets the budget.
 *
 * **Ollama is one process serving every worker.** Playwright defaults to half the cores,
 * so six tests ask the model at once and five of them wait; a test that makes two calls
 * can sit behind ten. The queue, not the model, is the cost — and it is a property of
 * running a local LLM rather than anything wrong with the application, so the right
 * response is a budget that accommodates it rather than retries that hide it.
 *
 * `test.slow()` alone (3× the 30s default) was measured to be too tight and produced
 * timeouts that read as application failures. `TURN_TIMEOUT_MS` is set from the worst
 * observed queue depth with room over it. There is still no sleep anywhere in this file:
 * every wait is on the network or on a web-first assertion (§3).
 */

/** Per-test budget for anything that asks the model. See the note above. */
const TURN_TIMEOUT_MS = 240_000

test.describe.configure({ mode: 'parallel' })
test.setTimeout(TURN_TIMEOUT_MS)

/** The three the product demos and this suite covers. The fourth is excluded above. */
const COVERED = [
  { chip: 'Why is my power bill so high?', intent: 'why_bill_high' },
  { chip: 'Which day was my highest usage?', intent: 'peak_usage' },
  { chip: 'Was that just the cold snap?', intent: 'using_more_than_usual' },
] as const

for (const account of ACCOUNTS) {
  test.describe(`Sparky · ${account.displayName}`, () => {
    test.use({ storageState: authFile(account.customerId) })

    test.beforeEach(async ({ assistant }) => {
      await assistant.goto()
      await expect(assistant.heading).toBeVisible()
    })

    // ── The three questions, one test each ───────────────────────────────────────
    //
    // Deliberately not a loop inside one test. One root cause still gets one failure per
    // affected case (CONVENTIONS.md §8), and a loop would stop at the first question that
    // broke and hide the state of the other two for this account.

    for (const { chip, intent } of COVERED) {
      test(`"${chip}" routes to ${intent}`, async ({ assistant }) => {
        const turn = await assistant.askByChip(chip)

        // Layer 0's decision, not the model's. A routing miss is the worst failure this
        // system has: layer 3 verifies that figures are REAL, never that they answer the
        // question asked, so a mis-route reaches the customer stamped "every figure
        // checked" — true, and completely beside the point.
        expect(turn.intent, `"${chip}" was answered by the ${turn.intent} path`).toBe(intent)
      })

      test(`"${chip}" shows only figures the backend computed`, async ({ assistant, request }) => {
        const turn = await assistant.askByChip(chip)
        expect(turn.report, 'the stream ended without a done event').toBeDefined()

        // Withheld answers are the product working, and they carry no figures to check.
        test.skip(!isSafeToDisplay(turn.report!), 'answer was withheld — nothing to ground')

        // Layer 3's own verdict on the answer that is ON SCREEN. Nothing may reach a
        // customer that the number-checker could not tie to a fact — that single sentence
        // is the product's entire claim, and this is the only place in the suite that
        // checks it at the far end of the wire rather than in a unit test.
        expect(
          turn.report!.unverified,
          'these figures were shown to the customer without a fact behind them',
        ).toEqual([])

        // And independently: the rendered text agrees with the deterministic layer-1
        // output. `facts` are pure Python and identical on every call, so a second call
        // is a legitimate source of expected values; `text` is not, which is why the
        // comparison is digits-to-digits and never sentence-to-sentence.
        const { facts } = await chat(request, {
          customer_id: account.customerId,
          message: chip,
        })
        const allowed = new Set(facts.flatMap((f) => displayDigits(f.display)))

        for (const token of numericTokens(turn.text)) {
          expect(
            allowed.has(token) || turn.report!.checked.some((c) => c.includes(token)),
            `"${token}" is on screen but matches no fact. Facts were: ` +
              facts.map((f) => `${f.key}=${f.display}`).join(', '),
          ).toBe(true)
        }
      })
    }

    for (const { chip } of COVERED) {
      test(`"${chip}" does not crash the backend`, async ({ request }) => {
        // Separate from the routing test above because the failure is a different KIND.
        // A mis-route is a wrong answer; a 500 is no answer, a broken page, and — on a
        // starter chip the product demos — something a judge can trip over by clicking
        // the thing we invited them to click.
        //
        // The one that fails: Julia + "Was that just the cold snap?".
        // `MartRepository.context` builds `daily` from every row and `hdd` from the rows
        // whose `heating_degree_days` is not null (`repository.py:302`). Julia's 24 days
        // all carry NULL, so the two lists are 24 and 0 long, and `weather_attribution`
        // raises `ValueError("need one heating-degree-day figure per day of readings")`
        // straight out of the endpoint.
        //
        // Two owners, and both fixes are wanted: the data has a hole, and a hole in the
        // weather join should degrade to "Sparky cannot tell you how much of this was the
        // weather" rather than take the page down.
        const response = await request.post('/api/chat', {
          data: { customer_id: account.customerId, message: chip },
          timeout: 120_000,
        })
        expect(
          response.status(),
          `POST /api/chat → ${response.status()} for a prompt the start screen offers`,
        ).toBeLessThan(500)
      })
    }

    test('the highest day it names is the highest day in the database', async ({
      request,
      db,
    }) => {
      // The third assertion tier for this question, and it was missing.
      //
      // "Why is my bill high" and "was that the cold snap" are both reconciled against
      // `kea.mart_bill_explanation` in `bill-explainer.spec.ts`. "Which day was my highest
      // usage" had UI-against-API and nothing under it, so a peak computed over the wrong
      // window would have been rendered faithfully, verified by layer 3, and reported
      // green by this suite. Same breadth as the other two, one tier less depth.
      //
      // It is not hypothetical. Mereana's invoice covers April 2024; the window behind the
      // answer is June's ten days, so she is told her highest day used 20.14 kWh when the
      // highest day her bill actually charges for is 11.80 — 71% out.
      //
      // Compared on kWh, not on the day INDEX. The index means "day N of Sparky's window"
      // and the window is the thing under suspicion, so comparing indices would be
      // comparing the bug to itself.
      const bill = await db.latestBill(account.customerId)
      test.skip(bill === null, 'no bill for this account — nothing to scope a period to')

      const { facts } = await chat(request, {
        customer_id: account.customerId,
        message: 'Which day was my highest usage?',
      })
      const peak = facts.find((f) => f.key === 'peak_day_kwh')
      test.skip(peak === undefined, 'no peak fact')

      const truePeak = await db.peakDayInPeriod(
        account.customerId,
        bill!.periodStart,
        bill!.periodEnd,
      )
      test.skip(truePeak === null, 'no metered days inside the billed period')

      expect(
        peak!.value,
        `Sparky names a day using ${peak!.value} kWh; the highest day between ` +
          `${bill!.periodStart} and ${bill!.periodEnd} is ${truePeak!.date} at ` +
          `${truePeak!.kwh} kWh`,
      ).toBeCloseTo(truePeak!.kwh, 1)
    })

    test('the badge claims verification exactly when there are figures to verify', async ({
      assistant,
    }) => {
      const turn = await assistant.askByChip('Which day was my highest usage?')
      test.skip(!isSafeToDisplay(turn.report!), 'answer was withheld')

      // The app tests `/\d/.test(text)` rather than `report.checked.length`, and the
      // reason is in its own comment: a template fallback is assembled from verified
      // facts without running the checker, so `checked` is empty on an answer full of
      // figures. The claim is about figures, so the test looks for figures.
      const hasFigures = /\d/.test(turn.text)
      await expect(assistant.verifiedBadge(assistant.lastAnswer)).toHaveCount(hasFigures ? 1 : 0)
    })

    test('typing a question gives the same analysis as clicking the chip', async ({
      assistant,
      request,
    }) => {
      // Requirement §4: the composer and the starter chips must not be two code paths.
      // Compared on FACTS, never on wording — two generations of the same question differ
      // by design, and asserting they match would fail on a correct application.
      const typed = await assistant.askByTyping('Why is my power bill so high?')
      expect(typed.intent).toBe('why_bill_high')

      const viaApi = await chat(request, {
        customer_id: account.customerId,
        message: 'Why is my power bill so high?',
      })
      expect(viaApi.intent).toBe(typed.intent)
    })

    test('the answer is about this customer and not the first household', async ({
      assistant,
      request,
    }) => {
      // The bug this pins: `AssistantPage.tsx` used to fall through to `hs[0]` when the
      // signed-in id was not found, so all fourteen logins were shown the same person's
      // usage. It is fixed; this keeps it fixed, for every account rather than for one.
      const turn = await assistant.askByChip('Which day was my highest usage?')
      test.skip(!isSafeToDisplay(turn.report!), 'answer was withheld')

      const mine = await chat(request, {
        customer_id: account.customerId,
        message: 'Which day was my highest usage?',
      })
      const peakDay = mine.facts.find((f) => f.key === 'peak_day')
      expect(peakDay, 'no peak_day fact').toBeDefined()

      // The day number is this account's own. Weak on its own — several households peak
      // on the same day — but combined with the kWh figure below it is not.
      const peakKwh = mine.facts.find((f) => f.key === 'peak_day_kwh')!
      expect(
        turn.text,
        `the answer does not contain this account's own peak of ${peakKwh.display}`,
      ).toContain(peakKwh.display.replace(' kWh', ''))
    })
  })
}

// ── Page mechanics ─────────────────────────────────────────────────────────────────
//
// One account is enough for these: they are properties of the page, not of the data, and
// running them fourteen times would add twelve minutes to prove the same DOM twice.

test.describe('Sparky · the page itself', () => {
  test.use({ storageState: authFile('DEMO-ACCT-223001') })

  test.beforeEach(async ({ assistant }) => {
    await assistant.goto()
    await expect(assistant.heading).toBeVisible()
  })

  test('the start screen offers exactly the four documented prompts', async ({ assistant }) => {
    await expect(assistant.promptChips).toHaveCount(4)
    await expect(assistant.promptChips).toHaveText([
      'Why is my power bill so high?',
      'Which day was my highest usage?',
      'Was that just the cold snap?',
      'Could another plan save me money?',
    ])
  })

  test('New chat is hidden until there is a chat to leave', async ({ assistant }) => {
    // Requirement §2. `newChat()` resets the transcript and returns to this very screen,
    // so on the start screen the control does nothing a customer could want — and a
    // button that visibly does nothing teaches people it is broken.
    //
    // `AssistantPage.tsx:365` renders it unconditionally, outside the `started ? … : …`
    // block that swaps the transcript for the start screen. Expect this to fail until
    // that button moves inside the conditional.
    await expect(
      assistant.newChatButton,
      'New chat is offered on the start screen, where there is no chat to start over',
    ).toBeHidden()
  })

  test('New chat appears once a conversation has started', async ({ assistant }) => {
    await assistant.askByChip('Which day was my highest usage?')
    await expect(assistant.newChatButton).toBeVisible()
  })

  test('New chat returns to the start screen and clears the transcript', async ({ assistant }) => {
    await assistant.askByChip('Which day was my highest usage?')
    await expect(assistant.assistantBubbles).toHaveCount(2) // greeting + answer

    await assistant.newChatButton.click()
    await expect(assistant.startScreen).toBeVisible()
    await expect(assistant.userBubbles).toHaveCount(0)
  })

  test('the thinking indicator is replaced by the answer, not left beside it', async ({
    assistant,
  }) => {
    await assistant.askByChip('Which day was my highest usage?')
    await expect(assistant.thinkingIndicator).toHaveCount(0)
    await expect(assistant.assistantBubbles).toHaveCount(2)
  })

  test('editing a question re-asks it and drops what followed', async ({ assistant }) => {
    await assistant.askByChip('Which day was my highest usage?')
    await expect(assistant.userBubbles).toHaveCount(1)

    const edited = await assistant.editQuestion(0, 'Was that just the cold snap?')
    expect(edited.intent, 'the edited question was routed by its new wording').toBe(
      'using_more_than_usual',
    )

    // The old answer is gone rather than stranded above a question that is no longer on
    // screen — `saveEdit` slices the transcript at the edited message, because everything
    // after it was an answer to the old wording.
    await expect(assistant.userBubbles).toHaveCount(1)
    await expect(assistant.userBubbles.first()).toHaveText('Was that just the cold snap?')
  })

  test('the household picker is a data override, not an account switch', async ({
    assistant,
    page,
  }) => {
    // Documented rather than accused: the picker sets React state and never touches
    // `loadSession()`, so the sidebar keeps naming whoever signed in while the answers
    // come from somebody else. That is fine as an internal demo aid and dangerous if
    // anyone mistakes it for a login, so the divergence is pinned here in one place.
    await expect(assistant.householdPicker).toBeVisible()
    await assistant.householdPicker.selectOption({ label: 'Julia Fox' })

    await page.getByRole('button', { name: 'Open profile menu' }).click()
    await expect(
      page.locator('.profile-menu'),
      'the profile menu should still name the signed-in customer, not the picked household',
    ).toContainText('Tama Rewiri')
  })

  test('signing out and back in as someone else changes the answers', async ({
    assistant,
    page,
    request,
  }) => {
    // The switch that actually exercises auth — requirement §1. The picker above does
    // not, so this is the path the coverage claim rests on.
    const tama = await assistant.askByChip('Which day was my highest usage?')
    expect(tama.intent).toBe('peak_usage')

    await page.locator('button.logout-button').click()
    await page.getByRole('button', { name: 'Yes' }).click()
    await page.waitForURL('**/login')

    const card = (await getDemoAccounts(request)).find((a) => a.customer_id === 'DEMO-ACCT-224001')!
    await page.getByLabel('Email').fill(card.email)
    await page.getByLabel(/^Password/).fill(card.password)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForURL('**/dashboard')

    await assistant.goto()
    const mere = await assistant.askByChip('Which day was my highest usage?')

    const mereFacts = await chat(request, {
      customer_id: 'DEMO-ACCT-224001',
      message: 'Which day was my highest usage?',
    })
    const peak = mereFacts.facts.find((f) => f.key === 'peak_day_kwh')!
    expect(mere.text).toContain(peak.display.replace(' kWh', ''))
  })

  test('the fourth prompt still routes somewhere real', async ({ assistant }) => {
    // Not a coverage claim. The Plans page has no backend and `tariff_check` prices two
    // hardcoded plans, so the ANSWER is not asserted — only that the chip does not land
    // on `out_of_scope`, which is what a starter chip must never do.
    const turn = await assistant.askByChip('Could another plan save me money?')
    expect(turn.intent).toBe('tariff_check')
  })
})
