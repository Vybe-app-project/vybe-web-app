import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * src/lib/unitConversions.ts is import-free so it can be loaded straight
 * from source here (the same pattern as tests/password-reset.test.mjs).
 */
async function loadModule(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, `${relative} must stay import-free so tests can load it directly`);
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}

const units = await loadModule('src/lib/unitConversions.ts');

test('a US user who enters 180 lb / 5 ft 11 in is stored as 81.65 kg / 180.3 cm and shown back the same way', () => {
  const kg = units.lbToKg(180);
  assert.equal(kg, 81.65);
  assert.equal(units.kgToLb(kg), 180);
  const cm = units.feetInchesToCm(5, 11);
  assert.equal(cm, 180.3);
  assert.deepEqual(units.cmToFeetInches(cm), { feet: 5, inches: 11 });
  assert.equal(units.formatFeetInches(180), '5 ft 11 in');
});

test('display and parse are inverses in both systems', () => {
  for (const kg of [45, 74.5, 81.6, 120]) {
    assert.equal(units.parseWeight(units.displayWeight(kg, 'metric'), 'metric'), Math.round(kg * 10) / 10);
    const roundTrip = units.parseWeight(units.displayWeight(kg, 'imperial'), 'imperial');
    assert.ok(Math.abs(roundTrip - kg) < 0.05, `${kg} kg round-trips through lb within 50 g (got ${roundTrip})`);
  }
  assert.equal(units.displayWeight(81.6, 'imperial'), 179.9);
  assert.equal(units.formatWeight(81.6, 'imperial'), '179.9 lb');
  assert.equal(units.formatWeight(81.6, 'metric'), '81.6 kg');
});

test('hydration converts oz to ml for metric users', () => {
  assert.equal(units.ozToMl(64), 1893);
  assert.equal(units.mlToOz(500), 16.9);
  assert.equal(units.displayVolume(8, 'metric'), 237);
  assert.equal(units.displayVolume(8, 'imperial'), 8);
  assert.equal(units.volumeUnit('metric'), 'ml');
  assert.equal(units.volumeUnit('imperial'), 'oz');
});

test('validation ranges mirror the API’s metric limits in the shown unit', () => {
  const imperial = units.goalRanges('imperial');
  const metric = units.goalRanges('metric');
  assert.deepEqual(metric.weight, { min: 20, max: 500 });
  assert.ok(Math.abs(units.lbToKg(imperial.weight.min) - 20) < 0.1);
  assert.ok(Math.abs(units.lbToKg(imperial.weight.max) - 500) < 0.5);
  assert.ok(Math.abs(units.inToCm(imperial.heightIn.min) - 80) < 2);
  assert.ok(Math.abs(units.inToCm(imperial.heightIn.max) - 260) < 2);
  assert.ok(Math.abs(units.lbToKg(imperial.pace.max) - 2) < 0.01);
});

test('US locales default to imperial, everyone else to metric', () => {
  assert.equal(units.defaultUnitSystem('en-US'), 'imperial');
  assert.equal(units.defaultUnitSystem('en-GB'), 'metric');
  assert.equal(units.defaultUnitSystem('de-DE'), 'metric');
  assert.equal(units.defaultUnitSystem(undefined), 'metric');
});
