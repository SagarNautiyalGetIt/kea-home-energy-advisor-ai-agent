#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), '..');
const androidRoot = path.join(mobileRoot, 'android');
const defaultApk = path.join(androidRoot, 'app/build/outputs/apk/debug/app-debug.apk');
const packageName = 'nz.co.keaenergy.mobile';
const evidenceRoot = path.join(os.homedir(), '.cache/kea-energy/android-evidence');
const nativeLibrary = 'lib/arm64-v8a/librnllama.so';

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd ?? mobileRoot,
    env: options.env ?? process.env,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio ?? 'pipe',
  });
  if (result.error) throw new Error(`${binary}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(`${binary} ${args.join(' ')} failed (${result.status})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

export function parseDevices(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('List of devices') && !line.startsWith('* daemon')).map((line) => {
    const [serial, state] = line.split(/\s+/, 3);
    return { serial, state };
  }).filter((item) => item.serial && item.state);
}

export function selectDevice(devices, requestedSerial) {
  const ready = devices.filter((device) => device.state === 'device');
  if (requestedSerial) {
    const match = ready.find((device) => device.serial === requestedSerial);
    if (!match) throw new Error(`Device ${requestedSerial} is not ready. Check USB debugging and 'adb devices -l'.`);
    return match.serial;
  }
  if (ready.length === 0) throw new Error('No authorized Android phone detected. Connect it, enable USB debugging, and accept the phone prompt.');
  if (ready.length > 1) throw new Error(`Multiple devices detected (${ready.map((item) => item.serial).join(', ')}). Pass --serial=<device>.`);
  return ready[0].serial;
}

export function parseFrameStats(output) {
  const section = output.split('---PROFILEDATA---')[1];
  if (!section) return [];
  const lines = section.trim().split(/\r?\n/);
  const columns = lines.shift()?.split(',').map((column) => column.trim()) ?? [];
  const start = columns.indexOf('IntendedVsync');
  const end = columns.indexOf('FrameCompleted');
  const flags = columns.indexOf('Flags');
  if (start < 0 || end < 0) return [];
  return lines.map((line) => line.split(',')).filter((cells) => cells.length >= columns.length && (flags < 0 || cells[flags] === '0')).map((cells) => (Number(cells[end]) - Number(cells[start])) / 1_000_000).filter((milliseconds) => Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds < 1_000);
}

export function frameSummary(frames) {
  if (frames.length === 0) throw new Error('No frame samples found. Run frames-start, exercise the screen, then frames-report.');
  const ordered = [...frames].sort((a, b) => a - b);
  const percentile = (fraction) => ordered[Math.ceil(fraction * ordered.length) - 1];
  const overBudget = frames.filter((frame) => frame > 16.67).length;
  return { samples: frames.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), over16_67Ms: overBudget, over16_67Percent: Math.round((overBudget / frames.length) * 1000) / 10 };
}

function option(name) {
  const argument = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return argument?.slice(name.length + 3);
}

function adbSerial() {
  return selectDevice(parseDevices(command('adb', ['devices', '-l'])), option('serial') ?? process.env.ANDROID_SERIAL);
}

function adb(serial, args, options = {}) {
  return command('adb', ['-s', serial, ...args], options);
}

function apkPath() {
  return path.resolve(option('apk') ?? defaultApk);
}

function verifyApk(filePath) {
  if (!existsSync(filePath)) throw new Error(`APK not found: ${filePath}. Run build first.`);
  const entries = command('jar', ['tf', filePath]);
  if (!entries.split(/\r?\n/).includes(nativeLibrary)) throw new Error(`APK is missing ${nativeLibrary}. Install llama.rn native artifacts and rebuild.`);
  console.log(`Verified ${nativeLibrary} in ${filePath}`);
}

function requireTool(binary, args = ['--version']) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${binary} is unavailable. Install/configure it before continuing.`);
  console.log(`${binary}: ${(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0]}`);
}

async function doctor() {
  requireTool('node');
  requireTool('java', ['-version']);
  requireTool('jar', ['--version']);
  requireTool('adb', ['version']);
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(sdk)) throw new Error('Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK.');
  console.log(`Android SDK: ${sdk}`);
  const serial = adbSerial();
  const model = adb(serial, ['shell', 'getprop', 'ro.product.model']).trim();
  const version = adb(serial, ['shell', 'getprop', 'ro.build.version.release']).trim();
  const abi = adb(serial, ['shell', 'getprop', 'ro.product.cpu.abi']).trim();
  console.log(`Authorized phone: ${serial} · ${model} · Android ${version} · ${abi}`);
  if (abi !== 'arm64-v8a') console.log('This phone is not arm64-v8a; on-phone Sparky will show the unsupported state.');
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) {
    console.log('Set EXPO_PUBLIC_API_URL to the phone-reachable API origin before starting Metro.');
    return;
  }
  const url = new URL(apiUrl);
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) throw new Error('EXPO_PUBLIC_API_URL uses loopback. A physical phone needs a LAN-reachable API origin.');
  const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`API health returned HTTP ${response.status}.`);
  console.log(`API health reachable from this computer: ${response.status}. Open the same URL on the phone to confirm phone reachability.`);
}

function ensureNativeArtifacts() {
  const packageRoot = path.join(mobileRoot, 'node_modules/llama.rn');
  const installer = path.join(packageRoot, 'install/download-native-artifacts.js');
  const manifestPath = path.join(packageRoot, 'install/native-artifacts.json');
  if (!existsSync(installer) || !existsSync(manifestPath)) throw new Error('Run npm ci in services/mobile before building.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const android = manifest.artifacts.find((artifact) => artifact.name === 'android-jni-libs');
  if (!android) throw new Error('llama.rn Android artifact is absent from its pinned manifest.');
  command('node', [installer], { stdio: 'inherit' });
  const marker = path.join(packageRoot, android.markerPath);
  const library = path.join(packageRoot, 'android/src/main/jniLibs/arm64-v8a/librnllama.so');
  if (!existsSync(library) || !existsSync(marker) || readFileSync(marker, 'utf8').trim() !== android.sha256) throw new Error('llama.rn checksum marker or arm64 library is missing.');
  console.log('Pinned llama.rn Android native artifact is installed and checksum marked.');
}

function overrideGeneratedNdk(version) {
  if (!/^\d+(?:\.\d+){2,3}$/.test(version)) throw new Error('Invalid --ndk-version. Use an installed version such as 28.2.13676358.');
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(path.join(sdk, 'ndk', version, 'source.properties'))) throw new Error(`Android NDK ${version} is not installed under ANDROID_HOME.`);
  const gradleFile = path.join(androidRoot, 'build.gradle');
  const source = readFileSync(gradleFile, 'utf8');
  const anchor = 'apply plugin: "expo-root-project"';
  if (!source.includes(anchor)) throw new Error('Expo root Gradle anchor changed; cannot safely set a local NDK override.');
  writeFileSync(gradleFile, source.replace(anchor, `${anchor}\n// Local KEA-246 test override; generated android/ is ignored.\nrootProject.ext.ndkVersion = "${version}"`));
  console.log(`Using local generated Gradle NDK override: ${version}`);
}

