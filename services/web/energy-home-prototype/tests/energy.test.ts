import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateEnergy, type EnergyInput, type EnergySnapshot } from '../src/lib/energy.ts'

const base: EnergyInput = {
  solarPotential: 1,
  batteryPercent: 60,
  reservePercent: 20,
  evEnabled: true,
  gridConnected: true,
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `Expected ${actual} to equal ${expected}`)
}

function balanced(snapshot: EnergySnapshot): void {
  const supply = snapshot.solarKw + snapshot.batteryDischargeKw + snapshot.gridImportKw
  const sinks = snapshot.homeServedKw + snapshot.evServedKw + snapshot.batteryChargeKw + snapshot.gridExportKw
  close(supply, sinks)
  close(snapshot.solarAvailableKw, snapshot.solarKw + snapshot.curtailedKw)
  close(snapshot.homeDemandKw + snapshot.evDemandKw, snapshot.homeServedKw + snapshot.evServedKw + snapshot.unservedKw)
  const f = snapshot.flows
  close(snapshot.homeServedKw, f.solarToHomeKw + f.batteryToHomeKw + f.gridToHomeKw)
  close(snapshot.evServedKw, f.solarToEvKw + f.batteryToEvKw + f.gridToEvKw)
  close(snapshot.solarKw, f.solarToHomeKw + f.solarToEvKw + f.solarToBatteryKw + f.solarToGridKw)
  assert.ok(snapshot.batteryChargeKw === 0 || snapshot.batteryDischargeKw === 0)
  assert.ok(snapshot.gridImportKw === 0 || snapshot.gridExportKw === 0)
  for (const value of Object.values(snapshot.flows)) assert.ok(Number.isFinite(value) && value >= 0)
}

test('sun powers home and EV before charging the battery', () => {
  const s = calculateEnergy(base)
  close(s.solarKw, 6.5)
  close(s.homeServedKw, 1.2)
  close(s.evServedKw, 3.2)
  close(s.batteryChargeKw, 2.1)
  assert.equal(s.gridImportKw, 0)
  assert.equal(s.gridExportKw, 0)
  assert.equal(s.batteryState, 'charging')
  assert.equal(s.selfPowered, true)
  balanced(s)
})

test('turning off the EV removes its demand and exports surplus after the charge limit', () => {
  const s = calculateEnergy({ ...base, evEnabled: false })
  assert.equal(s.evDemandKw, 0)
  assert.equal(s.evServedKw, 0)
  assert.equal(s.evState, 'off')
  close(s.batteryChargeKw, 5)
  close(s.gridExportKw, 0.3)
  assert.equal(s.gridState, 'exporting')
  balanced(s)
})

test('battery fills a solar deficit before the grid is used', () => {
  const s = calculateEnergy({ ...base, solarPotential: 0.1 })
  close(s.solarKw, 0.65)
  close(s.batteryDischargeKw, 3.75)
  assert.equal(s.gridImportKw, 0)
  assert.equal(s.batteryState, 'discharging')
  balanced(s)
})

test('battery reserve is protected and the grid supplies the unmet demand', () => {
  const s = calculateEnergy({ ...base, solarPotential: 0, batteryPercent: 20 })
  assert.equal(s.batteryDischargeKw, 0)
  close(s.gridImportKw, 4.4)
  assert.equal(s.batteryState, 'reserve')
  assert.equal(s.gridState, 'importing')
  assert.equal(s.solarState, 'idle')
  assert.equal(s.selfPowered, false)
  balanced(s)
})

test('remaining stored energy limits discharge over the dispatch interval', () => {
  const s = calculateEnergy({ ...base, solarPotential: 0, batteryPercent: 21, dispatchMinutes: 60 })
  close(s.batteryDischargeKw, 0.135)
  close(s.gridImportKw, 4.265)
  balanced(s)
})

test('near-full headroom limits charge and a full battery exports the entire surplus', () => {
  const nearFull = calculateEnergy({ ...base, evEnabled: false, batteryPercent: 99, dispatchMinutes: 60 })
  close(nearFull.batteryChargeKw, 0.135)
  close(nearFull.gridExportKw, 5.165)
  balanced(nearFull)
  const full = calculateEnergy({ ...base, evEnabled: false, batteryPercent: 100 })
  assert.equal(full.batteryChargeKw, 0)
  assert.equal(full.batteryState, 'full')
  close(full.gridExportKw, 5.3)
  balanced(full)
})

