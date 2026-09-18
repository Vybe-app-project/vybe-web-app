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
    'achievements', 'settings', '/support',
  ];
  for (const route of required) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  }
});

test('the staff console exposes password recovery without a session', () => {
  const app = read('src/App.tsx');
  const guardedTree = app.indexOf('element={<RequireAdmin>');
  assert.ok(guardedTree > 0, 'RequireAdmin route missing');
  for (const route of ['/admin/forgot-password', '/admin/reset-password']) {
    const match = app.match(new RegExp(`path=["']${route}["']`));
    assert.ok(match, `${route} must be routed`);
    // Both pages are reached from an email or the sign-in page, so they must
    // be declared outside the RequireAdmin tree.
    assert.ok(match.index < guardedTree, `${route} must be public (declared before RequireAdmin)`);
  }

  const login = read('src/pages/admin/AdminLogin.tsx');
  assert.match(login, /to=["']\/admin\/forgot-password["']/);
  assert.match(login, /Forgot password\?/);

  // The pages talk to the two public admin routes, and only those.
  const forgot = read('src/pages/admin/AdminForgotPassword.tsx');
  assert.match(forgot, /adminApi\.post\(['"]\/admins\/request-reset['"]/);
  assert.doesNotMatch(forgot, /bootstrapAdmin/, 'forgot-password must not probe the session (401 interceptor bounces to /admin/login)');
  const reset = read('src/pages/admin/AdminResetPassword.tsx');
  assert.match(reset, /adminApi\.post\(['"]\/admins\/reset-password['"]/);
  assert.match(reset, /to=["']\/admin\/login["']/, 'success state must link back to sign-in');
  assert.match(reset, /['"]\/admin\/forgot-password['"]/, 'invalid-link states must offer a new request');
  assert.match(reset, /forgetAdminSession\(\)/, 'a successful reset must drop the tab’s admin token');

  // The token is read from ?token=, which is how email_service/adminResetMailer.js writes the link.
  assert.match(read('src/lib/passwordReset.ts'), /get\(['"]token['"]\)/);
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

test('admin sessions are tab-scoped and legacy paths still resolve', () => {
  const api = read('src/lib/api.ts');
  // The admin console shares the consumer origin; its token must not persist
  // past the tab (item 14 of the post-rebuild audit).
  assert.match(api, /getAdmin: \(\) => sessionStorage\.getItem\(ADMIN_TOKEN_KEY\)/);
  assert.match(api, /setAdmin: \(t: string\) => sessionStorage\.setItem\(ADMIN_TOKEN_KEY, t\)/);
  assert.doesNotMatch(api, /localStorage\.setItem\(ADMIN_TOKEN_KEY/);
  // Sign-out must revoke on the server: the request has to carry the token
  // explicitly and survive the navigation that follows (fetch keepalive).
  assert.match(api, /keepalive: true/);
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /revokeSession\('\/auth\/logout', tokenStore\.get\(\)\)/);
  assert.match(auth, /revokeSession\('\/admins\/logout', tokenStore\.getAdmin\(\)\)/);
  // Tertiary text must stay at or above 4.5:1 on every surface (axe sweep
  // 2026-09-18): light #526b78 on #e3ece8 = 4.67, dark #869eab on #143247 = 4.75.
  const css = read('src/styles.css');
  assert.match(css, /--text-3: #526b78;/);
  assert.match(css, /--text-3: #869eab;/);
  // aria-expanded is only valid on a combobox; the search input declares the role.
  assert.match(read('src/pages/Search.tsx'), /role="combobox"\s+aria-autocomplete="list"/);
  // The button reset must stay layered or it overrides .btn-primary's colour.
  assert.match(read('src/styles.css'), /@layer base \{\s*button \{ font: inherit; color: inherit; \}/);

  // Mobile share links are /open.html?type=…&id=…; the SPA must answer them.
  const appSrc = read('src/App.tsx');
  assert.match(appSrc, /path=["']\/open\.html["']/);
  assert.match(read('src/lib/shareLinks.ts'), /'meal-template': .*shared=|case 'meal-template':\s*return `\/meals\/templates\?shared=/s);
  assert.match(read('src/pages/Gyms.tsx'), /params\.get\('gym'\)/);
  // API-emitted links: emails carry /support.html, meal shares carry /meals/shared/<token>.
  assert.match(appSrc, /path=["']\/support\.html["']/);
  assert.match(appSrc, /path=["']meals\/shared\/:token["']/);
  assert.match(read('src/pages/WeeklyPlans.tsx'), /params\.get\('shared'\)/);

  const app = read('src/App.tsx');
  for (const legacy of ['workout-logs', 'livestreams', 'meal-templates', 'health-goals', 'water', 'explore', 'inbox']) {
    assert.match(app, new RegExp(`path=["']${legacy}["']`), `legacy path /${legacy} must redirect`);
  }
});

test('the admin catalog manager is routed, in the console nav, and talks to the catalog API as staff', () => {
  const app = read('src/App.tsx');
  // The list plus one editor route per kind ("new" and an id), all under the RequireAdmin outlet.
  for (const route of ['catalog', 'catalog/workouts/new', 'catalog/workouts/:workoutId', 'catalog/plans/new', 'catalog/plans/:planId']) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`), `missing /admin/${route}`);
  }
  const layout = read('src/pages/admin/AdminLayout.tsx');
  assert.match(layout, /\{ to: '\/admin\/catalog', label: 'Catalog', Icon: Dumbbell \}/);

  // Every catalog call carries the staff token and every path is a literal
  // the contract audit can pin; the cover upload uses the one presign purpose
  // the catalog's media verifier accepts.
  const api = read('src/pages/admin/catalogApi.ts');
  assert.doesNotMatch(api, /\bapi\.(get|post|patch|put|delete)\(/, 'catalog calls must use adminApi, never the member client');
  for (const route of ['/admin/catalog/workouts', '/admin/catalog/plans', '/upload/presign']) {
    assert.ok(api.includes(`'${route}'`), `missing literal ${route}`);
  }
  assert.match(api, /purpose: 'media'/);

  // The editors seed their form only from a fetch that settled during this
  // mount (never the cached copy TanStack serves while it refetches) and diff
  // against the record that seeded it; tests/admin-catalog-editor-seed.test.mjs
  // shows why. Back/Cancel/save return to the list view the admin came from.
  for (const [file, kind] of [['src/pages/admin/AdminCatalogWorkout.tsx', 'workout'], ['src/pages/admin/AdminCatalogPlan.tsx', 'plan']]) {
    const editor = read(file);
    assert.match(editor, /staleTime: 0/, `${file}: the detail query must refetch on every mount`);
    assert.match(editor, /seedableRecord\(detail\)/, `${file}: the draft must wait for a settled fetch`);
    assert.match(editor, new RegExp(`${kind}SessionBody\\(current\\)`), `${file}: the body must be diffed against the seeded baseline`);
    assert.doesNotMatch(editor, /build(?:Workout|Plan)Body\(/, `${file}: never diff against the live query result`);
    assert.match(editor, /catalogReturnPath\(location\.state/, `${file}: return to the list view the admin came from`);
  }
  assert.match(read('src/pages/admin/AdminCatalog.tsx'), /catalogReturnState\(location\)/);

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'GET /api/admin/catalog/workouts', 'POST /api/admin/catalog/workouts', 'GET /api/admin/catalog/workouts/:id',
    'PATCH /api/admin/catalog/workouts/:id', 'DELETE /api/admin/catalog/workouts/:id',
    'GET /api/admin/catalog/plans', 'POST /api/admin/catalog/plans', 'GET /api/admin/catalog/plans/:id',
    'PATCH /api/admin/catalog/plans/:id', 'DELETE /api/admin/catalog/plans/:id',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('public legal and deletion pages ship without placeholder configuration', () => {
  const required = [
    'privacy-policy.html',
    'terms-and-conditions.html',
    'account-deletion.html',
  ];
  for (const relative of required) {
    const source = read(path.join('public', relative));
    assert.ok(source.length > 50, `public/${relative} is unexpectedly empty`);
    assert.doesNotMatch(source, /__VYBE_[A-Z0-9_]+__/);
  }
});

test('OVH release scripts require clean immutable commit artifacts', () => {
  const local = read('scripts/release-ovh.sh');
  const remote = read('scripts/deploy-web-remote.sh');
  const rollback = read('scripts/rollback-web-remote.sh');
  assert.match(local, /git status --porcelain/);
  assert.match(local, /git archive/);
  assert.match(local, /shasum -a 256/);
  // Remote steps need root and the SSH user is unprivileged: every remote
  // privileged command must go through sudo -n so it fails fast, not hangs.
  assert.match(local, /sudo -n install -d/);
  assert.match(local, /sudo -n env VYBE_WEB_RELEASE_ROOT/);
  assert.match(read('scripts/rollback-ovh.sh'), /sudo -n env VYBE_WEB_RELEASE_ROOT/);
  assert.match(remote, /sha256sum/);
  assert.match(remote, /flock -x/);
  assert.match(remote, /releases\/\$commit_sha/);
  assert.match(remote, /mv -Tf/);
  assert.match(rollback, /releases\/\$commit_sha/);
  assert.doesNotMatch(`${local}\n${remote}\n${rollback}`, /149\.56\.18\.195/);
});
