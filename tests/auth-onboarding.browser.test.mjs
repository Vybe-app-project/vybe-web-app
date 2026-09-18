import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Real-browser checks for the sign-up and first-run flows. The source
 * contracts in auth-onboarding.test.mjs pin what the pages say; only a layout
 * engine with React running can prove what the accessibility tree ends up
 * holding once props are spread, or that a route change under a modal really
 * dismisses it. Both defects this suite guards were found in a built app that
 * passed every source contract.
 *
 * The API is stubbed at the network layer (Playwright routes), so the suite
 * needs no backend. It builds the app into a temp directory unless
 * VYBE_WEB_DIST names an existing build.
 *
 * Playwright is not a dependency of this repository, so the suite runs only
 * when VYBE_PLAYWRIGHT holds the absolute path of a Playwright install (its
 * index.mjs) whose Chromium has been downloaded; otherwise it is skipped with
 * that reason (see legal-pages.browser.test.mjs for the same arrangement).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = process.env.VYBE_PLAYWRIGHT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** Static server with the SPA fallback the production host provides. */
function serveApp(directory) {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.join(directory, pathname);
    if (!file.startsWith(directory) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(pathname)) {
        response.writeHead(404);
        response.end();
        return;
      }
      file = path.join(directory, 'index.html');
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

function buildApp() {
  if (process.env.VYBE_WEB_DIST) return { dist: path.resolve(process.env.VYBE_WEB_DIST), cleanup() {} };
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vybe-web-browser-'));
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    stdio: 'inherit',
  });
  return { dist, cleanup: () => fs.rmSync(dist, { recursive: true, force: true }) };
}

