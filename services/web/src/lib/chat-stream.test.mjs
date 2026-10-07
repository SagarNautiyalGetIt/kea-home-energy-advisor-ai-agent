import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeChatStream, createChatStreamDecoder, sendChatStream } from './chat-stream.ts'

const complete = {
  sources: [{ tool: 'get_billing_records', arguments: {}, source: 'invoice rows', ok: true }],
  escalate_to_human: false,
  escalation_reason: null,
  conversation_id: 42,
  latency_ms: 150,
  tokens: 12,
  tier: 1,
  tier_reason: null,
  emotion: null,
  emotion_intensity: null,
}
const frame = (event, payload, newline = '\n') =>
  `event: ${event}${newline}data: ${JSON.stringify(payload)}${newline}${newline}`

function recording() {
  const result = { text: '', resets: 0, done: [], errors: [], tools: [], results: [], charts: [] }
  const handlers = {
    onToken: ({ text }) => { result.text += text },
    onReset: () => { result.text = ''; result.resets += 1 },
    onDone: (event) => result.done.push(event),
    onError: (event) => result.errors.push(event),
    onTool: (event) => result.tools.push(event),
    onToolResult: (event) => result.results.push(event),
    onChart: (event) => result.charts.push(event),
  }
  return { result, handlers, decoder: createChatStreamDecoder(handlers) }
}

test('CRLF frames split at every character preserve reset, evidence and handling tier', () => {
  const { decoder, result } = recording()
  const reply = { ...complete, tier: 3, escalate_to_human: true, tier_reason: 'Customer Care needed' }
  const wire = frame('token', { text: 'Let me check. ' }, '\r\n') +
    frame('reset', {}, '\r\n') +
    frame('tool', { name: 'get_billing_records', arguments: { month: '2026-07' } }, '\r\n') +
    frame('result', { name: 'get_billing_records', ok: true, source: 'invoice rows' }, '\r\n') +
    frame('token', { text: 'Here is your answer.' }, '\r\n') + frame('done', reply, '\r\n')
  for (const character of wire) decoder.push(character)
  decoder.finish()
  assert.equal(result.text, 'Here is your answer.')
  assert.equal(result.resets, 1)
  assert.deepEqual(result.done, [reply])
  assert.deepEqual(result.errors, [])
  assert.equal(result.tools[0].arguments.month, '2026-07')
  assert.equal(result.results[0].source, 'invoice rows')
})

test('EOF after streamed prose is an error, never an accepted answer', () => {
  const { decoder, result } = recording()
  decoder.push(frame('token', { text: 'A partial explanation' }))
  decoder.finish()
  assert.equal(result.done.length, 0)
  assert.match(result.errors[0].message, /did not finish/)
  assert.equal(result.errors[0].retryable, true)
})

test('invalid completed-answer fields are rejected', () => {
  for (const patch of [
    { sources: null },
    { sources: [{ tool: 'bill', ok: true, source: 'row', arguments: [] }] },
    { sources: [{ tool: 'bill', ok: 'yes', source: 'row', arguments: {} }] },
    { tier: 0 }, { tier: undefined }, { escalate_to_human: 'false' },
    { conversation_id: -1 }, { tokens: -1 }, { latency_ms: null },
    { emotion: {} }, { tier_reason: 1 },
  ]) {
    const { decoder, result } = recording()
    decoder.push(frame('done', { ...complete, ...patch }))
    decoder.finish()
    assert.equal(result.done.length, 0, JSON.stringify(patch))
    assert.equal(result.errors.length, 1, JSON.stringify(patch))
    assert.match(result.errors[0].message, /incomplete answer/)
  }
})

test('one terminal event ends callbacks and ignores any later token, reset or done', () => {
  const { decoder, result } = recording()
  decoder.push(frame('token', { text: 'Final' }) + frame('done', complete) +
    frame('reset', {}) + frame('token', { text: 'Injected later text' }) + frame('done', complete))
  decoder.push(frame('error', { message: 'Late error', retryable: false }))
  decoder.finish()
  decoder.finish()
  assert.equal(result.text, 'Final')
  assert.equal(result.resets, 0)
  assert.equal(result.done.length, 1)
  assert.deepEqual(result.errors, [])
})

