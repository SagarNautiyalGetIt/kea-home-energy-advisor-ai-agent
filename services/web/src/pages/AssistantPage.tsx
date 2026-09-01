import { AlertTriangle, ArrowUp, Camera, FileText, Image, MessageSquare, MessageSquarePlus, Mic, Paperclip, Pencil, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal'
import {
  getHealth,
  getHouseholds,
  isSafeToDisplay,
  streamChat,
  type DoneEvent,
  type HouseholdSummary,
} from '../lib/client'
import { fromDoneEvent } from '../lib/verificationLog'
import { loadSession } from '../lib/session'
import { VoiceClient, checkVoiceSupport } from '../lib/voice'
import { SparkySparks } from '../components/sparky'

/**
 * The assistant, answering from the real pipeline.
 *
 * Every figure on this page is computed by the backend and checked by the number-checker
 * before it is streamed. Nothing here writes a number of its own — the previous version
 * of this file answered from three hardcoded paragraphs, which is the exact thing the
 * product claims not to do.
 *
 * Two rules worth not breaking:
 *
 * 1. **Never test `done.passed` on its own.** A template fallback is built directly from
 *    verified facts and cannot contain an uncomputed number, yet reports `passed: false`.
 *    `isSafeToDisplay()` is the only correct test; showing "verification failed" over a
 *    correct answer undermines the claim the product is built on.
 * 2. **Always abort.** An in-flight stream outlives the component, and a second question
 *    asked over the top of the first would interleave two answers in the same bubble.
 */

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
  report?: DoneEvent
  failed?: boolean
}

// From #69. The three hardcoded `responses` that sat beside it there are deliberately
// not carried across: they asserted "$326.40, around 29% higher than your usual range"
// as assistant output, which is both an invented figure and a comparison against billing
// history this product does not hold. The prompts below ask the same questions of the
// real pipeline instead.
const SHOW_ASSISTANT_DESCRIPTION = false

/**
 * Every one of these is verified to route to a real analytics path against the current
 * backend — a starter chip that lands on `out_of_scope` is worse than no chip. Each one
 * lands on a DIFFERENT intent, so clicking through them shows four genuinely different
 * answers rather than four rewordings of the same bundle.
 *
 * "Was that just the cold snap?" is back: it routes to weather attribution now that the
 * golden set's router fix has landed. "Which day was my highest usage?" is here because
 * it was the question that exposed the routing bug — it used to be answered with the
 * bill explainer.
 */
const PROMPTS = [
  'Why is my power bill so high?',
  'Which day was my highest usage?',
  'Was that just the cold snap?',
  'Could another plan save me money?',
]

const GREETING = 'Hello! I’m Sparky. Ask me about your bill, usage, or energy plan.'

