import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_MODEL, resolvePhoneModelUrl, verifiedPhoneModel } from './phone-model-config.ts';

test('AWS changes model transport without changing the pinned model identity', () => {
  assert.match(resolvePhoneModelUrl(), /huggingface.co/);
  assert.match(resolvePhoneModelUrl(), new RegExp(PHONE_MODEL.revision));
  assert.equal(resolvePhoneModelUrl(' https://model.example.test/pinned.gguf '), 'https://model.example.test/pinned.gguf');
  assert.throws(() => resolvePhoneModelUrl('http://model.example.test/file'));
  assert.throws(() => resolvePhoneModelUrl('https://password:secret@model.example.test/file'));
  assert.equal(verifiedPhoneModel(PHONE_MODEL.bytes, PHONE_MODEL.sha256), true);
  assert.equal(verifiedPhoneModel(PHONE_MODEL.bytes, '0'.repeat(64)), false);
  assert.equal(verifiedPhoneModel(PHONE_MODEL.bytes - 1, PHONE_MODEL.sha256), false);
});
