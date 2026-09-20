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
import test, { mock } from 'node:test';
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

  // The pending store: the destination is recorded at once (tab highlight), but the
  // skeleton/progress feedback only after the grace period, so a chunk that lands
  // quickly (service worker, HTTP cache) never flashes anything.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const store = nav.usePendingNavigation;
    store.getState().start('/meals');
    assert.equal(store.getState().pendingPath, '/meals');
    assert.equal(store.getState().slow, false);
    assert.equal(nav.selectNavigating(store.getState()), false, 'no bar inside the grace period');
    mock.timers.tick(nav.NAV_GRACE_MS - 1);
    assert.equal(store.getState().slow, false);
    mock.timers.tick(1);
    assert.equal(store.getState().slow, true, 'past the grace period the shell shows the skeleton and bar');
    assert.equal(nav.selectNavigating(store.getState()), true);
    store.getState().finish();
    assert.equal(store.getState().pendingPath, null);
    assert.equal(store.getState().slow, false);
    assert.equal(nav.selectNavigating(store.getState()), false);

    // A navigation that commits inside the grace period cancels the timer: no late flash.
    store.getState().start('/gyms');
    store.getState().finish();
    mock.timers.tick(nav.NAV_GRACE_MS * 2);
    assert.equal(store.getState().slow, false, 'a finished navigation must not turn slow afterwards');

    // Re-targeting restarts the grace period for the new destination.
    store.getState().start('/workouts');
    mock.timers.tick(nav.NAV_GRACE_MS - 10);
    store.getState().start('/profile');
    mock.timers.tick(20);
    assert.equal(store.getState().slow, false, 'the grace period belongs to the latest destination');
    mock.timers.tick(nav.NAV_GRACE_MS);
    assert.equal(store.getState().slow, true);
    store.getState().finish();

    store.getState().setChunkLoading(true);
    assert.equal(nav.selectNavigating(store.getState()), true, 'a hard load still downloading its chunk keeps the bar up');
    store.getState().setChunkLoading(false);
  } finally {
    mock.timers.reset();
  }
  assert.equal(nav.NAV_GRACE_MS, 150);
});

