import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const lib = await import('../src/lib/emailUnsubscribe.ts');

// 32 random bytes as base64url: 43 characters, the shape services/emailUnsubscribe.js mints.
const TOKEN = 'Qm9vc3Rlci1nb2xkLXRva2VuLXZhbHVlLTEyMzQ1Njc';

test('the token rule mirrors the API pattern and refuses anything else before a request is made', () => {
  assert.equal(TOKEN.length, 43);
  assert.equal(lib.isUnsubscribeToken(TOKEN), true);
  assert.equal(lib.isUnsubscribeToken('a'.repeat(32)), true, 'the lower bound');
  assert.equal(lib.isUnsubscribeToken('a'.repeat(128)), true, 'the upper bound');
  assert.equal(lib.isUnsubscribeToken('short'), false);
  assert.equal(lib.isUnsubscribeToken(`${TOKEN}.js`), false, 'a dotted token is not URL-safe base64');
  assert.equal(lib.isUnsubscribeToken('a'.repeat(129)), false);
  assert.equal(lib.isUnsubscribeToken(`${TOKEN}/x`), false);
  assert.equal(lib.isUnsubscribeToken(''), false);
  assert.equal(lib.isUnsubscribeToken(null), false);
  assert.equal(String(lib.UNSUBSCRIBE_TOKEN_RE), String(/^[A-Za-z0-9_-]{32,128}$/));
});

test('the token is read from the path first, then ?token=', () => {
  assert.equal(lib.readUnsubscribeToken({ param: TOKEN, search: '' }), TOKEN);
  assert.equal(lib.readUnsubscribeToken({ param: null, search: `?token=${TOKEN}` }), TOKEN);
  assert.equal(lib.readUnsubscribeToken({ param: undefined, search: `token=${TOKEN}&x=1` }), TOKEN);
  assert.equal(lib.readUnsubscribeToken({ param: TOKEN, search: '?token=other' }), TOKEN, 'the path wins');
  assert.equal(lib.readUnsubscribeToken({ param: '  ', search: `?token= ${TOKEN} ` }), TOKEN, 'trimmed');
  assert.equal(lib.readUnsubscribeToken({ param: null, search: '' }), '');
  assert.equal(lib.readUnsubscribeToken({}), '');
});

test('failures map to the states the page renders and keep the server sentence where it matters', () => {
  const http = (status, data) => ({ isAxiosError: true, response: { status, data } });
  assert.deepEqual(lib.classifyUnsubscribeFailure(http(400, { code: 'TOKEN_MALFORMED', message: 'This unsubscribe link is not valid' })), { kind: 'invalid-link' });
  assert.deepEqual(lib.classifyUnsubscribeFailure(http(400, { code: 'TOKEN_REQUIRED', message: 'An unsubscribe token is required' })), { kind: 'invalid-link' });
  assert.deepEqual(lib.classifyUnsubscribeFailure(http(404, { code: 'TOKEN_INVALID', message: 'used' })), { kind: 'used-or-expired' });
  assert.deepEqual(
    lib.classifyUnsubscribeFailure(http(429, { code: 'RATE_LIMITED', message: 'Too many unsubscribe requests from this connection. Try again in about 15 minutes.' })),
    { kind: 'rate-limited', message: 'Too many unsubscribe requests from this connection. Try again in about 15 minutes.' },
  );
  assert.equal(lib.classifyUnsubscribeFailure(http(429, 'busy')).message, 'Too many unsubscribe requests from this connection. Try again in about 15 minutes.', 'a bodyless 429 has a sentence');
  assert.deepEqual(lib.classifyUnsubscribeFailure({ isAxiosError: true, code: 'ERR_NETWORK' }), { kind: 'network' });
  assert.deepEqual(lib.classifyUnsubscribeFailure({ isAxiosError: true, code: 'ECONNABORTED' }), { kind: 'network' });
  assert.deepEqual(lib.classifyUnsubscribeFailure(http(500, { message: 'x' }), { online: false }), { kind: 'network' }, 'offline wins');
  assert.deepEqual(
    lib.classifyUnsubscribeFailure(http(500, { message: "Couldn't update your e-mail preferences. Try the link again in a moment." })),
    { kind: 'failed', message: "Couldn't update your e-mail preferences. Try the link again in a moment." },
  );
  assert.equal(lib.classifyUnsubscribeFailure(http(502, '<html>')).kind, 'failed');
  assert.ok(lib.classifyUnsubscribeFailure(http(502, '<html>')).message.length > 0, 'a text body still yields a sentence');
  // A 404 without the code (a wrong host, a proxy) is a plain failure with a retry, not "already used".
  assert.equal(lib.classifyUnsubscribeFailure(http(404, { message: 'Not found' })).kind, 'failed');
  assert.equal(lib.classifyUnsubscribeFailure(undefined).kind, 'failed');

  assert.equal(lib.canRetryUnsubscribe({ kind: 'network' }), true);
  assert.equal(lib.canRetryUnsubscribe({ kind: 'failed', message: 'x' }), true);
  assert.equal(lib.canRetryUnsubscribe({ kind: 'invalid-link' }), false);
  assert.equal(lib.canRetryUnsubscribe({ kind: 'used-or-expired' }), false);
  assert.equal(lib.canRetryUnsubscribe({ kind: 'rate-limited', message: 'x' }), false);

  for (const failure of [{ kind: 'network' }, { kind: 'invalid-link' }, { kind: 'used-or-expired' }, { kind: 'rate-limited', message: 'Wait.' }, { kind: 'failed', message: 'No.' }]) {
    const sentence = lib.unsubscribeFailureMessage(failure);
    assert.ok(sentence.length > 0);
    assert.doesNotMatch(sentence, /!/);
  }
  assert.equal(lib.unsubscribeFailureMessage({ kind: 'invalid-link' }), 'This link is not valid.');
  assert.equal(lib.unsubscribeFailureMessage({ kind: 'used-or-expired' }), 'This link has already been used or has expired.');
  assert.equal(lib.unsubscribeFailureMessage({ kind: 'network' }), 'Could not reach Vybe. Check your connection and try again.');
});

