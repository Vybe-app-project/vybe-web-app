/**
 * P8c: For you posts what it showed, and offers Not interested and Snooze.
 * The impression body is the server's shape (`{ items: [{ post, mode, reqId,
 * seenAt }] }`, docs/api-contract.md "Feed controls"), the queue batches and
 * dedupes and stops on a refused surface, the keepalive path names the same
 * literal route, the reason line prints only reasons the ranker has, and the
 * undo row is a fixed-height hairline that never shifts what is on screen.
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

const controls = await import('../src/lib/feedControls.ts');
const impressions = await import('../src/lib/feedImpressions.ts');
const { createImpressionQueue, isSeenEntry, newImpressionSession, SEEN_THRESHOLDS } = impressions;

const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<!-- -->/g, '');
const textOf = (html) => decode(html).replace(/<[^>]+>/g, ' ');

/* ------------------------------------------------------------------ paths */

test('the keepalive sender posts the same literal route as the client, with the bearer built the client’s way', () => {
  const src = read('src/lib/feedControls.ts');
  assert.match(src, /api\.post<\{ accepted: number \}>\('\/feed\/impressions'/, 'the axios path is literal');
  assert.match(src, /fetch\(`\$\{API_BASE\.replace\(\/\\\/\$\/, ''\)\}\/feed\/impressions`, \{\s*method: 'POST',\s*keepalive: true,/, 'the keepalive path is literal and keepalive');
  assert.match(src, /Authorization: `Bearer \$\{token\}`, \.\.\.clientHeaders\(\), 'Content-Type': 'application\/json'/, 'the same headers the interceptor sets');
  assert.match(src, /const token = tokenStore\.get\(\);\s*if \(!token \|\| !items\.length/, 'no session, no request');
  assert.match(src, /items: items\.slice\(0, IMPRESSION_BATCH_MAX\)/);
  // The four controls the card menu uses are the typed fetchers already pinned by tests/feed-modes-contract.
  for (const name of ['markNotInterested', 'undoNotInterested', 'snoozeAuthor', 'unsnoozeAuthor', 'recordImpressions', 'recordImpressionsKeepalive']) {
    assert.equal(typeof controls[name], 'function', `${name} is exported`);
  }
});

test('the client’s flush rules sit under the server’s cap', () => {
  assert.equal(controls.IMPRESSION_BATCH_MAX, 50);
  assert.equal(controls.IMPRESSION_FLUSH_MAX, 20);
  assert.equal(controls.IMPRESSION_FLUSH_MS, 5000);
  assert.equal(controls.IMPRESSION_VISIBLE_RATIO, 0.5);
  assert.equal(controls.IMPRESSION_DWELL_MS, 1000);
  assert.deepEqual([...SEEN_THRESHOLDS], [0, 0.1, 0.25, 0.5]);
});

/* ------------------------------------------------------------------ the queue */

function fakeClock() {
  const timers = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => {
      id += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (handle) => timers.delete(handle),
    fire: () => {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, t] of due) t.fn();
    },
    count: () => timers.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('sightings batch on a timer, in the server’s body shape, and a post id is posted once per session', async () => {
  const sent = [];
  const clock = fakeClock();
  const q = createImpressionQueue({
    send: async (items) => sent.push(items),
    sendKeepalive: () => assert.fail('the timer flush goes through the client'),
    session: newImpressionSession(),
    now: () => new Date('2026-09-21T10:00:00.000Z'),
    ...clock,
  });
  assert.equal(q.add('p1', 'win1'), true);
  assert.equal(q.add('p2', 'win1'), true);
  assert.equal(q.add('p1', 'win1'), false, 'a second sighting of the same post is not queued');
  assert.equal(q.add('p3'), true, 'a post without a window still logs');
  assert.equal(q.pending(), 3);
  assert.equal(sent.length, 0, 'nothing goes before the timer');
  assert.equal(clock.count(), 1, 'one timer for the batch, not one per sighting');
  clock.fire();
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], [
    { post: 'p1', mode: 'foryou', reqId: 'win1', seenAt: '2026-09-21T10:00:00.000Z' },
    { post: 'p2', mode: 'foryou', reqId: 'win1', seenAt: '2026-09-21T10:00:00.000Z' },
    { post: 'p3', mode: 'foryou', seenAt: '2026-09-21T10:00:00.000Z' },
  ]);
  assert.equal(q.pending(), 0);
  assert.equal(q.add('p2'), false, 'sent ids stay deduped for the session');
});

test('twenty sightings flush at once; the mode is always foryou', async () => {
  const sent = [];
  const clock = fakeClock();
  const q = createImpressionQueue({ send: async (items) => sent.push(items), sendKeepalive: () => {}, session: newImpressionSession(), ...clock });
  for (let i = 0; i < 19; i += 1) q.add(`p${i}`, 'w');
  assert.equal(sent.length, 0);
  q.add('p19', 'w');
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 20);
  assert.ok(sent[0].every((item) => item.mode === 'foryou'), 'Latest is never logged');
  assert.equal(clock.count(), 0, 'the pending timer is cleared by the size flush');
});

test('pagehide flushes through the keepalive sender and nothing else', async () => {
  const kept = [];
  const q = createImpressionQueue({
    send: async () => assert.fail('the client POST would be aborted with the page'),
    sendKeepalive: (items) => kept.push(items),
    session: newImpressionSession(),
    ...fakeClock(),
  });
  q.add('p1', 'w');
  q.add('p2', 'w');
  assert.equal(await q.flush({ keepalive: true }), 2);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].map((i) => i.post), ['p1', 'p2']);
  assert.equal(await q.flush({ keepalive: true }), 0, 'an empty queue sends nothing');
});

