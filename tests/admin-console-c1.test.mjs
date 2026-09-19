import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Source pins for the Wave C1 admin-console adoption (API 4e22914): the
 * routes the console calls, the payload fields it reads, and the strings
 * other suites and the mobile flows rely on. Kept apart from
 * admin-console.test.mjs so parallel areas editing that file do not
 * conflict with these.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (source, literal, why) => assert.match(source, new RegExp(escape(literal)), why ?? `missing ${literal}`);
const lacks = (source, literal, why) => assert.doesNotMatch(source, new RegExp(escape(literal)), why ?? `stale ${literal}`);

test('System reads notification health, the API version and p50/p95, and keeps its probe pins', () => {
  const source = read('src/pages/admin/AdminSystem.tsx');
  has(source, "adminApi.get('/admin/notifications/health')");
  has(source, "adminApi.get('/version')");
  has(source, "adminApi.get('/admin/performance')");
  has(source, 'p50Time');
  has(source, 'p95Time');
  has(source, 'Worst p95');
  has(source, 'aria-label="Sort routes"');
  has(source, 'rankByP95(');
  has(source, 'perfRows(');
  has(source, 'NotificationJobsCard');
  has(source, 'ApiBuildCard');
  // The page must not retry a 429 or poll through Retry-After.
  has(source, 'retryUnlessLimited');
  has(source, 'pollEvery(');
  lacks(source, 'refetchInterval: 30_000', 'polls must go through pollEvery so a 429 pauses them');
  // Pins from admin-console.test.mjs that this area must keep.
  has(source, "adminApi.get('/system/health')");
  has(source, "adminApi.get('/system/ready')");
  has(source, 'const TOP_ROUTES = 25');
  has(source, 'rows.slice(0, TOP_ROUTES)');
  has(source, 'aria-expanded={showAllRoutes}');
  has(source, 'title={r.key}');
  has(source, 'Reported at <Stamp iso={health.data.timestamp} seconds />');
  lacks(source, 'errMsg(', 'System toasts and probe errors go through describeAdminError');
});

test('Dashboard reads clientAdoption into a full-width card without a fifth two-column grid', () => {
  const source = read('src/pages/admin/AdminDashboard.tsx');
  has(source, 'clientAdoption');
  has(source, 'adoptionRows(');
  has(source, 'ClientAdoptionTable');
  has(source, 'title="Client adoption"');
  assert.equal(
    (source.match(/grid-cols-\[minmax\(0,1fr\)\] gap-4 lg:grid-cols-\[repeat\(2,minmax\(0,1fr\)\)\]/g) || []).length,
    4,
    'the adoption card is a Card, not another pinned grid',
  );
  const cards = read('src/pages/admin/adminCards.tsx');
  has(cards, 'No client reports yet');
  has(cards, 'X-Vybe-Client');
});

test('Reports carries the v2 contract: appeals tab and filter, statement, rule, duration, mark_sensitive, decide appeal', () => {
  const source = read('src/pages/admin/AdminReports.tsx');
  has(source, "appeal: 'open'");
  has(source, '/appeal`');
  has(source, 'decision');
  has(source, "'mark_sensitive'");
  has(source, 'durationDays');
  has(source, 'GUIDELINES');
  has(source, 'Decide appeal');
  has(source, 'Take action');
  has(source, 'APPEAL_REVIEWER_CONFLICT');
  has(source, 'function unavailableReason(');
  has(source, "successMessage: 'Post marked sensitive'");
  has(source, 'aria-label="Appeal filter"');
  has(source, "{ key: 'appeals', label: 'Appeals' }");
  has(source, 'canDecideAppeal(');
  has(source, 'slaState(');
  has(source, 'slaLabel(');
  has(source, 'StatementBlock');
  has(source, 'AppealBlock');
  has(source, 'describeAdminError(');
  has(source, "queryKey: ['admin', 'reports'");
  has(source, "queryKey: ['admin', 'queue']");
  // The PATCH body is built by the pure helper pinned in admin-ops-formatters.
  has(source, 'moderationBody({ action, note, rule, durationDays: duration })');
  lacks(source, 'body.durationDays =', 'durationDays is decided by moderationBody, not the page');
  // Field problems sit on the field (aria-invalid + described by), not only in the foot callout.
  has(source, 'error={noteErr ?? undefined}');
  has(source, 'error={durationErr ?? undefined}');
  // The SLA state is in the badge text; no hover-only title carries it.
  has(source, 'slaLabel(sla)');
  lacks(source, "title={sla.state === 'overdue'", 'the SLA state must be readable without hovering');
  // Reversal consequence follows the statement action, not the target type.
  has(source, 'reversalDescription(report)');
  lacks(source, 'RESTORABLE_TARGETS', 'the page does not key the consequence on targetType any more');
  // Pins from admin-console.test.mjs that this area must keep.
  has(source, "if (report.status === 'actioned' && action !== 'restore_user') return 'Report already actioned';");
  has(source, '${total.toLocaleString()} pending');
  lacks(source, "import { format } from 'date-fns'");
  lacks(source, 'errMsg(', 'Reports errors go through describeAdminError');
  has(source, 'Stamp');
});

