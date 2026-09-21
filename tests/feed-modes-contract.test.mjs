/**
 * P8a feed modes: the two segments map to the API's own words, the paging
 * token travels under the right parameter name for each, every control path
 * resolves to a mounted route, and Following stays the default whatever the
 * browser remembers.
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
const lib = await import('../src/lib/feedControls.ts');

const segmentsOf = (webPath) => `/api${webPath}`.replace(/\$\{[^}]*\}/g, ':x').split('/').filter(Boolean);
const isMounted = (method, webPath) => {
  const want = segmentsOf(webPath);
  return snapshot.routes.some((route) => {
    if (route.method !== method) return false;
    const have = route.path.split('/').filter(Boolean);
    return have.length === want.length && have.every((segment, i) => segment.startsWith(':') || segment === want[i]);
  });
};

/* ------------------------------------------------------------------ paths */

test('every feed path the client sends is a mounted route', () => {
  const src = read('src/lib/feedControls.ts');
  const literals = [...src.matchAll(/api\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*['`]([^'`]+)['`]/g)].map((m) => [
    m[1].toUpperCase(),
    m[2],
  ]);
  const expected = [
    // The modes are a parameter on the feed route, not a route of their own.
    ['GET', '/posts/feed'],
    ['GET', '/posts/all/trendings'],
    ['GET', '/feed/controls'],
    ['DELETE', '/feed/controls'],
    ['POST', '/feed/posts/${postId}/not-interested'],
    ['DELETE', '/feed/posts/${postId}/not-interested'],
    ['POST', '/feed/users/${userId}/snooze'],
    ['DELETE', '/feed/users/${userId}/snooze'],
    ['POST', '/feed/impressions'],
    ['POST', '/feed/posts/${postId}/partners/remove-me'],
    ['GET', '/feed/hidden-details/preview'],
    ['POST', '/feed/hidden-details/apply'],
  ];
  for (const [method, webPath] of expected) {
    assert.ok(literals.some(([m, p]) => m === method && p === webPath), `lib/feedControls.ts must call ${method} ${webPath}`);
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not in contracts/backend-routes.json`);
  }
  for (const [method, webPath] of literals) {
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not a mounted route`);
  }
  // The two admin trending routes belong to the console, not to Home.
  assert.doesNotMatch(src, /admin\/trending/);
});

/* ------------------------------------------------------------------ the modes */

test('the modes are the API\'s own words, and Following is `latest`', () => {
  assert.deepEqual([...lib.FEED_MODES], ['latest', 'foryou', 'crew']);
  assert.equal(lib.DEFAULT_FEED_MODE, 'latest');
  assert.deepEqual([...lib.HOME_FEED_MODES], ['latest', 'foryou']);
  assert.deepEqual({ ...lib.FEED_MODE_LABELS }, { latest: 'Following', foryou: 'For you', crew: 'Crew' });
  assert.equal(lib.isFeedMode('latest'), true);
  assert.equal(lib.isFeedMode('following'), false, 'there is no mode=following; latest IS the follow graph');
  assert.equal(lib.isFeedMode(null), false);
  assert.equal(lib.FEED_FOR_YOU_FLAG, 'feedForYou');
  assert.equal(lib.EXPLORE_FLAG, 'explore');
  assert.deepEqual([...lib.FEED_REASONS], ['followed', 'gym', 'trained_together', 'popular', 'new_member', 'audition', 'crew', 'recent']);
});

test('the paging token travels under the name its mode reads', () => {
  // Page one is a number in both modes.
  assert.deepEqual(lib.feedModeParams('latest', 1, 10), { page: 1, limit: 10 });
  assert.deepEqual(lib.feedModeParams('foryou', 1, 10), { page: 1, limit: 10, mode: 'foryou' });
  // Later pages: keyset for Following, the ranked window token for For you.
  assert.deepEqual(lib.feedModeParams('latest', '2026-09-24T10:00:00.000Z_abc', 10), {
    before: '2026-09-24T10:00:00.000Z_abc',
    limit: 10,
  });
  assert.deepEqual(lib.feedModeParams('foryou', 'foryou:AbC123:20', 10), {
    cursor: 'foryou:AbC123:20',
    limit: 10,
    mode: 'foryou',
  });
  assert.deepEqual(lib.feedModeParams('crew', '2026-09-24T10:00:00.000Z_abc', 10), {
    before: '2026-09-24T10:00:00.000Z_abc',
    limit: 10,
    mode: 'crew',
  });
  // Following sends no `mode` at all: its request is byte for byte the one
  // the app has always made.
  assert.ok(!('mode' in lib.feedModeParams('latest', 1, 10)));
});

