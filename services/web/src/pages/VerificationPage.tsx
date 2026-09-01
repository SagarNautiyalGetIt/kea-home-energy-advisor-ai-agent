import { CircleCheck, CircleSlash, FileClock, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  clearVerificationLog,
  getVerificationLog,
  subscribeToVerificationLog,
  tally,
  type VerificationTally,
} from '../lib/verificationLog'

/**
 * Why this is not one sentence with a number substituted in.
 *
 * With no model running, every answer is a template built straight from computed facts,
 * so nothing goes through the number-checker and `checked` is empty. The naive line then
 * reads "0 numeric tokens traced back to a computed fact" directly underneath "0
 * fabricated figures" — which sounds like a failure, or like the checker never ran.
 *
 * That is not a hypothetical: it is what the screen shows if Ollama dies mid-demo. Both
 * states are genuinely safe and they deserve different words.
 */
function cleanSummary({ answers, figuresChecked, templateAnswers }: VerificationTally): string {
  const allTemplate = answers > 0 && templateAnswers === answers
  if (allTemplate) {
    return 'Every answer was assembled directly from computed facts, bypassing the model — so there were no model-written figures that could have been invented.'
  }
  const checked = `${figuresChecked} numeric ${figuresChecked === 1 ? 'token' : 'tokens'} traced back to a computed fact`
  if (templateAnswers > 0) {
    return `${checked}. The other ${templateAnswers} ${templateAnswers === 1 ? 'answer was' : 'answers were'} assembled directly from computed facts, bypassing the model.`
  }
  return `${checked}. Every figure shown came from this household's own meter data.`
}

/**
 * Demo line 6 — the operator's evidence view.
 *
 * The pitch claim is "N answers, 0 fabricated figures". The golden set proves it in CI
 * against fixed cases; this proves it live against whatever the judge just typed.
 *
 * Design rule for this page: it must be able to report **bad** news. A dashboard that can
 * only ever show a green tick is decoration, and a judge who suspects that will not
 * believe the green tick either. If a figure is ever rejected it turns red, names the
 * token, and says the claim no longer holds.
 */
export default function VerificationPage() {
  const [, force] = useState(0)
  useEffect(() => subscribeToVerificationLog(() => force((n) => n + 1)), [])

  const log = getVerificationLog()
  const totals = tally(log)
  const clean = totals.fabricated === 0

  return <div className="verification-page">
    <div className="page-heading">
      <h1>Verification log</h1>
      <p>Every answer given in this session, and what was checked before you saw it.</p>
    </div>

    <section className={`verification-headline ${clean ? 'clean' : 'breached'}`}>
      {clean ? <ShieldCheck aria-hidden="true"/> : <TriangleAlert aria-hidden="true"/>}
      <div>
        <strong>
          {totals.answers} {totals.answers === 1 ? 'answer' : 'answers'}, {totals.fabricated} fabricated{' '}
          {totals.fabricated === 1 ? 'figure' : 'figures'}
        </strong>
        <small>{clean ? cleanSummary(totals) : 'A figure reached the answer without a matching computed fact. The guarantee does not hold for this session.'}</small>
      </div>
      {log.length > 0 && (
        <button onClick={clearVerificationLog} title="Clear the log">
          <Trash2 aria-hidden="true"/>Reset
        </button>
      )}
    </section>

    {log.length === 0 ? (
      <div className="verification-empty">
        <FileClock aria-hidden="true"/>
        <p>No answers yet this session. Ask the assistant something and it appears here.</p>
      </div>
    ) : (
      <div className="verification-list">
        {[...log].reverse().map((r) => (
          <article key={r.id} className={`verification-row ${r.unverified.length ? 'rejected' : ''}`}>
            <header>
              <span className="verification-intent">{r.intent}</span>
              <span className="verification-household">{r.customerId}</span>
              <time dateTime={r.at.toISOString()}>{r.at.toLocaleTimeString()}</time>
            </header>
            <p className="verification-question">“{r.question}”</p>

            {r.unverified.length > 0 ? (
              <p className="verification-verdict bad">
                <CircleSlash aria-hidden="true"/>
                Rejected: {r.unverified.join(', ')} — no matching computed fact
              </p>
            ) : r.fellBackToTemplate ? (
              <p className="verification-verdict">
                <CircleCheck aria-hidden="true"/>
                Built directly from computed facts — no model-written figures to check
              </p>
            ) : (
              <p className="verification-verdict">
                <CircleCheck aria-hidden="true"/>
                {r.checked.length} {r.checked.length === 1 ? 'figure' : 'figures'} checked against
                this household&rsquo;s data
              </p>
            )}

            {r.checked.length > 0 && (
              <ul className="verification-tokens">
                {r.checked.map((token, i) => (
                  <li key={i} className={r.unverified.includes(token) ? 'bad' : ''}>{token}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    )}

    <p className="verification-footnote">
      Two things are checked separately. <strong>Passed</strong> means the model&rsquo;s draft
      survived the number-checker. <strong>Built directly from computed facts</strong> means the
      model was bypassed entirely — the text is assembled from the same figures, so there is
      nothing for it to invent. Both are safe to show; only a rejection is not.
    </p>
  </div>
}
