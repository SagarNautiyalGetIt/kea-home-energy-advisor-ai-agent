import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(projectRoot, 'package.json'));
// Use the generator shipped with our locked Expo SDK, also used by Expo CLI.
const { requireContext } = require('expo-router/internal/testing');
const { getTypedRoutesDeclarationFile } = require('@expo/router-server/build/typed-routes/generate');
const context = requireContext(resolve(projectRoot, 'src/app'), true, /\.[jt]sx?$/);
const declaration = getTypedRoutesDeclarationFile(context);
if (!declaration) throw new Error('Expo did not generate route declarations.');
const directory = resolve(projectRoot, '.expo/types');
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'router.d.ts'), declaration);
console.log('Generated Expo route types from src/app.');
