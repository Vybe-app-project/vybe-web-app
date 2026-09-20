/**
 * The Together-session landing (/session/:id, /session/invite/:token): the
 * id-or-token dispatch, the state copy table, the API's viewer-reason
 * sentences, the action truth table, the shareLinks 'session' type, the
 * route and page source pins, and a server render of the landing body.
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
const lib = await import('../src/lib/sessionInvite.ts');
const share = await import('../src/lib/shareLinks.ts');

/* ------------------------------------------------------------------ fixtures */

const ID = '6aad635402be1805f4b9ef72';
const TOKEN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
const HOST = { _id: '6aad635402be1805f4b9ef01', username: 'sam', fullName: 'Sam Rivera' };
const ME = { _id: '6aad635402be1805f4b9ef02', username: 'me' };
const OTHER = { _id: '6aad635402be1805f4b9ef03', username: 'jo', fullName: 'Jo Park' };
const T0 = '2026-09-25T18:00:00.000Z';
const NOW = new Date('2026-09-25T18:05:00.000Z');

const participant = (user, role = 'participant', extra = {}) => ({
  user, role, joinedAt: T0, leftAt: null, shareProgress: true, ...extra,
});

const lobby = {
  _id: ID,
  title: 'Push day',
  host: HOST,
  createdBy: HOST._id,
  program: { kind: 'workout', workoutId: '6aad635402be1805f4b9ef99' },
  snapshot: { title: 'Push day', category: 'strength', plannedMinutes: 45, exercises: [{ name: 'Bench press', sets: 4 }, { name: 'Dips', sets: 3 }] },
  status: 'lobby',
  scheduledAt: T0,
  startedAt: null,
  endedAt: null,
  maximumEndsAt: null,
  lateJoinUntil: null,
  endReason: null,
  cancelReason: '',
  visibility: 'followers',
  communityId: null,
  capacity: 8,
  participantCount: 2,
  spotsLeft: 6,
  isFull: false,
  participants: [participant(HOST, 'host'), participant(OTHER)],
  chatRoomId: null,
  reminderSentAt: null,
  summary: null,
  createdAt: T0,
  updatedAt: T0,
};
const scheduled = { ...lobby, status: 'scheduled', scheduledAt: '2026-09-26T09:30:00.000Z' };
const live = { ...lobby, status: 'live', startedAt: T0, lateJoinUntil: '2026-09-25T18:15:00.000Z', maximumEndsAt: '2026-09-25T21:00:00.000Z' };
const ended = { ...lobby, status: 'ended', startedAt: T0, endedAt: '2026-09-25T18:50:00.000Z', endReason: 'host', summary: { durationSec: 3000, participantCount: 2, completedCount: 2, highFives: 3 } };
const cancelled = { ...lobby, status: 'cancelled', endedAt: T0, endReason: 'cancelled', cancelReason: 'Gym closed tonight' };
const closedEmpty = { ...lobby, status: 'cancelled', endedAt: T0, endReason: 'empty', participants: [], participantCount: 0, spotsLeft: 8 };

const outsider = { joined: false, isHost: false, shareProgress: true, canJoin: true };
const joined = { joined: true, isHost: false, shareProgress: true, canJoin: true };
const host = { joined: true, isHost: true, shareProgress: true, canJoin: true };
const full = { joined: false, isHost: false, shareProgress: true, canJoin: false, reason: 'full' };
const late = { joined: false, isHost: false, shareProgress: true, canJoin: false, reason: 'late' };
const removed = { joined: false, isHost: false, shareProgress: true, canJoin: false, reason: 'removed' };
const UTC = { timeZone: 'UTC', now: NOW };

/* ------------------------------------------------------------------ pure rules */

