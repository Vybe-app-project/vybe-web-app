import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

/**
 * Wave C1 api-client-core: the client policy plumbing (426 latch, 429 bus,
 * reload guard), the feature-flag gate for Live, and the source contracts
 * that keep the interceptors, the header roll-out, the 426 screen and the
 * build identity wired the way the API expects.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const policy = await import('../src/lib/clientPolicy.ts');
const capabilities = await import('../src/lib/capabilities.ts');
const apiError = await import('../src/lib/apiError.ts');
const authRedirect = await import('../src/lib/authRedirect.ts');

/* ------------------------------------------------------------------ feature flags */

test('a feature is on only when the server said exactly true', () => {
  const { featureEnabled, FEATURE_DEFAULTS, normalizeCapabilities, liveAvailable } = capabilities;
  assert.equal(featureEnabled(undefined, 'live'), false);
  assert.equal(featureEnabled(null, 'live'), false);
  assert.equal(featureEnabled({ live: true }, 'live'), true);
  assert.equal(featureEnabled({ live: 'true' }, 'live'), false);
  assert.equal(featureEnabled({ live: 1 }, 'live'), false);

  const empty = normalizeCapabilities({});
  assert.deepEqual(empty.features, { live: false, reviewPrompt: false, sessions: false, 'telemetry.crashReports': false });
  assert.deepEqual(Object.keys(FEATURE_DEFAULTS).sort(), ['live', 'reviewPrompt', 'sessions', 'telemetry.crashReports']);
  assert.equal(empty.client, null);
  assert.deepEqual(empty.capabilities, {});
  assert.deepEqual(normalizeCapabilities(null).features, empty.features);
  assert.deepEqual(normalizeCapabilities('nope').features, empty.features);

  const full = normalizeCapabilities({
    success: true,
    authenticated: true,
    capabilities: { livestreamRelay: true, turnRelay: 'yes', emailAuth: true },
    client: { platform: 'web', version: '1.0.0', build: '5228f21', minVersion: null, latestVersion: '1.1.0', storeUrl: null, updateRequired: false, updateAvailable: true, message: 'Update soon', platforms: { web: { minVersion: null, latestVersion: '1.1.0', storeUrl: null }, ios: { minVersion: '1.2.0' } } },
    features: { live: true, sessions: false, 'telemetry.crashReports': true, 'labs.newFeed': true },
  });
  assert.deepEqual(full.capabilities, { livestreamRelay: true, turnRelay: false, emailAuth: true });
  assert.deepEqual(full.features, { live: true, reviewPrompt: false, sessions: false, 'telemetry.crashReports': true, 'labs.newFeed': true });
  assert.equal(full.client.updateAvailable, true);
  assert.equal(full.client.latestVersion, '1.1.0');
  assert.deepEqual(full.client.platforms.ios, { minVersion: '1.2.0', latestVersion: null, storeUrl: null });

  // Live needs the flag AND the relay.
  assert.equal(liveAvailable(undefined), false);
  assert.equal(liveAvailable(normalizeCapabilities({ features: { live: true } })), false, 'flag without a relay');
  assert.equal(liveAvailable(normalizeCapabilities({ capabilities: { livestreamRelay: true } })), false, 'relay without the flag');
  assert.equal(liveAvailable(normalizeCapabilities({ capabilities: { livestreamRelay: true }, features: { live: true } })), true);
  // The relay check itself is unchanged.
  assert.equal(capabilities.liveVideoEnabled({ livestreamRelay: true }), true);
  assert.equal(capabilities.liveVideoEnabled(undefined), false);
});

/* ------------------------------------------------------------------ 426 latch */

