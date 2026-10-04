import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendAuthenticatedStream } from './assistant-auth-stream.ts';

test('native chat sends the current bearer before its request body', async () => {
  const calls = [];
  const xhr = { setRequestHeader: (...args) => calls.push(args), send: (body) => calls.push(body) };
  await sendAuthenticatedStream(xhr, 'request', async () => 'synthetic-test-session', () => false, () => assert.fail());
  assert.deepEqual(calls, [['Authorization', 'Bearer synthetic-test-session'], 'request']);
});

test('cancelling during secure token loading prevents a late request', async () => {
  let resolve;
  let cancelled = false;
  const xhr = { setRequestHeader: () => assert.fail(), send: () => assert.fail() };
  const pending = sendAuthenticatedStream(xhr, 'request', () => new Promise((done) => { resolve = done; }), () => cancelled, () => assert.fail());
  cancelled = true;
  resolve('synthetic-test-session');
  await pending;
});

test('token read failure reports one error and sends nothing', async () => {
  let errors = 0;
  const xhr = { setRequestHeader: () => assert.fail(), send: () => assert.fail() };
  await sendAuthenticatedStream(xhr, 'request', async () => { throw new Error('storage unavailable'); }, () => false, () => { errors++; });
  assert.equal(errors, 1);
});

test('public synthetic demo may send without a token; production API still owns authentication', async () => {
  const calls = [];
  const xhr = { setRequestHeader: () => assert.fail(), send: (body) => calls.push(body) };
  await sendAuthenticatedStream(xhr, 'request', async () => null, () => false, () => assert.fail());
  assert.deepEqual(calls, ['request']);
});