test('the route param dispatches by shape: 24-hex id, 64 lowercase hex token, anything else invalid', () => {
  assert.deepEqual(lib.sessionLookup(ID), { kind: 'id', value: ID });
  assert.deepEqual(lib.sessionLookup(ID.toUpperCase()), { kind: 'id', value: ID.toUpperCase() });
  assert.deepEqual(lib.sessionLookup(TOKEN), { kind: 'token', value: TOKEN });
  assert.equal(lib.sessionLookup(TOKEN.toUpperCase()).kind, 'invalid', 'the API hashes uppercase tokens to null');
  for (const bad of ['invite', '', undefined, null, `${ID}x`, TOKEN.slice(1)]) assert.equal(lib.sessionLookup(bad).kind, 'invalid', `invalid: ${bad}`);
  assert.equal(lib.SESSION_ID.source, '^[a-f0-9]{24}$');
  assert.equal(lib.INVITE_TOKEN.source, '^[a-f0-9]{64}$');
  assert.equal(lib.INVITE_TOKEN.flags.includes('i'), false);
});

test('the state block copy follows the status table, in the given zone', () => {
  const sched = lib.sessionStateCopy(scheduled, outsider, UTC);
  assert.equal(sched.title, 'Starts Sep 26, 2026, 09:30 UTC');
  assert.ok(sched.body.includes('The room opens 10 minutes before the start.'));

  assert.deepEqual(lib.sessionStateCopy(lobby, outsider, UTC), { title: 'Starting soon', body: 'Waiting for Sam Rivera to start.', tone: 'info' });
  assert.equal(lib.sessionStateCopy(lobby, host, UTC).body, 'Start it from the Vybe app.');

  const liveOut = lib.sessionStateCopy(live, outsider, UTC);
  assert.equal(liveOut.title, 'Live now');
  assert.ok(liveOut.body.includes('Started Sep 25, 2026, 18:00 UTC.'));
  assert.ok(liveOut.body.includes('You can join until Sep 25, 2026, 18:15 UTC.'));
  assert.ok(!lib.sessionStateCopy(live, joined, UTC).body.includes('You can join until'), 'a member is already in');
  assert.ok(!lib.sessionStateCopy(live, outsider, { ...UTC, now: new Date('2026-09-25T18:20:00.000Z') }).body.includes('You can join until'), 'late-join window over');

  assert.deepEqual(lib.sessionStateCopy(ended, outsider, UTC), { title: 'This session has ended.', body: 'The summary is in the Vybe app.', tone: 'neutral' });

  const canc = lib.sessionStateCopy(cancelled, outsider, UTC);
  assert.equal(canc.title, 'Sam Rivera cancelled this session.');
  assert.equal(canc.body, 'Gym closed tonight');
  assert.equal(lib.sessionStateCopy({ ...cancelled, cancelReason: '' }, outsider, UTC).body, null);

  const empty = lib.sessionStateCopy(closedEmpty, outsider, UTC);
  assert.equal(empty.title, 'This session closed before it started.');
  assert.equal(empty.body, 'Everyone left before the start.');

  // A moderation removal writes status cancelled with a fixed reason; the host did not cancel that one.
  assert.equal(lib.sessionStateCopy({ ...cancelled, cancelReason: 'Removed by moderation' }, outsider, UTC).title, 'This session was removed.');

  // Host name falls back to the username, then to "someone".
  assert.equal(lib.sessionStateCopy({ ...lobby, host: { _id: HOST._id, username: 'sam' } }, outsider, UTC).body, 'Waiting for sam to start.');
  assert.equal(lib.sessionStateCopy({ ...lobby, host: { _id: HOST._id } }, outsider, UTC).body, 'Waiting for someone to start.');
  assert.equal(lib.hostName(lobby), 'Sam Rivera');
  assert.equal(lib.programTitle({ title: 'Fallback', snapshot: { title: '' } }), 'Fallback');
  assert.equal(lib.formatSessionTime(null), '—');
});

