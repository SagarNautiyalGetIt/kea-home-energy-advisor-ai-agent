import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

async function moduleFrom(source) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const policy = await moduleFrom(source('./session-policy.ts'));
const reading = await moduleFrom(source('./home-card-reading.ts'));
const camera = await moduleFrom(source('./home-camera.ts'));

async function client(platform = 'ios', transport = async () => new Response('{}')) {
  // Run the real client with only native storage/platform/network adapters replaced.
  const key = 'repair-' + Math.random();
  globalThis[key] = { data: new Map(), fetch: transport };
  let code = source('./backend-client.ts')
    .replace("import * as SecureStore from 'expo-secure-store';", `const fixture = globalThis[${JSON.stringify(key)}]; const SecureStore = { getItemAsync: async k => fixture.data.get(k) ?? null, setItemAsync: async (k,v) => { fixture.data.set(k,v); }, deleteItemAsync: async k => { fixture.data.delete(k); } }; const fetch = fixture.fetch; const sessionStorage = { getItem: k => fixture.data.get(k) ?? null, setItem: (k,v) => fixture.data.set(k,v), removeItem: k => fixture.data.delete(k) };`)
    .replace("import { Platform } from 'react-native';", `const Platform = { OS: '${platform}' };`)
    .replace("import { shouldExpireSession } from './session-policy';", policy.shouldExpireSession.toString());
  const api = await moduleFrom(code);
  return { api, data: globalThis[key].data };
}

test('authorized usage carries the signed-in token on native and web', async () => {
  for (const platform of ['ios', 'android', 'web']) {
    let authorization;
    const { api } = await client(platform, async (_, init) => { authorization = init.headers.get('Authorization'); return new Response('{}'); });
    await api.storeTokenPair('valid-household-token');
    assert.equal((await api.apiFetch('/api/households/home-a/usage-series')).status, 200);
    assert.equal(authorization, 'Bearer valid-household-token');
  }
});

test('expired/API-restart token clears storage and emits sign-in recovery once', async () => {
  const { api, data } = await client('ios', async () => new Response('{}', { status: 401 }));
  let expired = 0;
  api.onSessionExpired(() => expired++);
  await api.storeTokenPair('expired');
  assert.equal((await api.apiFetch('/api/auth/session')).status, 401);
  assert.equal(await api.loadAccessToken(), null);
  assert.equal(data.has('kea-mobile-access-token'), false);
  assert.equal(expired, 1);
  await api.apiFetch('/api/households/home-a/usage-series');
  assert.equal(expired, 1);
});

test('late old-account 401 cannot clear a newer account token', async () => {
  let finish;
  const { api } = await client('ios', () => new Promise(resolve => { finish = resolve; }));
  await api.storeTokenPair('old');
  const request = api.apiFetch('/api/households/old/usage-series');
  await new Promise(resolve => setTimeout(resolve, 0));
  await api.storeTokenPair('new');
  finish(new Response('{}', { status: 401 }));
  await request;
  assert.equal(await api.loadAccessToken(), 'new');
});

test('bad login and network failure do not erase the current session', async () => {
  const { api } = await client('ios', async path => {
    if (path.endsWith('/login')) return new Response('{}', { status: 401 });
    throw new Error('offline');
  });
  await api.storeTokenPair('valid');
  await api.apiFetch('/api/auth/login');
  await assert.rejects(api.apiFetch('/api/auth/session'), /offline/);
  assert.equal(await api.loadAccessToken(), 'valid');
  assert.equal(policy.sessionMatches({ customer_id: 'other' }, 'valid'), false);
});

test('web bearer survives a reload in tab-scoped storage', async () => {
  const { api, data } = await client('web');
  await api.storeTokenPair('web-token');
  assert.equal(data.get('kea-mobile-access-token'), 'web-token');
  await api.storeTokenPair(null);
  assert.equal(data.has('kea-mobile-access-token'), false);
});

const scene = { day: '2026-09-30', deviceDay: '2026-09-29', dateSource: 'mart', meterImportKwh: 12.5, devices: [{ deviceId: 'ev', deviceClass: 'ev_charger', label: 'EV', energyKwh: 0 }] };
test('home shows available meter imports without inventing total consumption or live power', () => {
  assert.deepEqual(reading.homeCardReading(scene, {}, 'home'), { value: '12.5 kWh', detail: 'Meter imports · 2026-09-30', available: true });
  assert.equal(reading.homeCardReading(scene, { home_load: 450 }, 'home').value, '0.45 kW');
  assert.equal(reading.homeCardReading({ ...scene, meterImportKwh: 0 }, {}, 'grid').value, '0.0 kWh');
});
test('zero measured device energy stays measured and uses its own day', () => {
  assert.deepEqual(reading.homeCardReading(scene, {}, 'car'), { value: '0.0 kWh', detail: 'Charger meter · 2026-09-29', available: true });
  assert.equal(reading.homeCardReading(scene, { ev_charger: 7200 }, 'car').value, '7.20 kW');
  assert.equal(reading.homeCardReading(scene, {}, 'solar').available, false);
  assert.equal(reading.homeCardReading(null, {}, 'solar').detail, 'Link a sensor in Settings');
});
test('interactive home bounds excessive, invalid and repeated camera movements', () => {
  assert.deepEqual(camera.constrainCamera({ x: 100, y: -100, zoom: 100 }), { x: 12, y: -9, zoom: 1.45 });
  assert.deepEqual(camera.constrainCamera({ x: NaN, y: Infinity, zoom: -Infinity }), camera.defaultCamera);
  for (let i = -100; i <= 100; i++) {
    const actual = camera.constrainCamera({ x: i, y: i, zoom: i / 10 });
    assert.ok(Math.abs(actual.x) <= 12 && Math.abs(actual.y) <= 9 && actual.zoom >= 0.9 && actual.zoom <= 1.45);
  }
});
