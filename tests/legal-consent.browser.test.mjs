import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Real-browser checks for the legal consent gate and the sign-up agreement.
 * The source and render tests in legal-consent.test.mjs pin what the
 * components say; only a layout engine can prove that the focus trap holds,
 * that Escape does nothing, that the gate sits above the welcome sheet and
 * under the 426 screen, and that the agreement really leaves as the body the
 * API validates.
 *
 * Same arrangement as auth-onboarding.browser.test.mjs: the API is stubbed
 * at the network layer, the app is built into a temp directory unless
 * VYBE_WEB_DIST names one, and the suite runs only when VYBE_PLAYWRIGHT holds
 * the absolute path of a Playwright install (its index.mjs) with Chromium.
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
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vybe-web-legal-browser-'));
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    stdio: 'inherit',
  });
  return { dist, cleanup: () => fs.rmSync(dist, { recursive: true, force: true }) };
}

/* ------------------------------------------------------------------ the stubbed API */

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const registrationProof = () => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ email: 'qa9@example.test', purpose: 'email-registration', exp: Math.floor(Date.now() / 1000) + 9 * 60 })}.sig`;

const ME = {
  _id: 'me000000000000000000000002',
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

const VERSION = '2026-07-28';
const NEWER = '2026-09-19';
const APP_VERSION = /^[A-Za-z0-9.+-]{1,40}$/;

const documentFor = (kind, version, material) =>
  kind === 'terms'
    ? {
        document: 'terms',
        title: 'Terms and Conditions',
        version,
        effectiveAt: `${version}T00:00:00.000Z`,
        material,
        url: 'https://vybeapp.fit/terms-and-conditions.html',
        summary: [
          'Vybe is a place to log training, share it and meet people who train.',
          'You keep the rights to what you post; we need a licence to show it to the people you choose.',
          'You can download your data or delete your account from Settings at any time.',
        ],
      }
    : {
        document: 'privacy',
        title: 'Privacy Policy',
        version,
        effectiveAt: `${version}T00:00:00.000Z`,
        material,
        url: 'https://vybeapp.fit/privacy-policy.html',
        summary: [
          'Workouts, meals, water, weight and progress photos are health data; they are never sold or used for ads.',
          'Your profile and posts are visible to the audience you pick for them.',
          'Delete your account and everything is removed; backups follow within the retention window.',
        ],
      };

/** One account's legal state on the stubbed server; `legalStateFor` in miniature. */
function legalServer({ rows = {}, version = VERSION, material = true, staleOnce = false } = {}) {
  const state = { rows: { ...rows }, version, material, staleOnce, posts: [] };
  const current = () => ({
    terms: documentFor('terms', state.version, state.material),
    privacy: documentFor('privacy', state.version, state.material),
    consents: {
      analytics: { document: 'analytics', version: '1', required: false },
      healthData: { document: 'health-data', version: '1', required: false },
      marketingPush: { document: 'marketing-push', version: '1', required: false },
    },
    noticeDays: 90,
  });
  const body = () => {
    const accepted = {};
    const pending = [];
    for (const kind of ['terms', 'privacy']) {
      const row = state.rows[kind] ?? null;
      accepted[kind] = row;
      if (!row || row.version !== state.version) pending.push(kind);
    }
    const blank = { granted: false, version: null, acceptedAt: null, revokedAt: null };
    return { accepted, pending, consents: { 'health-data': blank, analytics: blank, 'marketing-push': blank }, current: current() };
  };
  const accept = (payload) => {
    state.posts.push(payload);
    const list = Array.isArray(payload?.acceptances) ? payload.acceptances : [];
    if (!list.length || list.length > 5) return [400, { code: 'VALIDATION', message: 'Send one acceptance per document' }];
    if (!['signup', 'login', 'oauth', 'interstitial', 'settings'].includes(payload.surface ?? 'settings')) {
      return [400, { code: 'VALIDATION', message: 'Unknown acceptance surface', field: 'surface' }];
    }
    if (state.staleOnce) {
      state.staleOnce = false;
      state.version = NEWER;
      return [409, { code: 'LEGAL_VERSION_STALE', message: 'The terms version has changed', document: 'terms', current: NEWER }];
    }
    for (const entry of list) {
      if (entry.version !== state.version) {
        return [409, { code: 'LEGAL_VERSION_STALE', message: `The ${entry.document} version has changed`, document: entry.document, current: state.version }];
      }
    }
    const acceptedAt = new Date().toISOString();
    const written = list.map((entry) => ({ document: entry.document, version: entry.version, acceptedAt, surface: payload.surface ?? 'settings' }));
    for (const row of written) state.rows[row.document] = { version: row.version, acceptedAt, surface: row.surface };
    return [201, { acceptances: written, pending: body().pending }];
  };
  /** What POST /auth/register-password does server-side: rows at the current versions, surface signup. */
  const signup = () => {
    const acceptedAt = new Date().toISOString();
    for (const kind of ['terms', 'privacy']) state.rows[kind] = { version: state.version, acceptedAt, surface: 'signup' };
  };
  return { state, body, accept, signup };
}

const PEOPLE = ['One', 'Two', 'Three'].map((n, i) => ({
  _id: `p${String(i + 1).padStart(23, '0')}`,
  username: `person.${n.toLowerCase()}`,
  fullName: `Person ${n}`,
  isVerified: true,
  isIdentityVerified: false,
  isFollowing: false,
  followStatus: 'none',
  stats: { followers: 12 + i },
}));

/** Answers what these flows touch; everything else is a 404 the pages already handle. */
async function stubApi(context, log, legal, { notificationsAnswer426 = false } = {}) {
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    log.push({ key, headers: request.headers(), body: request.postDataJSON?.() ?? null });
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (key === 'GET /api/users/me') return json(200, { user: ME });
    if (key === 'GET /api/legal/acceptances') return json(200, legal.body());
    if (key === 'POST /api/legal/accept') {
      const [status, body] = legal.accept(request.postDataJSON());
      return json(status, body);
    }
    if (key === 'POST /api/auth/register-password') {
      legal.signup();
      return json(201, { token: 'stub.session.token', user: ME });
    }
    if (key === 'GET /api/auth/username-available') return json(200, { username: url.searchParams.get('username'), available: true });
    if (key === 'GET /api/searching/suggest') return json(200, { success: true, count: PEOPLE.length, users: PEOPLE });
    if (key === 'GET /api/posts/feed' || key === 'GET /api/notifications') {
      // The 426 case: the API has raised the web floor above this build; any route answers it.
      if (notificationsAnswer426) {
        return json(426, { success: false, code: 'CLIENT_UPDATE_REQUIRED', message: 'Why: sets now sync live.', platform: 'web', minVersion: '99.0.0', latestVersion: null, storeUrl: null });
      }
      if (key === 'GET /api/posts/feed') return json(200, { posts: [], total: 0, hasNextPage: false, page: 1 });
      return json(200, { notifications: [], unreadCount: 0, total: 0 });
    }
    return json(404, { message: `not stubbed: ${key}` });
  });
}

if (!PLAYWRIGHT) {
  test(
    'legal consent gate and sign-up agreement in a real browser',
    { skip: 'set VYBE_PLAYWRIGHT to the absolute path of a Playwright install (its index.mjs) with Chromium downloaded' },
    () => {},
  );
} else {
  describe('legal consent gate and sign-up agreement in a real browser', () => {
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

    async function open(url, { width = 1280, height = 900, seed, legal, notificationsAnswer426 } = {}) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1000, serviceWorkers: 'block' });
      const requests = [];
      await stubApi(context, requests, legal, { notificationsAnswer426 });
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

    const signedIn = { script: () => localStorage.setItem('vybe.token', 'stub.session.token') };
    // No acceptance row of any version (every pre-existing web account): a first agreement, not a change.
    const GATE = /Please review our terms and privacy policy/;
    // Rows on an older version: a genuine version bump, the wording mobile uses.
    const CHANGED = /Our terms and privacy policy have changed/;
    // The visible text is the accessible name (WCAG 2.5.3); `exact` so a longer aria-label could not pass.
    const AGREE = 'Agree and continue';
    const agreeButton = (scope) => scope.getByRole('button', { name: AGREE, exact: true });
    const focusInside = (page, testId) => page.evaluate((id) => Boolean(document.activeElement?.closest(`[data-testid="${id}"]`)), testId);
    const topmostAt = (page, x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[role="dialog"]')?.getAttribute('aria-labelledby') ?? null, [x, y]);

    test('an account without acceptance rows sees the dialog once: focus is trapped, Escape does nothing, Agree posts the exact body and a reload stays clear', async () => {
      const legal = legalServer();
      const { page, context, errors, requests } = await open('/', { seed: signedIn, legal });
      const dialog = page.getByRole('dialog', { name: GATE });
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'body scroll is locked');
      assert.equal(await dialog.getByText(CHANGED).count(), 0, 'nothing changed for an account that never agreed');
      const snapshot = await dialog.ariaSnapshot();
      assert.match(snapshot, /button "Agree and continue"/, 'the accessible name is the visible text');
      assert.match(snapshot, /button "Sign out"/);
      assert.doesNotMatch(snapshot, /Agree to the updated documents/);
      assert.equal(await dialog.locator('input[type="checkbox"]').count(), 0, 'one button is the agreement');
      assert.equal(await dialog.getByRole('link').count(), 2);
      for (const name of [/Read the full terms/, /Read the full privacy policy/]) {
        const link = dialog.getByRole('link', { name });
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      }
      assert.match(await dialog.getByRole('link', { name: /Read the full terms/ }).getAttribute('href'), /^\/terms-and-conditions\.html$/);
      assert.equal(await dialog.getByText('Effective July 28, 2026.').count(), 2, 'the calendar day of the version, not the local day before');

      // Focus: lands inside, stays inside through a full Tab cycle both ways, and Escape leaves the dialog up.
      await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-testid="legal-consent-dialog"]')));
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await focusInside(page, 'legal-consent-dialog'), true, `Tab ${i + 1} stays inside`);
      }
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focusInside(page, 'legal-consent-dialog'), true, `Shift+Tab ${i + 1} stays inside`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      assert.equal(await dialog.count(), 1, 'Escape does not dismiss');

      // Agree: one POST with the body the API validates, then the dialog is gone and the toast says so.
      await agreeButton(dialog).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="legal-consent-dialog"]').length === 0);
      const posts = requests.filter((r) => r.key === 'POST /api/legal/accept');
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].body.acceptances, [
        { document: 'terms', version: VERSION },
        { document: 'privacy', version: VERSION },
      ]);
      assert.equal(posts[0].body.surface, 'interstitial');
      assert.equal(posts[0].body.client.platform, 'web');
      assert.match(posts[0].body.client.appVersion, APP_VERSION);
      assert.doesNotMatch(posts[0].body.client.appVersion, /\//, 'never the raw web/ header');
      assert.equal(posts[0].headers['x-platform'], 'web');
      assert.equal(posts[0].headers.authorization, 'Bearer stub.session.token');
      await page.getByRole('status').filter({ hasText: 'Thanks. You’re all set.' }).waitFor();
      assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'the scroll lock is released');
      assert.deepEqual(legal.state.rows.terms && legal.state.rows.privacy ? ['terms', 'privacy'] : [], ['terms', 'privacy'], 'two rows written');

      // A reload asks the server once more and, with the rows recorded, shows nothing.
      await page.reload({ waitUntil: 'load' });
      await page.waitForResponse((response) => response.url().includes('/api/legal/acceptances'));
      await page.waitForTimeout(400);
      assert.equal(await page.getByRole('dialog').count(), 0, 'the dialog does not return once recorded');
      assert.equal(requests.filter((r) => r.key === 'GET /api/legal/acceptances').length, 2, 'one check per page load');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('rows on an older version make it a change: the title says so and Agree posts the current version', async () => {
      const acceptedAt = '2026-02-01T09:00:00.000Z';
      const legal = legalServer({ rows: { terms: { version: '2026-01-01', acceptedAt, surface: 'signup' }, privacy: { version: '2026-01-01', acceptedAt, surface: 'signup' } } });
      const { page, context, errors, requests } = await open('/', { seed: signedIn, legal });
      const dialog = page.getByRole('dialog', { name: CHANGED });
      await dialog.waitFor();
      assert.equal(await page.getByRole('dialog', { name: GATE }).count(), 0);
      await agreeButton(dialog).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="legal-consent-dialog"]').length === 0);
      const posts = requests.filter((r) => r.key === 'POST /api/legal/accept');
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].body.acceptances.map((a) => a.version), [VERSION, VERSION]);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('on a short phone screen the documents scroll and Agree and Sign out stay on screen, with a fade where there is more to read', async () => {
      const legal = legalServer();
      const { page, context, errors } = await open('/', { width: 390, height: 664, seed: signedIn, legal });
      const dialog = page.getByRole('dialog', { name: GATE });
      await dialog.waitFor();
      await page.waitForTimeout(300);
      const body = dialog.getByTestId('legal-consent-body');
      const metrics = await body.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, classes: el.className }));
      assert.ok(metrics.scrollHeight > metrics.clientHeight + 40, `the body is what scrolls (${metrics.scrollHeight} in ${metrics.clientHeight})`);
      assert.match(metrics.classes, /mask-fade-b/, 'more below: the bottom edge fades');
      const footer = dialog.getByTestId('legal-consent-footer');
      assert.match(await footer.evaluate((el) => el.className), /border-t/, 'a hairline separates the pinned footer from the scrolling body');
      for (const [name, testId] of [[AGREE, 'legal-consent-agree'], ['Sign out', 'legal-consent-sign-out']]) {
        const box = await dialog.getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(box, `${name} is laid out`);
        assert.ok(box.y >= 0 && box.y + box.height <= 664, `${name} is inside the 664px viewport (bottom edge at ${Math.round(box.y + box.height)})`);
        assert.equal(await page.evaluate(([id]) => { const el = document.querySelector(`[data-testid="${id}"]`); const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(`[data-testid="${id}"]`) === el; }, [testId]), true, `${name} is what the pointer reaches`);
      }
      // Scrolled to the end, the last link is fully visible and the fade moves to the top edge.
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => /mask-fade-t/.test(document.querySelector('[data-testid="legal-consent-body"]')?.className ?? '') && !/mask-fade-b|mask-fade-y/.test(document.querySelector('[data-testid="legal-consent-body"]')?.className ?? ''));
      const lastLink = dialog.getByRole('link', { name: /Read the full privacy policy/ });
      const linkBox = await lastLink.boundingBox();
      const bodyBox = await body.boundingBox();
      assert.ok(linkBox.y + linkBox.height <= bodyBox.y + bodyBox.height + 1, 'the last read link is not under the footer');
      // Keyboard: Tab from the dialog walks the links, reaches Agree and never leaves.
      await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-testid="legal-consent-dialog"]')));
      let reachedAgree = false;
      for (let i = 0; i < 6 && !reachedAgree; i += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await focusInside(page, 'legal-consent-dialog'), true, `Tab ${i + 1} stays inside`);
        reachedAgree = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'legal-consent-agree');
      }
      assert.equal(reachedAgree, true, 'Agree is reachable by keyboard');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('a 409 LEGAL_VERSION_STALE keeps the dialog, says so, refetches and posts the newer version next', async () => {
      const legal = legalServer({ staleOnce: true });
      const { page, context, errors, requests } = await open('/', { seed: signedIn, legal });
      const dialog = page.getByRole('dialog', { name: GATE });
      await dialog.waitFor();
      await agreeButton(dialog).click();
      await dialog.getByRole('alert').filter({ hasText: 'These documents changed again just now. Here is the latest.' }).waitFor();
      await dialog.getByText(`Effective September 19, 2026.`).first().waitFor();
      assert.equal(await dialog.count(), 1, 'the dialog stays');
      await agreeButton(dialog).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="legal-consent-dialog"]').length === 0);
      const posts = requests.filter((r) => r.key === 'POST /api/legal/accept').map((r) => r.body.acceptances.map((a) => a.version));
      assert.deepEqual(posts, [[VERSION, VERSION], [NEWER, NEWER]]);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('nothing pending means nothing shows, and Settings lists the agreement dates with read links', async () => {
      const acceptedAt = '2026-09-19T16:21:27.000Z';
      const legal = legalServer({ rows: { terms: { version: VERSION, acceptedAt, surface: 'signup' }, privacy: { version: VERSION, acceptedAt, surface: 'signup' } } });
      const { page, context, errors, requests } = await open('/settings', { seed: signedIn, legal });
      const card = page.getByRole('region', { name: 'Terms and privacy policy' });
      await card.waitFor();
      await page.waitForTimeout(300);
      assert.equal(await page.getByRole('dialog').count(), 0, 'an account with current rows is never asked');
      assert.equal(await card.getByText('Version 2026-07-28, effective July 28, 2026.').count(), 2);
      assert.equal(await card.getByText('You agreed to this version on September 19, 2026.').count(), 2);
      assert.equal(await card.getByRole('link', { name: 'Read the Terms and Conditions (opens in a new tab)' }).getAttribute('href'), '/terms-and-conditions.html');
      assert.equal(await card.getByRole('link', { name: 'Read the Privacy Policy (opens in a new tab)' }).getAttribute('href'), '/privacy-policy.html');
      assert.equal(await card.getByRole('button').count(), 0, 'read-only');
      assert.equal(requests.filter((r) => r.key === 'GET /api/legal/acceptances').length, 1, 'the gate and the card share one request');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('a non-material change is a notice whose Got it is named by its text and records the acknowledgement', async () => {
      const legal = legalServer({ material: false });
      const { page, context, errors, requests } = await open('/', { width: 390, height: 844, seed: signedIn, legal });
      const notice = page.getByTestId('legal-consent-notice');
      await notice.waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0, 'never a gate');
      const snapshot = await notice.ariaSnapshot();
      assert.match(snapshot, /button "Got it"/, 'the accessible name is the visible text');
      assert.doesNotMatch(snapshot, /Dismiss this notice/);
      await notice.getByRole('button', { name: 'Got it', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="legal-consent-notice"]').length === 0);
      for (let i = 0; i < 20 && !requests.some((r) => r.key === 'POST /api/legal/accept'); i += 1) await page.waitForTimeout(100);
      const posts = requests.filter((r) => r.key === 'POST /api/legal/accept');
      assert.equal(posts.length, 1);
      assert.equal(posts[0].body.surface, 'interstitial');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('the gate sits above the first-run welcome sheet and keeps Tab; agreeing reveals the sheet', async () => {
      const legal = legalServer();
      const { page, context, errors } = await open('/', {
        legal,
        seed: { script: () => { localStorage.setItem('vybe.token', 'stub.session.token'); sessionStorage.setItem('vybe.welcomePending', '1'); } },
      });
      const gate = page.getByRole('dialog', { name: GATE });
      const welcome = page.getByRole('dialog', { name: /Welcome to Vybe, Sam/ });
      await gate.waitFor();
      await welcome.waitFor();
      assert.equal(await topmostAt(page, 640, 450), 'legal-consent-title', 'the gate is what the pointer reaches');
      await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-testid="legal-consent-dialog"]')));
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await focusInside(page, 'legal-consent-dialog'), true, `Tab ${i + 1} stays in the gate`);
      }
      await agreeButton(gate).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="legal-consent-dialog"]').length === 0);
      assert.equal(await welcome.count(), 1, 'the welcome sheet is there once the agreement is recorded');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('the 426 screen still sits above the gate', async () => {
      const legal = legalServer();
      const { page, context, errors } = await open('/', { seed: signedIn, legal, notificationsAnswer426: true });
      await page.getByRole('dialog', { name: GATE }).waitFor();
      await page.getByRole('dialog', { name: 'Reload Vybe' }).waitFor();
      assert.equal(await topmostAt(page, 640, 450), 'update-required-title', 'the reload screen wins');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('sign-up refuses to create the account until the agreement box is ticked, then sends nothing extra and never posts /legal/accept', async () => {
      const legal = legalServer();
      const { page, context, errors, requests } = await open('/register', {
        legal,
        seed: {
          script: (draft) => sessionStorage.setItem('vybe.registerDraft', JSON.stringify(draft)),
          arg: { step: 3, email: 'qa9@example.test', preToken: registrationProof(), sentAt: Date.now() - 120_000, fullName: 'QA Nine' },
        },
      });
      const box = page.getByRole('checkbox', { name: /I agree to the Terms and Conditions .*and the Privacy Policy/ });
      await box.waitFor();
      assert.equal(await box.isChecked(), false, 'never pre-ticked');
      assert.equal(await box.getAttribute('required'), '');
      // Scoped to the form: the footer LegalLine links to the same two pages.
      const form = page.locator('form');
      const terms = form.getByRole('link', { name: 'Terms and Conditions (opens in a new tab)' });
      assert.equal(await terms.getAttribute('href'), '/terms-and-conditions.html');
      assert.equal(await terms.getAttribute('target'), '_blank');
      assert.equal(await form.getByRole('link', { name: 'Privacy Policy (opens in a new tab)' }).getAttribute('href'), '/privacy-policy.html');

      await page.fill('#reg-username', 'qa.nine');
      await page.waitForResponse((response) => response.url().includes('/api/auth/username-available'));
      await page.fill('#reg-password', 'Strong!Passw0rd');
      await page.fill('#reg-confirm', 'Strong!Passw0rd');
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.getByRole('alert').filter({ hasText: 'Tick the box to agree to the Terms and Conditions and the Privacy Policy.' }).waitFor();
      assert.equal(await box.getAttribute('aria-invalid'), 'true');
      assert.equal(await box.getAttribute('aria-describedby'), 'reg-agree-error');
      await page.waitForFunction(() => document.activeElement?.id === 'reg-agree');
      assert.equal(requests.filter((r) => r.key === 'POST /api/auth/register-password').length, 0, 'nothing created');

      await box.check();
      assert.equal(await page.getByRole('alert').filter({ hasText: 'Tick the box' }).count(), 0, 'ticking clears the error');
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.waitForURL((url) => url.pathname === '/');
      const created = requests.filter((r) => r.key === 'POST /api/auth/register-password');
      assert.equal(created.length, 1);
      const bodyKeys = Object.keys(created[0].body).filter((k) => k !== 'locale').sort();
      assert.deepEqual(bodyKeys, ['email', 'fcmTokens', 'fullName', 'password', 'username'], 'no consent field: the API writes the rows itself');
      assert.equal(created[0].headers['x-platform'], 'web');
      // The new account's rows exist server-side, so the first check is clear and the welcome sheet is what opens.
      await page.getByRole('dialog', { name: /Welcome to Vybe, Sam/ }).waitFor();
      // The gate's check usually completes before the sheet paints; poll the log rather than wait for a response already seen.
      for (let i = 0; i < 20 && !requests.some((r) => r.key === 'GET /api/legal/acceptances'); i += 1) await page.waitForTimeout(100);
      assert.ok(requests.some((r) => r.key === 'GET /api/legal/acceptances'), 'the signed-in gate checks the new account once');
      await page.waitForTimeout(300);
      assert.equal(await page.getByRole('dialog', { name: GATE }).count(), 0);
      assert.equal(requests.filter((r) => r.key === 'POST /api/legal/accept').length, 0, 'sign-up never posts an acceptance');
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
