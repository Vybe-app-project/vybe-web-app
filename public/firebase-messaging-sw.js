/**
 * The FCM half of the app's service worker.
 *
 * Workbox `generateSW` owns `dist/sw.js` (precache, runtime caching,
 * navigation fallback), so this file is not a second worker: it is pulled
 * into that one by `workbox.importScripts` in vite.config.ts and runs in the
 * same global scope. It stays plain ES5-ish JavaScript in `public/` because
 * importScripts loads it verbatim — nothing here is bundled or transpiled,
 * so it must not use bare module specifiers or TypeScript.
 *
 * The compat builds are used for the same reason: `importScripts` needs a
 * classic script, and the modular SDK ships as ESM only. Both are pinned to
 * the version in package.json; the two must move together.
 *
 * Two behaviours of @firebase/messaging's own worker shape this file.
 *
 * 1. Its `push` listener displays the notification ITSELF whenever the
 *    payload carries a `notification` block, and only THEN calls
 *    `onBackgroundMessage`. The API always sends `notification { title, body }`
 *    (vybe-backend/utils/notifications.js fcmMessageFor), so a handler that
 *    simply calls `showNotification` posts a second, duplicate alert. The
 *    SDK's version has no icon, no badge and no tag, because the send carries
 *    no `webpush` block — so this file closes that one and posts the Vybe
 *    one in its place. `closeDuplicatesOf` matches on title and body and only
 *    ever touches notifications that are not already ours, so nothing else in
 *    the tray is disturbed.
 * 2. Its `notificationclick` listener calls `stopImmediatePropagation()`.
 *    Listeners run in registration order, so ours is added at the top of this
 *    file, before `firebase.messaging()` creates the SDK's.
 */

/* global importScripts, firebase, clients */

/**
 * Failing to load the SDK must not fail the worker. This file is imported
 * INTO the app shell's worker, so a throw here aborts that worker's
 * installation and the PWA loses precaching, offline and the update prompt
 * along with push. The one thing that realistically throws is the site's
 * Content-Security-Policy: `script-src 'self'` (deploy/caddy/vybe.caddy)
 * blocks these two imports until https://www.gstatic.com is added to it.
 * Caught, background push is the only thing missing.
 */
var vybeFcmReady = false;
try {
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
  vybeFcmReady = true;
} catch (error) {
  console.warn('Vybe: FCM background handling is unavailable in this worker', error);
}

var VYBE_FALLBACK_LINK = '/notifications';
/** Marks a notification this file posted, so the dedupe never closes its own. */
var VYBE_MARK = 'vybePush';

/**
 * Where a click lands. The API's push data allowlist
 * (utils/notifications.js PUSH_DATA_FIELDS) carries no link today, so this
 * reads one if a send ever adds `webpush.fcm_options.link` and otherwise
 * opens the inbox, whose rows already deep-link correctly. Same-origin paths
 * only: a notification must never be able to navigate the app off Vybe.
 * Mirrors `pushLinkOf` in src/lib/firebase.ts (pinned by tests/web-push).
 */
function vybeLinkOf(data) {
  var source = data && typeof data === 'object' ? data : {};
  var candidate = typeof source.link === 'string' && source.link ? source.link : '';
  if (!candidate && typeof source.url === 'string') candidate = source.url;
  if (candidate.indexOf('/') !== 0 || candidate.indexOf('//') === 0) return VYBE_FALLBACK_LINK;
  return candidate;
}

self.addEventListener('notificationclick', function (event) {
  var notification = event.notification;
  if (!notification) return;
  // An action button is the SDK's business, not ours.
  if (event.action) return;
  notification.close();
  var link = vybeLinkOf(notification.data);
  event.waitUntil(
    (function () {
      var target = new URL(link, self.location.origin);
      return clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (windows) {
          for (var i = 0; i < windows.length; i += 1) {
            var client = windows[i];
            if (new URL(client.url).origin !== target.origin) continue;
            // Focus the tab that is already open, then send it to the target;
            // opening a second Vybe window for every push is the thing people
            // complain about.
            return Promise.resolve(client.focus()).then(function (focused) {
              var win = focused || client;
              if (win && typeof win.navigate === 'function') {
                return win.navigate(target.href).catch(function () {
                  return undefined;
                });
              }
              return undefined;
            });
          }
          return clients.openWindow(target.href);
        })
        .catch(function () {
          return undefined;
        });
    })(),
  );
});

if (vybeFcmReady) {
  firebase.initializeApp({
    apiKey: 'AIzaSyDcrk_Q8hjzUuM9PzBHLH4FC8bezZQCA-Q',
    authDomain: 'vybe-6ac92.firebaseapp.com',
    projectId: 'vybe-6ac92',
    storageBucket: 'vybe-6ac92.firebasestorage.app',
    messagingSenderId: '127745278900',
    appId: '1:127745278900:web:622fa8921b4e876836e8e1',
  });
}

/** Close the SDK's own un-iconed copy of this push before posting ours. */
function closeDuplicatesOf(title, body) {
  return self.registration
    .getNotifications()
    .then(function (shown) {
      for (var i = 0; i < shown.length; i += 1) {
        var other = shown[i];
        var isOurs = other.data && other.data[VYBE_MARK];
        if (!isOurs && other.title === title && (other.body || '') === body) other.close();
      }
    })
    .catch(function () {
      return undefined;
    });
}

if (vybeFcmReady) {
  firebase.messaging().onBackgroundMessage(function (payload) {
    var notification = (payload && payload.notification) || {};
    var data = (payload && payload.data) || {};
    var title = notification.title || 'Vybe';
    var body = notification.body || '';
    var options = {
      body: body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: Object.assign({}, data, { link: vybeLinkOf(data), vybePush: '1' }),
    };
    // The API's collapse key is per recipient, per type, per object: a second
    // like on the same post replaces the first in the tray instead of stacking.
    if (data.collapseKey) options.tag = data.collapseKey;
    return closeDuplicatesOf(title, body).then(function () {
      return self.registration.showNotification(title, options);
    });
  });
}
