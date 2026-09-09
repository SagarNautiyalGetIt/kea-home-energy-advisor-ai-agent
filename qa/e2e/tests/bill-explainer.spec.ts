import { expect, test } from '../fixtures/test'
import { ACCOUNTS, authFile } from '../fixtures/accounts'
import { dominantDriver, driversOf } from '../fixtures/db'
import { chat, getHousehold, isGrounded, numericTokens } from '../api/client'

/**
 * "Why is my power bill so high?" — the specification, written as tests.
 *
 * ## Read this before opening a failure
 *
 * **Most of this file is expected to fail today, and that is what it is for.** These are
 * not regressions. They are the acceptance criteria for a feature that has not been
 * built, written down in the only form a developer can run.
 *
 * Every test carries an annotation naming which of the two it is, and the annotation
 * shows in the HTML report beside the failure:
 *
 * | annotation | meaning |
 * |---|---|
 * | `tdd` | the behaviour does not exist yet. The red is the requirement. |
 * | `defect` | the behaviour exists and computes the wrong answer. |
 *
 * Reporting them together is deliberate — a suite that only tested what was already
 * built would have nothing to say about the gap this page has — but a reader who cannot
 * tell "not done" from "done wrong" cannot prioritise, so the two are labelled rather
 * than mixed.
 *
 * ## Where the expected values come from
 *
 * `kea.mart_bill_explanation`, and nowhere else. §8.5 of `kea-data-platform-design.md`
 * defines the decomposition; Harvey's ELT computes it; this file reads the columns. It
 * does **not** re-implement the five formulas. A test that recomputed
 * `sens × (hdd − prior_hdd) × rate` would give a failure three possible causes — the
 * app, the mart, or the test's own arithmetic — where reading a column gives it one.
 *
 * The one exception is the sum of the five deltas, which the design document states as a
 * schema assertion and which is arithmetic too simple to get wrong.
 *
 * ## The finding underneath the whole file
 *
 * `POST /api/chat` never reads this mart. `services/api/app/db/marts.py` defines the ORM
 * model and says it is "included because the explainer and the warning are about to need
 * them"; the repository queries `mart_account_context`, `mart_daily_usage` and
 * `mart_forecast_input` and stops there. So the assistant answers "why is my bill high"
 * by comparing the household against *other households* rather than against *its own
 * previous bill*, with a two-way spike/sustained split instead of §8.5's five drivers.
 *
 * Both answers are internally consistent. Only one of them answers the question.
 */

test.describe.configure({ mode: 'parallel' })
test.setTimeout(240_000)

const WHY = 'Why is my power bill so high?'
const COLD = 'Was that just the cold snap?'

/** The nine with rows in Harvey's marts. The five `H-*` seeds have no `billing.bill` at
 *  all, so there is no prior period for them to be compared against and nothing in this
 *  file applies. */
const MART_ACCOUNTS = ACCOUNTS.filter((a) => a.kind === 'mart')

const tdd = { type: 'tdd', description: 'Behaviour not built yet — this red is the requirement' }
const defect = { type: 'defect', description: 'Behaviour exists and returns the wrong answer' }

// ── Contract F · the answer is about the bill the customer is holding ──────────────
//
// The most checkable thing a customer can do with any of this is put it beside their
// invoice. Everything in this section is something they would notice in ten seconds, and
// none of it was covered before: the earlier contracts all asked whether the explanation
// was RIGHT, and never whether it was about the right bill.

