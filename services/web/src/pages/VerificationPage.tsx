import { CircleCheck, CircleSlash, FileClock, ShieldCheck, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toolLabel } from '../lib/client'
import {
  clearAnswerLog,
  getAnswerLog,
  subscribeToAnswerLog,
  tally,
  type AnswerTally,
} from '../lib/answerLog'

/**
 * Demo line 6 — the operator's evidence view.
 *
 * The pitch claim is "N answers, every figure traced to a source". This proves it live
 * against whatever the judge just typed; the golden set proves the offline path in CI.
 *
 * ## Design rule: this page must be able to report bad news
 *
 * A dashboard that can only ever show a green tick is decoration, and a judge who
 * suspects that will not believe the green tick either. The failure it exists to catch
 * has changed shape along with the architecture, and the new one is subtler:
 *
 * * **Before**, the model could not see any data, so the risk was a figure it invented
 *   and the check was a token match against the bundle it was handed.
 * * **Now**, the model reads the data itself. A wrong figure is much less likely and a
 *   much harder thing to detect from the outside. What *is* detectable, and what this
 *   page watches for, is an answer that consulted **nothing** — prose written from the
 *   system prompt with no lookup behind it. That is the shape a confident, fluent,
 *   entirely unfounded answer takes, and it turns this page red.
 */
/**
 * What this page may and may not claim.
 *
 * It used to end on "Every figure shown traces to a row it named." That is a guarantee
 * about the model's output, and this page cannot make it: it can see which lookups ran
 * and what they returned, but not whether every number in the prose came from one. An
 * assistant that reads four figures and then rounds a fifth in its head would still be
 * reported as clean here.
 *
 * So the wording describes what was actually observed — these lookups ran, here is what
 * they read — and leaves the customer to check the figures against it. That is the
 * weaker claim and the true one, and it is also the one Kea can stand behind if an
 * answer is ever disputed.
 */
function cleanSummary({ answers, lookups, gaps }: AnswerTally): string {
  if (answers === 0) return ''
  const looked = `${lookups} ${lookups === 1 ? 'lookup' : 'lookups'} against your own account data`
  if (gaps > 0) {
    return `${looked}. ${gaps} of them found nothing for this account, and Sparky said so rather than filling the gap.`
  }
  return `${looked}. Each answer lists what it read, so you can check any figure against it.`
}

export default function VerificationPage() {
  const [, force] = useState(0)
  useEffect(() => subscribeToAnswerLog(() => force((n) => n + 1)), [])

  const log = getAnswerLog()
  const totals = tally(log)
  const clean = totals.unsourced === 0

  return <div className="verification-page">
    <div className="page-heading">
      <h1>Evidence log</h1>
      <p>The answers Sparky gave you in this session, and what it read before each one.</p>
    </div>

    <section className={`verification-headline ${clean ? 'clean' : 'breached'}`}>
      {clean ? <ShieldCheck aria-hidden="true"/> : <TriangleAlert aria-hidden="true"/>}
      <div>
        <strong>
          {totals.answers} {totals.answers === 1 ? 'answer' : 'answers'}, {totals.unsourced}{' '}
          {totals.unsourced === 1 ? 'answer' : 'answers'} with no source
        </strong>
        <small>
          {clean
            ? cleanSummary(totals)
            : 'Sparky answered without reading anything from your account. Please don’t rely on that answer — ask again, or talk to our team and we’ll check it for you.'}
        </small>
      </div>
      {log.length > 0 && (
        <button onClick={clearAnswerLog} title="Clear the log">
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
        {[...log].reverse().map((r) => {
          const used = r.sources.filter((s) => s.ok)
          return (
            <article key={r.id} className={`verification-row ${used.length ? '' : 'rejected'}`}>
              <header>
                <span className="verification-household">{r.customerId}</span>
                {r.escalated && (
                  <span className="verification-intent"><UserRound aria-hidden="true"/>handed to a person</span>
                )}
                <time dateTime={r.at.toISOString()}>{r.at.toLocaleTimeString()}</time>
              </header>
              <p className="verification-question">“{r.question}”</p>

              {used.length === 0 ? (
                <p className="verification-verdict bad">
                  <CircleSlash aria-hidden="true"/>
                  No data was consulted for this answer
                </p>
              ) : (
                <p className="verification-verdict">
                  <CircleCheck aria-hidden="true"/>
                  {used.length} {used.length === 1 ? 'lookup' : 'lookups'} against this
                  household&rsquo;s data{r.latencyMs ? ` · ${(r.latencyMs / 1000).toFixed(1)}s` : ''}
                </p>
              )}

              {r.sources.length > 0 && (
                <ul className="verification-tokens verification-sources">
                  {r.sources.map((s, i) => (
                    <li key={i} className={s.ok ? '' : 'bad'} title={s.source ?? undefined}>
                      {toolLabel(s.tool)}
                      {s.source && <small>{s.source}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    )}

    <p className="verification-footnote">
      Each row lists what the assistant looked up to answer that question, and the table or
      calculation each result came from. A greyed-out lookup found no data for this account —
      that is a declared gap, not a failure, and the assistant is required to say so rather
      than fill it. An answer with <strong>no</strong> lookups at all is the one state that
      is not safe: nothing backs it.
    </p>
  </div>
}
