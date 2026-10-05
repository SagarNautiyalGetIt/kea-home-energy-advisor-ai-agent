import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceClient } from '../src/lib/voice.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const sockets = [], workers = [], nodes = [];
  let stopped = 0;
  globalThis.window = { location: { protocol: 'http:', host: 'localhost:8080' }, isSecureContext: true };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) },
  } });
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
    message(value) { this.onmessage({ data: JSON.stringify(value) }); }
  };
  globalThis.Worker = class {
    terminated = false;
    requests = [];
    constructor() { workers.push(this); }
    postMessage(value) {
      this.requests.push(value);
      if (!value.audio) queueMicrotask(() => this.onmessage({ data: { id: value.id, type: 'ready' } }));
    }
    terminate() { this.terminated = true; }
    result(text) { this.onmessage({ data: { id: this.requests.at(-1).id, type: 'result', text } }); }
  };
  globalThis.AudioContext = class {
    audioWorklet = { addModule: async () => {} };
    async resume() {}
    async close() {}
    createMediaStreamSource() { return { connect() {} }; }
  };
  globalThis.AudioWorkletNode = class {
    port = { close() {} };
    constructor() { nodes.push(this); }
    disconnect() {}
  };
  return { sockets, workers, nodes, stopped: () => stopped };
}

async function ready(client, state) {
  const connecting = client.connect();
  state.sockets[0].onopen();
  state.sockets[0].message({ type: 'ready', client_transcription: true });
  await connecting;
}

test('waits for ready and sends only local transcript, never microphone bytes', async () => {
  const state = setup();
  const client = new VoiceClient('synthetic');
  let connected = false;
  const connecting = client.connect().then(() => { connected = true; });
  state.sockets[0].onopen();
  await tick();
  assert.equal(connected, false);
  state.sockets[0].message({ type: 'ready', client_transcription: true });
  await connecting;
  await client.startListening();
  state.nodes[0].port.onmessage({ data: new Int16Array([100, -100]).buffer });
  client.stopListening();
  state.workers[0].result('My test question');
  await tick();
  assert.equal(state.stopped(), 1);
  assert.deepEqual(state.sockets[0].sent.map(JSON.parse), [
    { type: 'hello', customer_id: 'synthetic' },
    { type: 'text', message: 'My test question' },
  ]);
  client.close();
});

test('cancel drops the recording and terminates local inference without sending a turn', async () => {
  const state = setup();
  const client = new VoiceClient('synthetic');
  await ready(client, state);
  await client.startListening();
  state.nodes[0].port.onmessage({ data: new Int16Array([42]).buffer });
  client.stopListening();
  client.close();
  state.workers[0].result('Must never reach the API');
  await tick();
  assert.equal(state.workers[0].terminated, true);
  assert.equal(state.sockets[0].sent.length, 1);
  assert.equal(state.stopped(), 1);
});
