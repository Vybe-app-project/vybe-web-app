/**
 * Regression contracts for the responsive/visual sweep of 2026-09-18
 * (qa8/responsive-visual). Each block names the defect it pins down.
 *
 * Pure logic is imported straight from src/lib through the TypeScript loader;
 * component and stylesheet behaviour is asserted against the source, the same
 * way tests/source-contract.test.mjs does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const css = read('src/styles.css');
const adminCss = read('src/styles.admin.css');
const ui = read('src/components/ui.tsx');
const layout = read('src/components/Layout.tsx');
const app = read('src/App.tsx');

/* ------------------------------------------------------------ challenge time-left chip */

test('challenge time-left never counts months past a year and never says "0 days"', async () => {
  const { challengeTimeLeft } = await import('../src/lib/challengeTime.ts');
  const now = new Date('2026-09-18T12:00:00Z');
  const at = (iso) => challengeTimeLeft({ endDate: iso }, now);
  assert.equal(at('2036-11-30T00:00:00Z').label, 'Ends Nov 2036'); // was "122 months left"
  assert.equal(at('2027-02-18T12:00:00Z').label, '5 months left');
  assert.equal(at('2026-10-30T12:00:00Z').label, '6 weeks left');
  assert.equal(at('2026-09-25T12:00:00Z').label, '7 days left');
  assert.deepEqual(at('2026-09-20T12:00:00Z'), { label: '2 days left', tone: 'accent', urgent: true });
  assert.deepEqual(at('2026-09-18T20:00:00Z'), { label: 'Ends today', tone: 'accent', urgent: true });
  assert.equal(at('2026-09-01T00:00:00Z').label, 'Ended');
  assert.equal(challengeTimeLeft({ isActive: false, endDate: '2036-01-01' }, now).label, 'Closed');
  assert.equal(challengeTimeLeft({ endDate: 'not-a-date' }, now).label, 'Open');
  assert.doesNotMatch(read('src/pages/Challenges.tsx'), /formatDistanceToNowStrict/);
});

/* ------------------------------------------------------------ recent searches */