test('the 426 latch keeps only the client-policy code and shapes the notice', () => {
  const { isUpdateRequiredResponse, noticeFrom, useClientPolicy } = policy;
  assert.equal(isUpdateRequiredResponse(426, { code: 'CLIENT_UPDATE_REQUIRED' }), true);
  assert.equal(isUpdateRequiredResponse(426, { message: 'Upgrade' }), false);
  assert.equal(isUpdateRequiredResponse(200, { code: 'CLIENT_UPDATE_REQUIRED' }), false);
  assert.equal(isUpdateRequiredResponse(426, null), false);

  const notice = noticeFrom({ code: 'CLIENT_UPDATE_REQUIRED', message: ' Why ', platform: 'web', minVersion: '1.1.0', latestVersion: null, storeUrl: 7 }, 42);
  assert.deepEqual(notice, { message: 'Why', platform: 'web', minVersion: '1.1.0', latestVersion: null, storeUrl: null, at: 42 });
  assert.deepEqual(noticeFrom('junk', 1), { message: null, platform: null, minVersion: null, latestVersion: null, storeUrl: null, at: 1 });

  assert.equal(useClientPolicy.getState().updateRequired, null);
  try {
    const seen = [];
    const stop = useClientPolicy.subscribe((state) => seen.push(state.updateRequired));
    useClientPolicy.getState().noteUpdateRequired({ code: 'CLIENT_UPDATE_REQUIRED', message: 'First' });
    useClientPolicy.getState().noteUpdateRequired({ code: 'CLIENT_UPDATE_REQUIRED', message: 'Second' });
    stop();
    assert.equal(useClientPolicy.getState().updateRequired.message, 'Second', 'a repeat refreshes the details');
    assert.deepEqual(seen.map((n) => n.message), ['First', 'Second']);
  } finally {
    useClientPolicy.getState().clear();
  }
  assert.equal(useClientPolicy.getState().updateRequired, null);
});

/* ------------------------------------------------------------------ 429 bus */

test('every 429 reaches every listener, and the inline surfaces are known', () => {
  const { emitRateLimited, isInlineErrorSurface, onRateLimited } = policy;
  const seen = [];
  const stopA = onRateLimited((event) => seen.push(['a', event.url]));
  const stopB = onRateLimited(() => {
    throw new Error('one listener must not stop the others');
  });
  const stopC = onRateLimited((event) => seen.push(['c', event.retryAfterSec]));
  emitRateLimited({ url: '/posts/create', retryAfterSec: 30, at: 1 });
  stopA();
  stopB();
  stopC();
  emitRateLimited({ url: '/posts/create', retryAfterSec: 30, at: 2 });
  assert.deepEqual(seen, [['a', '/posts/create'], ['c', 30]]);

  assert.equal(isInlineErrorSurface('/auth/login'), true);
  assert.equal(isInlineErrorSurface('/auth/register'), true);
  assert.equal(isInlineErrorSurface('/auth/request-reset?x=1'), true);
  assert.equal(isInlineErrorSurface('/api/auth/login'), true);
  assert.equal(isInlineErrorSurface('https://api.vybeapp.fit/api/auth/login'), true);
  assert.equal(isInlineErrorSurface('auth/login'), true);
  assert.equal(isInlineErrorSurface('/admins/login'), true);
  assert.equal(isInlineErrorSurface('/admins/request-reset'), true);
  assert.equal(isInlineErrorSurface('/admins/reset-password'), true);
  assert.equal(isInlineErrorSurface('/support/message'), true);
  assert.equal(isInlineErrorSurface('/food/search?q=oats'), true, 'Meals renders its own "Too many searches" row');
  assert.equal(isInlineErrorSurface('/posts/create'), false);
  assert.equal(isInlineErrorSurface('/admins/users'), false);
  assert.equal(isInlineErrorSurface('/authors'), false);
  assert.equal(isInlineErrorSurface(''), false);
  assert.equal(isInlineErrorSurface(undefined), false);
});

/* ------------------------------------------------------------------ reload guard */

