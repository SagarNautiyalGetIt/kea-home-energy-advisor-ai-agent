import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAnswerWithLocalModel } from './local-sparky-policy.ts';

test('phone model accepts general energy education', () => {
  assert.equal(canAnswerWithLocalModel('How does solar electricity work?'), true);
  assert.equal(canAnswerWithLocalModel('What are ways of saving energy with insulation?'), true);
});

test('phone model declines household and financial questions without evidence', () => {
  for (const question of [
    'Why is my power bill so high?',
    'Which day was my highest usage?',
    'Could another plan save me money?',
    'How much carbon offset did our EV charging earn?',
    'What is my suburb rank?',
    'How much did solar save my household last month?',
  ]) assert.equal(canAnswerWithLocalModel(question), false, question);
});
