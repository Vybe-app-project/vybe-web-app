import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

/**
 * Message requests, shared object cards and link previews: the three
 * flagged surfaces of Messaging v2 (`messageRequests`, `sharedObjectCards`,
 * `linkUnfurl`), all three off on every deployment today.
 *
 * The render half goes through react-dom/server against the real providers.
 * Its limit is the usual one: a zustand store renders from its initial
 * snapshot and the capabilities query never resolves server-side, so every
 * flag reads false here — which is exactly the state the inbox must survive
 * unchanged, and is asserted as such.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const requests = await import('../src/lib/messageRequests.ts');
const cards = await import('../src/lib/sharedCards.ts');
const { AcceptToReplyBanner, MessageRequestsView, RequestsEntryRow } = await import('../src/pages/messages/MessageRequests.tsx');
const { LinkPreviewCard, SharedObjectCard } = await import('../src/pages/messages/SharedObjectCard.tsx');
const { PendingAttachmentChip, SharePicker } = await import('../src/pages/messages/SharePicker.tsx');

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ToastProvider, null, ui))));
}

/* ------------------------------------------------------------------ the row */

test('the Requests row is one entry, bold with a count and plain without one', () => {
  const empty = mount(h(RequestsEntryRow, { total: 0, compact: false }));
  assert.match(empty, /Requests</, 'plain "Requests" with nothing waiting — never "Requests (0)"');
  assert.doesNotMatch(empty, /\(0\)/);
  assert.match(empty, /font-medium/);
  assert.match(empty, /href="\/messages\/requests"/);

  const waiting = mount(h(RequestsEntryRow, { total: 3, compact: false }));
  assert.match(waiting, /Requests \(3\)/);
  assert.match(waiting, /font-semibold/);
  // Instagram shows one count on the fold and nothing beside each thread.
  assert.doesNotMatch(waiting, /count-badge|CountBadge/);
});

test('the label and the hidden fold never print a zero', () => {
  assert.equal(requests.requestsRowLabel(0), 'Requests');
  assert.equal(requests.requestsRowLabel(1), 'Requests (1)');
  assert.equal(requests.requestsRowLabel(12), 'Requests (12)');
  assert.equal(requests.hiddenRequestsLabel(0), null);
  assert.equal(requests.hiddenRequestsLabel(1), '1 hidden request');
  assert.equal(requests.hiddenRequestsLabel(4), '4 hidden requests');
  assert.equal(requests.hiddenRequestsLabel(Number.NaN), null);
});

test('the context line uses the server’s own label, and falls back per kind', () => {
  assert.equal(requests.contextLabel({ kind: 'same_gym', label: 'Iron Works' }), 'Iron Works');
  assert.equal(requests.contextLabel({ kind: 'same_gym', communityName: 'Iron Works' }), 'Iron Works');
  assert.equal(requests.contextLabel({ kind: 'mutual', mutualCount: 3 }), '3 mutual friends');
  assert.equal(requests.contextLabel({ kind: 'mutual', mutualCount: 1 }), '1 mutual friend');
  assert.equal(requests.contextLabel({ kind: 'mutual' }), 'Mutual friends');
  assert.equal(requests.contextLabel({ kind: 'prior_conversation' }), 'You’ve talked before');
  assert.equal(requests.contextLabel({ kind: 'open' }), 'Not connected');
  assert.equal(requests.contextLabel(undefined), null);
});

test('a thread knows it is a pending request from its own participant row, not a flag field', () => {
  assert.equal(requests.isPendingRequestRoom({ me: { status: 'pending' } }), true);
  assert.equal(requests.isPendingRequestRoom({ requestContext: { state: 'pending' } }), true);
  assert.equal(requests.isPendingRequestRoom({ me: { status: 'active' }, requestContext: { state: 'accepted' } }), false);
  assert.equal(requests.isPendingRequestRoom(null), false);
  assert.equal(requests.isPendingRequestRoom({}), false);
});

test('a pending thread gets one line and the same two words, never a composer', () => {
  const html = mount(h(AcceptToReplyBanner, { roomId: 'room1' }));
  assert.match(html, /Accept to reply\./);
  assert.match(html, />Accept</);
  assert.match(html, />Delete</);
  assert.doesNotMatch(html, /aria-label="Write a message"/, 'a reply IS the accept server-side');
  assert.doesNotMatch(html, /btn-primary/, 'the page keeps its one filled blue');
});

test('the requests pane renders with the flag off without throwing or promising anything', () => {
  const html = mount(h(MessageRequestsView, { meId: 'me' }));
  assert.match(html, /People you’re not connected to/);
  assert.doesNotMatch(html, /hidden request/, 'no fold until the API reports one');
});

/* ------------------------------------------------------------------ the cards */