test('a 426 reload runs once a minute per tab, and never fails on a missing store', () => {
  const { RELOAD_GUARD_KEY, RELOAD_GUARD_MS, shouldAutoReload, stampReload } = policy;
  assert.equal(RELOAD_GUARD_KEY, 'vybe.reload426At');
  assert.equal(RELOAD_GUARD_MS, 60_000);
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)) };
  const now = 1_800_000_000_000;
  assert.equal(shouldAutoReload(now, storage), true, 'empty store');
  stampReload(now, storage);
  assert.equal(store.get(RELOAD_GUARD_KEY), String(now));
  assert.equal(shouldAutoReload(now + 1_000, storage), false, 'within a minute');
  assert.equal(shouldAutoReload(now + 59_999, storage), false);
  assert.equal(shouldAutoReload(now + 60_000, storage), true, 'after a minute');
  store.set(RELOAD_GUARD_KEY, 'garbage');
  assert.equal(shouldAutoReload(now, storage), true, 'an unreadable stamp does not block');
  assert.equal(shouldAutoReload(now, null), true, 'no storage at all');
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(shouldAutoReload(now, throwing), true);
  assert.doesNotThrow(() => stampReload(now, throwing));
});

test('the reload waits for a person who is typing', () => {
  const { isTextEntryActive } = policy;
  const doc = (activeElement) => ({ activeElement });
  assert.equal(isTextEntryActive(undefined), false, 'no document (tests, workers)');
  assert.equal(isTextEntryActive(doc(null)), false);
  assert.equal(isTextEntryActive(doc({ tagName: 'BODY' })), false);
  assert.equal(isTextEntryActive(doc({ tagName: 'BUTTON' })), false);
  assert.equal(isTextEntryActive(doc({ tagName: 'TEXTAREA' })), true);
  assert.equal(isTextEntryActive(doc({ tagName: 'INPUT' })), true, 'an input without a type is text');
  for (const type of ['text', 'search', 'email', 'password', 'number', 'url', 'tel']) {
    assert.equal(isTextEntryActive(doc({ tagName: 'INPUT', type })), true, type);
  }
  for (const type of ['checkbox', 'radio', 'range', 'submit', 'button', 'file', 'color', 'hidden']) {
    assert.equal(isTextEntryActive(doc({ tagName: 'INPUT', type })), false, type);
  }
  assert.equal(isTextEntryActive(doc({ tagName: 'DIV', isContentEditable: true })), true, 'a rich composer');
  assert.equal(isTextEntryActive(doc({ tagName: 'DIV', isContentEditable: false })), false);
});

/* ------------------------------------------------------------------ copy */

