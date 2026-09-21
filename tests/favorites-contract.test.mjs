/**
 * P8a saves: the bookmark on a post and the five `/api/favorites` routes
 * (foods and meals — not posts). Every literal path resolves to a mounted
 * route, the saved list is bounded, and the save glyph on a card reads its
 * two states honestly.
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
const snapshot = JSON.parse(read('contracts/backend-routes.json'));
const lib = await import('../src/lib/favorites.ts');

const segmentsOf = (webPath) => `/api${webPath}`.replace(/\$\{[^}]*\}/g, ':x').split('/').filter(Boolean);
const isMounted = (method, webPath) => {
  const want = segmentsOf(webPath);
  return snapshot.routes.some((route) => {
    if (route.method !== method) return false;
    const have = route.path.split('/').filter(Boolean);
    return have.length === want.length && have.every((segment, i) => segment.startsWith(':') || segment === want[i]);
  });
};

test('every saved-thing path the client sends is a mounted route', () => {
  const src = read('src/lib/favorites.ts');
  const literals = [...src.matchAll(/api\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*['`]([^'`]+)['`]/g)].map((m) => [
    m[1].toUpperCase(),
    m[2],
  ]);
  const expected = [
    ['POST', '/posts/bookmark'],
    ['POST', '/posts/unbookmark'],
    ['GET', '/posts/bookmarks'],
    ['POST', '/favorites/foods/${foodId}'],
    ['GET', '/favorites/foods'],
    ['POST', '/favorites/meals/${mealId}'],
    ['GET', '/favorites/meals'],
    ['GET', '/favorites/recent'],
  ];
  for (const [method, webPath] of expected) {
    assert.ok(literals.some(([m, p]) => m === method && p === webPath), `lib/favorites.ts must call ${method} ${webPath}`);
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not in contracts/backend-routes.json`);
  }
  for (const [method, webPath] of literals) {
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not a mounted route`);
  }
  // /api/favorites is foods and meals. A saved post is never filed there.
  assert.doesNotMatch(src, /favorites\/posts/);
  // `Post.saves` is a stored array with no writer anywhere; nothing reads it.
  assert.doesNotMatch(src, /post\.saves|data\.saves/);
  // The row flag is `isBookmarked`; there is no `saved`/`favorited` key on a post.
  assert.match(read('src/lib/hooks.ts'), /isBookmarked\?: boolean;/);
});

test('the saved list is bounded, and its key prefix is the one PostCard invalidates', () => {
  assert.equal(lib.SAVED_POSTS_PAGE_SIZE, 20);
  assert.deepEqual([...lib.favoriteKeys.bookmarks()], ['bookmarks']);
  assert.deepEqual([...lib.favoriteKeys.bookmarksPage(20)], ['bookmarks', 'page', 20]);
  const card = read('src/pages/PostCard.tsx');
  assert.match(card, /qc\.invalidateQueries\(\{ queryKey: \['bookmarks'\] \}\)/);
  // The page read is the only one made: the unpaged shape returns every
  // saved post in one response.
  assert.match(read('src/lib/favorites.ts'), /params: \{ page, limit \}/);
  const tabs = read('src/pages/ProfileTabs.tsx');
  assert.match(tabs, /favoriteKeys\.bookmarksPage\(SAVED_POSTS_PAGE_SIZE\)/);
  assert.match(tabs, /queryFn: \(\{ pageParam \}\) => fetchSavedPosts\(pageParam as number\)/);
  assert.match(tabs, /getNextPageParam: \(last, all\) => \(last\.hasNextPage \? all\.length \+ 1 : undefined\)/);
  // Saved stays private to its owner.
  assert.match(tabs, /\{ key: 'saved', label: 'Saved', icon: <Bookmark size=\{18\} \/>, ownOnly: true \}/);
});

test('the save toggle is optimistic, reversible, and routed through one module', () => {
  const card = read('src/pages/PostCard.tsx');
  assert.match(card, /import \{ setPostBookmark \} from '\.\.\/lib\/favorites';/);
  assert.match(card, /await setPostBookmark\(post\._id, next\);/);
  // Optimistic, with the previous value carried so a refusal puts it back.
  assert.match(card, /onMutate: \(next\) => \{\s*const prev = bookmarked;\s*setBookmarked\(next\);\s*return prev;\s*\}/);
  assert.match(card, /if \(typeof prev === 'boolean'\) setBookmarked\(prev\);/);
  // The one flourish the design allows, and a destination for the save.
  assert.match(card, /const save = usePulse\(\);/);
  assert.match(card, /if \(!bookmarked\) save\.pulse\(\);/);
  assert.match(card, /label: 'View saved', onClick: \(\) => navigate\('\/profile\?tab=saved'\)/);
  // The glyph sits on the right of the action row, on its own.
  assert.match(card, /className="ml-auto"/);
  assert.match(card, /<Bookmark size=\{24\} filled=\{bookmarked\} \/>/);
});

test('the save glyph reads its two states', async () => {
  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { ActionButton } = await import('../src/pages/PostCard.tsx');
  const { Bookmark } = await import('../src/components/icons.tsx');

  // The whole card cannot be rendered here: `ToastProvider` leaves a pending
  // promise under `node --test` that never settles, and the runner waits for
  // it. The action row is what this package changed, and it renders from
  // props alone — so the button is rendered, and the card's wiring of it is
  // pinned on the source above.
  const saveButton = (bookmarked) =>
    renderToString(
      h(ActionButton, {
        label: bookmarked ? 'Remove from saved' : 'Save',
        pressed: bookmarked,
        active: bookmarked,
        activeClass: 'text-text-1',
        onClick: () => {},
        className: 'ml-auto',
        icon: h(Bookmark, { size: 24, filled: bookmarked }),
      }),
    );

  const unsaved = saveButton(false);
  assert.match(unsaved, /aria-label="Save"/);
  assert.match(unsaved, /aria-pressed="false"/);
  assert.match(unsaved, /ml-auto/, 'the save glyph sits on the right of the row');

  const saved = saveButton(true);
  assert.match(saved, /aria-label="Remove from saved"/);
  assert.match(saved, /aria-pressed="true"/);
  // A save has no count beside it: the number of people who saved a post is
  // not something anyone is shown.
  assert.doesNotMatch(saved, /\(\d+\)/);
  for (const html of [unsaved, saved]) assert.ok(!html.includes('NaN'));
});

test('the card wires that button to the post it is on', () => {
  const card = read('src/pages/PostCard.tsx');
  assert.match(card, /label=\{bookmarked \? 'Remove from saved' : 'Save'\}/);
  assert.match(card, /pressed=\{bookmarked\}/);
  assert.match(card, /onClick=\{toggleSave\}/);
  assert.match(card, /disabled=\{bookmarkMutation\.isPending\}/);
  // The counters resync from the post when the query behind the card refetches.
  assert.match(card, /setBookmarked\(!!post\.isBookmarked\);/);
});
