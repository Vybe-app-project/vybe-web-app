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

/* ------------------------------------------------------------------ copy */

test('the 429 sentence is one sentence, in both the import-free modules', () => {
  assert.equal(apiError.rateLimitedCopy(37), 'Too many attempts, try again in 37 s');
  assert.equal(apiError.rateLimitedCopy(null), 'Too many attempts, try again in a moment');
  for (const value of [37, 1, 900, 0, null, undefined, -1]) {
    assert.equal(authRedirect.rateLimitedCopy(value), apiError.rateLimitedCopy(value), `rateLimitedCopy(${value})`);
  }
  assert.equal(authRedirect.OFFLINE_COPY, apiError.OFFLINE_COPY);
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
  assert.match(screen, /useLockBody\(true\)/);
  assert.match(screen, /useFocusTrap\(true, ref\)/);
  assert.match(screen, /z-\[300\]/);
  assert.match(screen, /If this keeps happening, close every Vybe tab and open it again\./);
  assert.doesNotMatch(screen, /onClose|Dismiss|Not now/, 'no dismiss: nothing behind it works');

  const clientPolicy = read('src/lib/clientPolicy.ts');
  assert.match(clientPolicy, /RELOAD_GUARD_KEY = 'vybe\.reload426At'/);
  assert.match(clientPolicy, /getRegistrations/);
  assert.match(clientPolicy, /SKIP_WAITING/);
  assert.match(clientPolicy, /controllerchange/);

  const notices = read('src/components/ApiNotices.tsx');
  assert.match(notices, /onRateLimited\(/);
  assert.match(notices, /isInlineErrorSurface\(event\.url\)/);
  assert.match(notices, /key: 'rate-limited'/);
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
  assert.match(caps, /return caps\?\.livestreamRelay === true;/, 'liveVideoEnabled is unchanged');
  // The admin console keeps its own capabilities query.
  assert.doesNotMatch(read('src/pages/admin/AdminSystem.tsx'), /useCapabilities|useLiveEnabled/);
  // Nobody else reads the old shape.
  const consumers = ['src/components/Layout.tsx', 'src/pages/Livestreams.tsx', 'src/lib/capabilities.ts'];
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
  assert.match(read('scripts/deploy-web-remote.sh'), /--build-arg "VITE_WEB_BUILD=\$\{commit_sha:0:12\}"/);
});

test('the premium flags the API no longer sends have no readers', () => {
  for (const relative of ['src/lib/auth.ts', 'src/lib/hooks.ts', 'src/pages/UserRow.tsx', 'src/pages/admin/AdminUsers.tsx']) {
    assert.doesNotMatch(read(relative), /isPremium|isSubscribed/, relative);
  }
});
