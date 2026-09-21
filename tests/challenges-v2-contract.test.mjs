/**
 * P8a challenges v2: every literal path the client sends resolves to a
 * mounted backend route, the two flags are named where they bite, and the
 * pure row/board/stats helpers hold the zero rule and the two `daysLeft`
 * edges the server actually sends.
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
const lib = await import('../src/lib/challenges.ts');

/** `/challenges/${id}/board` → `/api/challenges/:x/board`, as segments. */
const segmentsOf = (webPath) => `/api${webPath}`.replace(/\$\{[^}]*\}/g, ':x').split('/').filter(Boolean);

/** A snapshot route matches when every segment is equal or is a parameter. */
const isMounted = (method, webPath) => {
  const want = segmentsOf(webPath);
  return snapshot.routes.some((route) => {
    if (route.method !== method) return false;
    const have = route.path.split('/').filter(Boolean);
    if (have.length !== want.length) return false;
    return have.every((segment, i) => segment.startsWith(':') || segment === want[i]);
  });
};

/* ------------------------------------------------------------------ paths */

test('every challenge path the client sends is a mounted route', () => {
  const src = read('src/lib/challenges.ts');
  const calls = [...src.matchAll(/api\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*`([^`]+)`/g)].map((m) => [
    m[1].toUpperCase(),
    m[2],
  ]);
  // Every route this package exists to reach, named so a rename fails here.
  const expected = [
    ['GET', '/challenges/${challengeId}/board'],
    ['GET', '/challenges/${challengeId}/leaderboard'],
    ['GET', '/challenges/${challengeId}/stats'],
    ['POST', '/challenges/${challengeId}/invite'],
    ['POST', '/challenges/${challengeId}/end'],
    ['POST', '/challenges/${challengeId}/host'],
    ['PATCH', '/challenges/${challengeId}/participants/me'],
    ['POST', '/challenges/${challengeId}/participants/${userId}/remove'],
    ['POST', '/challenges/${challengeId}/requests/${userId}/accept'],
    ['POST', '/challenges/${challengeId}/requests/${userId}/decline'],
    ['POST', '/challenges/${challengeId}/check-ins/${userId}/${localDay}/remove'],
  ];
  for (const [method, webPath] of expected) {
    assert.ok(
      calls.some(([m, p]) => m === method && p === webPath),
      `lib/challenges.ts must call ${method} ${webPath}`,
    );
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not in contracts/backend-routes.json`);
  }
  for (const [method, webPath] of calls) {
    assert.ok(isMounted(method, webPath), `${method} /api${webPath} is not a mounted route`);
  }
  // Photo proof stays false (D-99): the photo check-in and its delete are
  // never called, whatever the flag says.
  assert.doesNotMatch(src, /api\.post[^\n]*\/check-ins`/, 'no photo check-in is created from the web');
  assert.doesNotMatch(src, /api\.delete[^\n]*\/photo`/, 'no photo delete is called from the web');
  // The detail and the join keep living on the page; the board query key is
  // a child of ['challenges'] so the page's one invalidation reaches it.
  assert.match(src, /\['challenges', 'board', challengeId, period, scope, around\] as const/);
  assert.match(src, /\['challenges', 'stats', challengeId\] as const/);
});

test('the flags are named, and the page reads them through this module', () => {
  const src = read('src/lib/challenges.ts');
  assert.equal(lib.CHALLENGES_V2_FLAG, 'challengesV2');
  assert.equal(lib.CHALLENGE_INVITES_FLAG, 'invites');
  assert.equal(lib.CHALLENGE_PHOTO_PROOF_FLAG, 'challengePhotoProof');
  assert.equal(lib.CHALLENGE_INVITE_MAX, 20);
  // Feature-detect on the flag AND on the answer: a route whose flag went
  // off answers 404 FEATURE_DISABLED and the surface is absent, not broken.
  assert.match(src, /details\.status === 404 && details\.code === 'FEATURE_DISABLED'/);
  assert.match(src, /if \(status === 404 \|\| status === 403\) return null;/);
  // Challenges.tsx must not grow a capabilities import of its own
  // (tests/health-challenges-contract pins that seam too).
  const page = read('src/pages/Challenges.tsx');
  assert.doesNotMatch(page, /from '\.\.\/lib\/capabilities'/);
  assert.match(page, /import \{\s*useChallengesV2,/);
  assert.match(page, /const v2 = useChallengesV2\(\);/);
});

test('one challenge has a path of its own, so a shared link lands on it', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<Route path="challenges\/:challengeId" element=\{<Challenges \/>\} \/>/);
  // The route is additive: the list keeps its own path and its ?open= link.
  assert.match(app, /<Route path="challenges" element=\{<Challenges \/>\} \/>/);
  const page = read('src/pages/Challenges.tsx');
  assert.match(page, /const \{ challengeId: openedFromPath \} = useParams\(\);/);
  assert.match(page, /const openedFromLink = openedFromPath \?\? searchParams\.get\('open'\) \?\? searchParams\.get\('challenge'\);/);
  // Closing a path deep link goes back to the list, not to a dead parameter.
  assert.match(page, /if \(openedFromPath\) \{\s*navigate\('\/challenges', \{ replace: true \}\);/);
});

