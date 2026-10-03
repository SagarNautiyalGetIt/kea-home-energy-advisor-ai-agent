import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const config = require('../metro.config.js');
const threeModule = path.join(path.dirname(require.resolve('three')), 'three.module.js');
const root = fileURLToPath(new URL('../', import.meta.url));

test('Metro resolves app, Fiber and addon Three imports to one browser-compatible module', () => {
  for (const platform of ['ios', 'android', 'web']) {
    for (const originModulePath of ['src/components/gltf-home-scene.tsx', 'node_modules/@react-three/fiber/native/dist/react-three-fiber-native.cjs.dev.js', 'node_modules/three/examples/jsm/loaders/GLTFLoader.js']) {
      const resolved = config.resolver.resolveRequest({ originModulePath, resolveRequest() { throw new Error('Three must bypass the Node wrapper'); } }, 'three', platform);
      assert.deepEqual(resolved, { type: 'sourceFile', filePath: threeModule });
    }
  }
  const calls = [];
  const context = { resolveRequest(...args) { calls.push(args); return { type: 'sourceFile', filePath: 'default-resolution' }; } };
  assert.deepEqual(config.resolver.resolveRequest(context, 'three/examples/jsm/loaders/GLTFLoader.js', 'ios'), { type: 'sourceFile', filePath: 'default-resolution' });
  assert.deepEqual(config.resolver.resolveRequest(context, 'react', 'android'), { type: 'sourceFile', filePath: 'default-resolution' });
  assert.equal(calls.length, 2);
});

test('the resolved Three and GLTF loader initialize without Node globals or WebAssembly', () => {
  // Reproduce the reported import-time failure with React Native's process shim.
  assert.throws(() => runInNewContext(readFileSync(require.resolve('three'), 'utf8'), { process: { env: {} } }), /emitWarning/);
  // Execute the actual ESM graph in a fresh runtime, not merely inspect the path.
  const harness = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import path from 'node:path';
    import { createContext, SourceTextModule } from 'node:vm';
    const context = createContext({ console, TextEncoder, TextDecoder, setTimeout, clearTimeout, WebAssembly: undefined });
    const cache = new Map();
    function load(filename) {
      if (!cache.has(filename)) cache.set(filename, new SourceTextModule(readFileSync(filename, 'utf8'), { context, identifier: filename }));
      return cache.get(filename);
    }
    const entry = new SourceTextModule('import { Mesh, Vector3 } from "three"; import { GLTFLoader } from "./examples/jsm/loaders/GLTFLoader.js"; import { MeshoptDecoder } from "./examples/jsm/libs/meshopt_decoder.module.js"; export { Mesh, Vector3, GLTFLoader, MeshoptDecoder };', { context, identifier: path.resolve(${JSON.stringify(path.dirname(path.dirname(threeModule)))}, 'kea-runtime.mjs') });
    await entry.link((name, parent) => load(name === 'three' ? ${JSON.stringify(threeModule)} : path.resolve(path.dirname(parent.identifier), name)));
    await entry.evaluate();
    assert.equal(typeof context.process, 'undefined');
    assert.equal(typeof context.WebAssembly, 'undefined');
    assert.equal(new entry.namespace.Vector3(1, 2, 3).lengthSq(), 14);
    assert.equal(new entry.namespace.Mesh().isMesh, true);
    assert.equal(typeof new entry.namespace.GLTFLoader().parse, 'function');
    assert.equal(entry.namespace.MeshoptDecoder.supported, false);
  `;
  execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', harness], { cwd: root, stdio: 'pipe' });
});