/* ------------------------------------------------------------------ the stubbed API */

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const registrationProof = () => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ email: 'qa8@example.test', purpose: 'email-registration', exp: Math.floor(Date.now() / 1000) + 9 * 60 })}.sig`;

const ME = {
  _id: 'me000000000000000000000001',
  username: 'sam_qa',
  fullName: 'Sam QA',
  email: 'sam@example.test',
  isVerified: true,
  isIdentityVerified: false,
  followers: [],
  following: [],
  stats: { followers: 0, following: 0, totalPosts: 0 },
  settings: { privacy: 'public' },
};

const PEOPLE = ['One', 'Two', 'Three', 'Four', 'Five'].map((n, i) => ({
  _id: `p${String(i + 1).padStart(23, '0')}`,
  username: `person.${n.toLowerCase()}`,
  fullName: `Person ${n}`,
  isVerified: true,
  isIdentityVerified: false,
  isFollowing: false,
  followStatus: 'none',
  stats: { followers: 12 + i },
}));

const TAKEN = 'vybetester';

/** Answers the few endpoints these flows touch; everything else is a 404 the pages already handle. */
async function stubApi(context, log) {
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    log.push(`${key}${url.search}`);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (key === 'GET /api/users/me') return json(200, { user: ME });
    if (key === 'GET /api/searching/suggest') return json(200, { success: true, count: PEOPLE.length, users: PEOPLE });
    if (key === 'GET /api/auth/username-available') {
      const username = (url.searchParams.get('username') || '').toLowerCase();
      if (username === TAKEN) return json(200, { username, available: false, reason: 'taken', suggestions: [`${TAKEN}_1`, `${TAKEN}.qa`, `${TAKEN}2026`] });
      return json(200, { username, available: true });
    }
    if (key === 'GET /api/posts/feed') return json(200, { posts: [], total: 0, hasNextPage: false, page: 1 });
    if (key === 'GET /api/notifications') return json(200, { notifications: [], unreadCount: 0, total: 0 });
    return json(404, { message: `not stubbed: ${key}` });
  });
}

if (!PLAYWRIGHT) {
  test(
    'sign-up and first-run flows in a real browser',
    { skip: 'set VYBE_PLAYWRIGHT to the absolute path of a Playwright install (its index.mjs) with Chromium downloaded' },
    () => {},
  );
} else {
  describe('sign-up and first-run flows in a real browser', () => {
    let browser;
    let server;
    let base;
    let build;

    before(async () => {
      const playwright = await import(pathToFileURL(path.resolve(PLAYWRIGHT)).href);
      build = buildApp();
      server = serveApp(build.dist);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      browser = await playwright.chromium.launch();
    });

    after(async () => {
      await browser?.close();
      server?.close();
      build?.cleanup();
    });

    /** A fresh signed-out or signed-in page with the API stubbed and storage seeded before any script runs. */
    async function open(url, { width = 1280, height = 900, seed } = {}) {
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: width < 1000,
        serviceWorkers: 'block',
      });
      const requests = [];
      await stubApi(context, requests);
      // Init scripts run on every document load in the context, including a
      // reload or a back navigation, so a seed runs once per tab: a one-shot
      // marker re-planted on reload would be the test reopening the sheet.
      if (seed) {
        await context.addInitScript(
          ({ source, arg }) => {
            if (sessionStorage.getItem('vybe.test.seeded')) return;
            sessionStorage.setItem('vybe.test.seeded', '1');
            // eslint-disable-next-line no-new-func
            new Function('arg', `return (${source})(arg);`)(arg);
          },
          { source: seed.script.toString(), arg: seed.arg },
        );
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${base}${url}`, { waitUntil: 'load' });
      return { page, context, errors, requests };
    }

    const describedBy = (page, selector) => page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-describedby') ?? null, selector);
    const describedText = (page, selector) =>
      page.evaluate((s) => {
        const ids = document.querySelector(s)?.getAttribute('aria-describedby');
        return ids ? ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? `<missing #${id}>`) : [];
      }, selector);

    test('the username field is described by its hint, then its error, then its live status -- never by an element that is not there', async () => {
      const { page, context, errors, requests } = await open('/register', {
        seed: {
          script: (draft) => sessionStorage.setItem('vybe.registerDraft', JSON.stringify(draft)),
          arg: { step: 3, email: 'qa8@example.test', preToken: registrationProof(), sentAt: Date.now() - 120_000, fullName: 'QA Eight' },
        },
      });
      const field = '#reg-username';
      await page.locator(field).waitFor();
      assert.equal(await page.locator('#reg-name').inputValue(), 'QA Eight', 'the step-3 name survived the reload');

      // Idle: the format hint is the description, and it is rendered.
      assert.equal(await describedBy(page, field), 'reg-username-hint');
      assert.match((await describedText(page, field))[0], /letters|numbers/i);

      // Taken: the shell's error is what a screen reader hears; the status line is not in the tree.
      await page.fill(field, TAKEN);
      await page.waitForResponse((response) => response.url().includes('/api/auth/username-available'));
      await page.getByRole('alert').filter({ hasText: 'That username is taken' }).waitFor();
      assert.equal(await page.getAttribute(field, 'aria-invalid'), 'true');
      assert.equal(await describedBy(page, field), 'reg-username-error');
      assert.match((await describedText(page, field))[0], /That username is taken/);
      assert.equal(await page.locator('#reg-username-status').count(), 0, 'no dangling status element while the error shows');
      await page.getByRole('group', { name: 'Available usernames' }).getByRole('button', { name: `@${TAKEN}_1` }).waitFor();
      assert.equal(requests.filter((r) => r.includes('username-available')).length, 1, 'one debounced availability request for the typed handle');

      // Available: the status line is rendered and is the description; no error remains.
      await page.getByRole('button', { name: `@${TAKEN}_1` }).click();
      await page.waitForResponse((response) => response.url().includes(`username=${TAKEN}_1`));
      await page.locator('#reg-username-status').filter({ hasText: 'is available' }).waitFor();
      assert.equal(await page.getAttribute(field, 'aria-invalid'), null);
      assert.equal(await describedBy(page, field), 'reg-username-status');
      assert.match((await describedText(page, field))[0], new RegExp(`@${TAKEN}_1 is available`));

      // The password field keeps both its rules list and, once invalid, its error.
      await page.fill('#reg-password', 'short');
      await page.fill('#reg-confirm', 'short');
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.getByRole('alert').filter({ hasText: /requirements/ }).waitFor();
      assert.equal(await describedBy(page, '#reg-password'), 'reg-password-error reg-password-rules');

      assert.deepEqual(errors, []);
      await context.close();
    });

    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'phone', width: 390, height: 844 },
    ]) {
      test(`tapping a person inside the welcome sheet opens their profile with the sheet gone (${viewport.name})`, async () => {
        const { page, context, errors } = await open('/?welcome=1', {
          ...viewport,
          seed: { script: () => localStorage.setItem('vybe.token', 'stub.session.token') },
        });
        const dialog = page.getByRole('dialog', { name: /Welcome to Vybe, Sam/ });
        await dialog.waitFor();
        assert.equal(new URL(page.url()).searchParams.get('welcome'), null, 'the deep-link param is consumed');
        await dialog.getByRole('link', { name: /Open Person One/ }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Follow' }).count(), PEOPLE.length);

        await dialog.getByRole('link', { name: /Open Person One/ }).click();
        await page.waitForURL((url) => url.pathname === `/u/${PEOPLE[0]._id}`);
        await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'the body scroll lock is released');
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), false, 'focus is no longer trapped');

        // Going back to Home does not bring the sheet back: it was consumed on open.
        await page.goBack();
        await page.waitForURL((url) => url.pathname === '/');
        await page.waitForTimeout(400);
        assert.equal(await page.getByRole('dialog').count(), 0);

        assert.deepEqual(errors, []);
        await context.close();
      });
    }

    test('"See more" and "Skip for now" still close the sheet and the marker path opens it once', async () => {
      const { page, context, errors } = await open('/', {
        seed: { script: () => { localStorage.setItem('vybe.token', 'stub.session.token'); sessionStorage.setItem('vybe.welcomePending', '1'); } },
      });
      const dialog = page.getByRole('dialog', { name: /Welcome to Vybe, Sam/ });
      await dialog.waitFor();
      await dialog.getByRole('link', { name: 'See more' }).click();
      await page.waitForURL((url) => url.pathname === '/discover');
      await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(400);
      assert.equal(await page.getByRole('dialog').count(), 0, 'the one-shot marker does not reopen the sheet');
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