const workoutCard = {
  type: 'workout',
  id: '65b0000000000000000000a1',
  access: 'full',
  deepLink: { app: 'vybe://open?type=workout&id=65b0000000000000000000a1', web: null },
  preview: {
    title: 'Leg day',
    subtitle: 'Ana’s session',
    chips: [
      { label: 'date', value: '2026-09-18' },
      { label: 'duration', value: '48 min' },
      { label: 'exercises', value: '6 exercises' },
    ],
  },
  detail: { exercises: [{ name: 'Squat', sets: 3 }] },
};

test('a shared card is a title, two facts and — where there is a page — a tap-through', () => {
  const html = mount(h(SharedObjectCard, { attachment: workoutCard }));
  assert.match(html, /Leg day/);
  assert.match(html, /2026-09-18 · 48 min/, 'two facts, not three: a third wraps on a 390 px phone');
  assert.doesNotMatch(html, /6 exercises/);
  assert.match(html, /Workout/);
  // A workout log has no standalone web page, so the card reads without a link.
  assert.doesNotMatch(html, /<a /);

  const post = mount(h(SharedObjectCard, { attachment: { ...workoutCard, type: 'post', preview: { title: 'Ana', chips: [] } } }));
  assert.match(post, /href="\/p\/65b0000000000000000000a1"/);
});

