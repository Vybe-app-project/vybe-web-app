import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function filesBelow(directory) {
  const absolute = path.join(root, directory);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(relative) : [relative];
  });
}

test('all lazy page imports resolve to committed TypeScript files', () => {
  const app = read('src/App.tsx');
  const imports = [...app.matchAll(/import\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(imports.length >= 40, `expected at least 40 lazy pages, found ${imports.length}`);
  for (const imported of imports) {
    const relative = path.join('src', `${imported.replace(/^\.\//, '')}.tsx`);
    assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
  }
});

test('the consumer and administration route families are present', () => {
  const app = read('src/App.tsx');
  const required = [
    '/login', '/register', '/admin', '/admin/login', 'discover', 'messages',
    'gyms', 'communities', 'live', 'workouts', 'meals', 'health', 'challenges',
    'achievements', 'settings', '/support',
  ];
  for (const route of required) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  }
});

test('the staff console exposes password recovery without a session', () => {
  const app = read('src/App.tsx');
  const guardedTree = app.indexOf('element={<RequireAdmin>');
  assert.ok(guardedTree > 0, 'RequireAdmin route missing');
  for (const route of ['/admin/forgot-password', '/admin/reset-password']) {
    const match = app.match(new RegExp(`path=["']${route}["']`));
    assert.ok(match, `${route} must be routed`);
    // Both pages are reached from an email or the sign-in page, so they must
    // be declared outside the RequireAdmin tree.
    assert.ok(match.index < guardedTree, `${route} must be public (declared before RequireAdmin)`);
  }

  const login = read('src/pages/admin/AdminLogin.tsx');
  assert.match(login, /to=["']\/admin\/forgot-password["']/);
  assert.match(login, /Forgot password\?/);

  // The pages talk to the two public admin routes, and only those.
  const forgot = read('src/pages/admin/AdminForgotPassword.tsx');
  assert.match(forgot, /adminApi\.post\(['"]\/admins\/request-reset['"]/);
  assert.doesNotMatch(forgot, /bootstrapAdmin/, 'forgot-password must not probe the session (401 interceptor bounces to /admin/login)');
  const reset = read('src/pages/admin/AdminResetPassword.tsx');
  assert.match(reset, /adminApi\.post\(['"]\/admins\/reset-password['"]/);
  assert.match(reset, /to=["']\/admin\/login["']/, 'success state must link back to sign-in');
  assert.match(reset, /['"]\/admin\/forgot-password['"]/, 'invalid-link states must offer a new request');
  assert.match(reset, /forgetAdminSession\(\)/, 'a successful reset must drop the tab’s admin token');

  // The token is read from ?token=, which is how email_service/adminResetMailer.js writes the link.
  assert.match(read('src/lib/passwordReset.ts'), /get\(['"]token['"]\)/);
});

test('the production client defaults to same-origin API routing', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /import\.meta\.env\.VITE_API_BASE/);
  assert.match(api, /\|\| '\/api'/);
  assert.match(api, /timeout:\s*30000/);
});

test('tracked browser source contains no credential-shaped values or fixed API hosts', () => {
  const text = filesBelow('src')
    .filter((file) => /\.(?:ts|tsx|css)$/.test(file))
    .map((file) => read(file))
    .join('\n');
  const forbidden = [
    /AKIA[0-9A-Z]{16}/,
    /AIza[0-9A-Za-z_-]{35}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /https?:\/\/[^\s"'`]+\/api(?:\/|\b)/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(text, pattern);
});

test('account deletion remains a deliberate authenticated operation', () => {
  // The card moved to its own file (Wave C1 data lifecycle); Settings mounts it once.
  const deleteAccount = read('src/pages/settings/DeleteAccount.tsx');
  assert.match(deleteAccount, /api\.delete\(['"]\/users\/me['"]/);
  assert.match(deleteAccount, /DELETE_PHRASE/);
  assert.match(deleteAccount, /Permanently delete my account/);
  assert.match(read('src/pages/Settings.tsx'), /<DataLifecycleSection \/>/);
});

test('admin sessions are tab-scoped and legacy paths still resolve', () => {
  const api = read('src/lib/api.ts');
  // The admin console shares the consumer origin; its token must not persist
  // past the tab (item 14 of the post-rebuild audit).
  assert.match(api, /getAdmin: \(\) => sessionStorage\.getItem\(ADMIN_TOKEN_KEY\)/);
  assert.match(api, /setAdmin: \(t: string\) => sessionStorage\.setItem\(ADMIN_TOKEN_KEY, t\)/);
  assert.doesNotMatch(api, /localStorage\.setItem\(ADMIN_TOKEN_KEY/);
  // Sign-out must revoke on the server: the request has to carry the token
  // explicitly and survive the navigation that follows (fetch keepalive).
  assert.match(api, /keepalive: true/);
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /revokeSession\('\/auth\/logout', tokenStore\.get\(\)\)/);
  assert.match(auth, /revokeSession\('\/admins\/logout', tokenStore\.getAdmin\(\)\)/);
  // Tertiary text must stay at or above 4.5:1 on every surface (axe sweep
  // 2026-09-18): light #526b78 on #e3ece8 = 4.67. Dark was re-stepped for depth
  // (Gym First P1): #9ab0bc on the new surface-3 #1e435b = 4.63 (#869eab fell to 3.73).
  const css = read('src/styles.css');
  assert.match(css, /--text-3: #526b78;/);
  assert.match(css, /--text-3: #9ab0bc;/);
  // aria-expanded is only valid on a combobox; the search input declares the role.
  assert.match(read('src/pages/Search.tsx'), /role="combobox"\s+aria-autocomplete="list"/);
  // The button reset must stay layered or it overrides .btn-primary's colour.
  assert.match(read('src/styles.css'), /@layer base \{\s*button \{ font: inherit; color: inherit; \}/);

  // Mobile share links are /open.html?type=…&id=…; the SPA must answer them.
  const appSrc = read('src/App.tsx');
  assert.match(appSrc, /path=["']\/open\.html["']/);
  assert.match(read('src/lib/shareLinks.ts'), /'meal-template': .*shared=|case 'meal-template':\s*return `\/meals\/templates\?shared=/s);
  // A meal shared from the app travels as its 64-hex share token and must land on the shared-meal page.
  assert.match(read('src/lib/shareLinks.ts'), /case 'meal':\s*return MEAL_SHARE_TOKEN\.test\(id\) \? `\/meals\/shared\/\$\{q\}` : `\/meals\/\$\{q\}`/);
  // Editing a workout must use the full-update route; PATCH /workouts/:id only changes visibility.
  // The editor is its own route module (/workouts/new, /workouts/:workoutId/edit) since the gym-first redesign.
  assert.match(read('src/pages/workouts/WorkoutEditor.tsx'), /api\.put<[^>]*>\(`\/workouts\/update\/\$\{editing\._id\}`/);
  assert.doesNotMatch(read('src/pages/workouts/WorkoutEditor.tsx'), /api\.patch<[^>]*>\(`\/workouts\/\$\{editing\._id\}`/);
  assert.match(read('src/pages/Gyms.tsx'), /params\.get\('gym'\)/);
  // API-emitted links: emails carry /support.html, meal shares carry /meals/shared/<token>.
  assert.match(appSrc, /path=["']\/support\.html["']/);
  assert.match(appSrc, /path=["']meals\/shared\/:token["']/);
  assert.match(read('src/pages/WeeklyPlans.tsx'), /params\.get\('shared'\)/);

  const app = read('src/App.tsx');
  for (const legacy of ['workout-logs', 'livestreams', 'meal-templates', 'health-goals', 'water', 'explore', 'inbox']) {
    assert.match(app, new RegExp(`path=["']${legacy}["']`), `legacy path /${legacy} must redirect`);
  }
});

test('the admin catalog manager is routed, in the console nav, and talks to the catalog API as staff', () => {
  const app = read('src/App.tsx');
  // The list plus one editor route per kind ("new" and an id), all under the RequireAdmin outlet.
  for (const route of ['catalog', 'catalog/workouts/new', 'catalog/workouts/:workoutId', 'catalog/plans/new', 'catalog/plans/:planId']) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`), `missing /admin/${route}`);
  }
  const layout = read('src/pages/admin/AdminLayout.tsx');
  assert.match(layout, /\{ to: '\/admin\/catalog', label: 'Catalog', Icon: Dumbbell \}/);

  // Every catalog call carries the staff token and every path is a literal
  // the contract audit can pin; the cover upload uses the one presign purpose
  // the catalog's media verifier accepts.
  const api = read('src/pages/admin/catalogApi.ts');
  assert.doesNotMatch(api, /\bapi\.(get|post|patch|put|delete)\(/, 'catalog calls must use adminApi, never the member client');
  for (const route of ['/admin/catalog/workouts', '/admin/catalog/plans', '/upload/presign']) {
    assert.ok(api.includes(`'${route}'`), `missing literal ${route}`);
  }
  assert.match(api, /purpose: 'media'/);

  // The editors seed their form only from a fetch that settled during this
  // mount (never the cached copy TanStack serves while it refetches) and diff
  // against the record that seeded it; tests/admin-catalog-editor-seed.test.mjs
  // shows why. Back/Cancel/save return to the list view the admin came from.
  for (const [file, kind] of [['src/pages/admin/AdminCatalogWorkout.tsx', 'workout'], ['src/pages/admin/AdminCatalogPlan.tsx', 'plan']]) {
    const editor = read(file);
    assert.match(editor, /staleTime: 0/, `${file}: the detail query must refetch on every mount`);
    assert.match(editor, /seedableRecord\(detail\)/, `${file}: the draft must wait for a settled fetch`);
    assert.match(editor, new RegExp(`${kind}SessionBody\\(current\\)`), `${file}: the body must be diffed against the seeded baseline`);
    assert.doesNotMatch(editor, /build(?:Workout|Plan)Body\(/, `${file}: never diff against the live query result`);
    assert.match(editor, /catalogReturnPath\(location\.state/, `${file}: return to the list view the admin came from`);
  }
  assert.match(read('src/pages/admin/AdminCatalog.tsx'), /catalogReturnState\(location\)/);

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'GET /api/admin/catalog/workouts', 'POST /api/admin/catalog/workouts', 'GET /api/admin/catalog/workouts/:id',
    'PATCH /api/admin/catalog/workouts/:id', 'DELETE /api/admin/catalog/workouts/:id',
    'GET /api/admin/catalog/plans', 'POST /api/admin/catalog/plans', 'GET /api/admin/catalog/plans/:id',
    'PATCH /api/admin/catalog/plans/:id', 'DELETE /api/admin/catalog/plans/:id',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('public legal and deletion pages ship without placeholder configuration', () => {
  const required = [
    'privacy-policy.html',
    'terms-and-conditions.html',
    'account-deletion.html',
  ];
  for (const relative of required) {
    const source = read(path.join('public', relative));
    assert.ok(source.length > 50, `public/${relative} is unexpectedly empty`);
    assert.doesNotMatch(source, /__VYBE_[A-Z0-9_]+__/);
  }
});

test('the Gyms places search asks the API for fitness places only', () => {
  const gyms = read('src/pages/Gyms.tsx');
  // Without kind=gym the OpenStreetMap fallback offers any named place
  // (farms, helipads, cafés) as a gym to join.
  assert.match(gyms, /api\.get\('\/gyms\/place-search',\s*\{\s*params:\s*\{[^}]*kind:\s*'gym'/s);
});

test('OVH release scripts require clean immutable commit artifacts', () => {
  const local = read('scripts/release-ovh.sh');
  const remote = read('scripts/deploy-web-remote.sh');
  const rollback = read('scripts/rollback-web-remote.sh');
  assert.match(local, /git status --porcelain/);
  assert.match(local, /git archive/);
  assert.match(local, /shasum -a 256/);
  // Remote steps need root and the SSH user is unprivileged: every remote
  // privileged command must go through sudo -n so it fails fast, not hangs.
  assert.match(local, /sudo -n install -d/);
  assert.match(local, /sudo -n env VYBE_WEB_RELEASE_ROOT/);
  assert.match(read('scripts/rollback-ovh.sh'), /sudo -n env VYBE_WEB_RELEASE_ROOT/);
  assert.match(remote, /sha256sum/);
  assert.match(remote, /flock -x/);
  assert.match(remote, /releases\/\$commit_sha/);
  assert.match(remote, /mv -Tf/);
  assert.match(rollback, /releases\/\$commit_sha/);
  assert.doesNotMatch(`${local}\n${remote}\n${rollback}`, /149\.56\.18\.195/);
});

test('search, profiles and friends: the fix8 regressions stay fixed', () => {
  const friends = read('src/pages/Friends.tsx');
  // Declining an incoming request is the receiver's route; the sender-only
  // cancel route answered 404 and the request stayed in Requests forever.
  assert.match(friends, /const declineFriend = useMutation\(\{[\s\S]*?api\.delete\(`\/friends\/incoming\/\$\{requestId\}`\)/);
  assert.match(friends, /const withdrawRequest = useMutation\(\{[\s\S]*?api\.delete\(`\/friends\/requests\/\$\{requestId\}`\)/);
  // The pending tab's X uses the decline mutation, the Sent tab's Withdraw uses the other one.
  assert.match(friends, /label=\{`Decline \$\{displayName\(r\.sender\)\}`\}[\s\S]*?onClick=\{\(\) => declineFriend\.mutate\(r\._id\)\}/);
  assert.match(friends, /onClick=\{\(\) => withdrawRequest\.mutate\(r\._id\)\}[\s\S]*?Withdraw/);
  // Messaging opens the draft route with the person attached, never the bare inbox.
  assert.match(friends, /to=\{`\/messages\/new\?to=\$\{u\._id\}`\} state=\{\{ peer: u \}\}/);
  assert.doesNotMatch(friends, /\/messages\?to=/);
  // The privacy CTA lands on the privacy card, and the copy no longer promises private-post access.
  assert.match(friends, /to: '\/settings#privacy'/);
  assert.doesNotMatch(friends, /Friends see each other’s private posts/);
  // Phone tab strip: no icons and the small size so "Follow requests" is not clipped at 390 px.
  assert.match(friends, /size=\{compact \? 'sm' : 'md'\}/);
  assert.match(friends, /icon: compact \? undefined : <Users size=\{16\} \/>/);
  // People search is no longer silently capped at eight rows.
  // People search is the shared typeahead (results as you type, avatars, profile on pick).
  assert.match(friends, /<PeopleSearch\b/);
  assert.match(friends, /import PeopleSearch, \{ type Person \} from '\.\/PeopleSearch';/);

  const profile = read('src/pages/UserProfile.tsx');
  assert.match(profile, /api\.delete\(`\/friends\/incoming\/\$\{requestId\}`\)/);
  assert.match(profile, /label=\{`Decline \$\{name\}’s friend request`\}/);
  assert.match(profile, /to=\{`\/messages\/new\?to=\$\{user\._id\}`\} state=\{\{ peer: user \}\}/);
  assert.doesNotMatch(profile, /\/messages\?to=/);
  // Followers / Following tiles open the lists (only when the content is visible).
  assert.match(profile, /to: canViewContent \? `\/u\/\$\{user\._id\}\/followers` : undefined/);
  assert.match(profile, /to: canViewContent \? `\/u\/\$\{user\._id\}\/following` : undefined/);
  assert.match(profile, /Settings › Blocked accounts/);

  const own = read('src/pages/Profile.tsx');
  assert.match(own, /to: '\/profile\/followers'/);
  assert.match(own, /to: '\/profile\/following'/);
  assert.doesNotMatch(own, /label="Followers"[^\n]*to="\/friends"/);
  // Username-taken is an inline field error with focus, not only a toast.
  assert.match(own, /setErrors\(\(er\) => \(\{ \.\.\.er, username: field\.username \|\| message \}\)\);\s*document\.getElementById\('pf-username'\)\?\.focus\(\)/);

  const app = read('src/App.tsx');
  assert.match(app, /path="profile\/:kind" element=\{<Connections \/>\}/);
  assert.match(app, /path="u\/:id\/:kind" element=\{<Connections \/>\}/);
  const connections = read('src/pages/Connections.tsx');
  assert.match(connections, /\/users\/statistics\/conn\/all\/social\/populate\/\$\{id\}\/connections/);
  assert.match(connections, /params: \{ type: kind, page: pageParam, limit: PAGE_SIZE/);
  assert.match(connections, /title="This list is private"/);

  // Messages: a bare /messages?to=<id> is the draft route.
  const messages = read('src/pages/Messages.tsx');
  assert.match(messages, /const toParam = params\.get\('to'\) \|\| '';/);
  assert.match(messages, /const isDraft = roomId === DRAFT_ROOM_ID \|\| \(!roomId && toParam\.length > 0\);/);
});

test('settings: privacy switch, blocked accounts and inline username errors', () => {
  const settings = read('src/pages/Settings.tsx');
  // The privacy card: the switch, backed by PUT /users/settings, with the blocked list beneath it.
  assert.match(settings, /id="privacy"/);
  assert.match(settings, /title="Private account"/);
  assert.match(settings, /api\.put\('\/users\/settings', \{ privacy \}\)/);
  assert.match(settings, /api\.get\('\/users\/blocked'\)/);
  assert.match(settings, /api\.post\('\/users\/unblock', \{ userId \}\)/);
  assert.match(settings, /aria-label=\{`Unblock \$\{displayName\(u/);
  // Deep links (#privacy from the Friends page) scroll to and focus the card.
  assert.match(settings, /const \{ hash \} = useLocation\(\);/);
  assert.match(settings, /card\.scrollIntoView\(/);
  // The card shape the handler relies on lives in the shared SettingsPieces module every card on the page uses.
  assert.match(read('src/pages/SettingsPieces.tsx'), /<Card id=\{id\} role="region"/);
  assert.match(settings, /import \{ SettingsCard, ToggleRow \} from '\.\/SettingsPieces';/);
  // Username conflicts land under the field, with focus there.
  assert.match(settings, /document\.getElementById\('set-username'\)\?\.focus\(\)/);
  assert.match(settings, /<PrivacySection \/>/);
  // Deletion stays deliberate (kept from the earlier contract; the card now lives in settings/DeleteAccount.tsx).
  assert.match(read('src/pages/settings/DeleteAccount.tsx'), /Permanently delete my account/);
});
test('search: every API bucket renders, the typeahead is keyboard-navigable and opens profiles', () => {
  const search = read('src/pages/Search.tsx');
  for (const key of ['users', 'posts', 'hashtags', 'workouts', 'meals', 'challenges']) {
    assert.match(search, new RegExp(`\\{ key: '${key}', label: '`), `result tab for ${key}`);
  }
  assert.match(search, /const nothingFound =\s*results\.isSuccess && !users\.length && !posts\.length && !hashtags\.length && !workouts\.length && !meals\.length && !challenges\.length;/);
  assert.match(search, /<WorkoutTile key=\{w\._id\} workout=\{w\} \/>/);
  assert.match(search, /<MealTile key=\{m\._id\} meal=\{m\} \/>/);
  assert.match(search, /<ChallengeTile key=\{c\._id\} challenge=\{c\} \/>/);
  assert.match(search, /to=\{`\/challenges\?open=\$\{challenge\._id\}`\}/);
  // The All tab previews people/hashtags with See all; posts stay complete.
  assert.match(search, /users: 3,\s*hashtags: 6,/);
  assert.match(search, /<SeeAll label="See all people" onClick=\{\(\) => switchType\('users'\)\} \/>/);
  // Typeahead: roving active option with ARIA wiring; a person navigates to the profile.
  assert.match(search, /role="combobox"\s+aria-autocomplete="list"/);
  assert.match(search, /aria-activedescendant=\{showSuggestions && activeIndex >= 0 \? optionId\(activeIndex\) : undefined\}/);
  assert.match(search, /if \(e\.key === 'ArrowDown'\)/);
  assert.match(search, /if \(e\.key === 'ArrowUp'\)/);
  assert.match(search, /else if \(e\.key === 'Escape'\)/);
  assert.match(search, /role="option" aria-selected=\{active\}/);
  assert.match(search, /navigate\(`\/u\/\$\{s\.id\}`, \{ viewTransition: true \}\)/);
  // Private accounts carry a lock in suggestions; the field caps at the API limit; recents are deduped.
  assert.match(search, /s\.isPrivate \? \(\s*<span role="img" aria-label="Private account"/);
  assert.match(search, /maxLength=\{SEARCH_QUERY_MAX\}/);
  assert.match(search, /export const SEARCH_QUERY_MAX = 100;/);
  assert.match(search, /return dedupeRecent\(\(data\.recentSearches \|\| \[\]\) as RecentSearch\[\]\);/);
  // "Popular" only when every listed account has followers.
  assert.match(search, /'Popular athletes' : 'People to follow'/);
  // Subtitle and shell placeholder agree about what search covers.
  assert.match(search, /subtitle="People, posts, hashtags, workouts, meals and challenges across Vybe\."/);
  assert.match(read('src/components/Layout.tsx'), /placeholder="Search people, posts, workouts, meals…"/);
  // Challenges honours the deep link the search results use.
  assert.match(read('src/pages/Challenges.tsx'), /useState<string \| null>\(\(\) => searchParams\.get\('open'\)\)/);

  // Two clear affordances became one: the native WebKit cancel button is hidden.
  const css = read('src/styles.css');
  assert.match(css, /input\[type='search'\]::-webkit-search-cancel-button,\s*input\[type='search'\]::-webkit-search-decoration \{[^}]*display: none;/);

  // 4xx answers are final: no retry (the skeleton no longer lingers 3 s on a 400).
  const main = read('src/main.tsx');
  assert.match(main, /if \(typeof s === 'number' && s < 500\) return false;/);
  assert.doesNotMatch(main, /s === 401 \|\| s === 403 \|\| s === 404/);
});

test('badges, report labels, handoff and session-freshness contracts', () => {
  const row = read('src/pages/UserRow.tsx');
  // The check is the operator-set badge; isVerified (e-mail confirmed) never renders one.
  assert.match(row, /const verified = user\.isIdentityVerified === true;/);
  assert.doesNotMatch(row, /user\.isVerified \?/);
  assert.match(row, /export function PrivateMark/);
  assert.match(read('src/pages/PostCard.tsx'), /author\?\.isIdentityVerified \? <BadgeCheck/);
  assert.doesNotMatch(read('src/pages/PostCard.tsx'), /author\?\.isVerified \? <BadgeCheck/);
  assert.match(read('src/pages/MealDetail.tsx'), /\.isIdentityVerified \? <BadgeCheck/);
  assert.match(read('src/lib/hooks.ts'), /isIdentityVerified\?: boolean;/);

  // "Report QA8 Stranger", not "Report qa8 stranger": only the generic type word is lowercased.
  assert.match(read('src/pages/Report.tsx'), /const what = targetLabel \|\| humanize\(targetType\)\.toLowerCase\(\);/);

  // The phone Home header's Search shortcut is the magnifier, not the Explore compass.
  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /<IconButton to="\/search" label="Search"[^>]*>\s*<SearchIcon size=\{22\} \/>/);
  assert.match(layout, /pattern: '\/u\/:id\/:kind'/);
  assert.match(layout, /pattern: '\/profile\/:kind'/);

  // The share handoff shell does not offer Log in / Join to a signed-in person.
  const shell = read('src/components/PublicShell.tsx');
  assert.match(shell, /const user = useAuth\(\(s\) => s\.user\);/);
  assert.match(shell, /\{loading \? null : user \? \(\s*<ButtonLink to="\/" variant="secondary" size="sm">\s*Open Vybe/);

  // Signed avatar URLs expire: the session refreshes on foreground/interval and on a broken avatar.
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /refreshUser: async \(\{ force = false \} = \{\}\) =>/);
  assert.match(auth, /export function useSessionRefresh/);
  assert.match(auth, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(read('src/App.tsx'), /useSessionRefresh\(onStale\)/);
  assert.match(read('src/components/ui.tsx'), /if \(url\.includes\('\/api\/media\/content\/'\)\) void useAuth\.getState\(\)\.refreshUser\(\);/);

  // The route snapshot pins the API routes the new surfaces call.
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'GET /api/users/blocked', 'POST /api/users/unblock', 'PUT /api/users/settings',
    'DELETE /api/friends/incoming/:requestId', 'DELETE /api/friends/requests/:requestId',
    'GET /api/users/statistics/conn/all/social/populate/:profileUserId/connections',
    'GET /api/share/preview/u/:id', 'GET /api/share/preview/p/:id',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('settings covers privacy, per-device sessions, separate email preferences and inline username errors', () => {
  const settings = read('src/pages/Settings.tsx');
  // Privacy: the switch the subtitle promised, backed by PUT /users/settings, plus the blocked list.
  assert.match(settings, /title="Private account"/);
  assert.match(settings, /api\.put\('\/users\/settings', \{ privacy \}\)/);
  assert.match(settings, /api\.get\('\/users\/blocked'\)/);
  assert.match(settings, /api\.post\('\/users\/unblock', \{ userId \}\)/);
  assert.match(settings, /<PrivacySection \/>/);
  // Email preferences read and write their own store and send only the changed keys.
  // The card lives in its own file (Wave E notifications-and-email); Settings mounts it exactly once.
  const email = read('src/pages/settings/EmailPreferencesSection.tsx');
  assert.match(email, /api\.get\('\/users\/email-preferences'\)/);
  assert.match(email, /api\.put\('\/users\/email-preferences', \{ notifications: patch \}\)/);
  assert.match(email, /api\.put\('\/users\/email-preferences', \{ emailPaused \}\)/, 'the pause can move on its own');
  assert.match(email, /save\.mutate\(changed\)/);
  assert.match(email, /qc\.setQueryData\(EMAIL_SETTINGS_KEY, settings\)/, 'a successful save must reset the dirty state');
  assert.match(email, /<SettingsCard id="email"/);
  assert.match(email, /export function EmailPreferencesCard\(/, 'the pure card the render test mounts');
  assert.match(settings, /import \{ EmailPreferencesSection \} from '\.\/settings\/EmailPreferencesSection';/);
  assert.equal((settings.match(/<EmailPreferencesSection \/>/g) || []).length, 1, 'one mount point');
  assert.doesNotMatch(settings, /function EmailPreferencesSection\(/, 'no inline copy of the card');
  assert.doesNotMatch(settings, /pickNotificationSettings\(next\)/, 'no card may replay the whole settings object');
  // Push toggles patch one key on the shared query with rollback.
  assert.match(settings, /save\.mutate\(\{ pauseAll: checked \}\)/);
  assert.match(settings, /qc\.setQueryData\(NOTIFICATION_SETTINGS_KEY, ctx\.previous\)/);
  // Sign out stays per device; everywhere is a separate confirmed action.
  assert.match(settings, /Sign out of all devices\?/);
  assert.match(settings, /logoutEverywhere/);
  assert.match(settings, />\s*Sign out\s*<\/Button>/);
  assert.match(settings, /label="Sign out"/);
  // Username conflicts land under the field.
  assert.match(settings, /setErrors\(\(x\) => \(\{ \.\.\.x, username: field\.username \|\| message \}\)\)/);
  assert.match(settings, /getElementById\('set-username'\)\?\.focus\(\)/);

  const auth = read('src/lib/auth.ts');
  assert.match(auth, /revokeSession\('\/auth\/logout-all', tokenStore\.get\(\)\)/);
  // A 401 bounce must explain itself on the sign-in page.
  const api = read('src/lib/api.ts');
  assert.match(api, /signOutReason\.set\('session-ended'\)/);
  const login = read('src/pages/Login.tsx');
  assert.match(login, /signOutReason\.take\(\)/);
  assert.match(login, /Signed out on this device/);
});

test('an offline reload keeps the session and paints the shell', () => {
  const auth = read('src/lib/auth.ts');
  // Only a rejected session (401/403) may drop the token; a network error restores the snapshot.
  assert.match(auth, /isSessionRejected\(error\)/);
  assert.match(auth, /tokenStore\.getUser\(\)/);
  assert.match(auth, /sessionStale: true/);
  assert.doesNotMatch(auth, /\} catch \{\s*tokenStore\.clear\(\);\s*set\(\{ user: null, loading: false \}\);/s);
  const api = read('src/lib/api.ts');
  assert.match(api, /USER_SNAPSHOT_KEY/);
  // The snapshot holds identity only.
  assert.match(api, /JSON\.stringify\(\{ _id: u\._id, username: u\.username, fullName: u\.fullName, avatar: u\.avatar \}/);
  const app = read('src/App.tsx');
  assert.match(app, /window\.addEventListener\('online', retry\)/, 'bootstrap must re-run when the connection returns');
  assert.match(read('src/components/Layout.tsx'), /Can’t reach Vybe right now/);
});
