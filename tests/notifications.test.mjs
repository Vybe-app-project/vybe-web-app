import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const copy = await import('../src/lib/notificationCopy.ts');
const inbox = await import('../src/lib/notificationInbox.ts');

/**
 * The API enum as of vybe-backend/models/Notification.js. When a backend
 * checkout is beside this one (or VYBE_BACKEND_DIR points at one) the live
 * enum is read instead, so a new type on the server fails here until the
 * web has copy for it.
 */
function backendEnum() {
  // VYBE_BACKEND_DIR first: in a worktree layout the sibling checkout is the
  // main branch, not the one this change pairs with.
  const candidates = [
    process.env.VYBE_BACKEND_DIR,
    path.join(root, '..', 'vybe-backend'),
  ].filter(Boolean);
  for (const dir of candidates) {
    const model = path.join(dir, 'models', 'Notification.js');
    if (!fs.existsSync(model)) continue;
    const source = fs.readFileSync(model, 'utf8');
    const block = source.match(/type:\s*\{\s*type:\s*String,\s*enum:\s*\[([\s\S]*?)\]/);
    if (!block) continue;
    return { source: model, values: [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) };
  }
  return null;
}

test('every notification type the API can emit has copy and a glyph', () => {
  const live = backendEnum();
  const types = live ? live.values : [...copy.NOTIFICATION_TYPES];
  assert.ok(types.length >= 29, `expected the full enum, found ${types.length}`);
  if (live) {
    assert.deepEqual([...copy.NOTIFICATION_TYPES], live.values, `NOTIFICATION_TYPES drifted from ${live.source}`);
  }
  for (const type of types) {
    const entry = copy.notificationCopy(type);
    assert.ok(entry.text && entry.text !== 'sent you an update', `${type} falls back to the generic sentence`);
    assert.ok(entry.glyph, `${type} has no glyph`);
    assert.ok(entry.family, `${type} has no badge family`);
  }
});

test('the copy follows the mobile inbox for the shared types and the keys the API never emits are gone', () => {
  const expected = {
    follow: 'started following you',
    follow_request: 'requested to follow you',
    follow_request_accepted: 'accepted your follow request',
    friend_request: 'sent you a friend request',
    friend_request_accepted: 'accepted your friend request',
    post_like: 'liked your post',
    post_comment: 'commented on your post',
    post_comment_like: 'liked your comment',
    new_post: 'shared a new post',
    new_meal: 'shared a new meal',
    new_workout: 'shared a new workout',
    workout_like: 'liked your workout',
    meal_plan_copied: 'copied your meal plan',
    gym_member_joined: 'joined your gym community',
    message: 'sent you a message',
  };
  for (const [type, text] of Object.entries(expected)) assert.equal(copy.notificationCopy(type).text, text);
  // Keys the previous table used but the API never sends must not be in the source.
  const page = read('src/pages/Notifications.tsx');
  for (const stale of ['friend_accept', 'follow_accept', 'comment_like', 'comment_reply', 'workout_post', 'mention']) {
    assert.doesNotMatch(page, new RegExp(`['"]${stale}['"]`), `Notifications.tsx still keys on ${stale}`);
  }
  assert.doesNotMatch(page, /TYPE_TEXT|TYPE_GLYPH/);
  // Unknown types degrade to a bell, never to nothing.
  assert.deepEqual(copy.notificationCopy('something_new'), { text: 'sent you an update', glyph: 'bell', family: 'system' });
});

test('security, system and account rows have no actor and route to Settings, not the profile', () => {
  for (const type of ['security', 'system', 'account']) {
    assert.ok(copy.isSystemNotification(type), `${type} must be a system row`);
    assert.equal(copy.notificationCopy(type).family, 'system');
  }
  assert.ok(!copy.isSystemNotification('post_like'));
  assert.equal(copy.notificationCopy('security').glyph, 'shield');

  const self = { _id: 'u1' };
  const passwordChanged = { type: 'security', message: 'Your password was changed.', sender: self, data: { event: 'password_changed' } };
  assert.equal(copy.notificationText(passwordChanged), 'Your password was changed.');
  assert.equal(copy.notificationHref(passwordChanged), '/settings#password');
  assert.equal(copy.notificationHref({ type: 'account', sender: self }), '/settings#account');
  assert.equal(copy.notificationHref({ type: 'system', sender: self }), null);
  // A server-supplied same-origin path wins; anything else is ignored.
  assert.equal(copy.notificationHref({ type: 'security', sender: self, data: { href: '/settings#sessions' } }), '/settings#sessions');
  assert.equal(copy.notificationHref({ type: 'security', sender: self, data: { href: 'https://evil.example/x' } }), '/settings#password');
  assert.equal(copy.notificationHref({ type: 'security', sender: self, data: { href: '//evil.example' } }), '/settings#password');
  // "Your Vybe data is ready" (services/dataExport.js) carries no href; it opens the Download-your-data card.
  assert.equal(copy.notificationHref({ type: 'security', sender: self, data: { type: 'security', notificationType: 'data_export_ready', exportId: 'x', expiresAt: '2026-10-01' } }), '/settings#data');
  assert.equal(copy.notificationHref({ type: 'security', sender: self, data: { notificationType: 'data_export_ready', href: '/settings#sessions' } }), '/settings#sessions', 'a server href still wins');

  // The row must not print the sender's name for these types.
  const page = read('src/pages/Notifications.tsx');
  assert.match(page, /\{!system && n\.sender \? <span className="font-semibold text-text-1">\{displayName\(n\.sender\)\} <\/span> : null\}/);
});

test('social rows resolve to the thing that happened', () => {
  const sender = { _id: 'abc' };
  assert.equal(copy.notificationHref({ type: 'post_comment', sender, data: { postId: 'p1', commentId: 'c1' } }), '/p/p1');
  assert.equal(copy.notificationHref({ type: 'post_like', sender, data: { postId: { _id: 'p2' } } }), '/p/p2');
  assert.equal(copy.notificationHref({ type: 'friend_request', sender }), '/friends');
  assert.equal(copy.notificationHref({ type: 'follow_request', sender }), '/friends');
  assert.equal(copy.notificationHref({ type: 'friend_request_accepted', sender }), '/u/abc');
  assert.equal(copy.notificationHref({ type: 'follow', sender: null, data: { senderId: 'zzz' } }), '/u/zzz');
  assert.equal(copy.notificationHref({ type: 'message', sender, data: { chatRoomId: 'r1' } }), '/messages/r1');
  assert.equal(copy.notificationHref({ type: 'new_group_chat', sender }), '/messages');
  assert.equal(copy.notificationHref({ type: 'workout_like', sender, data: { workoutId: 'w1' } }), '/workouts/w1');
  assert.equal(copy.notificationHref({ type: 'meal_plan_like', sender }), '/meals/plans');
  assert.equal(copy.notificationHref({ type: 'gym_member_joined', sender }), '/communities');
  assert.equal(copy.notificationText({ type: 'post_like' }), 'liked your post');
  assert.equal(copy.notificationText({ type: 'post_like', message: '  Server copy wins ' }), 'Server copy wins');
});

test('a pushed notification is prepended once and the badge moves before the server is asked', () => {
  const pages = {
    pageParams: [1, 2],
    pages: [
      { notifications: [{ _id: 'a', createdAt: '2026-09-18T10:00:00Z', read: false }], total: 21, page: 1, hasNextPage: true },
      { notifications: [{ _id: 'b', createdAt: '2026-09-17T10:00:00Z', read: true }], total: 21, page: 2, hasNextPage: false },
    ],
  };
  const incoming = { _id: 'n', type: 'post_comment', createdAt: '2026-09-18T11:00:00Z', read: false };
  const next = inbox.prependNotification(pages, incoming);
  assert.deepEqual(next.pages[0].notifications.map((n) => n._id), ['n', 'a']);
  assert.equal(next.pages[0].total, 22);
  assert.deepEqual(next.pages[1], pages.pages[1], 'later pages are untouched');
  assert.notEqual(next, pages, 'the cache object is replaced, not mutated');
  assert.deepEqual(pages.pages[0].notifications.map((n) => n._id), ['a']);

  // The poll and the socket can race: the same id arrives twice, shows once.
  const again = inbox.prependNotification(next, { ...incoming, read: true });
  assert.deepEqual(again.pages[0].notifications.map((n) => n._id), ['n', 'a']);
  assert.equal(again.pages[0].notifications[0].read, true);
  assert.equal(again.pages[0].total, 22);

  assert.equal(inbox.prependNotification(undefined, incoming), undefined, 'no cache, nothing to patch');

  assert.deepEqual(inbox.bumpUnreadCount({ count: 3, more: false }, incoming), { count: 4, more: false });
  assert.deepEqual(inbox.bumpUnreadCount(undefined, incoming), { count: 1, more: false });
  assert.deepEqual(inbox.bumpUnreadCount({ count: 3, more: false }, { ...incoming, read: true }), { count: 3, more: false });
});

test('the shell subscribes to the socket for the whole session and reads the exact unread count', () => {
  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /useLiveNotifications\(!!user\)/, 'Layout must open the live subscription once the user is bootstrapped');
  assert.match(layout, /api\.get\('\/notifications\/unread-count'\)/);
  assert.doesNotMatch(layout, /API has no unread-count endpoint/);
  const live = read('src/lib/notificationsLive.ts');
  assert.match(live, /socket\.on\('notification', onNotification\)/);
  assert.match(live, /socket\.off\('notification', onNotification\)/, 'listeners are removed on unmount');
  assert.match(live, /prependNotification\(old, incoming\)/);
  // A page opened while the API was down must refill once the socket connects.
  assert.match(live, /predicate: \(query\) => query\.state\.status === 'error'/);
  assert.match(layout, /if \(sessionStale\) return;\s*void qc\.invalidateQueries\(\{ predicate: \(query\) => query\.state\.status === 'error' \}\);/s);
  assert.match(live, /bumpUnreadCount\(old, incoming\)/);
  // The 60 s poll stays as the fallback for a socket that never connects.
  assert.match(layout, /refetchInterval: 60_000/);
  assert.match(read('src/pages/Notifications.tsx'), /refetchInterval: 60_000/);
});

