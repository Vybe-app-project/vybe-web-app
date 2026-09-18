import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const PAGES = ['privacy-policy.html', 'terms-and-conditions.html', 'account-deletion.html'];

/**
 * SHA-256 of the visible legal copy (tags stripped, whitespace collapsed).
 * The copy is canonical: it is what the iOS app, the store listings and the
 * footer link to. A restyle must never touch it. If a policy is deliberately
 * updated, recompute with `copyHash(articleOf(read('public/<page>')))`.
 */
const LEGAL_COPY_SHA256 = {
  'privacy-policy.html': '4c8a09b383d847c46487e4b652ddccd087442f04c66ad561e31882630aeb3f6f',
  'terms-and-conditions.html': 'c71e79cb8cab188bcf4198ba8343c3a5e59b4b6b2737420e4f5f9a397543a4d1',
  'account-deletion.html': '40025511c3324e8f4025ea72a46b19cb5c45644768166a8e5b5cb076e72f305a',
};

function articleOf(html) {
  const match = html.match(/<article class="legal-doc">([\s\S]*?)<\/article>/);
  assert.ok(match, 'legal page has no <article class="legal-doc">');
  return match[1];
}

function copyHash(fragment) {
  const text = fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(text).digest('hex');
}

/** Declarations of one top-level rule, e.g. `.dark {` — anchored to a line start. */
function declarationsOf(css, selector) {
  const match = css.match(new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm'));
  assert.ok(match, `legal.css has no top-level "${selector}" rule`);
  return match[1]
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean);
}

test('legal copy is verbatim', () => {
  for (const page of PAGES) {
    assert.equal(
      copyHash(articleOf(read(`public/${page}`))),
      LEGAL_COPY_SHA256[page],
      `${page}: the legal copy changed. If that was deliberate, update LEGAL_COPY_SHA256.`,
    );
  }
});

