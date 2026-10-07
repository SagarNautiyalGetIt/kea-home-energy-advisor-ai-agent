import type { ChartEvent, ChatRequest, DoneEvent, SourceRef, StreamHandlers } from './client'

export const INCOMPLETE_CHAT_MESSAGE = 'Sparky did not finish its answer. Please try again.'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function source(value: unknown): value is SourceRef {
  return record(value) && typeof value.tool === 'string' && value.tool.length > 0 &&
    typeof value.ok === 'boolean' && nullableString(value.source) &&
    (value.arguments === null || record(value.arguments))
}

function done(value: Record<string, unknown>): value is Record<string, unknown> & DoneEvent {
  return Array.isArray(value.sources) && value.sources.every(source) &&
    typeof value.escalate_to_human === 'boolean' && nullableString(value.escalation_reason) &&
    (value.conversation_id === null || (Number.isInteger(value.conversation_id) && Number(value.conversation_id) > 0)) &&
    Number.isInteger(value.latency_ms) && Number(value.latency_ms) >= 0 &&
    Number.isInteger(value.tokens) && Number(value.tokens) >= 0 &&
    (value.tier === 1 || value.tier === 2 || value.tier === 3) &&
    nullableString(value.tier_reason) && nullableString(value.emotion) && nullableString(value.emotion_intensity)
}

function chart(value: Record<string, unknown>): ChartEvent | null {
  if ((value.kind !== 'bar' && value.kind !== 'line') ||
      (value.unit !== 'nzd' && value.unit !== 'kwh') ||
      typeof value.title !== 'string' || !value.title.trim() ||
      !Array.isArray(value.points) || !value.points.length || value.points.length > 64 ||
      (value.caveat != null && typeof value.caveat !== 'string') ||
      (value.source != null && typeof value.source !== 'string')) return null
  const points: ChartEvent['points'] = []
  for (const point of value.points) {
    if (!record(point) || typeof point.label !== 'string' || !point.label.trim() ||
        typeof point.value !== 'number' || !Number.isFinite(point.value) ||
        typeof point.highlight !== 'boolean') return null
    points.push({ label: point.label, value: point.value, highlight: point.highlight })
  }
  return {
    kind: value.kind,
    title: value.title,
    unit: value.unit,
    points,
    caveat: typeof value.caveat === 'string' ? value.caveat : null,
    source: typeof value.source === 'string' ? value.source : null,
  }
}

/** Decode incremental SSE without trusting model output or an unfinished connection. */
export function createChatStreamDecoder(handlers: StreamHandlers) {
  let buffer = ''
  let terminal = false
  const fail = (message: string) => {
    terminal = true
    handlers.onError?.({ message, retryable: true })
  }
  const dispatch = (frame: string) => {
    if (terminal) return
    let event = ''
    const data: string[] = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!event || !data.length) return
    let payload: unknown
    try { payload = JSON.parse(data.join('\n')) }
    catch { return }
    if (!record(payload)) return
    switch (event) {
      case 'token':
        if (typeof payload.text === 'string') handlers.onToken?.({ text: payload.text })
        break
      case 'reset': handlers.onReset?.(); break
      case 'tool':
        if (typeof payload.name === 'string' && record(payload.arguments)) {
          handlers.onTool?.({ name: payload.name, arguments: payload.arguments })
        }
        break
      case 'result':
        if (typeof payload.name === 'string' && typeof payload.ok === 'boolean' && nullableString(payload.source)) {
          handlers.onToolResult?.({ name: payload.name, ok: payload.ok, source: payload.source })
        }
        break
      case 'chart': {
        const parsed = chart(payload)
        if (parsed) handlers.onChart?.(parsed)
        break
      }
      case 'done':
        if (done(payload)) {
          terminal = true
          handlers.onDone?.(payload)
        } else fail('Sparky returned an incomplete answer. Please try again.')
        break
      case 'error':
        terminal = true
        handlers.onError?.({
          message: typeof payload.message === 'string' && payload.message.trim()
            ? payload.message : 'Sparky could not answer right now. Please try again.',
          retryable: typeof payload.retryable === 'boolean' ? payload.retryable : true,
        })
        break
    }
  }
  const push = (text: string) => {
    if (terminal) return
    buffer += text
    const separator = /\r?\n\r?\n/g
    let start = 0
    let boundary: RegExpExecArray | null
    while (!terminal && (boundary = separator.exec(buffer)) !== null) {
      dispatch(buffer.slice(start, boundary.index))
      start = separator.lastIndex
    }
    buffer = terminal ? '' : buffer.slice(start)
  }
  return {
    push,
    finish() {
      // A complete final frame may arrive without its trailing blank line, as on native XHR.
      if (!terminal && buffer.trim()) dispatch(buffer)
      buffer = ''
      if (!terminal) fail(INCOMPLETE_CHAT_MESSAGE)
    },
    get finished() { return terminal },
  }
}

/** Decode UTF-8 across network chunks and stop reading after the first terminal event. */
export async function consumeChatStream(body: ReadableStream<Uint8Array>, handlers: StreamHandlers): Promise<void> {
  const reader = body.getReader()
  const utf8 = new TextDecoder()
  const decoder = createChatStreamDecoder(handlers)
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        decoder.push(utf8.decode())
        decoder.finish()
        return
      }
      decoder.push(utf8.decode(chunk.value, { stream: true }))
      if (decoder.finished) {
        // Closing an already completed response cannot invalidate its accepted answer.
        await reader.cancel().catch(() => undefined)
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Pure transport boundary; the client supplies its current signed-in bearer token. */
export async function sendChatStream(
  request: ChatRequest,
  handlers: StreamHandlers,
  accessToken?: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response
  try {
    response = await fetcher('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Sparky could not reach the backend. Please check your connection and try again.')
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error('Your household data is unavailable. Ask the operator to check that it has been loaded.')
    if (response.status === 401 || response.status === 403) throw new Error('Your session cannot access this account. Please sign in again.')
    throw new Error('Sparky is unavailable right now. Please try again shortly.')
  }
  if (!response.body) throw new Error('Sparky returned an empty response. Please try again.')
  try {
    await consumeChatStream(response.body, handlers)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Sparky could not reach the backend. Please check your connection and try again.')
  }
}