for (const account of MART_ACCOUNTS) {
  test.describe(`Bill explainer · ${account.displayName} · agrees with the invoice`, () => {
    test.use({ storageState: authFile(account.customerId) })

    test('the period it discusses is the period the bill covers', {
      annotation: defect,
    }, async ({ request, db }) => {
      const bill = await db.latestBill(account.customerId)
      test.skip(bill === null, 'no bill for this account')

      const { text } = await chat(request, {
        customer_id: account.customerId,
        message: WHY,
      })
      // `period_cost` was a fact on the response; there are no facts now. The same
      // figure is on `/api/households/{id}`, which reads the rows the assistant's own
      // tools read — and since KEA-141 §2 both use the account's effective rate rather
      // than a flat illustrative one, so this is now a real reconciliation.
      const period = { value: (await getHousehold(request, account.customerId)).estimated_cost_nzd }

      // `MartRepository.context` takes the last calendar month present in
      // `mart_daily_usage` (`repository.py:291`), which is not the same thing as the
      // period the invoice covers:
      //
      //   Daniel   bill 2024-05-01→06-12 (43 days)   Sparky discusses June's 12 days
      //   Mereana  bill 2024-04-01→04-30             Sparky discusses June's 10 days
      //
      // Mereana's is the bad one — a different month entirely. §8.5's whole worked
      // example turns on period length, so a household whose 43-day bill is explained
      // from a 12-day window cannot be explained correctly by any arithmetic downstream.
      const billMonth = bill!.periodEnd.slice(0, 7)
      const label = period!.label // "Total cost for June 2024"
      const month = new Date(`${billMonth}-01T00:00:00Z`).toLocaleString('en-NZ', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
      expect(
        label,
        `the invoice covers ${bill!.periodStart}→${bill!.periodEnd}; the answer is about "${label}"` +
          `\n  first line: "${text.split('\n')[0]}"`,
      ).toContain(month)

      // The month alone is not enough, and Daniel is why: his invoice ends 12 June, so
      // the LABEL says June and matches — while the window behind it is June's twelve
      // days against a bill covering forty-three. Length is the first thing §8.5 removes,
      // so a window of the wrong length cannot be explained correctly by any arithmetic
      // downstream of it.
      const household = await getHousehold(request, account.customerId)
      const billDays =
        Math.round(
          (Date.parse(`${bill!.periodEnd}T00:00:00Z`) - Date.parse(`${bill!.periodStart}T00:00:00Z`)) /
            86_400_000,
        ) + 1
      expect(
        household.daily_kwh.length,
        `the invoice covers ${billDays} days (${bill!.periodStart}→${bill!.periodEnd}); ` +
          `the answer is computed over ${household.daily_kwh.length}`,
      ).toBe(billDays)
    })

    test('the total it quotes is the total on the bill', { annotation: defect }, async ({
      request,
      db,
    }) => {
      const bill = await db.latestBill(account.customerId)
      test.skip(bill === null, 'no bill for this account')

      const period = { value: (await getHousehold(request, account.customerId)).estimated_cost_nzd }

      // The fact is labelled "Total cost for June 2024" and reads, in the answer, exactly
      // like the invoice total. It is not one: layer 1 prices every household at a flat
      // illustrative 30c/kWh (`_ILLUSTRATIVE_PRICE`) while `billing.bill` holds real
      // charges. Every one of the nine disagrees, from $3.59 to $146.85.
      //
      // The Terms modal does disclose the illustrative rate. That is not a defence — the
      // disclosure is behind a link almost nobody opens, and the LABEL still claims to be
      // the total. Either the figure becomes the real one, or the label stops saying
      // "total cost" and starts saying "estimated at 30c/kWh".
      expect(
        period!.value,
        `Sparky says $${period!.value}; invoice ${bill!.invoiceNumber} says ` +
          `$${bill!.totalCharges}. A customer holding the bill sees two different numbers ` +
          'for the same month.',
      ).toBeCloseTo(bill!.totalCharges, 2)
    })

    test('does not answer "why is it high" about a bill that fell', {
      annotation: defect,
    }, async ({ assistant, db }) => {
      const explanation = await db.billExplanation(account.customerId)
      test.skip(!explanation?.hasPrior, 'no prior bill')
      test.skip((explanation!.amountDelta ?? 0) >= 0, 'this bill did go up')

      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      // Rangi's latest bill is $151.04 → $144.65. He asks why it is so high and is told
      // "Most of your bill is from using 0.3 kWh more each day than similar homes" —
      // an answer to a question about other households, given to a customer whose own
      // bill just went DOWN. Five of his twelve periods are like this.
      //
      // Correcting the premise is not pedantry; it is the whole difference between an
      // assistant that read your account and one that ran a template.
      expect(
        turn.text.toLowerCase(),
        `this bill FELL by $${Math.abs(explanation!.amountDelta!).toFixed(2)} ` +
          `($${explanation!.priorTotalAmount} → $${explanation!.totalAmount}) and the ` +
          'answer never says so',
      ).toMatch(/\b(lower|less|down|fell|dropped|decreased|cheaper|reduction)\b/)
    })
  })
}

// ── Contract 0 · the data is there ─────────────────────────────────────────────────

test.describe('Bill explainer · the ground truth exists', () => {
  test('every mart account has a decomposition to be explained from', async ({ db }) => {
    // Not a UI test. It establishes that the rest of this file is measuring the
    // application rather than an empty table — and it catches the one account where the
    // ELT, not the app, is the problem.
    const missing: string[] = []
    for (const account of MART_ACCOUNTS) {
      const explanation = await db.billExplanation(account.customerId)
      const bills = await db.bills(account.customerId)
      // A single bill has nothing before it; that is a fact about the household. No row
      // at all, against two bills, is a gap in the load.
      if (explanation === null && bills.length > 1) missing.push(account.customerId)
    }
    expect(
      missing,
      'these accounts have more than one bill but no row in kea.mart_bill_explanation, ' +
        'so nothing can explain their latest bill — this is an ELT gap, not an app bug',
    ).toEqual([])
  })

  for (const account of MART_ACCOUNTS) {
    test(`${account.displayName}: the five drivers sum to the movement`, async ({ db }) => {
      const rows = await db.explanations(account.customerId)
      const explained = rows.filter((r) => r.hasPrior)
      test.skip(explained.length === 0, 'no prior bill — nothing to decompose')

      // §8.5: "A schema assertion requires the five to sum to `amount_delta` exactly, so
      // the residual absorbs the difference rather than being quietly dropped." The
      // residual is routinely NEGATIVE — Tama's is −9.34 — and asserting otherwise would
      // fail on the documented, correct behaviour.
      for (const row of explained) {
        const sum =
          (row.periodLength ?? 0) +
          (row.weather ?? 0) +
          (row.baseLoad ?? 0) +
          (row.tariff ?? 0) +
          (row.unexplained ?? 0)
        expect(sum, `${row.periodStart}~${row.periodEnd} does not reconcile`).toBeCloseTo(
          row.amountDelta ?? 0,
          2,
        )
      }
    })
  }
})

// ── Contract E · the answer names the driver the data names ────────────────────────

for (const account of MART_ACCOUNTS) {
  test.describe(`Bill explainer · ${account.displayName}`, () => {
    test.use({ storageState: authFile(account.customerId) })

    test(`compares against this account's own previous bill`, { annotation: tdd }, async ({
      assistant,
      request,
      db,
    }) => {
      const explanation = await db.billExplanation(account.customerId)
      test.skip(!explanation?.hasPrior, 'no prior bill to compare against')

      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      // Fact keys became tool names. The claim is the same shape — the answer was built
      // from the right material — but it is now about what was READ rather than what was
      // pre-computed, which is the thing a customer could actually check.
      const { sources } = await chat(request, { customer_id: account.customerId, message: WHY })
      const keys = sources.filter((s) => s.ok).map((s) => s.tool)

      // The question is "why is MY bill high", and the only comparison a customer can
      // check is against the bill they already have. The current bundle offers
      // `sustained_overshoot` — how this household differs from OTHER households — which
      // is a different and unfalsifiable claim: the customer cannot see their neighbours'
      // meters. §8.5 exists to make the comparison one they can audit.
      expect(
        keys,
        'the answer is built from a comparable-homes baseline. Expected the previous ' +
          `bill: ${explanation!.priorTotalAmount} → ${explanation!.totalAmount} ` +
          `(a movement of ${explanation!.amountDelta})`,
      ).toContain('amount_delta')
    })

    test('names the driver that actually carries the movement', { annotation: tdd }, async ({
      assistant,
      request,
      db,
    }) => {
      const explanation = await db.billExplanation(account.customerId)
      test.skip(!explanation?.hasPrior, 'no prior bill to compare against')

      const dominant = dominantDriver(explanation!)
      test.skip(
        dominant === null,
        'no single driver carries ≥50% of this movement — the honest answer names two, ' +
          'which is a different assertion',
      )

      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      const ranked = driversOf(explanation!)

      // There is no `delta_from_*` fact key to look for. The equivalent — and the thing
      // the ticket was actually about — is that the answer names the driver carrying the
      // movement, so it is asserted on the ANSWER against the mart's own ranking.
      //
      // Matched on the dollar amount rather than on the driver's name: §8.5 names are
      // ours, the customer sees a figure, and asserting the wording would be asserting
      // prose. Rounded, because the answer states dollars and the mart stores cents.
      const top = ranked[0]!
      const onScreen = numericTokens(turn.text).map((t) => Math.abs(Math.round(Number(t))))
      expect(
        onScreen,
        `${ranked.map((d) => `${d.driver}=${d.nzd}`).join('  ')} — ` +
          `${dominant} carries this bill and the answer never quotes it: "${turn.text.slice(0, 160)}"`,
      ).toContain(Math.abs(Math.round(top.nzd)))
    })

    test('does not blame a driver the data does not support', { annotation: tdd }, async ({
      assistant,
      db,
    }) => {
      const explanation = await db.billExplanation(account.customerId)
      test.skip(!explanation?.hasPrior, 'no prior bill to compare against')

      // The specific failure §8.5 opens with: "A 43-day move-in bill looks like a 40%
      // consumption increase and is not one; attributing it to cold weather would be
      // confidently wrong." Daniel is that bill — 43 days, and `period_length` is 48.86
      // of a 76.85 movement. An answer that leads on weather for him is the exact error
      // the ordering rule exists to prevent.
      const dominant = dominantDriver(explanation!)
      test.skip(dominant !== 'period_length', 'not a period-length bill')

      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      expect(
        turn.text.toLowerCase(),
        `${explanation!.periodDays} days against ${explanation!.priorTotalAmount === null ? '?' : ''}` +
          `prior — the movement is mostly the extra days, not the weather`,
      ).not.toMatch(/\b(cold|colder|weather|heating|temperature)\b/)
    })

    test('says so plainly when it cannot explain the bill', { annotation: tdd }, async ({
      assistant,
      db,
    }) => {
      const explanation = await db.billExplanation(account.customerId)
      // Two ways to be unexplainable, and both must produce an honest answer rather than
      // a confident one: no prior bill at all (Julia), or drivers that cover under 60% of
      // the movement (`is_explainable = false`).
      const unexplainable = explanation === null || !explanation.hasPrior || !explanation.isExplainable
      test.skip(!unexplainable, 'this bill is explainable — covered by the tests above')

      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      // Not a wording match: a hedge is a *structural* property here, so the assertion is
      // that SOMETHING marks the answer as uncertain. Failing this means the assistant
      // gave a confident explanation of a bill the data cannot explain.
      expect(
        turn.text.toLowerCase(),
        `is_explainable=${explanation?.isExplainable ?? 'no row'}, ` +
          `unexplained=${explanation?.unexplained ?? 'n/a'} of ${explanation?.amountDelta ?? 'n/a'} — ` +
          'the answer states a cause with no hedge',
      ).toMatch(/\b(can'?t|cannot|not able|unable|don'?t know|isn'?t clear|not clear|some of|part of|about|roughly|approximately|estimate)\b/)
    })
  })
}

// ── Contract D · a figure that is always zero is not an answer ─────────────────────
//
// Found by the honest-refusal test above, which caught Julia being told:
//
//   "Most of your bill is a steady 0.0 kWh a day that runs whether you're home or not,
//    and over a year that costs $0.00. The one-off spike explains 0% of the extra usage
//    and costs $0.00. Your total for August 2024 was $54.13."
//   ✓ Every figure checked against your meter data
//
// Every figure in it IS checked, and the answer is still worthless. This is the limit of
// layer 3 stated in `pipeline.py`'s own comment — it verifies that figures are real,
// never that they mean anything — and it is why these two live at the UI level rather
// than in pytest: only a test that reads the sentence can see that the sentence is empty.
//
// The cause is calibration, not arithmetic. `SPIKE_THRESHOLD = 1.8` asks for a day at
// 1.8× the window's median. Akash's five synthetic fixtures have hand-drawn spikes and
// clear it; Harvey's nine are aggregated from real half-hourly metering and peak at
// 1.00-1.27×, so not one of them can ever produce a spike. Two of the five facts in the
// flagship answer are dead for every real household in the demo.

for (const account of MART_ACCOUNTS) {
  test.describe(`Bill explainer · ${account.displayName} · empty figures`, () => {
    test.use({ storageState: authFile(account.customerId) })

    test('does not build a sentence around a figure that is structurally zero', {
      annotation: defect,
    }, async ({ assistant, request }) => {
      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      // Asserted on the ANSWER now, because the cause is gone rather than fixed.
      //
      // The bundle used to hand the model five facts with no indication that two were
      // vacuous — SPIKE_THRESHOLD needs a day at 1.8x the median and these accounts peak
      // at 1.00-1.27x — so it narrated "the one-off spike explains 0% of the extra usage
      // and costs $0.00". There is no fixed fact list to carry a vacuous entry any more:
      // the model reads real rows and chooses what is worth saying.
      //
      // What remains checkable, and what the customer actually sees, is the symptom.
      expect(
        turn.text,
        `the answer still narrates a structurally empty figure: "${turn.text.split('\n')[0]}"`,
      ).not.toMatch(/\$0\.00|\b0%|\b0\.0 kWh/)
    })

    test('says something other than zero about where the money went', {
      annotation: defect,
    }, async ({ assistant, request }) => {
      await assistant.goto()
      const turn = await assistant.askByChip(WHY)
      expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

      // Julia's floor case, asserted on the answer rather than on a bundle that no
      // longer exists: the reply to "why is my bill high" has to say more than her total,
      // which she can already read off the invoice.
      const household = await getHousehold(request, account.customerId)
      const total = String(Math.round(household.estimated_cost_nzd))
      const figures = numericTokens(turn.text).filter((t) => Math.round(Number(t)) !== Number(total))
      const substantive = figures

      // Julia's floor case: four of five facts are zero, leaving `period_cost` — the
      // total she can already read off her bill. The answer to "why is my bill high" is
      // then her bill total and nothing else.
      expect(
        substantive.length,
        `the only non-zero figure is the bill total the customer already has: ` +
          `"${turn.text.split('\n')[0]}"`,
      ).toBeGreaterThan(0)
    })
  })
}

// ── Contract A/B/C · the conversation ──────────────────────────────────────────────

test.describe('Bill explainer · the second turn', () => {
  test.use({ storageState: authFile('DEMO-ACCT-222001') }) // Ana: is_explainable = false

  /**
   * The reply space is bounded because SPARKY asks the question, not the customer.
   *
   * This is the design point the whole multi-turn requirement turns on, and it is worth
   * stating where the tests are rather than in a document nobody opens. "What might a
   * customer type next?" is unbounded and untestable. "What are the valid answers to the
   * question we just asked them?" is a short list — and `clarify/questions.py` already
   * writes the question in Python precisely so that list stays short.
   *
   * So these are not dialogue scripts. Each is an equivalence class of replies that must
   * be understood identically, and one failure per member is deliberate (§8): a reader
   * seeing five reds for five phrasings learns something a single red would not tell
   * them, which is that the gap is general and not one missing keyword.
   */
  const AFFIRMATIVE = ['Yes', 'yes please', 'yeah', 'correct', "that's right"]
  const CAUSE_REPLIES = ['we bought a heater', 'a heat pump arrived', 'we had guests staying']

  for (const reply of AFFIRMATIVE) {
    test(`"${reply}" is understood as an answer, not a new question`, { annotation: tdd }, async ({
      assistant,
    }) => {
      await assistant.goto()
      const first = await assistant.askByChip(WHY)
      expect(first.tools).toContain('get_bill_comparison')

      const second = await assistant.askByTyping(reply)

      // The failure this pins: a reply that is only meaningful in context used to land on
      // the empty bundle whose caveat is "You have NO figures for this question", because
      // the router saw one message with no history. A customer confirming what Sparky just
      // offered was told Sparky cannot help — the worst possible moment to say it.
      //
      // With history threaded there is no router to misroute to, so the assertion is the
      // outcome rather than the intent: the reply is answered from this household's data
      // rather than deflected.
      expect(
        isGrounded(second),
        `"${reply}" after "${WHY}" was answered without reading anything — the turn ` +
          'before it was ignored',
      ).toBe(true)
      expect(second.text).not.toMatch(/connect you with|put you through|cannot help with/i)
    })
  }

  for (const reply of CAUSE_REPLIES) {
    test(`"${reply}" is taken as a cause for the step`, { annotation: tdd }, async ({
      assistant,
    }) => {
      await assistant.goto()
      await assistant.askByChip(WHY)
      const second = await assistant.askByTyping(reply)

      // `clarify/apply.py` knows how to re-attribute a confirmed cause, and the chat path
      // can now reach it: `answer_clarifying_question` records the reply against the open
      // question and the pipeline writes it after the turn (KEA-142 point 4).
      //
      // Asserted on the outcome rather than on the tool call, because whether the model
      // recognises THIS phrasing as a reply is a model question, and the suite's rule is
      // to assert structure. What must hold either way: the reply is answered from the
      // household's data and not deflected.
      expect(
        isGrounded(second),
        `"${reply}" answers the appliance question in clarify/questions.py and was ` +
          'answered without reading anything',
      ).toBe(true)
      expect(second.text).not.toMatch(/connect you with|put you through|cannot help with/i)
    })
  }

  test('offers the next turn when it cannot close the gap alone', { annotation: tdd }, async ({
    assistant,
    db,
  }) => {
    const explanation = await db.billExplanation('DEMO-ACCT-222001')
    expect(explanation?.isExplainable, 'fixture assumption: Ana is the unexplainable one').toBe(false)

    await assistant.goto()
    const turn = await assistant.askByChip(WHY)
    expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

    // Contract A. The trigger is computed, never judged by the model — `clarify/detect.py`
    // opens with why. `is_explainable = false` means the named drivers cover under 60% of
    // the movement, which is exactly the "specific, quantified gap" that module asks a
    // question about. $40.51 of Ana's $66.50 is unattributed.
    expect(
      turn.text.trimEnd(),
      `$${explanation!.unexplained} of a $${explanation!.amountDelta} movement is ` +
        'unattributed and the answer ends without asking anything',
    ).toMatch(/\?$/)
  })

  test('asks at most one question, never a form', { annotation: tdd }, async ({ assistant }) => {
    await assistant.goto()
    const turn = await assistant.askByChip(WHY)
    expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

    // `questions.select` returns at most one and says why: "A person answering three
    // questions about their house has been given homework in exchange for an explanation
    // they asked for."
    const questions = (turn.text.match(/\?/g) ?? []).length
    expect(questions, 'more than one question in a single answer').toBeLessThanOrEqual(1)
  })

  test('continuing a conversation is offered by the API and ignored by the page', async ({
    assistant,
    request,
  }) => {
    // A defect of a quieter kind: `ChatRequest.conversation_id` is documented as "Continue
    // an existing conversation. Omit on the first message; send back whatever the previous
    // response returned." `AssistantPage.tsx` calls `streamChat({ customer_id, message })`
    // and never sends it, so even the grouping the field does provide is lost.
    await assistant.goto()
    const first = await assistant.askByChip(WHY)
    expect(first.conversationId, 'the API returned no conversation id').not.toBeNull()

    const second = await assistant.askByTyping('Which day was my highest usage?')
    expect(
      second.conversationId,
      'the page starts a new conversation for every message, so the evidence log cannot ' +
        'reconstruct a session even though the schema supports it',
    ).toBe(first.conversationId)
  })
})

// ── The cold-snap defect ───────────────────────────────────────────────────────────

test.describe('Bill explainer · "was that just the cold snap?"', () => {

  for (const account of MART_ACCOUNTS) {
    test.describe(account.displayName, () => {
      test.use({ storageState: authFile(account.customerId) })

      test('the weather share is measured against the increase, not against total usage', {
        annotation: defect,
      }, async ({ assistant, request, db }) => {
        const explanation = await db.billExplanation(account.customerId)
        test.skip(!explanation?.hasPrior, 'no prior period to have got colder than')

        await assistant.goto()
        const turn = await assistant.askByChip(COLD)
        expect(isGrounded(turn), 'the answer consulted none of this household\'s data — prose with nothing behind it').toBe(true)

        // `weather_share` was a fact computed by `build_weather_check`, which divided by
        // `window.total_kwh` — the share of ALL their power, not of the increase. There is
        // no such fact now: the weather driver comes from the mart's own decomposition,
        // which divides by the movement, and the model reads it directly.
        // `weather_share` was a fact from `build_weather_check`, which divided by
        // `window.total_kwh` — the share of ALL their power. The customer asked about the
        // EXTRA. Tama: the mart attributes $61.92 of a $65.41 increase to weather, 94.7%;
        // the page said 2%. Both arithmetically correct, only one responsive.
        //
        // There is no share fact now. The weather driver comes from the mart's own
        // decomposition, which divides by the movement, so the assertion is that the
        // answer opened that decomposition and quotes ITS weather figure.
        //
        // On the dollars, not on a percentage: the mart stores the amount, the share is
        // something either side may round differently, and a customer checking this
        // against their bill is checking an amount.
        const { sources } = await chat(request, { customer_id: account.customerId, message: COLD })
        expect(
          sources.filter((s) => s.ok).map((s) => s.tool),
          'the cold-snap question was answered without opening the bill decomposition',
        ).toContain('get_bill_comparison')

        const weather = Math.abs(Math.round(explanation!.weather ?? 0))
        test.skip(weather === 0, 'weather explains nothing on this bill')

        const onScreen = numericTokens(turn.text).map((t) => Math.abs(Math.round(Number(t))))
        const share = Math.abs((explanation!.weather ?? 0) / (explanation!.amountDelta || 1)) * 100
        expect(
          onScreen,
          `weather=$${explanation!.weather} of a $${explanation!.amountDelta} movement ` +
            `= ${share.toFixed(1)}% of the increase, and the answer never quotes it: ` +
            `"${turn.text.slice(0, 160)}"`,
        ).toContain(weather)
      })
    })
  }

  test('the heating-degree-day base is the same on both sides of the wire', {
    annotation: defect,
  }, async ({ db }) => {
    // A pure data assertion, and the cheapest way to see the bug that makes the figure
    // above small even before the denominator is corrected.
    //
    // `mart_daily_usage.heating_degree_days` is `GREATEST(16 - temp, 0)` (§8.4).
    // `analytics/climate.py` normals are NIWA figures at base 18. `MartRepository` used
    // to feed the base-16 column into that comparison, which discards about two degree
    // days from every single day before `max(0, hdd − normal)` has run — so every winter
    // month read as warmer than typical and the weather driver clamped to $0.00.
    //
    // **This originally asserted `hddThis / periodDays > 8.1`, and that was checking the
    // wrong layer.** `hdd_this_period` is the warehouse's own column, and base 16 is the
    // warehouse's documented standard (`hdd_base_c`, dbt_project.yml). Demanding it clear
    // a base-18 threshold demands the warehouse change convention for every consumer it
    // has — which is a cross-team decision, not a bug in the mart. The API was the side
    // that mixed the two, and KEA-147 fixed it there by deriving the degree day from
    // `temp_mean_c`, which carries no base at all.
    //
    // So the assertion below is the invariant that survives: the warehouse is base 16, on
    // purpose, and the same days read differently enough at base 18 that no one may quietly
    // substitute one for the other. If `hdd_base_c` ever moves, `stored` stops matching
    // `atBase16` and this fails — which is the regression actually worth catching here.
    // That the API honours the split is pinned separately, in
    // services/api/tests/test_repository.py.
    const heat = await db.heatingDemandByBase('DEMO-ACCT-223001')
    expect(heat, 'Tama has a billed period with weather joined to it').not.toBeNull()

    expect(
      heat!.stored,
      'the warehouse writes heating_degree_days at base 16 (hdd_base_c); if this drifts, ' +
        'every consumer that assumed a base is now wrong and none of them will crash',
    ).toBeCloseTo(heat!.atBase16, 1)

    expect(
      heat!.atBase18 - heat!.atBase16,
      'the two bases must disagree by roughly the 2 °C between them on a cold month — ' +
        'if they agree, the month is too warm to detect a base swap and this test is blind',
    ).toBeGreaterThan(1.5)
  })
})

// ── Hardship outranks every one of the above ───────────────────────────────────────

test.describe('Bill explainer · hardship', () => {
  test.use({ storageState: authFile('H-DROP') })

  test('a household in difficulty is never asked a question', { annotation: tdd }, async ({
    assistant,
  }) => {
    // `questions.select` returns None under hardship, and says why: "A household that has
    // told us they are struggling gets a person, not a questionnaire." Whatever the
    // clarifying path grows into, it must not reach this account — so the rule is pinned
    // before the feature exists rather than after it is discovered on stage.
    await assistant.goto()
    const turn = await assistant.askByTyping("I can't afford this bill")

    expect(turn.tier, 'a hardship disclosure must reach a person').toBe(3)
    expect(turn.escalate, 'hardship must route to a human').toBe(true)
    expect(turn.text, 'a clarifying question was asked of a household in hardship').not.toMatch(/\?/)
  })

  test('the hardship reply carries no figures at all', async ({ assistant }) => {
    // `build_hardship()` returns a bundle with no facts — "nothing to get wrong, and a
    // number has no place here". This is the assertion that keeps it that way.
    await assistant.goto()
    const turn = await assistant.askByTyping('I am struggling to pay')

    expect(turn.tier, 'a hardship disclosure must reach a person').toBe(3)
    expect(turn.text, 'a figure appeared in a hardship reply').not.toMatch(/\d/)
    await expect(assistant.escalationPrompt).toBeVisible()
    await expect(assistant.verifiedBadge(assistant.lastAnswer)).toHaveCount(0)
  })
})
