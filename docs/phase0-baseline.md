# Phase 0 web baseline (2026-09-18)

Starting point for the Vybe web roadmap: what the production bundle weighs,
how the public routes score, and where the client gates on server
capabilities today. Re-run the commands below and diff before/after any
performance or capability work.

Source commit: `c39e1bb` (main) · Node `v20.20.2` ·
`export PATH=~/.local/share/fnm/node-versions/v20.20.2/installation/bin:$PATH`

## 1. Production bundle size

From a clean `npm ci && npm run build` in the phase-0 worktree
(`npm run scan` first, per the supply-chain rule).

- `dist` total: **2340 KiB** (2.29 MiB), 83 files under `dist/assets`
- `dist/assets` total: 2048 KiB
- PWA precache: 103 entries, 1960.98 KiB (Workbox generateSW)

Largest chunks (raw bytes via `wc -c`, gzip via `gzip -c | wc -c`):

| Chunk | Raw | Gzip |
|---|---|---|
| `assets/BarChart-BVQMyrl3.js` (recharts vendor) | 358,935 | 102,613 |
| `assets/index-Ct1OW3MO.js` (app shell) | 271,940 | 82,463 |
| `assets/ui-9lIppGAs.js` (shared component library) | 172,191 | 56,201 |
| `assets/archivo-latin-wdth-normal-DY7AcnAa.woff2` (font) | 90,104 | — |
| `assets/archivo-latin-ext-wdth-normal-7khWdh9v.woff2` (font) | 86,240 | — |
| `assets/Livestreams-CPrpS3OV.js` (live page + room) | 70,043 | 20,099 |
| `assets/index-xayLjOuB.css` | 63,227 | 13,802 |
| `assets/AdminDashboard-CDDifPjb.js` | 41,727 | 12,551 |
| `assets/Messages-Dyl9sWa5.js` | 40,590 | 12,914 |

Reproduce: `du -sk dist && ls -laS dist/assets | head`.

## 2. Lighthouse (3 public routes)

Headless Chromium via the installed Google Chrome 153.0.8010.48,
Lighthouse 12.8.2 (`npx --yes lighthouse`), `--preset=desktop`,
against `vite preview --port 5199` serving the production `dist` above:

```sh
npx lighthouse http://127.0.0.1:5199/<route> \
  --chrome-path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --output=json --only-categories=performance,accessibility,best-practices,seo \
  --preset=desktop --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"
```

| Route | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| `/login` | 100 | 100 | 100 | 100 | 0.5 s | 0.5 s | 0 ms | 0 | 0.5 s |
| `/support` | 100 | 100 | 100 | 100 | 0.5 s | 0.5 s | 0 ms | 0 | 0.5 s |
| `/admin/login` | 100 | 100 | 100 | 63 | 0.5 s | 0.5 s | 0 ms | 0 | 0.5 s |

Notes:

- `/admin/login` SEO 63 is the single `is-crawlable` audit: the page is
  blocked from indexing, which is correct for a staff sign-in surface.
- Authenticated routes were deliberately excluded: they bounce to `/login`
  without a session, so a signed-out Lighthouse run cannot measure them.
  A signed-in pass (storage state + `/`, `/live`, `/health`) is open work.

## 3. Capability-gate consumers

Every client read of `GET /api/capabilities` (pinned in
`contracts/backend-routes.json:17-22`) and of the per-stream capability
report. Line numbers are at `c39e1bb`.

### `GET /api/capabilities` readers

- `src/pages/Livestreams.tsx:37-41` — `ServerCapabilities`
  (`livestreamRelay?`, `turnRelay?`).
- `src/pages/Livestreams.tsx:47-56` — local `useCapabilities()`
  (`queryKey: ['capabilities']`, `api.get('/capabilities')`,
  `staleTime: 5 * 60 * 1000`).
- `src/pages/Livestreams.tsx:444-445` — `enabled =
  capabilities.data?.livestreamRelay === true`.
- `src/pages/Livestreams.tsx:501-532` — loading skeleton, error state with
  retry, then the disabled branch.
- `src/pages/Livestreams.tsx:402-431` — `LiveUnavailable`: the honest
  disabled pattern (`Live video is not enabled here` + "It is a server
  setting, not something on your device", primary/secondary fallback
  actions). The shared `CapabilityDisabled` component copies this shape.
- `src/pages/admin/AdminSystem.tsx:55-99` — `CAPABILITY_GROUPS` (Sign-in,
  Messaging, Media storage, Live, Data providers).
- `src/pages/admin/AdminSystem.tsx:170-174` — admin read
  (`queryKey: ['system', 'capabilities']`, `adminApi.get('/capabilities')`).
- `src/pages/admin/AdminSystem.tsx:219-236,334-422` — capability dashboard
  (on/total summary, grouped On/Off list, unknown keys under "Other").

### Per-stream capability report (separate shape, same theme)

- `src/lib/livestream.ts:36-45` — `LivestreamCapabilities`
  (`enabled`, `maxViewers`, `maxBroadcastSeconds`, `reason`, ...).
- `src/pages/LiveRoom.tsx:115,124` — stream-detail fetch carries
  `capabilities`; `LiveRoom.tsx:764-765,1328-1329` — the room refuses to
  start and shows a warning callout (`Live video is switched off on this
  server`) when `capabilities.enabled` is false.

### Not yet gated (Phase 0 additions)

The API's `providerCapabilities()` (`vybe-backend`,
`services/providerCapabilities.js:15-31`) currently reports 16 keys and
none of `wearables`, `smartInsights`, or `aiCoach`. The shared client
hook (`src/lib/capabilities.ts`) therefore defaults all three to `false`
and only an explicit server `true` enables them; the "Other" group in
`AdminSystem.tsx:399-420` will surface them automatically once the API
starts reporting them.