test('explicit service errors terminate once with their message and retryability', () => {
  const { decoder, result } = recording()
  decoder.push(frame('error', { message: 'Provider unavailable', retryable: false }) + frame('done', complete))
  decoder.finish()
  assert.deepEqual(result.errors, [{ message: 'Provider unavailable', retryable: false }])
  assert.deepEqual(result.done, [])
})

test('malformed JSON and invalid token/chart payloads cannot corrupt a later valid answer', () => {
  const { decoder, result } = recording()
  decoder.push('event: token\ndata: {bad}\n\n' + frame('token', { text: 123 }) +
    frame('chart', { kind: 'bar', title: 'Invalid', unit: 'nzd', points: [] }) +
    frame('token', { text: 'Verified response' }) + frame('done', complete))
  decoder.finish()
  assert.equal(result.text, 'Verified response')
  assert.deepEqual(result.charts, [])
  assert.equal(result.done.length, 1)
  assert.deepEqual(result.errors, [])
})

test('server-selected chart values and provenance survive without invented defaults', () => {
  const { decoder, result } = recording()
  const chart = {
    kind: 'line', title: 'Daily use', unit: 'kwh',
    points: [{ label: 'Jul 1', value: 4.2, highlight: true }],
    caveat: 'Recorded meter values', source: 'daily readings',
  }
  decoder.push(frame('chart', chart) + frame('done', complete))
  decoder.finish()
  assert.deepEqual(result.charts, [chart])
})

test('a complete final done without a blank separator is accepted like native XHR', () => {
  const { decoder, result } = recording()
  decoder.push(frame('done', complete).trimEnd())
  decoder.finish()
  assert.deepEqual(result.done, [complete])
  assert.deepEqual(result.errors, [])
})

test('UTF-8 byte chunk boundaries retain accented and emoji text', async () => {
  const { handlers, result } = recording()
  const bytes = new TextEncoder().encode(frame('token', { text: 'Kia ora — 🌿' }) + frame('done', complete))
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  await consumeChatStream(body, handlers)
  assert.equal(result.text, 'Kia ora — 🌿')
  assert.equal(result.done.length, 1)
})

test('the browser request preserves account, conversation, message, history, bearer and abort signal', async () => {
  const { handlers, result } = recording()
  const request = {
    customer_id: 'july', message: 'How can I reduce my bill?', conversation_id: 42,
    history: [{ role: 'user', content: 'Why is my power bill high?' }, { role: 'assistant', content: 'Your previous answer' }],
  }
  const abort = new AbortController()
  await sendChatStream(request, handlers, 'test-session-token', abort.signal, async (url, options) => {
    assert.equal(url, '/api/chat/stream')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer test-session-token')
    assert.equal(options.headers.Accept, 'text/event-stream')
    assert.equal(options.signal, abort.signal)
    assert.deepEqual(JSON.parse(options.body), request)
    return new Response(frame('done', complete))
  })
  assert.equal(result.done.length, 1)
})

test('HTTP failures identify unavailable household and unauthorized session separately', async () => {
  for (const [status, message] of [[404, /household data is unavailable/], [401, /sign in again/], [403, /sign in again/], [503, /unavailable right now/]]) {
    await assert.rejects(sendChatStream({ customer_id: 'july', message: 'Bill?' }, {}, undefined, undefined,
      async () => new Response(null, { status })), message)
  }
})

test('network failures are readable and user cancellation retains its original abort error', async () => {
  const offline = async () => { throw new TypeError('network failure') }
  await assert.rejects(sendChatStream({ customer_id: 'july', message: 'Bill?' }, {}, undefined, undefined, offline), /check your connection/)
  const abort = new AbortController()
  abort.abort()
  const aborted = new DOMException('Cancelled', 'AbortError')
  await assert.rejects(sendChatStream({ customer_id: 'july', message: 'Bill?' }, {}, undefined, abort.signal,
    async () => { throw aborted }), (error) => error === aborted)
})
