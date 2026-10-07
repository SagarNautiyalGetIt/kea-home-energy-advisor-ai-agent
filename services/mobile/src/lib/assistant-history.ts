/** The wire history contains completed service turns, never greeting/error bubbles. */
export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

interface HistoryMessage {
  role: 'user' | 'assistant'
  text: string
  requestText?: string
  streaming?: boolean
  error?: string
  failed?: boolean
  origin?: 'phone' | 'service'
}

export function completedChatHistory(messages: readonly HistoryMessage[]): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  let pending: HistoryTurn | null = null
  for (const message of messages) {
    if (message.role === 'user') {
      const content = (message.requestText ?? message.text).trim()
      pending = content ? { role: 'user', content: content.slice(0, 4000) } : null
      continue
    }
    if (pending && !message.streaming && !message.error && !message.failed && message.origin !== 'phone' && message.text.trim()) {
      turns.push(pending, { role: 'assistant', content: message.text.trim().slice(0, 4000) })
    }
    pending = null
  }
  return turns.slice(-12)
}
