import assert from 'node:assert/strict';
import test from 'node:test';
import { singleFlight } from './single-flight.ts';

test('rejects a duplicate before async preflight or download can start', async () => {
  const run = singleFlight('Already downloading');
  let release;
  let starts = 0;
  const first = run(async () => {
    starts += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  await assert.rejects(run(async () => { starts += 1; return 'duplicate'; }), /Already downloading/);
  assert.equal(starts, 1);
  release('verified');
  assert.equal(await first, 'verified');
  assert.equal(await run(async () => 'next install'), 'next install');
});

test('releases the reservation after preflight, download or integrity failure', async () => {
  const run = singleFlight('Already downloading');
  await assert.rejects(run(async () => { throw new Error('Integrity failed'); }), /Integrity failed/);
  assert.equal(await run(async () => 'retry succeeds'), 'retry succeeds');
});
