import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../public/sw-private-cache-cleanup.js', import.meta.url), 'utf8');

test('activating the updated worker removes only the old private caches', async () => {
  const stored = new Set(['vybe-api', 'vybe-media', 'workbox-precache', 'another-app']);
  let activate;
  vm.runInNewContext(script, {
    self: { addEventListener: (event, listener) => { assert.equal(event, 'activate'); activate = listener; } },
    caches: { delete: async (name) => stored.delete(name) },
    console,
  });
  let finished;
  activate({ waitUntil: (promise) => { finished = promise; } });
  await finished;
  assert.deepEqual([...stored].sort(), ['another-app', 'workbox-precache']);
});

test('cache cleanup failure is reported rather than silently called successful', async () => {
  let activate;
  let report;
  const error = new Error('Cache storage is unavailable');
  vm.runInNewContext(script, {
    self: { addEventListener: (_, listener) => { activate = listener; } },
    caches: { delete: async () => { throw error; } },
    console: { error: (...args) => { report = args; } },
  });
  let finished;
  activate({ waitUntil: (promise) => { finished = promise; } });
  await assert.rejects(finished, /Cache storage is unavailable/);
  assert.equal(report[1], error);
});