test('the viewer-reason sentences are the API’s, word for word, and never say blocked', () => {
  const expected = {
    full: 'This session is full.',
    ended: 'This session has ended.',
    cancelled: 'Sam Rivera cancelled this session.',
    late: 'This session started more than 15 minutes ago. You can still open the program on your own.',
    removed: 'The host removed you from this session. You can still finish your workout.',
    not_invited: 'This session is invite-only. Ask the host for a link.',
    unavailable: 'This session isn’t available.',
  };
  for (const [reason, sentence] of Object.entries(expected)) {
    const copy = lib.viewerReasonCopy(reason, 'Sam Rivera');
    assert.equal(copy, sentence);
    assert.doesNotMatch(copy, /block/i);
    assert.doesNotMatch(copy, /!/);
  }
  assert.equal(lib.viewerReasonCopy('cancelled'), 'The host cancelled this session.', 'the API sentence when the name is unknown');
  // Under the state block the ended and cancelled reasons would repeat the headline.
  assert.equal(lib.viewerReasonLine({ reason: 'ended' }, 'Sam'), null);
  assert.equal(lib.viewerReasonLine({ reason: 'cancelled' }, 'Sam'), null);
  assert.equal(lib.viewerReasonLine({ reason: 'full' }, 'Sam'), 'This session is full.');
  assert.equal(lib.viewerReasonLine({}, 'Sam'), null);
  const source = read('src/lib/sessionInvite.ts') + read('src/pages/SessionInvite.tsx');
  assert.doesNotMatch(source, /blocked/i, 'never the word "blocked"');
});

test('the action table offers only what the API allows the viewer, and never Start or End', () => {
  const pick = (actions) => Object.entries(actions).filter(([, on]) => on).map(([key]) => key).sort();
  assert.deepEqual(pick(lib.sessionActions(lobby, outsider)), ['join', 'openInApp']);
  assert.deepEqual(pick(lib.sessionActions(live, joined)), ['leave', 'openInApp']);
  assert.deepEqual(pick(lib.sessionActions(scheduled, host)), ['cancel', 'leave', 'openInApp']);
  assert.deepEqual(pick(lib.sessionActions(lobby, host)), ['cancel', 'leave', 'openInApp']);
  assert.deepEqual(pick(lib.sessionActions(live, host)), ['leave', 'openInApp']);
  assert.deepEqual(pick(lib.sessionActions(ended, outsider)), ['openInApp']);
  assert.deepEqual(pick(lib.sessionActions(ended, { ...joined, canJoin: false, reason: 'ended' })), ['openInApp']);
  assert.deepEqual(pick(lib.sessionActions(cancelled, host)), ['openInApp']);
  assert.deepEqual(pick(lib.sessionActions(lobby, full)), ['openInApp']);
  assert.deepEqual(pick(lib.sessionActions(live, late)), ['openInApp', 'openProgram']);
  assert.deepEqual(pick(lib.sessionActions(lobby, removed)), ['openInApp']);
  assert.equal('start' in lib.sessionActions(lobby, host), false);
  assert.equal('end' in lib.sessionActions(live, host), false);
});

test('join refusal codes map to the viewer reasons the page already knows how to say', () => {
  const codes = {
    SESSION_FULL: 'full', SESSION_ENDED: 'ended', SESSION_CANCELLED: 'cancelled', SESSION_LATE: 'late',
    SESSION_REMOVED: 'removed', SESSION_NOT_INVITED: 'not_invited', SESSION_UNAVAILABLE: 'unavailable',
  };
  for (const [code, reason] of Object.entries(codes)) assert.equal(lib.viewerReasonFromCode(code), reason);
  for (const other of ['RATE_LIMITED', 'SESSIONS_DISABLED', 'SESSION_HOST_ONLY', 'SESSION_STATE', null, undefined, '']) {
    assert.equal(lib.viewerReasonFromCode(other), null, `no reason for ${other}`);
  }
});

