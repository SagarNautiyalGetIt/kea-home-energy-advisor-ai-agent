const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'bin');

// Three r186's require entry is a Node-only deprecation wrapper. Fiber's native
// CommonJS entry also imports Three, so resolve every root request to the same
// ESM module; Hermes has no process.emitWarning and must never run that wrapper.
const threeModule = path.join(path.dirname(require.resolve('three')), 'three.module.js');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeModule };
  return resolveRequest
    ? resolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
