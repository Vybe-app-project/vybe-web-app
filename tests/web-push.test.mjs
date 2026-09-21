import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

/**
 * Web push (package P5). The pure halves are exercised directly — the five
 * support states, the token bookkeeping, the link guard, the card's state
 * resolution — and the rest is pinned as source, because the parts that talk
 * to FCM cannot run outside a browser.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const lib = await import('../src/lib/firebase.ts');
const device = await import('../src/lib/pushDevice.ts');

const ENV = {
  chrome: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    maxTouchPoints: 0,
    standalone: undefined,
    displayModeStandalone: false,
    serviceWorker: true,
    pushManager: true,
    notification: true,
    permission: 'default',
  },
  /** iOS Safari in a tab: no Notification, no PushManager, until it is installed. */
  iphoneTab: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    standalone: false,
    displayModeStandalone: false,
    serviceWorker: true,
    pushManager: false,
    notification: false,
    permission: undefined,
  },
};

test('the five support states resolve from the browser, iOS install first', () => {
  assert.equal(lib.resolvePushSupport({ ...ENV.chrome, permission: 'default' }), 'default');
  assert.equal(lib.resolvePushSupport({ ...ENV.chrome, permission: 'granted' }), 'granted');
  assert.equal(lib.resolvePushSupport({ ...ENV.chrome, permission: 'denied' }), 'denied');

  // No service worker, no push manager, no Notification: any one is enough.
  for (const missing of ['serviceWorker', 'pushManager', 'notification']) {
    assert.equal(lib.resolvePushSupport({ ...ENV.chrome, [missing]: false }), 'unsupported', missing);
  }
  assert.equal(lib.resolvePushSupport(null), 'unsupported', 'no browser at all');

  // An iPhone in a Safari tab fails the capability probe for a reason the
  // member can fix, so it must never read as "unsupported".
  assert.equal(lib.resolvePushSupport(ENV.iphoneTab), 'needs-install');
  // Installed to the Home Screen, the same phone has the whole API.
  assert.equal(
    lib.resolvePushSupport({ ...ENV.iphoneTab, standalone: true, pushManager: true, notification: true, permission: 'default' }),
    'default',
  );
  // iPadOS 13+ claims to be a Mac; the touch points give it away.
  const ipad = { ...ENV.chrome, maxTouchPoints: 5, pushManager: false, notification: false, permission: undefined };
  assert.equal(lib.resolvePushSupport(ipad), 'needs-install');
  // A real Mac with a touch bar reports maxTouchPoints 0 and stays a Mac.
  assert.equal(lib.resolvePushSupport({ ...ENV.chrome, permission: 'granted' }), 'granted');
  // display-mode covers the engines that have no navigator.standalone.
  assert.equal(lib.resolvePushSupport({ ...ENV.iphoneTab, displayModeStandalone: true }), 'unsupported');
});

test('the token record survives a bare string and refuses junk', () => {
  assert.equal(lib.parsePushTokenRecord(null), null);
  assert.equal(lib.parsePushTokenRecord(''), null);
  assert.equal(lib.parsePushTokenRecord('{not json'), null);
  assert.equal(lib.parsePushTokenRecord('{"syncedAt":5}'), null, 'a record with no token is no record');
  // A bare token written by an earlier build still reads.
  assert.deepEqual(lib.parsePushTokenRecord('tok-abc'), { token: 'tok-abc', syncedAt: 0 });
  assert.deepEqual(lib.parsePushTokenRecord('{"token":"tok-abc","syncedAt":42}'), { token: 'tok-abc', syncedAt: 42 });
  assert.deepEqual(lib.parsePushTokenRecord('{"token":"tok-abc","syncedAt":"soon"}'), { token: 'tok-abc', syncedAt: 0 });
  const round = lib.parsePushTokenRecord(lib.serializePushTokenRecord({ token: 'tok-abc', syncedAt: 7 }));
  assert.deepEqual(round, { token: 'tok-abc', syncedAt: 7 });
});

