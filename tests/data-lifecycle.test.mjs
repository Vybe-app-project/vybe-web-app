/**
 * Wave C1 data lifecycle (Settings > Account): re-auth before deletion and
 * exports, scheduled deletion with the API's grace period, the pending
 * banner on sign-in, and the export job list. Pure logic imports the real
 * src/lib modules; source pins hold the X-Reauth header on both guarded
 * calls; render tests go through react-dom/server against the real providers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const lib = await import('../src/lib/accountLifecycle.ts');

const UTC = { timeZone: 'UTC', locale: 'en-US' };
const squash = (s) => s.replace(/\s+/g, ' ');

const job = (overrides = {}) => ({
  id: '6aadf00d00000000000000a1',
  status: 'ready',
  scopes: ['account', 'social'],
  requestedAt: '2026-09-19T10:00:00.000Z',
  startedAt: '2026-09-19T10:00:05.000Z',
  readyAt: '2026-09-19T10:01:00.000Z',
  expiresAt: '2026-09-26T10:01:00.000Z',
  archiveBytes: 13_000_000,
  fileName: 'vybe-export.zip',
  downloadCount: 0,
  lastDownloadAt: null,
  downloadable: true,
  ...overrides,
});

/* ------------------------------------------------------------------ pure */

test('export state labels: every API status maps to a label and tone, and a stale ready job reads as expired', () => {
  const now = Date.parse('2026-09-20T00:00:00Z');
  assert.deepEqual(lib.exportStateLabel(job({ status: 'queued', downloadable: false }), now), { label: 'Queued', tone: 'info' });
  assert.deepEqual(lib.exportStateLabel(job({ status: 'processing', downloadable: false }), now), { label: 'Building', tone: 'info' });
  assert.deepEqual(lib.exportStateLabel(job(), now), { label: 'Ready', tone: 'success' });
  assert.deepEqual(lib.exportStateLabel(job({ downloadable: false }), now), { label: 'Expired', tone: 'neutral' }, 'ready but not downloadable');
  assert.deepEqual(
    lib.exportStateLabel(job({ expiresAt: '2026-09-19T12:00:00Z' }), now),
    { label: 'Expired', tone: 'neutral' },
    'ready with expiresAt in the past, before the sweep flips it',
  );
  assert.deepEqual(lib.exportStateLabel(job({ status: 'expired', downloadable: false }), now), { label: 'Expired', tone: 'neutral' });
  assert.deepEqual(lib.exportStateLabel(job({ status: 'cancelled', downloadable: false }), now), { label: 'Cancelled', tone: 'neutral' });
  for (const code of ['BUILD_FAILED', 'LEASE_EXPIRED', 'USER_MISSING', 'SOMETHING_ELSE', undefined]) {
    const failed = lib.exportStateLabel(job({ status: 'failed', downloadable: false, error: code ? { code } : undefined }), now);
    assert.equal(failed.label, 'Failed');
    assert.equal(failed.tone, 'danger');
    assert.equal(typeof failed.detail, 'string');
    assert.ok(failed.detail.length > 0);
    if (code) assert.ok(!failed.detail.includes(code), `failure copy must not leak ${code}`);
    assert.ok(!lib.exportFailureCopy(code).includes(String(code)));
  }
  // Which jobs still move on their own, and which block a new request.
  assert.equal(lib.isExportActive({ status: 'queued' }), true);
  assert.equal(lib.isExportActive({ status: 'processing' }), true);
  assert.equal(lib.isExportActive({ status: 'ready' }), false);
  assert.equal(lib.isExportBlocking(job(), now), true);
  assert.equal(lib.isExportBlocking(job({ downloadable: false }), now), false);
  assert.equal(lib.isExportBlocking(job({ status: 'failed', downloadable: false }), now), false);
});