test('recent searches are de-duplicated case-insensitively and trivial queries are dropped', async () => {
  const { dedupeRecentSearches, isTrivialSearchQuery } = await import('../src/lib/searchHistory.ts');
  const list = [
    { _id: '1', query: 'Vybe Test User', type: 'all' },
    { _id: '2', query: '#', type: 'all' },
    { _id: '3', query: 'vybe test user', type: 'users' },
    { _id: '4', query: '#vybe', type: 'posts' },
    { _id: '5', query: 'Vybe', type: 'all' },
    { _id: '6', query: '@', type: 'users' },
    { _id: '7', query: 'a', type: 'all' },
  ];
  assert.deepEqual(dedupeRecentSearches(list).map((r) => r._id), ['1', '4']);
  assert.equal(isTrivialSearchQuery('#'), true);
  assert.equal(isTrivialSearchQuery(' @ '), true);
  assert.equal(isTrivialSearchQuery('ab'), false);
  assert.match(read('src/pages/Search.tsx'), /dedupeRecentSearches\(/);
});

/* ------------------------------------------------------------ lazy-route feedback */

test('navigation store records the tapped destination and preloads run once per path', async () => {
  const nav = await import('../src/lib/navigation.ts');
  nav.resetPreloads();
  let calls = 0;
  nav.registerPreload('/meals', () => {
    calls += 1;
    return Promise.resolve();
  });
  nav.preload('/meals?log=1');
  nav.preload('/meals');
  assert.equal(calls, 1, 'a chunk is fetched once however many times intent is shown');
  assert.equal(nav.isPreloaded('/meals#x'), true);
  assert.equal(nav.pathOf('/health/water?log=1#a'), '/health/water');
  assert.equal(nav.pathOf(''), '/');

  const store = nav.usePendingNavigation;
  store.getState().start('/meals');
  assert.equal(store.getState().pendingPath, '/meals');
  assert.equal(nav.selectNavigating(store.getState()), true);
  store.getState().finish();
  assert.equal(store.getState().pendingPath, null);
  assert.equal(nav.selectNavigating(store.getState()), false);
  store.getState().setChunkLoading(true);
  assert.equal(nav.selectNavigating(store.getState()), true, 'a downloading chunk keeps the bar up after the location commits');
  store.getState().setChunkLoading(false);
});

test('the shell shows progress and a keyed skeleton while a route chunk downloads, and warms chunks on intent', () => {
  // Every routed page that a nav control can reach registers a preload, and every registered path is routed.
  const registered = [...app.matchAll(/page\('([^']+)', \(\) => import\('\.\/pages\/(\w+)'\)\)/g)].map((m) => m[1]);
  assert.ok(registered.length >= 20, `expected the nav destinations to register preloads, found ${registered.length}`);
  const routed = new Set(['/', ...[...app.matchAll(/<Route path="([^"*:]+)"/g)].map((m) => (m[1].startsWith('/') ? m[1] : `/${m[1]}`))]);
  for (const p of registered) assert.ok(routed.has(p), `${p} registers a preload but is not routed`);
  for (const p of ['/', '/meals', '/gyms', '/workouts', '/profile']) assert.ok(registered.includes(p), `tab root ${p} must preload`);

  assert.match(layout, /<Suspense key=\{meta\.chunk \?\? meta\.pattern\} fallback=\{<RouteFallback \/>\}>/, 'the page region needs its own, per-route Suspense boundary');
  assert.match(layout, /function RouteFallback\(\)[\s\S]*?setChunkLoading\(true\);[\s\S]*?return <PageSkeleton \/>;/, 'the skeleton keeps the progress bar up for the whole download');
  assert.match(layout, /usePendingNavigation\(selectNavigating\)/);
  assert.match(layout, /chunk: '\/messages'/, 'chat rooms share one chunk so switching rooms keeps Messages mounted');
  assert.match(layout, /function NavProgress\(\)/);
  assert.match(layout, /role="progressbar" aria-label="Loading page"/);
  assert.match(layout, /const navMeta = useMemo\(\(\) => \(pendingPath && pendingPath !== pathname \? routeMeta\(pendingPath\) : meta\)/, 'the tapped tab lights up before the location commits');
  assert.match(layout, /<Sidebar meta=\{navMeta\}/);
  assert.match(layout, /<BottomNav meta=\{navMeta\}/);
  assert.match(layout, /onPointerDown: warm,\s+onMouseEnter: warm,\s+onFocus: warm,\s+onTouchStart: warm/);
  assert.match(layout, /useEffect\(\(\) => preloadWhenIdle\(TAB_ROOT_PATHS\), \[\]\)/);
  assert.match(css, /@keyframes nav-progress/);
});

/* ------------------------------------------------------------ desktop sidebar */

test('the desktop sidebar scrolls visibly: compact rows, edge fades, no footer links, active item kept in view', () => {
  const sidebar = layout.slice(layout.indexOf('function Sidebar('), layout.indexOf('function DesktopTopBar('));
  assert.match(sidebar, /className=\{cx\('scroll-visible mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3 xl:px-4', fadeClass\(edges, 'y'\)\)\}/);
  assert.match(sidebar, /useScrollEdges\(navRef, 'y'\)/);
  assert.match(sidebar, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.doesNotMatch(sidebar, /border-t border-line pt-3/, 'per-group rules cost 4 × 28 px');
  assert.doesNotMatch(sidebar, /to: '\/settings'/, 'Settings lives in the account menu, not a nav footer');
  assert.doesNotMatch(sidebar, /to: '\/support'/, 'Support lives in the account menu, not a nav footer');
  const sideLink = layout.slice(layout.indexOf('function SideLink('), layout.indexOf('function Sidebar('));
  assert.match(sideLink, /relative flex h-10 items-center/, 'sidebar rows are 40 px');
  assert.match(sideLink, /pointer-coarse:min-h-11/, 'and still 44 px on touch');
  assert.match(css, /\.scroll-visible \{ scrollbar-width: thin; scrollbar-color: var\(--line-strong\) var\(--surface-2\); scrollbar-gutter: stable; \}/);
  assert.match(css, /@utility mask-fade-b \{ mask-image: linear-gradient\(to top, transparent, #000 40px\); \}/);
  // The account menu still offers both destinations.
  assert.match(layout, /\{ label: 'Settings', icon: <Settings size=\{18\} \/>, to: '\/settings' \}/);
  assert.match(layout, /\{ label: 'Support', icon: <LifeBuoy size=\{18\} \/>, to: '\/support' \}/);
});

/* ------------------------------------------------------------ iOS focus zoom */

test('text controls are at least 16 px on coarse pointers so iOS Safari does not zoom on focus', () => {
  assert.match(css, /@utility input-base \{[\s\S]*?@media \(pointer: coarse\) \{ min-height: 48px; font-size: max\(16px, var\(--text-base\)\); \}/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*input:not\(\[type='checkbox'\]\)[^\n]*,\s*textarea,\s*select \{ font-size: max\(16px, 1em\); \}/);
  assert.doesNotMatch(read('index.html'), /maximum-scale/, 'pinch zoom must stay available');
});

/* ------------------------------------------------------------ offline page */

test('offline.html has no inline script and gets its behaviour from /offline.js (CSP script-src self)', () => {
  const page = read('public/offline.html');
  const script = read('public/offline.js');
  assert.doesNotMatch(page, /\son[a-z]+="/i, 'inline event handlers are blocked by the CSP');
  assert.doesNotMatch(page, /<script(?![^>]*\ssrc=)[^>]*>/i, 'inline <script> is blocked by the CSP');
  assert.match(page, /<script src="\/offline\.js"><\/script>/);
  assert.match(page, /<button type="button" id="retry">Try again<\/button>/);
  assert.match(page, /<a class="link" href="\/">Back to Vybe<\/a>/, 'a second way out that needs no JavaScript');
  assert.match(page, /html\[data-theme="dark"\]/, 'honours the in-app theme choice');
  assert.match(page, /html:not\(\[data-theme\]\) \{ color-scheme: dark;/, 'system preference only when the script did not run');
  assert.match(script, /getElementById\('retry'\)/);
  assert.match(script, /addEventListener\('online', reload\)/);
  assert.match(script, /localStorage\.getItem\('vybe\.theme'\)/);
  assert.match(read('vite.config.ts'), /globPatterns: \['\*\*\/\*\.\{js,css,html,svg,png,woff2,webmanifest\}'\]/, 'offline.js is precached with the shell');
});

/* ------------------------------------------------------------ top-bar actions */

test('Notifications has one Mark-all-read control per viewport and PageHeader honours mobileActions={null}', () => {
  const page = read('src/pages/Notifications.tsx');
  assert.equal((page.match(/markAllButton\('(?:sm|md)'\)/g) || []).length, 2, 'md for desktop header, sm for the phone top bar');
  assert.match(page, /mobileActions=\{unreadCount > 0 \? markAllButton\('sm'\) : null\}/);
  assert.doesNotMatch(page, /lg:hidden">[\s\S]{0,200}markAllButton/, 'the inline phone row must not repeat the button');
  assert.match(ui, /actions: mobileActions === undefined \? actions : mobileActions/);
});

test('page-level "+" actions use the quiet icon button; the Log circle is the only primary in the bar and shows a plus', () => {
  for (const file of ['Health', 'Challenges', 'ProgressPhotos', 'Water', 'Meals', 'WorkoutLogs', 'Stories']) {
    const src = read(`src/pages/${file}.tsx`);
    const mobile = src.slice(src.indexOf('mobileActions='), src.indexOf('mobileActions=') + 400);
    assert.doesNotMatch(mobile, /variant="primary"/, `${file}: header IconButton must not be a filled square beside the Log circle`);
    assert.doesNotMatch(mobile, /size=\{40\}/, `${file}: header IconButton keeps the 44 px default`);
  }
  const logButton = layout.slice(layout.indexOf('function LogButton('), layout.indexOf('function LogSheet('));
  assert.match(logButton, /aria-label="Log something"/, 'the live suites click this label');
  assert.match(logButton, /<Plus size=\{22\} \/>/);
  assert.doesNotMatch(logButton, /<BrandMark/, 'the brand mark read as a logo/avatar, not a create action');
  assert.match(logButton, /<span className="hidden xl:inline">Log<\/span>/, 'the desktop button keeps its text');
});

/* ------------------------------------------------------------ tablets */

test('feed-width pages centre a 600 px column from md and stat grids fill the row on tablets', () => {
  assert.match(layout, /feedWidth && 'md:max-w-feed'/);
  assert.match(ui, /columns === 4 && 'md:grid-cols-4'/);
  assert.match(ui, /columns === 3 && 'md:grid-cols-3 max-md:\[&>\*:nth-child\(3n\)\]:col-span-2'/, 'a 3-up grid must not leave an orphan cell on phones');
  for (const file of ['Profile', 'UserProfile']) {
    const src = read(`src/pages/${file}.tsx`);
    assert.match(src, /<StatStrip\s+aria-label="Profile stats"/, `${file} uses the one-row stat strip`);
    assert.doesNotMatch(src, /<StatTile /, `${file} no longer stacks four stat cards`);
  }
  assert.match(ui, /export function StatStrip\(/);
});

/* ------------------------------------------------------------ document titles */

test('auth and public pages set the tab title', () => {
  assert.match(ui, /export function useDocumentTitle\(title: string \| undefined, suffix = ' · Vybe'\)/);
  assert.match(read('src/pages/Login.tsx'), /useDocumentTitle\(title\);/, 'AuthShell titles Login, Register, ForgotPassword and ResetPassword');
  assert.match(read('src/components/PublicShell.tsx'), /useDocumentTitle\(title\);/);
});

/* ------------------------------------------------------------ admin console */

test('admin tables pin their actions column, hide secondary columns under xl, and stack on phones', () => {
  const catalog = read('src/pages/admin/AdminCatalog.tsx');
  const users = read('src/pages/admin/AdminUsers.tsx');
  assert.equal((catalog.match(/<ScrollX className="admin-table-wrap">/g) || []).length, 2);
  assert.equal((catalog.match(/className="admin-sticky-actions text-right"/g) || []).length, 4, 'th + td for both catalog tables');
  assert.match(catalog, /className="hidden xl:table-cell">Created<\/th>/);
  assert.match(users, /<ScrollX className="admin-table-wrap hidden md:block">/);
  assert.match(users, /<ul className=\{cx\('divide-y divide-line md:hidden'/, 'phones get stacked rows');
  assert.match(users, /className="admin-sticky-actions text-right"/);
  assert.match(adminCss, /\.admin-table \.admin-sticky-actions \{\s*position: sticky;\s*right: 0;/);
  assert.match(adminCss, /\.admin-table-wrap\[data-overflow='true'\]\[data-fade~='r'\] \.admin-sticky-actions \{\s*box-shadow/);
  assert.match(ui, /export function ScrollX\(/);
  assert.match(ui, /data-overflow=\{edges\.overflow \? 'true' : 'false'\}/);
});

test('admin theme control icons cannot collapse and the console rail renders it icon-only', () => {
  const control = ui.slice(ui.indexOf('export function ThemeControl('), ui.indexOf('export function useDocumentTitle('));
  assert.match(control, /<Icon size=\{18\} className="shrink-0" \/>/);
  assert.match(control, /min-w-0 items-center justify-center gap-2 whitespace-nowrap/);
  assert.match(control, /aria-label=\{iconOnly \? l : undefined\}/);
  assert.match(read('src/pages/admin/AdminLayout.tsx'), /<ThemeControl label="Console appearance" iconOnly \/>/);
});

test('admin light theme meets 4.5:1 for tertiary text and danger text', () => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const text3 = adminCss.match(/--ops-graphite-550: (#[0-9a-f]{6})/)[1];
  assert.match(adminCss, /--text-3: var\(--ops-graphite-550\);/);
  assert.ok(ratio(text3, '#eaeef3') >= 4.5, `admin light text-3 on surface-2: ${ratio(text3, '#eaeef3').toFixed(2)}`);
  assert.ok(ratio(text3, '#dfe5ec') >= 4.5, `admin light text-3 on surface-3: ${ratio(text3, '#dfe5ec').toFixed(2)}`);
  const dangerText = css.match(/--danger-text: (#[0-9a-f]{6});\n/)[1];
  assert.ok(ratio(dangerText, '#fde0e3') >= 4.5, `danger-text on danger-soft: ${ratio(dangerText, '#fde0e3').toFixed(2)}`);
  assert.match(ui, /danger: 'bg-danger-soft text-danger-text'/, 'Badge tone=danger reads with the text token');
  assert.match(adminCss, /\.admin-status\[data-state='bad'\] \{[^\n]*color: var\(--danger-text\);/);
  assert.match(css, /@utility btn-danger \{ background: var\(--danger-soft\); color: var\(--danger-text\);/);
  assert.match(css, /--color-danger-text: var\(--danger-text\);/);
});

/* ------------------------------------------------------------ search field */

test('the search field draws one clear control', () => {
  assert.match(css, /input\[type='search'\]::-webkit-search-cancel-button,\s*input\[type='search'\]::-webkit-search-decoration[\s\S]*?\{ -webkit-appearance: none; appearance: none; display: none; \}/);
});

/* ------------------------------------------------------------ stories tray */

test('the stories tray shows one tile for the viewer, with the "+" as its own control when a story is live', () => {
  const src = read('src/pages/Stories.tsx');
  assert.match(src, /const ownIndex = useMemo\(\(\) => groups\.findIndex\(\(g\) => g\.author\._id === me\?\._id\)/);
  assert.match(src, /if \(i === ownIndex\) return null;/, 'the own group is not rendered a second time as "You"');
  assert.match(src, /aria-label="Watch your stories"/);
  assert.match(src, /aria-label="Add to your story"/, 'story-e2e clicks getByRole button /Your story/i to open the composer');
  assert.match(src, /<span className="w-full truncate text-center text-xs font-medium text-text-2">Your story<\/span>/, 'no-story state keeps the add tile');
  assert.doesNotMatch(src, /\{own \? 'You' : /);
});

/* ------------------------------------------------------------ revoked session */

test('a revoked session lands on sign-in with a reason and a way back', async () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /import \{ signInRedirect \} from '\.\/sessionRedirect';/);
  assert.match(api, /location\.href = signInRedirect\(location\.pathname, location\.search\)/);
  const login = read('src/pages/Login.tsx');
  assert.match(login, /params\.get\('reason'\) === 'expired'/);
  assert.match(login, /<Callout tone="info" title="You were signed out"/);
  assert.match(login, /safePath\(params\.get\('next'\)\)/, 'next= is honoured after sign-in');
  const { signInRedirect } = await import('../src/lib/sessionRedirect.ts');
  assert.equal(signInRedirect('/', ''), '/login?reason=expired');
  assert.equal(signInRedirect('/meals', '?log=1'), '/login?reason=expired&next=%2Fmeals%3Flog%3D1');
  assert.equal(signInRedirect('/login', ''), '/login?reason=expired', 'never loops sign-in back to itself');
});

/* ------------------------------------------------------------ routing */

test('unknown console URLs stay in the console and unknown member URLs get a not-found page', () => {
  const adminGroup = app.slice(app.indexOf('<Route path="/admin" element={<RequireAdmin>'), app.indexOf('{/* Authenticated app */}'));
  assert.match(adminGroup, /<Route path="\*" element=\{<Navigate to="\/admin" replace \/>\} \/>/);
  assert.match(app, /<Route path="\*" element=\{<NotFound \/>\} \/>/);
  assert.doesNotMatch(app, /<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/);
  const notFound = read('src/pages/NotFound.tsx');
  assert.match(notFound, /title="We couldn’t find that page"/);
  assert.match(notFound, /label: 'Back to home', to: '\/'/);
  // Every legacy alias the live smoke depends on is still declared.
  for (const alias of ['post/:postId', 'feed', 'explore', 'inbox', 'meal-templates', 'health-goals', 'water', 'workout-logs', 'livestreams']) {
    assert.match(app, new RegExp(`<Route path="${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

/* ------------------------------------------------------------ live video */

test('Live is only promoted when the server reports a relay, and the disabled copy is for members', () => {
  assert.match(layout, /const LIVE_PATH = '\/live';/);
  assert.match(layout, /liveEnabled \? g\.items : g\.items\.filter\(\(i\) => i\.to !== LIVE_PATH\)/, 'sidebar');
  assert.match(layout, /\.filter\(\(t\) => liveEnabled \|\| t\.to !== LIVE_PATH\)/, 'explore hub tabs');
  assert.match(layout, /EXPLORE_MORE\.filter\(\(e\) => liveEnabled \|\| e\.to !== LIVE_PATH\)/, 'right rail');
  assert.match(read('src/lib/capabilities.ts'), /return caps\?\.livestreamRelay === true;/);
  const live = read('src/pages/Livestreams.tsx');
  assert.match(live, /Live video isn’t available yet/);
  assert.match(live, /Watch stories or explore the community instead/);
  assert.doesNotMatch(live, /server setting|video relay/, 'no server-admin vocabulary for members');
  assert.match(live, /import \{ liveVideoEnabled, useCapabilities \} from '\.\.\/lib\/capabilities';/, 'shell and page share one capability query');
  // The route itself stays: deep links and the smoke suite open /live directly.
  assert.match(app, /<Route path="live" element=\{<Livestreams \/>\} \/>/);
});

/* ------------------------------------------------------------ tap targets */

test('touch targets reach 44 px: chips, 40 px icon buttons, theme segments, small tabs, chat avatars', () => {
  assert.match(ui, /size === 40 \? 'h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11'/);
  const chip = ui.slice(ui.indexOf('export function Chip('), ui.indexOf('/* ================================================================== modal'));
  assert.match(chip, /pointer-coarse:min-h-11/);
  assert.match(ui, /size === 'sm' \? 'min-h-10 px-3 text-xs pointer-coarse:min-h-11'/);
  assert.match(read('src/pages/Messages.tsx'), /className="-m-2 mb-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"/);
});

/* ------------------------------------------------------------ headings and landmarks */

test('phone Home has a level-one heading; empty states and card headers default to h2; section tabs are a landmark', () => {
  assert.match(layout, /<h1 className="sr-only">Home<\/h1>/);
  assert.match(ui, /export function EmptyState\(\{[\s\S]*?level = 2,/);
  assert.match(ui, /export function CardHeader\(\{[\s\S]*?level = 2,/);
  assert.match(layout, /<nav aria-label="Sections" className="sticky/);
});

/* ------------------------------------------------------------ tab strips and sparklines */

test('scrollable tab strips fade at a readable width and remeasure as tabs resize', () => {
  assert.match(css, /@utility mask-fade-r \{ mask-image: linear-gradient\(to left, transparent, #000 40px\); \}/);
  const tabs = ui.slice(ui.indexOf('export function Tabs('), ui.indexOf('export function SegmentedControl('));
  assert.match(tabs, /for \(const child of Array\.from\(list\.children\)\) ro\.observe\(child\);/);
});

test('a flat sparkline draws nothing (all zero) or a quiet dashed baseline (constant)', () => {
  const spark = ui.slice(ui.indexOf('export function Sparkline('), ui.indexOf('export type StatDelta'));
  assert.match(spark, /if \(max === min\) \{\s*if \(max === 0\) return placeholder;/);
  assert.match(spark, /strokeDasharray="3 4"/);
});
