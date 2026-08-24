import { AlertTriangle, ArrowUp, LoaderCircle, Mic, Paperclip, Pencil, Plus, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal'
import {
  getHouseholds,
  isSafeToDisplay,
  streamChat,
  type DoneEvent,
  type HouseholdSummary,
} from '../lib/client'

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

/**
 * Every one of these is verified to route to a real analytics path against the current
 * backend — a starter chip that lands on `out_of_scope` is worse than no chip.
 *
 * Deliberately NOT here: "Was that just the cold snap?". It is demo line 2, but on `main`
 * today it routes to `out_of_scope` — the router has no weather phrasing. Fixed in the
 * golden-set PR; add it back here once that lands.
 */
const PROMPTS = [
  'Why is my power bill so high?',
  'My usage has gone up',
  'Could another plan save me money?',
]

const GREETING = 'Hello! I’m Kea. Ask me about your bill, usage, or energy plan.'

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

  const nextId = useRef(2)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    getHouseholds()
      .then((hs) => {
        setHouseholds(hs)
        if (hs[0]) setCustomerId(hs[0].customer_id)
      })
      .catch(() => setBackendDown(true))
  }, [])

  // An in-flight stream outlives this component unless it is cancelled.
  useEffect(() => () => abortRef.current?.abort(), [])

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

      try {
        await streamChat(
          { customer_id: customerId, message: question },
          {
            onMeta: (meta) => setEscalating(meta.escalate),
            onToken: (token) => patch((m) => ({ ...m, text: m.text + token.text })),
            onDone: (report) =>
              patch((m) => ({ ...m, report, failed: !isSafeToDisplay(report) })),
          },
          controller.signal,
        )
      } catch (error) {
        if (controller.signal.aborted) return
        setBackendDown(true)
        patch((m) => ({ ...m, text: '', failed: true }))
        onToast(error instanceof Error ? error.message : 'Could not reach Kea', 'warning')
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    },
    [customerId, onToast],
  )

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
      <div><h1>AI Assistant</h1><p>Ask questions about your energy account.</p></div>
      <div className="assistant-controls">
        {households.length > 1 && (
          <label className="household-picker">
            <span className="sr-only">Household</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={busy}>
              {households.map((h) => <option key={h.customer_id} value={h.customer_id}>{h.label}</option>)}
            </select>
          </label>
        )}
        <button className="new-chat-action" onClick={newChat}><Plus/>New chat</button>
      </div>
    </div>

    {backendDown && (
      <div className="assistant-offline" role="alert">
        <AlertTriangle/>
        <span>
          <strong>Kea can’t reach your usage data right now.</strong>
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
            <div className="bubble assistant-bubble thinking"><LoaderCircle/>Kea is checking your usage…</div>
          )}
        </div>
      ) : (
        <div className="assistant-start">
          <div className="assistant-orb"><Sparkles/></div>
          <h2>How can I help you today?</h2>
          <p>Get clear answers about bills, usage patterns, and plans.</p>
          <div className="prompt-grid">
            {PROMPTS.map((prompt) => (
              <button key={prompt} disabled={busy || backendDown} onClick={() => void ask(prompt, messages)}>
                <Search/><span>{prompt}</span>
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
        <div className="attachment-control">
          <button aria-label="Add attachment" onClick={() => onToast('Attachments aren’t supported yet', 'info')}><Paperclip/></button>
        </div>
        <textarea
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder={backendDown ? 'Unavailable while Kea is offline' : 'Message Kea'}
          disabled={backendDown}
        />
        <button aria-label="Voice input" onClick={() => onToast('Voice input isn’t available yet', 'info')}><Mic/></button>
        <button className="send-button" aria-label="Send message" disabled={busy || backendDown || !message.trim()} onClick={submit}><ArrowUp/></button>
      </div>
      <div className="chat-footer">
        Kea can make mistakes. <button onClick={() => setTermsOpen(true)}>Check Terms &amp; Conditions</button> · <button onClick={onEscalate}>Talk to a human</button>
      </div>
    </div>

    {termsOpen && (
      <Modal title="AI Assistant terms" onClose={() => setTermsOpen(false)}>
        <p>Kea explains your account using figures calculated from your own meter data. Every number in an answer is checked against those calculations before you see it.</p>
        <p>Kea does not identify individual appliances from half-hourly meter data, and estimated costs use an illustrative rate.</p>
      </Modal>
    )}
  </div>
}
