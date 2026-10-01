import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

async function loadSolar(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const mobile = await loadSolar('./solar.ts');
const desktop = await loadSolar('../../../web/src/lib/solar.ts');
const fixture = {
  panelKw: 5, installedCost: 11500, annualDemand: 7000, location: 'Auckland',
  generationOverride: null, selfUse: 0.5, importRate: 0.325, solarImportRate: 0.325,
  exportRate: 0.15, baselineDaily: 1.45, solarDaily: 1.45,
  baselineCredit: 0, solarCredit: 0, operatingCost: 100,
};

test('mobile solar results stay aligned with desktop across inputs and payback states', () => {
  const cases = [
    fixture,
    { ...fixture, installedCost: 8500, panelKw: 3, selfUse: 0.3 },
    { ...fixture, installedCost: 20000, panelKw: 10, selfUse: 0.7, solarImportRate: 0.35 },
    { ...fixture, location: 'Other location', generationOverride: 6000, baselineCredit: 120, solarCredit: 0 },
    { ...fixture, installedCost: 100000 },
    { ...fixture, importRate: 0, solarImportRate: 0, exportRate: 0 },
  ];
  for (const input of cases) {
    const actual = mobile.calculateSolar(input);
    const expected = desktop.calculateSolar(input);
    assert.deepEqual(actual.raw, expected.raw);
    assert.deepEqual(actual.display, expected.display);
    assert.equal(actual.status, expected.status);
  }
  assert.equal(mobile.solarConfig.annualMaintenanceAllowance, 100);
});
