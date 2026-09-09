import type { Locator, Page, Response } from '@playwright/test'
import { expect } from '@playwright/test'
import type { SourceRef } from '../api/client'

/**
 * The Sparky AI page, as the tests see it.
 *
 * ## Why this page needs a different kind of assertion from the other three
 *
 * Dashboard and Billing render figures. This page renders *prose that a language model
 * wrote around* figures, and the model is `gemma3:4b` with no seed pinned. Ask the same
 * question of the same account twice and the wording differs both times.
 *
 * So there is exactly one rule, and every locator below exists to serve it:
 *
 * > **Assert the structure of an answer, never its wording.** (CONVENTIONS.md §5)
 *
 * Concretely, a test may assert:
 *
 * - that the answer is GROUNDED — it consulted this household's data and named the
 *   lookups. An answer with no successful lookup is prose written from the system prompt
 *   with nothing behind it, and it is the one state that is not safe;
 * - that a declared gap is declared — a lookup with no data must be said, not filled;
 * - that a badge, a question, an escalation prompt or a handover is or is not present;
 * - that the hardship tier is what the message warrants;
 * - that a figure the page shows equals a figure Postgres holds.
 *
 * and may never assert:
 *
 * - that the answer contains a particular sentence, adjective or connective;
 * - that two separate generations of the same question match each other.
 *
 * ## `ask()` returns the provenance behind the answer ON SCREEN
 *
 * Comparing the rendered text against a fresh `POST /api/chat` would compare two
 * different generations. `ask()` instead captures the page's own `/api/chat/stream`
 * response and parses the `done` event out of it, so the sources a test reasons about are
 * the ones that produced the words it is looking at.
 *
 * Expected VALUES still come from a separate call, and that is still sound: the tools are
 * pure reads over the same rows every time. Only the prose is non-deterministic.
 * `api/client.ts` says the same thing at more length.
 */

/**
 * What one turn produced: the words, and what was read to produce them.
 *
 * `sources` is the page's own — captured off its `/api/chat/stream` response — so a test
 * reasons about the lookups behind the words on screen rather than an equivalent set from
 * a second call.
 *
 * `tools` is the live activity seen mid-stream, which is a different assertion from
 * `sources`: it proves the customer was shown what was happening while it happened,
 * rather than only afterwards.
 */
export interface Turn {
  text: string
  escalate: boolean
  /** Absent when the stream failed before `done` — which is itself worth asserting on. */
  sources?: SourceRef[]
  /** 1 autonomous · 2 monitored · 3 human only. Absent if the stream never completed. */
  tier?: number
  /** Tool names seen on `event: tool` while the answer was being written. */
  tools: string[]
  conversationId: number | null
}

export class AssistantPage {
  constructor(private readonly page: Page) {}

  /**
   * `/assistant`, and then wait until the page can actually take a question.
   *
   * The route agrees with neither the sidebar link ("Sparky AI") nor the heading ("AI
   * Assistant"), which is worth knowing when a locator written from a screenshot does
   * not resolve.
   *
   * The wait is not politeness. `ask()` opens with `if (!customerId) { toast; return }`,
   * and `customerId` is only set once `GET /households` resolves — so a chip clicked
   * before that lands on a toast and **fires no request at all**. A test that clicked
   * early would sit waiting for a response nothing had asked for, and time out pointing
   * at the network. The household picker renders from the same state, so its presence is
   * the page's own signal that a question will be accepted.
   */
  async goto(): Promise<void> {
    await this.page.goto('/assistant')
    await expect(this.householdPicker).toBeVisible()
  }

  // ── The start screen ─────────────────────────────────────────────────────────────

