import assert from 'node:assert/strict';
import { it } from 'node:test';
import { dragHomeCamera, defaultCamera, toggleHomeSelection } from './home-camera.ts';
import { equipmentAt } from './home-equipment.ts';

it('each card toggles its highlight, and selecting another replaces it', () => {
  for (const key of ['home', 'solar', 'car', 'battery', 'grid']) {
    assert.equal(toggleHomeSelection(undefined, key), key);
    assert.equal(toggleHomeSelection(key, key), undefined);
    assert.equal(toggleHomeSelection('home', 'grid'), 'grid');
  }
});
it('horizontal and vertical orbit follow the hand in both directions and stay bounded', () => {
  assert.ok(dragHomeCamera(defaultCamera, 30, 0).x < 0);
  assert.ok(dragHomeCamera(defaultCamera, -30, 0).x > 0);
  assert.ok(dragHomeCamera(defaultCamera, 0, 30).y > 0);
  assert.ok(dragHomeCamera(defaultCamera, 0, -30).y < 0);
  assert.deepEqual(dragHomeCamera(defaultCamera, 1000, 1000), { x: -35, y: 13, zoom: 1 });
});
it('taking over mid-reveal preserves zoom and focus instead of snapping the view', () => {
  const mid = { x: 0, y: 0, zoom: 1.8, focusX: 0.2, focusY: -0.1, focusZ: 0.3 };
  assert.deepEqual(dragHomeCamera(mid, 0, 0), mid);
  assert.deepEqual(dragHomeCamera(mid, 30, 8), { ...mid, x: -10, y: 1 });
});
it('raycast surface probes identify each piece of equipment, excluding it from Home', () => {
  const probes = {
    solar: [[0.1061, 0.384, 0.0988], [0.3944, 0.2566, -0.5507]],
    battery: [[0.6542, -0.1992, 0.0485], [0.6542, -0.3185, 0.0865]],
    car: [[0.442, -0.2776, 0.7502], [0.3648, -0.3318, 0.9672]],
    grid: [[0.8766, -0.2703, -0.8336], [0.9027, -0.3379, -0.9391]],
  };
  for (const [target, points] of Object.entries(probes)) for (const point of points) {
    assert.equal(equipmentAt(target, point), true, `${target}: ${point}`);
    assert.equal(equipmentAt('home', point), false);
    for (const other of Object.keys(probes).filter(key => key !== target)) assert.equal(equipmentAt(other, point), false);
  }
  assert.equal(equipmentAt('home', [0, -0.405, 0]), false, 'ground must not light up as the house');
  assert.equal(equipmentAt('battery', [0.6499, -0.1921, -0.2102]), false, 'smaller inverter is not the battery');
});
