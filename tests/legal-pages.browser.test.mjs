import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Real-browser checks for the static legal pages. The static suite in
 * legal-pages.test.mjs can read the stylesheet, but only a layout engine can
 * prove that the sticky top bar never covers what a skip link or an anchor
 * scrolls to, that the bar really parks its brand row on phones, and that
 * every shell link measures 40px in both directions.
 *
 * Playwright is not a dependency of this repository, so the suite runs only
 * when VYBE_PLAYWRIGHT holds the absolute path of a Playwright install (its
 * index.mjs) whose Chromium has been downloaded; otherwise it is skipped with
 * that reason. Example:
 *   VYBE_PLAYWRIGHT=~/.npm/_npx/<hash>/node_modules/playwright/index.mjs npm test
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = process.env.VYBE_PLAYWRIGHT;

const PAGES = ['privacy-policy.html', 'terms-and-conditions.html', 'account-deletion.html'];
const PHONES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
];
const DESKTOP = { name: '1280x900', width: 1280, height: 900 };

// The geometry public/legal.css promises in its `html {}` metrics block.
const TAB_H_COARSE = 44; // page tab row on a touch device
const BAR_PAD = 4; // above and below the tab row on phones
const BORDER = 1;
const STUCK_PHONE = TAB_H_COARSE + 2 * BAR_PAD + BORDER; // what stays on screen once a phone scrolls
const STUCK_DESKTOP = 64 + BORDER; // the single desktop row
const NOTCH = 47; // status-bar inset of an installed PWA on a notched iPhone
const MIN_TARGET = 40;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function serve(directory) {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(directory, pathname);
    if (!file.startsWith(directory) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
}

if (!PLAYWRIGHT) {
  test(
    'legal pages in a real browser',
    { skip: 'set VYBE_PLAYWRIGHT to the absolute path of a Playwright install (its index.mjs) with Chromium downloaded' },
    () => {},
  );
} else {
  describe('legal pages in a real browser', () => {
    let browser;
    let server;
    let base;

    before(async () => {
      const playwright = await import(pathToFileURL(path.resolve(PLAYWRIGHT)).href);
      server = serve(path.join(root, 'public'));
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      browser = await playwright.chromium.launch();
    });

    after(async () => {
      await browser?.close();
      server?.close();
    });

    /** A fresh page at the given viewport; phones report a coarse pointer, as real ones do. */
    async function open(viewport, file, { touch = viewport.width < 1000, colorScheme = 'light', hash = '' } = {}) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: touch,
        colorScheme,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${base}/${file}${hash}`, { waitUntil: 'load' });
      await settle(page);
      return { page, context, errors };
    }

    /** Two frames, so scroll handlers and sticky positioning have run. */
    const settle = (page) =>
      page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const geometry = (page) =>
      page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const bar = rect('.legal-topbar');
        const h1 = rect('.legal-doc h1');
        const brand = document.querySelector('.legal-brand');
        return {
          active: document.activeElement ? document.activeElement.id : '',
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          barBottom: bar.bottom,
          h1Top: h1.top,
          h1Bottom: h1.bottom,
          tabTop: rect('.legal-nav a').top,
          brandTop: brand.getBoundingClientRect().top,
          brandVisibility: getComputedStyle(brand).visibility,
          stuck: document.querySelector('.legal-topbar').classList.contains('is-stuck'),
        };
      });

    async function activateSkipLink(page) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link', 'first Tab stop is the skip link');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'main');
      await settle(page);
    }

    const scrollTo = async (page, y) => {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await settle(page);
    };

    function assertHeadingClear(g, label) {
      assert.ok(
        g.h1Top >= g.barBottom,
        `${label}: the h1 (top ${g.h1Top}px) is under the sticky bar (bottom ${g.barBottom}px)`,
      );
      assert.ok(g.h1Bottom <= g.innerHeight, `${label}: the h1 is below the fold`);
    }

    test('the skip link and #main anchor land the reader on an uncovered heading', async () => {
      for (const file of PAGES) {
        for (const viewport of [...PHONES, DESKTOP]) {
          const label = `${file} ${viewport.name}`;
          const { page, context, errors } = await open(viewport, file);
          await activateSkipLink(page);
          const g = await geometry(page);
          assert.equal(g.active, 'main', `${label}: focus moved to #main`);
          assertHeadingClear(g, `${label} skip link`);

          // Same target reached through the URL fragment, as a shared deep link would.
          await page.goto(`${base}/${file}#main`, { waitUntil: 'load' });
          await settle(page);
          assertHeadingClear(await geometry(page), `${label} #main fragment`);
          assert.deepEqual(errors, [], `${label}: page errors`);
          await context.close();
        }
      }
    });

    test('on phones only the page tabs stay on screen once the reader scrolls', async () => {
      for (const viewport of PHONES) {
        const { page, context } = await open(viewport, 'privacy-policy.html');
        await scrollTo(page, 600);
        await page.waitForFunction(() => document.querySelector('.legal-topbar').classList.contains('is-stuck'));
        let g = await geometry(page);
        assert.ok(g.barBottom <= STUCK_PHONE + 0.5, `${viewport.name}: ${g.barBottom}px of bar stays on screen, expected ${STUCK_PHONE}px`);
        assert.ok(g.tabTop >= 0, `${viewport.name}: the tab row is cut off at the top`);
        assert.equal(g.brandVisibility, 'hidden', `${viewport.name}: the parked brand row is hidden`);

        // Scrolling back reveals the brand row again.
        await scrollTo(page, 0);
        await page.waitForFunction(() => !document.querySelector('.legal-topbar').classList.contains('is-stuck'));
        g = await geometry(page);
        assert.equal(g.brandVisibility, 'visible');
        assert.ok(g.brandTop >= 0);
        await context.close();
      }

      const { page, context } = await open(DESKTOP, 'privacy-policy.html');
      await scrollTo(page, 600);
      const g = await geometry(page);
      assert.equal(g.stuck, false, 'desktop keeps its single row and never parks anything');
      assert.equal(g.brandVisibility, 'visible');
      assert.ok(Math.abs(g.barBottom - STUCK_DESKTOP) <= 0.5, `desktop bar is ${g.barBottom}px, expected ${STUCK_DESKTOP}px`);
      await context.close();
    });

    test('inside an installed PWA the status-bar inset stays clear at rest and when parked', async () => {
      const { page, context } = await open(PHONES[1], 'terms-and-conditions.html');
      // Headless Chromium has no notch; the stylesheet routes the inset through
      // one custom property precisely so it can be simulated here.
      await page.addStyleTag({ content: `html { --legal-safe-top: ${NOTCH}px; }` });
      await settle(page);
      let g = await geometry(page);
      assert.ok(g.brandTop >= NOTCH, `at rest the brand row (top ${g.brandTop}px) sits under the status bar`);

      await activateSkipLink(page);
      assertHeadingClear(await geometry(page), 'notched skip link');

      await scrollTo(page, 600);
      await page.waitForFunction(() => document.querySelector('.legal-topbar').classList.contains('is-stuck'));
      g = await geometry(page);
      assert.ok(g.tabTop >= NOTCH, `parked tab row (top ${g.tabTop}px) sits under the status bar`);
      assert.ok(g.barBottom <= NOTCH + STUCK_PHONE + 0.5, `parked bar is ${g.barBottom}px tall`);
      assert.equal(g.brandVisibility, 'hidden', 'the parked brand row must not peek through the status-bar inset');
      await context.close();
    });

    test('nothing overflows horizontally and every shell link is a 40px target', async () => {
      for (const file of PAGES) {
        for (const viewport of [...PHONES, DESKTOP]) {
          const { page, context } = await open(viewport, file);
          const g = await geometry(page);
          assert.ok(g.scrollWidth <= g.innerWidth, `${file} ${viewport.name}: horizontal overflow ${g.scrollWidth} > ${g.innerWidth}`);
          const small = await page.evaluate((min) =>
            [...document.querySelectorAll('.legal-topbar a, .legal-footer a')]
              .map((a) => ({ text: a.textContent.trim(), ...a.getBoundingClientRect().toJSON() }))
              .filter((r) => r.width < min || r.height < min)
              .map((r) => `"${r.text}" ${Math.round(r.width)}x${Math.round(r.height)}`),
            MIN_TARGET,
          );
          assert.deepEqual(small, [], `${file} ${viewport.name}: shell links under ${MIN_TARGET}px`);
          await context.close();
        }
      }
    });

    test('printing from dark mode, even mid-scroll, prints an ink wordmark and the whole bar', async () => {
      const { page, context } = await open(PHONES[1], 'account-deletion.html', { colorScheme: 'dark' });
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
      await scrollTo(page, 600);
      await page.waitForFunction(() => document.querySelector('.legal-topbar').classList.contains('is-stuck'));
      await page.emulateMedia({ media: 'print' });
      const print = await page.evaluate(() => ({
        wordmark: getComputedStyle(document.querySelector('.legal-brand__word')).color,
        brandVisibility: getComputedStyle(document.querySelector('.legal-brand')).visibility,
        position: getComputedStyle(document.querySelector('.legal-topbar')).position,
        background: getComputedStyle(document.documentElement).backgroundColor,
      }));
      assert.equal(print.wordmark, 'rgb(0, 0, 0)', 'wordmark prints in --text-1 (Instagram black), not the mint mark colour');
      assert.equal(print.brandVisibility, 'visible');
      assert.equal(print.position, 'static');
      assert.equal(print.background, 'rgb(255, 255, 255)');
      await context.close();
    });
  });
}
