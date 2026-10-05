import { LoaderUtils } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const HOME_READ_CHUNK = 256 * 1024;
const MAX_JSON = 1024 * 1024;
const MAX_FILE = 64 * 1024 * 1024;
const MAX_VIEW = 24 * 1024 * 1024;
export type BinaryHandle = { offset: number | null; readBytes: (length: number) => Uint8Array; close: () => void };
export type BinaryFile = { size: number; open: () => BinaryHandle };

/** Read directly into the final buffer, never a whole-model string or base64. */
export function readHomeRange(file: BinaryFile, offset: number, length: number): ArrayBuffer {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > MAX_VIEW || offset + length > file.size) {
    throw new Error('Home model has an invalid or oversized buffer range');
  }
  const output = new Uint8Array(length), handle = file.open();
  try {
    handle.offset = offset;
    let written = 0;
    while (written < length) {
      const bytes = handle.readBytes(Math.min(HOME_READ_CHUNK, length - written));
      if (!bytes.length || bytes.length > Math.min(HOME_READ_CHUNK, length - written)) throw new Error('Home model read was incomplete');
      output.set(bytes, written); written += bytes.length;
    }
    return output.buffer;
  } finally { handle.close(); }
}

/** Scoped to the prepared, embedded Home GLB; other Fiber loaders stay untouched. */
export function createNativeHomeLoader(resolveFile: (url: string) => Promise<BinaryFile>) {
  return class NativeHomeLoader extends GLTFLoader {
    override load(url: string, onLoad: (gltf: GLTF) => void, _onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
      const resolved = this.manager.resolveURL(this.path + url);
      this.manager.itemStart(resolved);
      const load = async () => {
        const file = await resolveFile(resolved);
        if (!Number.isSafeInteger(file.size) || file.size < 28 || file.size > MAX_FILE) throw new Error('Home model exceeds the native loading budget');
        const header = new DataView(readHomeRange(file, 0, 20));
        const jsonLength = header.getUint32(12, true);
        if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== file.size || header.getUint32(16, true) !== 0x4e4f534a || !jsonLength || jsonLength % 4 || jsonLength > MAX_JSON) {
          throw new Error('Home model GLB header is invalid');
        }
        const document = JSON.parse(new TextDecoder().decode(readHomeRange(file, 20, jsonLength)));
        const binHeader = new DataView(readHomeRange(file, 20 + jsonLength, 8));
        const binStart = 28 + jsonLength, binLength = binHeader.getUint32(0, true);
        if (binHeader.getUint32(4, true) !== 0x004e4942 || binStart + binLength !== file.size || document.buffers?.length !== 1 || document.buffers[0].uri || document.buffers[0].byteLength > binLength) {
          throw new Error('Home model must contain one embedded binary buffer');
        }
        if (document.extensionsRequired?.some((name: string) => name.includes('meshopt') || name.includes('draco'))) throw new Error('Home model must be decompressed before native loading');
        for (const view of document.bufferViews ?? []) {
          const offset = view.byteOffset ?? 0;
          if (view.buffer !== 0 || !Number.isSafeInteger(offset) || !Number.isSafeInteger(view.byteLength) || offset < 0 || view.byteLength < 0 || view.byteLength > MAX_VIEW || offset + view.byteLength > binLength || view.extensions?.EXT_meshopt_compression || view.extensions?.KHR_meshopt_compression) {
            throw new Error('Home model buffer view is invalid');
          }
        }
        // The displayed house is unlit. Avoid loading the two unused PBR maps
        // and normals; positions, UVs, indices and base-colour bytes stay exact.
        document.extensionsUsed = [...new Set([...(document.extensionsUsed ?? []), 'KHR_materials_unlit'])];
        for (const material of document.materials ?? []) material.extensions = { KHR_materials_unlit: {} };
        for (const mesh of document.meshes ?? []) for (const primitive of mesh.primitives) {
          delete primitive.attributes.NORMAL; delete primitive.attributes.TANGENT;
        }
        // One parser per request: concurrent loads cannot share file offsets or
        // accidentally reuse another model's buffer-view closure.
        const parserLoader = new GLTFLoader(this.manager);
        parserLoader.register(parser => ({
          name: 'KEA_native_home_ranges',
          loadBufferView: index => {
            const view = parser.json.bufferViews[index];
            return Promise.resolve().then(() => readHomeRange(file, binStart + (view.byteOffset ?? 0), view.byteLength));
          },
        }));
        return parserLoader.parseAsync(JSON.stringify(document), this.resourcePath || LoaderUtils.extractUrlBase(resolved));
      };
      void load().then(onLoad).catch(error => { onError?.(error); this.manager.itemError(resolved); }).finally(() => this.manager.itemEnd(resolved));
    }
  };
}