test('a failed batch is retried once, then dropped in silence', async () => {
  let calls = 0;
  const waits = [];
  const q = createImpressionQueue({
    send: async () => {
      calls += 1;
      throw Object.assign(new Error('boom'), { response: { status: 500, data: {} } });
    },
    sendKeepalive: () => {},
    session: newImpressionSession(),
    wait: async (ms) => waits.push(ms),
    ...fakeClock(),
  });
  q.add('p1');
  assert.equal(await q.flush(), 1);
  assert.equal(calls, 2, 'one attempt and one retry');
  assert.deepEqual(waits, [1500], 'the retry waits, it does not storm');
  assert.equal(q.pending(), 0, 'the dropped batch is not re-queued');
  q.add('p2');
  assert.equal(await q.flush(), 1);
  assert.equal(calls, 4, 'later batches still try');
});

test('404 FEATURE_DISABLED stops posting for the session: no retry, later sightings are ignored', async () => {
  let calls = 0;
  const session = newImpressionSession();
  const q = createImpressionQueue({
    send: async () => {
      calls += 1;
      throw Object.assign(new Error('off'), { response: { status: 404, data: { code: 'FEATURE_DISABLED', message: 'For you is not available for this account yet' } } });
    },
    sendKeepalive: () => assert.fail('nothing goes after the refusal'),
    session,
    wait: async () => assert.fail('a refused surface is not retried'),
    ...fakeClock(),
  });
  q.add('p1');
  await q.flush();
  assert.equal(calls, 1);
  assert.equal(session.disabled, true);
  assert.equal(q.add('p2'), false);
  assert.equal(await q.flush({ keepalive: true }), 0);
  assert.equal(q.pending(), 0);
});

/* ------------------------------------------------------------------ "seen" */

test('seen is half the card on screen, or half the viewport for a card taller than it', () => {
  assert.equal(isSeenEntry({ isIntersecting: true, intersectionRatio: 0.5 }), true);
  assert.equal(isSeenEntry({ isIntersecting: true, intersectionRatio: 0.49, intersectionRect: { height: 300 }, rootBounds: { height: 844 } }), false);
  assert.equal(isSeenEntry({ isIntersecting: false, intersectionRatio: 1 }), false, 'a stale ratio on a card that left does not count');
  // A 2000 px card in an 844 px viewport shows at most 42 % of itself; 500 px of it on screen is more than half the viewport.
  assert.equal(isSeenEntry({ isIntersecting: true, intersectionRatio: 0.25, intersectionRect: { height: 500 }, rootBounds: { height: 844 } }), true);
  assert.equal(isSeenEntry({ isIntersecting: true, intersectionRatio: 0.1, intersectionRect: { height: 200 }, rootBounds: { height: 844 } }), false);
  assert.equal(isSeenEntry({ isIntersecting: true, intersectionRatio: 0.25, intersectionRect: { height: 500 }, rootBounds: null }), false, 'no root bounds, no viewport rule');
});

/* ------------------------------------------------------------------ the reason line */