test('the remembered mode can never strand someone in a feed the server refuses', () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.equal(lib.readFeedMode(), 'latest', 'nothing remembered is Following');
    lib.writeFeedMode('foryou');
    assert.equal(lib.readFeedMode(), 'foryou');
    // The default is not stored: an empty slot and "latest" mean the same.
    lib.writeFeedMode('latest');
    assert.equal(store.has('vybe.feedMode'), false);
    assert.equal(lib.readFeedMode(), 'latest');
    // A value from an older build, or a hand-edited one, reads as Following.
    store.set('vybe.feedMode', 'following');
    assert.equal(lib.readFeedMode(), 'latest');
  } finally {
    globalThis.localStorage = previous;
  }
});

test('storage that throws is not a crash; it is just Following', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('privacy mode');
    },
    setItem: () => {
      throw new Error('privacy mode');
    },
    removeItem: () => {
      throw new Error('privacy mode');
    },
  };
  try {
    assert.equal(lib.readFeedMode(), 'latest');
    assert.doesNotThrow(() => lib.writeFeedMode('foryou'));
  } finally {
    globalThis.localStorage = previous;
  }
});

test('the served mode is the server\'s answer, not what was asked', () => {
  assert.equal(lib.servedMode({ mode: 'latest', modeUnavailable: 'age' }, 'foryou'), 'latest');
  assert.equal(lib.servedMode({ mode: 'foryou' }, 'foryou'), 'foryou');
  assert.equal(lib.servedMode(undefined, 'foryou'), 'foryou');
  assert.equal(lib.servedMode({ mode: 'nonsense' }, 'latest'), 'latest');
});

/* ------------------------------------------------------------------ the page */

test('Home draws the pill under the story rail and only while the flag is on', () => {
  const feed = read('src/pages/Feed.tsx');
  assert.match(feed, /const forYouOffered = useFeedForYou\(\);/);
  assert.match(feed, /const \[mode, setMode\] = useState<FeedMode>\(readFeedMode\);/);
  assert.match(feed, /\{forYouOffered \? \(\s*<SegmentedControl\s+aria-label="Feed"/);
  assert.match(feed, /tabs=\{HOME_FEED_MODES\.map\(\(key\) => \(\{ key, label: FEED_MODE_LABELS\[key\] \}\)\)\}/);
  assert.match(feed, /active=\{activeMode\}/, 'the pill follows the answer, not the ask');
  // The pill sits between the rail and the composer, inside the one hairline region.
  const region = feed.slice(feed.indexOf('<div className="feed-rule pb-3">'), feed.indexOf('<FirstWeekCard'));
  assert.ok(region.indexOf('<StoryTray') < region.indexOf('forYouOffered'));
  assert.ok(region.indexOf('forYouOffered') < region.indexOf('<Composer'));
  // The query carries the mode, and ['feed'] is still its prefix.
  assert.match(feed, /queryKey: \['feed', mode\]/);
  assert.match(feed, /feedModeParams\(mode, pageParam, FEED_PAGE_SIZE\)/);
  // A flag that went off cannot succeed on retry.
  assert.match(feed, /retry: \(count, err\) => !isFeatureDisabled\(err\) && count < 2/);
  // Both of the server's last words drop the preference.
  assert.match(feed, /const refused = mode !== 'latest' && \(isError && isFeatureDisabled\(error\)\);/);
  assert.match(feed, /const ageLimited = data\?\.pages\[0\]\?\.modeUnavailable === 'age';/);
  assert.match(feed, /writeFeedMode\('latest'\);/);
  // Only Following polls: a ranked list has no "newest" to be behind.
  assert.match(feed, /enabled: mode === 'latest' && allPosts\.length > 0 && online/);
  // Explore is Discover's surface, never Home's: no trending read, no flag.
  assert.doesNotMatch(feed, /all\/trendings|fetchTrendingPosts|EXPLORE_FLAG/);
});

test('an empty For you sends people back to Following rather than ranking strangers', () => {
  const feed = read('src/pages/Feed.tsx');
  assert.match(feed, /title="Nothing for you yet"/);
  assert.match(feed, /label: 'Back to Following', onClick: \(\) => pickMode\('latest'\)/);
  assert.match(feed, /That’s everything ranked for you\./);
  assert.match(feed, /Your feed is quiet/, 'the Following empty state is unchanged');
});
