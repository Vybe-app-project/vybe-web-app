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
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
