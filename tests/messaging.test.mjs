import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

register('./ts-loader.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const chat = await import('../src/lib/chat.ts');
const { linkifySegments, hasLink } = await import('../src/lib/linkify.ts');

const msg = (id, minutesAgo, sender = 'a', extra = {}) => ({
  _id: id,
  createdAt: new Date(Date.UTC(2026, 8, 18, 12, 0, 0) - minutesAgo * 60_000).toISOString(),
  sender: { _id: sender },
  chatRoom: 'room1',
  ...extra,
});

/* ------------------------------------------------------------------ order */

test('the thread reads oldest to newest whatever order the API used', () => {
  // GET /messages/conversation is newest-first (the mobile list is inverted).
  const api = [msg('m4', 0), msg('m3', 1), msg('m2', 60 * 24), msg('m1', 60 * 25)];
  assert.deepEqual(chat.sortMessagesAscending(api).map((m) => m._id), ['m1', 'm2', 'm3', 'm4']);
  // Already ascending input is untouched; equal timestamps stay stable by id.
  const tie = [{ ...msg('b', 5) }, { ...msg('a', 5) }];
  assert.deepEqual(chat.sortMessagesAscending(tie).map((m) => m._id), ['a', 'b']);
  assert.deepEqual(chat.sortMessagesAscending([]), []);
});

test('realtime deliveries merge below history, never duplicate, and respect deletes and rooms', () => {
  const latest = [msg('m2', 10), msg('m1', 20)]; // newest-first as fetched
  const earlier = [msg('m0', 30)];
  const incoming = [
    msg('m3', 0, 'b'), // new for this room
    msg('m2', 10, 'a', { readers: ['stale'] }), // already fetched: fetched copy wins
    msg('x9', 0, 'b', { chatRoom: 'other' }), // another room
    msg('gone', 1, 'b'), // deleted while we looked away
  ];
  const merged = chat.mergeThread({ earlier, latest, incoming, deletedIds: new Set(['gone']), roomId: 'room1' });
  assert.deepEqual(merged.map((m) => m._id), ['m0', 'm1', 'm2', 'm3']);
  assert.equal(merged.find((m) => m._id === 'm2').readers, undefined, 'the fetched copy (no readers) must win over the socket copy');
  // targetId is how the socket names the room for DMs.
  const dm = chat.mergeThread({ latest: [], incoming: [msg('d1', 0, 'b', { chatRoom: undefined, targetId: 'room1' })], roomId: 'room1' });
  assert.deepEqual(dm.map((m) => m._id), ['d1']);
});

test('a draft thread (no room yet) never shows realtime deliveries, whichever room they came from', () => {
  // The page-level buffer holds every socket message since /messages mounted;
  // a draft has no room, so none of them can be its own.
  const stray = msg('x', 0, 'b', { chatRoom: 'other' });
  assert.deepEqual(chat.mergeThread({ latest: [], incoming: [stray], roomId: null }), []);
  assert.deepEqual(chat.mergeThread({ latest: [], incoming: [stray], roomId: undefined }), []);
  assert.deepEqual(chat.mergeThread({ latest: [], incoming: [stray] }), []);
  assert.deepEqual(chat.mergeThread({ latest: [], incoming: [msg('mine', 0, 'me')], roomId: '' }), []);
  // The same buffer feeds the room the draft turns into, filtered by room.
  assert.deepEqual(chat.mergeThread({ latest: [], incoming: [stray, msg('mine', 0, 'me')], roomId: 'room1' }).map((m) => m._id), ['mine']);
});

/* ------------------------------------------------------------------ pages */

const base = Date.UTC(2026, 8, 18, 12, 0, 0);
const numbered = (i) => ({ _id: `m${String(i).padStart(3, '0')}`, createdAt: new Date(base + i * 60_000).toISOString(), sender: { _id: 'a' }, chatRoom: 'r1' });
/** An API page m<from>..m<to>, newest-first as the server sends it, with its cursor. */
const apiPage = (from, to, hasMore = true) =>
  chat.toThreadPage({
    messages: Array.from({ length: to - from + 1 }, (_, k) => numbered(to - k)),
    pagination: { limit: 50, hasMore, nextBefore: hasMore ? numbered(from).createdAt : null, nextBeforeId: hasMore ? numbered(from)._id : null },
  });

test('toThreadPage reads the API page oldest-first and keeps the compound cursor', () => {
  const page = apiPage(50, 99);
  assert.equal(page.messages[0]._id, 'm050');
  assert.equal(page.messages.at(-1)._id, 'm099');
  assert.deepEqual([page.hasMore, page.nextBefore, page.nextBeforeId], [true, numbered(50).createdAt, 'm050']);
  assert.deepEqual(chat.toThreadPage({ messages: [] }), { messages: [], hasMore: false, nextBefore: null, nextBeforeId: null });
});

test('a refetched newest page never drops the message that slid out of its window', () => {
  // Thread m000..m099; the newest page is m050..m099, scroll-up loaded m000..m049.
  let history = chat.absorbNewestPage(chat.EMPTY_HISTORY, apiPage(50, 99));
  assert.equal(history.nextBeforeId, 'm050');
  history = chat.absorbEarlierPage(history, apiPage(0, 49, false));
  assert.equal(history.messages.length, 100);
  assert.equal(history.hasMore, false);

  // Send m100: the newest page is refetched and now reads m051..m100.
  const refetched = apiPage(51, 100);
  history = chat.absorbNewestPage(history, refetched);
  const merged = chat.mergeThread({ earlier: history.messages, latest: refetched.messages, incoming: [numbered(100)], roomId: 'r1' });
  assert.equal(merged.length, 101);
  assert.ok(merged.some((m) => m._id === 'm050'), 'm050 must survive the window sliding forward');
  assert.deepEqual(merged.slice(49, 52).map((m) => m._id), ['m049', 'm050', 'm051']);
  assert.equal(history.hasMore, false, 'the whole thread is held; the cursor does not reopen');
  // Each further send drops nothing either.
  const again = apiPage(52, 101);
  history = chat.absorbNewestPage(history, again);
  assert.equal(chat.mergeThread({ earlier: history.messages, latest: again.messages, roomId: 'r1' }).length, 102);
  // A page that brings nothing new keeps the state's identity (no re-render).
  assert.equal(chat.absorbNewestPage(history, again), history);
});

test('the older cursor is kept while pages overlap, and a page that no longer touches the history replaces it', () => {
  let history = chat.absorbNewestPage(chat.EMPTY_HISTORY, apiPage(50, 99));
  history = chat.absorbEarlierPage(history, apiPage(10, 49)); // still more before m010
  history = chat.absorbNewestPage(history, apiPage(51, 100));
  assert.deepEqual([history.hasMore, history.nextBeforeId], [true, 'm010'], 'scroll-up continues from the oldest message held');
  assert.equal(history.messages.length, 91);

  // 200 messages arrived while the socket was down: the refetched newest page
  // is m250..m299 and nothing bridges it to m100. Rather than render a silent
  // hole, the history restarts at that page and its own cursor.
  const far = apiPage(250, 299);
  const reset = chat.absorbNewestPage(history, far);
  assert.equal(reset, far);
  assert.equal(reset.nextBeforeId, 'm250');
  // Unless that page is the whole thread, in which case nothing is lost.
  const whole = apiPage(0, 30, false);
  assert.equal(chat.absorbNewestPage(chat.absorbNewestPage(chat.EMPTY_HISTORY, apiPage(5, 20)), whole).messages.length, 31);
});

/* ------------------------------------------------------------------ receipts */

test('read receipts patch readers in place and leave untouched lists alone', () => {
  const list = [msg('m1', 5, 'me'), msg('m2', 4, 'me', { readers: ['me'] }), msg('m3', 3, 'peer')];
  const payload = { roomId: 'room1', readBy: 'peer', messagesId: [{ _id: 'm1', readers: ['peer'] }, { _id: 'm2', readers: ['me', 'peer'] }] };
  const next = chat.applyReadReceipts(list, payload);
  assert.notEqual(next, list);
  assert.deepEqual(next[0].readers, ['peer']);
  assert.deepEqual(next[1].readers, ['me', 'peer']);
  assert.equal(next[2], list[2], 'messages not in the payload keep their identity');
  // Idempotent: applying the same receipt again returns the same array.
  assert.equal(chat.applyReadReceipts(next, payload), next);
  // readBy fallback when the server sends ids without readers.
  const fallback = chat.applyReadReceipts(list, { readBy: 'peer', messagesId: [{ _id: 'm1' }] });
  assert.deepEqual(fallback[0].readers, ['peer']);
  assert.equal(chat.applyReadReceipts(list, {}), list);
});

/* ------------------------------------------------------------------ typing */

test('typing state tracks who is typing per room, expires, and reads naturally', () => {
  let s = chat.typingStarted({}, { roomId: 'r1', userId: 'u1', name: 'Maya Kim', at: 1000 });
  s = chat.typingStarted(s, { roomId: 'r1', userId: 'u2', name: 'Jordan', at: 1500 });
  s = chat.typingStarted(s, { roomId: 'r2', userId: 'u3', name: 'Sam', at: 1500 });
  assert.equal(chat.typingLabel(s.r1), 'Maya Kim and Jordan are typing');
  assert.equal(chat.typingLabel(s.r2), 'Sam is typing');
  assert.equal(chat.typingLabel([]), '');
  assert.equal(chat.typingLabel([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'Several people are typing');
  const stopped = chat.typingStopped(s, { roomId: 'r1', userId: 'u1' });
  assert.deepEqual(stopped.r1.map((u) => u.id), ['u2']);
  assert.equal(chat.typingStopped(stopped, { roomId: 'nope', userId: 'u9' }), stopped, 'unknown stop is a no-op');
  const expired = chat.typingExpired(stopped, 1500 + chat.TYPING_TTL_MS + 1);
  assert.deepEqual(expired, {});
  assert.equal(chat.typingExpired(stopped, 1600), stopped, 'nothing expired keeps identity');
});

/* ------------------------------------------------------------------ attachments + consent */

test('GIFs are accepted alongside the other image types and the copy says so', () => {
  assert.equal(chat.ACCEPTED_TYPES['image/gif'], 'image');
  assert.match(chat.ACCEPTED_TYPES_LABEL, /GIF/);
  assert.equal(chat.ACCEPTED_TYPES['video/quicktime'], 'video');
});

test('a consent refusal is recognised, names the peer, and offers the right next step', () => {
  const err = { response: { status: 403, data: { code: 'CHAT_CONSENT_REQUIRED', message: 'Dave Dune only accepts messages from friends and people they follow', user: { _id: 'd', username: 'dave', fullName: 'Dave Dune' } } } };
  assert.equal(chat.isConsentError(err), true);
  assert.equal(chat.consentErrorUser(err).username, 'dave');
  assert.equal(chat.isConsentError({ response: { status: 403, data: { code: 'CHAT_BLOCKED' } } }), false);
  assert.equal(chat.isConsentError(new Error('network')), false);
  assert.deepEqual(chat.consentCopy('Dave Dune', 'none').cta, 'add');
  assert.equal(chat.consentCopy('Dave Dune', 'requested').cta, 'requested');
  assert.equal(chat.consentCopy('Dave Dune', 'incoming').cta, 'accept');
  assert.match(chat.consentCopy('Dave Dune').title, /Dave Dune only accepts messages from friends/);
});

/* ------------------------------------------------------------------ links */

test('URLs in message text become links; app links stay in the app', () => {
  assert.deepEqual(linkifySegments('plain words only'), [{ kind: 'text', text: 'plain words only' }]);
  const segs = linkifySegments('link test https://vybeapp.fit/feed ok, see www.example.com/a?b=1. mail me at a@b.com');
  const links = segs.filter((s) => s.kind === 'link');
  assert.equal(links.length, 2, JSON.stringify(segs));
  assert.deepEqual(links[0], { kind: 'link', text: 'https://vybeapp.fit/feed', href: 'https://vybeapp.fit/feed', internal: '/feed' });
  assert.equal(links[1].href, 'https://www.example.com/a?b=1');
  assert.equal(links[1].internal, null);
  // Trailing punctuation is not part of the link.
  assert.equal(segs.find((s) => s.kind === 'text' && s.text.startsWith('.')).text.slice(0, 1), '.');
  assert.equal(segs.map((s) => s.text).join(''), 'link test https://vybeapp.fit/feed ok, see www.example.com/a?b=1. mail me at a@b.com');
  assert.equal(hasLink('nothing here'), false);
  assert.equal(hasLink('go to vybeapp.fit/live now'), true);
});

/* ------------------------------------------------------------------ source contracts */

test('Messages.tsx renders oldest→newest from the shared helpers and listens for receipts and typing', () => {
  const src = read('src/pages/Messages.tsx');
  assert.match(read('src/lib/chat.ts'), /messages: sortMessagesAscending\(data\.messages \|\| \[\]\)/, 'the newest page must be sorted ascending');
  assert.match(src, /return toThreadPage<ChatMessage>\(data\);/);
  // Every fetched page is folded into `history`, so a refetch can never drop an id.
  assert.match(src, /setHistory\(\(h\) => absorbNewestPage\(h, page\)\)/);
  assert.match(src, /setHistory\(\(h\) => absorbEarlierPage\(h, page\)\)/);
  assert.match(src, /mergeThread\(\{ earlier: history\.messages, latest: thread\.data\?\.messages, incoming, deletedIds/);
  // The draft's consent flags follow the profile fetch, not only the first render.
  assert.match(src, /const blocked = peer\?\.canMessage === undefined \? c\.blocked : peer\.canMessage === false;/);
  for (const event of ['messageRead', 'typing', 'stop_typing']) {
    assert.match(src, new RegExp(`socket\\.on\\('${event}'`), `must listen for ${event}`);
    assert.match(src, new RegExp(`socket\\.off\\('${event}'`), `must remove the ${event} listener`);
  }
  assert.match(src, /socket\.emit\(active \? 'typing' : 'stop_typing', \{ chatRoomId: roomId, isGroup \}\)/);
  assert.match(src, /applyReadReceipts\(page\.messages, payload\)/, 'receipts patch the thread cache');
  // Pagination: newest page with a limit, older pages by cursor, scroll position preserved.
  assert.match(src, /params: \{ \.\.\.conversationParams, limit: PAGE_SIZE \}/);
  assert.match(src, /before: cursor, \.\.\.\(cursorId \? \{ beforeId: cursorId \} : \{\}\)/, 'older pages use the compound (createdAt, id) cursor');
  assert.match(src, /el\.scrollTop = saved\.top \+ \(el\.scrollHeight - saved\.height\)/);
});

test('every Message entry point opens the draft thread with the peer, and /messages?to= still works', () => {
  for (const file of ['src/pages/UserProfile.tsx', 'src/pages/Friends.tsx']) {
    const src = read(file);
    assert.match(src, /to=\{`\/messages\/new\?to=\$\{(?:user|u)\._id\}`\} state=\{\{ peer: (?:user|u) \}\}/, `${file} must link to the draft thread with router state`);
    assert.doesNotMatch(src, /\/messages\?to=/, `${file} must not use the ignored /messages?to= form`);
  }
  const src = read('src/pages/Messages.tsx');
  assert.match(src, /const isDraft = !showRequests && \(roomId === DRAFT_ROOM_ID \|\| \(!roomId && toParam\.length > 0\)\)/);
  assert.match(read('src/components/ui.tsx'), /<Link to=\{to\} state=\{state\} viewTransition aria-label=\{label\}/, 'IconButton links carry router state');
});

test('group conversations offer rename, add people and leave; receivers can delete for themselves', () => {
  const src = read('src/pages/Messages.tsx');
  for (const label of ["label: 'Rename group'", "label: 'Add people'", "label: 'Leave group'", "label: 'Members'", "label: 'Archive conversation'"]) {
    assert.ok(src.includes(label), `menu must offer ${label}`);
  }
  assert.match(src, /api\.patch\(`\/messages\/rooms\/\$\{room\._id\}`, \{ roomName \}\)/);
  assert.match(src, /api\.post\(`\/messages\/rooms\/\$\{roomId\}\/leave`\)/);
  assert.match(src, /function useLeaveRoom/, 'leaving is owned by the page so the thread unmounts before the request settles');
  assert.match(src, /api\.post\(`\/messages\/rooms\/\$\{room\._id\}\/participants`/);
  assert.match(src, /label: mine \? 'Delete' : 'Delete for me'/);
  assert.match(src, /Removes it from your conversation only/);
  // Archive removes the row immediately, rolls back on failure, and lives in
  // the page so its toast/Undo survive the thread unmounting.
  assert.match(src, /function useArchiveRoom/);
  assert.match(src, /qc\.setQueryData<ChatRoom\[\]>\(\['chatRooms'\], \(rooms\) => rooms\?\.filter\(\(r\) => r\._id !== roomId\)\)/);
  assert.match(src, /if \(previous\) qc\.setQueryData\(\['chatRooms'\], previous\)/);
  assert.match(src, /label: 'Undo', onClick: \(\) => undo\(room\)/);
});

test('strangers see the friend-request callout instead of a composer and a dead Retry', () => {
  const src = read('src/pages/Messages.tsx');
  assert.match(src, /function ConsentCallout/);
  assert.match(src, /consentBlocked && peer \? \(\s*<ConsentCallout/);
  assert.match(src, /const final = isConsentError\(e\)/);
  assert.match(src, /\{!item\.final \? \(\s*<button type="button" onClick=\{onRetry\}/, 'no Retry after a consent refusal');
  assert.match(src, /u\.canMessage === false \? \(\s*<span className="shrink-0 text-xs font-medium text-text-3">Friends only<\/span>/);
  assert.match(read('src/pages/PeopleSearch.tsx'), /Friends only/);
});

test('photos open in the in-app lightbox, GIFs are accepted, links are clickable, friends are fresh on open', () => {
  const src = read('src/pages/Messages.tsx');
  assert.match(src, /function MediaLightbox/);
  assert.match(src, /aria-label=\{mine \? 'Open your photo' : 'Open photo'\}/, 'photo trigger labels are preserved');
  assert.doesNotMatch(src, /<a key=\{`\$\{att\.uri\}-\$\{i\}`\} href=\{url\} target="_blank"/, 'photos must not open the raw media URL in a tab');
  assert.match(src, /Open original/);
  assert.match(src, /accept=\{Object\.keys\(ACCEPTED_TYPES\)\.join\(','\)\}/);
  assert.match(src, /<LinkedText text=\{message\.text\}/);
  assert.match(src, /enabled,\s*(?:\/\/[^\n]*\n\s*)*staleTime: 0,\s*queryFn: async \(\) => \{\s*const \{ data \} = await api\.get\('\/friends\/list'\)/);
  assert.match(src, /const friends = useFriendsList\(open\);/, 'enabled-while-open with staleTime 0 fetches once per opening');
  assert.doesNotMatch(src, /void friends\.refetch\(\);\s*\/\/ eslint/, 'no second fetch on open');
  // The inbox People section shares the typeahead query instead of its own.
  assert.match(src, /const people = usePeopleSearch\(search\);/);
  const css = read('src/styles.css');
  assert.match(css, /@keyframes typing-dot/);
  assert.match(css, /\.typing-dot \{ animation: none/);
});

test('the shell keeps the unread badge live on every page and renders the rich thread title', () => {
  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /function useRealtimeSync/);
  for (const event of ['message', 'newMessage', 'newGroupChat', 'chatRoomUpdate', 'messageDeleted', 'messageRead']) {
    assert.match(layout, new RegExp(`socket\\.on\\('${event}'`), `Layout must listen for ${event}`);
  }
  assert.match(layout, /qc\.invalidateQueries\(\{ queryKey: \['unreadChats'\] \}\)/);
  assert.match(layout, /useRealtimeSync\(!!user, user\?\._id\)/);
  assert.match(layout, /\{titleNode \?\? title\}/);
  assert.match(read('src/components/PageChrome.tsx'), /titleNode\?: ReactNode;/, 'PageChrome moved out of ui.tsx (Instagram rebuild, Q0)');
  assert.match(read('src/pages/Messages.tsx'), /usePageChrome\(\{ title, titleNode, back: true, actions, hideBottomNav: true, hideSectionTabs: true \}\)/);
});

test('the people typeahead is shared, debounced, limited, abortable and keyboard-navigable', () => {
  const src = read('src/pages/PeopleSearch.tsx');
  assert.match(src, /PEOPLE_SEARCH_DEBOUNCE_MS = 200/);
  assert.match(src, /PEOPLE_SEARCH_LIMIT = 20/);
  assert.match(src, /api\.get\('\/users\/all\/search', \{ params: \{ q: debounced, limit \}, signal \}\)/);
  assert.match(src, /debounced\.length >= 1/, 'results from the first character');
  assert.match(src, /case 'ArrowDown':/);
  assert.match(src, /aria-label="Clear search"/);
  assert.match(src, /<button\s+type="button"\s+ref=\{buttonRef\}/, 'rows stay buttons so role queries keep working');
  // A button may not contain a button: rows with their own actions render them beside the row button.
  assert.match(src, /\{aside \? <div className="flex shrink-0 items-center gap-1\.5 pr-3">\{trailing\}<\/div> : null\}/);
  assert.match(read('src/pages/Friends.tsx'), /trailingInteractive/, 'the Friends page passes buttons in the trailing slot');
  assert.match(src, /No one matches/);
  // Recents are per signed-in account and never stored for nobody.
  assert.match(src, /RECENT_KEY_PREFIX = 'vybe.recentPeople'/);
  assert.match(src, /return id \? `\$\{RECENT_KEY_PREFIX\}\.\$\{id\}` : null;/);
  assert.match(src, /const listId = useId\(\);/);
  // Group pickers cannot tick someone who only takes messages from friends.
  assert.match(src, /const lockedInMulti = \(u: Person\) => mode === 'multi' && u\.canMessage === false;/);
  assert.match(src, /if \(lockedInMulti\(u\)\) return;/);
  assert.match(src, /aria-disabled=\{locked \|\| undefined\}/);
  for (const [file, needle] of [
    ['src/pages/Messages.tsx', /<PeopleSearch\s+key=\{mode\}/],
    ['src/pages/Friends.tsx', /<PeopleSearch\s+query=\{peopleQuery\}/],
    ['src/pages/Search.tsx', /usePeopleSearch\(term, \{ enabled: liveTyping \}\)/],
  ]) {
    assert.match(read(file), needle, `${file} must use the shared typeahead`);
  }
});

test('the live suites’ labels are intact and the new API routes are pinned', () => {
  const src = read('src/pages/Messages.tsx');
  for (const label of ['aria-label="Write a message"', 'label="Message options"', 'label="Conversation options"', 'placeholder="Search by name or @username"', 'label="Add photo or video"', 'label="Send"', 'label="Search people"', 'New message', 'label="Message"']) {
    assert.ok(src.includes(label), `Messages.tsx must keep ${label}`);
  }
  const snapshot = JSON.parse(read('contracts/backend-routes.json'));
  const pinned = new Set(snapshot.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of [
    'PATCH /api/messages/rooms/:roomId',
    'POST /api/messages/rooms/:roomId/leave',
    'POST /api/messages/rooms/:roomId/participants',
    'GET /api/messages/conversation/:userId',
    'GET /api/users/all/search',
  ]) {
    assert.ok(pinned.has(route), `contracts/backend-routes.json must pin ${route}`);
  }
});