test('the 429 wait is written for a person, and the two import-free modules agree', () => {
  const { retryWaitCopy, rateLimitedCopy } = apiError;
  assert.equal(retryWaitCopy(1), 'in 1 second');
  assert.equal(retryWaitCopy(45), 'in 45 seconds');
  assert.equal(retryWaitCopy(89), 'in 89 seconds');
  assert.equal(retryWaitCopy(90), 'in about 2 minutes');
  assert.equal(retryWaitCopy(180), 'in about 3 minutes');
  assert.equal(retryWaitCopy(3542), 'in about 60 minutes', 'the hour-long write windows');
  assert.equal(retryWaitCopy(5399), 'in about 90 minutes');
  assert.equal(retryWaitCopy(5400), 'in about 2 hours');
  assert.equal(retryWaitCopy(86400), 'in about 24 hours', 'the reports window');
  assert.equal(retryWaitCopy(0.2), 'in 1 second', 'rounded up, never understated');
  for (const none of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.equal(retryWaitCopy(none), 'in a moment');
  }
  for (const text of [retryWaitCopy(45), retryWaitCopy(3542), retryWaitCopy(86400)]) {
    assert.doesNotMatch(text, /\d s\b/, 'no bare seconds');
  }

  // Attempts on the auth routes, a neutral verb everywhere else.
  assert.equal(rateLimitedCopy(37, 'attempts'), 'Too many attempts. Try again in 37 seconds.');
  assert.equal(rateLimitedCopy(720), 'You\u2019re doing that too often. Try again in about 12 minutes.');
  assert.equal(rateLimitedCopy(null), 'You\u2019re doing that too often. Try again in a moment.');
  assert.equal(apiError.isRateLimitedCopy(rateLimitedCopy(720)), true);
  assert.equal(apiError.isRateLimitedCopy(rateLimitedCopy(37, 'attempts')), true);
  assert.equal(apiError.isRateLimitedCopy(authRedirect.rateLimitedCopy(37)), true);
  assert.equal(apiError.isRateLimitedCopy('Too many searches. Try again in about 3 minutes.'), false, 'a page\u2019s own inline copy is not the shared toast');
  assert.equal(apiError.isRateLimitedCopy(null), false);
  assert.equal(apiError.RATE_LIMITED_TOAST_KEY, 'rate-limited');

  for (const value of [37, 1, 900, 3542, 0, null, undefined, -1]) {
    assert.equal(authRedirect.rateLimitedCopy(value), apiError.rateLimitedCopy(value, 'attempts'), `rateLimitedCopy(${value})`);
    assert.equal(authRedirect.retryWaitCopy(value), apiError.retryWaitCopy(value), `retryWaitCopy(${value})`);
  }
  assert.equal(authRedirect.OFFLINE_COPY, apiError.OFFLINE_COPY);

  // Which routes count as attempts.
  const { isAttemptPath, apiPathOf } = apiError;
  assert.equal(apiPathOf('https://api.vybeapp.fit/api/auth/login?x=1'), '/auth/login');
  assert.equal(apiPathOf('auth/login'), '/auth/login');
  assert.equal(apiPathOf('/api'), '');
  for (const url of ['/auth/login', '/auth/register', '/auth/send-otp', '/auth/request-reset', '/auth/reset-password', '/auth/reauth', '/api/auth/login', '/admins/login', '/admins/request-reset', '/admins/reset-password']) {
    assert.equal(isAttemptPath(url), true, url);
  }
  for (const url of ['/posts/create', '/support/message', '/food/search', '/admins/users', '/authors', '', null, undefined]) {
    assert.equal(isAttemptPath(url), false, String(url));
  }
  assert.equal(authRedirect.retryAfterSecondsOf({ response: { headers: { 'retry-after': '900' } } }), 900);
  assert.equal(authRedirect.retryAfterSecondsOf({ response: { data: { retryAfterSec: 12 }, headers: { 'retry-after': '900' } } }), 12);
  assert.equal(authRedirect.retryAfterSecondsOf({ response: { data: { retryAfter: '5' } } }), 5);
  assert.equal(authRedirect.retryAfterSecondsOf({ response: { headers: { get: (n) => (n === 'retry-after' ? '8' : null) } } }), 8);
  assert.equal(authRedirect.retryAfterSecondsOf({}), null);
});

/* ------------------------------------------------------------------ source pins */

test('api.ts: one interceptor set per instance, the identity header, the 426/429/401 branches, no axios text', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /installClientInterceptors\(api, 'user'\);/);
  assert.match(api, /installClientInterceptors\(adminApi, 'admin'\);/);
  assert.match(api, /'X-Vybe-Client'/);
  assert.match(api, /status === 426/);
  assert.match(api, /status === 429/);
  assert.match(api, /status === 401 && kind/);
  assert.match(api, /return parseApiError\(e, fallback\)\.message;/);
  assert.doesNotMatch(api, /ax\?\.message|ax\.message/);
  assert.match(api, /export function clientHeaders\(\)/);
  assert.match(api, /headers: \{ Authorization: `Bearer \$\{token\}`, \.\.\.clientHeaders\(\), 'Content-Type': 'application\/json' \}/, 'revokeSession carries the header');
  assert.match(api, /export const WEB_VERSION/);
  assert.match(api, /export const WEB_BUILD/);
  assert.match(api, /import\.meta\.env\.VITE_WEB_VERSION/);
  assert.match(api, /import\.meta\.env\.VITE_WEB_BUILD\b/);
  assert.match(api, /import\.meta\.env\.VITE_WEB_BUILT_AT/);
  // The raw fetches that bypass axios carry it too; the presigned S3 uploads must not.
  const liveMedia = read('src/lib/liveMedia.ts');
  assert.equal((liveMedia.match(/\.\.\.clientHeaders\(\)/g) || []).length, 2);
  assert.doesNotMatch(read('src/lib/hooks.ts'), /clientHeaders|X-Vybe-Client/);
  assert.match(read('src/pages/Register.tsx'), /installClientInterceptors\(registrationApi, null\);/);
  assert.match(read('src/lib/socket.ts'), /extraHeaders: clientHeaders\(\),/);
  // The import-free modules stay import-free.
  for (const relative of ['src/lib/apiError.ts', 'src/lib/clientHeader.ts', 'src/lib/authRedirect.ts']) {
    assert.doesNotMatch(read(relative), /^\s*import\s/m, `${relative} must stay import-free`);
  }
});

