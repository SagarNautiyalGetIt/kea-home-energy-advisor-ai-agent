import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MOBILE_PRESENTATION_BATTERY_PERCENT, MOBILE_PRESENTATION_HOME_POWER, mobilePresentationHomeReading } from './mobile-presentation-home.ts';
import { homeFlows } from './home-flows.ts';

it('the Home snapshot balances generation and import against all consumption', () => {
  const power = MOBILE_PRESENTATION_HOME_POWER;
  assert.equal(power.solar_generation + power.grid_import + power.battery_discharge,
    power.home_load + power.ev_charger + power.battery_charge + power.grid_export);
  assert.ok(MOBILE_PRESENTATION_BATTERY_PERCENT > 0 && MOBILE_PRESENTATION_BATTERY_PERCENT < 100);
});

it('all four energy paths carry power in the displayed charging and import directions', () => {
  const flows = homeFlows(MOBILE_PRESENTATION_HOME_POWER, false);
  assert.deepEqual(flows.map(flow => flow.id), ['solar', 'battery', 'grid', 'car']);
  assert.ok(flows.every(flow => flow.active && flow.watts > 10));
  assert.equal(flows.find(flow => flow.id === 'battery').reverse, false);
  assert.equal(flows.find(flow => flow.id === 'grid').reverse, true);
  assert.equal(flows.find(flow => flow.id === 'car').watts, 3200);
});

it('each card uses the same power as its path and has a neutral energy label', () => {
  const power = MOBILE_PRESENTATION_HOME_POWER;
  for (const [device, watts] of [['solar', power.solar_generation], ['home', power.home_load], ['car', power.ev_charger], ['battery', power.battery_charge], ['grid', power.grid_import]]) {
    const reading = mobilePresentationHomeReading(device);
    assert.equal(Number.parseFloat(reading.value) * 1000, watts);
    assert.match(reading.value, /^\d\.\d kW$/);
    assert.doesNotMatch(reading.detail, /live|sensor|meter|demo|illustrative|fake|example/i);
  }
  assert.equal(mobilePresentationHomeReading('battery').detail, 'Charging · 76%');
});
