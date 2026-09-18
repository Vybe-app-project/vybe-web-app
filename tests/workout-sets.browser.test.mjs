import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = process.env.VYBE_PLAYWRIGHT;
const user = { _id: 'sets-owner', username: 'athlete', fullName: 'Test Athlete' };
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const fixture = () => ({
  _id: 'log-1', date: new Date().toISOString(), name: 'Strength session',
  type: 'strength', revision: 3, setRecordsVersion: 1,
  exercises: [{ name: 'Squat', exerciseId: 'ex-1', sets: 2, reps: 5, weight: 70, setRecords: [
    { id: 's1', reps: 5, weight: 100, weightUnit: 'kg', completed: true },
    { id: 's2', reps: 5, weight: 100, weightUnit: 'lb', completed: false },
  ] }],
});
if (!playwright) {
  test('per-set logging in a browser', { skip: 'Build first and set VYBE_PLAYWRIGHT to an existing Playwright index.mjs with Chromium.' }, () => {});
} else {
  describe('per-set logging in the built consumer app', { timeout: 90_000 }, () => {
    let browser, server, base;
    before(async () => {
      const { chromium } = await import(pathToFileURL(path.resolve(playwright)).href);
      browser = await chromium.launch({ executablePath: process.env.VYBE_CHROMIUM_EXECUTABLE });
      const dist = path.join(root, 'dist');
      assert.ok(fs.existsSync(path.join(dist, 'index.html')));
      server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const target = path.resolve(dist, `.${decodeURIComponent(pathname)}`);
        if (!target.startsWith(`${dist}${path.sep}`)) { response.writeHead(400); response.end(); return; }
        const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(response);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => {
      await browser?.close();
      if (server) await new Promise(resolve => server.close(resolve));
    });
    const setup = async ({ logs = [fixture()], dark = false } = {}) => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, colorScheme: dark ? 'dark' : 'light' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('vybe.token', 'fixture-session'));
      const state = { logs, saves: [], deletes: [], status: 200 };
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        let body = { data: [], posts: [], notifications: [], rooms: [] };
        let status = 200;
        if (url.pathname === '/api/users/me') body = { user };
        if (url.pathname === '/api/workouts/logs' && method === 'GET') {
          body = { workouts: state.logs, total: state.logs.length, page: 1, hasNextPage: false };
        } else if (url.pathname.includes('/api/workouts/logs') && ['POST', 'PATCH'].includes(method)) {
          const payload = route.request().postDataJSON();
          state.saves.push({ method, payload });
          status = state.status;
          if (status >= 400) body = { message: status === 409 ? 'This log changed. Reload it before saving.' : 'Temporarily unavailable' };
          else {
            const workout = { ...payload, user: user._id, _id: method === 'PATCH' ? url.pathname.split('/').pop() : 'saved-log', revision: (payload.expectedRevision ?? 0) + 1 };
            state.logs = [workout];
            body = { workout };
            status = method === 'POST' ? 201 : 200;
          }
        } else if (url.pathname.includes('/api/workouts/logs/') && method === 'DELETE') {
          state.deletes.push(url.pathname);
          state.logs = [];
          body = { message: 'Workout log deleted' };
        } else if (url.pathname.includes('/workouts/workout/info/single-workout/')) {
          body = { data: { _id: 'template-1', title: 'Library plan', category: 'strength', exercises: [{ name: 'Press', sets: 3, reps: 8, weight: 40 }] } };
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      return { context, page, state, errors };
    };
    const edit = async page => {
      await page.getByRole('button', { name: 'Options for Strength session' }).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit session' }).waitFor();
    };

    for (const dark of [false, true]) {
      test(`edit/remove/add/complete sets and retry retain input (${dark ? 'dark' : 'light'})`, async () => {
        const { context, page, state, errors } = await setup({ dark });
        try {
          await page.goto(`${base}/workouts/logs`);
          await edit(page);
          const dialog = page.getByRole('dialog');
          await dialog.getByText('Previously: 5 reps × 100 kg · completed').waitFor();
          await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('6');
          await dialog.getByRole('button', { name: 'Remove exercise 1 set 2', exact: true }).click();
          await dialog.getByRole('button', { name: 'Add set to exercise 1', exact: true }).click();
          await dialog.getByLabel('Exercise 1 set 2 reps', { exact: true }).fill('8');
          await dialog.getByLabel('Exercise 1 set 2 weight', { exact: true }).fill('120');
          await dialog.getByRole('combobox', { name: 'Exercise 1 set 2 unit', exact: true }).click();
          await page.getByRole('option', { name: 'lb', exact: true }).click();
          await dialog.getByRole('checkbox', { name: 'Exercise 1 set 2 completed', exact: true }).check();
          state.status = 503;
          await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
          await dialog.getByText('Temporarily unavailable', { exact: true }).waitFor();
          assert.equal(await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '6');
          assert.equal(await dialog.getByRole('checkbox', { name: 'Exercise 1 set 2 completed', exact: true }).isChecked(), true);
          assert.equal(state.saves[0].payload.expectedRevision, 3);
          assert.equal(state.saves[0].payload.setRecordsVersion, 1);
          assert.equal(state.saves[0].payload.exercises[0].setRecords[0].id, 's1');
          assert.notEqual(state.saves[0].payload.exercises[0].setRecords[1].id, 's2');
          assert.equal(state.saves[0].payload.exercises[0].setRecords[1].weightUnit, 'lb');
          assert.equal(state.saves[0].payload.exercises[0].sets, undefined);
          state.status = 200;
          await dialog.getByRole('button', { name: 'Retry save', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' });
          assert.deepEqual(state.saves[1].payload, state.saves[0].payload);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
    test('legacy edits keep aggregates and a new template session can explicitly start blank sets', async () => {
      const legacy = { ...fixture(), setRecordsVersion: undefined, exercises: [{ name: 'Carry', sets: 3, reps: 8, weight: 20, distance: 0.2, notes: 'Legacy note' }] };
      const { context, page, state } = await setup({ logs: [legacy] });
      try {
        await page.goto(`${base}/workouts/logs`);
        await edit(page);
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/Aggregate record. Individual set history was not recorded/).waitFor();
        await dialog.getByLabel('Exercise 1 total sets', { exact: true }).fill('4');
        await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(state.saves[0].payload.exercises[0].setRecords, undefined);
        assert.equal(state.saves[0].payload.setRecordsVersion, undefined);
        assert.equal(state.saves[0].payload.exercises[0].sets, 4);
        assert.equal(state.saves[0].payload.exercises[0].distance, 0.2);
        await page.goto(`${base}/workouts/logs?log=1&from=template-1`);
        await page.getByRole('dialog', { name: 'Log a session' }).waitFor();
        assert.equal(await dialog.getByLabel('Exercise 1 name', { exact: true }).inputValue(), 'Press');
        await dialog.getByRole('button', { name: 'Record individual sets for exercise 1' }).click();
        assert.equal(await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '0');
        assert.equal(await dialog.getByRole('checkbox', { name: 'Exercise 1 set 1 completed' }).isChecked(), false);
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(state.saves[1].method, 'POST');
        assert.equal(state.saves[1].payload.setRecordsVersion, 1);
      } finally { await context.close(); }
    });
    test('log-again has prior values, fresh IDs and incomplete sets, with invalid and conflict errors preserved', async () => {
      const { context, page, state } = await setup();
      try {
        await page.goto(`${base}/workouts/logs`);
        await page.getByRole('button', { name: 'Options for Strength session' }).click();
        await page.getByRole('menuitem', { name: /Log again/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Log a session' });
        await dialog.waitFor();
        await dialog.getByText('Previously: 5 reps × 100 kg · completed').waitFor();
        assert.equal(await dialog.getByRole('checkbox', { name: 'Exercise 1 set 1 completed' }).isChecked(), false);
        await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('-1');
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.getByText('Set reps: enter a whole number from 0 to 10000.').waitFor();
        assert.equal(state.saves.length, 0);
        await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('7');
        state.status = 409;
        await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
        await dialog.getByText('This log changed. Reload it before saving.', { exact: true }).waitFor();
        assert.equal(await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '7');
        assert.notEqual(state.saves[0].payload.exercises[0].setRecords[0].id, 's1');
        assert.equal(state.saves[0].payload.exercises[0].setRecords[0].completed, false);
      } finally { await context.close(); }
    });
    test('delete still requires confirmation and removes the session from history', async () => {
      const { context, page, state } = await setup();
      try {
        await page.goto(`${base}/workouts/logs`);
        await page.getByRole('button', { name: 'Options for Strength session' }).click();
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete session?' });
        await dialog.waitFor();
        assert.equal(state.deletes.length, 0);
        await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByText('No sessions yet', { exact: true }).waitFor();
        assert.deepEqual(state.deletes, ['/api/workouts/logs/log-1']);
      } finally { await context.close(); }
    });
    test('an edit conflict preserves the draft while refreshing history for a deliberate reopen', async () => {
      const { context, page, state } = await setup();
      try {
        await page.goto(`${base}/workouts/logs`);
        await edit(page);
        const dialog = page.getByRole('dialog', { name: 'Edit session', exact: true });
        await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('7');
        state.logs = [{ ...fixture(), revision: 4 }];
        state.status = 409;
        const refreshed = page.waitForResponse(response => response.url().includes('/api/workouts/logs') && response.request().method() === 'GET');
        await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
        await dialog.getByText('This log changed. Reload it before saving.', { exact: true }).waitFor();
        await refreshed;
        assert.equal(state.saves[0].payload.exercises[0].setRecords[0].reps, 7);
        assert.equal(await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '7');
        assert.equal(state.saves[0].payload.expectedRevision, 3);
        await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
        await page.getByRole('dialog', { name: 'Discard local workout draft?', exact: true })
          .getByRole('button', { name: 'Discard draft', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await edit(page);
        assert.equal(await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '5');
        state.status = 200;
        await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(state.saves[1].payload.expectedRevision, 4);
      } finally { await context.close(); }
    });
  });
}
