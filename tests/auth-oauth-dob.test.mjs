import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

register('./ts-loader.mjs', import.meta.url);

/**
 * P9: the provider sign-in buttons, the date-of-birth field and the login
 * activity card.
 *
 * Three layers, the way tests/auth-onboarding.test.mjs does it: unit tests
 * for the import-free logic modules, source contracts pinning the pages to
 * the API shapes, and a render of the one screen that has to read exactly as
 * written (the under-age block).
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

const oauth = await loadModule('src/lib/oauth.ts');
const dob = await loadModule('src/lib/birthDate.ts');
const activity = await loadModule('src/lib/loginActivity.ts');

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    size: () => map.size,
  };
};

/* ------------------------------------------------------------------ oauth */

test('the authorize URL is the redirect flow: no third-party script, and every parameter the provider needs', () => {
  const google = new URL(
    oauth.authorizeUrl({ provider: 'google', clientId: 'abc.apps.googleusercontent.com', redirectUri: 'https://vybeapp.fit/login', state: 's1', nonce: 'n1' }),
  );
  assert.equal(`${google.origin}${google.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(google.searchParams.get('response_type'), 'id_token', 'the token comes back in the fragment, so no code exchange and no server route');
  assert.equal(google.searchParams.get('scope'), 'openid email profile');
  assert.equal(google.searchParams.get('client_id'), 'abc.apps.googleusercontent.com');
  assert.equal(google.searchParams.get('redirect_uri'), 'https://vybeapp.fit/login');
  assert.equal(google.searchParams.get('state'), 's1');
  assert.equal(google.searchParams.get('nonce'), 'n1');
  assert.equal(google.searchParams.get('prompt'), 'select_account', 'a shared computer must be able to pick another account');

  const apple = new URL(
    oauth.authorizeUrl({ provider: 'apple', clientId: 'fit.vybeapp.web', redirectUri: 'https://vybeapp.fit/login', state: 's2', nonce: 'n2' }),
  );
  assert.equal(`${apple.origin}${apple.pathname}`, 'https://appleid.apple.com/auth/authorize');
  assert.equal(apple.searchParams.get('response_type'), 'code id_token');
  assert.equal(apple.searchParams.get('scope'), 'name email', 'the API refuses a first Apple sign-in without a verified email');
  assert.equal(apple.searchParams.get('response_mode'), 'form_post', 'Apple requires form_post whenever a scope is asked for');
});

test('the redirect URI is one registered path per provider, and a placeholder client id starts nothing', () => {
  assert.equal(oauth.OAUTH_REDIRECT_PATH, '/login');
  assert.equal(oauth.redirectUriFor('https://vybeapp.fit'), 'https://vybeapp.fit/login');
  assert.equal(oauth.redirectUriFor('https://vybeapp.fit/'), 'https://vybeapp.fit/login');
  for (const bad of ['', '   ', 'your-client-id', 'REPLACE_ME', '<client-id>', 'TODO', null, undefined, 42]) {
    assert.equal(oauth.usableClientId(bad), null, `${JSON.stringify(bad)} is not a client id`);
  }
  assert.equal(oauth.usableClientId('  real.id  '), 'real.id');
  assert.equal(oauth.startOAuth({ provider: 'google', clientId: 'your-client-id', origin: 'https://vybeapp.fit', returnTo: '/' }), null);
  const started = oauth.startOAuth({ provider: 'google', clientId: 'real.id', origin: 'https://vybeapp.fit', returnTo: '/meals' });
  assert.equal(started.pending.provider, 'google');
  assert.equal(started.pending.returnTo, '/meals');
  assert.match(started.url, new RegExp(`state=${started.pending.state}`));
});

test('a return is only spent when the state matches, the flow is fresh, and the entry is retired either way', () => {
  const storage = memoryStorage();
  const started = oauth.startOAuth({ provider: 'google', clientId: 'real.id', origin: 'https://vybeapp.fit', returnTo: '/meals', now: 1000 });
  oauth.rememberOAuth(storage, started.pending);

  // An ordinary visit to /login.
  assert.equal(oauth.readOAuthReturn('', storage), null);
  assert.equal(oauth.readOAuthReturn('#', storage), null);
  assert.equal(oauth.readOAuthReturn('#foo=bar', storage), null);
  assert.equal(storage.size(), 1, 'a non-return leaves the pending flow alone');

  const ok = oauth.readOAuthReturn(`#id_token=TOK&state=${started.pending.state}`, storage, 2000);
  assert.deepEqual(ok, { kind: 'token', provider: 'google', idToken: 'TOK', returnTo: '/meals' });
  assert.equal(storage.size(), 0, 'the entry is one-shot');

  // A forged or replayed fragment with no pending flow.
  const forged = oauth.readOAuthReturn('#id_token=TOK&state=whatever', memoryStorage());
  assert.equal(forged.kind, 'error');
  assert.match(forged.message, /could not be verified/);

  // The right flow, the wrong state.
  const s2 = memoryStorage();
  oauth.rememberOAuth(s2, started.pending);
  assert.match(oauth.readOAuthReturn('#id_token=TOK&state=other', s2).message, /could not be verified/);

  // Stale.
  const s3 = memoryStorage();
  oauth.rememberOAuth(s3, started.pending);
  const stale = oauth.readOAuthReturn(`#id_token=TOK&state=${started.pending.state}`, s3, 1000 + oauth.OAUTH_STATE_TTL_MS + 1);
  assert.equal(stale.kind, 'error');
  assert.match(stale.message, /took too long/);

  // The provider's own refusals.
  const s4 = memoryStorage();
  oauth.rememberOAuth(s4, started.pending);
  const denied = oauth.readOAuthReturn(`?error=access_denied&state=${started.pending.state}`, s4, 2000);
  assert.deepEqual(denied, { kind: 'error', provider: 'google', message: 'Sign-in was cancelled. Nothing changed.' });
  assert.match(oauth.providerErrorCopy('redirect_uri_mismatch'), /not configured for this address/);
});

test('the token goes to the route whose validator binds that key name', () => {
  assert.deepEqual(oauth.oauthSignInRequest('google', 'TOK'), { path: '/auth/google/mobile', body: { idToken: 'TOK' } });
  assert.deepEqual(oauth.oauthSignInRequest('apple', 'TOK'), { path: '/auth/apple/mobile', body: { identityToken: 'TOK' } });
  assert.deepEqual(oauth.oauthSignInRequest('google', 'TOK', 'en-US'), { path: '/auth/google/mobile', body: { idToken: 'TOK', locale: 'en-US' } });
  assert.deepEqual(oauth.oauthSignInRequest('apple', 'TOK', null), { path: '/auth/apple/mobile', body: { identityToken: 'TOK' } });
});

test('the API refusals read as something a person can act on', () => {
  const at = (status, data) => ({ response: { status, data } });
  assert.match(oauth.oauthApiErrorCopy(at(503, { message: 'Provider sign-in is not enabled' }), 'google'), /not switched on for this server/);
  assert.match(oauth.oauthApiErrorCopy(at(401, { message: 'Invalid Google identity token' }), 'google'), /Google could not verify/);
  assert.match(oauth.oauthApiErrorCopy(at(429, {}), 'apple'), /Too many sign-in attempts/);
  assert.equal(oauth.oauthApiErrorCopy(at(403, { message: 'This account is currently unavailable' }), 'apple'), 'This account is currently unavailable');
  assert.match(oauth.oauthApiErrorCopy(new Error('offline'), 'apple'), /Could not finish signing in with Apple/);
});

test('both buttons are gated on the server capability AND a configured client id, and the routes are literals', () => {
  const login = read('src/pages/Login.tsx');
  assert.match(login, /import \{ useOAuthProviders \} from '\.\.\/lib\/capabilities'/);
  assert.match(login, /const \{ google, apple, isLoading \} = useOAuthProviders\(\);/);
  assert.match(login, /VITE_GOOGLE_CLIENT_ID: import\.meta\.env\.VITE_GOOGLE_CLIENT_ID/);
  assert.match(login, /VITE_APPLE_SERVICES_ID: import\.meta\.env\.VITE_APPLE_SERVICES_ID/);
  assert.match(login, /const configured = providerOrder\(\)\.filter\(\(p\) => ids\[p\]\);/);
  assert.match(login, /const providers = configured\.filter\(\(p\) => enabled\[p\]\);/);
  // A build with no client id draws nothing and reserves nothing, which is
  // the deployed case; a build that has one holds the buttons' exact height
  // while the capability query is out, so the form never jumps.
  assert.match(login, /if \(!isLoading \|\| configured\.length === 0 \|\| seenBefore === false\) return null;/);
  assert.match(login, /rememberProviderAnswer\(localStorage, anyProvider\)/, 'the last answer decides the next cold load\u2019s first frame');
  assert.match(login, /<Skeleton key=\{p\} className="h-\[52px\] w-full rounded-sm" \/>/);
  // Written out so scripts/audit-api-contracts.cjs can resolve them.
  assert.match(login, /api\.post\('\/auth\/google\/mobile', body\)/);
  assert.match(login, /api\.post\('\/auth\/apple\/mobile', body\)/);
  assert.match(login, /window\.history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/, 'the credential leaves the URL at once');
  assert.match(login, /adoptSession\(\{ token: data\.token, user: data\.user \}\)/);
  // Neither provider button is the screen's filled blue.
  const block = login.slice(login.indexOf('export function ProviderSignIn'), login.indexOf('type LoginState'));
  assert.doesNotMatch(block, /variant="primary"/);
  assert.match(block, /variant="secondary"/);
  assert.match(read('src/pages/Register.tsx'), /\{step === 1 \? <ProviderSignIn returnTo=\{target\} disabled=\{busy\} onError=\{setError\} \/> : null\}/);

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ['POST /api/auth/google/mobile', 'POST /api/auth/apple/mobile', 'POST /api/auth/logout-all', 'PUT /api/users/password']) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('the session is adopted through the store, with the pending-deletion branch the email path has', () => {
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /adoptSession: \(payload: \{ token: string; user: User \}, options\?: LoginOptions\) => void;/);
  const action = auth.slice(auth.indexOf('adoptSession: ({ token, user }'), auth.indexOf('login: async (email, password'));
  assert.match(action, /tokenStore\.set\(token, remember \? 'local' : 'session'\)/);
  assert.match(action, /pendingDeletion: \{ scheduledFor: user\.deletion\?\.scheduledFor \?\? null \}/);
  assert.match(action, /rememberSnapshot\(user\)/);
});

/* -------------------------------------------------------------- birth date */

test('a birth date is the API’s calendar day and nothing else, with the API’s own words for each refusal', () => {
  const now = new Date(2026, 8, 21); // 21 September 2026, local
  const problem = (v) => dob.birthDateProblem(v, { now });
  assert.equal(problem(''), null, 'the field is optional on this API');
  assert.equal(problem('', { required: true }), null, 'options are per call');
  assert.equal(dob.birthDateProblem('', { required: true, now }), 'missing');
  assert.equal(problem('2000-05-04'), null);
  for (const bad of ['2000-5-4', '04/05/2000', '2000-05-04T00:00:00Z', 'yesterday', '2000-13-01', '2013-02-29']) {
    assert.equal(problem(bad), 'malformed', `${bad} is not YYYY-MM-DD`);
  }
  assert.equal(problem('2012-02-29'), null, 'a real leap day passes');
  assert.equal(problem('2026-09-22'), 'implausible', 'tomorrow is not a birth date');
  assert.equal(problem('1899-01-01'), 'implausible', 'older than 120 years is a typo');
  assert.equal(dob.birthDateError('2000-5-4', { now }), 'Enter your date of birth as YYYY-MM-DD');
  assert.equal(dob.birthDateError('2026-09-22', { now }), 'Enter a valid date of birth');
  assert.equal(dob.birthDateError('2000-05-04', { now }), null);
  assert.equal(dob.todayIso(now), '2026-09-21');
  assert.equal(dob.oldestIso(now), '1906-09-21');
});

test('the age bands are the server’s four, and the block fires the day before the thirteenth birthday', () => {
  const now = new Date(2026, 8, 21);
  assert.equal(dob.ageOn('2013-09-21', now), 13, 'the birthday itself counts');
  assert.equal(dob.ageOn('2013-09-22', now), 12);
  assert.equal(dob.isUnderMinimum('2013-09-21', now), false);
  assert.equal(dob.isUnderMinimum('2013-09-22', now), true);
  assert.equal(dob.isUnderMinimum('', now), false, 'no date is not an under-age date');
  assert.equal(dob.ageBandFor('2013-09-22', now), 'under_min');
  assert.equal(dob.ageBandFor('2011-01-01', now), '13_15');
  assert.equal(dob.ageBandFor('2009-01-01', now), '16_17');
  assert.equal(dob.ageBandFor('2000-01-01', now), 'adult');
  assert.equal(dob.ageBandFor(null, now), null);
  assert.equal(dob.MINIMUM_AGE, 13);
});

test('the server’s two birthDate refusals are read apart, and a stored date is the day part', () => {
  const at = (data) => ({ response: { status: 400, data } });
  assert.deepEqual(dob.birthDateApiError(at({ code: 'AGE_REQUIREMENT', field: 'birthDate', message: 'Vybe is not available for your age yet.' })), {
    underMinimum: true,
    message: 'Vybe is not available for your age yet.',
  });
  assert.deepEqual(dob.birthDateApiError(at({ code: 'VALIDATION', field: 'birthDate', message: 'Enter a valid date of birth' })), {
    underMinimum: false,
    message: 'Enter a valid date of birth',
  });
  assert.equal(dob.birthDateApiError(at({ field: 'username', message: 'taken' })), null);
  assert.equal(dob.birthDateApiError({ response: { status: 409, data: { field: 'birthDate' } } }), null);
  // GET /users/me omits the key entirely when it was never given.
  assert.equal(dob.storedBirthDate({ birthDate: '2000-05-04T00:00:00.000Z' }), '2000-05-04');
  assert.equal(dob.storedBirthDate({}), null);
  assert.equal(dob.storedBirthDate(null), null);
  assert.equal(dob.storedBirthDate({ birthDate: 'not a date' }), null);
});

test('the wizard blocks before the request, sends the day only when it has one, and shows the server’s refusal on the field', () => {
  const register = read('src/pages/Register.tsx');
  assert.match(register, /const dobErr = birthDateError\(birthDate\);/);
  assert.match(register, /if \(isUnderMinimum\(birthDate\)\) \{\s*setUnderAge\(true\);\s*return;\s*\}/, 'nothing is sent for an under-age date');
  assert.match(register, /\.\.\.\(birthDate \? \{ birthDate \} : \{\}\)/, 'an empty field is omitted, never sent as ""');
  assert.match(register, /const dobFailure = birthDateApiError\(e2\);/);
  assert.match(register, /if \(dobFailure\.underMinimum\) setUnderAge\(true\);/);
  assert.match(register, /max=\{todayIso\(\)\}/);
  assert.match(register, /min=\{oldestIso\(\)\}/);
  assert.match(register, /autoComplete="bday"/);
  assert.match(register, /\{step === 3 && underAge \? <AgeBlock \/> : null\}/);
  // It is not kept in the sign-up draft.
  const draft = register.slice(register.indexOf('writeRegisterDraft(sessionStorage, {'), register.indexOf('});', register.indexOf('writeRegisterDraft(sessionStorage, {')));
  assert.doesNotMatch(draft, /birthDate/);
  // Settings states it and offers no edit: no route writes it after sign-up.
  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /<BirthDateRow user=\{meQuery\.data\} \/>/);
  assert.match(settings, /Not on file\. It can only be given when an account is created\./);
  const row = settings.slice(settings.indexOf('function BirthDateRow'), settings.indexOf('/* ------------------------------------------------------------------ home gym */'));
  assert.doesNotMatch(row, /<Input|<DateField|api\.put|api\.post/, 'the row is read-only: nothing writes birthDate after registration');
});

