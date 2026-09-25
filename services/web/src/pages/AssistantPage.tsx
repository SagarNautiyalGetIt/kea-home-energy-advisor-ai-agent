import { Link, useLocation, useNavigate } from 'react-router-dom'
import { solarPrompt, type SolarContext } from '../lib/solar'
import { AlertTriangle, ArrowUp, Camera, FileText, Image, MessageSquare, MessageSquarePlus, Mic, Paperclip, Pencil, Search, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import AnswerChart from '../components/AnswerChart'
import AnswerText from '../components/AnswerText'
import Modal from '../components/Modal'
import {
  analyseBill,
  getHealth,
  getHouseholds,
  streamChat,
  toolLabel,
  type HouseholdSummary,
  type ChartEvent,
  type SourceRef,
} from '../lib/client'
import { fromDoneEvent } from '../lib/answerLog'
import { loadSession } from '../lib/session'
import { clearThread, loadThread, saveThread } from '../lib/thread'
import { VoiceClient, checkVoiceSupport } from '../lib/voice'
import { SparkySparks } from '../components/sparky'

/**
 * The assistant.
 *
 * Every figure on this page comes from the customer's own meter data, read by the
 * assistant through the backend's tools and cited on the answer. Nothing here writes a
 * number of its own — an early version of this file answered from three hardcoded
 * paragraphs, which is the exact thing the product claims not to do.
 *
 * Three rules worth not breaking:
 *
 * 1. **Honour `reset`.** The assistant works in rounds and may write a line before
 *    deciding it needs a lookup first. `reset` says to drop that line. A client that
 *    ignores it shows "Let me check that." glued to the front of every answer.
 * 2. **Render paragraphs.** Answers are no longer capped at two to four sentences, and a
 *    bill explanation now arrives as several. Collapsing them into one block is how a
 *    good answer gets made to look like a wall of text.
 * 3. **Always abort.** An in-flight stream outlives the component, and a second question
 *    asked over the top of the first would interleave two answers in the same bubble.
 */

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** What the assistant looked up. Rendered as the transparency panel under the answer. */
  sources?: SourceRef[]
  /** Live tool activity while the answer is being written. */
  activity?: { name: string; done: boolean }[]
  /** The lookup this answer is about, drawn. Absent on most answers — see `AnswerChart`. */
  chart?: ChartEvent
  /**
   * True from the moment the answer starts until `done` or `error`.
   *
   * The chart is held back until this clears. The `chart` event arrives with the tool
   * result, which is *before* the model has written a word — so rendering it on arrival
   * put a chart on screen against an empty bubble and then shoved it down the page on
   * every token that streamed in above it. The picture is evidence for the sentence; it
   * has no reason to arrive first, and every reason not to move while the sentence is
   * still being written.
   */
  streaming?: boolean
  /**
   * A file the customer attached, shown as a chip on their own bubble.
   *
   * Separate from `text` because the two are not the same thing. What gets *sent* is
   * the extracted bill and its costing — several hundred characters of JSON the model
   * needs. What gets *shown* is "meridian-july.png". Putting the payload in `text` is
   * what made a wall of machine output appear in the thread under the customer's own
   * name, as though they had typed it.
   */
  attachment?: { name: string; kind: 'image' | 'pdf'; status: 'reading' | 'ready' | 'failed' }
  /** The service could not answer — never a fabricated stand-in. See `onError`. */
  error?: string
}

const SHOW_ASSISTANT_DESCRIPTION = false

/**
 * Starter chips.
 *
 * These were briefly rewritten during the agent work to show off different capabilities —
 * a projection, a peer comparison, an honest refusal. That was churn nobody asked for,
 * and it broke `qa/e2e/tests/assistant.spec.ts`, which covers these four by their exact
 * text. The chips are a product decision and the suite encodes the current one, so they
 * are back as they were.
 *
 * Each still lands somewhere real, which is the rule that matters: a starter chip the
 * assistant cannot answer is worse than no chip. The capabilities the rewrite wanted to
 * show — the month-end projection, the peer cohort, the hour-of-day refusal — are all
 * reachable by typing, and `get_hourly_profile` now returns real data for the mart
 * accounts rather than refusing for everyone.
 */