test('the lines: counts, visibility, program, empty people, leave confirmation', () => {
  assert.equal(lib.countLine(lobby), '2 of 8 in · 6 spots left');
  assert.equal(lib.countLine({ ...lobby, participantCount: 7, spotsLeft: 1 }), '7 of 8 in · 1 spot left');
  assert.equal(lib.countLine({ ...lobby, participantCount: 8, spotsLeft: 0, isFull: true }), '8 of 8 in · Full');
  assert.equal(lib.visibilityLine(lobby), 'Sam Rivera’s followers');
  assert.equal(lib.visibilityLine({ ...lobby, visibility: 'invite' }), 'Invite only');
  assert.equal(lib.visibilityLine({ ...lobby, visibility: 'gym', community: { _id: 'c', name: 'Iron Works' } }), 'Iron Works members');
  assert.equal(lib.visibilityLine({ ...lobby, visibility: 'gym' }), 'Gym members');
  assert.equal(lib.programLine(lobby), '2 exercises · 45 min');
  assert.equal(lib.programLine({ snapshot: { ...lobby.snapshot, plannedMinutes: 0, exercises: [{ name: 'Row', sets: 3 }] } }), '1 exercise');
  assert.equal(lib.emptyPeopleLine({ ...lobby, participants: [participant(HOST, 'host')] }, host), 'Just you so far');
  assert.equal(lib.emptyPeopleLine({ ...lobby, participants: [participant(HOST, 'host')] }, outsider), 'Sam Rivera is the only one in so far.');
  assert.equal(lib.emptyPeopleLine(lobby, outsider), null);
  assert.equal(lib.emptyPeopleLine({ ...lobby, participants: [] }, removed), null, 'a removed viewer sees no room');
  // A member who left is not in the room; the redaction keeps the counts only.
  assert.equal(lib.activeParticipants({ participants: [participant(HOST, 'host'), participant(OTHER, 'participant', { leftAt: T0 })] }).length, 1);
  assert.equal(lib.leaveConfirmMessage(joined, 2), 'Leave this session? You can rejoin while there is room.');
  assert.equal(lib.leaveConfirmMessage(host, 3), 'Leave this session? You can rejoin while there is room. Hosting passes to the next person.');
  assert.equal(lib.leaveConfirmMessage(host, 1), 'Leave this session? You can rejoin while there is room. You are the last one in, so the session closes.');
  assert.equal(lib.programPath(lobby), '/workouts/6aad635402be1805f4b9ef99');
  assert.equal(lib.sessionDeepLink(ID), `vybe://open?type=session&id=${ID}`);
  assert.equal(lib.sessionDeepLink(TOKEN), `vybe://open?type=session&id=${TOKEN}`);
  for (const copy of [lib.SESSIONS_OFF_TITLE, lib.SESSIONS_OFF_BODY, lib.ROLLOUT_NOTE, lib.ROOM_NOTE, lib.INVALID_LINK_BODY, lib.UNAVAILABLE_BODY, lib.SIGNED_OUT_SUBTITLE]) {
    assert.doesNotMatch(copy, /!/, 'no exclamation marks');
  }
  assert.match(lib.UNAVAILABLE_BODY, /cancelled/, 'a token link to a cancelled session is a 404, so the copy says so');
});

test('shareLinks knows the session type: /open.html?type=session lands here and the deep link type-checks', () => {
  assert.ok(share.SHARE_TYPES.includes('session'));
  assert.equal(share.SHARE_LABEL.session, 'session');
  assert.equal(share.shareDestination('session', TOKEN), `/session/${TOKEN}`);
  assert.equal(share.shareDestination('session', ID), `/session/${ID}`);
  assert.equal(share.shareDestination('session', '../x'), null);
  assert.equal(share.appDeepLink('session', ID), `vybe://open?type=session&id=${ID}`);
});

/* ------------------------------------------------------------------ source pins */

