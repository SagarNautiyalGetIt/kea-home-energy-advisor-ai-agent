import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function settingsClient() {
  let stored = { account_ref: 'H-TEST', quiet_hours_start: 21, quiet_hours_end: 8 };
  let saved;
  const backend = {
    apiPath: (path, values) => path.replace('{customer_id}', values.customer_id),
    jsonRequest: (method, body) => ({ method, body }),
    apiJson: async (_path, request) => {
      if (request) { saved = request.body; stored = saved; }
      return stored;
    },
  };
  const module = { exports: {} };
  const source = readFileSync(new URL('./settings-api.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => { assert.equal(name, '@/lib/backend-client'); return backend; },
  });
  return { ...module.exports, saved: () => saved };
}

test('supported whole-hour quiet hours survive save and reload', async () => {
  const client = settingsClient();
  const preferences = await client.loadNotificationPreferences('H-TEST');
  await client.saveNotificationPreferences('H-TEST', { ...preferences, quietHoursStart: 22, quietHoursEnd: 7 });
  const reloaded = await client.loadNotificationPreferences('H-TEST');
  assert.equal(reloaded.quietHoursStart, 22);
  assert.equal(reloaded.quietHoursEnd, 7);
});

test('legacy minute values are not sent as unsupported API fields', async () => {
  const client = settingsClient();
  const preferences = await client.loadNotificationPreferences('H-TEST');
  await client.saveNotificationPreferences('H-TEST', { ...preferences, quietHoursStartMinute: 30, quietHoursEndMinute: 15 });
  const saved = client.saved();
  assert.equal(saved.quiet_hours_start, 21);
  assert.equal(saved.quiet_hours_end, 8);
  assert.equal('quiet_hours_start_minute' in saved, false);
  assert.equal('quiet_hours_end_minute' in saved, false);
  const reloaded = await client.loadNotificationPreferences('H-TEST');
  assert.equal('quietHoursStartMinute' in reloaded, false);
  assert.equal('quietHoursEndMinute' in reloaded, false);
});

test('disabled quiet hours retain null start and end values', async () => {
  const client = settingsClient();
  const preferences = await client.loadNotificationPreferences('H-TEST');
  await client.saveNotificationPreferences('H-TEST', { ...preferences, quietHoursStart: null, quietHoursEnd: null });
  const reloaded = await client.loadNotificationPreferences('H-TEST');
  assert.equal(reloaded.quietHoursStart, null);
  assert.equal(reloaded.quietHoursEnd, null);
});
