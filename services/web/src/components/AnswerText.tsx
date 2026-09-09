import { Fragment, type ReactNode } from 'react'

/**
 * Renders an assistant answer's light markdown as real formatting.
 *
 * Sparky writes in markdown whether or not anybody asked it to — the system prompt is
 * itself written in markdown, so the model mirrors the style back. Until now the chat
 * bubble split the text on blank lines and dropped each paragraph into a `<p>`, so a
 * customer read the asterisks: *"your bill is **$61 higher** than last month"*. The
 * emphasis the model reached for to make an answer scannable was making it harder to read
 * instead.
 *
 * ## Why this is hand-written and not `react-markdown`
 *
 * Two reasons, and the second is the one that matters.
 *
 * The web app has four runtime dependencies. `react-markdown` brings a remark/unified
 * tree behind it, which is a large amount of machinery for the six constructs a chat
 * answer actually uses.
 *
 * More importantly: **this text is model output, and model output is untrusted input.**
 * A general markdown renderer accepts raw HTML and link targets, so using one here would
 * put `javascript:` URLs and embedded markup one prompt-injection away from the customer's
 * browser — on the screen where the model is quoting figures from their account. Nothing
 * below produces HTML from the string. It builds React elements from matched substrings,
 * and anything unmatched stays a text node, so the worst an adversarial answer can do is
 * render as its own literal characters.
 *
 * Links are deliberately NOT supported for the same reason. Sparky has no reason to emit
 * one, and the day it does, a bare URL as text is the honest failure.
 */

/**
 * `**bold**`, `*italic*`, `_italic_`, `` `code` ``. Ordered longest-delimiter-first so `**`
 * is consumed before `*` and bold never renders as an italic wrapping an asterisk.
 *
 * The guards on the single-character delimiters are not pedantry — a naive `\*([^*]+)\*`
 * gets both of these wrong, and both are things this assistant says:
 *
 *     "2 * 3 * 4"        -> "2 <em> 3 </em> 4"          arithmetic eaten
 *     "base_load_kwh"    -> "base<em>load</em>kwh"      an identifier eaten
 *
 * So: the content may not start or end with a space (kills the first), and the delimiter
 * may not sit against a word character (kills the second). `**` needs only the space rule,
 * because a doubled asterisk does not occur inside arithmetic or an identifier.
 */
const INLINE = new RegExp(
  '(' +
    [
      /\*\*(?=\S)[^*\n]*[^\s*]\*\*/, // **bold**
      /(?<![\w*])\*(?=\S)[^*\n]*[^\s*]\*(?![\w*])/, // *italic*
      /(?<![\w_])_(?=\S)[^_\n]*[^\s_]_(?![\w_])/, // _italic_
      /`[^`\n]+`/, // `code`
    ]
      .map((r) => r.source)
      .join('|') +
    ')',
  'g',
)

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((piece) => piece !== '')
    .map((piece, i) => {
      const key = `${keyPrefix}-${i}`
      if (piece.length > 4 && piece.startsWith('**') && piece.endsWith('**')) {
        return <strong key={key}>{piece.slice(2, -2)}</strong>
      }
      if (piece.length > 2 && piece.startsWith('*') && piece.endsWith('*')) {
        return <em key={key}>{piece.slice(1, -1)}</em>
      }
      if (piece.length > 2 && piece.startsWith('_') && piece.endsWith('_')) {
        return <em key={key}>{piece.slice(1, -1)}</em>
      }
      if (piece.length > 2 && piece.startsWith('`') && piece.endsWith('`')) {
        return <code key={key}>{piece.slice(1, -1)}</code>
      }
      return <Fragment key={key}>{piece}</Fragment>
    })
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
/** `## Heading`. Rendered as a strong line rather than an `<h_>`: these appear mid-thread
 *  inside a chat bubble, where a real heading would break the page's outline for a screen
 *  reader and look like a section title in someone's conversation. */
const HEADING = /^\s*#{1,6}\s+(.*)$/

/** One blank-line-separated block, classified and rendered. */
function Block({ lines, k }: { lines: string[]; k: string }) {
  // `AnswerText` drops empty blocks, so this only satisfies the compiler — but it also
  // keeps `lines.every(...)` from calling an empty block a list.
  const first = lines[0]
  if (first === undefined) return null

  const bullets = lines.every((l) => BULLET.test(l))
  if (bullets) {
    return (
      <ul className="answer-list">
        {lines.map((line, i) => (
          <li key={i}>{inline(line.replace(BULLET, '$1'), `${k}-${i}`)}</li>
        ))}
      </ul>
    )
  }

  const numbered = lines.every((l) => NUMBERED.test(l))
  if (numbered) {
    return (
      <ol className="answer-list" start={Number(first.replace(NUMBERED, '$1')) || 1}>
        {lines.map((line, i) => (
          <li key={i}>{inline(line.replace(NUMBERED, '$2'), `${k}-${i}`)}</li>
        ))}
      </ol>
    )
  }

  if (lines.length === 1 && HEADING.test(first)) {
    return <p className="answer-heading">{inline(first.replace(HEADING, '$1'), k)}</p>
  }

  // A plain paragraph. Single newlines inside it are joined with a space rather than
  // preserved: the model wraps prose at arbitrary widths, and honouring those breaks puts
  // ragged line endings in the middle of a sentence.
  return <p>{inline(lines.join(' '), k)}</p>
}

export default function AnswerText({ text }: { text: string }) {
  // Split on blank lines, not every newline. Answers arrive as paragraphs now that they
  // are not capped at two to four sentences, and a bill explanation reads as a wall of
  // text without this.
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== ''))
    .filter((lines) => lines.length > 0)

  return (
    <>
      {blocks.map((lines, i) => (
        <Block key={i} k={`b${i}`} lines={lines} />
      ))}
    </>
  )
}