test('the SPA routes both session paths outside RequireAuth, through the lazy page, with no nav entry', () => {
  const app = read('src/App.tsx');
  const guarded = app.indexOf('element={<RequireAuth>');
  assert.ok(guarded > 0);
  for (const route of ['/session/:id', '/session/invite/:token']) {
    const match = app.match(new RegExp(`path="${route.replace(/[/:]/g, '\\$&')}"`));
    assert.ok(match, `${route} must be routed`);
    assert.ok(match.index < guarded, `${route} must be public (declared before RequireAuth)`);
  }
  assert.match(app, /import\('\.\/pages\/SessionInvite'\)/);
  assert.ok(fs.existsSync(path.join(root, 'src/pages/SessionInvite.tsx')));
  assert.doesNotMatch(read('src/components/Layout.tsx'), /'\/session/, 'sessions are reached by link, not from the nav');
});

test('the page calls exactly the session routes it may, keeps the return target on sign-in, and has no live client', () => {
  const page = read('src/pages/SessionInvite.tsx');
  assert.ok(page.includes('api.get(`/sessions/invite/${'), 'token lookup');
  assert.ok(page.includes('api.get(`/sessions/${'), 'id lookup');
  assert.ok(page.includes('/join`'));
  assert.ok(page.includes('/leave`'));
  assert.ok(page.includes('/cancel`'));
  assert.doesNotMatch(page, /\/start`|\/end`|\/sessions\/\$\{[^}]+\}\/(start|end)\b/, 'never Start or End from the web');
  // Capabilities are read through the shared hook (tests/client-policy.test.mjs allows useCapabilities in three files only).
  assert.match(page, /useSessionsAccess\(/);
  assert.doesNotMatch(page, /useCapabilities/);
  const caps = read('src/lib/capabilities.ts');
  assert.match(caps, /export function useSessionsAccess\(/);
  assert.match(caps, /capabilities\.sessions !== false/, 'the kill switch, unknown counts as on');
  assert.match(caps, /featureEnabled\(data\.features, 'sessions'\)/, 'the rollout flag only adds a note');
  assert.match(page, /sessionDeepLink\(/);
  assert.match(page, /inviteToken/);
  assert.match(page, /SESSIONS_DISABLED/, 'a 503 from join or cancel flips to the off state');
  assert.match(page, /to="\/login"/);
  assert.match(page, /state=\{from\}|state=\{\{ from: location \}\}/);
  assert.match(page, /const from = \{ from: location \}/);
  assert.doesNotMatch(page, /lib\/socket/, 'the web has no session client');
  assert.match(page, /data-testid="session-(state|join|leave|cancel|open-app|participants)"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /refetchInterval/);
});

/* ------------------------------------------------------------------ render */

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const { ToastProvider } = await import('../src/components/ui.tsx');
const { SessionInviteBody, SessionLanding } = await import('../src/pages/SessionInvite.tsx');

const mount = (ui, entries = ['/session/' + ID]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: entries }, h(ToastProvider, null, ui))));
};
const noop = () => {};
const body = (session, viewer, extra = {}) =>
  mount(h(SessionInviteBody, { session, viewer, meId: ME._id, busy: null, rolloutOff: false, onJoin: noop, onLeave: noop, onCancel: noop, timeZone: 'UTC', ...extra }));

test('the lobby landing for an outsider: host, waiting copy, Join, people, counts, program, deep link, room note', () => {
  const html = body(lobby, outsider);
  for (const text of [
    'Sam Rivera', 'Waiting for Sam Rivera to start.', 'aria-label="Join Push day"', 'data-testid="session-join"', 'Jo Park',
    '2 of 8 in', '6 spots left', 'Bench press', 'Dips', `href="vybe://open?type=session&amp;id=${ID}"`, 'Open in the Vybe app',
    lib.ROOM_NOTE, 'Share my progress', 'data-testid="session-participants"', 'aria-label="People"', 'aria-label="Program"',
    'Sam Rivera’s followers', 'data-testid="session-state"', 'aria-live="polite"', 'Sep 25, 2026, 18:00 UTC',
  ]) {
    assert.ok(html.includes(text), `landing shows ${text}`);
  }
  assert.ok(!html.includes('data-testid="session-leave"'));
  assert.ok(!html.includes('data-testid="session-cancel"'));
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  assert.ok(!html.includes('Training together is still rolling out'), 'no rollout note when the flag is on');
  assert.ok(!html.includes('aria-label="online"') && !html.includes('aria-label="offline"'), 'no presence dot without a boolean');
});

test('the host in a scheduled session gets Cancel and Leave, never Join; a member gets Leave; presence dots need a boolean', () => {
  const html = body(scheduled, host);
  assert.ok(html.includes('data-testid="session-cancel"'));
  assert.ok(html.includes('data-testid="session-leave"'));
  assert.ok(html.includes('aria-label="Cancel Push day"'));
  assert.ok(!html.includes('data-testid="session-join"'));
  assert.ok(html.includes('Starts Sep 26, 2026, 09:30 UTC'));
  assert.ok(html.includes('The room opens 10 minutes before the start.'));

  const asMember = body({ ...live, participants: [participant(HOST, 'host', { online: true }), participant(ME, 'participant', { online: false })] }, joined);
  assert.ok(asMember.includes('data-testid="session-leave"'));
  assert.ok(!asMember.includes('data-testid="session-join"'));
  assert.ok(asMember.includes('>You<'), 'the signed-in member is marked');
  assert.ok(asMember.includes('aria-label="online"') && asMember.includes('aria-label="offline"'));
  assert.ok(asMember.includes('Live now'));
});