/* ------------------------------------------------------------------ the zero rule */

test('a standing is a fact only after a seat and a counted day', () => {
  assert.equal(lib.hasStanding({ rank: 4, progress: 6, joined: true }), true);
  assert.equal(lib.hasStanding({ rank: null, progress: 0, joined: true }), false, 'no rank before the first entry');
  assert.equal(lib.hasStanding({ rank: 4, progress: 6, joined: false }), false, 'a rank needs a seat');
  assert.equal(lib.hasStanding(undefined), false);
  assert.equal(lib.hasProgress({ rank: null, progress: 3, joined: true }), true);
  assert.equal(lib.hasProgress({ rank: null, progress: 0, joined: true }), false);

  assert.equal(lib.standingLabel({ rank: 4, progress: 6, joined: true }, 31), 'Joined · #4 of 31');
  assert.equal(lib.standingLabel({ rank: 4, progress: 6, joined: true }, 0), 'Joined · #4');
  assert.equal(lib.standingLabel({ rank: null, progress: 0, joined: true }, 31), 'Joined', 'never "#0" and never "last"');
  assert.equal(lib.standingLabel({ rank: null, progress: 0, joined: false }, 31), null);
  assert.equal(lib.standingLabel(undefined, 31), null);
});

test('the progress line is omitted rather than zeroed, and carries the unit', () => {
  assert.equal(lib.progressLine(12, 20, 'km'), '12 of 20 km');
  assert.equal(lib.progressLine(12, 20, ''), '12 of 20');
  assert.equal(lib.progressLine(12.34, 20, 'km'), '12.3 of 20 km');
  assert.equal(lib.progressLine(0, 20, 'km'), null, '"0 of 20" is a hole, not a fact');
  assert.equal(lib.progressLine(undefined, 20, 'km'), null);
  assert.equal(lib.progressLine(12, 0, 'km'), null, 'no goal, no line');
  assert.equal(lib.groupGoalLine({ total: 84, target: 120 }, 'sessions'), '84 of 120 sessions together');
  assert.equal(lib.groupGoalLine({ total: 0, target: 120 }, 'sessions'), null);
  assert.equal(lib.groupGoalLine(null, 'sessions'), null);
});

test('daysLeft: 0 is the last day, null is over, undefined says nothing', () => {
  assert.equal(lib.daysLeftLabel(5), '5 days left');
  assert.equal(lib.daysLeftLabel(1), '1 day left');
  assert.equal(lib.daysLeftLabel(0), 'Ends today');
  assert.equal(lib.daysLeftLabel(null), 'Ended');
  assert.equal(lib.daysLeftLabel(undefined), null, 'a row without the field does not guess');
  assert.equal(lib.daysLeftUrgent(0), true);
  assert.equal(lib.daysLeftUrgent(2), true);
  assert.equal(lib.daysLeftUrgent(3), false);
  assert.equal(lib.daysLeftUrgent(null), false);
  assert.equal(lib.daysLeftUrgent(undefined), false);
});

/* ------------------------------------------------------------------ the pinned row */

const actor = (id, name) => ({ _id: id, username: name.toLowerCase().replace(/\W+/g, ''), fullName: name });
const entry = (rank, id, score, isMe = false) => ({ rank, user: actor(id, `Member ${id}`), score, isMe });

const board = (over) => ({
  mode: 'board',
  metric: 'session_days',
  dailyCap: null,
  proof: 'none',
  range: { key: 'week', weekKey: '2026-W39', start: '2026-09-21T00:00:00.000Z', end: '2026-09-28T00:00:00.000Z', timezone: 'UTC', resetsOn: 'monday' },
  entries: Array.from({ length: 10 }, (_, i) => entry(i + 1, `u${i + 1}`, 20 - i)),
  me: { score: 6, rank: 14, daysDone: 6, joinedDay: null },
  around: [],
  groupGoal: null,
  participants: 31,
  justMe: false,
  asOf: '2026-09-24T12:00:00.000Z',
  ...over,
});

test('your row is pinned only when it exists and is out of sight', () => {
  const me = actor('me', 'Vybe Test User');
  // Outside the top ten, no `around` sent: the row is built from `me`.
  const pinned = lib.pinnedBoardRow(board(), me);
  assert.deepEqual(pinned, { rank: 14, user: me, score: 6, isMe: true, joinedDay: null });
  // The server's own `around` row wins, because it carries the neighbours' context.
  const withAround = board({ around: [entry(13, 'u13', 7), entry(14, 'me', 6, true), entry(15, 'u15', 6)] });
  assert.equal(lib.pinnedBoardRow(withAround, me).rank, 14);
  assert.equal(lib.pinnedBoardRow(withAround, me).isMe, true);
  // Already visible: nothing is pinned above the list.
  const inTop = board({ entries: [entry(1, 'me', 20, true), entry(2, 'u2', 19)] });
  assert.equal(lib.pinnedBoardRow(inTop, me), null);
  // The zero rule: no rank yet, so no standing anywhere.
  assert.equal(lib.pinnedBoardRow(board({ me: { score: 0, rank: null, daysDone: 0 } }), me), null);
  // A Group Goal has no ranks, ever.
  assert.equal(lib.pinnedBoardRow(board({ mode: 'group_goal' }), me), null);
  assert.equal(lib.pinnedBoardRow(null, me), null);
});

