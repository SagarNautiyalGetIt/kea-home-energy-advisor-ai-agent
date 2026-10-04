import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { FileLoader, LoadingManager, Texture, TextureLoader } from 'three';
import { createNativeHomeLoader, readHomeRange, HOME_READ_CHUNK } from './native-home-model-loader.ts';
import { homeRenderDpr, homeRenderSurface, HOME_MAX_RENDER_PIXELS } from './home-render-budget.ts';
import { createHomeModelResource } from './home-model-resource.ts';

function memoryFile(bytes, reads = []) {
  return { size: bytes.length, open() {
    return { offset: 0, readBytes(length) { reads.push({ offset: this.offset, length }); const data = bytes.slice(this.offset, this.offset + length); this.offset += data.length; return data; }, close() { reads.push({ closed: true }); } };
  } };
}
function fixture(x = 1) {
  const binary = Buffer.alloc(84);
  new Float32Array(binary.buffer, binary.byteOffset, 9).set([0, 0, 0, x, 0, 0, 0, 1, 0]);
  new Float32Array(binary.buffer, binary.byteOffset + 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Uint16Array(binary.buffer, binary.byteOffset + 72, 3).set([0, 1, 2]);
  const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [x, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' }],
    materials: [{ normalTexture: { index: 0 }, occlusionTexture: { index: 0 }, pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 }, baseColorFactor: [0.2, 0.8, 0.4, 1] } }],
    textures: [{ source: 0 }], images: [{ uri: 'must-not-load-unused-pbr.png' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const json = Buffer.from(JSON.stringify(doc)), jsonSize = Math.ceil(json.length / 4) * 4;
  const output = Buffer.alloc(28 + jsonSize + binary.length, 0x20);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonSize, 12); output.writeUInt32LE(0x4e4f534a, 16); json.copy(output, 20);
  output.writeUInt32LE(binary.length, 20 + jsonSize); output.writeUInt32LE(0x004e4942, 24 + jsonSize); binary.copy(output, 28 + jsonSize);
  return output;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('shared Home loads coalesce; failures settle into a usable fallback without retry loops', async () => {
  let calls = 0, finish;
  const resource = createHomeModelResource(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = resource('home'), second = resource('home');
  assert.equal(first, second); await flush(); assert.equal(calls, 1);
  const model = { scene: 'shared geometry' }; finish(model);
  assert.deepEqual(await first, { status: 'ready', model });
  assert.equal(resource('home'), first, 'subsequent mounts reuse the same model');
  let failures = 0;
  const unavailable = createHomeModelResource(() => { failures++; throw new Error('out of memory'); });
  assert.deepEqual(await unavailable('home'), { status: 'unavailable' });
  assert.deepEqual(await unavailable('home'), { status: 'unavailable' }); assert.equal(failures, 1);
});

test('native reads use bounded binary chunks and close handles on success and failure', () => {
  const data = Uint8Array.from({ length: HOME_READ_CHUNK * 3 + 9 }, (_, i) => i % 251), reads = [];
  assert.deepEqual(new Uint8Array(readHomeRange(memoryFile(data, reads), 5, data.length - 5)), data.slice(5));
  assert.equal(reads.filter(x => x.closed).length, 1);
  assert.ok(reads.filter(x => x.length).every(x => x.length <= HOME_READ_CHUNK));
  let closed = false;
  assert.throws(() => readHomeRange({ size: 10, open: () => ({ offset: 0, readBytes: () => new Uint8Array(), close: () => { closed = true; } }) }, 0, 10), /incomplete/);
  assert.equal(closed, true);
  assert.throws(() => readHomeRange(memoryFile(data), -1, 5), /invalid/);
  assert.throws(() => readHomeRange(memoryFile(data), 0, data.length + 1), /invalid/);
});

test('actual GLTF parser bypasses FileLoader and skips unused normal/PBR dependencies', async () => {
  const bytes = fixture(), original = Buffer.from(bytes), reads = [];
  const before = FileLoader.prototype.load;
  FileLoader.prototype.load = () => { throw new Error('Whole-file/base64 transport must never run'); };
  try {
    const Native = createNativeHomeLoader(async () => memoryFile(bytes, reads));
    const result = await new Native().loadAsync('https://example.test/home.glb');
    const mesh = result.scene.children[0];
    assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepEqual(Array.from(mesh.geometry.index.array), [0, 1, 2]);
    assert.equal(mesh.geometry.getAttribute('normal'), undefined);
    assert.equal(mesh.material.isMeshBasicMaterial, true);
    assert.equal(mesh.material.normalMap, undefined);
    const binStart = 28 + bytes.readUInt32LE(12);
    assert.equal(reads.some(read => read.offset === binStart + 36), false, 'normal buffer is never read');
    assert.deepEqual(bytes, original, 'the source file is never modified');
  } finally { FileLoader.prototype.load = before; }
});

test('concurrent model requests keep independent parser/file closures', async () => {
  const Native = createNativeHomeLoader(async url => memoryFile(fixture(url.endsWith('/a.glb') ? 2 : 3)));
  const loader = new Native();
  const results = await Promise.all([loader.loadAsync('https://example.test/a.glb'), loader.loadAsync('https://example.test/b.glb')]);
  assert.equal(results[0].scene.children[0].geometry.getAttribute('position').getX(1), 2);
  assert.equal(results[1].scene.children[0].geometry.getAttribute('position').getX(1), 3);
});

test('failed/corrupt model loads end manager accounting and reject before large reads', async () => {
  for (const kind of ['header', 'truncated', 'oversized', 'download']) {
    const bytes = fixture(), events = [], reads = [];
    if (kind === 'header') bytes.writeUInt32LE(0, 0);
    const manager = new LoadingManager(() => events.push('end'), undefined, () => events.push('error'));
    const Native = createNativeHomeLoader(async () => {
      if (kind === 'download') throw new Error('offline');
      const file = memoryFile(bytes, reads);
      if (kind === 'truncated') file.size -= 5;
      if (kind === 'oversized') file.size = 128 * 1024 * 1024;
      return file;
    });
    await assert.rejects(new Native(manager).loadAsync('https://example.test/broken.glb'));
    await flush(); assert.deepEqual(events, ['error', 'end']);
    assert.ok(reads.filter(x => x.length).every(x => x.length <= 20));
  }
});

test('real Home geometry/base texture is parsed from ranges with no full-file read or unused maps', async () => {
  const path = new URL('../../assets/models/tripo-home-native.glb', import.meta.url), reads = [];
  const file = { size: statSync(path).size, open() {
    const fd = openSync(path, 'r');
    return { offset: 0, readBytes(length) { reads.push({ offset: this.offset, length }); const bytes = new Uint8Array(length); const count = readSync(fd, bytes, 0, length, this.offset); this.offset += count; return bytes.subarray(0, count); }, close() { closeSync(fd); } };
  } };
  const oldSelf = globalThis.self, oldTexture = TextureLoader.prototype.load, oldFile = FileLoader.prototype.load;
  globalThis.self = globalThis;
  let textures = 0;
  TextureLoader.prototype.load = (_url, onLoad) => { const texture = new Texture(); textures++; queueMicrotask(() => onLoad(texture)); return texture; };
  FileLoader.prototype.load = () => { throw new Error('Native model must not use FileLoader'); };
  try {
    const Native = createNativeHomeLoader(async () => file);
    const result = await new Native().loadAsync('https://example.test/home.glb');
    const geometry = result.scene.children[0].geometry;
    assert.equal(geometry.index.count / 3, 1_872_276);
    assert.equal(geometry.getAttribute('position').count, 988_348);
    assert.equal(geometry.getAttribute('normal'), undefined);
    assert.equal(textures, 1, 'only the base-colour texture is loaded');
    const header = new DataView(readHomeRange(file, 0, 20)), n = header.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(readHomeRange(file, 20, n))), bin = 28 + n;
    const hash = data => createHash('sha256').update(data).digest('hex');
    for (const [name, accessorIndex] of [['position', 0], ['uv', 2], ['index', 3]]) {
      const attr = name === 'index' ? geometry.index : geometry.getAttribute(name);
      const view = doc.bufferViews[doc.accessors[accessorIndex].bufferView];
      const source = readHomeRange(file, bin + view.byteOffset, view.byteLength);
      assert.equal(hash(new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)), hash(new Uint8Array(source)), `${name} bytes preserved`);
    }
    assert.ok(reads.every(read => read.length <= HOME_READ_CHUNK));
    for (const i of [1, 2, 4]) {
      const view = doc.bufferViews[i];
      assert.equal(reads.some(read => read.offset >= bin + view.byteOffset && read.offset < bin + view.byteOffset + view.byteLength), false, `unused view ${i} never read`);
    }
    geometry.dispose(); result.scene.children[0].material.dispose();
  } finally { globalThis.self = oldSelf; TextureLoader.prototype.load = oldTexture; FileLoader.prototype.load = oldFile; }
});

test('phone/tablet/landscape/resized Home framebuffer stays within the pixel budget', () => {
  for (const [w, h, dpr] of [[320, 350, 3], [430, 460, 3], [800, 600, 2], [1200, 800, 2], [2560, 1600, 3], [600, 1000, 2], [1000, 600, 2]]) {
    const scale = homeRenderDpr(w, h, dpr);
    assert.ok(scale > 0 && scale <= Math.min(dpr, 1.5));
    assert.ok(w * h * scale * scale <= HOME_MAX_RENDER_PIXELS + 1);
    const native = homeRenderSurface(w, h, dpr, scale);
    assert.ok(Math.round(native.width * dpr) * Math.round(native.height * dpr) <= HOME_MAX_RENDER_PIXELS);
    assert.ok(Math.abs(native.width * native.scaleX - w) < 1e-9);
    assert.ok(Math.abs(native.height * native.scaleY - h) < 1e-9);
  }
  assert.equal(homeRenderDpr(320, 350, 1), 1);
  assert.equal(homeRenderDpr(0, 350, 2), 1);
  assert.equal(homeRenderDpr(NaN, 350, 2), 1);
  assert.equal(homeRenderSurface(0, 350, 2), null);
  assert.equal(homeRenderSurface(350, 350, NaN), null);
});