function build() {
  const vaultRoot = path.join(os.homedir(), 'Documents/Vault') + path.sep;
  if (mobileRoot.startsWith(vaultRoot)) throw new Error('Build in an isolated checkout under ~/.cache/vault-builds/ so generated Android files stay outside the Vault.');
  requireTool('java', ['-version']);
  requireTool('jar', ['--version']);
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(sdk)) throw new Error('Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK.');
  ensureNativeArtifacts();
  const expo = path.join(mobileRoot, 'node_modules/expo/bin/cli');
  if (!existsSync(expo)) throw new Error('Expo CLI is missing. Run npm ci in services/mobile.');
  command('node', [expo, 'prebuild', '--platform', 'android', '--no-install'], { stdio: 'inherit', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
  if (option('ndk-version')) overrideGeneratedNdk(option('ndk-version'));
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  command(gradle, [':app:assembleDebug', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2', '--no-parallel', '--no-daemon', '--console=plain'], { cwd: androidRoot, stdio: 'inherit' });
  verifyApk(defaultApk);
}

function install() {
  const filePath = apkPath();
  verifyApk(filePath);
  const serial = adbSerial();
  adb(serial, ['install', '-r', filePath], { stdio: 'inherit' });
  adb(serial, ['shell', 'pm', 'path', packageName]);
  console.log(`Installed ${packageName} on ${serial}. Start Metro with --dev-client --lan, then open the app.`);
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function evidencePath(serial, suffix) {
  mkdirSync(evidenceRoot, { recursive: true });
  return path.join(evidenceRoot, `${timestamp()}-${serial.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}${suffix}`);
}

function screenshot() {
  const serial = adbSerial();
  const filePath = evidencePath(serial, '.png');
  writeFileSync(filePath, adb(serial, ['exec-out', 'screencap', '-p'], { encoding: 'buffer' }));
  console.log(`Screenshot saved locally: ${filePath}. Review it before sharing.`);
}

function framesStart() {
  const serial = adbSerial();
  adb(serial, ['shell', 'dumpsys', 'gfxinfo', packageName, 'reset']);
  console.log(`Frame counters reset on ${serial}. Exercise a screen for at least 20 seconds, then run frames-report.`);
}

function framesReport() {
  const serial = adbSerial();
  const summary = frameSummary(parseFrameStats(adb(serial, ['shell', 'dumpsys', 'gfxinfo', packageName, 'framestats'])));
  const filePath = evidencePath(serial, '-frames.json');
  writeFileSync(filePath, `${JSON.stringify({ device: serial, budgetMs: 16.67, ...summary }, null, 2)}\n`);
  console.log(`${summary.samples} frames; median ${summary.medianMs.toFixed(1)} ms; p95 ${summary.p95Ms.toFixed(1)} ms; ${summary.over16_67Percent}% over 16.67 ms.`);
  console.log(`Frame summary saved locally: ${filePath}. This measures Android UI frames, not end-to-end JS latency or guaranteed 60 fps.`);
}

function help() {
  console.log('Usage: node scripts/android-phone.mjs <doctor|build|verify-apk|install|screenshot|frames-start|frames-report> [--serial=DEVICE] [--apk=PATH] [--ndk-version=VERSION]');
}

async function main() {
  switch (process.argv[2]) {
    case 'doctor': await doctor(); break;
    case 'build': build(); break;
    case 'verify-apk': verifyApk(apkPath()); break;
    case 'install': install(); break;
    case 'screenshot': screenshot(); break;
    case 'frames-start': framesStart(); break;
    case 'frames-report': framesReport(); break;
    case '--help': case '-h': case undefined: help(); break;
    default: throw new Error(`Unknown command: ${process.argv[2]}. Run --help.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => { console.error(`Android phone kit: ${error.message}`); process.exitCode = 1; });
}