export default function AssistantPage({ onEscalate, onToast }: { onEscalate:()=>void; onToast:(message:string,tone?:'success'|'info'|'warning')=>void }) {
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

  // Derived rather than stored. A second `useState` for the orb would need updating at
  // every one of the six places that change busy/listening/speaking, and would be wrong
  // at whichever one someone forgot.
  const sparkState = listening ? 'listening' : speaking ? 'speaking' : busy ? 'thinking' : 'idle'

  const nextId = useRef(2)
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

  const ask = useCallback(
    async (question: string, history: Message[]) => {
      if (!customerId) {
        onToast('Still connecting to your account — try again in a moment', 'warning')
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
        { id: nextId.current++, role: 'user', text: question },
        { id: answerId, role: 'assistant', text: '' },
      ])

      const patch = (fn: (m: Message) => Message) =>
        setMessages((current) => current.map((m) => (m.id === answerId ? fn(m) : m)))

      let intent = 'unknown'
      try {
        await streamChat(
          { customer_id: customerId, message: question },
          {
            onMeta: (meta) => { intent = meta.intent; setEscalating(meta.escalate) },
            onToken: (token) => patch((m) => ({ ...m, text: m.text + token.text })),
            onDone: (report) => {
              patch((m) => ({ ...m, report, failed: !isSafeToDisplay(report) }))
              // Demo line 6. Recorded for every answer, including rejected ones — a log
              // that only records successes is not evidence.
              fromDoneEvent(report, { customerId, question, intent })
            },
          },
          controller.signal,
        )
      } catch (error) {
        if (controller.signal.aborted) return
        setBackendDown(true)
        patch((m) => ({ ...m, text: '', failed: true }))
        onToast(error instanceof Error ? error.message : 'Could not reach Sparky', 'warning')
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    },
    [customerId, onToast],
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
          onMeta: (_intent, escalate) => setEscalating(escalate),
          onAnswer: (answer) => {
            setSpeaking(true)
            setMessages((current) => [
              ...current,
              {
                id: nextId.current++,
                role: 'assistant',
                text: answer.text,
                // The socket sends the verification verdict in the same shape /chat's
                // `done` event uses, so the badge logic is shared rather than copied.
                report: answer.verification as DoneEvent,
                failed: !isSafeToDisplay(answer.verification as DoneEvent),
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
        <button className="new-chat-action" onClick={newChat}><MessageSquarePlus/>New chat</button>
      </div>
    </div>

    {backendDown && (
      <div className="assistant-offline" role="alert">
        <AlertTriangle/>
        <span>
          <strong>Sparky can’t reach your usage data right now.</strong>
          <small>Answers are unavailable rather than guessed. Please try again shortly.</small>
        </span>
        <button onClick={onEscalate}>Talk to a human</button>
      </div>
    )}

    <div className="assistant-conversation">
      {started ? (
        <div className="chat-thread" aria-live="polite">
          {messages.map((item) => (
            <div className={`message-row ${item.role}`} key={item.id}>
              <div className={`bubble ${item.role === 'assistant' ? 'assistant-bubble' : 'user-bubble'} ${item.text.length > 90 ? 'long' : ''}`}>
                {editingId === item.id ? (
                  <div className="edit-message">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)}/>
                    <span>
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                      <button onClick={() => saveEdit(item.id)}>Save</button>
                    </span>
                  </div>
                ) : item.failed ? (
                  <p className="answer-withheld">
                    I couldn’t produce an answer I can stand behind for that one, so I’d rather
                    not guess. Let me put you through to someone who can help.
                  </p>
                ) : (
                  <>
                    {item.text.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
                    {/* Only when the answer actually contains figures.
                        A hardship reply carries none by design, and stamping "every
                        figure checked" on a message to someone who cannot pay their bill
                        is both meaningless and the wrong tone.
                        Testing `report.checked.length` would be wrong: the template
                        fallback is built straight from verified facts without running the
                        checker, so `checked` is empty even when the answer is full of
                        figures. The claim is about figures, so look for figures. */}
                    {item.report && !item.failed && /\d/.test(item.text) && (
                      <small className="verified-badge">
                        <ShieldCheck aria-hidden="true"/>
                        Every figure checked against your meter data
                      </small>
                    )}
                  </>
                )}
              </div>
              {item.role === 'user' && editingId !== item.id && !busy && (
                <button className="edit-chat-button" aria-label="Edit message" onClick={() => { setEditingId(item.id); setEditText(item.text) }}><Pencil/></button>
              )}
            </div>
          ))}
          {busy && messages[messages.length - 1]?.text === '' && (
            <div className="bubble assistant-bubble thinking"><SparkySparks state="thinking" size={32}/>Sparky is checking your usage…</div>
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
          It sounds like this is about affording your bill. A person is better placed to help
          than I am. <button onClick={onEscalate}>Talk to a human</button>
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
              <button onClick={() => fileInput.current?.click()}><FileText/><span><strong>Upload document</strong><small>PDF, Word, text, or CSV</small></span></button>
              <button onClick={() => photoInput.current?.click()}><Image/><span><strong>Upload photo</strong><small>JPG, PNG, or image files</small></span></button>
              <button onClick={() => { setAttachOpen(false); onToast('Camera access is not available on this device', 'info') }}><Camera/><span><strong>Take a photo</strong><small>Use your device camera</small></span></button>
            </div>
          )}
        </div>
        <input ref={fileInput} type="file" className="sr-only" accept=".pdf,.doc,.docx,.txt,.csv" onChange={() => { setAttachOpen(false); onToast('Sparky can’t read attachments yet — ask your question in words', 'info') }}/>
        <input ref={photoInput} type="file" className="sr-only" accept="image/*" onChange={() => { setAttachOpen(false); onToast('Sparky can’t read attachments yet — ask your question in words', 'info') }}/>
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
        <button
          aria-label={listening ? 'Stop listening' : 'Voice input'}
          aria-pressed={listening}
          aria-disabled={!voiceReady || busy || backendDown}
          className={`mic-button${listening ? ' listening' : ''}${voiceReady ? '' : ' unavailable'}`}
          title={voiceReady ? (listening ? 'Stop listening' : 'Ask by voice') : voiceHint}
          onClick={() => {
            if (busy || backendDown) return
            if (!voiceReady) { onToast(voiceHint, 'info'); return }
            void toggleVoice()
          }}
        ><Mic/></button>
        <button className="send-button" aria-label="Send message" disabled={busy || backendDown || !message.trim()} onClick={submit}><ArrowUp/></button>
      </div>
      <div className="chat-footer">
        Sparky can make mistakes. <button onClick={() => setTermsOpen(true)}>Check Terms &amp; Conditions</button> · <button onClick={onEscalate}>Talk to a human</button>
      </div>
    </div>

    {termsOpen && (
      <Modal title="AI Assistant terms" onClose={() => setTermsOpen(false)}>
        <p>Sparky explains your account using figures calculated from your own meter data. Every number in an answer is checked against those calculations before you see it.</p>
        <p>Sparky does not identify individual appliances from half-hourly meter data, and estimated costs use an illustrative rate.</p>
      </Modal>
    )}
  </div>
}
