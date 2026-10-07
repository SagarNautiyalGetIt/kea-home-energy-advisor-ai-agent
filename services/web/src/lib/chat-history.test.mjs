import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completedChatHistory as webHistory } from './chat-history.ts'
import { completedChatHistory as mobileHistory } from '../../../mobile/src/lib/assistant-history.ts'

for (const [platform, history] of [['website', webHistory], ['mobile', mobileHistory]]) {
  test(`${platform}: a follow-up receives only complete successful service exchanges`, () => {
    assert.deepEqual(history([
      { role: 'assistant', text: 'Hello!' },
      { role: 'user', text: 'Why is my bill high?' },
      { role: 'assistant', text: 'Your dated usage increased.', origin: 'service' },
      { role: 'user', text: 'Failed question' },
      { role: 'assistant', text: 'Unavailable', error: 'unavailable', failed: true },
      { role: 'user', text: 'Education' },
      { role: 'assistant', text: 'Unverified local explanation', origin: 'phone' },
      { role: 'user', text: 'Still answering' },
      { role: 'assistant', text: 'Partial answer', streaming: true },
      { role: 'user', text: 'New question not answered yet' },
    ]), [
      { role: 'user', content: 'Why is my bill high?' },
      { role: 'assistant', content: 'Your dated usage increased.' },
    ])
  })

  test(`${platform}: uploads keep the sent question rather than just the displayed filename`, () => {
    assert.deepEqual(history([
      { role: 'user', text: 'Can you look at this bill?', requestText: 'Bill extraction supplied for discussion.' },
      { role: 'assistant', text: 'Please check the extracted reading.' },
    ])[0], { role: 'user', content: 'Bill extraction supplied for discussion.' })
  })

  test(`${platform}: history is bounded to the latest six complete exchanges`, () => {
    const messages = Array.from({ length: 9 }, (_, i) => [
      { role: 'user', text: `Question ${i}` },
      { role: 'assistant', text: 'x'.repeat(5000) },
    ]).flat()
    const turns = history(messages)
    assert.equal(turns.length, 12)
    assert.equal(turns[0].content, 'Question 3')
    assert.equal(turns[11].content.length, 4000)
    assert.deepEqual(history([]), [])
  })
}
