import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertBuildDirectory, frameSummary, gradleBuildArgs, parseDevices, parseFrameStats, selectDevice } from './android-phone.mjs';

test('bounds Gradle workers and heap rather than relying on a memory-heavy default', () => {
  const args = gradleBuildArgs();
  assert.ok(args.includes('--max-workers=1'));
  assert.ok(args.includes('--no-parallel'));
  assert.ok(args.includes('-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m'));
  assert.ok(gradleBuildArgs(2).includes('--max-workers=2'));
  for (const workers of [0, 3, NaN]) assert.throws(() => gradleBuildArgs(workers), /must be 1 or 2/);
});

test('refuses generating native files in the Vault even through a symlink', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kea-build-path-test-'));
  try {
    const vault = path.join(root, 'vault');
    const mobile = path.join(vault, 'mobile');
    mkdirSync(mobile, { recursive: true });
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    const alias = path.join(root, 'alias');
    symlinkSync(mobile, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertBuildDirectory(mobile, vault), /outside the Vault/);
    assert.throws(() => assertBuildDirectory(alias, vault), /outside the Vault/);
    assert.doesNotThrow(() => assertBuildDirectory(outside, vault));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('selects only an authorized phone and requires explicit selection for multiple devices', () => {
  const devices = parseDevices('List of devices attached\nphone-a device product:x\nphone-b unauthorized usb:1\n');
  assert.deepEqual(devices, [{ serial: 'phone-a', state: 'device' }, { serial: 'phone-b', state: 'unauthorized' }]);
  assert.equal(selectDevice(devices), 'phone-a');
  assert.throws(() => selectDevice(devices, 'phone-b'), /not ready/);
  assert.throws(() => selectDevice([{ serial: 'a', state: 'device' }, { serial: 'b', state: 'device' }]), /Multiple devices/);
  assert.equal(selectDevice([{ serial: 'a', state: 'device' }, { serial: 'b', state: 'device' }], 'b'), 'b');
});

test('reports frame times from Android framestats without counting incomplete frames', () => {
  const output = [
    'Other gfxinfo output',
    '---PROFILEDATA---',
    'Flags,IntendedVsync,Vsync,FrameCompleted',
    '0,1000000000,1000000001,1010000000',
    '0,1020000000,1020000001,1040000000',
    '1,1050000000,1050000001,1090000000',
    '0,1060000000,1060000001,1076000000',
    '---PROFILEDATA---',
  ].join('\n');
  const frames = parseFrameStats(output);
  assert.deepEqual(frames, [10, 20, 16]);
  assert.deepEqual(frameSummary(frames), { samples: 3, medianMs: 16, p95Ms: 20, over16_67Ms: 1, over16_67Percent: 33.3 });
  assert.throws(() => frameSummary([]), /No frame samples/);
});
