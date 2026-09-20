/**
 * Achievements under auto-award in a real browser. The source and render
 * contracts (achievements-rules, achievements-grid.render) pin the rules; only
 * a browser with React Query running can prove the two things that bit on
 * claude-main: Profile → Achievements no longer crashes on the shared query
 * key, and Claim never paints while the capabilities answer is still on its
 * way. The API is stubbed at the network layer, so the suite needs no backend.
 *
 * Playwright is not a dependency of this repository, so the suite runs only
 * when VYBE_PLAYWRIGHT holds the absolute path of a Playwright install (its
 * index.mjs) whose Chromium has been downloaded; otherwise it is skipped with
 * that reason (see auth-onboarding.browser.test.mjs for the same arrangement).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = process.env.VYBE_PLAYWRIGHT;
const { seed } = await import('./achievements-seed.mjs');

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

const capabilitiesBody = (autoAward) => ({
  success: true,
  authenticated: true,
  capabilities: { livestreamRelay: false, turnRelay: false },
  client: null,
  features: { achievementAutoAward: autoAward, live: false, 'reports.eventTarget': false, reviewPrompt: false, sessions: false, 'telemetry.crashReports': false },
});

const MEMBER_FIELDS = ['isEarned', 'earnedAt', 'ackedAt', 'awardedBy', 'progress', 'required', 'progressPercentage', 'canClaim'];
const catalogueRow = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !MEMBER_FIELDS.includes(k)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The routes these pages touch, answering like controllers/achievementController.js:
 * list routes filter isActive, /user carries the member fields, ack is 204 and
 * idempotent, claim grants the row. Everything else is a 404 the pages handle.
 * `fail` names routes that answer 500 instead (the envelope every 5xx wears),
 * after `failDelayMs`: instant failures undo an optimistic update before the
 * browser has painted it, which no network ever does.
 */