test('an outage protects home load before the EV and reports unserved demand', () => {
  const s = calculateEnergy({ ...base, solarPotential: 0.2, batteryPercent: 20, gridConnected: false })
  close(s.homeServedKw, 1.2)
  close(s.evServedKw, 0.1)
  close(s.unservedKw, 3.1)
  assert.equal(s.homeState, 'powered')
  assert.equal(s.evState, 'limited')
  assert.equal(s.gridState, 'outage')
  assert.equal(s.gridImportKw, 0)
  assert.equal(s.gridExportKw, 0)
  assert.equal(s.selfPowered, false)
  balanced(s)
})

test('outage curtails excess solar when the battery is full', () => {
  const s = calculateEnergy({ ...base, evEnabled: false, batteryPercent: 100, gridConnected: false })
  close(s.solarKw, 1.2)
  close(s.curtailedKw, 5.3)
  assert.equal(s.solarState, 'curtailed')
  assert.equal(s.gridExportKw, 0)
  assert.equal(s.unservedKw, 0)
  balanced(s)
})

test('outage without solar or available storage reports every load unpowered', () => {
  const s = calculateEnergy({ ...base, solarPotential: 0, batteryPercent: 0, gridConnected: false })
  assert.equal(s.homeState, 'unpowered')
  assert.equal(s.evState, 'unpowered')
  close(s.unservedKw, 4.4)
  balanced(s)
})

test('zero-capacity storage cannot absorb or supply power', () => {
  const sunny = calculateEnergy({ ...base, batteryCapacityKwh: 0 })
  assert.equal(sunny.batteryChargeKw, 0)
  assert.equal(sunny.batteryState, 'unavailable')
  balanced(sunny)
  const dark = calculateEnergy({ ...base, solarPotential: 0, batteryCapacityKwh: 0 })
  assert.equal(dark.batteryDischargeKw, 0)
  close(dark.gridImportKw, 4.4)
  balanced(dark)
})

test('clamps physical percentages and rejects invalid power or interval settings', () => {
  const s = calculateEnergy({ ...base, solarPotential: 2, batteryPercent: 110, reservePercent: -10 })
  assert.equal(s.solarAvailableKw, 6.5)
  assert.equal(s.batteryPercent, 100)
  assert.equal(s.reservePercent, 0)
  balanced(s)
  assert.throws(() => calculateEnergy({ ...base, solarPotential: NaN }), RangeError)
  assert.throws(() => calculateEnergy({ ...base, homeDemandKw: -1 }), RangeError)
  assert.throws(() => calculateEnergy({ ...base, batteryCapacityKwh: Infinity }), RangeError)
  assert.throws(() => calculateEnergy({ ...base, dispatchMinutes: 0 }), RangeError)
})

test('dispatch conserves energy and respects battery capacity and reserve across 1,120 scenarios', () => {
  let scenarios = 0
  for (const solarPotential of [0, 0.1, 0.4, 0.8, 1]) {
    for (const batteryPercent of [0, 10, 20, 20.01, 50, 99.99, 100]) {
      for (const reservePercent of [0, 20, 50, 100]) {
        for (const evEnabled of [false, true]) {
          for (const gridConnected of [false, true]) {
            for (const dispatchMinutes of [5, 60]) {
              const s = calculateEnergy({ ...base, solarPotential, batteryPercent, reservePercent, evEnabled, gridConnected, dispatchMinutes })
              balanced(s)
              const hours = dispatchMinutes / 60
              assert.ok(s.batteryDischargeKw * hours <= Math.max(0, batteryPercent - reservePercent) / 100 * 13.5 + 1e-8)
              assert.ok(s.batteryChargeKw * hours <= (100 - batteryPercent) / 100 * 13.5 + 1e-8)
              assert.ok(s.batteryChargeKw <= 5 && s.batteryDischargeKw <= 5)
              if (!gridConnected) assert.equal(s.gridImportKw + s.gridExportKw, 0)
              scenarios += 1
            }
          }
        }
      }
    }
  }
  assert.equal(scenarios, 1120)
})
