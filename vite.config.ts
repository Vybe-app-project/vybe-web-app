import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Service worker strategy (Workbox generateSW):
 * - the app shell (html/js/css/fonts/icons) is precached and served offline;
 * - API responses and user media are network-only: neither may outlive
 *   authentication, an audience change, or a revoked share in Cache Storage;
 * - navigations fall back to index.html so deep links work when installed;
 * `public/offline.html` is a plain page for links and for the day index.html
 * itself cannot be served; generateSW has one navigateFallback, index.html is
 * always precached, so precaching offline.html too only cost 7 KB per install
 * and it was never routed to. It, its script and the install-sheet screenshots
 * are excluded from the precache.
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
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//, /\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
        importScripts: ['/sw-private-cache-cleanup.js'],
        clientsClaim: true,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            options: { fetchOptions: { cache: 'no-store' } },
          },
          {
            urlPattern: ({ url, request }) =>
              request.destination === 'image' ||
              request.destination === 'video' ||
              url.pathname.startsWith('/uploads/') ||
              url.pathname.startsWith('/media/'),
            handler: 'NetworkOnly',
            options: { fetchOptions: { cache: 'no-store' } },
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
