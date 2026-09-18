import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Regression contracts for the staff-console defects fixed together (see the
 * backend's tests/admin-console-fixes.test.js for the API side). These pin
 * the client to the API contract it actually receives, so a page can no
 * longer read `preview.content` while the API sends `preview.body`.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

register('./ts-loader.mjs', import.meta.url);
const format = await import('../src/lib/format.ts');

test('plural() joins the count and noun and handles irregular plurals', () => {
  assert.equal(format.plural(1, 'like'), '1 like');
  assert.equal(format.plural(2, 'like'), '2 likes');
  assert.equal(format.plural(0, 'report'), '0 reports');
  assert.equal(format.plural(1204, 'message'), `${(1204).toLocaleString()} messages`);
  assert.equal(format.plural(2, 'entry', 'entries'), '2 entries');
});

test('fmtStamp() names the zone and honours a forced zone; isoStamp() feeds title/dateTime', () => {
  const iso = '2026-09-18T16:17:47.000Z';
  const utc = format.fmtStamp(iso, { seconds: true, timeZone: 'UTC', locale: 'en-US' });
  assert.match(utc, /Sep 18, 2026/);
  assert.match(utc, /16:17:47/);
  assert.match(utc, /UTC/, 'the zone must be spelled out');
  const eastern = format.fmtStamp(iso, { seconds: true, timeZone: 'America/New_York', locale: 'en-US' });
  assert.match(eastern, /12:17:47/);
  assert.match(eastern, /EDT|GMT-4/);
  assert.equal(format.fmtStamp(iso, { dateOnly: true, timeZone: 'UTC', locale: 'en-US' }), 'Sep 18, 2026');
  assert.equal(format.fmtStamp(undefined), '—');
  assert.equal(format.fmtStamp('not a date'), '—');
  assert.equal(format.isoStamp(iso), iso);
  assert.equal(format.isoStamp('garbage'), undefined);
});

test('ensureSentence() terminates a server message before guidance is appended', () => {
  assert.equal(format.ensureSentence('Report target is no longer available'), 'Report target is no longer available.');
  assert.equal(format.ensureSentence('Already applied.'), 'Already applied.');
  assert.equal(format.ensureSentence('Really?'), 'Really?');
  assert.equal(format.ensureSentence('   '), '');
});

test('the console pages format counts with plural() instead of hard-coded suffixes', () => {
  for (const file of [
    'src/pages/admin/AdminDashboard.tsx',
    'src/pages/admin/AdminPosts.tsx',
    'src/pages/admin/AdminReports.tsx',
    'src/pages/admin/AdminSupport.tsx',
    'src/pages/admin/AdminTrainers.tsx',
    'src/pages/admin/AdminUsers.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /\bplural\(/, `${file} must use plural()`);
    assert.doesNotMatch(source, /toLocaleString\(\)\}\s*(likes|comments|reports|messages|applications|posts|views)\b/, `${file} hard-codes a plural`);
    assert.doesNotMatch(source, /\$\{[^}]*\.toLocaleString\(\)\}\s(likes|comments|reports|messages|applications)\b/, `${file} hard-codes a plural`);
  }
  // plural lives in one place; catalogRules stays import-free.
  assert.match(read('src/components/ui.tsx'), /export \{ plural, fmtStamp, isoStamp, ensureSentence \} from '\.\.\/lib\/format'/);
  assert.doesNotMatch(read('src/pages/admin/catalogRules.ts'), /export const plural/);
});