test('the shell shows progress and a keyed skeleton while a route chunk downloads, and warms chunks on intent', () => {
  // Every consumer page is a lazyPage (the registry owns the chunk, so a warmed page never suspends);
  // every routed page a nav control can reach registers a preload, and every registered path is routed.
  assert.doesNotMatch(app, /lazy\(page\(/, 'React.lazy over a separately warmed import() suspends on its first render; use lazyPage');
  const pages = [...app.matchAll(/^const (\w+) = (lazyPage|lazy)\((?:(null|'[^']*'), )?\(\) => import\('\.\/pages\/(\w+)'\)\);$/gm)];
  const consumer = pages.filter((m) => !/^(Login|Register|ForgotPassword|ResetPassword)$/.test(m[1]) && !m[4].startsWith('admin/'));
  assert.ok(consumer.length >= 30, `expected every consumer page to be code-split, found ${consumer.length}`);
  for (const m of consumer) assert.equal(m[2], 'lazyPage', `${m[1]} must go through lazyPage so a warmed chunk renders without a skeleton`);
  const registered = consumer.filter((m) => m[3] && m[3] !== 'null').map((m) => m[3].slice(1, -1));
  assert.ok(registered.length >= 20, `expected the nav destinations to register preloads, found ${registered.length}`);
  const routed = new Set(['/', ...[...app.matchAll(/<Route path="([^"*:]+)"/g)].map((m) => (m[1].startsWith('/') ? m[1] : `/${m[1]}`))]);
  for (const p of registered) assert.ok(routed.has(p), `${p} registers a preload but is not routed`);
  for (const p of ['/', '/meals', '/gyms', '/workouts', '/profile']) assert.ok(registered.includes(p), `tab root ${p} must preload`);

  // The page region keeps ONE stable Suspense boundary: a boundary keyed per route commits its fallback the
  // moment the location changes and React then holds that fallback for its 300 ms throttle, so every first
  // visit flashed a skeleton even with the chunk in memory. Instead the held page is swapped for the skeleton
  // (and the shell for the destination's chrome) only once the grace period has passed.
  assert.doesNotMatch(layout, /<Suspense key=/, 'no per-route Suspense key: it makes a grace period impossible');
  assert.match(layout, /<Suspense fallback=\{<RouteFallback \/>\}>\s+<RouteErrorBoundary>\{waiting \? <PageSkeleton \/> : \(children \?\? <Outlet \/>\)\}<\/RouteErrorBoundary>\s+<\/Suspense>/);
  assert.match(layout, /const pending = pendingPath !== null && pendingPath !== pathname;/);
  assert.match(layout, /const waiting = pending && slow;\s+const shellMeta = waiting \? navMeta : meta;\s+const shellChrome = waiting \? null : chrome;\s+const shellPath = waiting && pendingPath \? pendingPath : pathname;/);
  assert.match(layout, /<MobileTopBar meta=\{shellMeta\} title=\{title\} (?:titleNode=\{[^}]*\} )?back=\{shellChrome\?\.back\} actions=\{shellChrome\?\.actions\}/, 'the top bar follows the destination once its skeleton shows');
  assert.match(layout, /<SectionTabs hub=\{hub\} pathname=\{shellPath\}/);
  assert.match(layout, /function RouteFallback\(\)[\s\S]*?setChunkLoading\(true\);[\s\S]*?return <PageSkeleton \/>;/, 'a hard load keeps the progress bar up for the whole download');
  assert.match(layout, /const show = usePendingNavigation\(selectNavigating\);/, 'the bar is driven by the store grace flag, not a second timer');
  assert.match(layout, /function NavProgress\(\)/);
  assert.match(layout, /role="progressbar" aria-label="Loading page"/);
  assert.match(layout, /const navMeta = useMemo\(\(\) => \(pending && pendingPath \? routeMeta\(pendingPath\) : meta\)/, 'the tapped tab lights up before the location commits');
  assert.match(layout, /<Sidebar meta=\{navMeta\}/);
  assert.match(layout, /<BottomNav meta=\{navMeta\}/);
  assert.match(layout, /onPointerDown: warm,\s+onMouseEnter: warm,\s+onFocus: warm,\s+onClick/);
  // The Home top bar's icons and the search form are entry points too, so they carry the same intent props.
  assert.match(ui, /<Link to=\{to\} (?:state=\{state\} )?viewTransition aria-label=\{label\} title=\{label\} className=\{cls\} \{\.\.\.linkProps\}>/, 'IconButton links accept the intent handlers');
  for (const [to, name] of [['/search', 'searchNav'], ['/messages', 'messagesNav'], ['/notifications', 'notificationsNav']]) {
    assert.match(layout, new RegExp(`const ${name} = useNavLinkProps\\('${to}'\\);`), `${to} top-bar icon records intent`);
    assert.match(layout, new RegExp(`<IconButton to="${to}" label="[^"]+"[^>]*linkProps=\\{${name}\\}>`));
  }
  assert.match(layout, /if \(location\.pathname !== '\/search'\) start\('\/search'\);\s+navigate\(`\/search\?q=/, 'submitting the search box records its destination');
  assert.doesNotMatch(layout, /onTouchStart: warm/, 'pointerdown already fires for touch; a touchstart handler doubled the preloads on scroll-start taps');
  assert.match(layout, /useEffect\(\(\) => preloadWhenIdle\(TAB_ROOT_PATHS\), \[\]\)/);
  assert.match(css, /@keyframes nav-progress/);
});

test('a page whose chunk is already in memory renders without suspending; only a chunk still downloading shows the skeleton', async () => {
  // renderToString marks a boundary that suspended with <!--$!--> (and emits the fallback) and one that
  // rendered straight through with <!--$-->, so it can tell a warm first render from a cold one without a DOM.
  const { createElement, lazy, Suspense } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const nav = await import('../src/lib/navigation.ts');
  nav.resetPreloads();
  const Meals = () => createElement('h1', null, 'Meals');
  const render = (Component) => renderToString(createElement(Suspense, { fallback: createElement('p', null, 'SKELETON') }, createElement(Component)));

  // Cold, then in flight: the first render while the chunk downloads suspends, and reuses the preload's download.
  let release;
  let calls = 0;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = () => resolve({ default: Meals });
    });
  };
  const MealsPage = nav.lazyPage('/meals', load);
  const warming = nav.preload('/meals?log=1');
  assert.equal(calls, 1);
  assert.match(render(MealsPage), /<!--\$!-->[\s\S]*SKELETON/, 'a chunk still downloading shows the boundary fallback');
  assert.equal(calls, 1, 'the page reuses the preload download instead of starting a second one');
  release();
  await warming;
  const warm = render(MealsPage);
  assert.match(warm, /<!--\$--><h1>Meals<\/h1>/, 'once the chunk has landed the page renders straight through');
  assert.doesNotMatch(warm, /SKELETON|\$!/);
  assert.equal(calls, 1);

  // Warm on the very first render (the idle/hover preload case): no suspension, no fallback.
  const Gyms = () => createElement('h1', null, 'Gyms');
  const GymsPage = nav.lazyPage('/gyms', () => Promise.resolve({ default: Gyms }));
  await nav.preload('/gyms');
  assert.match(render(GymsPage), /^<!--\$--><h1>Gyms<\/h1><!--\/\$-->$/, 'a preloaded page must not suspend on its first render');

  // Control: React.lazy over an already-resolved import() still suspends on its first render.
  // That is the regression lazyPage exists to prevent (a ~300 ms skeleton flash on every warm first visit).
  const Control = lazy(() => Promise.resolve({ default: Gyms }));
  assert.match(render(Control), /<!--\$!-->[\s\S]*SKELETON/);

  // A failed download is retried on the next intent rather than pinned as warmed.
  let attempts = 0;
  const FlakyPage = nav.lazyPage('/friends', () => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ default: Gyms });
  });
  await nav.preload('/friends');
  assert.equal(nav.isPreloaded('/friends'), false, 'a failed preload is forgotten');
  await nav.preload('/friends');
  assert.equal(attempts, 2);
  assert.match(render(FlakyPage), /<!--\$--><h1>Gyms<\/h1>/);
  nav.resetPreloads();
});

/* ------------------------------------------------------------ desktop sidebar */

test('the desktop sidebar scrolls visibly: compact rows, edge fades, no footer links, active item kept in view', () => {
  const sidebar = layout.slice(layout.indexOf('function Sidebar('), layout.indexOf('function DesktopTopBar('));
  // Gym First (P2): scroll-padding on the list + scroll-margin on the row keep the active hub clear of the edge fades.
  assert.match(sidebar, /className=\{cx\('scroll-visible mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3 \[scroll-padding-block:3rem\] xl:px-4', fadeClass\(edges, 'y'\)\)\}/);
  assert.match(layout.slice(layout.indexOf('function SideLink('), layout.indexOf('function SidebarGym(')), /scroll-my-12/);
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
  assert.match(read('src/pages/Login.tsx'), /useDocumentTitle\((?:documentTitle \?\? )?title\);/, 'AuthShell titles Login, Register, ForgotPassword and ResetPassword');
  assert.match(read('src/components/PublicShell.tsx'), /useDocumentTitle\((?:documentTitle \?\? )?title\);/);
});

/* ------------------------------------------------------------ admin console */

test('admin tables pin their actions column, hide secondary columns under xl, and stack on phones', () => {
  const catalog = read('src/pages/admin/AdminCatalog.tsx');
  const users = read('src/pages/admin/AdminUsers.tsx');
  assert.equal((catalog.match(/<ScrollX className="admin-table-wrap">/g) || []).length, 2);
  assert.equal((catalog.match(/className="admin-table admin-table--actions/g) || []).length, 2, 'both catalog tables pin their actions column');
  assert.match(catalog, /className="hidden xl:table-cell">Created<\/th>/);
  assert.match(users, /admin-cards/);
  assert.match(users, /admin-cards/, 'phones get stacked rows');
  assert.match(users, /admin-table--actions|admin-cards/);
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
  // The tray is the shared StoryTray component (Home and the Stories page).
  const tray = read('src/pages/StoryTray.tsx');
  // The viewer's group is split out of the others, so it never renders twice as "You".
  assert.match(tray, /splitOwnGroup\(groups, me\?\._id\)/);
  // One tile: with a live story it opens the viewer, otherwise it is the add action.
  assert.match(tray, /label=\{own \? `Your story \(/);
  assert.match(tray, /caption="Your story"/);
  // The "+" is its own control, so adding never requires watching first.
  assert.match(tray, /aria-label="Add to your story"/, 'story-e2e clicks getByRole button /Your story/i to open the composer');
  assert.match(read('src/pages/Stories.tsx'), /<StoryTray variant="page" \/>/);
});

/* ------------------------------------------------------------ revoked session */

test('a revoked session lands on sign-in with a reason and a way back', async () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /import \{ sessionExpiredLoginUrl \} from '\.\/authRedirect';/);
  assert.match(api, /const hadSession = !!tokenStore\.get\(\);\s+tokenStore\.clear\(\);/, 'remember whether there was a session before clearing it');
  assert.match(api, /location\.href = sessionExpiredLoginUrl\(location\.pathname, location\.search\)/);
  const login = read('src/pages/Login.tsx');
  assert.match(login, /loginNoticeFor\(params\)/);
  assert.match(login, /title="Signed out on this device"/);
  assert.match(login, /postLoginTarget\(\{ from: state\?\.from, next: params\.get\('next'\) \}\)/, 'next= is honoured after sign-in');
  const { signInRedirect } = await import('../src/lib/sessionRedirect.ts');
  assert.equal(signInRedirect('/', ''), '/login?reason=expired');
  assert.equal(signInRedirect('/meals', '?log=1'), '/login?reason=expired&next=%2Fmeals%3Flog%3D1');
  assert.equal(signInRedirect('/login', ''), '/login?reason=expired', 'never loops sign-in back to itself');
  assert.equal(signInRedirect('/support', '', null), '/login?next=%2Fsupport', 'a visitor with no session is not told they were signed out');
  assert.equal(signInRedirect('/', '', null), '/login');
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
  // Gym First (P2): the sidebar is six flat hubs; Live is reached only through the Explore hub's tabs, which filter it.
  assert.doesNotMatch(layout.slice(layout.indexOf('const SIDEBAR: SidebarItem[]'), layout.indexOf('const sidebarActive')), /'\/live'/, 'sidebar lists hubs, not Live');
  assert.match(layout, /\.filter\(\(t\) => liveEnabled \|\| t\.to !== LIVE_PATH\)/, 'explore hub tabs');
  assert.match(layout, /EXPLORE_MORE\.filter\(\(e\) => liveEnabled \|\| e\.to !== LIVE_PATH\)/, 'right rail');
  assert.match(read('src/lib/capabilities.ts'), /return caps\?\.livestreamRelay === true;/);
  const live = read('src/pages/Livestreams.tsx');
  assert.match(live, /Live video isn’t available yet/);
  assert.match(live, /Watch stories or explore the community instead/);
  assert.doesNotMatch(live, /server setting|video relay/, 'no server-admin vocabulary for members');
  assert.match(live, /import \{ useLiveEnabled \} from '\.\.\/lib\/capabilities';/, 'shell and page share one capability query');
  assert.match(layout, /import \{ useLiveEnabled \} from '\.\.\/lib\/capabilities';/, 'shell and page share one capability query');
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
  // /challenges: the card titles sit directly under the page h1, so they are h2 (axe heading-order).
  const challenges = read('src/pages/Challenges.tsx');
  assert.match(challenges, /<h2 className="line-clamp-2 text-md font-semibold text-text-1">\{challenge\.title\}<\/h2>/);
  assert.doesNotMatch(challenges, /<h3[\s>]/, 'no h3 on /challenges without an h2 above it');
  assert.match(ui, /export function EmptyState\(\{[\s\S]*?level = 2,/);
  assert.match(ui, /export function CardHeader\(\{[\s\S]*?level = 2,/);
  assert.match(layout, /<nav\s+aria-label="Sections"\s+className=\{cx\(\s*'sticky/);
});

/* ------------------------------------------------------------ tab strips and sparklines */

test('scrollable tab strips fade at a readable width and remeasure as tabs resize', () => {
  assert.match(css, /@utility mask-fade-r \{ mask-image: linear-gradient\(to left, transparent, #000 40px\); \}/);
  const tabs = ui.slice(ui.indexOf('export function Tabs('), ui.indexOf('export function SegmentedControl('));
  assert.match(tabs, /for \(const child of Array\.from\(list\.children\)\) ro\.observe\(child\);/);
});

test('a sparkline with no data or a flat series draws a quiet dashed baseline, never an empty box or axes', () => {
  // Gym First (P1): the "nothing yet" glyph is the same dashed baseline everywhere (Sparkline, Progress, Ring, ChartEmpty).
  const spark = ui.slice(ui.indexOf('export function Sparkline('), ui.indexOf('export type StatDelta'));
  assert.match(spark, /if \(!data \|\| data\.length < 2 \|\| max === min\) return baseline;/);
  assert.match(spark, /strokeDasharray="3 4"/);
  assert.doesNotMatch(spark, /return placeholder/);
  assert.match(ui, /emptyBaseline: \{ stroke: 'var\(--text-3\)', strokeDasharray: '3 4', strokeWidth: 1 \}/);
  assert.match(ui, /export function ChartEmpty\(/);
});

test('dark surfaces step >=1.2:1 apart, tertiary text stays >=4.5:1 on the lightest, and light cards are tonal', () => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const dark = css.slice(css.indexOf('.dark {'), css.indexOf('@theme inline'));
  const [, bg, s1, s2, s3] = dark.match(/--bg: (#[0-9a-f]{6}); --surface-1: (#[0-9a-f]{6}); --surface-2: (#[0-9a-f]{6}); --surface-3: (#[0-9a-f]{6});/);
  assert.equal(bg, '#000000', 'the dark page background is Instagram black (P8 palette)');
  for (const [a, b] of [[bg, s1], [s1, s2], [s2, s3]]) assert.ok(ratio(a, b) >= 1.2, `dark step ${a}→${b}: ${ratio(a, b).toFixed(3)}`);
  const text3 = dark.match(/--text-3: (#[0-9a-f]{6});/)[1];
  assert.ok(ratio(text3, s3) >= 4.5, `dark text-3 on surface-3: ${ratio(text3, s3).toFixed(2)}`);
  const control = dark.match(/--control-border: (#[0-9a-f]{6});/)[1];
  assert.ok(ratio(control, s2) >= 3, `dark control-border on surface-2: ${ratio(control, s2).toFixed(2)}`);
  // Light level-1 cards: no line, shadow only; dark rebinds the switch to the hairline; the admin console keeps its edge.
  assert.match(css, /--card-border-light: transparent;/);
  assert.match(dark, /--card-border-light: var\(--line\);/);
  assert.match(css, /@utility card \{[\s\S]*?border: 1px solid var\(--card-border-light, var\(--line\)\);/);
  assert.match(adminCss, /--card-border-light: var\(--line\);/);
  // Fluid scale tokens exist and are mirrored into Tailwind utilities.
  for (const token of ['--gutter', '--section-gap', '--text-h1', '--text-stat', '--text-band', '--text-figure']) {
    assert.match(css, new RegExp(`^  ${token}: clamp\\(`, 'm'), `${token} is a clamp()`);
  }
  assert.match(css, /--spacing-gutter: var\(--gutter\); --spacing-section: var\(--section-gap\);/);
  assert.match(css, /--text-band: var\(--text-band\); --text-band--line-height: 1;/);
});

test('the gym band collapses on a scroll timeline, or a passive listener, and never animates layout', () => {
  const band = read('src/components/GymBand.tsx');
  const hook = read('src/lib/gymBand.ts');
  assert.match(band, /className=\{cx\('gym-band dark', className\)\}/, 'dark in both themes, like AuthShell');
  assert.match(css, /@property --band-p \{ syntax: '<number>'; inherits: true; initial-value: 0; \}/);
  assert.match(css, /\.gym-band\[data-collapse='css'\] \{\s*animation: band-collapse linear both;\s*animation-timeline: scroll\(\);/);
  assert.match(css, /\.gym-band\[data-collapse='none'\]\[data-collapsed='true'\] \{ --band-p: 1; \}/);
  assert.match(hook, /CSS\.supports\('animation-timeline: scroll\(\)'\)/);
  assert.match(hook, /addEventListener\('scroll', onScroll, \{ passive: true \}\)/);
  assert.match(hook, /requestAnimationFrame\(update\)/);
  const bandRules = css.slice(css.indexOf('.gym-band {'), css.indexOf('/* ------------------------------------------------------------------ recharts */'));
  assert.doesNotMatch(bandRules, /transition:[^;]*\b(height|width|top|margin|padding)\b/, 'no layout property animates');
  // Copy sits on the scrim; the no-gym state is a designed state, not a hole.
  assert.match(band, /kicker: 'Find your gym',\s*title: 'Train somewhere\?',\s*body: 'Pick your gym and Vybe fills with the people who train there\.',/);
  assert.match(band, /if \(!text \|\| \/\^0\+\$\/\.test\(text\)\) return null;/, 'never "0 training today"');
  assert.match(band, /const hasFigure = typeof figure === 'number' && Number\.isFinite\(figure\) && figure > 0;/, 'the figure draws only above zero');
});