test('the reason line prints the ranker’s reasons in plain speech, two at most, unknown slugs never', () => {
  const { reasonLine, FEED_REASON_COPY, FEED_REASONS } = controls;
  assert.deepEqual(Object.keys(FEED_REASON_COPY).sort(), [...FEED_REASONS].sort(), 'every reason has words');
  assert.equal(reasonLine(['followed', 'gym']), 'You follow them · Trains at your gym');
  assert.equal(reasonLine(['followed', 'gym', 'popular']), 'You follow them · Trains at your gym', 'two at most');
  assert.equal(reasonLine(['recent']), 'Posted recently');
  assert.equal(reasonLine(['audition']), 'New post, shown to a few people first');
  assert.equal(reasonLine(['made_up', 'crew']), 'From your Crew', 'an unknown slug is skipped, not printed');
  assert.equal(reasonLine(['made_up']), null);
  assert.equal(reasonLine([]), null);
  assert.equal(reasonLine(undefined), null);
  assert.equal(reasonLine(['gym', 'gym']), 'Trains at your gym', 'a repeated slug prints once');
  for (const words of Object.values(FEED_REASON_COPY)) {
    assert.ok(!words.includes('!'), 'no exclamation mark');
    assert.ok(!/'/.test(words), 'curly apostrophes only');
    assert.match(words, /^[A-Z]/, 'sentence case');
  }
});

/* ------------------------------------------------------------------ the row and the sheet */

test('the undo row is a 56 px hairline with one text Undo, and it settles only off screen', async () => {
  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { HiddenPostRow, canSettle, forYouCopy, HIDDEN_ROW_UNDO_MS } = await import('../src/pages/ForYouControls.tsx');
  const noop = () => {};

  const hidden = renderToString(h(HiddenPostRow, { entry: { kind: 'not_interested', postId: 'p1' }, onUndo: noop, onSettle: noop }));
  assert.match(hidden, /data-testid="hidden-post-row"/);
  assert.match(hidden, /role="status"/);
  assert.match(hidden, /class="feed-rule flex h-14 items-center gap-3"/, 'a hairline row of one fixed height: the header row’s 56 px');
  assert.match(textOf(hidden), /Hidden\. You’ll see less like this\./);
  assert.match(hidden, /<button type="button"[^>]*class="[^"]*text-brand-text[^"]*"[^>]*>Undo<\/button>/, 'Undo is text, not a filled button');
  assert.doesNotMatch(hidden, /btn-primary/);

  const snoozed = renderToString(h(HiddenPostRow, { entry: { kind: 'snooze', postId: 'p1', authorId: 'u2', handle: '@maya', days: 7, primary: true }, onUndo: noop, onSettle: noop, undoPending: true }));
  assert.match(textOf(snoozed), /Snoozed @maya for 7 days\./);
  assert.match(snoozed, /<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);

  assert.equal(HIDDEN_ROW_UNDO_MS, 5000);
  assert.equal(canSettle({ top: 900, bottom: 956 }, 844), true, 'a row’s height below the fold: nothing visible moves, nothing rises into view');
  assert.equal(canSettle({ top: 880, bottom: 936 }, 844), false, 'just below the fold the card closing the gap would rise into view');
  assert.equal(canSettle({ top: -100, bottom: -44 }, 844), false, 'above the fold it stays: removing it there is a shift even under scroll anchoring');
  assert.equal(canSettle({ top: 300, bottom: 356 }, 844), false, 'on screen it never vanishes on its own');
  assert.equal(canSettle({ top: -20, bottom: 36 }, 844), false, 'partly visible counts as on screen');

  for (const words of [forYouCopy.hiddenRow, forYouCopy.sheetBody, forYouCopy.notInterestedHint, forYouCopy.snoozeHint, forYouCopy.hideFailed, forYouCopy.undoFailed]) {
    assert.ok(!words.includes('!'), `no exclamation mark: ${words}`);
    assert.ok(!/'/.test(words), `curly apostrophes only: ${words}`);
  }
});

test('the snooze sheet offers exactly the periods the server accepts, as plain buttons', () => {
  const src = read('src/pages/ForYouControls.tsx');
  assert.match(src, /\{SNOOZE_DAYS\.map\(\(days\) => \(/, 'the periods come from the typed constant, not a local list');
  assert.deepEqual([...controls.SNOOZE_DAYS], [7, 30]);
  assert.match(src, /variant="secondary"/);
  assert.doesNotMatch(src, /overflow-anchor|supportsAnchoring/, 'settling never leans on scroll anchoring');
  assert.doesNotMatch(src, /variant="primary"|variant="brand"|btn-primary/, 'Home’s one filled button is not here');
  assert.match(src, /<Modal open=\{!!post\} onClose=\{onClose\} title=\{forYouCopy\.sheetTitle\(handle\)\} description=\{forYouCopy\.sheetBody\} size="sm">/);
  assert.match(src, /snoozeAuthor\(String\(post\.author\?\._id\), days\)/);
  // Snooze applies to every mode; Following and its poll re-read next time.
  assert.match(src, /queryKey: \['feed', 'latest'\]/);
  assert.match(src, /queryKey: \['feed', 'peek'\]/);
  // Optimistic in both directions, with rollback.
  assert.match(src, /onMutate: \(post\) => setHidden\(\(h\) => \(\{ \.\.\.h, \[post\._id\]: \{ kind: 'not_interested', postId: post\._id \} \}\)\)/);
  assert.match(src, /onError: \(e, post\) => \{\s*setHidden\(\(h\) => omit\(h, \[post\._id\]\)\);/);
  assert.match(src, /mutationFn: \(postId: string\) => undoNotInterested\(postId\)/);
  assert.match(src, /unsnoozeAuthor\(entry\.authorId\)/);
  // The pending post leaves the For you cache only when its row settles.
  assert.match(src, /qc\.setQueryData<ForYouCache>\(\['feed', 'foryou'\]/);
});

/* ------------------------------------------------------------------ the card and the page */

test('the card grows the two controls and the reason line only when the feed passes forYou', async () => {
  const card = read('src/pages/PostCard.tsx');
  assert.match(card, /\.\.\.\(forYou && authorId && !isOwn\s*\? \(\[\s*\{\s*label: forYouCopy\.notInterested,/);
  assert.match(card, /label: forYouCopy\.snooze\(handle\),/);
  assert.match(card, /divider: !forYou,/, 'Mute keeps its divider only when the two controls are absent');
  assert.match(card, /<article ref=\{forYou\?\.observe\} aria-label=\{`Post by \$\{name\}`\} className=\{cx\('feed-rule relative pb-3', className\)\}>/);
  assert.match(card, /const why = forYou \? reasonLine\(forYou\.reasons\) : null;/);
  assert.match(card, /\{header\}\s*\{reasonRow\}\s*\{communityLine\}/, 'one meta line under the header');

  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const { ToastProvider } = await import('../src/components/ui.tsx');
  const { default: PostCard } = await import('../src/pages/PostCard.tsx');
  const mount = (ui) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
    // The card's queries schedule TanStack's five-minute GC timers; cleared, so the test process exits when the tests do.
    client.clear();
    return html;
  };
  const post = { _id: 'p1', content: 'Squats and coffee.', medias: [], hashtags: [], likes: [], author: { _id: 'u2', username: 'maya', fullName: 'Maya Kim' }, createdAt: new Date().toISOString() };
  const ranked = decode(mount(h(PostCard, { post, forYou: { reasons: ['followed', 'gym'] } })));
  assert.match(ranked, /data-testid="foryou-reason"/);
  assert.match(ranked, /class="t-meta truncate -mt-2 mb-2"/, 'the reason line is .t-meta');
  assert.match(textOf(ranked), /Why you’re seeing this:\s+You follow them · Trains at your gym/);
  const plain = decode(mount(h(PostCard, { post })));
  assert.doesNotMatch(plain, /foryou-reason/, 'Following draws no reason line');
  const noReason = decode(mount(h(PostCard, { post, forYou: { reasons: [] } })));
  assert.doesNotMatch(noReason, /foryou-reason/, 'no reason, no line — never an invented one');
});

test('Home posts sightings and offers the controls only while the server served For you', () => {
  const feed = read('src/pages/Feed.tsx');
  assert.match(feed, /const forYouActive = forYouOffered && activeMode === 'foryou';/);
  assert.match(feed, /const impressions = useFeedImpressions\(forYouActive\);/);
  assert.match(feed, /const controls = useForYouControls\(\{ active: forYouActive, posts \}\);/);
  assert.match(feed, /forYou=\{\s*forYouActive\s*\? \{/);
  assert.match(feed, /observe: impressions\.refFor\(post\._id, forYouMeta\.reqIds\[post\._id\]\),/, 'the sighting names the ranked window it came from');
  assert.match(feed, /reasons: forYouMeta\.reasons\[post\._id\],/);
  assert.match(feed, /if \(hiddenEntry\.kind === 'snooze' && !hiddenEntry\.primary\) return null;/);
  assert.match(feed, /<HiddenPostRow key=\{post\._id\} entry=\{hiddenEntry\} onUndo=\{controls\.undo\} onSettle=\{controls\.settle\}/);
  assert.match(feed, /className=\{i >= 3 \? 'cv-auto' : undefined\}/, 'the below-the-fold rule survives');
  assert.match(feed, /\{controls\.sheet\}/);
  const hook = read('src/lib/feedImpressions.ts');
  assert.match(hook, /mode: 'foryou'/);
  assert.doesNotMatch(hook, /mode: 'latest'|mode: 'explore'/, 'Home logs For you and nothing else');
  assert.match(hook, /window\.addEventListener\('pagehide', onPageHide\)/);
  assert.match(hook, /if \(document\.visibilityState === 'hidden'\) void q\?\.flush\(\{ keepalive: true \}\)/);
  assert.match(hook, /recordImpressionsKeepalive/);
  // Silent by design: no toast anywhere in the impressions path.
  assert.doesNotMatch(hook, /useToast|toast\./);
});