test('the layout polls queue counts with one-row list calls and badges the Reports entry', () => {
  const source = read('src/pages/admin/AdminLayout.tsx');
  has(source, 'export function useQueueCounts(');
  has(source, "queryKey: ['admin', 'queue']");
  has(source, "params: { status: 'pending', limit: 1 }");
  has(source, "params: { appeal: 'open', limit: 1 }");
  has(source, 'retry: false');
  has(source, "badge: 'reports'");
  has(source, 'CountBadge');
  has(source, "plural(pending, 'pending report')");
  has(source, "plural(appeals, 'open appeal')");
  // Pins other suites rely on.
  has(source, "{ to: '/admin/audit', label: 'Audit log', Icon: List, superOnly: true }");
  has(source, 'NAV.filter((item) => !item.superOnly || !me.role || isSuper)');
  has(source, 'export function Stamp(');
});

test('Users no longer reads the premium flag the API stopped sending', () => {
  const source = read('src/pages/admin/AdminUsers.tsx');
  lacks(source, 'isPremium');
  lacks(source, 'isSubscribed');
  // Suspension pins stay.
  has(source, 'moderationSuspension?.active === true');
  has(source, '<Shield size={12} /> Suspended');
});

test('shared helpers: errMsg reads the envelope object and bootstrapAdmin keeps the token off a 429', () => {
  const api = read('src/lib/api.ts');
  lacks(api, 'if (d?.error) return d.error;', 'the envelope error is an object; read its message');
  has(api, "typeof d.error === 'object' && typeof d.error.message === 'string'");
  const auth = read('src/lib/auth.ts');
  const bootstrap = auth.slice(auth.indexOf('bootstrapAdmin: async () => {'), auth.indexOf('setUser: (u) => {'));
  has(bootstrap, 'isSessionRejected(error)');
  has(bootstrap, 'data?.data?.admin ?? data?.admin ?? data');
  has(bootstrap, 'admin: get().admin ?? {}');
  assert.doesNotMatch(bootstrap, /catch \{\s*tokenStore\.clearAdmin\(\);/, 'a bare catch cleared the token on every error');
});

test('the admin error helper is pure and reads only the two exposed headers', () => {
  const source = read('src/lib/apiError.ts');
  has(source, "import type { AxiosError } from 'axios'");
  assert.doesNotMatch(source.replace(/import type[^\n]*\n/, ''), /^import /m, 'apiError.ts must not import runtime modules');
  has(source, "'x-request-id'");
  has(source, "'retry-after'");
  lacks(source, 'authorization');
  for (const file of ['src/lib/adminOps.ts', 'src/lib/adminReports.ts']) {
    assert.doesNotMatch(read(file), /^import /m, `${file} must stay import-free`);
  }
});

test('the backend route snapshot lists every route the console now calls (read-only assertion)', () => {
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const routes = new Set(snapshot.routes.map((r) => `${r.method} ${r.path}`));
  for (const route of [
    'GET /api/admin/notifications/health',
    'GET /api/admin/performance',
    'GET /api/admin/reports',
    'PATCH /api/admin/reports/:reportId',
    'PATCH /api/admin/reports/:reportId/appeal',
    'GET /api/version',
    'GET /api/admin/analytics',
    'GET /api/capabilities',
  ]) {
    assert.ok(routes.has(route), `snapshot missing ${route}`);
  }
});
