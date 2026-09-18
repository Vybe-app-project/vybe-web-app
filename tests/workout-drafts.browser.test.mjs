import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = process.env.VYBE_PLAYWRIGHT;
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const userA = { _id: 'owner-a', username: 'athlete-a' };
const userB = { _id: 'owner-b', username: 'athlete-b' };
const database = 'vybe-workout-drafts';
const stored = page => page.evaluate(name => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 2);
  request.onerror = () => reject(new Error('Cannot inspect IDB'));
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('drafts');
    const get = tx.objectStore('drafts').getAll();
    get.onsuccess = () => resolve(get.result);
    tx.oncomplete = () => db.close();
  };
}), database);
const mutateStored = (page, patch) => page.evaluate(({ name, patch: updates }) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 2);
  request.onerror = () => reject(new Error('Cannot inspect IDB'));
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    const get = store.getAll();
    get.onsuccess = () => store.put({ ...get.result[0], ...updates });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error('Cannot update fixture')); };
  };
}), { name: database, patch });

if (!playwright) {
  test('durable workout drafts in IndexedDB', { skip: 'Build and set VYBE_PLAYWRIGHT to existing Chromium tooling.' }, () => {});
} else {
  describe('real Chromium workout drafts and rest timer', { timeout: 120000 }, () => {
    let browser, server, base;
    before(async () => {
      const { chromium } = await import(pathToFileURL(playwright).href);
      browser = await chromium.launch({ executablePath: process.env.VYBE_CHROMIUM_EXECUTABLE });
      const dist = path.join(root, 'dist');
      const storageModule = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/workoutDrafts.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      server = http.createServer((req, res) => {
        if (req.url === '/draft-storage-fixture') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!doctype html><title>IndexedDB fixture</title>');
          return;
        }
        if (req.url === '/draft-storage-module.js') {
          res.writeHead(200, { 'Content-Type': 'text/javascript' });
          res.end(storageModule);
          return;
        }
        const target = path.resolve(dist, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
        if (!target.startsWith(`${dist}${path.sep}`)) { res.writeHead(400); res.end(); return; }
        const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
    async function setup(options = {}) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const state = { saves: [], logs: [], requests: new Map(), loseAck: false, holdAck: null, user: userA, status: 200 };
      await context.addInitScript(() => {
        if (!localStorage.getItem('fixture-initialized')) {
          localStorage.setItem('vybe.token', 'session-a');
          localStorage.setItem('fixture-initialized', '1');
        }
      });
      if (options.unavailable) await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { return undefined; } }));
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        let status = 200;
        let body = { data: [], posts: [], notifications: [], rooms: [] };
        if (url.pathname === '/api/users/me') body = { user: state.user };
        if (url.pathname === '/api/workouts/logs' && method === 'GET') body = { workouts: state.logs, total: state.logs.length, page: 1, hasNextPage: false };
        if (url.pathname === '/api/workouts/logs' && method === 'POST') {
          const payload = route.request().postDataJSON();
          state.saves.push(payload);
          status = state.status;
          if (status >= 400) body = { message: 'Save rejected for test' };
          else {
            let workout = state.requests.get(payload.clientRequestId);
            if (workout) status = 200;
            else {
              workout = { ...payload, user: state.user._id, _id: 'saved-draft-log', revision: 0 };
              state.requests.set(payload.clientRequestId, workout);
              state.logs.push(workout);
              status = 201;
            }
            body = { workout };
            if (state.holdAck) await state.holdAck;
            if (state.loseAck) { state.loseAck = false; await route.abort('failed'); return; }
          }
        }
        if (url.pathname.includes('/workouts/workout/info/single-workout/')) {
          body = { data: { _id: 'template', title: 'Prescribed legacy plan', category: 'strength', exercises: [{ name: 'Carry', sets: 3, reps: 8, weight: 20 }] } };
        }
        if (url.pathname === '/api/auth/logout') body = {};
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const page = await context.newPage();
      return { context, page, state };
    }
    async function newDraft(page) {
      await page.goto(`${base}/workouts/logs?log=1`);
      const dialog = page.getByRole('dialog', { name: 'Log a session', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Session name', { exact: true }).fill('Durable local session');
      await dialog.getByLabel('Exercise 1 name', { exact: true }).fill('Squat');
      await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('5');
      await dialog.getByLabel('Exercise 1 set 1 weight', { exact: true }).fill('40');
      await dialog.getByRole('checkbox', { name: 'Exercise 1 set 1 completed' }).check();
      await dialog.getByText('Local only · unsynced · saved on this device', { exact: true }).waitFor();
      return dialog;
    }
    async function resume(page) {
      await page.getByRole('button', { name: 'Resume workout draft', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Log a session', exact: true });
      await dialog.waitFor();
      return dialog;
    }
    async function twoEditors() {
      const fixture = await setup();
      const first = await newDraft(fixture.page);
      await first.getByRole('button', { name: 'Save for later', exact: true }).click();
      await first.waitFor({ state: 'hidden' });
      const other = await fixture.context.newPage();
      await other.goto(`${base}/workouts/logs`);
      await other.getByRole('button', { name: 'Resume workout draft', exact: true }).waitFor();
      return { ...fixture, other, first: await resume(fixture.page), second: await resume(other) };
    }
    async function discard(page, dialog) {
      await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
      await page.getByRole('dialog', { name: 'Discard local workout draft?', exact: true })
        .getByRole('button', { name: 'Discard draft', exact: true }).click();
    }
    const durable = dialog => dialog.getByText('Local only · unsynced · saved on this device', { exact: true }).waitFor();
    const conflict = dialog => dialog.getByText(/This workout draft changed in another tab/).first().waitFor();

    test('same-draft tabs reject stale authoring and discard while preserving newer fields, pending request and timer', async () => {
      const { context, page, other, first, second, state } = await twoEditors();
      try {
        await first.getByLabel('Session name', { exact: true }).fill('Tab A latest');
        await first.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('7');
        await first.getByLabel('Rest seconds', { exact: true }).fill('120');
        await first.getByRole('button', { name: 'Start rest', exact: true }).click();
        await durable(first);
        state.status = 503;
        await first.getByRole('button', { name: 'Log session', exact: true }).click();
        await first.getByText('Save rejected for test', { exact: true }).waitFor();
        await durable(first);
        const [winner] = await stored(page);
        assert.equal(winner.form.name, 'Tab A latest');
        assert.equal(winner.pending.payload.exercises[0].setRecords[0].reps, 7);
        assert.ok(winner.timer.deadline > Date.now());
        await second.getByLabel('Session name', { exact: true }).fill('Tab B unsaved input');
        await conflict(second);
        assert.equal(await second.getByLabel('Session name', { exact: true }).inputValue(), 'Tab B unsaved input');
        assert.equal(await second.getByRole('button', { name: 'Log session', exact: true }).isDisabled(), true);
        assert.deepEqual(await stored(other), [winner]);
        await discard(other, second);
        await other.getByRole('dialog', { name: 'Discard local workout draft?', exact: true }).waitFor({ state: 'hidden' });
        assert.deepEqual(await stored(other), [winner]);
        assert.equal(state.saves.length, 1);
        await second.getByRole('button', { name: 'Reload latest draft', exact: true }).click();
        await other.getByRole('dialog', { name: 'Reload latest workout draft?', exact: true })
          .getByRole('button', { name: 'Reload latest draft', exact: true }).click();
        const recovered = await resume(other);
        assert.equal(await recovered.getByLabel('Session name', { exact: true }).inputValue(), 'Tab A latest');
        assert.equal(await recovered.getByLabel('Session name', { exact: true }).isDisabled(), true);
        assert.equal((await stored(other))[0].timer.deadline, winner.timer.deadline);
        state.status = 200;
        await recovered.getByRole('button', { name: 'Retry save', exact: true }).click();
        await recovered.waitFor({ state: 'hidden' });
        assert.deepEqual(state.saves[1], state.saves[0]);
        assert.deepEqual(await stored(other), []);
      } finally { await context.close(); }
    });

    test('a stale discard before any edit cannot delete another tab’s newer draft', async () => {
      const { context, page, other, first, second } = await twoEditors();
      try {
        await first.getByLabel('Session name', { exact: true }).fill('Keep this newer draft');
        await durable(first);
        const winner = await stored(page);
        await discard(other, second);
        await conflict(second);
        assert.deepEqual(await stored(other), winner);
        assert.equal(await second.getByLabel('Session name', { exact: true }).inputValue(), 'Durable local session');
      } finally { await context.close(); }
    });

    test('simultaneous same-revision edits commit exactly one tab and retain the losing input', async () => {
      const { context, page, first, second } = await twoEditors();
      try {
        await Promise.all([
          first.getByLabel('Session name', { exact: true }).fill('Concurrent A'),
          second.getByLabel('Session name', { exact: true }).fill('Concurrent B'),
        ]);
        await Promise.race([conflict(first), conflict(second)]);
        const [winner] = await stored(page);
        assert.ok(['Concurrent A', 'Concurrent B'].includes(winner.form.name));
        const loser = winner.form.name === 'Concurrent A' ? second : first;
        await conflict(loser);
        assert.equal(await loser.getByLabel('Session name', { exact: true }).inputValue(),
          winner.form.name === 'Concurrent A' ? 'Concurrent B' : 'Concurrent A');
        await durable(winner.form.name === 'Concurrent A' ? first : second);
      } finally { await context.close(); }
    });

    test('timer changes during an in-flight save keep its immutable request and cannot resurrect cleanup', async () => {
      const { context, page, state } = await setup();
      let release;
      try {
        const dialog = await newDraft(page);
        state.holdAck = new Promise(resolve => { release = resolve; });
        const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/workouts/logs');
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await sent;
        const [locked] = await stored(page);
        await dialog.getByLabel('Rest seconds', { exact: true }).fill('90');
        await dialog.getByRole('button', { name: 'Start rest', exact: true }).click();
        await durable(dialog);
        const [timed] = await stored(page);
        assert.deepEqual(timed.pending, locked.pending);
        assert.equal(timed.clientRequestId, locked.clientRequestId);
        assert.equal(timed.timer.durationSeconds, 90);
        assert.ok(timed.timer.deadline > Date.now());
        release();
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await stored(page), []);
        await page.reload();
        await page.getByRole('heading', { name: 'Workout log', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Resume workout draft', exact: true }).count(), 0);
        assert.equal(state.saves.length, 1);
      } finally { release?.(); await context.close(); }
    });

    for (const saved of [false, true]) {
      test(`stale writes cannot resurrect a draft after ${saved ? 'server-save cleanup' : 'confirmed discard'}`, async () => {
        const { context, page, other, first, second, state } = await twoEditors();
        try {
          if (saved) await first.getByRole('button', { name: 'Log session', exact: true }).click();
          else await discard(page, first);
          await first.waitFor({ state: 'hidden' });
          assert.deepEqual(await stored(page), []);
          await second.getByLabel('Session name', { exact: true }).fill('Do not resurrect');
          await conflict(second);
          await discard(other, second);
          await other.getByRole('dialog', { name: 'Discard local workout draft?', exact: true }).waitFor({ state: 'hidden' });
          assert.deepEqual(await stored(other), []);
          assert.equal(await second.getByLabel('Session name', { exact: true }).inputValue(), 'Do not resurrect');
          assert.equal(state.saves.length, saved ? 1 : 0);
        } finally { await context.close(); }
      });
    }

    test('rapid queued input from one editor stays durable and does not conflict with itself', async () => {
      const { context, page } = await setup();
      try {
        const dialog = await newDraft(page);
        const input = dialog.getByLabel('Session name', { exact: true });
        await input.fill('');
        await input.pressSequentially('Rapid input must all survive');
        for (let i = 1; i <= 12; i++) await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill(String(i));
        await durable(dialog);
        assert.equal((await stored(page))[0].form.name, 'Rapid input must all survive');
        assert.equal((await stored(page))[0].form.exercises[0].setRecords[0].reps, '12');
        assert.equal(await dialog.getByRole('button', { name: 'Reload latest draft', exact: true }).count(), 0);
        await page.reload();
        const recovered = await resume(page);
        assert.equal(await recovered.getByLabel('Session name', { exact: true }).inputValue(), 'Rapid input must all survive');
        assert.equal(await recovered.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '12');
      } finally { await context.close(); }
    });

    test('an aborted write is not reported saved and does not advance the editor revision', async () => {
      const { context, page } = await setup();
      try {
        const dialog = await newDraft(page);
        const before = await stored(page);
        await page.evaluate(() => {
          const original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...args) {
            const request = original.apply(this, args);
            if (this.name === 'drafts') {
              IDBObjectStore.prototype.put = original;
              request.addEventListener('success', () => this.transaction.abort());
            }
            return request;
          };
        });
        await dialog.getByLabel('Session name', { exact: true }).fill('Retry after aborted commit');
        await dialog.getByText(/Storage may be full or unavailable/).waitFor();
        assert.equal(await dialog.getByText('Local only · unsynced · saved on this device', { exact: true }).count(), 0);
        assert.deepEqual(await stored(page), before);
        await dialog.getByRole('button', { name: 'Save for later', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await stored(page))[0].form.name, 'Retry after aborted commit');
      } finally { await context.close(); }
    });

    test('empty-slot and same-ID ABA cycles reject old handles, including writes queued after deletion', async () => {
      const { context, page } = await setup();
      try {
        const dialog = await newDraft(page);
        const [sample] = await stored(page);
        await discard(page, dialog);
        await dialog.waitFor({ state: 'hidden' });
        await page.goto(`${base}/draft-storage-fixture`);
        const other = await context.newPage();
        await other.goto(`${base}/draft-storage-fixture`);
        for (const tab of [page, other]) await tab.evaluate(async draft => {
          window.storage = await import('/draft-storage-module.js');
          await window.storage.bindWorkoutDraftAccount(draft.ownerId, localStorage.getItem('vybe.token'));
          window.snapshot = await window.storage.loadWorkoutDraft(draft.ownerId);
          window.sample = draft;
        }, sample);
        await page.evaluate(() => window.storage.persistWorkoutDraft(window.sample, window.snapshot.handle));
        await other.evaluate(async () => {
          window.emptyHandle = window.snapshot.handle;
          window.snapshot = await window.storage.loadWorkoutDraft(window.sample.ownerId);
        });
        assert.deepEqual(await page.evaluate(async () => {
          const result = await Promise.allSettled([
            window.storage.removeWorkoutDraft(window.snapshot.handle),
            window.storage.persistWorkoutDraft(window.sample, window.snapshot.handle),
          ]);
          return result.map(item => item.status === 'fulfilled' ? 'committed' : item.reason instanceof window.storage.WorkoutDraftConflict);
        }), ['committed', true]);
        assert.deepEqual(await stored(page), []);
        const staleResult = await other.evaluate(async () => {
          try { await window.storage.persistWorkoutDraft(window.sample, window.emptyHandle); return 'unexpected success'; }
          catch (error) { return error instanceof window.storage.WorkoutDraftConflict; }
        });
        assert.equal(staleResult, true, 'an old empty observation cannot create after an intervening create/delete');
        await page.evaluate(async () => {
          window.oldHandle = window.snapshot.handle;
          window.snapshot = await window.storage.loadWorkoutDraft(window.sample.ownerId);
          await window.storage.persistWorkoutDraft(window.sample, window.snapshot.handle);
        });
        const recreated = await stored(page);
        assert.equal(recreated[0].draftId, sample.draftId);
        assert.equal(await other.evaluate(async () => {
          try { await window.storage.removeWorkoutDraft(window.snapshot.handle); return false; }
          catch (error) { return error instanceof window.storage.WorkoutDraftConflict; }
        }), true);
        assert.equal(await page.evaluate(async () => {
          try { await window.storage.persistWorkoutDraft(window.sample, window.oldHandle); return false; }
          catch (error) { return error instanceof window.storage.WorkoutDraftConflict; }
        }), true);
        assert.deepEqual(await stored(page), recreated);
      } finally { await context.close(); }
    });

    test('version-1 drafts migrate intact and pre-guard builds cannot reopen storage for writes', async () => {
      const { context, page } = await setup();
      try {
        await newDraft(page);
        const [sample] = await stored(page);
        await page.goto(`${base}/draft-storage-fixture`);
        await page.evaluate(async name => {
          const snapshot = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 2);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction(['drafts', 'meta']);
              const draft = tx.objectStore('drafts').getAll();
              const scope = tx.objectStore('meta').get('scope');
              tx.oncomplete = () => { db.close(); resolve({ draft: draft.result[0], scope: scope.result }); };
            };
          });
          await new Promise((resolve, reject) => {
            const deletion = indexedDB.deleteDatabase(name);
            deletion.onsuccess = resolve; deletion.onerror = () => reject(deletion.error);
          });
          await new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onerror = () => reject(request.error);
            request.onupgradeneeded = () => {
              request.result.createObjectStore('drafts', { keyPath: 'ownerId' }).put(snapshot.draft);
              request.result.createObjectStore('meta').put(snapshot.scope, 'scope');
            };
            request.onsuccess = () => { request.result.close(); resolve(); };
          });
        }, database);
        assert.deepEqual(await page.evaluate(async ownerId => {
          const storage = await import('/draft-storage-module.js');
          await storage.bindWorkoutDraftAccount(ownerId, localStorage.getItem('vybe.token'));
          const found = await storage.loadWorkoutDraft(ownerId);
          await storage.persistWorkoutDraft(found.draft, found.handle);
          return found.draft;
        }, userA._id), sample);
        assert.equal(await page.evaluate(name => new Promise(resolve => {
          const request = indexedDB.open(name, 1);
          request.onerror = () => resolve(request.error.name);
          request.onsuccess = () => { request.result.close(); resolve('unexpected success'); };
        }), database), 'VersionError');
        assert.deepEqual(await stored(page), [sample]);
      } finally { await context.close(); }
    });

    test('logout in one tab purges storage and a still-open editor cannot recreate or send its draft', async () => {
      const { context, page, other, second, state } = await twoEditors();
      try {
        await page.goto(`${base}/settings`);
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.waitForURL('**/login');
        await second.getByLabel('Session name', { exact: true }).fill('Revoked tab input');
        await second.getByRole('button', { name: 'Log session', exact: true }).click();
        await second.getByText(/no longer belongs|account changed|current verified account/).first().waitFor();
        assert.deepEqual(await stored(other), []);
        assert.equal(state.saves.length, 0);
        assert.equal(await second.getByLabel('Session name', { exact: true }).inputValue(), 'Revoked tab input');
      } finally { await context.close(); }
    });
    test('authoring and stable request ID survive navigation and page/process replacement without publishing', async () => {
      const { context, page, state } = await setup();
      try {
        const dialog = await newDraft(page);
        const [before] = await stored(page);
        assert.equal(before.ownerId, userA._id);
        assert.equal(before.form.exercises[0].setRecords[0].completed, true);
        await dialog.getByRole('button', { name: 'Save for later' }).click();
        await page.goto(`${base}/settings`);
        await page.close();
        const reopened = await context.newPage();
        await reopened.goto(`${base}/workouts/logs`);
        await reopened.getByRole('heading', { name: 'Unsynced workout on this device' }).waitFor();
        assert.equal(state.saves.length, 0);
        const restored = await resume(reopened);
        assert.equal(await restored.getByLabel('Exercise 1 set 1 weight', { exact: true }).inputValue(), '40');
        assert.equal((await stored(reopened))[0].clientRequestId, before.clientRequestId);
        await restored.getByRole('button', { name: 'Log session', exact: true }).click();
        await restored.waitFor({ state: 'hidden' });
        assert.equal(state.saves[0].clientRequestId, before.clientRequestId);
        assert.equal((await stored(reopened)).length, 0);
      } finally { await context.close(); }
    });
    test('lost create acknowledgement and reload reuse immutable payload and do not create a second session', async () => {
      const { context, page, state } = await setup();
      try {
        let dialog = await newDraft(page);
        state.loseAck = true;
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
        const [pending] = await stored(page);
        assert.equal(pending.pending.payload.clientRequestId, pending.clientRequestId);
        await page.reload();
        await page.getByRole('button', { name: 'Resume workout draft' }).waitFor();
        assert.equal(state.saves.length, 1);
        dialog = await resume(page);
        assert.equal(await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).isDisabled(), true);
        await dialog.getByRole('button', { name: 'Retry save', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(state.logs.length, 1);
        assert.deepEqual(state.saves[1], state.saves[0]);
        assert.equal((await stored(page)).length, 0);
      } finally { await context.close(); }
    });
    test('rest timer persists deadline, pauses, resets, stops and expires after a clock jump without live-region ticks', async () => {
      const { context, page } = await setup();
      try {
        let dialog = await newDraft(page);
        await dialog.getByLabel('Rest seconds', { exact: true }).fill('120');
        await dialog.getByRole('combobox', { name: 'Rest timer for', exact: true }).click();
        await page.getByRole('option', { name: 'Squat', exact: true }).click();
        await dialog.getByRole('button', { name: 'Start rest', exact: true }).click();
        await dialog.getByText('Rest timer running', { exact: true }).waitFor();
        await dialog.getByText('Local only · unsynced · saved on this device', { exact: true }).waitFor();
        const deadline = (await stored(page))[0].timer.deadline;
        assert.equal((await stored(page))[0].timer.scope, (await stored(page))[0].form.exercises[0].exerciseId);
        assert.ok(deadline > Date.now());
        assert.equal(await dialog.getByRole('timer').getAttribute('aria-live'), 'off');
        await page.reload();
        dialog = await resume(page);
        assert.equal((await stored(page))[0].timer.deadline, deadline);
        await dialog.getByRole('button', { name: 'Pause rest' }).click();
        await dialog.getByText('Rest timer paused', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Reset rest' }).click();
        await dialog.getByRole('button', { name: 'Resume rest' }).click();
        await page.clock.setFixedTime(new Date(deadline + 100000));
        await dialog.getByText('Rest finished', { exact: true }).waitFor();
        assert.equal(await dialog.getByRole('timer').textContent(), '0:00');
        await dialog.getByRole('button', { name: 'Stop rest' }).click();
        await dialog.getByText('Rest timer stopped', { exact: true }).waitFor();
      } finally { await context.close(); }
    });
    test('stale/unknown drafts need explicit recovery or discard, not silent rewriting', async () => {
      const { context, page, state } = await setup();
      try {
        await newDraft(page);
        await page.goto(`${base}/settings`);
        await mutateStored(page, { updatedAt: Date.now() - 8 * 86400000 });
        await page.goto(`${base}/workouts/logs`);
        await page.getByText(/This draft is over 7 days old/).waitFor();
        assert.equal(state.saves.length, 0);
        await mutateStored(page, { version: 999 });
        await page.reload();
        await page.getByText(/unsupported or invalid format/).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Resume workout draft' }).count(), 0);
        await page.getByRole('button', { name: 'Discard local draft', exact: true }).click();
        await page.getByRole('dialog', { name: 'Discard local workout draft?' }).getByRole('button', { name: 'Discard draft' }).click();
        assert.equal((await stored(page)).length, 0);
        assert.equal(state.saves.length, 0);
      } finally { await context.close(); }
    });
    test('storage unavailable and quota failures are honest and prevent network publication', async () => {
      const unavailable = await setup({ unavailable: true });
      try {
        await unavailable.page.goto(`${base}/workouts/logs?log=1`);
        await unavailable.page.getByText(/draft storage is unavailable/).first().waitFor();
        assert.equal(unavailable.state.saves.length, 0);
      } finally { await unavailable.context.close(); }
      const { context, page, state } = await setup();
      try {
        const dialog = await newDraft(page);
        await page.evaluate(() => {
          IDBObjectStore.prototype.put = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
        });
        await dialog.getByLabel('Session name', { exact: true }).fill('Still on screen');
        await dialog.getByText(/Storage may be full or unavailable/).waitFor();
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        assert.equal(state.saves.length, 0);
        assert.equal(await dialog.getByLabel('Session name', { exact: true }).inputValue(), 'Still on screen');
      } finally { await context.close(); }
    });
    test('account switch and cross-tab token changes purge drafts and cannot send under the new owner', async () => {
      const { context, page, state } = await setup();
      try {
        const dialog = await newDraft(page);
        const otherTab = await context.newPage();
        await otherTab.goto(`${base}/settings`);
        state.user = userB;
        await otherTab.evaluate(() => localStorage.setItem('vybe.token', 'session-b'));
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.getByText(/no longer belongs|account changed/).first().waitFor();
        assert.equal(state.saves.length, 0);
        await page.reload();
        await page.getByRole('heading', { name: 'Workout log', exact: true }).waitFor();
        assert.equal((await stored(page)).length, 0);
        assert.equal(await page.getByRole('button', { name: 'Resume workout draft' }).count(), 0);
      } finally { await context.close(); }
    });
    test('explicit discard cleans the unsynced draft and timer without deleting server records', async () => {
      const { context, page, state } = await setup();
      try {
        const dialog = await newDraft(page);
        await dialog.getByRole('button', { name: 'Start rest', exact: true }).click();
        await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
        await page.getByRole('dialog', { name: 'Discard local workout draft?' }).getByRole('button', { name: 'Discard draft' }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await stored(page)).length, 0);
        assert.equal(state.saves.length, 0);
      } finally { await context.close(); }
    });
    test('verified save with failed local deletion offers cleanup retry without another POST', async () => {
      const { context, page, state } = await setup();
      try {
        const dialog = await newDraft(page);
        await page.evaluate(() => {
          const original = IDBObjectStore.prototype.delete;
          IDBObjectStore.prototype.delete = function (...args) {
            IDBObjectStore.prototype.delete = original;
            throw new DOMException('Disk unavailable', 'UnknownError');
          };
        });
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.getByRole('button', { name: 'Retry local cleanup', exact: true }).waitFor();
        assert.equal(state.saves.length, 1);
        assert.equal((await stored(page)).length, 1);
        await dialog.getByRole('button', { name: 'Retry local cleanup', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(state.saves.length, 1);
        assert.equal((await stored(page)).length, 0);
      } finally { await context.close(); }
    });
    test('invalid session metrics remain in the draft instead of being silently saved as zero', async () => {
      const { context, page, state } = await setup();
      try {
        const dialog = await newDraft(page);
        await dialog.getByLabel('Duration (min)', { exact: true }).fill('-1');
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.getByText('Enter a duration from 0 to 1440 minutes.', { exact: true }).waitFor();
        assert.equal(state.saves.length, 0);
        await dialog.getByText('Local only · unsynced · saved on this device', { exact: true }).waitFor();
        assert.equal((await stored(page))[0].form.duration, '-1');
        assert.equal((await stored(page))[0].form.exercises[0].setRecords.length, 1);
      } finally { await context.close(); }
    });
    for (const deleting of [false, true]) {
      test(`${deleting ? 'account deletion' : 'logout'} purges local authoring and prevents recovery on a later sign-in`, async () => {
        const { context, page, state } = await setup();
        try {
          await newDraft(page);
          await page.goto(`${base}/settings`);
          if (deleting) {
            await page.getByLabel('Type DELETE MY ACCOUNT to confirm', { exact: true }).fill('DELETE MY ACCOUNT');
            await page.getByRole('button', { name: 'Permanently delete my account', exact: true }).click();
            await page.getByRole('dialog', { name: 'Delete your account?', exact: true })
              .getByRole('button', { name: 'Delete account', exact: true }).click();
          } else await page.getByRole('button', { name: 'Sign out', exact: true }).click();
          await page.waitForURL('**/login');
          await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
          assert.equal(await page.evaluate(() => localStorage.getItem('vybe.token')), null);
          assert.equal((await stored(page)).length, 0);
          await page.evaluate(() => localStorage.setItem('vybe.token', 'new-session-a'));
          await page.goto(`${base}/workouts/logs`);
          await page.getByRole('heading', { name: 'Workout log', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Resume workout draft' }).count(), 0);
          assert.equal(state.saves.length, 0);
        } finally { await context.close(); }
      });
    }
  });
}
