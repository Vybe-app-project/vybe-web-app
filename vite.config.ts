import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Service worker strategy (Workbox generateSW):
 * - the app shell (html/js/css/fonts/icons) is precached and served offline;
 * - `/api` GETs are network-first with a 3 s timeout, falling back to the
 *   last good response so a cold start on a bad connection still paints;
 * - media (uploads, images, video) is cache-first for 30 days;
 * - navigations fall back to index.html so deep links work when installed;
 * - `public/offline.html` is precached for a branded fallback.
 * The manifest is the hand-authored `public/manifest.webmanifest`.
 */
export default defineConfig({
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
        'offline.html',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The legal pages are fetched fresh so an updated policy is never served
        // stale, and their Archivo subset (a copy of the app font, used only by
        // those pages) would add 90 KB to every install's precache for nothing.
        globIgnores: ['privacy-policy.html', 'terms-and-conditions.html', 'account-deletion.html', 'fonts/**'],
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
    // No <link rel="modulepreload"> hints. The service worker precaches every
    // chunk and claims the page mid-load (clientsClaim), so Chrome fetched the
    // hinted chunk once outside the worker and once through it and logged
    // "preload … not used because of a cross-world service worker resource
    // mismatch" on every navigation. Module graphs still load in parallel per
    // depth; the SW serves repeat visits from cache regardless of hints.
    modulePreload: false,
  },
});