test('deletion and export dates format for a person, with an em dash for nothing', () => {
  assert.equal(squash(lib.formatDeletionDate('2026-10-03T13:04:32Z', UTC)), 'October 3, 2026 at 1:04 PM');
  assert.equal(lib.formatDateOnly('2026-10-03T13:04:32Z', UTC), 'October 3, 2026');
  assert.equal(lib.formatShortDate('2026-09-19T10:00:00Z', UTC), 'Sep 19, 2026');
  for (const empty of ['', null, undefined, 'not a date']) {
    assert.equal(lib.formatDeletionDate(empty, UTC), '—');
    assert.equal(lib.formatDateOnly(empty, UTC), '—');
    assert.equal(lib.formatShortDate(empty, UTC), '—');
  }
  assert.equal(squash(lib.pendingDeletionTitle('2026-10-03T13:04:32Z', UTC)), 'Your account is scheduled for deletion on October 3, 2026 at 1:04 PM.');
  assert.equal(lib.formatArchiveSize(13_000_000), '12.4 MB');
  assert.equal(lib.formatArchiveSize(839_680), '820 KB');
  assert.equal(lib.formatArchiveSize(null), '—');
});

test('the one-per-window rule is explained from the policy, with the next date only while it blocks', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  const open = lib.exportWindowCopy({ windowDays: 7, expiryDays: 7, nextAllowedAt: null }, { ...UTC, now });
  assert.equal(open.rule, 'You can request one copy every 7 days. Each copy stays available for 7 days after it is ready.');
  assert.equal(open.next, null);
  const blocked = lib.exportWindowCopy({ windowDays: 7, expiryDays: 7, nextAllowedAt: '2026-09-26T10:00:00Z' }, { ...UTC, now });
  assert.equal(blocked.next, 'You can request another copy on September 26, 2026.');
  const past = lib.exportWindowCopy({ windowDays: 1, expiryDays: 1, nextAllowedAt: '2026-09-18T10:00:00Z' }, { ...UTC, now });
  assert.equal(past.rule, 'You can request one copy every 1 day. Each copy stays available for 1 day after it is ready.');
  assert.equal(past.next, null, 'a past nextAllowedAt does not block');
});