test('ended and cancelled sessions offer only the app; a late viewer gets the program link', () => {
  const done = body(ended, { ...outsider, canJoin: false, reason: 'ended' });
  assert.ok(done.includes('This session has ended.'));
  assert.ok(done.includes('The summary is in the Vybe app.'));
  assert.ok(!done.includes('data-testid="session-join"'));
  assert.ok(done.includes('data-testid="session-open-app"'));
  assert.equal((done.match(/This session has ended\./g) || []).length, 1, 'the reason does not repeat the headline');

  const canc = body(cancelled, { ...outsider, canJoin: false, reason: 'cancelled' });
  assert.ok(canc.includes('Sam Rivera cancelled this session.'));
  assert.ok(canc.includes('Gym closed tonight'));
  assert.ok(!canc.includes('data-testid="session-join"') && !canc.includes('data-testid="session-cancel"'));

  const tooLate = body(live, late);
  assert.ok(tooLate.includes('This session started more than 15 minutes ago. You can still open the program on your own.'));
  assert.ok(tooLate.includes('href="/workouts/6aad635402be1805f4b9ef99"'));
  assert.ok(tooLate.includes('Open the program'));
  assert.ok(!tooLate.includes('data-testid="session-join"'));

  const isFull = body({ ...lobby, participantCount: 8, spotsLeft: 0, isFull: true }, full);
  assert.ok(isFull.includes('This session is full.'));
  assert.ok(isFull.includes('8 of 8 in'));
  assert.ok(!isFull.includes('data-testid="session-join"'));
});

test('a removed viewer sees the statement and the counts, never the room or the lone-host copy', () => {
  const html = body({ ...lobby, participants: [], chatRoomId: null, summary: null }, removed);
  assert.ok(html.includes('The host removed you from this session. You can still finish your workout.'));
  assert.ok(html.includes('2 of 8 in'));
  assert.ok(!html.includes('Jo Park'));
  assert.ok(!html.includes('Just you so far'));
  assert.ok(!html.includes('data-testid="session-participants"'));
  assert.ok(!html.includes('data-testid="session-join"'));
});

test('the rollout callout appears only when features.sessions is off; the lone host reads Just you so far', () => {
  const alone = { ...lobby, participants: [participant(HOST, 'host')], participantCount: 1, spotsLeft: 7 };
  assert.ok(body(alone, host, { rolloutOff: true }).includes(lib.ROLLOUT_NOTE));
  assert.ok(!body(alone, host, { rolloutOff: false }).includes(lib.ROLLOUT_NOTE));
  assert.ok(body(alone, host, { meId: HOST._id }).includes('Just you so far'));
  assert.ok(body(alone, outsider).includes('Sam Rivera is the only one in so far.'));
  assert.ok(body(alone, host).includes('Start it from the Vybe app.'));
});

test('the signed-out landing keeps the return target on Log in and offers the app the raw token', () => {
  const html = mount(h(Routes, null, h(Route, { path: '/session/:id', element: h(SessionLanding) })), [`/session/${TOKEN}`]);
  assert.ok(html.includes('Train together on Vybe'));
  assert.ok(html.includes('href="/login"'));
  assert.ok(html.includes('Log in to see this session'));
  assert.ok(html.includes(`href="vybe://open?type=session&amp;id=${TOKEN}"`));
  assert.ok(html.includes('href="/register"'));
  assert.ok(html.includes('Join Vybe'));
  assert.ok(html.includes(lib.ROOM_NOTE));
  const bad = mount(h(Routes, null, h(Route, { path: '/session/:id', element: h(SessionLanding) })), ['/session/not-a-link']);
  assert.ok(!bad.includes('vybe://open'), 'no deep link for a malformed param');
});
