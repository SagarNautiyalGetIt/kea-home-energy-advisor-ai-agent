import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MeshoptDecoder } from '../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

// Lossless build-time decompression for Hermes, which has no WebAssembly runtime.
// The original meshopt GLB remains the web asset and the source of both appearances.
const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('Usage: node scripts/prepare-home-model.mjs <source.glb> <native-output.glb>');
const source = await readFile(sourcePath);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2 || source.readUInt32LE(8) !== source.length) throw new Error('Invalid GLB header');
const jsonLength = source.readUInt32LE(12);
const document = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const binaryStart = 20 + jsonLength + 8;
const binary = source.subarray(binaryStart);
await MeshoptDecoder.ready;
const chunks = [];
let offset = 0;
for (const view of document.bufferViews) {
  const compressed = view.extensions?.EXT_meshopt_compression;
  let bytes;
  if (compressed) {
    if (compressed.buffer !== 0) throw new Error('External compressed buffers are unsupported');
    bytes = new Uint8Array(compressed.count * compressed.byteStride);
    MeshoptDecoder.decodeGltfBuffer(bytes, compressed.count, compressed.byteStride,
      binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), compressed.mode, compressed.filter);
    delete view.extensions.EXT_meshopt_compression;
    if (!Object.keys(view.extensions).length) delete view.extensions;
  } else {
    if (view.buffer !== 0) throw new Error('Unexpected fallback buffer');
    bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  }
  view.buffer = 0;
  view.byteOffset = offset;
  view.byteLength = bytes.length;
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  chunks.push(padded);
  offset += padded.length;
}
document.buffers = [{ byteLength: offset }];
for (const key of ['extensionsRequired', 'extensionsUsed']) {
  document[key] = document[key]?.filter(name => name !== 'EXT_meshopt_compression');
  if (!document[key]?.length) delete document[key];
}
document.extras = { ...document.extras, keaSourceSha256: createHash('sha256').update(source).digest('hex'), keaProcessing: 'Lossless meshopt buffer decompression; texture bytes and quantized geometry retained' };
const json = Buffer.from(JSON.stringify(document));
const jsonChunk = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
jsonChunk.set(json);
const binChunk = Buffer.concat(chunks);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const output = Buffer.concat([header, jsonChunk, binHeader, binChunk]);
await writeFile(outputPath, output);
console.log(JSON.stringify({ sourceBytes: source.length, nativeBytes: output.length, nativeSha256: createHash('sha256').update(output).digest('hex'), views: chunks.length }));
