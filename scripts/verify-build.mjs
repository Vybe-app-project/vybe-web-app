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
  'support.html',
  'support/index.html',
  'support-client.js',
  'support-bootstrap.js',
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

const files = filesBelow(dist);
assert.equal(files.filter((file) => file.endsWith('.map')).length, 0, 'source maps must not ship');

const inspectable = files.filter((file) => /\.(?:html|js|css|json|svg|webmanifest)$/.test(file));
const bundleText = inspectable.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
assert.doesNotMatch(bundleText, /__VYBE_[A-Z0-9_]+__/, 'release contains a configuration placeholder');
for (const pattern of [
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]) {
  assert.doesNotMatch(bundleText, pattern, `release bundle matches ${pattern}`);
}

console.log(`Verified Vybe consumer-web build: ${files.length} files, ${assetRefs.length} entry assets.`);
