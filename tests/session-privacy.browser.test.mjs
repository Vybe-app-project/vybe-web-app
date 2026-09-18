import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightPath = process.env.VYBE_PLAYWRIGHT;
const dist = path.join(root, 'dist');
const user = { _id: 'browser-test-user', username: 'athlete', fullName: 'Test Athlete' };
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

if (!playwrightPath) {
  test('session recovery and private-cache migration in a browser', {
    skip: 'build the app, then set VYBE_PLAYWRIGHT to an existing Playwright index.mjs with Chromium',
  }, () => {});
} else {
  describe('session recovery and private-cache migration in a browser', { timeout: 60_000 }, () => {
    let browser;
    let server;
    let base;

    before(async () => {
      assert.ok(fs.existsSync(path.join(dist, 'sw.js')), 'run npm run build before the browser checks');
      const { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href);
      browser = await chromium.launch({ executablePath: process.env.VYBE_CHROMIUM_EXECUTABLE });
      server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        response.setHeader('Cache-Control', 'no-store');
        if (pathname === '/cache-fixture') {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end('<!doctype html><title>Private cache fixture</title><p>Fixture</p>');
          return;
        }
        if (pathname === '/legacy-worker.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript' });
          response.end(`
            self.addEventListener('install', () => self.skipWaiting());
            self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
            self.addEventListener('fetch', (event) => {
              if (/\\/(api|uploads)\\//.test(new URL(event.request.url).pathname)) {
                event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
              }
            });
          `);
          return;
        }
        if (pathname === '/api/private' || pathname === '/uploads/private.txt') {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end('private-network-response');
          return;
        }
        if (pathname.startsWith('/api/')) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: [], posts: [], notifications: [], rooms: [] }));
          return;
        }
        const requested = path.resolve(dist, `.${decodeURIComponent(pathname)}`);
        if (!requested.startsWith(`${dist}${path.sep}`)) {
          response.writeHead(400);
          response.end();
          return;
        }
        const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
        fs.createReadStream(file).pipe(response);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
    });

    test('a real protected route preserves sign-in on 503 and recovers through Try again', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem('vybe.token', 'fixture-session'));
        let available = false;
        await page.route('**/api/users/me', (route) => route.fulfill({
          status: available ? 200 : 503,
          contentType: 'application/json',
          body: JSON.stringify(available ? { user } : { message: 'Temporarily unavailable' }),
        }));
        await page.goto(`${base}/settings`);
        await page.getByRole('heading', { name: 'Unable to verify your sign-in', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('vybe.token')), 'fixture-session');
        assert.equal(new URL(page.url()).pathname, '/settings');
        assert.ok(await page.getByRole('link', { name: 'Contact support', exact: true }).isVisible());
        available = true;
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await page.getByRole('heading', { name: 'Settings', exact: true }).first().waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Unable to verify your sign-in', exact: true }).count(), 0);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    for (const status of [401, 503]) {
    test(`public support remains reachable when session verification returns ${status}`, async () => {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem('vybe.token', 'fixture-session'));
        await page.route('**/api/users/me', (route) => route.fulfill({
          status, contentType: 'application/json', body: '{}',
        }));
        await page.goto(`${base}/support`);
        await page.getByRole('heading', { name: 'Support', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('vybe.token')), status === 401 ? null : 'fixture-session');
        assert.equal(new URL(page.url()).pathname, '/support');
        assert.equal(await page.getByRole('heading', { name: 'Unable to verify your sign-in', exact: true }).count(), 0);
      } finally {
        await context.close();
      }
    });
    }

    test('an expired session on a protected route goes to sign-in through the route guard', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem('vybe.token', 'fixture-session'));
        await page.route('**/api/users/me', (route) => route.fulfill({
          status: 401, contentType: 'application/json', body: '{}',
        }));
        await page.goto(`${base}/settings`);
        await page.waitForURL('**/login');
        await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('vybe.token')), null);
      } finally {
        await context.close();
      }
    });

    test('the built worker removes legacy caches and never serves private data offline', async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${base}/cache-fixture`);
        await page.evaluate(async () => {
          await navigator.serviceWorker.register('/legacy-worker.js');
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) {
            await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
          }
          for (const [name, url] of [['vybe-api', '/api/private'], ['vybe-media', '/uploads/private.txt']]) {
            const cache = await caches.open(name);
            await cache.put(url, new Response('previous-account-private-data'));
          }
          await caches.open('unrelated-app-cache');
        });
        assert.equal(await page.evaluate(async () => (await fetch('/api/private')).text()), 'previous-account-private-data');
        await page.evaluate(async () => {
          const controlled = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
          const registration = await navigator.serviceWorker.register('/sw.js');
          const worker = registration.installing;
          if (worker && worker.state !== 'installed') {
            await new Promise((resolve, reject) => worker.addEventListener('statechange', () => {
              if (worker.state === 'installed') resolve();
              if (worker.state === 'redundant') reject(new Error('Service worker installation failed'));
            }));
          }
          const replacement = registration.waiting;
          if (!replacement) throw new Error('Expected an update waiting for consent');
          const activated = new Promise((resolve, reject) => replacement.addEventListener('statechange', () => {
            if (replacement.state === 'activated') resolve();
            if (replacement.state === 'redundant') reject(new Error('Service worker activation failed'));
          }));
          replacement.postMessage({ type: 'SKIP_WAITING' });
          await controlled;
          await activated;
        });
        const keys = await page.evaluate(() => caches.keys());
        assert.ok(!keys.includes('vybe-api'));
        assert.ok(!keys.includes('vybe-media'));
        assert.ok(keys.includes('unrelated-app-cache'));
        for (const url of ['/api/private', '/uploads/private.txt']) {
          const body = await page.evaluate(async (target) => (await fetch(target)).text(), url);
          assert.equal(body, 'private-network-response');
        }
        await context.setOffline(true);
        for (const url of ['/api/private', '/uploads/private.txt']) {
          const response = await page.evaluate(async (target) => {
            try { return await (await fetch(target)).text(); }
            catch { return null; }
          }, url);
          assert.equal(response, null, 'private content must not fall back to either old or new runtime caches');
        }
        assert.ok((await page.evaluate(() => caches.keys())).some((key) => key.includes('precache')), 'public app shell still supports offline loading');
      } finally {
        await context.close();
      }
    });
  });
}
