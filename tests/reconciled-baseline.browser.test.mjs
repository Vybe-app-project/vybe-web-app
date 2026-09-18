import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const playwright = process.env.VYBE_PLAYWRIGHT;
const user = { _id: 'reconcile-user', username: 'fixture', fullName: 'Fixture Athlete' };
const shareToken = 'ab'.repeat(32);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

if (!playwright) {
  test('reconciled baseline in a browser', { skip: 'Build first and set VYBE_PLAYWRIGHT to an existing Playwright index.mjs with Chromium.' }, () => {});
} else {
  describe('reconciled main/session baseline in the built app', { timeout: 90_000 }, () => {
    let browser, server, base;
    before(async () => {
      assert.ok(fs.existsSync(path.join(dist, 'sw.js')), 'build the integrated app before testing');
      const { chromium } = await import(pathToFileURL(path.resolve(playwright)).href);
      browser = await chromium.launch({ executablePath: process.env.VYBE_CHROMIUM_EXECUTABLE });
      server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const target = path.resolve(dist, `.${decodeURIComponent(pathname)}`);
        if (target !== dist && !target.startsWith(`${dist}${path.sep}`)) { response.writeHead(400); response.end(); return; }
        const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(response);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(base)).status, 200);
    });
    after(async () => {
      await browser?.close();
      if (server) await new Promise(resolve => server.close(resolve));
    });

    async function setup({ status = 200, handheld = false, sharedStatus = 200 } = {}) {
      const context = await browser.newContext({
        serviceWorkers: 'block', viewport: { width: 390, height: 844 },
        ...(handheld ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } : {}),
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const state = {
        status, sharedStatus, requests: [], saves: [], errors: [], external: [],
        workout: {
          _id: 'template-1', title: 'Original plan', description: 'Original description',
          category: 'strength', level: 'beginner', duration: 30, caloriesBurned: 200,
          hashtags: ['original'], isPublic: true, createdBy: user,
          exercises: [{ name: 'Press', sets: 3, reps: 8, weight: 40, duration: 5, notes: 'Controlled' }],
        },
      };
      page.on('pageerror', error => state.errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('vybe.token', 'fixture-session'));
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) {
          state.external.push(url.origin);
          await route.abort();
          return;
        }
        if (!url.pathname.startsWith('/api/')) {
          if (url.pathname.startsWith('/socket.io/')) await route.abort();
          else await route.continue();
          return;
        }
        const method = route.request().method();
        state.requests.push({ path: url.pathname, method });
        let status = 200;
        let body = { data: [], posts: [], notifications: [], rooms: [] };
        if (url.pathname === '/api/users/me') {
          status = state.status;
          body = status === 200 ? { user } : { message: 'Fixture session unavailable' };
        } else if (url.pathname === '/api/auth/login') {
          body = { user, token: 'fixture-session-renewed' };
        } else if (url.pathname === `/api/meals/shared/${shareToken}`) {
          status = state.sharedStatus;
          body = status === 200 ? {
            meal: {
              _id: 'private-meal', food_name: 'Shared recovery bowl', meal_type: 'lunch',
              user: { _id: 'other-user', fullName: 'Fixture Sender' },
              timestamp: '2026-09-18T12:00:00Z', nutrition: { calories: 420, protein: 30, carbs: 50, fat: 12 },
            },
            expiresAt: '2026-09-25T12:00:00Z',
          } : { message: 'This share belongs to someone else' };
        } else if (url.pathname === '/api/workouts/workout/info/single-workout/template-1') {
          body = { data: state.workout };
        } else if (url.pathname === '/api/workouts/update/template-1' && method === 'PUT') {
          const payload = route.request().postDataJSON();
          state.saves.push({ path: url.pathname, method, payload });
          state.workout = { ...state.workout, ...payload };
          body = { data: state.workout };
        } else if (url.pathname === '/api/workouts/logs') {
          if (method === 'POST') {
            const payload = route.request().postDataJSON();
            state.saves.push({ path: url.pathname, method, payload });
            status = 201;
            body = { workout: { ...payload, user: user._id, _id: 'recorded-session', revision: 1 } };
          } else {
            body = { workouts: [], total: 0, page: 1, hasNextPage: false };
          }
        } else if (url.pathname === '/api/gyms/place-search') {
          assert.equal(url.searchParams.get('kind'), 'gym');
          body = { results: [{ place_id: 'fixture-gym', name: 'Recovery Gym', photoUrl: '/api/gyms/place-photo/fixture' }] };
        } else if (url.pathname === '/api/gyms/place-photo/fixture') {
          status = 404;
          body = { message: 'Fixture photo unavailable' };
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      return { context, page, state };
    }

    for (const status of [401, 503]) {
      for (const handheld of [false, true]) {
        test(`meal token handoff survives ${status} session verification (${handheld ? 'phone' : 'desktop'})`, async () => {
          const { context, page, state } = await setup({ status, handheld });
          try {
            await page.goto(`${base}/open.html?type=meal&id=${shareToken}`);
            if (handheld) {
              await page.getByRole('link', { name: 'Continue on the web', exact: true }).click();
            }
            if (status === 503) {
              await page.getByRole('heading', { name: 'Unable to verify your sign-in', exact: true }).waitFor();
              assert.equal(await page.evaluate(() => localStorage.getItem('vybe.token')), 'fixture-session');
              assert.equal(new URL(page.url()).pathname, `/meals/shared/${shareToken}`);
            } else {
              await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
              assert.equal(await page.evaluate(() => localStorage.getItem('vybe.token')), null);
            }
            assert.equal(state.requests.some(request => request.path.startsWith('/api/meals/')), false);
            state.status = 200;
            if (status === 503) {
              await page.getByRole('button', { name: 'Try again', exact: true }).click();
            } else {
              await page.getByLabel('Email', { exact: true }).fill('fixture@example.invalid');
              await page.getByLabel('Password', { exact: true }).fill('fixture-only-password');
              await page.getByRole('button', { name: 'Sign in', exact: true }).click();
            }
            await page.getByRole('heading', { name: 'Shared recovery bowl', exact: true }).first().waitFor();
            assert.equal(new URL(page.url()).pathname, `/meals/shared/${shareToken}`);
            assert.ok(state.requests.some(request => request.path === `/api/meals/shared/${shareToken}`));
            assert.equal(state.requests.some(request => request.path === `/api/meals/${shareToken}` || request.path === '/api/meals/private-meal'), false);
            assert.equal(await page.getByRole('link', { name: 'Open in my meals', exact: true }).count(), 0);
            assert.deepEqual(state.errors, []);
            assert.deepEqual(state.external, []);
          } finally { await context.close(); }
        });
      }
    }

    test('recipient-restricted shared meals show denial without falling back to private meal IDs', async () => {
      const { context, page, state } = await setup({ sharedStatus: 403 });
      try {
        await page.goto(`${base}/open.html?type=meal&id=${shareToken}`);
        await page.getByText('This meal was shared with someone else', { exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Shared recovery bowl', exact: true }).count(), 0);
        assert.deepEqual(state.requests.filter(request => request.path.startsWith('/api/meals/')), [
          { path: `/api/meals/shared/${shareToken}`, method: 'GET' },
        ]);
        assert.deepEqual(state.errors, []);
      } finally { await context.close(); }
    });

    test('full template edits seed the per-set logger without converting planned totals to completed sets', async () => {
      const { context, page, state } = await setup();
      try {
        await page.goto(`${base}/workouts/template-1`);
        await page.getByRole('button', { name: 'More options for Original plan', exact: true }).first().click();
        await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit workout' });
        await dialog.getByLabel('Title', { exact: true }).fill('Reconciled plan');
        await dialog.getByLabel('Description', { exact: true }).fill('Updated prescription');
        await dialog.getByRole('combobox', { name: 'Category', exact: true }).click();
        await page.getByRole('option', { name: 'Cardio', exact: true }).click();
        await dialog.getByRole('combobox', { name: 'Level', exact: true }).click();
        await page.getByRole('option', { name: 'Advanced', exact: true }).click();
        await dialog.getByLabel('Duration (min)', { exact: true }).fill('42');
        await dialog.getByLabel('Calories (kcal)', { exact: true }).fill('321');
        await dialog.getByLabel('Hashtags', { exact: true }).fill('#Reconciled, strength');
        await dialog.getByRole('checkbox', { name: 'Share publicly' }).uncheck();
        await dialog.getByLabel('Exercise 1', { exact: true }).fill('Loaded carry');
        await dialog.getByLabel('Sets', { exact: true }).fill('4');
        await dialog.getByLabel('Reps', { exact: true }).fill('9');
        await dialog.getByLabel('Weight (kg)', { exact: true }).fill('25');
        await dialog.getByLabel('Minutes', { exact: true }).fill('7');
        await dialog.getByLabel('Notes', { exact: true }).fill('Steady pace');
        await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(state.saves[0], {
          path: '/api/workouts/update/template-1', method: 'PUT',
          payload: {
            title: 'Reconciled plan', description: 'Updated prescription', category: 'cardio',
            level: 'advanced', duration: 42, caloriesBurned: 321, hashtags: ['reconciled', 'strength'],
            isPublic: false, exercises: [{ name: 'Loaded carry', sets: 4, reps: 9, weight: 25, duration: 7, notes: 'Steady pace' }],
          },
        });
        await page.getByRole('heading', { name: 'Reconciled plan', exact: true }).first().waitFor();
        await page.getByRole('button', { name: 'Log this workout', exact: true }).click();
        const logger = page.getByRole('dialog', { name: 'Log a session' });
        await logger.waitFor();
        assert.equal(await logger.getByLabel('Session name', { exact: true }).inputValue(), 'Reconciled plan');
        assert.match(await logger.getByRole('combobox', { name: 'Type', exact: true }).innerText(), /Cardio/);
        for (const [label, expected] of [
          ['Duration (min)', '42'], ['Calories (kcal)', '321'], ['Exercise 1 name', 'Loaded carry'],
          ['Exercise 1 total sets', '4'], ['Exercise 1 reps per set', '9'], ['Exercise 1 weight', '25'],
          ['Exercise 1 duration (min)', '7'], ['Exercise 1 notes', 'Steady pace'],
        ]) assert.equal(await logger.getByLabel(label, { exact: true }).inputValue(), expected);
        await logger.getByRole('button', { name: 'Record individual sets for exercise 1', exact: true }).click();
        assert.equal(await logger.getByLabel('Exercise 1 set 1 reps', { exact: true }).inputValue(), '0');
        assert.equal(await logger.getByLabel('Exercise 1 set 1 weight', { exact: true }).inputValue(), '0');
        assert.equal(await logger.getByRole('checkbox', { name: 'Exercise 1 set 1 completed', exact: true }).isChecked(), false);
        await logger.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('9');
        await logger.getByLabel('Exercise 1 set 1 weight', { exact: true }).fill('25');
        await logger.getByRole('checkbox', { name: 'Exercise 1 set 1 completed', exact: true }).check();
        await logger.getByRole('button', { name: 'Log session', exact: true }).click();
        await logger.waitFor({ state: 'hidden' });
        const saved = state.saves[1];
        assert.equal(saved.path, '/api/workouts/logs');
        assert.equal(saved.method, 'POST');
        assert.equal(saved.payload.name, 'Reconciled plan');
        assert.equal(saved.payload.type, 'cardio');
        assert.equal(saved.payload.duration, 42);
        assert.equal(saved.payload.caloriesBurned, 321);
        assert.equal(saved.payload.setRecordsVersion, 1);
        assert.equal(saved.payload.exercises[0].sets, undefined);
        assert.equal(saved.payload.exercises[0].duration, 7);
        assert.equal(saved.payload.exercises[0].notes, 'Steady pace');
        const set = saved.payload.exercises[0].setRecords[0];
        assert.ok(set.id);
        assert.deepEqual({ ...set, id: undefined }, { id: undefined, reps: 9, weight: 25, weightUnit: 'kg', completed: true });
        assert.deepEqual(state.errors, []);
        assert.deepEqual(state.external, []);
      } finally { await context.close(); }
    });

    test('place pictures fall back after a network error without losing the newer gym result', async () => {
      const { context, page, state } = await setup();
      try {
        await page.goto(`${base}/gyms`);
        await page.getByRole('tab', { name: 'Places', exact: true }).click();
        await page.getByLabel('Search places', { exact: true }).fill('Recovery Gym');
        const place = page.getByRole('listitem').filter({ hasText: 'Recovery Gym' });
        await place.getByText('RG', { exact: true }).waitFor();
        assert.equal(await place.locator('img').count(), 0);
        assert.ok(await place.getByRole('link', { name: 'Open Recovery Gym in Maps', exact: true }).isVisible());
        assert.ok(state.requests.some(request => request.path === '/api/gyms/place-photo/fixture'));
        assert.deepEqual(state.errors, []);
        assert.deepEqual(state.external, []);
      } finally { await context.close(); }
    });
  });
}