test('a token re-registers when it rotates, and again after a day', () => {
  const day = lib.PUSH_TOKEN_RESYNC_MS;
  const now = 1_000_000_000;
  assert.equal(lib.shouldSyncPushToken(null, 'tok-a', now), true, 'never registered');
  assert.equal(lib.shouldSyncPushToken({ token: 'tok-a', syncedAt: now }, 'tok-b', now), true, 'rotated');
  assert.equal(lib.shouldSyncPushToken({ token: 'tok-a', syncedAt: now }, 'tok-a', now), false, 'fresh');
  // The API keeps five tokens per account and drops the oldest, so an
  // unchanged registration is re-sent once a day in case it was pruned.
  assert.equal(lib.shouldSyncPushToken({ token: 'tok-a', syncedAt: now - day + 1 }, 'tok-a', now), false);
  assert.equal(lib.shouldSyncPushToken({ token: 'tok-a', syncedAt: now - day }, 'tok-a', now), true);
  assert.equal(lib.shouldSyncPushToken({ token: 'tok-a', syncedAt: 0 }, '', now), false, 'no token, nothing to send');
  assert.equal(day, 24 * 60 * 60 * 1000);
});

test('a push can only ever open a Vybe path', () => {
  assert.equal(lib.PUSH_FALLBACK_LINK, '/notifications');
  assert.equal(lib.pushLinkOf(null), '/notifications');
  assert.equal(lib.pushLinkOf({}), '/notifications', 'the API sends no link today');
  assert.equal(lib.pushLinkOf({ link: '/p/abc' }), '/p/abc');
  assert.equal(lib.pushLinkOf({ url: '/messages/xyz' }), '/messages/xyz');
  for (const hostile of ['https://evil.example/p/1', '//evil.example', 'javascript:alert(1)', 'p/1', '']) {
    assert.equal(lib.pushLinkOf({ link: hostile }), '/notifications', hostile);
  }
});

test('the foreground payload reads whatever the SDK hands over', () => {
  assert.deepEqual(lib.foregroundPushOf(undefined), { title: '', body: '', link: '/notifications', data: {} });
  assert.deepEqual(
    lib.foregroundPushOf({ notification: { title: 'Alex liked your workout', body: 'Push Day A' }, data: { type: 'like', postId: 'p1' } }),
    { title: 'Alex liked your workout', body: 'Push Day A', link: '/notifications', data: { type: 'like', postId: 'p1' } },
  );
});

test('"granted" on the card means granted AND registered here', () => {
  // Turning push off revokes the token; no API can revoke the permission. A
  // card keyed on the permission alone would go on claiming "On for this
  // device" after somebody switched it off.
  assert.equal(device.pushCardState('granted', true), 'granted');
  assert.equal(device.pushCardState('granted', false), 'default');
  assert.equal(device.pushCardState('default', false), 'default');
  assert.equal(device.pushCardState('denied', false), 'denied');
  assert.equal(device.pushCardState('unsupported', false), 'unsupported');
  assert.equal(device.pushCardState('needs-install', false), 'needs-install');
});

/* ------------------------------------------------------------------ source contract */

