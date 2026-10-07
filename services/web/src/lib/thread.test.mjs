import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveThread, loadThread, clearThread } from './thread.ts'

test('saved chat retains visible turns but never persists the upload request payload', () => {
  let saved = null
  globalThis.localStorage = {
    setItem: (_key, value) => { saved = value },
    getItem: () => saved,
    removeItem: () => { saved = null },
  }
  const messages = [{ id: 2, role: 'user', text: 'Can you look at this bill?', requestText: 'Private extraction for the active request' }]
  saveThread({ customerId: 'H-JUL', messages, started: true, conversationId: null, nextId: 3 })
  assert.equal(saved.includes('Private extraction'), false)
  assert.equal(saved.includes('requestText'), false)
  assert.equal(loadThread('H-JUL').messages[0].text, 'Can you look at this bill?')
  assert.equal(messages[0].requestText, 'Private extraction for the active request')
  assert.equal(loadThread('H-COLD'), null)
  clearThread()
  assert.equal(loadThread('H-JUL'), null)
  delete globalThis.localStorage
})
