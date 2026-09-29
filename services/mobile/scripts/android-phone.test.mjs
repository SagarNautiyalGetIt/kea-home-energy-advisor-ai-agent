import assert from 'node:assert/strict';
import test from 'node:test';
import { frameSummary, parseDevices, parseFrameStats, selectDevice } from './android-phone.mjs';

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