test('legal pages share the branded shell and stay within the script-src self CSP', () => {
  for (const page of PAGES) {
    const html = read(`public/${page}`);
    assert.match(html, /^<!doctype html>\n<html lang="en" dir="ltr" class="no-js">/, `${page}: document root`);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/);
    assert.match(html, /<script src="\/theme\.js"><\/script>\n\s*<script src="\/legal\.js"><\/script>/, `${page}: theme bootstrap`);
    assert.match(html, /<link rel="stylesheet" href="\/legal\.css" \/>/, `${page}: shared stylesheet`);
    assert.match(html, /<title>[^<]+<\/title>/);

    assert.doesNotMatch(html, /<style[\s>]/i, `${page}: styles belong in public/legal.css`);
    assert.doesNotMatch(html, /\sstyle="/i, `${page}: no inline style attributes`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${page}: inline scripts are blocked by CSP`);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${page}: inline event handlers are blocked by CSP`);
    assert.doesNotMatch(html, /https?:\/\//i, `${page}: no third-party resources`);

    // Landmarks and navigation between the three pages plus support.
    assert.match(html, /<header class="legal-topbar">/);
    assert.match(html, /<nav class="legal-nav" aria-label="Legal pages">/);
    assert.match(html, /<main id="main" class="legal-container legal-main" tabindex="-1">/);
    assert.match(html, /<footer class="legal-footer">/);
    assert.match(html, /<a class="skip-link" href="#main">/);
    for (const target of PAGES) {
      const occurrences = html.split(`href="/${target}"`).length - 1;
      assert.ok(occurrences >= 2, `${page}: /${target} must be linked from the top bar and the footer`);
    }
    assert.ok(html.split('href="/support"').length - 1 >= 2, `${page}: /support must be linked from the top bar and the footer`);
    const current = html.match(/<a href="\/([a-z-]+\.html)" aria-current="page">/g) ?? [];
    assert.deepEqual(current, [`<a href="/${page}" aria-current="page">`, `<a href="/${page}" aria-current="page">`], `${page}: aria-current marks exactly this page in nav and footer`);

    // The brand mark is the Brand.tsx geometry, named for assistive tech, linking home.
    assert.match(html, /<a class="legal-brand" href="\/">\s*<svg viewBox="0 0 24 24" width="26" height="26" role="img" aria-label="Vybe" focusable="false">/);
    assert.ok(html.includes('d="M3.9 9.2 12 20.6l8.1-11.4"'), `${page}: brand mark outer V`);
    assert.ok(html.includes('d="M9.1 16.5 12 9.1l2.9 7.4"'), `${page}: brand mark inner V`);
    assert.match(html, /<span class="legal-brand__word type-display" aria-hidden="true">Vybe<\/span>/);

    // Document header keeps the canonical heading and the dated .meta line.
    assert.match(html, /<header class="legal-doc__header">\s*<h1>[^<]+<\/h1>\s*<p class="meta"><strong>[^<]*July 28, 2026<\/strong><\/p>\s*<\/header>/);
    assert.match(html, /<p>&copy; <span data-year>20\d\d<\/span> Vybe &middot; Social fitness<\/p>/);
  }
});

test('the brand mark in the legal shell matches Brand.tsx', () => {
  const brand = read('src/components/Brand.tsx');
  const page = read('public/privacy-policy.html');
  for (const attribute of ['cx="6.3" cy="4.9" r="1.9"', 'cx="17.7" cy="4.9" r="1.9"', 'd="M3.9 9.2 12 20.6l8.1-11.4"', 'd="M9.1 16.5 12 9.1l2.9 7.4"']) {
    assert.ok(brand.includes(attribute), `Brand.tsx no longer contains ${attribute}; update the legal pages`);
    assert.ok(page.includes(attribute), `legal shell lost ${attribute}`);
  }
});

test('legal.css repeats the design tokens with the exact values from src/styles.css', () => {
  const css = read('public/legal.css');
  const app = read('src/styles.css');
  const light = declarationsOf(css, ':root');
  const dark = declarationsOf(css, '.dark');
  assert.ok(light.length > 40 && dark.length > 20, 'token blocks look truncated');
  for (const declaration of [...light, ...dark].filter((d) => d.startsWith('--'))) {
    assert.ok(app.includes(`${declaration};`), `legal.css declares "${declaration}" but src/styles.css does not`);
  }
  // Every colour literal anywhere in the file must exist in the app stylesheet:
  // the legal pages introduce no colours of their own.
  const normalise = (value) => value.toLowerCase().replace(/\s+/g, ' ');
  const appColours = new Set((app.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []).map(normalise));
  const legalColours = new Set((css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []).map(normalise));
  assert.ok(legalColours.size > 30);
  for (const colour of legalColours) assert.ok(appColours.has(colour), `legal.css uses ${colour}, which is not in src/styles.css`);
});

test('the no-script colour-scheme fallback is identical to the .dark token set', () => {
  const css = read('public/legal.css');
  const dark = declarationsOf(css, '.dark');
  const fallback = css.match(/@media \(prefers-color-scheme: dark\) \{\s*\.no-js \{([^}]*)\}/);
  assert.ok(fallback, 'legal.css has no prefers-color-scheme fallback for .no-js');
  const fallbackDeclarations = fallback[1].split(';').map((d) => d.trim()).filter(Boolean);
  assert.deepEqual(fallbackDeclarations, dark);
  // legal.js is what removes the class once scripts run.
  assert.match(read('public/legal.js'), /classList\.remove\('no-js'\)/);
});

test('the self-hosted Archivo subset is the pinned npm package file, byte for byte', () => {
  const ours = fs.readFileSync(path.join(root, 'public/fonts/archivo-latin-wdth-normal.woff2'));
  const packaged = fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2'));
  assert.equal(ours.subarray(0, 4).toString('latin1'), 'wOF2', 'not a WOFF2 file');
  assert.ok(ours.equals(packaged), 'public/fonts/archivo-latin-wdth-normal.woff2 differs from @fontsource-variable/archivo');

  const css = read('public/legal.css');
  const packageCss = read('node_modules/@fontsource-variable/archivo/wdth.css');
  const range = (source, file) => {
    const block = source.match(new RegExp(`${file}[^}]*unicode-range: ([^;]+);`));
    assert.ok(block, `no unicode-range for ${file}`);
    return block[1].replace(/\s+/g, '');
  };
  assert.equal(range(css, 'archivo-latin-wdth-normal'), range(packageCss, 'archivo-latin-wdth-normal'));
  assert.match(css, /font-stretch: 62% 125%;/);
});

test('the legal shell has print and reduced-motion treatments and no forbidden constructs', () => {
  const css = read('public/legal.css');
  assert.match(css, /@media print \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--focus\)/);
  assert.match(css, /max-width: 68ch;/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/i, 'legal.css must not pull remote resources');
  assert.doesNotMatch(css, /!important/);
});