const PROMPTS = [
  'Why is my power bill so high?',
  'Which day was my highest usage?',
  'Was that just the cold snap?',
  'Could another plan save me money?',
]

const GREETING = 'Hello! I’m Sparky. Ask me about your bill, usage, or energy plan.'

export default function AssistantPage({ onEscalate, onToast }: { onEscalate:()=>void; onToast:(message:string,tone?:'success'|'info'|'warning')=>void }) {
  const routeLocation = useLocation()
  const navigateSolar = useNavigate()
  const incomingSolar = (routeLocation.state as { solarContext?: SolarContext } | null)?.solarContext
  const solarContext = incomingSolar?.customerId === loadSession()?.customerId ? incomingSolar : undefined
  const [households, setHouseholds] = useState<HouseholdSummary[]>([])
  const [customerId, setCustomerId] = useState('')
  const [backendDown, setBackendDown] = useState(false)

  const [messages, setMessages] = useState<Message[]>([{ id: 1, role: 'assistant', text: GREETING }])
  const [started, setStarted] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [attachOpen, setAttachOpen] = useState(false)

  // KEA-52. `voiceReady` is read from health.voice.ready, never from the feature flag:
  // `enabled` only says somebody set KEA_VOICE_ENABLED, `ready` says the binaries and
  // weights are actually on disk. Offering a mic that cannot work is worse than not
  // offering one.
  const [voiceReady, setVoiceReady] = useState(false)
  const [listening, setListening] = useState(false)
  // True while Piper is playing the answer back. Drives the `speaking` spark state —
  // without it the orb would sit on `idle` through the whole spoken reply, which is
  // the one moment Sparky is most obviously doing something.
  const [speaking, setSpeaking] = useState(false)
  // The specific reason voice is unavailable, shown on the disabled mic. Three very
  // different problems hide behind "voice doesn't work": the server has no whisper/
  // piper binaries, the flag is off, or the browser will not hand over a microphone
  // on an insecure origin. Each has a different fix, so the button names which one.
  const [voiceHint, setVoiceHint] = useState('Checking whether voice is available…')
  // Set once the customer asks why the mic is unavailable, so the reason is
  // announced to a screen reader rather than living only in a tooltip.
  const [voiceReasonShown, setVoiceReasonShown] = useState(false)

  // Derived rather than stored. A second `useState` for the orb would need updating at
  // every one of the six places that change busy/listening/speaking, and would be wrong
  // at whichever one someone forgot.
  const sparkState = listening ? 'listening' : speaking ? 'speaking' : busy ? 'thinking' : 'idle'

  const nextId = useRef(2)
  // `askAboutBill` runs long after its own render — an upload round trip — so reading
  // `messages` from its closure would append the answer to a thread that has since moved
  // on. The ref is always the current one.
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages
  // Threads the conversation server-side so a follow-up ("what about last month?") has
  // the turn before it to resolve against. Null until the first answer comes back, and
  // null forever when persistence is off — the backend treats it as optional either way.
  const conversationId = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const photoInput = useRef<HTMLInputElement | null>(null)
  const voiceRef = useRef<VoiceClient | null>(null)

  useEffect(() => {
    getHouseholds()
      .then((hs) => {
        setHouseholds(hs)
        // The signed-in customer, not hs[0]. Falling through to the first household was
        // why every one of the fourteen logins showed the same person's usage.
        const mine = loadSession()?.customerId
        const chosen = hs.find((h) => h.customer_id === mine) ?? hs[0]
        if (chosen) setCustomerId(chosen.customer_id)
      })
      .catch(() => setBackendDown(true))
  }, [])

  // Put the thread back after a page change. Navigating to Usage and back unmounted this
  // component and took the conversation with it — no warning, just the start screen
  // again and a question you asked two minutes ago gone.
  //
  // `restoredFor` guards against re-running when the customer has not actually changed,
  // which would otherwise overwrite a live thread with the last saved copy of itself
  // mid-answer.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!customerId || restoredFor.current === customerId) return
    restoredFor.current = customerId
    const saved = loadThread<Message>(customerId)
    if (!saved) return
    setMessages(saved.messages)
    setStarted(saved.started)
    conversationId.current = saved.conversationId
    // Past whatever the restored thread used, or the next message overwrites one of the
    // messages we just put back.
    nextId.current = Math.max(saved.nextId, ...saved.messages.map((m) => m.id + 1))
  }, [customerId])

  // Saved on every change rather than on unmount: a tab closed mid-thread never runs an
  // unmount handler, and a thread that survives navigation but not a refresh would be a
  // confusing half-fix.
  useEffect(() => {
    if (!customerId || restoredFor.current !== customerId) return
    saveThread<Message>({
      customerId,
      messages,
      started,
      conversationId: conversationId.current,
      nextId: nextId.current,
    })
  }, [customerId, messages, started])

  // Voice availability is a server fact plus a browser fact, and both have to hold.
  // `checkVoiceSupport` catches the secure-context trap: on http://192.168.x.x the whole
  // `navigator.mediaDevices` object is undefined, so getUserMedia dies with "cannot read
  // properties of undefined" and reads like a bug in our code rather than the browser
  // refusing an insecure origin.
  useEffect(() => {
    getHealth()
      .then((h) => {
        const support = checkVoiceSupport()
        if (!support.ok) {
          // Usually the secure-context rule: on http://192.168.x.x the whole
          // navigator.mediaDevices object is undefined, so getUserMedia dies with
          // "cannot read properties of undefined" and reads like our bug.
          setVoiceReady(false)
          setVoiceHint(support.reason)
          return
        }
        if (!h.voice?.enabled) {
          setVoiceReady(false)
          setVoiceHint('Voice is switched off on the server — set KEA_VOICE_ENABLED=1 and restart the API.')
          return
        }
        if (!h.voice?.ready) {
          // `enabled` only says somebody set the variable; `ready` says the binaries and
          // weights are actually on disk.
          const missing = [
            h.voice?.stt?.available ? null : 'speech-to-text',
            h.voice?.tts?.available ? null : 'text-to-speech',
          ].filter(Boolean).join(' and ')
          setVoiceReady(false)
          setVoiceHint(`Voice isn't installed on the server yet (${missing} missing) — run ./ml/voice/setup.sh.`)
          return
        }
        setVoiceReady(true)
        setVoiceHint('Ask by voice')
      })
      .catch(() => {
        setVoiceReady(false)
        setVoiceHint('Sparky is offline, so voice is unavailable too.')
      })
  }, [])

  // An in-flight stream outlives this component unless it is cancelled. So does an open
  // microphone — and a mic left live after navigating away is a recording indicator the
  // customer did not ask for.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      voiceRef.current?.close()
      voiceRef.current = null
    },
    [],
  )

  /**
   * A bill the customer photographed, read and then asked about.
   *
   * The extracted figures are handed to the model as the customer's own message rather
   * than rendered as a card on their own. Two reasons, and the second is the one that
   * matters: the answer reads as a reply to what they just did instead of a form that
   * appeared, and — because it is an ordinary turn in the thread — every follow-up
   * ("what about the daily charge?", "what if I use less in winter?") already works
   * through the conversation history. A card would have needed its own question box.
   *
   * The comparison arithmetic is done server-side and travels with the facts, so the
   * model is restating a saving rather than deriving one.
   */
  const askAboutBill = useCallback(
    async (file: File) => {
      setAttachOpen(false)
      if (!customerId) {
        onToast('Still connecting to your account — try again in a moment', 'warning')
        return
      }
      const kind: 'image' | 'pdf' = file.type === 'application/pdf' ? 'pdf' : 'image'

      // The chip goes up the instant the picker closes, before the upload starts.
      // Reading a bill takes about ten seconds, and previously that was ten seconds of
      // nothing at all — the file dialog shut and the page looked as though the click
      // had missed.
      const history = messagesRef.current
      const pendingId = nextId.current++
      setStarted(true)
      setBusy(true)
      setMessages([
        ...history,
        {
          id: pendingId,
          role: 'user',
          text: '',
          attachment: { name: file.name, kind, status: 'reading' },
        },
      ])

      const fail = (message: string) => {
        setMessages((current) =>
          current.map((m) =>
            m.id === pendingId
              ? { ...m, attachment: { name: file.name, kind, status: 'failed' } }
              : m,
          ),
        )
        onToast(message, 'warning')
      }

      try {
        const { reading, comparison } = await analyseBill(file, customerId)
        if (!reading.is_electricity_bill) {
          fail('That does not look like an electricity bill')
          return
        }
        const who = reading.retailer ? `my ${reading.retailer} bill` : 'my power bill'
        // Sent: the figures. Shown: the file they picked. See `Message.attachment`.
        await ask(
          `I've uploaded ${who}. Here is what was read off the page and how it prices ` +
            `against Kea — explain it to me plainly, and tell me honestly whether I ` +
            `would be better off switching.\n\n` +
            `BILL AS READ (from a photo, so check these with me if anything looks off):\n` +
            JSON.stringify(reading) +
            `\n\nPRICED AGAINST KEA (arithmetic, not a guess):\n` +
            JSON.stringify(comparison),
          history,
          {
            text: reading.retailer ? `Can you look at this ${reading.retailer} bill?` : 'Can you look at this bill?',
            attachment: { name: file.name, kind, status: 'ready' },
          },
        )
      } catch (error) {
        // The server's message, verbatim — every one of these is written to be read by
        // the customer and says what they can do about it.
        fail((error as Error).message)
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customerId, onToast],
  )

  const ask = useCallback(
    async (
      question: string,
      history: Message[],
      /**
       * What the customer's own bubble shows, when that differs from what is sent.
       *
       * Only the bill upload uses it: the model needs the extracted figures, the
       * customer needs to see the file they picked. Everything typed passes neither and
       * shows exactly what was typed.
       */
      shown?: { text: string; attachment?: Message['attachment'] },
    ) => {
      if (!customerId) {
        onToast('Still connecting to your account — try again in a moment', 'warning')
        return
      }

      if (solarContext && /what.?if|recalculat|instead|change|increase|decrease|[0-9]/i.test(question)) {
        setStarted(true)
        setMessages([...history, { id: nextId.current++, role: 'user', text: question }, { id: nextId.current++, role: 'assistant', text: 'To compare different solar inputs, return to Explore solar savings, adjust your assumptions and select Calculate solar savings. This chat cannot recalculate solar figures.' }])
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const answerId = nextId.current++
      setStarted(true)
      setBusy(true)
      setEscalating(false)
      setMessages([
        ...history,
        {
          id: nextId.current++,
          role: 'user',
          text: shown?.text ?? question,
          attachment: shown?.attachment,
        },
        { id: answerId, role: 'assistant', text: '', streaming: true },
      ])

      const patch = (fn: (m: Message) => Message) =>
        setMessages((current) => current.map((m) => (m.id === answerId ? fn(m) : m)))

      try {
        await streamChat(
          { customer_id: customerId, message: solarContext ? solarPrompt(solarContext) + '\nCustomer question: ' + question : question, conversation_id: solarContext ? null : conversationId.current },
          {
            onToken: (token) => patch((m) => ({ ...m, text: m.text + token.text })),
            // The round that produced this text turned out to be a lookup, so the text
            // was a preamble rather than the answer. Dropping it is the whole reason the
            // stream can start before the assistant has decided what to fetch.
            onReset: () => patch((m) => ({ ...m, text: '' })),
            onTool: (tool) =>
              patch((m) => ({
                ...m,
                activity: [...(m.activity ?? []), { name: tool.name, done: false }],
              })),
            onToolResult: (result) =>
              patch((m) => ({
                ...m,
                activity: (m.activity ?? []).map((a) =>
                  a.name === result.name && !a.done ? { ...a, done: true } : a,
                ),
              })),
            // The server sends at most one, so this never overwrites a better chart with
            // a worse one — but keep the first anyway rather than trusting that here.
            onChart: (chart) => patch((m) => (m.chart ? m : { ...m, chart })),
            onDone: (done) => {
              conversationId.current = done.conversation_id
              setEscalating(done.escalate_to_human)
              patch((m) => ({ ...m, sources: done.sources, activity: undefined, streaming: false }))
              // Demo line 6. Recorded for every answer, including unsourced ones — a log
              // that only records successes is not evidence.
              fromDoneEvent(done, { customerId, question })
            },
            // The service could not answer. It says so; it does not substitute a
            // plausible paragraph, and neither does this.
            onError: (failure) => {
              patch((m) => ({
                ...m,
                text: '',
                activity: undefined,
                error: failure.message,
                streaming: false,
              }))
              onToast(failure.message, 'warning')
            },
          },
          controller.signal,
        )
      } catch (error) {
        if (controller.signal.aborted) return
        setBackendDown(true)
        patch((m) => ({
          ...m,
          text: '',
          activity: undefined,
          error: 'Sparky can’t reach your usage data right now.',
        }))
        onToast(error instanceof Error ? error.message : 'Could not reach Sparky', 'warning')
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    },
    [customerId, onToast, solarContext],
  )

  /**
   * Push-to-talk. One button, two states, and the socket is opened lazily on first use
   * rather than on mount — a WebSocket held open for a page the customer never speaks
   * on is a microphone permission prompt they never asked for.
   *
   * Voice runs the *identical* pipeline (ADR-0003): the transcript and the answer come
   * back over the socket having gone through layers 0-3 exactly as a typed question
   * does. So both are appended to the same transcript, with the same verification
   * badge, and there is no voice-only rendering path that could show an unchecked
   * figure.
   */
  const toggleVoice = useCallback(async () => {
    if (!customerId) {
      onToast('Still connecting to your account — try again in a moment', 'warning')
      return
    }

    if (listening) {
      voiceRef.current?.stopListening()
      setListening(false)
      return
    }

    const support = checkVoiceSupport()
    if (!support.ok) {
      // The specific reason, not "voice failed" — on a LAN IP this is the secure-context
      // rule, and that is a fixable operator problem rather than a bug in the app.
      onToast(support.reason, 'warning')
      return
    }

    try {
      if (!voiceRef.current) {
        voiceRef.current = new VoiceClient(customerId, {
          onTranscript: (text) => {
            setStarted(true)
            setMessages((current) => [...current, { id: nextId.current++, role: 'user', text }])
          },
          onMeta: (escalate) => setEscalating(escalate),
          onAnswer: (answer) => {
            setSpeaking(true)
            setMessages((current) => [
              ...current,
              {
                id: nextId.current++,
                role: 'assistant',
                text: answer.text,
                // The socket sends `sources` in the same shape /chat's `done` event
                // uses, so the transparency panel is shared rather than copied. Voice
                // runs the identical agent (ADR-0003), so a spoken answer cites exactly
                // what a typed one would.
                sources: answer.sources,
              },
            ])
            if (answer.escalate_to_human) setEscalating(true)
          },
          onDone: () => setSpeaking(false),
          onError: (msg, fatal) => {
            setSpeaking(false)
            onToast(msg, 'warning')
            if (fatal) {
              voiceRef.current?.close()
              voiceRef.current = null
              setListening(false)
            }
          },
          onClose: (reason, retryable) => {
            // The client is dropped either way: a dead socket cannot be reused, and
            // keeping the reference means the next mic press silently does nothing.
            voiceRef.current = null
            setListening(false)
            setSpeaking(false)
            // A deliberate close needs no announcement. A dropped one does, and the
            // message now says what to do rather than printing a numeric close code.
            if (reason && reason !== 'voice ended') {
              onToast(reason, retryable ? 'warning' : 'info')
            }
          },
        })
        await voiceRef.current.connect()
      }

      await voiceRef.current.startListening()
      setListening(true)
    } catch (error) {
      voiceRef.current?.close()
      voiceRef.current = null
      setListening(false)
      onToast(error instanceof Error ? error.message : 'Could not start voice', 'warning')
    }
  }, [customerId, listening, onToast])

  const submit = () => {
    const value = message.trim()
    if (!value || busy) return
    setMessage('')
    void ask(value, messages)
  }

  const newChat = () => {
    abortRef.current?.abort()
    clearThread()
    conversationId.current = null
    setMessages([{ id: nextId.current++, role: 'assistant', text: GREETING }])
    setStarted(false)
    setMessage('')
    setEditingId(null)
    setBusy(false)
    setEscalating(false)
    onToast('New chat started', 'info')
  }

  const saveEdit = (id: number) => {
    const value = editText.trim()
    if (!value) return
    // Re-asking is the only sensible meaning of editing a question: everything after it
    // was an answer to the old wording.
    const upto = messages.slice(0, messages.findIndex((m) => m.id === id))
    setEditingId(null)
    void ask(value, upto)
  }

  return <div className="assistant-page">
    {solarContext && <section className="card solar-advisor"><h2>Your solar calculation</h2><p>Based on assumed solar self-use. {solarContext.result.display.netBenefit} annual net savings after maintenance and replacement allowance · {solarContext.result.display.payback} simple payback.</p><p>Kea can explain this scenario. For numerical what-if questions, <Link to="/solar">adjust the calculator and recalculate</Link>.</p><button className="primary-action" disabled={busy || !customerId} onClick={() => void ask('Explain these solar results and their limitations without calculating new figures.', messagesRef.current)}>Explain my solar results</button><button className="solar-text-button" onClick={() => navigateSolar('/assistant', { replace: true, state: null })}>Leave solar discussion</button></section>}

    <div className="page-heading assistant-heading">
      <div>
        <h1>AI Assistant</h1>
        {SHOW_ASSISTANT_DESCRIPTION && <p>Your personalised guide to electricity usage, bills and plans.</p>}
      </div>
      <div className="assistant-controls">
        {households.length > 1 && (
          <label className="household-picker">
            <span className="sr-only">Household</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={busy}>
              {households.map((h) => <option key={h.customer_id} value={h.customer_id}>{h.label}</option>)}
            </select>
          </label>
        )}
        {/* KEA-141 §7. Was rendered unconditionally, so it sat on the start screen
            offering to leave a chat that had not begun — a control that does nothing is
            worse than one that is absent, because people click it and learn the UI lies. */}
        {started && (
          <button className="new-chat-action" onClick={newChat}><MessageSquarePlus/>New chat</button>
        )}
      </div>
    </div>

    {backendDown && (
      <div className="assistant-offline" role="alert">
        <AlertTriangle/>
        <span>
          <strong>Sparky can’t reach your usage data right now.</strong>
          <small>Answers are unavailable rather than guessed. Please try again shortly.</small>
        </span>
        <button onClick={onEscalate}>See support options</button>
      </div>
    )}

    <div className="assistant-conversation">
      {started ? (
        <div className="chat-thread" aria-live="polite">
          {messages.map((item) => (
            <div className={`message-row ${item.role}`} key={item.id}>
              <div className={`bubble ${item.role === 'assistant' ? 'assistant-bubble' : 'user-bubble'} ${item.text.length > 90 ? 'long' : ''}`}>
                {/* The file, as a chip. Above the text so the attachment reads as the
                    subject of the sentence under it, and shown while the upload is
                    still in flight so the picker closing is not the last feedback the
                    customer gets. */}
                {item.attachment && (
                  <span className={`attachment-chip ${item.attachment.status}`}>
                    {item.attachment.kind === 'pdf' ? <FileText aria-hidden="true"/> : <Image aria-hidden="true"/>}
                    <span className="attachment-name">{item.attachment.name}</span>
                    <small>
                      {item.attachment.status === 'reading'
                        ? 'Reading your bill…'
                        : item.attachment.status === 'failed'
                          ? 'Could not be read'
                          : 'Attached'}
                    </small>
                  </span>
                )}
                {editingId === item.id ? (
                  <div className="edit-message">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)}/>
                    <span>
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                      <button onClick={() => saveEdit(item.id)}>Save</button>
                    </span>
                  </div>
                ) : item.error ? (
                  /* Not a handoff, and deliberately not phrased as one. The old copy
                     here said "let me put you through to someone who can help", which
                     turned every backend hiccup into a fake escalation — and it was the
                     same sentence customers saw whenever the keyword router failed to
                     recognise a question, so a service outage and an unrecognised
                     question were indistinguishable. This says what happened. */
                  <p className="answer-withheld">{item.error}</p>
                ) : (
                  <>
                    {/* Sparky writes in markdown whether or not it was asked to, so the
                        emphasis and lists it reaches for are rendered rather than shown as
                        literal asterisks. See components/AnswerText for why this is
                        hand-written: the string is model output, and no HTML is built
                        from it. */}
                    <AnswerText text={item.text}/>

                    {/* The figures the answer is about, drawn from the same lookup that
                        produced them. Under the prose rather than above it: the sentence
                        is the answer and the chart is the evidence for it, and a chart
                        that arrives before the words reads as the point being made.

                        Held until the answer has finished streaming. The `chart` event
                        lands with the tool result, well before the model writes anything,
                        so rendering it on arrival showed a chart against an empty bubble
                        and then pushed it down the page on every token. */}
                    {item.chart && !item.streaming && <AnswerChart spec={item.chart}/>}

                    {/* Live lookup activity, replaced by the source list when done. This
                        is the product working, so it is shown rather than hidden behind a
                        spinner — "reading your daily meter data" is a more honest and more
                        reassuring wait than three bouncing dots. */}
                    {item.activity && item.activity.length > 0 && (
                      <ul className="tool-activity">
                        {item.activity.map((a, i) => (
                          <li key={i} className={a.done ? 'done' : 'running'}>
                            <Search aria-hidden="true"/>{toolLabel(a.name)}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Only when the answer actually contains figures. A handoff to a
                        person carries none by design, and stamping a provenance badge on
                        a message to someone who cannot pay their bill is both meaningless
                        and the wrong tone. */}
                    {item.sources && item.sources.some((s) => s.ok) && /\d/.test(item.text) && (
                      <details className="verified-badge answer-sources">
                        <summary>
                          <ShieldCheck aria-hidden="true"/>
                          Answered from your own meter data
                        </summary>
                        <ul>
                          {item.sources.filter((s) => s.ok).map((s, i) => (
                            <li key={i}>
                              <strong>{toolLabel(s.tool)}</strong>
                              {s.source && <span>{s.source}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
              {item.role === 'user' && editingId !== item.id && !busy && (
                <button className="edit-chat-button" aria-label="Edit message" onClick={() => { setEditingId(item.id); setEditText(item.text) }}><Pencil/></button>
              )}
            </div>
          ))}
          {/* Only until the first lookup or the first word arrives. After that the
              message bubble shows what is actually happening — which tool is running —
              and a generic "checking your usage" line underneath it would be both
              redundant and less informative than the thing it sits below. */}
          {busy
            && messages[messages.length - 1]?.text === ''
            && !messages[messages.length - 1]?.activity?.length && (
            <div className="bubble assistant-bubble thinking"><SparkySparks state="thinking" size={32}/>Sparky is reading your account…</div>
          )}
        </div>
      ) : (
        <div className="assistant-start">
          <div className="assistant-orb"><SparkySparks state={sparkState} size={168}/></div>
          <h2>How can I help you today?</h2>
          {SHOW_ASSISTANT_DESCRIPTION && <p>Get clear answers about bills, usage patterns, and plans.</p>}
          <div className="prompt-grid">
            {PROMPTS.map((prompt) => (
              <button key={prompt} disabled={busy || backendDown} onClick={() => void ask(prompt, messages)}>
                <MessageSquare/><span>{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>

    <div className="composer-area">
      {escalating && (
        <div className="escalation-prompt" role="status">
          If you need a person, use the verified support details on your electricity bill.
          This demo has not sent your chat to staff. <button onClick={onEscalate}>See support options</button>
        </div>
      )}
      <div className="chat-composer">
        {/* #69's attachment menu. The pickers open, and the handler says plainly that
            nothing is read yet — the backend has no ingest path. An upload that appeared
            to work and silently went nowhere would be worse than the honest toast. */}
        <div className="attachment-control">
          <button aria-label="Add attachment" aria-expanded={attachOpen} onClick={() => setAttachOpen((open) => !open)}>{attachOpen ? <X/> : <Paperclip/>}</button>
          {attachOpen && (
            <div className="attachment-menu">
              <button onClick={() => fileInput.current?.click()}><FileText/><span><strong>Upload a bill</strong><small>PDF or photo, from any retailer</small></span></button>
              <button onClick={() => photoInput.current?.click()}><Image/><span><strong>Upload photo</strong><small>A photo of your bill</small></span></button>
              <button onClick={() => photoInput.current?.click()}><Camera/><span><strong>Take a photo</strong><small>Use your device camera</small></span></button>
            </div>
          )}
        </div>
        <input ref={fileInput} type="file" className="sr-only" accept="application/pdf,image/*" onChange={(event) => { const f = event.target.files?.[0]; event.target.value = ''; if (f) void askAboutBill(f) }}/>
        <input ref={photoInput} type="file" className="sr-only" accept="image/*" capture="environment" onChange={(event) => { const f = event.target.files?.[0]; event.target.value = ''; if (f) void askAboutBill(f) }}/>
        <textarea
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder={backendDown ? 'Unavailable while Sparky is offline' : 'Message Sparky'}
          disabled={backendDown}
        />
        {/* Always rendered. Hiding it when the stack is missing meant the mic simply
            never appeared and looked unbuilt — and a control that vanishes is harder to
            diagnose than one that explains itself. When voice is not ready it stays
            visible, greys out, and says WHY on click: a missing binary, a browser that
            refused the mic, or an insecure origin are three different problems with
            three different fixes. `title` and aria-disabled rather than `disabled`, so
            the button still takes a click and can deliver that reason. */}
        {/* KEA-141 §8. This used `aria-disabled` so the button would still take a click
            and could explain itself — but `aria-disabled="true"` IS the disabled state
            for the ARIA contract, so screen readers and Playwright both refuse to
            operate it, and the explanation was only ever reachable via a `title`
            tooltip that touch and screen-reader users never see.

            The button is genuinely enabled instead. The reason lives in the accessible
            name and in a live region, so it is announced rather than hovered. */}
        <button
          aria-label={
            voiceReady
              ? (listening ? 'Stop listening' : 'Ask by voice')
              : `Voice input unavailable. ${voiceHint}`
          }
          aria-pressed={voiceReady ? listening : undefined}
          className={`mic-button${listening ? ' listening' : ''}${voiceReady ? '' : ' unavailable'}`}
          title={voiceReady ? (listening ? 'Stop listening' : 'Ask by voice') : voiceHint}
          onClick={() => {
            if (busy || backendDown) return
            if (!voiceReady) { setVoiceReasonShown(true); onToast(voiceHint, 'info'); return }
            void toggleVoice()
          }}
        ><Mic/></button>
        <button className="send-button" aria-label="Send message" disabled={busy || backendDown || !message.trim()} onClick={submit}><ArrowUp/></button>
      </div>
      {/* Announced, not hovered — see the mic button above. */}
      <p className="sr-only" role="status">{voiceReasonShown ? voiceHint : ''}</p>
      <div className="chat-footer">
        Sparky can make mistakes. <button onClick={() => setTermsOpen(true)}>Check Terms &amp; Conditions</button> · <button onClick={onEscalate}>See support options</button>
      </div>
    </div>

    {termsOpen && (
      <Modal title="Sparky AI terms" onClose={() => setTermsOpen(false)}>
        {/* Reworded twice. First when the assistant started reading the data itself —
            the original text promised every number was "checked against those
            calculations before you see it", which described a control that no longer
            exists. Then again to take out the remaining absolutes: what is left says
            what Sparky does and what it cannot do, and is careful not to promise an
            accuracy Kea would then have to make good on. The bill is the record; this
            is a tool for understanding it. */}
        <p>Sparky reads your own meter readings and account records to answer your questions, and lists what it looked up each time so you can see where its figures came from.</p>
        <p>Sparky can get things wrong. Costs and projections are estimates based on the information available at the time — your actual bill is what counts, and it may differ. Please don’t treat Sparky’s answers as financial advice or as a final word on your account.</p>
        <p>Sparky can’t tell which individual appliance used power, because a meter reads the whole house. Where a rate isn’t published, dollar figures are illustrative and Sparky says so.</p>
        <p>If something looks wrong, use the support page to find your provider’s verified contact details. This demo does not send your chat to a person.</p>
      </Modal>
    )}
  </div>
}