  /** The orb-and-prompts view. Replaced by the transcript once a question is asked. */
  get startScreen(): Locator {
    return this.page.locator('.assistant-start')
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'How can I help you today?' })
  }

  /** The four starter chips. Located by their container rather than by role, because the
   *  composer and the sidebar are full of buttons too. */
  get promptChips(): Locator {
    return this.page.locator('.prompt-grid button')
  }

  promptChip(text: string): Locator {
    return this.promptChips.filter({ hasText: text })
  }

  // ── Controls in the page heading ─────────────────────────────────────────────────

  /**
   * The account switcher Akash added for manual demoing.
   *
   * Worth knowing before writing anything against it: it sets React state and nothing
   * else. `loadSession()` is untouched, so the sidebar, the profile menu and every other
   * page keep showing whoever actually signed in. It is not an account switcher; it is a
   * data-source override that looks like one.
   */
  get householdPicker(): Locator {
    return this.page.locator('.household-picker select')
  }

  get newChatButton(): Locator {
    return this.page.locator('button.new-chat-action')
  }

  // ── The transcript ───────────────────────────────────────────────────────────────

  get thread(): Locator {
    return this.page.locator('.chat-thread')
  }

  get userBubbles(): Locator {
    return this.page.locator('.message-row.user .bubble')
  }

  /**
   * Assistant bubbles, excluding the "Sparky is checking your usage…" placeholder.
   *
   * The placeholder carries `.assistant-bubble` too and is a sibling of the real ones, so
   * a bare `.assistant-bubble` counts it as an answer for as long as the model is
   * generating — which is most of the test.
   */
  get assistantBubbles(): Locator {
    return this.page.locator('.message-row.assistant .bubble:not(.thinking)')
  }

  get lastAnswer(): Locator {
    return this.assistantBubbles.last()
  }

  get thinkingIndicator(): Locator {
    return this.page.locator('.bubble.thinking')
  }

  /** The provenance panel — "Answered from your own meter data", collapsed by default.
   *  Now a `<details>` rather than a `<small>`; the class is unchanged, so this locator
   *  still resolves and its presence still means the same thing: figures on screen, and
   *  a list of the lookups behind them. Scoped to one bubble by the caller. */
  verifiedBadge(bubble: Locator): Locator {
    return bubble.locator('.verified-badge')
  }

  /** The message shown when no answer could be produced. Its presence is a pass, not a
   *  failure: withholding an answer it cannot stand behind is the product working. */
  get withheldAnswers(): Locator {
    return this.page.locator('.answer-withheld')
  }

  get escalationPrompt(): Locator {
    return this.page.locator('.escalation-prompt')
  }

  get offlineBanner(): Locator {
    return this.page.locator('.assistant-offline')
  }

  // ── The composer ─────────────────────────────────────────────────────────────────

  get composer(): Locator {
    return this.page.locator('.chat-composer textarea')
  }

  get sendButton(): Locator {
    return this.page.getByRole('button', { name: 'Send message' })
  }

  get micButton(): Locator {
    return this.page.locator('button.mic-button')
  }

  editButton(index: number): Locator {
    return this.page.locator('.message-row.user').nth(index).getByRole('button', { name: 'Edit message' })
  }

  // ── Asking ───────────────────────────────────────────────────────────────────────

  /**
   * Click a starter chip and wait for the whole answer, returning its evidence.
   *
   * The wait is on the network rather than on the DOM. Waiting for the bubble to stop
   * changing would need a poll-until-stable loop, which is the `waitForTimeout` that
   * CONVENTIONS.md §3 forbids wearing a different hat; the `done` event is the app's own
   * signal that the answer is complete, and it carries the report as well.
   */
  async askByChip(prompt: string): Promise<Turn> {
    return this.capture(() => this.promptChip(prompt).click())
  }

  /** Type into the composer and send. Same question, the other input path — §4 of the
   *  requirements: both must produce the same analysis. */
  async askByTyping(question: string): Promise<Turn> {
    return this.capture(async () => {
      await this.composer.fill(question)
      await this.sendButton.click()
    })
  }

  /**
   * Reword an already-asked question and let it re-run.
   *
   * Goes through `capture` for the same reason everything else does: `waitForResponse`
   * resolves on the response HEADERS, and an SSE response sends its headers immediately
   * and then streams for several more seconds. Awaiting the wait alone returns while the
   * model is still writing, and the assertions that follow read a half-rendered
   * transcript. `capture` reads the body to completion, which is what actually means
   * "the answer is finished".
   */
  async editQuestion(index: number, replacement: string): Promise<Turn> {
    await this.editButton(index).click()
    await this.thread.locator('textarea').fill(replacement)
    return this.capture(() => this.thread.getByRole('button', { name: 'Save' }).click())
  }

  /**
   * Run `action`, then read the assistant's own stream.
   *
   * Registers the response wait BEFORE the click. Registering it after is a race the
   * short answers lose: a template fallback can complete before the listener attaches,
   * and the test then times out waiting for a response that already arrived.
   */
  private async capture(action: () => Promise<void>): Promise<Turn> {
    const pending = this.page.waitForResponse(
      (r: Response) => r.url().includes('/api/chat/stream'),
      { timeout: 120_000 },
    )
    await action()
    const response = await pending

    const body = await response.text()
    const events = parseSse(body)

    // The stream is finished when `done` has arrived, but React has one more paint to do.
    // A web-first assertion is the right wait here — it retries until the DOM catches up
    // rather than assuming it already has.
    await expect(this.thinkingIndicator).toHaveCount(0)

    const done = events.done as
      | {
          sources?: SourceRef[]
          escalate_to_human?: boolean
          conversation_id?: number | null
          tier?: number
        }
      | undefined

    return {
      text: (await this.lastAnswer.innerText()).trim(),

      escalate: Boolean(done?.escalate_to_human),
      sources: done?.sources,
      tier: done?.tier,
      tools: events.tools as string[],
      conversationId: done?.conversation_id ?? null,
    }
  }
}

/**
 * Pull the named events out of a completed SSE body.
 *
 * `POST /api/chat/stream` emits `event: token` as prose is written, `event: reset` when the
 * round it belonged to turned out to be a lookup, `event: tool` / `event: result` around
 * each lookup, and finally `event: done` — or `event: error` if no answer was produced.
 * `token` is deliberately dropped: the assembled text is read off the DOM where the
 * customer sees it, not off the wire where a rendering bug would be invisible.
 *
 * `tool` is ACCUMULATED rather than first-wins, and returned under `tools` as a list of
 * names. The sequence is the assertion — that the customer was shown each lookup as it
 * happened, which is a different claim from `sources` on the `done` event telling them
 * afterwards. Everything else keeps first-wins.
 */
function parseSse(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const tools: string[] = []
  for (const chunk of body.split('\n\n')) {
    const name = /^event:\s*(.+)$/m.exec(chunk)?.[1]?.trim()
    const data = /^data:\s*(.+)$/m.exec(chunk)?.[1]
    if (!name || !data || name === 'token') continue
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      // A malformed frame is a real defect, but it is the caller's assertion to make —
      // swallowing it here keeps one bad frame from hiding the events around it.
      continue
    }
    if (name === 'tool') {
      tools.push((payload as { name: string }).name)
      continue
    }
    if (!(name in out)) out[name] = payload
  }
  out.tools = tools
  return out
}
