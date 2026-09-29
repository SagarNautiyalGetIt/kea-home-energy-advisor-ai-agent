import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canAnswerInBrowser } from './browser-sparky-policy.ts'

test('broad energy education can stay on the device', () => {
  assert.equal(canAnswerInBrowser('How does a heat pump save energy?'), true)
  assert.equal(canAnswerInBrowser('What is off-peak electricity?'), true)
})

test('account and claim-bearing questions require Kea tools', () => {
  for (const question of [
    'Why is my power bill high?',
    'How much solar energy did my home make today?',
    'Can my EV charging earn a carbon offset?',
    'What is my suburb rank and bill credit?',
    'Can I save money with solar?',
  ]) assert.equal(canAnswerInBrowser(question), false, question)
})

test('empty and oversized prompts do not run locally', () => {
  assert.equal(canAnswerInBrowser(''), false)
  assert.equal(canAnswerInBrowser('How does solar work? '.repeat(25)), false)
})