test('the 426 screen and the 429 toasts are mounted once, inside the toast provider', () => {
  const app = read('src/App.tsx');
  const start = app.indexOf('<ToastProvider>');
  const end = app.indexOf('<Suspense', start);
  assert.ok(start > 0 && end > start);
  const shell = app.slice(start, end);
  assert.match(shell, /<UpdateRequiredScreen \/>/);
  assert.match(shell, /<ApiNotices \/>/);
  assert.equal((app.match(/<UpdateRequiredScreen \/>/g) || []).length, 1);
  assert.equal((app.match(/<ApiNotices \/>/g) || []).length, 1);
  // The Live routes and the legacy redirects stay.
  assert.match(app, /<Route path="live" element=\{<Livestreams \/>\} \/>/);
  assert.match(app, /<Route path="live\/:streamId" element=\{<Livestreams \/>\} \/>/);
  assert.match(app, /<Route path="livestreams" element=\{<Navigate to="\/live" replace \/>\} \/>/);

  const screen = read('src/components/UpdateRequiredScreen.tsx');
  assert.match(screen, /role="dialog"/);
  assert.match(screen, /aria-modal="true"/);
  assert.match(screen, /aria-labelledby="update-required-title"/);
  assert.match(screen, /aria-describedby="update-required-body"/);
  assert.match(screen, /Reload Vybe/);
  assert.match(screen, /reloadForUpdate\(\)/);
  assert.match(screen, /shouldAutoReload\(/);
  assert.match(screen, /isTextEntryActive\(\)/, 'no auto-reload over a half-written composer');
  assert.match(screen, /useLockBody\(true\)/);
  assert.match(screen, /useFocusTrap\(true, ref\)/);
  assert.match(screen, /z-\[300\]/);
  // The auto-reload is announced, and there is time to hear it.
  assert.match(screen, /Vybe will reload in a moment to pick it up\. You stay signed in\./);
  const delay = Number((screen.match(/AUTO_RELOAD_DELAY_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, ''));
  assert.ok(delay >= 5000, `auto-reload delay ${delay} ms is under the 5 s reading time`);
  // The loop hint names the real cause (the floor is ahead of the newest build) and a real next step.
  assert.match(screen, /If this keeps happening, Vybe is still being updated\. Try again in a few minutes\./);
  assert.doesNotMatch(screen, /close every Vybe tab/, 'closing tabs clears the per-tab guard and loops again');
  assert.doesNotMatch(screen, /onClose|Dismiss|Not now/, 'no dismiss: nothing behind it works');

  const clientPolicy = read('src/lib/clientPolicy.ts');
  assert.match(clientPolicy, /RELOAD_GUARD_KEY = 'vybe\.reload426At'/);
  assert.match(clientPolicy, /getRegistrations/);
  // update() resolves when the new worker exists, not when it has precached
  // the shell; the reload waits for the installing worker before promoting it.
  assert.match(clientPolicy, /registration\.installing \? whenInstalled\(registration\.installing, INSTALL_WAIT_MS\)/);
  assert.match(clientPolicy, /addEventListener\('statechange'/);
  assert.match(clientPolicy, /SKIP_WAITING/);
  assert.match(clientPolicy, /controllerchange/);
  const installWait = Number((clientPolicy.match(/INSTALL_WAIT_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, ''));
  assert.ok(installWait >= 2000 && installWait <= 15000, `install wait ${installWait} ms`);

  // One toast per 429: the app-wide toast and a page's own share a key.
  const notices = read('src/components/ApiNotices.tsx');
  assert.match(notices, /onRateLimited\(/);
  assert.match(notices, /isInlineErrorSurface\(event\.url\)/);
  assert.match(notices, /key: RATE_LIMITED_TOAST_KEY/);
  assert.match(notices, /isAttemptPath\(event\.url\) \? 'attempts' : 'actions'/);
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /const rateLimited = typeof e === 'string' \? isRateLimitedCopy\(e\) : parseApiError\(e\)\.status === 429;/);
  assert.match(ui, /const key = options\?\.key \?\? \(rateLimited \? RATE_LIMITED_TOAST_KEY : undefined\);/);
});

test('Live is gated on features.live as well as the relay, everywhere it is promoted', () => {
  const layout = read('src/components/Layout.tsx');
  assert.equal((layout.match(/useLiveEnabled\(\)\.enabled/g) || []).length, 2);
  assert.doesNotMatch(layout, /liveVideoEnabled\(capabilities\.data\)/);
  assert.match(layout, /const LIVE_PATH = '\/live';/);
  const live = read('src/pages/Livestreams.tsx');
  assert.match(live, /const capabilities = useLiveEnabled\(\);/);
  assert.match(live, /const enabled = capabilities\.enabled;/);
  assert.match(live, /<LiveUnavailable streamId=\{streamId\} \/>/);
  assert.doesNotMatch(live, /liveVideoEnabled\(capabilities\.data\)/);

  const caps = read('src/lib/capabilities.ts');
  assert.match(caps, /api\.get\('\/capabilities\/authenticated'\)/);
  assert.match(caps, /api\.get\('\/capabilities'\)/);
  assert.match(caps, /queryKey: \['capabilities', signedIn \? 'me' : 'public'\]/);
  assert.match(caps, /export function useFeature\(name: string\): boolean/);
  // Every capability a page needs is named here rather than read ad hoc: the
  // session form asks `useWorkoutLogIdempotency()`, never the raw map.
  assert.match(caps, /export function useWorkoutLogIdempotency\(\): boolean/);
  assert.match(caps, /capabilities\.workoutLogIdempotency === true/);
  assert.match(read('src/pages/workouts/SessionForm.tsx'), /const idempotent = useWorkoutLogIdempotency\(\);/);
  assert.match(caps, /return caps\?\.livestreamRelay === true;/, 'liveVideoEnabled is unchanged');
  // The admin console keeps its own capabilities query.
  assert.doesNotMatch(read('src/pages/admin/AdminSystem.tsx'), /useCapabilities|useLiveEnabled/);
  // Nobody else reads the old shape. Achievements reads `features` plus the
  // query's isSuccess (Claim never flashes before the answer), not the relay.
  // The first-week card reads the optional kill switch `features.getStartedCard === false`
  // through the shared hook and never the relay (tests/first-week-home.test.mjs pins that).
  const consumers = ['src/components/Layout.tsx', 'src/pages/Livestreams.tsx', 'src/lib/capabilities.ts', 'src/pages/Achievements.tsx', 'src/pages/FirstWeekCard.tsx'];
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  for (const file of walk('src').filter((f) => /\.tsx?$/.test(f) && !consumers.includes(f))) {
    assert.doesNotMatch(read(file), /useCapabilities|liveVideoEnabled|useLiveEnabled/, `${file} reads capabilities outside the shared hook`);
  }
});

test('sign-in keeps the typed fields on a 429 and Settings > About shows both builds', () => {
  const login = read('src/pages/Login.tsx');
  assert.match(login, /if \(failure\.offerReset\) \{\s*setPassword\(''\);/);
  const authRedirectSource = read('src/lib/authRedirect.ts');
  assert.match(authRedirectSource, /status === 429/);
  assert.match(authRedirectSource, /export function retryAfterSecondsOf/);

  const settings = read('src/pages/Settings.tsx');
  assert.match(settings, /import \{ VersionRow \} from '\.\.\/components\/VersionRow';/);
  assert.equal((settings.match(/<VersionRow \/>/g) || []).length, 1);
  const row = read('src/components/VersionRow.tsx');
  assert.match(row, /api\.get\('\/version'\)/);
  assert.match(row, /data-testid="about-version"/);
  assert.match(row, /queryKey: \['api-version'\]/);
  assert.match(row, /staleTime: Infinity/);
  assert.match(row, /retry: false/);
  assert.match(row, /Web build and API build, for support tickets\./);
  assert.match(row, /'unavailable'/);

  const routes = JSON.parse(read('contracts/backend-routes.json'));
  const list = JSON.stringify(routes);
  assert.match(list, /"\/api\/version"/);
  assert.match(list, /"\/api\/capabilities\/authenticated"/);
});

test('the build identity comes from the config and the release, never from a child process', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /VITE_WEB_VERSION/);
  assert.match(vite, /VITE_WEB_BUILT_AT/);
  assert.match(vite, /import pkg from '\.\/package\.json';/);
  assert.doesNotMatch(vite, /child_process|execSync|spawn/);
  assert.doesNotMatch(vite, /__VYBE_/);
  assert.match(read('Dockerfile.release'), /ARG VITE_WEB_BUILD=\nENV VITE_WEB_BUILD=\$VITE_WEB_BUILD\n/);
  assert.match(read('Dockerfile.release'), /ARG VITE_WEB_VERSION=\nENV VITE_WEB_VERSION=\$VITE_WEB_VERSION\n/);
  assert.match(read('scripts/deploy-web-remote.sh'), /--build-arg "VITE_WEB_BUILD=\$\{commit_sha:0:12\}"/);
});

test('the web version is a comparable semver per build, and a deploy below the API floor is refused', () => {
  // MAJOR from package.json, then the UTC build date and time; the static
  // package version would have made CLIENT_MIN_VERSION_WEB gate nothing or
  // every build at once.
  const vite = read('vite.config.ts');
  assert.match(vite, /const WEB_MAJOR = String\(pkg\.version\)\.split\('\.'\)\[0\] \|\| '1';/);
  assert.match(vite, /const time = Number\(iso\.slice\(11, 16\)\.replace\(':', ''\)\);/, 'no leading zero on the time: semver');
  assert.match(vite, /return `\$\{major\}\.\$\{date\}\.\$\{time\}`;/);
  assert.match(vite, /process\.env\.VITE_WEB_VERSION/);
  assert.match(vite, /'import\.meta\.env\.VITE_WEB_VERSION': JSON\.stringify\(WEB_VERSION\)/);
  assert.doesNotMatch(vite, /JSON\.stringify\(pkg\.version\)/);

  const remote = read('scripts/deploy-web-remote.sh');
  assert.match(remote, /--build-arg "VITE_WEB_VERSION=\$web_version"/);
  assert.match(remote, /printf '%s\.%s\.%s\\n' "\$major" "\$\(date -u \+%Y%m%d\)" "\$\(\(10#\$\(date -u \+%H%M\)\)\)"/, 'the same rule as vite.config.ts');
  assert.match(remote, /check_web_floor "\$web_version"/);
  assert.match(remote, /\/api\/capabilities/);
  assert.match(remote, /"webVersion": "\$web_version"/);
  assert.match(remote, /sort -V/);
  assert.match(remote, /refusing to publish web \$version/);
  assert.doesNotMatch(remote, /\/opt\/vybe\/|\.env\b/, 'the floor is read from the API, never from an env file');
  assert.match(read('docs/HANDOFF.md'), /CLIENT_MIN_VERSION_WEB/);
  assert.match(read('docs/HANDOFF.md'), /MAJOR\.YYYYMMDD\.HHMM/);
});

test('the premium flags the API no longer sends have no readers', () => {
  for (const relative of ['src/lib/auth.ts', 'src/lib/hooks.ts', 'src/pages/UserRow.tsx', 'src/pages/admin/AdminUsers.tsx']) {
    assert.doesNotMatch(read(relative), /isPremium|isSubscribed/, relative);
  }
});
