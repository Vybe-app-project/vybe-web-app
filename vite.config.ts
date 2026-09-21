import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

/**
 * Service worker strategy (Workbox generateSW):
 * - the app shell (html/js/css/fonts/icons) is precached and served offline;
 * - `/api` GETs are network-first with a 3 s timeout, falling back to the
 *   last good response so a cold start on a bad connection still paints;
 * - media (uploads, images, video) is cache-first for 30 days;
 * - navigations fall back to index.html so deep links work when installed.
 * `public/offline.html` is a plain page for links and for the day index.html
 * itself cannot be served; generateSW has one navigateFallback, index.html is
 * always precached, so precaching offline.html too only cost 7 KB per install
 * and it was never routed to. It, its script and the install-sheet screenshots
 * are excluded from the precache.
 * The manifest is the hand-authored `public/manifest.webmanifest`.
 */
/**
 * The web version the X-Vybe-Client header carries (src/lib/clientHeader.ts):
 * MAJOR from package.json, then the UTC build date and time as MINOR.PATCH,
 * so 1.20260919.1432 is a build at 14:32 UTC on 19 September 2026 (the time
 * has no leading zero: 09:32 is .932, as semver requires). Every build is a
 * comparable semver above every earlier build, so the API's
 * CLIENT_MIN_VERSION_WEB can name "every build before this deploy"; a static
 * package version would have gated nothing or everything. The release passes
 * the value in (VITE_WEB_VERSION build arg, computed by
 * scripts/deploy-web-remote.sh with this same rule so its floor check
 * compares the exact version being built); a local build derives it from its
 * own clock. package.json's version is not bumped per release.
 */
const BUILD_NOW = new Date();
const WEB_MAJOR = String(pkg.version).split('.')[0] || '1';
const SEMVER_CORE = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
const clockVersion = (now: Date, major: string): string => {
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replace(/-/g, '');
  const time = Number(iso.slice(11, 16).replace(':', ''));
  return `${major}.${date}.${time}`;
};
const versionFromRelease = (process.env.VITE_WEB_VERSION ?? '').trim();
const WEB_VERSION = SEMVER_CORE.test(versionFromRelease) ? versionFromRelease : clockVersion(BUILD_NOW, WEB_MAJOR);

export default defineConfig({
  // Build identity for the X-Vybe-Client header and Settings > About
  // (src/lib/clientHeader.ts): the version above and the build clock. The
  // deployed commit arrives separately as VITE_WEB_BUILD (Dockerfile.release
  // build arg); the release tarball has no .git and a build config must not
  // run other programs (scripts/scan-injected-code.mjs).
  define: {
    'import.meta.env.VITE_WEB_VERSION': JSON.stringify(WEB_VERSION),
    'import.meta.env.VITE_WEB_BUILT_AT': JSON.stringify(BUILD_NOW.toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      includeAssets: [
        'favicon.svg',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'icon-apple-touch-180.png',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The legal pages are fetched fresh so an updated policy is never served
        // stale, and their Archivo subset (a copy of the app font, used only by
        // those pages) would add 90 KB to every install's precache for nothing.
        globIgnores: [
          'privacy-policy.html',
          'terms-and-conditions.html',
          'account-deletion.html',
          'fonts/**',
          'offline.html',
          'offline.js',
          'screenshots/**',
          // Pulled into sw.js by importScripts below, so the browser already
          // caches it as part of the worker script; precaching it as well
          // would only add a second copy that nothing ever reads.
          'firebase-messaging-sw.js',
        ],
        // The FCM half of the worker (public/firebase-messaging-sw.js): a
        // background-push handler and a notification-click handler, pulled
        // into the generated worker rather than registered as a second one.
        // Two workers cannot both control the page, and Firebase's default
        // /firebase-messaging-sw.js registration would fight the app shell's
        // for scope; one worker with both jobs is the only arrangement that
        // works. `getToken` is passed this same registration.
        importScripts: ['firebase-messaging-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//, /\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'vybe-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.destination === 'image' ||
              request.destination === 'video' ||
              url.pathname.startsWith('/uploads/') ||
              url.pathname.startsWith('/media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'vybe-media',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: '127.0.0.1', port: 5180 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // Module preload hints stay on; only the polyfill is dropped (every target
    // browser has native <link rel="modulepreload">). Without the hints a
    // route's dependency chunks loaded one depth per round trip, which is what
    // made the first visit to a hub slow. The worker only re-fetches a hinted
    // chunk when a NEW worker takes the page over mid-load (clientsClaim; Chrome
    // logs "preload … not used because of a cross-world service worker
    // resource mismatch") — once per deploy per client, not per navigation: a
    // page that already has a controlling worker requests hint and module
    // through the same worker, and a first visit has no worker at all.
    modulePreload: { polyfill: false },
  },
});