test('the two push-token routes are called by their literal paths', () => {
  const source = read('src/lib/firebase.ts');
  assert.match(source, /api\.put\('\/users\/push-token', \{ token \}\)/);
  assert.match(source, /api\.delete\('\/users\/push-token', \{ data: \{ token: record\.token \} \}\)/);
  // Sign-out navigates on the next line, so its delete goes out as a
  // keepalive fetch carrying the bearer explicitly (see lib/api revokeSession).
  assert.match(source, /keepalive: true/);
  // Five call sites, every one of them a literal: enable and refresh PUT,
  // turn-off and the rotation cleanup DELETE, sign-out sends the beacon.
  assert.equal((source.match(/api\.put\('\/users\/push-token'/g) || []).length, 2);
  assert.equal((source.match(/api\.delete\('\/users\/push-token'/g) || []).length, 2);
  assert.match(source, /fetch\(`\$\{API_BASE[^`]*\/users\/push-token`/, 'the sign-out beacon');
  // The token the API accepts is capped at 4096 characters and an account
  // keeps five (vybe-backend/utils/pushTokens.js); nothing here may batch.
  assert.doesNotMatch(source, /tokens:/);
});

test('only firebase/app and firebase/messaging are imported, and only lazily', () => {
  const files = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) files.push(next);
    }
  };
  walk('src');

  const specifiers = new Set();
  for (const file of files) {
    for (const match of read(file).matchAll(/['"](firebase(?:\/[a-z-]+)*)['"]/g)) specifiers.add(match[1]);
  }
  assert.deepEqual([...specifiers].sort(), ['firebase/app', 'firebase/messaging']);

  // Both behind import(): the SDK must not land in the entry chunk for the
  // majority of visits that never turn push on.
  const source = read('src/lib/firebase.ts');
  assert.match(source, /import\('firebase\/app'\), import\('firebase\/messaging'\)/);
  assert.doesNotMatch(source, /^import .* from 'firebase/m);

  // Analytics is deliberately not wired up; the config carries no measurementId.
  assert.doesNotMatch(source, /getAnalytics|measurementId:/);
  assert.doesNotMatch(read('public/firebase-messaging-sw.js'), /getAnalytics|measurementId:|analytics-compat/);
});

test('the worker is imported into the generated one and matches the installed SDK', () => {
  const version = JSON.parse(read('package.json')).dependencies.firebase;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'firebase is pinned exactly, not by range');

  const vite = read('vite.config.ts');
  assert.match(vite, /importScripts: \['firebase-messaging-sw\.js'\]/);
  // Precaching it would only store a second copy of a file the worker
  // already carries.
  assert.match(vite, /globIgnores: \[[\s\S]*?'firebase-messaging-sw\.js',[\s\S]*?\]/);

  const sw = read('public/firebase-messaging-sw.js');
  for (const bundle of ['firebase-app-compat.js', 'firebase-messaging-compat.js']) {
    assert.ok(sw.includes(`https://www.gstatic.com/firebasejs/${version}/${bundle}`), `${bundle} must match firebase@${version}`);
  }

  // One config, two files: a drifted sender id or app id means the worker
  // registers against a different project than the page.
  const source = read('src/lib/firebase.ts');
  for (const key of ['messagingSenderId', 'appId', 'apiKey', 'projectId']) {
    const value = source.match(new RegExp(`${key}: '([^']+)'`))?.[1];
    assert.ok(value, `${key} missing from src/lib/firebase.ts`);
    assert.ok(sw.includes(`${key}: '${value}'`), `${key} differs between the page and the worker`);
  }

  // The SDK displays a notification-payload push itself and only then calls
  // onBackgroundMessage, so the handler must remove that copy or every push
  // arrives twice.
  assert.match(sw, /closeDuplicatesOf/);
  assert.match(sw, /icon: '\/icon-192\.png'/);
  assert.match(sw, /badge: '\/icon-192\.png'/);
  // Ours is registered before firebase.messaging() creates the SDK's, which
  // calls stopImmediatePropagation().
  assert.ok(
    sw.indexOf("self.addEventListener('notificationclick'") < sw.indexOf('firebase.messaging().onBackgroundMessage'),
    'the click handler must be registered before the SDK adds its own',
  );
});

test('the permission is asked for on the card, never on a page load', () => {
  // A prompt before anybody has decided is the fastest route to a permanent
  // denial, which the page cannot undo.
  for (const file of ['src/components/WebPush.tsx', 'src/App.tsx', 'src/pages/Register.tsx']) {
    assert.doesNotMatch(read(file), /requestPermission/, file);
  }
  assert.match(read('src/lib/firebase.ts'), /Notification\.requestPermission\(\)/);
  // refreshPushToken is the only thing app start runs, and it returns early
  // unless this browser already granted and already registered.
  assert.match(read('src/components/WebPush.tsx'), /refreshPushToken\(\)/);

  // Sign-out takes this browser off the account.
  assert.match(read('src/lib/auth.ts'), /forgetPushTokenOnSignOut\(tokenStore\.get\(\)\)/);
  // The registration the app already has is the one getToken must use.
  assert.match(read('src/App.tsx'), /onRegisteredSW\(_swScriptUrl, registration\) \{\s*setPushRegistration\(registration\);/);
});
