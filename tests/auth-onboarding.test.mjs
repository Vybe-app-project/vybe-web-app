import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Auth + onboarding fixes (qa8 auth-onboarding). Two layers:
 *
 *  - unit tests for the import-free logic modules (post-login targets, the
 *    session-expiry hand-off, sign-in error copy, sign-up draft persistence),
 *    loaded the way tests/password-reset.test.mjs loads passwordReset.ts;
 *  - source contracts pinning the pages to that logic and to the API shapes
 *    (field-level 409s, username availability, the welcome hand-off, the
 *    Verified badge keyed on the staff-granted flag, 44 px legal links, tab
 *    titles, "Log out" naming its scope).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

async function loadModule(relative) {
  const source = read(relative);
  assert.doesNotMatch(source, /^\s*import\s/m, `${relative} must stay import-free so tests can load it directly`);
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(relative),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}

const redirect = await loadModule('src/lib/authRedirect.ts');
const drafts = await loadModule('src/lib/authDrafts.ts');
const a11y = await loadModule('src/lib/a11y.ts');

/* ------------------------------------------------------------------ redirects */

test('only same-origin app paths are accepted as a post-sign-in destination', () => {
  const { safeNextPath } = redirect;
  assert.equal(safeNextPath('/messages'), '/messages');
  assert.equal(safeNextPath('/settings?tab=password#appearance'), '/settings?tab=password#appearance');
  assert.equal(safeNextPath(' /profile '), '/profile');
  for (const bad of [
    null, undefined, '', 'messages', 'https://evil.example/', '//evil.example', '/\\evil.example',
    '/login', '/login?next=/x', '/register', '/forgot-password', '/reset-password?token=abc',
    '/admin', '/admin/users', '/mes sages',
  ]) {
    assert.equal(safeNextPath(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
});

test('router state wins over ?next=, and both fall back to Home', () => {
  const { postLoginTarget } = redirect;
  assert.equal(postLoginTarget({}), '/');
  assert.equal(postLoginTarget({ next: '/settings' }), '/settings');
  assert.equal(postLoginTarget({ from: { pathname: '/messages', search: '?room=1' }, next: '/settings' }), '/messages?room=1');
  // A `from` that points back at an auth page is ignored, not looped into.
  assert.equal(postLoginTarget({ from: { pathname: '/login' }, next: '/settings' }), '/settings');
  assert.equal(postLoginTarget({ from: { pathname: '/login' }, next: '//evil.example' }), '/');
});

test('the session-expiry hand-off keeps the intended page in the URL', () => {
  const { sessionExpiredLoginUrl } = redirect;
  assert.equal(sessionExpiredLoginUrl('/messages', ''), '/login?expired=1&next=%2Fmessages');
  assert.equal(sessionExpiredLoginUrl('/messages/abc', '?x=1'), '/login?expired=1&next=%2Fmessages%2Fabc%3Fx%3D1');
  // Home is the default anyway; do not clutter the URL with it.
  assert.equal(sessionExpiredLoginUrl('/', ''), '/login?expired=1');
  // Round trip through the target rule lands back where the person was.
  const url = new URL(sessionExpiredLoginUrl('/messages', '?room=2'), 'https://vybeapp.fit');
  assert.equal(redirect.postLoginTarget({ next: url.searchParams.get('next') }), '/messages?room=2');
});

test('the sign-in page shows one arrival notice and turns credential failures into human copy', () => {
  const { loginNoticeFor, loginFailure, LOGIN_MISMATCH_COPY, OFFLINE_COPY } = redirect;
  const params = (query) => new URLSearchParams(query);
  assert.deepEqual(loginNoticeFor(params('expired=1&next=%2Fmessages')), {
    kind: 'expired', tone: 'warning', text: 'Your session expired. Sign in again to continue.',
  });
  assert.equal(loginNoticeFor(params('reset=1')).kind, 'reset');
  assert.equal(loginNoticeFor(params('')), null);
  // The dead ?registered=1 branch is gone: sign-up lands on the welcome sheet instead.
  assert.equal(loginNoticeFor(params('registered=1')), null);

  const fallback = 'Could not sign in.';
  const rejected = { response: { status: 400, data: { message: 'Email or password is incorrect' } } };
  assert.deepEqual(loginFailure(rejected, { fallback }), { text: LOGIN_MISMATCH_COPY, offerReset: true });
  assert.equal(loginFailure({ response: { status: 401, data: {} } }, { fallback }).offerReset, true);
  assert.doesNotMatch(LOGIN_MISMATCH_COPY, /invalid credentials/i);
  // Messages worth reading verbatim keep their text and do not push a reset.
  assert.deepEqual(loginFailure({ response: { status: 403, data: { message: 'Verify your email before signing in' } } }, { fallback }), {
    text: 'Verify your email before signing in', offerReset: false,
  });
  assert.deepEqual(loginFailure({ response: { status: 429, data: { message: 'Too many attempts' } } }, { fallback }), {
    text: 'Too many attempts', offerReset: false,
  });
  assert.deepEqual(loginFailure({ code: 'ERR_NETWORK' }, { fallback }), { text: OFFLINE_COPY, offerReset: false });
  assert.deepEqual(loginFailure(rejected, { online: false, fallback }), { text: OFFLINE_COPY, offerReset: false });
  assert.deepEqual(loginFailure({ response: { status: 500, data: {} } }, { fallback }), { text: fallback, offerReset: false });
});

/* ------------------------------------------------------------------ drafts */

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const jwtWithExp = (expSeconds) => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ email: 'a@b.co', purpose: 'email-registration', exp: expSeconds })}.sig`;
};

test('sign-up progress round-trips through sessionStorage and honours the resend cooldown', () => {
  const { readRegisterDraft, writeRegisterDraft, clearRegisterDraft, resendSecondsLeft, REGISTER_DRAFT_KEY, RESEND_COOLDOWN_S } = drafts;
  const now = 1_800_000_000_000;
  const storage = memoryStorage();

  writeRegisterDraft(storage, { step: 2, email: 'qa8@mrmosby.com', sentAt: now - 10_000 });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 2, email: 'qa8@mrmosby.com', sentAt: now - 10_000 });
  assert.equal(resendSecondsLeft(now - 10_000, now), RESEND_COOLDOWN_S - 10);
  assert.equal(resendSecondsLeft(now - 60_000, now), 0);
  assert.equal(resendSecondsLeft(undefined, now), 0);

  // The API expires the code after 5 minutes: fall back to step 1, email kept.
  assert.deepEqual(readRegisterDraft(storage, now + 6 * 60_000), { step: 1, email: 'qa8@mrmosby.com' });

  clearRegisterDraft(storage);
  assert.equal(readRegisterDraft(storage, now), null);
  assert.equal(storage.getItem(REGISTER_DRAFT_KEY), null);
});

test('a restored step 3 needs a live registration proof; a dead one goes back to step 1 with the email', () => {
  const { readRegisterDraft, writeRegisterDraft } = drafts;
  const now = 1_800_000_000_000;
  const storage = memoryStorage();
  const live = jwtWithExp(Math.floor(now / 1000) + 9 * 60);
  writeRegisterDraft(storage, { step: 3, email: 'QA8@mrmosby.com', preToken: live, sentAt: now - 120_000 });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 3, email: 'qa8@mrmosby.com', preToken: live, sentAt: now - 120_000 });

  const dead = jwtWithExp(Math.floor(now / 1000) - 1);
  writeRegisterDraft(storage, { step: 3, email: 'qa8@mrmosby.com', preToken: dead });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 1, email: 'qa8@mrmosby.com' });

  // No proof at all, or a proof about to expire, is treated the same way.
  writeRegisterDraft(storage, { step: 3, email: 'qa8@mrmosby.com' });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 1, email: 'qa8@mrmosby.com' });
  writeRegisterDraft(storage, { step: 3, email: 'qa8@mrmosby.com', preToken: jwtWithExp(Math.floor(now / 1000) + 2) });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 1, email: 'qa8@mrmosby.com' });
});

test('a restored step 3 brings the typed name and handle back, sanitised, and step 2 never carries them', () => {
  const { readRegisterDraft, writeRegisterDraft } = drafts;
  const now = 1_800_000_000_000;
  const storage = memoryStorage();
  const live = jwtWithExp(Math.floor(now / 1000) + 9 * 60);

  writeRegisterDraft(storage, { step: 3, email: 'qa8@mrmosby.com', preToken: live, fullName: '  QA Eight ', username: 'qa8 eight' });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 3, email: 'qa8@mrmosby.com', preToken: live, sentAt: undefined, fullName: 'QA Eight', username: 'qa8eight' });

  // Oversized or non-string values are clipped or dropped, never thrown on.
  storage.setItem('vybe.registerDraft', JSON.stringify({ step: 3, email: 'qa8@mrmosby.com', preToken: live, fullName: 'x'.repeat(500), username: 42 }));
  const clipped = readRegisterDraft(storage, now);
  assert.equal(clipped.fullName.length, 100);
  assert.equal('username' in clipped, false);

  // Empty strings are not restored as fields, and a dead proof drops them with the step.
  writeRegisterDraft(storage, { step: 3, email: 'qa8@mrmosby.com', preToken: live, fullName: '', username: '   ' });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 3, email: 'qa8@mrmosby.com', preToken: live, sentAt: undefined });
  writeRegisterDraft(storage, { step: 3, email: 'qa8@mrmosby.com', preToken: jwtWithExp(1), fullName: 'QA Eight', username: 'qa8eight' });
  assert.deepEqual(readRegisterDraft(storage, now), { step: 1, email: 'qa8@mrmosby.com' });

  // Step 2 has no form text to keep.
  storage.setItem('vybe.registerDraft', JSON.stringify({ step: 2, email: 'qa8@mrmosby.com', sentAt: now - 1000, fullName: 'QA Eight', username: 'qa8eight' }));
  assert.deepEqual(readRegisterDraft(storage, now), { step: 2, email: 'qa8@mrmosby.com', sentAt: now - 1000 });
});

test('the welcome marker is one-shot and survives a storage failure quietly', () => {
  const { markWelcomePending, takeWelcomePending, WELCOME_PENDING_KEY } = drafts;
  const storage = memoryStorage();
  assert.equal(takeWelcomePending(storage), false);
  markWelcomePending(storage);
  assert.equal(storage.getItem(WELCOME_PENDING_KEY), '1');
  assert.equal(takeWelcomePending(storage), true, 'first read opens the sheet');
  assert.equal(takeWelcomePending(storage), false, 'second read (a reload) does not');
  assert.equal(storage.getItem(WELCOME_PENDING_KEY), null);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => markWelcomePending(broken));
  assert.equal(takeWelcomePending(broken), false);
});

test('drafts never hold a password and survive corrupt or unavailable storage', () => {
  const { readRegisterDraft, writeRegisterDraft, readDraftEmail, writeDraftEmail, clearDraftEmail, REGISTER_DRAFT_KEY, LOGIN_EMAIL_DRAFT_KEY } = drafts;
  const storage = memoryStorage({ [REGISTER_DRAFT_KEY]: '{not json' });
  assert.equal(readRegisterDraft(storage), null);
  storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({ step: 2, email: 'not-an-email', sentAt: Date.now() }));
  assert.equal(readRegisterDraft(storage), null);
  storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({ step: 9, email: 'x@y.co' }));
  assert.deepEqual(readRegisterDraft(storage), { step: 1, email: 'x@y.co' });

  // Step 1 with nothing typed clears rather than storing an empty draft.
  writeRegisterDraft(storage, { step: 1, email: '' });
  assert.equal(storage.getItem(REGISTER_DRAFT_KEY), null);

  writeDraftEmail(storage, 'qa8@mrmosby.com');
  assert.equal(readDraftEmail(storage), 'qa8@mrmosby.com');
  clearDraftEmail(storage);
  assert.equal(readDraftEmail(storage), '');
  assert.equal(storage.getItem(LOGIN_EMAIL_DRAFT_KEY), null);

  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(readRegisterDraft(broken), null);
  assert.doesNotThrow(() => writeRegisterDraft(broken, { step: 2, email: 'x@y.co', sentAt: 1 }));
  assert.equal(readDraftEmail(broken), '');
  assert.doesNotThrow(() => writeDraftEmail(broken, 'x@y.co'));
  assert.equal(readRegisterDraft(null), null);

  // The draft shape has no room for a password: no such field, no such key.
  const source = read('src/lib/authDrafts.ts');
  assert.doesNotMatch(source, /password\??:/i);
  assert.doesNotMatch(source, /setItem\([^)]*password/i);
});

/* ------------------------------------------------------------------ source contracts */

test('an expired session hands off to /login with the page preserved, and both guards agree on the target', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /import \{ sessionExpiredLoginUrl \} from '\.\/authRedirect'/);
  assert.match(api, /location\.href = sessionExpiredLoginUrl\(location\.pathname, location\.search\)/);
  assert.doesNotMatch(api, /location\.href = '\/login'/, 'the consumer 401 path must not drop the intended page');
  // Admin sessions keep their own, unchanged hand-off.
  assert.match(api, /location\.href = '\/admin\/login'/);

  const app = read('src/App.tsx');
  assert.match(app, /import \{ postLoginTarget \} from '\.\/lib\/authRedirect'/);
  assert.match(app, /<Navigate to=\{postLoginTarget\(\{ from, next: params\.get\('next'\) \}\)\} replace \/>/);
  const login = read('src/pages/Login.tsx');
  assert.match(login, /postLoginTarget\(\{ from: state\?\.from, next: params\.get\('next'\) \}\)/);
  assert.match(login, /loginNoticeFor\(params\)/);
  assert.match(login, /setNotice\(null\)/, 'acting on the form must retire the arrival notice');
  assert.doesNotMatch(login, /registered/, 'the unreachable ?registered=1 notice is gone');

  // Bootstrap only ends a session on an auth answer, never on a network blip.
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /if \(isSessionRejected\(error\)\) \{\s*tokenStore\.clear\(\);/);
});

test('"Keep me signed in" is on by default and, when off, the token lives in the tab only', () => {
  const login = read('src/pages/Login.tsx');
  assert.match(login, /useState\(true\)/);
  assert.match(login, /label="Keep me signed in"/);
  assert.match(login, /login\(trimmed, password, \{ remember \}\)/);
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /api\.post\('\/auth\/login', \{ email, password, remember \}\)/);
  assert.match(auth, /tokenStore\.set\(data\.token, remember \? 'local' : 'session'\)/);
  const api = read('src/lib/api.ts');
  assert.match(api, /set: \(t: string, persistence: SessionPersistence = 'local'\)/);
  assert.match(api, /readStorage\(localStorage, TOKEN_KEY\) \?\? readStorage\(sessionStorage, TOKEN_KEY\)/);
  // Admin tokens are untouched by this (the admin contract test pins them too).
  assert.match(api, /getAdmin: \(\) => sessionStorage\.getItem\(ADMIN_TOKEN_KEY\)/);
});

test('sign-in errors are human, focus lands on the first invalid field, and the reset path is one tap away', () => {
  const login = read('src/pages/Login.tsx');
  assert.match(login, /loginFailure\(e2, \{/);
  assert.match(login, /focusField\(next\.email \? 'login-email' : 'login-password'\)/);
  assert.match(login, /error\.offerReset \? \(/);
  assert.match(login, /to="\/forgot-password"[\s\S]{0,80}state=\{\{ email: email\.trim\(\) \}\}/);
  assert.match(login, /export function focusField\(id: string, attempts = 6\)/);
  // A field is still disabled for a frame after a failed request; focus must retry, not give up.
  assert.match(login, /if \(el && !\(el as HTMLInputElement\)\.disabled\) \{/);
  assert.match(login, /if \(attempts > 1\) focusField\(id, attempts - 1\);/);
  // Typed email survives a reload; the password never persists.
  assert.match(login, /readDraftEmail\(sessionStorage\)/);
  assert.match(login, /writeDraftEmail\(sessionStorage, email\.trim\(\)\)/);
  assert.match(login, /clearDraftEmail\(sessionStorage\)/);
  assert.doesNotMatch(login, /Storage\.setItem\([^)]*password/i);
  for (const page of ['src/pages/ForgotPassword.tsx', 'src/pages/ResetPassword.tsx', 'src/pages/Register.tsx']) {
    assert.match(read(page), /focusField\(/, `${page} must move focus to the field in error`);
  }
});

test('the signed-out pages title the tab and the legal links are 44 px targets that open in a new tab', () => {
  const login = read('src/pages/Login.tsx');
  assert.match(login, /useDocumentTitle\(documentTitle \?\? title\);/);
  assert.match(login, /documentTitle="Sign in"/);
  assert.match(read('src/pages/ResetPassword.tsx'), /documentTitle="Reset your password"/);
  assert.match(read('src/pages/Register.tsx'), /title="Create your account"/);
  assert.match(read('src/pages/ForgotPassword.tsx'), /title="Reset your password"/);

  const legal = login.slice(login.indexOf('export function LegalLine'), login.indexOf('type LoginState'));
  const anchors = [...legal.matchAll(/<a\s+href="\/(terms-and-conditions|privacy-policy)\.html"([^>]*)>/g)];
  assert.equal(anchors.length, 2);
  for (const [, , attributes] of anchors) {
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
    assert.match(attributes, /className=\{LEGAL_LINK\}/);
  }
  assert.match(legal, /Terms<span className="sr-only"> \(opens in a new tab\)<\/span>/);
  assert.match(legal, /Privacy Policy<span className="sr-only"> \(opens in a new tab\)<\/span>/);
  assert.match(login, /const LEGAL_LINK = 'inline-flex min-h-11 items-center[^']*'/);
});

test('sign-up names the field in a 409, checks availability while typing, persists progress, and hands off to the welcome sheet', () => {
  const register = read('src/pages/Register.tsx');
  // Typeahead: debounced, format-gated, cached, never blocking on a failed check.
  assert.match(register, /useDebounced\(username, 300\)/);
  assert.match(register, /api\.get\('\/auth\/username-available'/);
  assert.match(register, /state: 'checking'/);
  assert.match(register, /is available/);
  assert.match(register, /aria-label="Available usernames"/);
  // The API's field-level conflict lands on the field, with alternatives, and focus.
  assert.match(register, /response\?\.status === 409 && body\?\.field === 'username'/);
  assert.match(register, /setServerSuggestions\(body\.suggestions \?\? \[\]\)/);
  assert.match(register, /setErrors\(\{ username: body\.message \|\| USERNAME_TAKEN \}, \['username'\]\)/);
  assert.match(register, /response\?\.status === 409 && body\?\.field === 'email'/);
  assert.doesNotMatch(register, /Unable to create account/);
  // Progress survives a reload: read on mount, written on change, cleared on success.
  assert.match(register, /readRegisterDraft\(sessionStorage\)/);
  assert.match(register, /writeRegisterDraft\(sessionStorage, \{\s*step,\s*email: trimmedEmail,\s*sentAt,\s*preToken: preToken \|\| undefined,\s*\.\.\.\(step === 3 \? \{ fullName: fullName\.trim\(\) \|\| undefined, username: trimmedUsername \|\| undefined \} : \{\}\),?\s*\}\)/);
  assert.match(register, /useState\(draft\?\.username \?\? ''\)/);
  assert.match(register, /useState\(draft\?\.fullName \?\? ''\)/);
  // The name feeds the suggestions, so it is part of the availability key.
  assert.match(register, /queryKey: \['username-available', debounced, debouncedName\]/);
  // Sign-up lands where GuestOnly would: ?next= is honoured by both.
  assert.match(register, /postLoginTarget\(\{ from, next: new URLSearchParams\(location\.search\)\.get\('next'\) \}\)/);
  assert.match(register, /resendSecondsLeft\(draft\?\.sentAt\)/);
  assert.equal((register.match(/clearRegisterDraft\(sessionStorage\)/g) || []).length, 2, 'cleared on both sign-in and account creation');
  // An existing account signed in through the code says so; the copy sets the expectation.
  assert.match(register, /toast\.info\(`You already had an account, so we signed you in as \$\{handle\}\.`/);
  assert.match(register, /Enter the code to confirm your email or sign in\./);
  assert.match(register, /If this address already has an account, the code signs you in\./);
  // First run: the welcome marker is set before the store update (GuestOnly's
  // redirect fires the moment the store has a user), then the shared target rule lands the person.
  const created = register.slice(register.indexOf("throw new Error('Registration did not return a session token.')"));
  assert.ok(created.indexOf('markWelcomePending(sessionStorage)') < created.indexOf('setUser(data.user)'), 'marker must precede setUser');
  assert.match(created, /navigate\(target, \{ replace: true \}\)/);
  assert.doesNotMatch(register, /welcome=1/, 'sign-up must not depend on a URL param GuestOnly can drop');
  // Step handlers validate into field errors, not just the top callout.
  assert.match(register, /setErrors\(\{ email: 'Enter a valid email address\.' \}, \['email'\]\)/);
  assert.match(register, /setErrors\(\{ otp: /);
  assert.match(register, /setErrors\(next, \['fullName', 'username', 'password', 'confirm'\]\)/);
});

test('the first-run sheet is mounted for every signed-in route and offers a photo and people to follow', () => {
  const app = read('src/App.tsx');
  assert.match(app, /import WelcomeSheet from '\.\/pages\/WelcomeSheet'/);
  assert.match(app, /<RequireAuth><Layout \/><WelcomeSheet \/><\/RequireAuth>/);
  const sheet = read('src/pages/WelcomeSheet.tsx');
  assert.match(sheet, /params\.get\(WELCOME_PARAM\) === '1'/, '?welcome=1 stays a deep link');
  assert.match(sheet, /takeWelcomePending\(sessionStorage\)/, 'sign-up hands off through the one-shot marker');
  assert.match(sheet, /next\.delete\(WELCOME_PARAM\)/, 'the param is consumed so a reload does not reopen the sheet');
  assert.match(sheet, /title=\{`Welcome to Vybe, \$\{firstName\}`\}/);
  assert.match(sheet, /api\.get\('\/searching\/suggest'\)/);
  assert.match(sheet, /uploadImage\(file, 'avatars'\)/);
  assert.match(sheet, /api\.put\('\/users\/profile-picture', \{ image: imageKey \}\)/);
  assert.match(sheet, /Skip for now/);
  assert.match(sheet, /<UserRow key=\{user\._id\} user=\{user\} \/>/);
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ['GET /api/auth/username-available', 'GET /api/searching/suggest', 'PUT /api/users/profile-picture', 'POST /api/auth/reset-password']) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('a reused or expired reset link becomes the recovery state, and the reset hands the email to sign-in', () => {
  const reset = read('src/pages/ResetPassword.tsx');
  assert.match(reset, /classifyResetFailure\(e2, \{/);
  assert.match(reset, /failure\.kind === 'invalid-token'/);
  assert.match(reset, /setLinkDead\(true\)/);
  assert.match(reset, /if \(!tokenLooksValid \|\| linkDead\)/);
  assert.match(reset, /resetFailureMessage\(failure\)/);
  assert.match(reset, /label: 'Request a new link', to: '\/forgot-password'/);
  assert.match(reset, /navigate\('\/login\?reset=1', \{ replace: true, state: \{ email: /);
  assert.match(reset, /isResetToken\(token\)/);
  assert.match(read('src/pages/ForgotPassword.tsx'), /location\.state as \{ email\?: string \} \| null/);
});

test('the Verified badge keys on the staff-granted flag, never on email verification', () => {
  for (const page of ['src/pages/UserRow.tsx', 'src/pages/PostCard.tsx', 'src/pages/MealDetail.tsx']) {
    const source = read(page);
    assert.match(source, /isIdentityVerified/, `${page} must read isIdentityVerified`);
    assert.doesNotMatch(source, /\.isVerified\b/, `${page} must not render isVerified`);
  }
  assert.match(read('src/lib/hooks.ts'), /isIdentityVerified\?: boolean;/);
  assert.match(read('src/lib/auth.ts'), /isIdentityVerified\?: boolean;/);
  // The badge itself keeps its accessible name for the live suites.
  assert.match(read('src/pages/UserRow.tsx'), /aria-label="Verified" title="Verified"/);
  assert.match(read('src/pages/PostCard.tsx'), /aria-label="Verified" role="img"/);
});

test('"Log out" keeps its label for the live suites and says it signs out every device', () => {
  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /const LOGOUT_SCOPE = 'Signs you out on every device';/);
  assert.equal((layout.match(/\{ label: 'Log out', description: LOGOUT_SCOPE, icon: <LogOut size=\{18\} \/>, onSelect: logout, danger: true, divider: true \}/g) || []).length, 2);
  assert.match(layout, /label="Account menu"/);
});

/* ------------------------------------------------------------------ described-by wiring */

test('a field keeps its error or hint description and appends, never replaces, what the caller adds', () => {
  const { describedByIds } = a11y;
  assert.equal(describedByIds('reg-username', undefined, 'Letters, numbers…'), 'reg-username-hint');
  assert.equal(describedByIds('reg-username', 'That username is taken.', 'Letters, numbers…'), 'reg-username-error');
  assert.equal(describedByIds('reg-username', undefined, undefined, 'reg-username-status'), 'reg-username-status');
  // The regression: an error and a caller-supplied status id both survive, error first.
  assert.equal(describedByIds('reg-username', 'Taken', undefined, 'reg-username-status'), 'reg-username-error reg-username-status');
  assert.equal(describedByIds('reg-password', 'Too short', 'Use 8+ characters', 'reg-password-rules'), 'reg-password-error reg-password-rules');
  assert.equal(describedByIds('x', undefined, undefined), undefined);
  assert.equal(describedByIds('x', undefined, undefined, '   '), undefined);
  assert.equal(describedByIds('x', undefined, undefined, null), undefined);
  assert.equal(describedByIds('x', '', 0, undefined), undefined, 'falsy error and hint describe nothing');
});

test('Input merges a caller aria-describedby with its own, and the username field only names the status while it is rendered', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /import \{ describedByIds \} from '\.\.\/lib\/a11y'/);
  const input = ui.slice(ui.indexOf('export function Input('), ui.indexOf('export function SearchField('));
  assert.match(input, /'aria-describedby': describedBy,\s*\.\.\.rest/, 'the caller value must be pulled out of ...rest so it cannot override the computed one');
  assert.match(input, /aria-describedby=\{describedByIds\(inputId, error, hint, describedBy\)\}/);
  assert.ok(input.indexOf('aria-describedby={describedByIds(') < input.indexOf('{...rest}'), 'the computed value precedes the spread');

  const register = read('src/pages/Register.tsx');
  assert.match(register, /aria-describedby=\{!usernameErrorText && availability\.state !== 'idle' \? 'reg-username-status' : undefined\}/);
  assert.doesNotMatch(register, /aria-describedby=\{usernameErrorText \? undefined : 'reg-username-status'\}/, 'the old always-on status id pointed at an element that was not rendered');
  // The status line renders under exactly the same condition it is announced.
  assert.match(register, /\{!usernameErrorText && availability\.state !== 'idle' \? \(\s*<p id="reg-username-status"/);
});

test('the welcome sheet closes when a link inside it changes the page', () => {
  const sheet = read('src/pages/WelcomeSheet.tsx');
  assert.match(sheet, /import \{ useLocation, useSearchParams \} from 'react-router-dom'/);
  assert.match(sheet, /const \{ pathname \} = useLocation\(\);/);
  assert.match(sheet, /const openedOn = useRef<string \| null>\(null\);/);
  assert.match(sheet, /openedOn\.current = pathname;\s*setOpen\(true\);/, 'the page the sheet opened on is recorded as it opens');
  assert.match(sheet, /if \(open && openedOn\.current !== null && pathname !== openedOn\.current\) setOpen\(false\);/);
  // People rows keep their real profile links (the live suites use the "Open … profile" names).
  assert.match(read('src/pages/UserRow.tsx'), /aria-label=\{`Open \$\{displayName\(user\)\}’s profile`\}/);
});