test('Reports reads the preview contract the API sends and shows removed targets distinctly', () => {
  const source = read('src/pages/admin/AdminReports.tsx');
  // reportController.targetPreview(): { title, body, imageUrl, exists, removed }
  assert.match(source, /preview\.body/);
  assert.match(source, /preview\.imageUrl/);
  assert.match(source, /preview\.removed === true \|\| preview\.exists === false/);
  assert.match(source, /Content no longer available/);
  for (const stale of ['preview?.content', 'preview?.caption', 'preview?.thumbnail', 'preview?.medias', 'No text content']) {
    assert.doesNotMatch(source, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `stale field read: ${stale}`);
  }
  // publicOwner() sends `suspended`, not moderationSuspension.active.
  assert.match(source, /owner\?\.suspended === true/);
  assert.doesNotMatch(source, /moderationSuspension\?\.active/);
  assert.match(source, /Owner suspended/);
  // Toasts read as outcomes, not "Report suspend account".
  for (const msg of ['Marked as reviewed', 'Report dismissed', 'Content removed', 'Account suspended', 'Account restored']) {
    assert.match(source, new RegExp(`successMessage: '${msg}'`));
  }
  assert.doesNotMatch(source, /Report \$\{chosen\.label\.toLowerCase\(\)\}/);
  // Redundant / impossible actions are disabled with a reason before the round trip.
  assert.match(source, /function unavailableReason\(/);
  assert.match(source, /'Already applied'/);
  assert.match(source, /disabled=\{Boolean\(unavailable\)\}/);
  // The conflict callout is two sentences, the header badge names its tab.
  assert.match(source, /ensureSentence\(conflict\)/);
  assert.doesNotMatch(source, /<\/span> in queue/);
  assert.match(source, /\$\{total\.toLocaleString\(\)\} pending/);
});

test('Users shows suspension state and offers suspend/restore without a report', () => {
  const source = read('src/pages/admin/AdminUsers.tsx');
  assert.match(source, /moderationSuspension\?\.active === true/);
  assert.match(source, /<Shield size=\{12\} \/> Suspended/);
  assert.match(source, /adminApi\.patch\(`\/admin\/users\/\$\{user\._id\}\/suspension`/);
  assert.match(source, /action: 'suspend' \| 'restore'/);
  assert.match(source, /onMutate/, 'suspension must update optimistically');
  assert.match(source, /qc\.setQueryData\(queryKey, ctx\.previous\)/, 'and roll back on error');
  assert.match(source, /aria-label=\{`Suspend \$\{displayName\(u\)\}`\}/);
  assert.match(source, /aria-label=\{`Restore \$\{displayName\(u\)\}`\}/);
  assert.match(source, /aria-label=\{`Delete \$\{u\.username \? `@\$\{u\.username\}` : u\.email \|\| 'user'\}`\}/, 'the existing Delete label is kept');
  assert.match(source, /searchParams\.get\('search'\)/, 'Support deep-links a member with ?search=');
  assert.match(source, /useIsCompact\(\)/, 'phones get a card list');
  assert.match(source, /admin-table--actions/);
});

test('Posts pages server-side and names authors from real fields', () => {
  const source = read('src/pages/admin/AdminPosts.tsx');
  assert.match(source, /queryKey: \['admin', 'posts', page, pageSize, search, status\]/);
  assert.match(source, /params: Record<string, string \| number> = \{ page, limit: pageSize, status \}/);
  assert.match(source, /placeholderData: keepPreviousData/);
  assert.doesNotMatch(source, /returns the full collection in one payload/);
  assert.match(source, /a\.fullName \|\| a\.name \|\| handle \|\| a\.email \|\| 'Unknown author'/);
  assert.match(source, /likeCount/);
  assert.match(source, /commentCount/);
  // Text-only posts get a text glyph, not a broken-image glyph.
  assert.match(source, /<AlignLeft size=\{16\} \/>/);
  assert.match(source, /aria-label="Text-only post"/);
  assert.match(source, /aria-label=\{`Delete post by \$\{authorName\}`\}/);
  assert.match(read('src/components/icons.tsx'), /export const AlignLeft = /);
});

test('Dashboard cannot overflow a phone and names authors', () => {
  const source = read('src/pages/admin/AdminDashboard.tsx');
  assert.doesNotMatch(source, /className="grid gap-4 lg:grid-cols-2"/, '1fr tracks size to min-content and overflow the viewport');
  assert.equal((source.match(/grid-cols-\[minmax\(0,1fr\)\] gap-4 lg:grid-cols-\[repeat\(2,minmax\(0,1fr\)\)\]/g) || []).length, 4);
  assert.match(source, /<Card className="min-w-0 overflow-hidden">/);
  assert.match(source, /w-24 shrink-0 text-right/, 'the trending stats column has a fixed width');
  assert.match(source, /p\.author\?\.fullName \|\| p\.author\?\.name \|\| handle \|\| 'Unknown author'/);
  assert.doesNotMatch(source, /The analytics endpoint is not reporting this metric yet/);
  assert.match(source, /a\.userGrowth/);
  assert.match(source, /a\.postGrowth/);
});

test('System probes the API under /api and treats a non-JSON answer as "not exposed"', () => {
  const source = read('src/pages/admin/AdminSystem.tsx');
  assert.match(source, /health: '\/system\/health', ready: '\/system\/ready'/);
  assert.match(source, /adminApi\.get\(PROBES\.health\)/);
  assert.match(source, /adminApi\.get\(PROBES\.ready\)/);
  assert.doesNotMatch(source, /originApi/);
  assert.doesNotMatch(source, /axios\.create/);
  assert.match(source, /Probe not exposed on this origin/);
  // Bounded table: top 25 by volume with a toggle, keys truncated with a tooltip.
  assert.match(source, /const TOP_ROUTES = 25/);
  assert.match(source, /rows\.slice\(0, TOP_ROUTES\)/);
  assert.match(source, /aria-expanded=\{showAllRoutes\}/);
  assert.match(source, /title=\{r\.key\}/);
});

test('Trainers requires a reject reason up front and drops decision buttons once decided', () => {
  const source = read('src/pages/admin/AdminTrainers.tsx');
  assert.match(source, /'Decision note \(required\)'/);
  assert.match(source, /const noteTooShort = rejecting && note\.trim\(\)\.length < REJECT_NOTE_MIN/);
  assert.match(source, /if \(noteTooShort\) return;/);
  assert.match(source, /\{isPending \? \(/);
  assert.equal((source.match(/disabled=\{!isPending\}/g) || []).length, 2);
  assert.match(source, /Decision recorded/);
});

test('Admins collapses row actions into an overflow menu on phones', () => {
  const source = read('src/pages/admin/AdminAdmins.tsx');
  assert.match(source, /useIsCompact\(\)/);
  assert.match(source, /label=\{`Actions for \$\{name\}`\}/);
  assert.match(source, /<div className="min-w-0 flex-1">/);
  for (const label of ['View', 'Edit', 'Remove']) {
    assert.match(source, new RegExp(`aria-label=\\{\`${label} \\$\\{name\\}\`\\}`), `desktop keeps the ${label} label`);
  }
});

test('Audit log: nav is super-only, 403 is informational, filter types come from the API, request block hides blanks', () => {
  const layout = read('src/pages/admin/AdminLayout.tsx');
  assert.match(layout, /\{ to: '\/admin\/audit', label: 'Audit log', Icon: List, superOnly: true \}/);
  assert.match(layout, /NAV\.filter\(\(item\) => !item\.superOnly \|\| !me\.role \|\| isSuper\)/);
  assert.match(layout, /export function Stamp\(/);

  const audit = read('src/pages/admin/AdminAudit.tsx');
  assert.match(audit, /status === 403/);
  assert.match(audit, /Super admin access only/);
  assert.doesNotMatch(audit, /\['user', 'post', 'admin', 'report', 'comment', 'support'\]/);
  assert.match(audit, /query\.data\?\.targetTypes/);
  assert.match(audit, /function compactObject\(/);
  assert.match(audit, /<Stamp iso=\{e\.createdAt\} seconds \/>/);
  assert.match(audit, /timeZone: 'UTC'/, 'the detail dialog shows the UTC reading too');
});

test('Support links Member badges to the account and formats counts', () => {
  const source = read('src/pages/admin/AdminSupport.tsx');
  assert.match(source, /m\.member \|\| m\.userId/);
  assert.match(source, /to=\{`\/admin\/users\?search=\$\{encodeURIComponent\(m\.member\?\.username \|\| m\.email \|\| ''\)\}`\}/);
  assert.match(source, /plural\(total, 'message'\)/);
});

test('the console renders every timestamp with its zone (no bare date-fns clock strings)', () => {
  for (const file of [
    'src/pages/admin/AdminAudit.tsx',
    'src/pages/admin/AdminReports.tsx',
    'src/pages/admin/AdminSupport.tsx',
    'src/pages/admin/AdminUsers.tsx',
    'src/pages/admin/AdminPosts.tsx',
    'src/pages/admin/AdminTrainers.tsx',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /format\(new Date\([^)]*\), '[^']*HH:mm/, `${file} renders a bare local clock`);
    assert.match(source, /Stamp/, `${file} must use <Stamp> / fmtStamp`);
  }
});

test('the backend route snapshot includes the routes the console now calls', () => {
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const routes = new Set(snapshot.routes.map((r) => `${r.method} ${r.path}`));
  for (const route of [
    'GET /api/system/health',
    'GET /api/system/ready',
    'PATCH /api/admin/users/:userId/suspension',
    'GET /api/admin/posts',
    'GET /api/admins/audit-log',
  ]) {
    assert.ok(routes.has(route), `snapshot missing ${route}`);
  }
});