test('access is read on every render: preview keeps what was seen, gone says so', () => {
  const preview = mount(h(SharedObjectCard, { attachment: { ...workoutCard, type: 'post', access: 'preview' } }));
  assert.match(preview, /Leg day/, 'what was already seen is not retracted');
  assert.match(preview, /href="\/p\//, 'the tap-through survives; the object itself decides');

  const gone = mount(h(SharedObjectCard, { attachment: { ...workoutCard, access: 'gone', preview: { title: 'Workout', chips: [] } } }));
  assert.match(gone, /no longer available/);
  assert.doesNotMatch(gone, /<a /, 'nothing to open');
});

test('a bare card (the flag is off for this reader) is no card, not an empty one', () => {
  assert.equal(cards.isBareAttachment({ type: 'workout', id: 'x' }), true);
  assert.equal(cards.isBareAttachment(workoutCard), false);
  assert.equal(cards.isBareAttachment(null), false);
  // The bubble drops it rather than drawing a frame around nothing.
  assert.match(read('src/pages/Messages.tsx'), /!isBareAttachment\(message\.attachment\) \? message\.attachment : null/);
});

test('the card readers name the eight kinds, and route only the ones this build has a page for', () => {
  assert.deepEqual([...cards.ATTACHMENT_TYPES], ['post', 'workout', 'routine', 'recap', 'session', 'event', 'challenge', 'gym']);
  assert.equal(cards.isAttachmentType('meal'), false, 'a meal is not an attachment kind on this API');
  assert.deepEqual([...cards.SHAREABLE_FROM_WEB], ['workout', 'routine', 'recap']);

  const at = (type, over = {}) => ({ type, id: 'abc', ...over });
  assert.equal(cards.attachmentHref(at('post')), '/p/abc');
  assert.equal(cards.attachmentHref(at('recap')), '/recaps/abc');
  assert.equal(cards.attachmentHref(at('gym')), '/communities/abc', 'gym carries a GymCommunity id, not a place id');
  assert.equal(cards.attachmentHref(at('session')), '/session/abc');
  assert.equal(cards.attachmentHref(at('routine')), null, 'a private routine has no page');
  assert.equal(cards.attachmentHref(at('routine', { deepLink: { web: 'https://vybeapp.fit/r/abc' } })), '/r/abc');
  assert.equal(cards.attachmentHref(at('workout')), null);
  assert.equal(cards.attachmentHref(at('challenge')), null, 'the challenge hub is a list, not a page per challenge');
  assert.equal(cards.attachmentHref(at('post', { access: 'gone' })), null);

  assert.equal(cards.attachmentTitle(at('workout')), 'Workout', 'never blank');
  assert.deepEqual(cards.attachmentFacts({ ...workoutCard }), ['2026-09-18', '48 min']);
  assert.deepEqual(cards.attachmentFacts({ type: 'gym', id: 'g', preview: { chips: [{ label: 'members', value: '' }] } }), [], 'an empty chip is dropped');
  assert.deepEqual(cards.attachmentBody('workout', 123), { attachment: { type: 'workout', id: '123' } });
});

/* ------------------------------------------------------------------ link previews */

test('only an ok preview with something to say becomes a card, and it is text only', () => {
  const ok = { status: 'ok', url: 'https://www.ogp.me/spec', canonicalUrl: 'https://ogp.me/spec', siteName: 'Open Graph protocol', title: 'The spec', description: 'About it' };
  const html = mount(h(LinkPreviewCard, { preview: ok }));
  assert.match(html, /The spec/);
  assert.match(html, /About it/);
  assert.match(html, /Open Graph protocol/);
  assert.match(html, /href="https:\/\/ogp\.me\/spec"/, 'the canonical URL wins');
  assert.match(html, /rel="noreferrer noopener"/);
  assert.doesNotMatch(html, /<img/, 'text only in this wave (D-117)');

  for (const status of ['pending', 'none', 'blocked', 'error', 'removed', 'skipped', 'vybe']) {
    assert.doesNotMatch(mount(h(LinkPreviewCard, { preview: { status, title: 'x' } })), /rounded-md border border-line bg-surface-1 p-2\.5/, `${status} must draw nothing`);
  }
  assert.equal(cards.hasLinkPreview(null), false);
  assert.equal(cards.hasLinkPreview({ status: 'ok' }), false, 'an ok preview with no words is still nothing to show');
});

test('the host line prefers the site’s own name and strips www', () => {
  assert.equal(cards.linkPreviewHost({ status: 'ok', siteName: 'Strava', url: 'https://www.strava.com/x' }), 'Strava');
  assert.equal(cards.linkPreviewHost({ status: 'ok', url: 'https://www.strava.com/x' }), 'strava.com');
  assert.equal(cards.linkPreviewHost({ status: 'ok', url: 'not a url' }), null);
  assert.equal(cards.linkPreviewHost(null), null);
});

test('a preview event is folded in by id and leaves an untouched list alone', () => {
  const list = [{ _id: 'a' }, { _id: 'b' }];
  const same = cards.applyLinkPreview(list, { messageId: 'zzz', linkPreview: { status: 'ok' } });
  assert.equal(same, list, 'another thread’s event must not cost a render');
  assert.equal(cards.applyLinkPreview(list, { linkPreview: { status: 'ok' } }), list);
  const next = cards.applyLinkPreview(list, { messageId: 'b', linkPreview: { status: 'ok', title: 'T' } });
  assert.notEqual(next, list);
  assert.deepEqual(next[1].linkPreview, { status: 'ok', title: 'T' });
  assert.equal(next[0], list[0], 'the untouched rows keep their identity');
});

/* ------------------------------------------------------------------ the picker */

test('the picker offers the three kinds the API takes from here, and no Meals tab', () => {
  // An open Modal portals into document.body, which the server renderer has
  // none of; the tab labels are pinned at their source and the component is
  // rendered closed, which is the state that would crash if it were going to.
  assert.deepEqual(cards.SHARE_TAB_LABEL, { workout: 'Sessions', routine: 'Routines', recap: 'Recaps' });
  assert.deepEqual(Object.keys(cards.SHARE_TAB_LABEL).sort(), ['recap', 'routine', 'workout']);
  assert.equal(cards.SHARE_TAB_LABEL.meal, undefined, 'a meal is not an attachment kind: the tab would always answer 400');
  assert.doesNotThrow(() => mount(h(SharePicker, { open: false, onClose() {}, onPick() {} })));

  const chip = mount(h(PendingAttachmentChip, { candidate: { type: 'workout', id: 'w1', title: 'Leg day' }, onClear() {} }));
  assert.match(chip, /Leg day/);
  assert.match(chip, /Sessions/);
  assert.match(chip, /aria-label="Remove attachment"/);
});

test('the picker reads the two collections the two words mean, not one of them twice', () => {
  const src = read('src/pages/messages/SharePicker.tsx');
  // `workout` is a WorkoutLog (GET /workouts/logs); `routine` is a
  // SocialWorkout (GET /workouts/my). Crossing them is a 404.
  assert.match(src, /fetchLogs/);
  assert.match(src, /fetchMyWorkoutsPage\(1\)/);
  assert.match(src, /type: 'workout',\s*\n\s*id: log\._id/);
  assert.match(src, /type: 'routine',\s*\n\s*id: workout\._id/);
  assert.match(src, /api\.get<\{ recaps\?: RecapListRow\[\] \}>\('\/recaps'/);
});

/* ------------------------------------------------------------------ contracts */

test('every request, card and link-preview path is literal and pinned against the snapshot', () => {
  const requestsSrc = read('src/lib/messageRequests.ts');
  for (const literal of [
    "'/messages/requests'",
    '`/messages/requests/${roomId}/accept`',
    '`/messages/requests/${roomId}/delete`',
    '`/messages/requests/${roomId}/block`',
  ]) {
    assert.ok(requestsSrc.includes(literal), `src/lib/messageRequests.ts must call ${literal}`);
  }

  const cardsSrc = read('src/lib/sharedCards.ts');
  for (const literal of [
    '`/messages/${messageId}/attachment`',
    '`/messages/${messageId}/link-preview`',
    '`/messages/${messageId}/link-preview/show`',
  ]) {
    assert.ok(cardsSrc.includes(literal), `src/lib/sharedCards.ts must call ${literal}`);
  }
  assert.match(read('src/pages/Messages.tsx'), /api\.post\('\/messages\/send', payload\)/, 'the card rides on the existing send');

  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'GET /api/messages/requests',
    'POST /api/messages/requests/:roomId/accept',
    'POST /api/messages/requests/:roomId/delete',
    'POST /api/messages/requests/:roomId/block',
    'GET /api/messages/:messageId/attachment',
    'DELETE /api/messages/:messageId/link-preview',
    'POST /api/messages/:messageId/link-preview/show',
    'POST /api/messages/send',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});

test('all three surfaces are gated on the flag AND on the 404 the API answers while it is off', () => {
  const disabled = { response: { status: 404, data: { code: 'FEATURE_DISABLED', feature: 'messageRequests' } } };
  assert.equal(requests.isFeatureDisabled(disabled), true);
  assert.equal(requests.disabledFeatureOf(disabled), 'messageRequests');
  assert.equal(cards.isFeatureDisabled(disabled), true);
  // The link-preview router answers without a `feature` key; the code is all there is to read.
  assert.equal(cards.disabledFeatureOf({ response: { status: 404, data: { code: 'FEATURE_DISABLED' } } }), null);
  assert.equal(requests.isFeatureDisabled({ response: { status: 404, data: { message: 'Chat room not found' } } }), false);

  assert.equal(requests.MESSAGE_REQUESTS_FLAG, 'messageRequests');
  assert.equal(cards.SHARED_OBJECT_CARDS_FLAG, 'sharedObjectCards');
  assert.equal(cards.LINK_UNFURL_FLAG, 'linkUnfurl');
  assert.equal(cards.LINK_PREVIEW_EVENT, 'messageLinkPreview');

  const src = read('src/pages/messages/MessageRequests.tsx');
  assert.match(src, /useFeature\(MESSAGE_REQUESTS_FLAG\)/);
  assert.match(src, /enabled: enabled && flagOn/, 'nothing is fetched on a deployment without the feature');
  assert.match(read('src/lib/messageRequests.ts'), /if \(isFeatureDisabled\(e\)\) return EMPTY_REQUESTS;/);

  const messages = read('src/pages/Messages.tsx');
  assert.match(messages, /const cardsOn = useFeature\(SHARED_OBJECT_CARDS_FLAG\)/);
  assert.match(messages, /onPickAttachment=\{cardsOn \? \(\) => setSharePicker\(true\) : undefined\}/, 'no share control while the flag is off');
  assert.match(messages, /requests\.flagOn && requests\.allowRequests && !q/, 'no Requests row while the flag is off');
});

test('the request actions are silent where the API is silent, and the pane is routed', () => {
  assert.equal(requests.isRequestGone({ response: { status: 409, data: { code: 'REQUEST_NOT_PENDING' } } }), true);
  assert.equal(requests.isRequestGone({ response: { status: 404, data: { code: 'ROOM_UNAVAILABLE' } } }), true);
  assert.equal(requests.isRequestGone({ response: { status: 403, data: { code: 'NOT_RECIPIENT' } } }), false);
  assert.equal(
    requests.requestErrorCopy({ response: { status: 403, data: { code: 'NOT_RECIPIENT', message: 'Only the person who received this request can act on it.' } } }),
    'Only the person who received this request can act on it.',
  );

  const app = read('src/App.tsx');
  assert.match(app, /path="messages\/requests" element=\{<Messages \/>\}/);
  // A static segment outranks :roomId, but the word must never reach the API as a room id either way.
  const messages = read('src/pages/Messages.tsx');
  assert.match(messages, /const showRequests = roomId === 'requests' \|\| location\.pathname === '\/messages\/requests';/);
  assert.match(messages, /const lookupEnabled = Boolean\(roomId && !isDraft && !showRequests/);
  assert.match(messages, /pendingRequest && room \? \(/);
});

test('a link preview is patched in from the socket and never fetched by the client', () => {
  const messages = read('src/pages/Messages.tsx');
  assert.match(messages, /socket\.on\(LINK_PREVIEW_EVENT, onLinkPreview\)/);
  assert.match(messages, /socket\.off\(LINK_PREVIEW_EVENT, onLinkPreview\)/);
  assert.match(messages, /applyLinkPreview\(page\.messages, payload\)/, 'every cached page');
  assert.match(messages, /setLive\(\(prev\) => applyLinkPreview\(prev, payload\)\)/, 'the realtime buffer');
  assert.match(messages, /applyLinkPreview\(h\.messages, preview\.payload\)/, 'the thread’s own older history');
  // Nothing in this family fetches a URL.
  const card = read('src/pages/messages/SharedObjectCard.tsx');
  assert.doesNotMatch(card, /fetch\(|api\.get/);
});
