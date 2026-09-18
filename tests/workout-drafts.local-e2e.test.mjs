import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = process.env.VYBE_TEST_BACKEND;
const playwright = process.env.VYBE_PLAYWRIGHT;
if (!backend || !playwright) {
  test('local backend + persistent Chromium lost-ack recovery', {
    skip: 'Set VYBE_TEST_BACKEND to the isolated backend and VYBE_PLAYWRIGHT to installed Chromium tooling.',
  }, () => {});
} else {
  test('local rs0 API + actual browser process restart recover one committed workout after a lost acknowledgement', { timeout: 180000 }, async () => {
    const expectedBackend = path.resolve(root, '../aaa-a656-workout-drafts-backend');
    assert.equal(path.resolve(backend), expectedBackend, 'Only the isolated package backend may be used');
    // The existing backend helper drops this one local database; never inherit
    // an operator or production connection string into this test.
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27018/vybe_aaa_a656_drafts_browser?replicaSet=rs0';
    process.env.VYBE_TEST_DB = 'vybe_aaa_a656_drafts_browser';
    process.env.JWT_SECRET = 'local-browser-test-only';
    const require = createRequire(path.join(expectedBackend, 'package.json'));
    const setup = require(path.join(expectedBackend, 'tests/setup.js'));
    const { chromium } = await import(pathToFileURL(playwright).href);
    const profile = path.join(root, '.draft-validation', 'local-e2e-profile');
    await mkdir(profile, { recursive: true });
    let context, server, app;
    const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    try {
      const dist = path.join(root, 'dist');
      server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/')) { app(req, res); return; }
        const target = path.resolve(dist, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
        if (!target.startsWith(`${dist}${path.sep}`)) { res.writeHead(400); res.end(); return; }
        const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      process.env.CORS_ORIGINS = origin;
      app = require(path.join(expectedBackend, 'app.js'));
      await setup.connect();
      const { authedToken } = require(path.join(expectedBackend, 'tests/helpers.js'));
      const token = await authedToken({ email: 'draft-local-e2e@test.dev', username: 'draft-local-e2e' });
      const WorkoutLog = require(path.join(expectedBackend, 'models/WorkoutLog.js'));
      const launch = () => chromium.launchPersistentContext(profile, {
        headless: true, serviceWorkers: 'block', viewport: { width: 390, height: 844 },
        executablePath: process.env.VYBE_CHROMIUM_EXECUTABLE,
      });
      context = await launch();
      let page = await context.newPage();
      await page.goto(`${origin}/login`);
      await page.evaluate(value => localStorage.setItem('vybe.token', value), token);
      await page.goto(`${origin}/workouts/logs?log=1`);
      let dialog = page.getByRole('dialog', { name: 'Log a session', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Session name', { exact: true }).fill('Local process recovery');
      await dialog.getByLabel('Exercise 1 name', { exact: true }).fill('Local squat');
      await dialog.getByLabel('Exercise 1 set 1 reps', { exact: true }).fill('5');
      await dialog.getByLabel('Exercise 1 set 1 weight', { exact: true }).fill('20');
      await dialog.getByRole('checkbox', { name: 'Exercise 1 set 1 completed', exact: true }).check();
      let originalPayload;
      await page.route('**/api/workouts/logs', async route => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        originalPayload = route.request().postDataJSON();
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort('failed');
      });
      await dialog.getByRole('button', { name: 'Log session', exact: true }).click();
      await dialog.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
      assert.equal(await WorkoutLog.countDocuments({ name: 'Local process recovery' }), 1);
      await context.close();
      context = await launch();
      page = await context.newPage();
      let replayPayload;
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/workouts/logs') replayPayload = request.postDataJSON();
      });
      await page.goto(`${origin}/workouts/logs`);
      await page.getByRole('button', { name: 'Resume workout draft', exact: true }).waitFor();
      assert.equal(replayPayload, undefined, 'Recovery must not auto-publish');
      await page.getByRole('button', { name: 'Resume workout draft', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Log a session', exact: true });
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/workouts/logs');
      await dialog.getByRole('button', { name: 'Retry save', exact: true }).click();
      assert.equal((await responsePromise).status(), 200);
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(replayPayload, originalPayload);
      assert.equal(await WorkoutLog.countDocuments({ name: 'Local process recovery' }), 1);
      const count = await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('vybe-workout-drafts', 1);
        request.onerror = () => reject(new Error('IDB unavailable'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('drafts');
          const get = tx.objectStore('drafts').count();
          get.onsuccess = () => resolve(get.result);
          tx.oncomplete = () => db.close();
        };
      }));
      assert.equal(count, 0);
    } finally {
      await context?.close();
      if (server) await new Promise(resolve => server.close(resolve));
      await setup.disconnect();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
