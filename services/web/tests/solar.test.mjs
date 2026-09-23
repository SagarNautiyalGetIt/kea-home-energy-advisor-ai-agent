import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// Transpile the production module, without generating checked-in JS or adding a test library.
const source = ts.transpileModule(readFileSync(new URL('../src/lib/solar.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { calculateSolar, numeric, centsToNzd, solarPrompt, solarConfig } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const fixture = { panelKw: 5, installedCost: 11500, annualDemand: 8000, location: 'Auckland', generationOverride: null, selfUse: .5, importRate: .3, solarImportRate: .3, exportRate: .15, baselineDaily: .9, solarDaily: .9, baselineCredit: 0, solarCredit: 0, operatingCost: 0 }
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
test('annual maintenance allowance reduces net savings and extends payback once', () => {
  assert.equal(solarConfig.annualMaintenanceAllowance, 100)
  const result = calculateSolar({ ...fixture, operatingCost: solarConfig.annualMaintenanceAllowance })
  close(result.raw.saving, 1488.105)
  close(result.raw.netBenefit, 1388.105)
  close(result.raw.payback, 11500 / 1388.105)
  assert.equal(result.display.netBenefit, '$1,388.11')
  assert.equal(result.display.payback, '8.3 years')
})
test('independent Auckland 5 kW fixture, including export credit exactly once', () => {
  const { raw, display } = calculateSolar(fixture)
  for (const [key, value] of Object.entries({ generation: 6613.8, selfUsed: 3306.9, exported: 3306.9, gridImports: 4693.1, avoidedImportValue: 992.07, exportCredit: 496.035, baselineBill: 2728.5, solarBill: 1240.395, saving: 1488.105 })) close(raw[key], value)
  assert.equal(display.payback, '7.7 years')
})
test('30%, 50% and 70% independent sensitivity fixtures', () => {
  for (const [selfUse, saving, payback] of [[.3,1289.691,'8.9 years'],[.5,1488.105,'7.7 years'],[.7,1686.519,'6.8 years']]) {
    const result = calculateSolar({ ...fixture, selfUse }); close(result.raw.saving, saving); assert.equal(result.display.payback, payback)
  }
})
test('cap annual self-use without double-netting', () => {
  const { raw } = calculateSolar({ ...fixture, generationOverride: 10000, annualDemand: 2000, selfUse: .7 })
  assert.equal(raw.selfUsed,2000); assert.equal(raw.exported,8000); assert.equal(raw.gridImports,0); close(raw.saving,1800)
  assert.equal(calculateSolar({ ...fixture, annualDemand: 0 }).raw.selfUsed,0)
})
test('no value, negative benefit and display horizon', () => {
  for (const operatingCost of [0,100]) {
    const result=calculateSolar({ ...fixture, importRate:0, solarImportRate:0, exportRate:0, operatingCost })
    assert.equal(result.status,'no_payback'); assert.equal(result.raw.payback,null)
  }
  assert.equal(calculateSolar({ ...fixture, installedCost:100000 }).status,'beyond_horizon')
})
test('daily fees, operating allowance and credit changes', () => {
  close(calculateSolar({ ...fixture, solarDaily:1.1 }).raw.saving,1415.105)
  const operating=calculateSolar({ ...fixture, operatingCost:100 }); close(operating.raw.saving,1488.105); close(operating.raw.netBenefit,1388.105); assert.equal(operating.display.payback,'8.3 years')
  close(calculateSolar({ ...fixture, baselineCredit:60, solarCredit:60 }).raw.saving,1488.105)
  close(calculateSolar({ ...fixture, baselineCredit:60, solarCredit:0 }).raw.saving,1428.105)
})
test('installer generation overrides location, including Other', () => {
  for (const location of ['Auckland','Queenstown','Other location']) assert.equal(calculateSolar({ ...fixture, location, generationOverride:6000 }).raw.generation,6000)
  assert.throws(()=>calculateSolar({ ...fixture, location:'Other location' }))
  close(calculateSolar({ ...fixture, location:'Wellington' }).raw.generation,6482.4)
  close(calculateSolar({ ...fixture, location:'Queenstown' }).raw.generation,7183.2)
})
test('missing values differ from zero; reject invalid, nonfinite and overflow', () => {
  for (const value of ['', ' ', 'Infinity', 'NaN', 'abc']) assert.throws(()=>numeric(value,'Demand'))
  assert.equal(numeric('0','Demand'),0)
  for (const key of Object.keys(fixture).filter(key=>!['location','generationOverride'].includes(key))) {
    for (const value of [-1,NaN,Infinity,undefined,null]) assert.throws(()=>calculateSolar({ ...fixture, [key]:value }))
  }
  for (const generationOverride of [0,-1,NaN,Infinity]) assert.throws(()=>calculateSolar({ ...fixture, generationOverride }))
  assert.throws(()=>calculateSolar({ ...fixture, selfUse:1.1 }))
  assert.throws(()=>calculateSolar({ ...fixture, panelKw:Number.MAX_VALUE }))
})
test('cents convert once; signed bills and changed import tariff retained', () => {
  assert.equal(centsToNzd(30),.3); assert.equal(centsToNzd(15),.15)
  assert.throws(()=>centsToNzd(Infinity))
  assert.ok(calculateSolar({ ...fixture, annualDemand:0 }).raw.solarBill < 0)
  close(calculateSolar({ ...fixture, solarImportRate:.4 }).raw.solarBill,1709.705)
})
test('advisor receives the complete deterministic result and what-if restriction', () => {
  const result=calculateSolar(fixture)
  const prompt=solarPrompt({customerId:'H-JUL',result,origins:{demand:'demo'},tariffLabel:'example'})
  assert.ok(prompt.includes(JSON.stringify(result))); assert.ok(prompt.includes('/solar')); assert.ok(prompt.includes('Do not calculate new numbers'))
})
