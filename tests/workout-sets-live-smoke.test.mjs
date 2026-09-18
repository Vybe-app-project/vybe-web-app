import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { cleanupOwned, createLedger, readConfig } from '../scripts/smoke-workout-sets-live.mjs';

// Pure safety tests: importing the executable must not launch a browser, log
// in, or perform network requests. No live credentials are used by this suite.
const config = () => ({
  ORIGIN: 'https://fitness.invalid',
  VYBE_EMAIL: 'unused@invalid.test',
  VYBE_PASSWORD: 'not-a-live-credential',
  VYBE_PLAYWRIGHT: path.resolve('existing-playwright/index.mjs'),
});
const firstId = '111111111111111111111111';
const secondId = '222222222222222222222222';
const unrelatedId = '333333333333333333333333';
const names = ['unique-run-first', 'unique-run-repeat'];
const tracked = () => {
  const ledger = createLedger(names);
  ledger.record({ _id: firstId, name: names[0] }, names[0]);
  ledger.record({ _id: secondId, name: names[1] }, names[1]);
  return ledger;
};

test('requires explicit origin, credentials and local Playwright path with no live defaults', () => {
  const parsed = readConfig(config());
  assert.equal(parsed.origin, 'https://fitness.invalid');
  assert.equal(parsed.headless, false);
  for (const key of ['ORIGIN', 'VYBE_EMAIL', 'VYBE_PASSWORD', 'VYBE_PLAYWRIGHT']) {
    assert.throws(() => readConfig({ ...config(), [key]: '' }));
  }
  assert.throws(() => readConfig({ ...config(), VYBE_PLAYWRIGHT: 'https://external.invalid/playwright.mjs' }));
  assert.throws(() => readConfig({ ...config(), VYBE_CHROMIUM_EXECUTABLE: './browser' }));
});

test('rejects origin credentials, paths, fragments and insecure remote origins', () => {
  for (const origin of [
    'https://user:password@fitness.invalid',
    'https://fitness.invalid/path',
    'https://fitness.invalid/?query=1',
    'https://fitness.invalid/#fragment',
    'http://fitness.invalid',
    'file:///private',
  ]) {
    assert.throws(() => readConfig({ ...config(), ORIGIN: origin }));
  }
  assert.equal(readConfig({ ...config(), ORIGIN: 'http://127.0.0.1:8080', VYBE_HEADLESS: '1' }).headless, true);
  assert.throws(() => readConfig({ ...config(), VYBE_HEADLESS: 'yes' }));
});

test('accepts explicit existing Chromium override without printing or transforming secrets', () => {
  const executable = path.resolve('existing-browser');
  const password = ' whitespace matters ';
  const parsed = readConfig({ ...config(), VYBE_CHROMIUM_EXECUTABLE: executable, VYBE_PASSWORD: password });
  assert.equal(parsed.executablePath, executable);
  assert.equal(parsed.password, password);
});

test('ledger records only matching create responses and refuses unowned or reused IDs', () => {
  const ledger = createLedger(names);
  assert.throws(() => ledger.requireOwned(unrelatedId));
  assert.throws(() => ledger.record({ _id: firstId, name: 'pre-existing' }, names[0]));
  assert.throws(() => ledger.record({ _id: firstId, name: 'pre-existing' }, 'pre-existing'));
  assert.throws(() => ledger.record({ _id: '../all', name: names[0] }, names[0]));
  assert.throws(() => ledger.record({}, names[0]));
  ledger.record({ _id: firstId, name: names[0] }, names[0]);
  assert.throws(() => ledger.record({ _id: firstId, name: names[1] }, names[1]));
  assert.equal(ledger.rows.size, 1);
});

test('cleanup uses only exact recorded IDs, rechecks identity and verifies each deletion', async () => {
  const ledger = tracked();
  const records = new Map([
    [firstId, { _id: firstId, name: names[0] }],
    [secondId, { _id: secondId, name: names[1] }],
    [unrelatedId, { _id: unrelatedId, name: 'pre-existing' }],
  ]);
  const calls = [];
  const result = await cleanupOwned(ledger, async (method, id) => {
    calls.push([method, id]);
    if (method === 'GET') return { status: records.has(id) ? 200 : 404, workout: records.get(id) };
    assert.equal(method, 'DELETE');
    records.delete(id);
    return { status: 200 };
  });
  assert.deepEqual(result, { deleted: 2, failed: 0 });
  assert.deepEqual(calls, [
    ['GET', secondId], ['DELETE', secondId], ['GET', secondId],
    ['GET', firstId], ['DELETE', firstId], ['GET', firstId],
  ]);
  assert.equal(records.size, 1);
  assert.equal(records.get(unrelatedId).name, 'pre-existing');
});

test('identity mismatch never deletes a row and does not prevent other owned cleanup attempts', async () => {
  const ledger = tracked();
  const deleted = new Set();
  const calls = [];
  const result = await cleanupOwned(ledger, async (method, id) => {
    calls.push([method, id]);
    if (method === 'DELETE') { deleted.add(id); return { status: 200 }; }
    if (deleted.has(id)) return { status: 404 };
    return { status: 200, workout: { _id: id, name: id === secondId ? 'unexpected-name' : names[0] } };
  });
  assert.deepEqual(result, { deleted: 1, failed: 1 });
  assert.equal(calls.some(([method, id]) => method === 'DELETE' && id === secondId), false);
  assert.equal(deleted.has(firstId), true);
});

test('cleanup counts failed reads, rejected deletes and failed verification as failures', async () => {
  for (const mode of ['read', 'delete', 'verify', 'network']) {
    const ledger = createLedger(names);
    ledger.record({ _id: firstId, name: names[0] }, names[0]);
    const result = await cleanupOwned(ledger, async method => {
      if (mode === 'network') throw new Error('private body that must not be logged');
      if (method === 'GET') {
        return mode === 'read' ? { status: 503 } : { status: 200, workout: { _id: firstId, name: names[0] } };
      }
      return { status: mode === 'delete' ? 500 : 200 };
    });
    assert.deepEqual(result, { deleted: 0, failed: 1 }, mode);
  }
});

test('empty ledger makes no requests and cannot discover or delete pre-existing rows', async () => {
  const result = await cleanupOwned(createLedger(names), () => { throw new Error('Unexpected request'); });
  assert.deepEqual(result, { deleted: 0, failed: 0 });
});
