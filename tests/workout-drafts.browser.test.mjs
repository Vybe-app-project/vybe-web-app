import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = process.env.VYBE_PLAYWRIGHT;
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const userA = { _id: 'owner-a', username: 'athlete-a' };
const userB = { _id: 'owner-b', username: 'athlete-b' };
const database = 'vybe-workout-drafts';
const stored = page => page.evaluate(name => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 1);
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
  const request = indexedDB.open(name, 1);
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
      server = http.createServer((req, res) => {
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
      const state = { saves: [], logs: [], requests: new Map(), loseAck: false, user: userA, status: 200 };
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
