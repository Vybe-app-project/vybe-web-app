import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const feed = await import('../src/lib/feedLogic.ts');
const stories = await import('../src/lib/storyLogic.ts');

test('feed pages prefer the API cursor and fall back to page numbers', () => {
  assert.equal(feed.nextFeedPageParam({ hasNextPage: true, nextCursor: '2026-09-18T10:00:00.000Z_6aad660a02be1805f4ba5ff4' }, 1), '2026-09-18T10:00:00.000Z_6aad660a02be1805f4ba5ff4');
  assert.equal(feed.nextFeedPageParam({ hasNextPage: true, page: 2 }, 2), 3);
  assert.equal(feed.nextFeedPageParam({ hasNextPage: true }, 4), 5);
  assert.equal(feed.nextFeedPageParam({ hasNextPage: false, nextCursor: 'x' }, 1), undefined);
  assert.equal(feed.nextFeedPageParam(undefined, 1), undefined);
  assert.deepEqual(feed.feedPageParams('abc_def', 10), { before: 'abc_def', limit: 10 });
  assert.deepEqual(feed.feedPageParams(3, 10), { page: 3, limit: 10 });
});

test('a post that arrives twice across shifted pages renders once, in first-seen order', () => {
  const posts = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'b' }, { _id: 'd' }];
  assert.deepEqual(feed.dedupeById(posts).map((p) => p._id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(feed.dedupeById([]), []);
});

test('post bodies tokenize hashtags and http(s) links, leaving sentence punctuation outside the link', () => {
  const tokens = feed.tokenizeContent('Long run done #marathon see https://example.com/plan/week-3). Not a link: example.com');
  assert.deepEqual(tokens.map((t) => t.kind), ['text', 'hashtag', 'text', 'link', 'text']);
  const link = tokens.find((t) => t.kind === 'link');
  assert.equal(link.href, 'https://example.com/plan/week-3');
  assert.equal(link.label, 'example.com/plan/week-3');
  assert.equal(tokens[tokens.length - 1].value, '). Not a link: example.com');
  assert.equal(tokens[1].tag, 'marathon');

  const long = feed.linkLabel('https://www.example.com/a/very/long/path/that/keeps/going/and/going/forever');
  assert.ok(long.length <= feed.LINK_LABEL_MAX);
  assert.ok(long.endsWith('…'));
  assert.equal(feed.linkLabel('http://www.vybeapp.fit/'), 'vybeapp.fit');
  assert.deepEqual(feed.tokenizeContent(''), []);
});

test('the viewer opens on the first unseen story and treats your own stories as seen', () => {
  const me = 'me';
  const list = [
    { _id: '1', hasViewed: true, author: { _id: 'other' } },
    { _id: '2', hasViewed: false, author: { _id: 'other' } },
    { _id: '3', hasViewed: false, author: { _id: 'other' } },
  ];
  assert.equal(stories.firstUnseenIndex(list, me), 1);
  assert.equal(stories.firstUnseenIndex(list.map((s) => ({ ...s, hasViewed: true })), me), 0);
  const own = list.map((s) => ({ ...s, author: { _id: me } }));
  assert.equal(stories.firstUnseenIndex(own, me), 0);
  assert.equal(stories.groupHasUnseen({ author: { _id: me }, stories: own }, me), false);
  assert.equal(stories.groupHasUnseen({ author: { _id: 'other' }, stories: list }, me), true);
});

test('archive membership follows expiry, and the own group is split out of the tray', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  assert.equal(stories.isStoryExpired({ _id: 'a', expiresAt: '2026-09-18T11:59:59Z' }, now), true);
  assert.equal(stories.isStoryExpired({ _id: 'b', expiresAt: '2026-09-19T11:00:00Z' }, now), false);
  assert.equal(stories.isStoryExpired({ _id: 'c', expiresAt: '2026-09-19T11:00:00Z', isActive: false }, now), true);
  assert.equal(stories.isStoryExpired({ _id: 'd' }, now), false);

  const groups = [
    { author: { _id: 'other' }, stories: [] },
    { author: { _id: 'me' }, stories: [] },
  ];
  const split = stories.splitOwnGroup(groups, 'me');
  assert.equal(split.own, groups[1]);
  assert.deepEqual(split.others, [groups[0]]);
  assert.deepEqual(stories.splitOwnGroup(groups, null), { own: null, others: groups });
});

test('story durations stay inside the API window and text looks are well formed', () => {
  assert.equal(stories.clampStoryDuration(2.4), 2);
  assert.equal(stories.clampStoryDuration(0.2), 1);
  assert.equal(stories.clampStoryDuration(500), 60);
  assert.equal(stories.clampStoryDuration('nope'), 15);
  assert.ok(stories.STORY_BACKGROUNDS.length >= 5);
  for (const bg of stories.STORY_BACKGROUNDS) {
    assert.match(bg.backgroundColor, /^#[0-9a-f]{6}$/i);
    assert.match(bg.textColor, /^#[0-9a-f]{6}$/i);
  }
  assert.deepEqual(stories.STORY_FONTS.map((f) => f.id), ['default', 'bold', 'italic', 'handwriting']);
  assert.equal(stories.isStoryFont('bold'), true);
  assert.equal(stories.isStoryFont('comic'), false);
  assert.equal(stories.storyFontStyle('italic').fontStyle, 'italic');
});