test('the gap between the top and your neighbourhood is drawn, not hidden', () => {
  const far = lib.boardRows(board({ around: [entry(13, 'u13', 7), entry(14, 'me', 6, true)] }));
  assert.equal(far.entries.length, 10);
  assert.equal(far.around.length, 2);
  assert.equal(far.gap, true, 'ranks 11 and 12 are missing, and that is a fact');
  const adjacent = lib.boardRows(board({ around: [entry(11, 'u11', 9), entry(12, 'me', 8, true)] }));
  assert.equal(adjacent.gap, false);
  assert.equal(lib.boardRows(undefined).entries.length, 0);
});

test('the legacy leaderboard reads as board rows, so one list draws both', () => {
  const rows = [
    { user: actor('u1', 'Maya Kim'), progress: 12, rank: 1 },
    { user: actor('me', 'Vybe Test User'), progress: 6, rank: 4 },
    { user: 'u3', progress: 3 },
  ];
  const mapped = lib.legacyBoardEntries(rows, 'me');
  assert.deepEqual(mapped.map((row) => [row.rank, row.score, row.isMe]), [
    [1, 12, false],
    [4, 6, true],
    [3, 3, false],
  ]);
  assert.equal(mapped[2].user._id, 'u3', 'a bare id is still an actor');
});

/* ------------------------------------------------------------------ the trust rule */

test('the trust rule says what counts and that nothing is typed in', () => {
  // The metric words mirror services/challengeCopy.js exactly.
  assert.deepEqual({ ...lib.METRIC_LABELS }, {
    session_days: 'sessions',
    minutes: 'minutes',
    check_ins: 'check-ins',
    habit_ticks: 'days with water logged',
  });
  assert.deepEqual({ ...lib.TRUST_RULES }, {
    session_days: 'Counts the days you train',
    minutes: 'Counts your training minutes, capped per day',
    check_ins: 'Counts the days you check in at the gym',
    habit_ticks: 'Counts the days you log water',
  });
  assert.match(lib.trustRuleFor({ metric: 'session_days' }), /^Counts the days you train\. Nothing is typed in/);
  assert.match(lib.trustRuleFor({ metric: 'minutes', dailyCap: 90 }), /up to 90 a day\. Nothing is typed in\./);
  assert.match(lib.trustRuleFor(null), /Counts the days you train/, 'an unknown metric falls back, never blank');
  assert.equal(lib.metricLabel('minutes'), 'minutes');
  assert.equal(lib.metricLabel(null), 'sessions');
  // The refusal the client must recognise, not paper over.
  assert.equal(lib.PROGRESS_COMPUTED_CODE, 'CHALLENGE_PROGRESS_COMPUTED');
  // No manual progress write is offered on a v2 row anywhere in the package.
  const detail = read('src/pages/challenges/ChallengeDetailV2.tsx');
  assert.doesNotMatch(detail, /api\.(?:put|post)[^\n]*\/progress/, 'no typed progress write on a v2 row');
  assert.doesNotMatch(detail, /api\.post[^\n]*auto-update/, 'no manual sync on a v2 row either');
  assert.match(detail, /trustRuleFor\(\{ metric, dailyCap:/);
});

test('the stats lines are omitted before they mean anything', () => {
  const stats = { mode: 'board', metric: 'session_days', participantsActive: 31, dayOf: 9, daysTotal: 30, groupTotal: 84, groupTarget: null, medianDaysDone: 4 };
  assert.equal(lib.dayOfLine(stats), 'Day 9 of 30');
  assert.equal(lib.dayOfLine({ ...stats, dayOf: 0 }), null, 'before the window opens there is no day');
  assert.equal(lib.dayOfLine(null), null);
  assert.equal(lib.myShareLine(stats, 12), '12 of 84');
  assert.equal(lib.myShareLine(stats, 0), null, 'no share is not a zero share');
  assert.equal(lib.myShareLine({ ...stats, groupTotal: 0 }, 12), null);
  assert.equal(lib.myShareLine(null, 12), null);
});

test('the board period control offers exactly the three the API takes', () => {
  assert.deepEqual([...lib.BOARD_PERIODS], ['week', 'last', 'all']);
  assert.deepEqual({ ...lib.BOARD_PERIOD_LABELS }, { week: 'This week', last: 'Last week', all: 'All' });
});