test('REAUTH_REQUIRED is the only 401 that reopens the dialog, and re-auth failures read as one sentence', () => {
  const http = (status, data, code) => ({ code, response: { status, data } });
  assert.equal(lib.isReauthRequired(http(401, { code: 'REAUTH_REQUIRED', message: 'Confirm it is you to continue' })), true);
  assert.equal(lib.isReauthRequired(http(401, { message: 'User not found' })), false, 'a bare 401 is a session problem');
  assert.equal(lib.isReauthRequired(http(400, { code: 'REAUTH_FAILED' })), false);
  assert.equal(lib.isReauthRequired(new Error('boom')), false);
  assert.equal(lib.isReauthRequired(null), false);
  assert.deepEqual(
    lib.reauthMethodsFromError(http(401, { code: 'REAUTH_REQUIRED', methods: { password: true, emailCode: false, scheduledWithoutReauth: false } })),
    { password: true, emailCode: false, scheduledWithoutReauth: false },
  );
  assert.equal(lib.reauthMethodsFromError(http(401, { code: 'REAUTH_REQUIRED' })), null);

  assert.equal(lib.reauthErrorCopy(http(400, { code: 'REAUTH_FAILED', message: 'That password is not right' })), 'That password is not right.');
  assert.equal(
    lib.reauthErrorCopy(http(400, { code: 'REAUTH_FAILED', message: 'That code is not right or has expired' })),
    'That code is not right or has expired.',
  );
  assert.equal(lib.reauthErrorCopy(http(400, { code: 'VALIDATION', message: 'Invalid code', field: 'code' })), 'Enter the 6-digit code from your email.');
  assert.equal(lib.reauthErrorCopy(http(409, { code: 'REAUTH_METHOD_UNAVAILABLE', message: 'This account has no password. Use an email code instead' })), lib.NO_PASSWORD_REAUTH_COPY);
  assert.equal(lib.reauthErrorCopy(http(429, { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later.' })), lib.RATE_LIMITED_REAUTH_COPY);
  assert.equal(lib.reauthErrorCopy(http(undefined, undefined, 'ERR_NETWORK')), lib.OFFLINE_REAUTH_COPY);
  assert.equal(lib.reauthErrorCopy(http(503, { message: 'Email code sign-in is temporarily unavailable' })), 'Email code sign-in is temporarily unavailable.');
  assert.equal(lib.reauthErrorCopy({}, 'Fallback.'), 'Fallback.');
});

test('the sign-in notice is one-shot and the re-auth cache is memory-only with a safety margin', () => {
  // A minimal sessionStorage so the store can be exercised under Node.
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.equal(lib.lifecycleNotice.take(), null);
    lib.lifecycleNotice.set({ kind: 'scheduled', scheduledFor: '2026-10-03T13:04:32Z', graceDays: 14 });
    assert.ok(store.has('vybe.lifecycleNotice'));
    assert.deepEqual(lib.lifecycleNotice.take(), { kind: 'scheduled', scheduledFor: '2026-10-03T13:04:32Z', graceDays: 14 });
    assert.equal(lib.lifecycleNotice.take(), null, 'read once');
    store.set('vybe.lifecycleNotice', '{"kind":"nonsense"}');
    assert.equal(lib.lifecycleNotice.take(), null, 'unknown shapes are dropped');
    store.set('vybe.lifecycleNotice', 'not json');
    assert.equal(lib.lifecycleNotice.take(), null);
  } finally {
    delete globalThis.sessionStorage;
  }

  const scheduled = lib.lifecycleNoticeCopy({ kind: 'scheduled', scheduledFor: '2026-10-03T13:04:32Z', graceDays: 14 }, UTC);
  assert.equal(scheduled.tone, 'warning');
  assert.equal(squash(scheduled.title), 'Your account is scheduled for deletion on October 3, 2026 at 1:04 PM.');
  assert.match(scheduled.body, /Cancel deletion/);
  const deleted = lib.lifecycleNoticeCopy({ kind: 'deleted', completedAt: '2026-09-19T13:04:32Z', backupsPurgeBy: '2026-10-03T13:04:32Z' }, UTC);
  assert.equal(deleted.tone, 'success');
  assert.equal(squash(deleted.title), 'Your account was deleted on September 19, 2026 at 1:04 PM.');
  assert.equal(deleted.body, 'Copies in backups are overwritten by October 3, 2026.');
  const processing = lib.lifecycleNoticeCopy({ kind: 'deleted', completedAt: '2026-09-19T13:04:32Z', backupsPurgeBy: null }, UTC);
  assert.match(processing.body, /backup cycle/);

  const t0 = Date.parse('2026-09-19T12:00:00Z');
  lib.reauthCache.clear();
  assert.equal(lib.reauthCache.get(30_000, t0), null);
  lib.reauthCache.set({ reauthToken: 'tok', expiresIn: 600, expiresAt: new Date(t0 + 600_000).toISOString() }, t0);
  assert.equal(lib.reauthCache.get(30_000, t0), 'tok');
  assert.equal(lib.reauthCache.get(30_000, t0 + 580_000), null, 'less than the margin left');
  lib.reauthCache.set({ reauthToken: 'tok2', expiresIn: 600, expiresAt: 'garbage' }, t0);
  assert.equal(lib.reauthCache.get(30_000, t0 + 500_000), 'tok2', 'falls back to expiresIn');
  lib.reauthCache.clear();
  assert.equal(lib.reauthCache.get(30_000, t0), null);
});

test('the re-auth gate decides from the cached token, the waiver and the error, never from the string in the UI', () => {
  const http = (status, data, code) => ({ code, response: { status, data } });
  const methods = { password: true, emailCode: false, scheduledWithoutReauth: false };

  // First attempt: a cached token is tried before anyone is asked.
  assert.deepEqual(lib.reauthGateDecision({ phase: 'start', cachedToken: 'tok', waive: false }), { kind: 'run', token: 'tok' });
  assert.deepEqual(lib.reauthGateDecision({ phase: 'start', cachedToken: 'tok', waive: true }), { kind: 'run', token: 'tok' }, 'a token beats a waiver');
  assert.deepEqual(lib.reauthGateDecision({ phase: 'start', cachedToken: null, waive: true }), { kind: 'run', token: null }, 'the waived path sends no header');
  assert.deepEqual(lib.reauthGateDecision({ phase: 'start', cachedToken: null, waive: false }), { kind: 'prompt', methods: null, clearCache: false });

  // After a failure: only 401 REAUTH_REQUIRED opens (or keeps open) the dialog, and it voids the cache.
  assert.deepEqual(
    lib.reauthGateDecision({ phase: 'failed', error: http(401, { code: 'REAUTH_REQUIRED', methods }) }),
    { kind: 'prompt', methods, clearCache: true },
    'the proofs the API named travel into the dialog',
  );
  assert.deepEqual(
    lib.reauthGateDecision({ phase: 'failed', error: http(401, { code: 'REAUTH_REQUIRED' }) }),
    { kind: 'prompt', methods: null, clearCache: true },
  );
  assert.deepEqual(lib.reauthGateDecision({ phase: 'failed', error: http(401, { message: 'User not found' }) }), { kind: 'reject' }, 'a bare 401 is the interceptor\'s');
  assert.deepEqual(lib.reauthGateDecision({ phase: 'failed', error: http(500, { code: 'SERVER_ERROR' }) }), { kind: 'reject' });
  assert.deepEqual(lib.reauthGateDecision({ phase: 'failed', error: http(409, { code: 'DELETION_ALREADY_SCHEDULED' }) }), { kind: 'reject' });
  assert.deepEqual(lib.reauthGateDecision({ phase: 'failed', error: new Error('boom') }), { kind: 'reject' });

  // Cancel: refused while the guarded request is in flight, otherwise resolves null.
  assert.deepEqual(lib.reauthGateDecision({ phase: 'cancel', inFlight: true }), { kind: 'ignore' });
  assert.deepEqual(lib.reauthGateDecision({ phase: 'cancel', inFlight: false }), { kind: 'cancelled' });

  // A body that is not the API's JSON never reaches the person; the status speaks.
  assert.equal(lib.lifecycleStatusCopy(0), lib.OFFLINE_REAUTH_COPY);
  assert.equal(lib.lifecycleStatusCopy(429), lib.RATE_LIMITED_REAUTH_COPY);
  assert.equal(lib.lifecycleStatusCopy(502), lib.GENERIC_FAILURE_COPY);
  assert.equal(lib.lifecycleStatusCopy(524), lib.GENERIC_FAILURE_COPY);
  assert.equal(lib.lifecycleStatusCopy(404), lib.GENERIC_FAILURE_COPY);
});

test('lifecycleRequest: headers, error shapes, dropped non-JSON bodies, and a 401 that never ends the session', async () => {
  const lifecycleApi = await import('../src/lib/lifecycleApi.ts');
  const { errMsg } = await import('../src/lib/api.ts');
  const calls = [];
  const originalFetch = globalThis.fetch;
  const tokenStore = new Map([['vybe.token', 'session-token']]);
  // A token in storage and a location: both must be untouched by a lifecycle 401.
  globalThis.localStorage = {
    getItem: (k) => (tokenStore.has(k) ? tokenStore.get(k) : null),
    setItem: (k, v) => tokenStore.set(k, String(v)),
    removeItem: (k) => tokenStore.delete(k),
  };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.location = { href: 'https://vybeapp.fit/settings', pathname: '/settings', search: '' };
  const answer = (status, body, headers = {}) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(body, { status, headers });
    };
  };
  const failWith = (error) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      throw error;
    };
  };
  try {
    // Request shape: bearer, platform, JSON in and out, extra headers merged.
    answer(200, JSON.stringify({ reauthToken: 'r1', expiresIn: 600, expiresAt: '2026-09-19T12:10:00.000Z' }), { 'content-type': 'application/json' });
    const issued = await lifecycleApi.reauthenticate({ password: 'pw' });
    assert.equal(issued.reauthToken, 'r1');
    assert.equal(calls.at(-1).url, '/api/auth/reauth');
    assert.equal(calls.at(-1).init.method, 'POST');
    assert.equal(calls.at(-1).init.body, JSON.stringify({ password: 'pw' }));
    assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer session-token');
    assert.equal(calls.at(-1).init.headers['X-Platform'], 'web');
    assert.equal(calls.at(-1).init.headers['Content-Type'], 'application/json');
    assert.equal(calls.at(-1).init.headers.Accept, 'application/json');
    assert.ok(calls.at(-1).init.signal instanceof AbortSignal, 'a timeout is armed');

    answer(200, JSON.stringify({ pendingDeletion: false, deletion: null, graceDays: 14, backupRetentionDays: 14, reauth: { password: true, emailCode: true, scheduledWithoutReauth: false } }));
    const status = await lifecycleApi.getDeletionStatus();
    assert.equal(status.graceDays, 14);
    assert.equal(calls.at(-1).init.method, 'GET');
    assert.equal(calls.at(-1).init.body, undefined);
    assert.equal(calls.at(-1).init.headers['Content-Type'], undefined, 'no content type without a body');

    // 401 REAUTH_REQUIRED: a LifecycleHttpError the gate recognises, methods intact, session intact.
    answer(401, JSON.stringify({ code: 'REAUTH_REQUIRED', message: 'Confirm it is you to continue', methods: { password: true, emailCode: false, scheduledWithoutReauth: false } }));
    const reauth = await lifecycleApi.cancelScheduledDeletion().then(() => null, (e) => e);
    assert.ok(reauth instanceof lifecycleApi.LifecycleHttpError);
    assert.equal(reauth.response.status, 401);
    assert.equal(lib.isReauthRequired(reauth), true);
    assert.deepEqual(lib.reauthMethodsFromError(reauth), { password: true, emailCode: false, scheduledWithoutReauth: false });
    assert.deepEqual(lib.reauthGateDecision({ phase: 'failed', error: reauth }).kind, 'prompt');
    assert.equal(tokenStore.get('vybe.token'), 'session-token', 'the session token is still there');
    assert.equal(globalThis.location.href, 'https://vybeapp.fit/settings', 'no redirect to the sign-in page');

    // JSON API errors keep their code and message for errMsg and reauthErrorCopy.
    answer(400, JSON.stringify({ code: 'REAUTH_FAILED', message: 'That password is not right' }));
    const failed = await lifecycleApi.reauthenticate({ password: 'nope' }).then(() => null, (e) => e);
    assert.equal(failed.response.status, 400);
    assert.equal(lib.httpCodeOf(failed), 'REAUTH_FAILED');
    assert.equal(lib.reauthErrorCopy(failed), 'That password is not right.');
    assert.equal(errMsg(failed), 'That password is not right');

    // The global limiter answers plain text: the text is dropped, the status speaks.
    answer(429, 'Too many requests, please try again later.', { 'content-type': 'text/html; charset=utf-8', 'retry-after': '60' });
    const limited = await lifecycleApi.reauthenticate({ password: 'pw' }).then(() => null, (e) => e);
    assert.equal(limited.response.status, 429);
    assert.equal(limited.response.data, null);
    assert.equal(limited.message, lib.RATE_LIMITED_REAUTH_COPY);
    assert.equal(lib.reauthErrorCopy(limited), lib.RATE_LIMITED_REAUTH_COPY);
    assert.equal(errMsg(limited, 'Fallback.'), lib.RATE_LIMITED_REAUTH_COPY);

    // A gateway's HTML page (502/503/524) is never shown.
    for (const status of [502, 503, 524]) {
      answer(status, '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>cloudflare</body></html>', { 'content-type': 'text/html' });
      const gateway = await lifecycleApi.cancelScheduledDeletion().then(() => null, (e) => e);
      assert.equal(gateway.response.status, status);
      assert.equal(gateway.response.data, null);
      assert.equal(gateway.message, lib.GENERIC_FAILURE_COPY);
      assert.doesNotMatch(errMsg(gateway, 'Fallback.'), /html|cloudflare|Bad Gateway/i);
      assert.doesNotMatch(lib.reauthErrorCopy(gateway), /html|cloudflare|Bad Gateway/i);
    }

    // A 2xx that is not JSON (captive portal) is a failure, not a body to read fields off.
    answer(200, '<html>Sign in to the network</html>', { 'content-type': 'text/html' });
    const portal = await lifecycleApi.getDeletionStatus().then(() => null, (e) => e);
    assert.ok(portal instanceof lifecycleApi.LifecycleHttpError);
    assert.equal(portal.code, 'ERR_BAD_RESPONSE');
    assert.equal(portal.message, lib.GENERIC_FAILURE_COPY);

    // Timeout and network failure carry the axios-style codes the copy helpers read.
    failWith(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const timedOut = await lifecycleApi.reauthenticate({ code: '123456' }).then(() => null, (e) => e);
    assert.equal(timedOut.code, 'ECONNABORTED');
    assert.equal(timedOut.response.status, 0);
    assert.equal(timedOut.message, lib.OFFLINE_REAUTH_COPY);
    assert.equal(lib.reauthErrorCopy(timedOut), lib.OFFLINE_REAUTH_COPY);
    failWith(new TypeError('Failed to fetch'));
    const offline = await lifecycleApi.cancelScheduledDeletion().then(() => null, (e) => e);
    assert.equal(offline.code, 'ERR_NETWORK');
    assert.equal(errMsg(offline, 'Fallback.'), lib.OFFLINE_REAUTH_COPY);
    assert.equal(tokenStore.get('vybe.token'), 'session-token');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.location;
  }
});

