import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function filesBelow(directory) {
  const absolute = path.join(root, directory);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(relative) : [relative];
  });
}

test('all lazy page imports resolve to committed TypeScript files', () => {
  const app = read('src/App.tsx');
  const imports = [...app.matchAll(/import\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(imports.length >= 40, `expected at least 40 lazy pages, found ${imports.length}`);
  for (const imported of imports) {
    const relative = path.join('src', `${imported.replace(/^\.\//, '')}.tsx`);
    assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
  }
});

test('the consumer and administration route families are present', () => {
  const app = read('src/App.tsx');
  const required = [
    '/login', '/register', '/admin', '/admin/login', 'discover', 'messages',
    'gyms', 'communities', 'live', 'workouts', 'meals', 'health', 'challenges',
    'achievements', 'settings', 'support',
  ];
  for (const route of required) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  }
});

test('the production client defaults to same-origin API routing', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /import\.meta\.env\.VITE_API_BASE/);
  assert.match(api, /\|\| '\/api'/);
  assert.match(api, /timeout:\s*30000/);
});

test('tracked browser source contains no credential-shaped values or fixed API hosts', () => {
  const text = filesBelow('src')
    .filter((file) => /\.(?:ts|tsx|css)$/.test(file))
    .map((file) => read(file))
    .join('\n');
  const forbidden = [
    /AKIA[0-9A-Z]{16}/,
    /AIza[0-9A-Za-z_-]{35}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /https?:\/\/[^\s"'`]+\/api(?:\/|\b)/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(text, pattern);
});

test('account deletion remains a deliberate authenticated operation', () => {
  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /api\.delete\(['"]\/users\/me['"]/);
  assert.match(settings, /DELETE_PHRASE/);
  assert.match(settings, /Permanently delete my account/);
});

test('public legal, deletion, and support pages ship without placeholder configuration', () => {
  const required = [
    'privacy-policy.html',
    'terms-and-conditions.html',
    'account-deletion.html',
    'support.html',
    'support/index.html',
    'support-client.js',
    'support-bootstrap.js',
  ];
  for (const relative of required) {
    const source = read(path.join('public', relative));
    assert.ok(source.length > 50, `public/${relative} is unexpectedly empty`);
    assert.doesNotMatch(source, /__VYBE_[A-Z0-9_]+__/);
  }
  assert.match(read('public/support.html'), /connect-src 'self'/);
  assert.match(read('public/support.html'), /content="\/api"/);
});

test('OVH release scripts require clean immutable commit artifacts', () => {
  const local = read('scripts/release-ovh.sh');
  const remote = read('scripts/deploy-web-remote.sh');
  const rollback = read('scripts/rollback-web-remote.sh');
  assert.match(local, /git status --porcelain/);
  assert.match(local, /git archive/);
  assert.match(local, /shasum -a 256/);
  assert.match(remote, /sha256sum/);
  assert.match(remote, /flock -x/);
  assert.match(remote, /releases\/\$commit_sha/);
  assert.match(remote, /mv -Tf/);
  assert.match(rollback, /releases\/\$commit_sha/);
  assert.doesNotMatch(`${local}\n${remote}\n${rollback}`, /149\.56\.18\.195/);
});