async function stubApi(context, log, { autoAward, delayCapabilitiesMs = 0, fail = [], failDelayMs = 0 }) {
  const rows = seed().filter((r) => r.isActive !== false);
  const acked = new Set();
  const claimed = new Set();
  const memberRow = (r) => ({
    ...r,
    ...(claimed.has(r._id) ? { isEarned: true, earnedAt: '2026-09-19T12:00:00.000Z', awardedBy: 'claim', canClaim: false } : {}),
    ackedAt: acked.has(r._id) ? '2026-09-19T12:00:00.000Z' : r.ackedAt,
  });
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    const entry = `${key}${url.search}`;
    log.push(entry);
    const json = (status, body) => {
      log[log.indexOf(entry)] = `${entry} -> ${status}${body?.message ? ` ${body.message}` : ''}`;
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    };
    const idOf = () => url.pathname.match(/\/api\/achievements\/([0-9a-f]{24})\//)?.[1];

    const serverError = async () => {
      if (failDelayMs) await sleep(failDelayMs);
      return json(500, { error: { code: 'INTERNAL', message: 'Internal server error', requestId: 'req-browser-test' } });
    };

    if (key === 'GET /api/users/me') return json(200, { user: ME });
    if (key === 'GET /api/capabilities' || key === 'GET /api/capabilities/authenticated') {
      if (delayCapabilitiesMs) await sleep(delayCapabilitiesMs);
      if (fail.includes('capabilities')) return serverError();
      return json(200, capabilitiesBody(autoAward));
    }
    if (key === 'GET /api/achievements/user') {
      if (fail.includes('user')) return serverError();
      const category = url.searchParams.get('category');
      const rarity = url.searchParams.get('rarity');
      const list = rows.filter((r) => (!category || r.category === category) && (!rarity || r.rarity === rarity)).map(memberRow);
      return json(200, { success: true, achievements: list });
    }
    if (key === 'GET /api/achievements') return json(200, { success: true, achievements: rows.map(catalogueRow), pagination: { page: 1, limit: 100, total: rows.length, pages: 1 } });
    if (key.startsWith('GET /api/achievements/category/')) {
      const list = rows.filter((r) => r.category === url.pathname.split('/').pop()).map(catalogueRow);
      return json(200, { success: true, achievements: list, pagination: { page: 1, limit: 100, total: list.length, pages: 1 } });
    }
    if (key.startsWith('GET /api/achievements/rarity/')) {
      const list = rows.filter((r) => r.rarity === url.pathname.split('/').pop()).map(catalogueRow);
      return json(200, { success: true, achievements: list, pagination: { page: 1, limit: 100, total: list.length, pages: 1 } });
    }
    if (key === 'GET /api/achievements/seasonal') return json(200, { success: true, achievements: [] });
    if (/^GET \/api\/achievements\/[0-9a-f]{24}\/progress$/.test(key)) {
      const r = rows.find((x) => x._id === idOf());
      if (!r) return json(404, { success: false, message: 'Achievement not found' });
      return json(200, { success: true, progress: { current: r.progress, required: r.required, percentage: r.progressPercentage, canEarn: r.canClaim } });
    }
    if (/^POST \/api\/achievements\/[0-9a-f]{24}\/ack$/.test(key)) {
      if (fail.includes('ack')) return serverError();
      const r = rows.find((x) => x._id === idOf());
      if (!r || !(r.isEarned || claimed.has(r._id))) return json(404, { success: false, message: 'Achievement not earned' });
      acked.add(r._id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (/^POST \/api\/achievements\/[0-9a-f]{24}\/claim$/.test(key)) {
      const r = rows.find((x) => x._id === idOf());
      if (!r) return json(404, { success: false, message: 'Achievement not found' });
      if (r.isEarned || claimed.has(r._id)) return json(400, { success: false, message: 'Achievement already claimed' });
      if (!r.canClaim) return json(400, { success: false, message: 'Achievement criteria not met' });
      claimed.add(r._id);
      return json(200, { success: true, message: 'Achievement claimed successfully', rewards: { points: r.rewards.points, coins: 0, experience: r.rewards.experience } });
    }
    if (key === 'GET /api/progress-photos') return json(200, { photos: [] });
    if (key === 'GET /api/friends/list') return json(200, { friends: [] });
    if (key === 'GET /api/friends/pending') return json(200, { requests: [] });
    return json(404, { message: `not stubbed: ${key}` });
  });
}

if (!PLAYWRIGHT) {
  test(
    'achievements under auto-award in a real browser',
    { skip: 'set VYBE_PLAYWRIGHT to the absolute path of a Playwright install (its index.mjs) with Chromium downloaded' },
    () => {},
  );
} else {
  describe('achievements under auto-award in a real browser', () => {
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

    /** A signed-in page with the API stubbed; the token is planted before any script runs. */
    async function open(url, options) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      const requests = [];
      await stubApi(context, requests, options);
      await context.addInitScript(() => localStorage.setItem('vybe.token', 'browser-test-token'));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${base}${url}`, { waitUntil: 'load' });
      return { page, context, errors, requests };
    }

    /** A StatTile by its label (the achievement cards carry no .type-label). */
    const tile = (page, label) => page.locator('.card', { has: page.locator('.type-label', { hasText: label }) });
    const claimControls = (page) => page.getByRole('button', { name: /^Claim( reward| all)?$/ });
    /** Where keyboard focus sits: the element's aria-label, else its text, else its tag. */
    const focused = (page) =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el ? el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName : null;
      });
    /** Activate a control the way a keyboard user does. */
    const pressEnterOn = async (locator) => {
      await locator.focus();
      await locator.page().keyboard.press('Enter');
    };

    test('Profile → Achievements with the flag on: one list under one key, no Claim anywhere, Awarded and New, ack on Got it', async () => {
      const { page, context, errors, requests } = await open('/profile', { autoAward: true });

      // The shortcut reads the shared list: 3 earned (the server drops the retired
      // earned row, see GET /achievements/user's isActive filter), one unacknowledged auto award.
      const shortcut = page.locator('.card', { hasText: 'Achievements' }).filter({ hasText: '1 new' });
      await shortcut.waitFor();
      assert.equal((await shortcut.locator('.type-stat').textContent())?.trim(), '3');
      await shortcut.getByRole('link', { name: 'Achievements' }).click();
      await page.waitForURL(/\/achievements$/);

      // The grid paints from the same cached list without a refetch race or a crash.
      await page.getByRole('img', { name: 'Earned' }).first().waitFor();
      assert.equal(await claimControls(page).count(), 0, 'no Claim control under auto-award');
      assert.equal(await page.getByText('Claim reward').count(), 0);
      await page.getByText('Awarded', { exact: true }).waitFor();
      assert.ok(!(await page.textContent('body')).includes('Sep 1, 2026'), 'backfill shows no date');
      await page.getByText('Earned Sep 12, 2026').waitFor();
      assert.equal(await page.getByText('New', { exact: true }).count(), 1, 'one New marker for the unacknowledged auto award');
      await page.getByText('1 / 4 weeks kept').waitFor();
      await page.getByText('Weeks kept counts weeks in a row in which you met your Weekly Rhythm target.').waitFor();
      await page.getByText('Criteria met', { exact: true }).waitFor();

      // Tiles: New awards replaces Ready to claim, Weeks kept replaces Streak badges.
      assert.match((await tile(page, 'New awards').textContent()) ?? '', /1/);
      assert.match((await tile(page, 'Weeks kept').textContent()) ?? '', /1.*of 4/);
      assert.equal(await page.getByText('Ready to claim').count(), 0);
      assert.equal(await page.getByText('Streak badges').count(), 0);

      // The new-award notice acks through POST /achievements/:id/ack and goes away.
      const notice = page.getByRole('note').filter({ hasText: 'New award: Building Momentum' });
      await notice.waitFor();
      const acked = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/achievements\/[0-9a-f]{24}\/ack$/.test(r.url()));
      await pressEnterOn(notice.getByRole('button', { name: 'Got it' }));
      await acked;
      await notice.waitFor({ state: 'detached' });
      // Focus was handed to the selected view tab before the notice left, and the result is announced.
      assert.equal(await focused(page), 'My progress');
      await page.getByRole('status').filter({ hasText: 'Marked as seen' }).waitFor();
      await page.getByText('New', { exact: true }).waitFor({ state: 'detached' });
      assert.equal(requests.filter((r) => /\/ack$/.test(r)).length, 1);

      // Filters offer only what the API returned (no Nutrition, no Consistency: the catalogue has none active).
      await page.getByRole('combobox', { name: 'Category' }).click();
      assert.deepEqual(await page.getByRole('option').allTextContents(), ['All categories', 'Training', 'Milestones', 'Community']);
      await page.keyboard.press('Escape');

      // The detail of a met row explains the award and offers no Claim and no Coins.
      await page.getByRole('button', { name: 'Social Spark: details' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      try {
        await dialog.getByText('Criteria met. Your award arrives on its own.').waitFor({ timeout: 8000 });
      } catch (error) {
        throw new Error(`met copy missing; dialog=${JSON.stringify(await dialog.textContent())} requests=${JSON.stringify(requests.filter((r) => /progress|achievements\/user/.test(r)))}`, { cause: error });
      }
      assert.equal(await dialog.getByRole('button', { name: 'Claim reward' }).count(), 0);
      assert.equal(await dialog.getByText('Coins').count(), 0);
      assert.ok(!((await dialog.textContent()) ?? '').includes('% of Vybe'));
      // The footer Close (the header also carries an icon button labelled Close).
      await dialog.getByRole('button', { name: 'Close' }).last().click();
      await dialog.waitFor({ state: 'detached' });

      assert.deepEqual(errors, []);
      await context.close();
    });

    test('Claim never paints before the capabilities answer, even when the grid is already on screen', async () => {
      const { page, context, errors } = await open('/achievements', { autoAward: true, delayCapabilitiesMs: 1500 });
      await page.getByRole('img', { name: 'Earned' }).first().waitFor();
      // Capabilities are still pending: the tiles are skeletons and Claim is absent.
      assert.equal(await claimControls(page).count(), 0, 'no Claim while capabilities are unknown');
      await page.waitForResponse((r) => r.url().includes('/api/capabilities'));
      await tile(page, 'New awards').waitFor();
      assert.equal(await claimControls(page).count(), 0, 'no Claim once the flag is known to be on');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('with the flag off the claim flow is intact: Claim on the met row, Ready to claim tile, the claim banks the badge', async () => {
      const { page, context, errors, requests } = await open('/achievements', { autoAward: false });
      await page.getByRole('img', { name: 'Earned' }).first().waitFor();
      await page.getByRole('button', { name: 'Claim reward' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Claim reward' }).count(), 1, 'only the met row offers Claim');
      assert.match((await tile(page, 'Ready to claim').textContent()) ?? '', /1/);
      assert.equal(await page.getByText('New awards').count(), 0);
      await page.getByRole('note').filter({ hasText: 'One badge is ready to claim' }).waitFor();

      const claimedResponse = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/achievements\/[0-9a-f]{24}\/claim/.test(r.url()));
      await pressEnterOn(page.getByRole('button', { name: 'Claim reward' }));
      const claimResponse = await claimedResponse;
      assert.equal(claimResponse.status(), 200, `claim answered ${claimResponse.status()} ${await claimResponse.text()}; rows=${JSON.stringify(requests.filter((r) => /achievements/.test(r)))}`);
      try {
        await page.getByRole('status').filter({ hasText: 'Social Spark claimed: 125 pts, 125 XP' }).waitFor({ timeout: 8000 });
      } catch (error) {
        const statuses = await page.getByRole('status').allTextContents();
        throw new Error(`claim toast missing; statuses=${JSON.stringify(statuses)} requests=${JSON.stringify(requests.slice(-8))}`, { cause: error });
      }
      await page.getByRole('button', { name: 'Claim reward', exact: true }).waitFor({ state: 'detached' });
      await page.getByRole('img', { name: 'Earned' }).nth(3).waitFor();
      // Claim replaced itself with "Details"; focus stays on that card.
      assert.equal(await focused(page), 'Social Spark: details');
      assert.equal(requests.filter((r) => /\/ack$/.test(r)).length, 0, 'claims are not acked (they are not auto awards)');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('claiming from the detail dialog keeps focus inside the dialog', async () => {
      const { page, context, errors } = await open('/achievements', { autoAward: false });
      await page.getByRole('button', { name: 'Claim reward' }).waitFor();
      await page.getByRole('button', { name: 'Social Spark: details' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByText('Criteria met. Claim it to bank the reward.').waitFor();
      await pressEnterOn(dialog.getByRole('button', { name: 'Claim reward' }));
      await page.getByRole('status').filter({ hasText: 'Social Spark claimed' }).waitFor();
      await dialog.getByRole('button', { name: 'Claim reward' }).waitFor({ state: 'detached' });
      assert.equal(await focused(page), 'Close');
      assert.ok(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), 'focus is inside the dialog');
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('a failed ack is said out loud, focus is kept, and the notice comes back', async () => {
      const { page, context, errors, requests } = await open('/achievements', { autoAward: true, fail: ['ack'], failDelayMs: 600 });
      const notice = page.getByRole('note').filter({ hasText: 'New award: Building Momentum' });
      await notice.waitFor();
      await pressEnterOn(notice.getByRole('button', { name: 'Got it' }));
      // The optimistic update removes the notice at once; focus has already moved.
      await notice.waitFor({ state: 'detached' });
      assert.equal(await focused(page), 'My progress');
      const failure = page.getByRole('status').filter({ hasText: 'Could not mark those awards as seen.' });
      await failure.waitFor();
      assert.equal((await failure.textContent())?.trim(), 'Could not mark those awards as seen. Internal server error.', 'the action first, then the server reason');
      assert.equal(await focused(page), 'My progress', 'the failure does not move focus again');
      // The optimistic removal is undone by the refetch, so the notice and the New chip return with the message.
      await notice.waitFor();
      await page.getByText('New', { exact: true }).waitFor();
      assert.equal(await page.getByRole('status').filter({ hasText: 'Marked as seen' }).count(), 0);
      assert.equal(requests.filter((r) => /\/ack -> 500/.test(r)).length, 1);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('a failed summary list shows dashes, never zeros, and the catalogue waits for it', async () => {
      const { page, context, errors } = await open('/achievements', { autoAward: true, fail: ['user'] });
      // The list route fails after the client's two 5xx retries; the grid shows its error state.
      await page.getByText('Could not load achievements').waitFor({ timeout: 20000 });
      for (const label of ['Earned', 'New awards', 'Points banked', 'Milestones']) {
        const text = (await tile(page, label).textContent()) ?? '';
        assert.ok(text.includes('—'), `${label} shows a dash: ${text}`);
        assert.ok(!/\d/.test(text), `${label} states no number: ${text}`);
      }
      assert.equal(await page.getByText('Awards arrive on their own').count(), 0);
      assert.equal(await page.getByText('Nothing pending').count(), 0);
      assert.equal(await page.getByText('None yet').count(), 0);
      // Catalogue rows borrow their member fields from that list, so the tab explains instead of painting every badge unearned.
      await page.getByRole('tab', { name: 'All badges' }).click();
      await page.getByText('Your progress could not be loaded').waitFor({ timeout: 20000 });
      await page.getByText('Each badge shows your progress on it, so the list waits until that loads.').waitFor();
      assert.equal(await page.getByText('0 / 1 session').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'First Move: details' }).count(), 0);
      assert.ok((await page.getByRole('button', { name: 'Try again' }).count()) >= 1);
      assert.deepEqual(errors, []);
      await context.close();
    });

    test('when the capabilities answer fails the awards tile says so and nothing offers Claim', async () => {
      const { page, context, errors } = await open('/achievements', { autoAward: false, fail: ['capabilities'] });
      await page.getByRole('img', { name: 'Earned' }).first().waitFor();
      const awards = tile(page, 'Awards');
      await awards.waitFor({ timeout: 20000 });
      const text = (await awards.textContent()) ?? '';
      assert.ok(text.includes('—'), `awards tile shows a dash: ${text}`);
      assert.ok(text.includes('Could not check server settings'), text);
      assert.equal(await page.getByText('Ready to claim').count(), 0);
      assert.equal(await page.getByText('New awards').count(), 0);
      assert.equal(await page.getByText('Nothing pending').count(), 0);
      assert.equal(await claimControls(page).count(), 0, 'Claim is never offered without the server answer');
      assert.equal(await page.getByRole('note').count(), 0, 'no callout asserts a flow the page does not know');
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