test('the success sentence names the kind the way the Settings card does; unknown kinds keep the server sentence', () => {
  assert.equal(lib.unsubscribeSuccessMessage('weeklyRecap'), 'You are unsubscribed from weekly recap e-mail. Your other choices are unchanged.');
  assert.equal(lib.unsubscribeSuccessMessage('likes'), 'You are unsubscribed from likes e-mail. Your other choices are unchanged.', 'the web says likes, not kudos');
  assert.equal(lib.unsubscribeSuccessMessage('productUpdates'), 'You are unsubscribed from marketing and product updates e-mail. Your other choices are unchanged.');
  assert.match(lib.unsubscribeSuccessMessage('all'), /^You are unsubscribed from all Vybe e-mail\. Sign-in codes/);
  assert.equal(lib.unsubscribeSuccessMessage('somethingNew', "You're unsubscribed from somethingNew e-mail. Your other choices are unchanged."), "You're unsubscribed from somethingNew e-mail. Your other choices are unchanged.");
  assert.equal(lib.unsubscribeSuccessMessage('somethingNew'), 'You are unsubscribed.');
  assert.equal(lib.unsubscribeSuccessMessage(null, 42), 'You are unsubscribed.');
  for (const kind of lib.UNSUBSCRIBE_KINDS) assert.doesNotMatch(lib.unsubscribeSuccessMessage(kind), /!/);
  assert.deepEqual([...lib.UNSUBSCRIBE_KINDS], ['newFollowers', 'workoutPosts', 'likes', 'comments', 'friendRequests', 'weeklyRecap', 'checkins', 'achievements', 'productUpdates', 'all']);
  assert.equal(lib.unsubscribeKindLabel('all'), null);
  assert.equal(lib.unsubscribeKindLabel('checkins'), 'check-ins');
  // The manage link lands on the e-mail card, via sign-in when there is no session (safeNextPath keeps the hash).
  assert.equal(lib.manageEmailPreferencesPath(true), '/settings#email');
  assert.equal(lib.manageEmailPreferencesPath(false), '/login?next=%2Fsettings%23email');
});

test('the landing is a public route that POSTs the pinned static endpoint once, and the export-ready row lands on the data card', () => {
  const app = read('src/App.tsx');
  const guardedAdmin = app.indexOf('element={<RequireAdmin>');
  const guardedAuth = app.indexOf('<RequireAuth>');
  assert.ok(guardedAdmin > 0 && guardedAuth > 0);
  for (const route of ['/email/unsubscribe/:token', '/email/unsubscribe']) {
    const match = app.match(new RegExp(`path="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" element=\\{<EmailUnsubscribe />\\}`));
    assert.ok(match, `${route} must be routed to EmailUnsubscribe`);
    assert.ok(match.index < guardedAdmin && match.index < guardedAuth, `${route} must be public (declared before RequireAdmin and RequireAuth)`);
  }
  assert.match(app, /const EmailUnsubscribe = lazyPage\(null, \(\) => import\('\.\/pages\/EmailUnsubscribe'\)\);/);

  const page = read('src/pages/EmailUnsubscribe.tsx');
  // The web page posts the token in the body; the GET form consumes on a tapped link and is the mail client's.
  assert.match(page, /api\.post\('\/email\/unsubscribe', \{ token \}\)/);
  assert.doesNotMatch(page, /api\.get\('\/email\/unsubscribe/);
  assert.doesNotMatch(page, /\/email\/unsubscribe\/\$\{/, 'never the token in the path (that route is RFC 8058 one-click)');
  assert.match(page, /attempted\.current === token/, 'a single-use token is posted once per mount');
  assert.match(page, /isUnsubscribeToken\(token\)/, 'a malformed token never reaches the API');
  assert.match(page, /<PublicShell title="E-mail preferences"/);
  assert.match(page, /export function UnsubscribeOutcome/);
  assert.doesNotMatch(page, /style=\{\{|dangerouslySetInnerHTML|https?:\/\//, 'CSP-safe: no inline styles, no injected HTML, no third-party origins');

  // A security row about the member's data export opens the Download-your-data card.
  const copy = read('src/lib/notificationCopy.ts');
  assert.match(copy, /notificationType === 'data_export_ready'\) return '\/settings#data'/);
  assert.match(read('src/pages/settings/DataExport.tsx'), /<SettingsCard id="data"/);

  // The route snapshot already pins the API routes the landing and the cards call.
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ['POST /api/email/unsubscribe', 'GET /api/notifications/settings', 'PUT /api/notifications/settings', 'GET /api/users/email-preferences', 'PUT /api/users/email-preferences']) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});