test('the manifest is well-formed, its screenshots exist at the declared size, and none of it is precached', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.ok(Array.isArray(manifest.screenshots) && manifest.screenshots.length >= 3, 'at least two phone and one desktop screenshot');
  const byFactor = { narrow: 0, wide: 0 };
  for (const shot of manifest.screenshots) {
    assert.match(shot.src, /^\/screenshots\/[a-z0-9-]+\.png$/);
    assert.equal(shot.type, 'image/png');
    assert.ok(shot.label && shot.label.length > 10, `${shot.src} needs a label`);
    byFactor[shot.form_factor] += 1;
    const file = path.join(root, 'public', shot.src);
    const png = fs.readFileSync(file);
    assert.equal(png.readUInt32BE(0), 0x89504e47, `${shot.src} is not a PNG`);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.equal(`${width}x${height}`, shot.sizes, `${shot.src} is ${width}x${height}, manifest says ${shot.sizes}`);
    assert.ok(png.length < 400 * 1024, `${shot.src} is ${png.length} bytes; keep install-sheet images small`);
  }
  assert.ok(byFactor.narrow >= 2 && byFactor.wide >= 1);
  // Phone screenshots must share an aspect ratio or Chrome drops the set.
  const narrow = manifest.screenshots.filter((s) => s.form_factor === 'narrow').map((s) => s.sizes);
  assert.equal(new Set(narrow).size, 1, `narrow screenshots differ in size: ${narrow.join(', ')}`);

  const vite = read('vite.config.ts');
  assert.match(vite, /'screenshots\/\*\*'/, 'screenshots must not be precached on every install');
  // Caddy labels the manifest; Go's mime table would send text/plain. Checked
  // against the paired backend checkout when VYBE_BACKEND_DIR names one.
  const backendDir = process.env.VYBE_BACKEND_DIR;
  const caddy = backendDir && path.join(backendDir, 'deploy/caddy/vybe.caddy');
  if (caddy && fs.existsSync(caddy)) {
    assert.match(fs.readFileSync(caddy, 'utf8'), /header @manifest Content-Type "application\/manifest\+json"/);
  }
});

test('offline.html runs under script-src self and is not precached', () => {
  const page = read('public/offline.html');
  assert.doesNotMatch(page, /onclick=/i, 'inline handlers are blocked by the CSP');
  assert.doesNotMatch(page, /<script(?![^>]*\ssrc=)[^>]*>/i, 'inline <script> is blocked by the CSP');
  assert.match(page, /<script src="\/offline\.js"><\/script>/);
  assert.match(page, /id="retry"/);
  const script = read('public/offline.js');
  assert.match(script, /getElementById\('retry'\)/);
  assert.match(script, /addEventListener\('online'/);
  const vite = read('vite.config.ts');
  assert.doesNotMatch(vite, /includeAssets:\s*\[[^\]]*'offline\.html'/s, 'offline.html must not be in includeAssets');
  assert.match(vite, /'offline\.html',\s*'offline\.js'/s);
});