/* --------------------------------------------------------- login activity */

test('the device line names the browser and the platform, with Chrome ruled out before Safari', () => {
  const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  const safariMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0';
  const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(activity.deviceLabel(chromeMac), 'Chrome on macOS');
  assert.equal(activity.deviceLabel(safariMac), 'Safari on macOS');
  assert.equal(activity.deviceLabel(edge), 'Edge on Windows');
  assert.equal(activity.deviceLabel(iosSafari), 'Safari on iPhone');
  assert.equal(activity.deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(activity.deviceLabel(''), 'This browser');
  assert.equal(activity.platformName(''), null);
});

test('the session line is the token’s own expiry, or the tab, and never a guess', () => {
  const fmt = (at) => at.toISOString().slice(0, 10);
  const now = Date.UTC(2026, 8, 21);
  assert.equal(activity.sessionLifetimeLine(now + 86_400_000, 'session', fmt, now), 'Ends when you close this tab.');
  assert.equal(activity.sessionLifetimeLine(Date.UTC(2026, 9, 21), 'local', fmt, now), 'Signed in until 2026-10-21.');
  assert.match(activity.sessionLifetimeLine(now - 1, 'local', fmt, now), /has expired/);
  assert.equal(activity.sessionLifetimeLine(null, 'local', fmt, now), null, 'an unreadable token says nothing');
  assert.equal(activity.sessionLifetimeLine(undefined, null, fmt, now), null);
});

test('the card describes this device, says why there is no list, and keeps the one wide sign-out', () => {
  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /<SettingsCard id="sessions" title=\{LOGIN_ACTIVITY_TITLE\}/, 'the card id is unchanged so /settings#sessions still lands');
  assert.match(settings, /sessionLifetimeLine\(jwtExpiryMs\(tokenStore\.get\(\)\), tokenStore\.persistence\(\)/);
  assert.match(settings, /deviceLabel\(typeof navigator === 'undefined' \? null : navigator\.userAgent\)/);
  assert.match(settings, /\{NO_DEVICE_LIST\}/);
  assert.match(settings, /logoutEverywhere\(\)/);
  assert.match(activity.NO_DEVICE_LIST, /cannot list your other sessions/);
  // No per-device control is drawn, because no route can honour one.
  assert.doesNotMatch(settings, /Sign out other devices/);
  assert.doesNotMatch(settings, /auth\/sessions/);
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { AgeBlock } = await import('../src/pages/Register.tsx');

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');

test('the under-age block states the rule, says nothing was created, and offers support', () => {
  const html = decode(renderToString(h(MemoryRouter, null, h(AgeBlock))));
  assert.match(html, /Vybe is not available for your age yet/);
  assert.match(html, /You need to be at least 13 to have a Vybe account/);
  assert.match(html, /Nothing has been created and the date you entered has not been sent anywhere/);
  assert.match(html, /href="\/support"[^>]*>Contact support</);
  // It is a warning, not an error, and it carries no form.
  assert.doesNotMatch(html, /<input|<form/);
});
