import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeFlows } from './home-flows.ts';
import { canClaimEdgeBack, shouldCompleteEdgeBack, backFallback } from './edge-back.ts';
import { validateHourlyUsage, hourlyPoints } from './hourly-usage.ts';

test('flows preserve zero, missing and measured directions without inventing power', () => {
  assert.ok(homeFlows({}, false).every(flow => flow.watts === null && !flow.active));
  assert.ok(homeFlows({}, true).every(flow => flow.watts === null && flow.active));
  const flows = homeFlows({ solar_generation: 0, grid_import: 2400, grid_export: 0, battery_charge: 900, battery_discharge: 0 }, true);
  assert.equal(flows[0].active, false);
  assert.equal(flows[1].watts, 900); assert.equal(flows[1].reverse, false);
  assert.equal(flows[2].watts, 2400); assert.equal(flows[2].reverse, true);
  assert.equal(homeFlows({ battery_discharge: 1800 }, false)[1].reverse, true);
  assert.equal(homeFlows({ grid_export: 900 }, false)[2].reverse, false);
  assert.equal(homeFlows({ solar_generation: NaN }, false)[0].watts, null);
});
test('back gesture belongs to left edge and excludes Home, vertical and inner drags', () => {
  assert.ok(canClaimEdgeBack('/outages', 12, 40, 5));
  for (const args of [['/dashboard', 0, 100, 0], ['/usage', 60, 100, 0], ['/plans', 0, 20, 60], ['/assistant', 0, -100, 0]]) assert.equal(canClaimEdgeBack(...args), false);
  assert.ok(shouldCompleteEdgeBack(90, 5, 0));
  assert.equal(shouldCompleteEdgeBack(28, 1, 0.9), false);
  assert.equal(shouldCompleteEdgeBack(80, 100, 0.9), false);
  assert.equal(backFallback('/outages'), '/more');
  assert.equal(backFallback('/usage'), '/dashboard');
  assert.equal(backFallback('/solar'), '/plans');
  assert.equal(backFallback('/voice'), '/assistant');
});
const hours = Array.from({length:24}, (_,i) => ({start:new Date(Date.UTC(2026,9,2,11+i)).toISOString(),label:`${i}:00 NZDT`,kwh:1,quality:'measured',intervals_received:2,expected_intervals:2}));
const row = () => ({customer_id:'A',day:'2026-10-03',timezone:'Pacific/Auckland',source:'intervals',note:'Dated readings',hours:structuredClone(hours)});
test('hourly chart never bridges missing hours, validates account and dated coverage', () => {
  assert.equal(hourlyPoints(validateHourlyUsage(row(),'A','2026-10-03'),.3).length,24);
  assert.ok(hourlyPoints(validateHourlyUsage(row(),'A','2026-10-03'),null).every(point=>point.kwh===1 && point.costNzd===null));
  const partial=row(); partial.hours[2]={...partial.hours[2],kwh:null,quality:'missing',intervals_received:1};
  assert.equal(hourlyPoints(validateHourlyUsage(partial,'A','2026-10-03'),.3).length,0);
  assert.throws(()=>validateHourlyUsage(row(),'B','2026-10-03'));
  const short=row(); short.hours.pop(); assert.throws(()=>validateHourlyUsage(short,'A','2026-10-03'));
  for(const [day,start,count] of [['2026-09-27','2026-09-26T12:00:00Z',23],['2026-04-05','2026-04-04T11:00:00Z',25]]) {
    const dst={...row(),day,hours:Array.from({length:count},(_,i)=>({...hours[0],start:new Date(Date.parse(start)+i*3600000).toISOString()}))};
    assert.equal(validateHourlyUsage(dst,'A',day).hours.length,count);
  }
  for(const change of [r=>{r.hours[2].kwh=-1},r=>{r.hours[2].start=r.hours[1].start},r=>{r.source='unavailable'},r=>{r.hours[2].intervals_received=1}]) {const r=row();change(r);assert.throws(()=>validateHourlyUsage(r,'A','2026-10-03'));}
});