/* ------------------------------------------------------------------ source pins */

test('both re-auth guarded calls send X-Reauth, and the lifecycle wiring is in place', () => {
  const deleteAccount = read('src/pages/settings/DeleteAccount.tsx');
  assert.match(deleteAccount, /api\.delete\(['"]\/users\/me['"],\s*\{[^}]*headers:\s*[^}]*'X-Reauth'/s);
  assert.match(deleteAccount, /data:\s*\{\s*mode/);
  assert.match(deleteAccount, /timeout:\s*120_?000/, 'inline deletion can outlive the 30 s default');
  assert.match(deleteAccount, /lifecycleNotice\.set\(\{\s*kind:\s*'scheduled'/);
  assert.match(deleteAccount, /lifecycleNotice\.set\(\{\s*kind:\s*'deleted'/);
  assert.match(deleteAccount, /useAuth\.getState\(\)\.logout\(\)/);
  assert.match(deleteAccount, /DELETION_ALREADY_SCHEDULED/);
  assert.match(deleteAccount, /export const DELETE_PHRASE = 'DELETE MY ACCOUNT'/);
  assert.match(deleteAccount, /id="del-phrase"/, 'existing id kept');
  assert.match(deleteAccount, /id="delete"/, 'existing card id kept');
  assert.match(deleteAccount, /days to change your mind/, 'the card describes both paths');
  assert.doesNotMatch(deleteAccount, /description="This permanently deletes/, 'the old "cannot be undone" description contradicted the scheduled path');

  const dataExport = read('src/pages/settings/DataExport.tsx');
  assert.match(dataExport, /api\.post\(['"]\/users\/me\/exports['"],[\s\S]{0,120}'X-Reauth'/);
  assert.match(dataExport, /\/download`[\s\S]{0,160}'X-Reauth'/);
  assert.match(dataExport, /window\.location\.assign\(/);
  assert.match(dataExport, /api\.get<ExportList>\('\/users\/me\/exports'\)/);
  assert.match(dataExport, /api\.delete\(`\/users\/me\/exports\/\$\{job\.id\}`\)/);
  assert.match(dataExport, /refetchInterval/);
  assert.match(dataExport, /EXPORT_LIMIT/);
  assert.match(dataExport, /EXPORT_IN_PROGRESS/);
  assert.match(dataExport, /EXPORT_FINISHED/);
  assert.match(dataExport, /aria-label="Your data exports"/);
  assert.match(dataExport, /id="data"/);
  // Nothing is offered until the status query (the re-auth methods) has answered or failed visibly.
  assert.match(dataExport, /\(status\.isLoading && !status\.data\)/);
  assert.match(dataExport, /status\.isError && !status\.data/);
  assert.match(dataExport, /Could not load your account status/);

  const reauth = read('src/pages/settings/ReauthDialog.tsx');
  assert.match(reauth, /reauthenticate\(mode === 'password' \? \{ password \} : \{ code \}\)/);
  assert.match(reauth, /autoComplete="one-time-code"/);
  assert.match(reauth, /autoComplete="current-password"/);
  assert.match(reauth, /api\.post\('\/auth\/sendEmailOtp', \{ email \}\)/);
  // No link to the change-password form: it needs a current password, which this account does not have.
  assert.doesNotMatch(reauth, /settings#password/);
  assert.match(reauth, /Schedule deletion, which does not need confirmation/);
  // The dialog cannot be dismissed while the guarded action runs.
  assert.match(reauth, /onClose=\{submitting \? noop : onCancel\}/);
  assert.match(reauth, /closeOnBackdrop=\{!submitting\}/);
  // The countdown is not live; one polite region speaks twice per code.
  assert.doesNotMatch(reauth, /aria-live[^>]*>\s*You can ask for another code in/);
  assert.equal((reauth.match(/aria-live="polite"/g) || []).length, 1);
  assert.match(reauth, /initialFocusRef\.current = mode === 'code' && !codeSent \? null : inputRef\.current/);

  const gate = read('src/pages/settings/useReauthGate.tsx');
  assert.match(gate, /reauthGateDecision\(\{ phase: 'start'/);
  assert.match(gate, /reauthGateDecision\(\{ phase: 'failed'/);
  assert.match(gate, /reauthGateDecision\(\{ phase: 'cancel', inFlight: inFlightRef\.current \}\)/);
  assert.match(gate, /methods=\{pending\?\.methods \?\? methods \?\? NO_REAUTH_METHODS\}/, 'the 401\'s methods beat the cached status');
  const lifecycleApi = read('src/lib/lifecycleApi.ts');
  assert.match(lifecycleApi, /'\/auth\/reauth'/);
  assert.match(lifecycleApi, /'\/users\/me\/deletion'/);
  assert.match(lifecycleApi, /'\/users\/me\/deletion\/cancel'/);
  assert.match(lifecycleApi, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(lifecycleApi, /localStorage|sessionStorage/, 'no token handling of its own');

  const banner = read('src/pages/settings/PendingDeletionBanner.tsx');
  assert.match(banner, /cancelScheduledDeletion/);
  assert.match(banner, /Cancel deletion/);
  assert.match(banner, /queryKey: \['me'\]/);

  const api = read('src/lib/api.ts');
  assert.match(api, /code\)?\s*!==\s*'REAUTH_REQUIRED'\) onUnauthorized\('user'\)/);
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /pendingDeletion === true/);
  assert.match(auth, /pendingDeletion: \{ scheduledFor: data\.user\.deletion\?\.scheduledFor \?\? null \}/);
  assert.match(auth, /clearPendingDeletion: \(\) => set\(\{ pendingDeletion: null \}\)/);
  // The pinned login lines stay verbatim.
  assert.match(auth, /api\.post\('\/auth\/login', \{ email, password, remember \}\)/);
  assert.match(auth, /tokenStore\.set\(data\.token, remember \? 'local' : 'session'\)/);

  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /<DataLifecycleSection \/>/);
  assert.doesNotMatch(settings, /function DangerZone/);
  assert.doesNotMatch(settings, /DELETE_PHRASE/);
  assert.match(settings, /import \{ DataLifecycleSection \} from '\.\/settings\/DataLifecycleSection';/);
  assert.equal(settings.match(/<DataLifecycleSection \/>/g).length, 1, 'a single mount point');

  const login = read('src/pages/Login.tsx');
  assert.match(login, /<SignInLifecycleNotice \/>/);
  assert.match(login, /<PendingDeletionInterstitial target=\{target\} \/>/);
  assert.match(login, /if \(!useAuth\.getState\(\)\.pendingDeletion\) navigate\(target, \{ replace: true \}\)/);
  assert.match(login, /hidden=\{!!pendingDeletion\}/);
  assert.match(login, /if \(!pendingDeletion\) return;\s*setPassword\(''\);\s*setFieldError\(\{\}\);/, 'the typed password does not survive the interstitial');

  const section = read('src/pages/settings/DataLifecycleSection.tsx');
  for (const piece of ['<PendingDeletionBanner', '<DataExport />', '<DeleteAccount />']) assert.ok(section.includes(piece), piece);

  // The public deletion page is unchanged: its copy does not contradict the grace period.
  assert.match(read('public/account-deletion.html'), /Complete any authentication step shown in the app/);
});

test('the export and lifecycle routes the web calls are mounted on the API snapshot (the three lifecycle routes go over fetch until the scanner sees them)', () => {
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'DELETE /api/users/me',
    'POST /api/users/me/exports',
    'GET /api/users/me/exports',
    'GET /api/users/me/exports/:id/download',
    'DELETE /api/users/me/exports/:id',
    'POST /api/auth/sendEmailOtp',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

test('the pending banner is an alert with the date and one "Cancel deletion" button', async () => {
  const { PendingDeletionBanner } = await import('../src/pages/settings/PendingDeletionBanner.tsx');
  const scheduledFor = '2026-10-03T13:04:32Z';
  const html = mount(h(PendingDeletionBanner, { scheduledFor }));
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(lib.formatDeletionDate(scheduledFor)), 'shows the formatted date in the browser zone');
  assert.match(html, /<button[^>]*>[^<]*<span[^>]*>Cancel deletion<\/span><\/button>/);
  assert.match(html, /Nothing is removed until then/);
  assert.ok(html.indexOf('Nothing is removed until then') < html.indexOf('Cancel deletion'), 'the button follows the text instead of squeezing it');
  assert.doesNotMatch(html, /class="shrink-0">\s*<div/, 'nothing in the Callout side column');
  const withSignOut = mount(h(PendingDeletionBanner, { scheduledFor, secondaryAction: h('button', { type: 'button' }, 'Sign out') }));
  assert.match(withSignOut, /Sign out/);
  assert.ok(withSignOut.indexOf('Cancel deletion') < withSignOut.indexOf('Sign out'), 'Cancel deletion stays primary and first');
});

test('the re-auth dialog renders closed for every method combination, the state Settings mounts it in', async () => {
  const { ReauthDialog } = await import('../src/pages/settings/ReauthDialog.tsx');
  const combos = [
    { password: true, emailCode: false, scheduledWithoutReauth: false },
    { password: true, emailCode: true, scheduledWithoutReauth: false },
    { password: false, emailCode: true, scheduledWithoutReauth: false },
    { password: false, emailCode: false, scheduledWithoutReauth: true },
  ];
  for (const methods of combos) {
    for (const purpose of ['delete', 'export', 'download']) {
      assert.doesNotThrow(() => mount(h(ReauthDialog, { open: false, methods, email: 'm@example.com', purpose, onToken() {}, onCancel() {} })));
    }
  }
});

test('export rows: a ready job offers a labelled Download and its expiry; a failed job explains without the code', async () => {
  const { ExportJobRow } = await import('../src/pages/settings/DataExport.tsx');
  const ready = job({ downloadCount: 2 });
  const html = mount(h('ul', null, h(ExportJobRow, { job: ready, onDownload() {}, onRemove() {} })));
  assert.match(html, /Ready/);
  assert.match(html, /aria-label="Download the copy requested Sep 19, 2026"/);
  assert.match(html, /aria-label="Delete the copy requested Sep 19, 2026"/);
  assert.match(html, /Available until /);
  assert.match(html, /12\.4 MB/);
  assert.match(html, /Downloaded 2 times/);

  const failed = job({ status: 'failed', downloadable: false, archiveBytes: null, expiresAt: null, error: { code: 'BUILD_FAILED' } });
  const failedHtml = mount(h('ul', null, h(ExportJobRow, { job: failed, onDownload() {}, onRemove() {} })));
  assert.match(failedHtml, /Failed/);
  assert.ok(failedHtml.includes(lib.EXPORT_FAILURE_COPY));
  assert.doesNotMatch(failedHtml, /BUILD_FAILED/);
  assert.doesNotMatch(failedHtml, /Download the copy/);
  assert.doesNotMatch(failedHtml, /Delete the copy|Cancel the copy/);

  const queued = job({ status: 'queued', downloadable: false, archiveBytes: null, expiresAt: null, readyAt: null, startedAt: null });
  const queuedHtml = mount(h('ul', null, h(ExportJobRow, { job: queued, onDownload() {}, onRemove() {} })));
  assert.match(queuedHtml, /Queued/);
  assert.match(queuedHtml, /aria-label="Cancel the copy requested Sep 19, 2026"/);
  assert.doesNotMatch(queuedHtml, /Download the copy/);
});

test('the Settings mount and the sign-in notice render without a session (the SSR/initial state)', async () => {
  const { DataLifecycleSection } = await import('../src/pages/settings/DataLifecycleSection.tsx');
  const html = mount(h(DataLifecycleSection));
  assert.match(html, /id="data"/);
  assert.match(html, /Download your data/);
  assert.match(html, /id="delete"/);
  assert.match(html, /Delete account/);
  const { SignInLifecycleNotice, PendingDeletionInterstitial } = await import('../src/pages/settings/SignInLifecycleNotice.tsx');
  // Only the ToastProvider's empty live region renders around them.
  assert.doesNotMatch(mount(h(SignInLifecycleNotice)), /role="(?:note|alert)"/, 'nothing to say without a notice');
  assert.doesNotMatch(mount(h(PendingDeletionInterstitial, { target: '/' })), /Cancel deletion|Sign out/, 'nothing without a pending account');
});
