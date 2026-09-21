import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

for (const relative of [
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'privacy-policy.html',
  'terms-and-conditions.html',
  'account-deletion.html',
  'legal.css',
  'legal.js',
  'fonts/archivo-latin-wdth-normal.woff2',
  'fonts/LICENSE-Archivo.txt',
  'healthz.json',
  'robots.txt',
]) {
  const target = path.join(dist, relative);
  assert.ok(fs.statSync(target).size > 0, `missing or empty build asset: ${relative}`);
}

const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const assetRefs = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
  .map((match) => match[1]);
assert.ok(assetRefs.some((asset) => asset.endsWith('.js')), 'index has no JavaScript bundle');
assert.ok(assetRefs.some((asset) => asset.endsWith('.css')), 'index has no stylesheet');
for (const asset of assetRefs) {
  assert.ok(fs.existsSync(path.join(dist, asset.slice(1))), `missing referenced asset: ${asset}`);
}

// The legal pages are static HTML outside the Vite graph; their shared shell
// must reference the shipped stylesheet and carry no inline style or script.
for (const relative of ['privacy-policy.html', 'terms-and-conditions.html', 'account-deletion.html']) {
  const page = fs.readFileSync(path.join(dist, relative), 'utf8');
  assert.match(page, /<link rel="stylesheet" href="\/legal\.css" \/>/, `${relative} does not link /legal.css`);
  assert.match(page, /<script src="\/theme\.js"><\/script>/, `${relative} does not load /theme.js`);
  assert.doesNotMatch(page, /<style[\s>]/i, `${relative} carries an inline <style> block`);
  assert.doesNotMatch(page, /<script(?![^>]*\ssrc=)[^>]*>/i, `${relative} carries an inline <script>`);
}

const files = filesBelow(dist);
assert.equal(files.filter((file) => file.endsWith('.map')).length, 0, 'source maps must not ship');

/**
 * The Firebase *web* API key for project vybe-6ac92 (src/lib/firebase.ts and
 * public/firebase-messaging-sw.js). It is `AIza…`-shaped, so the credential
 * scan below would flag it, and it is not a credential: Google documents the
 * web API key as public, it identifies the project to Firebase Installations
 * and FCM registration, and it grants nothing on its own. Removed by value
 * rather than by relaxing the pattern, so any other `AIza…` string — a
 * rotated key, a server key pasted in by mistake, someone else's — still
 * fails this check.
 */
const FIREBASE_WEB_API_KEY = 'AIzaSyDcrk_Q8hjzUuM9PzBHLH4FC8bezZQCA-Q';

const inspectable = files.filter((file) => /\.(?:html|js|css|json|svg|webmanifest)$/.test(file));
const bundleText = inspectable
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
  .split(FIREBASE_WEB_API_KEY)
  .join('<firebase-web-api-key>');
assert.doesNotMatch(bundleText, /__VYBE_[A-Z0-9_]+__/, 'release contains a configuration placeholder');
for (const pattern of [
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) {
  assert.doesNotMatch(bundleText, pattern, `release bundle matches ${pattern}`);
}

console.log(`Verified Vybe consumer-web build: ${files.length} files, ${assetRefs.length} entry assets.`);
