import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

function glb(name) {
  const bytes = readFileSync(new URL('../assets/models/' + name, import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + length).toString()), binary: bytes.subarray(28 + length) };
}
test('native asset preserves every decoded view and all model/texture metadata', async () => {
  const original = glb('tripo-home-meshopt.glb'), native = glb('tripo-home-native.glb');
  assert.equal(createHash('sha256').update(original.bytes).digest('hex'), 'cc68960a6e088183673f6ac041201fcef6677971e97a0d23257538706fc61069');
  for (const key of ['accessors','nodes','meshes','materials','textures','samplers','images','scenes','scene']) assert.deepEqual(native.json[key], original.json[key], key);
  assert.ok(!native.json.extensionsRequired.includes('EXT_meshopt_compression'));
  await MeshoptDecoder.ready;
  for (let index = 0; index < original.json.bufferViews.length; index++) {
    const source = original.json.bufferViews[index], target = native.json.bufferViews[index];
    const compressed = source.extensions?.EXT_meshopt_compression;
    let decoded;
    if (compressed) {
      decoded = Buffer.alloc(compressed.count * compressed.byteStride);
      MeshoptDecoder.decodeGltfBuffer(decoded, compressed.count, compressed.byteStride, original.binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), compressed.mode, compressed.filter);
    } else decoded = original.binary.subarray(source.byteOffset, source.byteOffset + source.byteLength);
    assert.deepEqual(native.binary.subarray(target.byteOffset, target.byteOffset + target.byteLength), decoded, 'view ' + index);
  }
});
