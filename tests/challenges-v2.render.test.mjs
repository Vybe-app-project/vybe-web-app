/**
 * P8a challenges v2, rendered from props alone (renderToString inside a
 * MemoryRouter): the four row states the list can be in, the board with the
 * viewer's row pinned above it, the pooled Group Goal pane, and the trophy
 * line a finished challenge earns.
 *
 * The rule under every case: a number that is not there is omitted, and its
 * place offers the next action. No "#0", no "0 of 20", no "0 in".
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const row = await import('../src/pages/challenges/ChallengeRow.tsx');
const board = await import('../src/pages/challenges/ChallengeBoard.tsx');

const render = (ui) => renderToString(h(MemoryRouter, null, ui));

/** Visible text only: class names and pixel attributes are full of digits. */
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#x2019;/g, '’')
    .replace(/&#xB7;|&middot;/g, '·')
    .replace(/&#x2014;/g, '—')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1');

const actor = (id, name) => ({ _id: id, username: name.toLowerCase().replace(/\W+/g, ''), fullName: name });

const base = {
  _id: 'c1',
  title: '20 km this month',
  goal: 20,
  mode: 'board',
  ownership: 'user',
  stats: { totalParticipants: 31 },
  daysLeft: 5,
};

const list = (ui) => render(h('ul', null, ui));

/* ------------------------------------------------------------------ row states */

test('an open row prints the goal, the days left and the head count, and offers Join', () => {
  const html = list(
    h(row.ChallengeRow, {
      challenge: { ...base, me: { rank: null, progress: 0, joined: false } },
      unit: 'km',
      to: '/challenges?open=c1',
      canJoin: true,
      onJoin: () => {},
    }),
  );
  const text = textOf(html);
  assert.match(text, /20 km this month/);
  assert.match(text, /Goal: 20 km · 5 days left · 31 in/);
  // The one blue per row is a text action, not a filled button.
  assert.match(html, /aria-label="Join 20 km this month"/);
  assert.match(html, /text-brand/);
  assert.doesNotMatch(html, /btn-primary/, 'a row action is never a filled blue');
  // No standing at all before a seat.
  assert.doesNotMatch(text, /Joined/);
  assert.doesNotMatch(text, /#/);
  assert.match(html, /href="\/challenges\?open=c1"/);
});

test('a joined row leads with your own number and states where you stand', () => {
  const text = textOf(
    list(
      h(row.ChallengeRow, {
        challenge: { ...base, me: { rank: 4, progress: 12, joined: true } },
        unit: 'km',
        to: '/challenges?open=c1',
        canJoin: false,
      }),
    ),
  );
  assert.match(text, /12 of 20 km · 5 days left · 31 in/);
  assert.match(text, /Joined · #4 of 31/);
  assert.doesNotMatch(text, /Goal:/, 'your own number replaces the goal, not joins it');
});

test('a seat with no counted day says "Joined" and nothing about a rank', () => {
  const text = textOf(
    list(
      h(row.ChallengeRow, {
        challenge: { ...base, me: { rank: null, progress: 0, joined: true } },
        unit: 'km',
        to: '/challenges?open=c1',
      }),
    ),
  );
  assert.match(text, /Goal: 20 km/, 'no "0 of 20"');
  assert.match(text, /Joined/);
  assert.doesNotMatch(text, /#/, 'no rank before the first entry');
  assert.doesNotMatch(text, /0 of 20/);
});

test('an ended row says Ended and offers nothing to join', () => {
  const html = list(
    h(row.ChallengeRow, {
      challenge: { ...base, daysLeft: null, me: { rank: 2, progress: 20, joined: true } },
      unit: 'km',
      to: '/challenges?open=c1',
      canJoin: false,
    }),
  );
  const text = textOf(html);
  assert.match(text, /20 of 20 km · Ended · 31 in/);
  assert.match(text, /Joined · #2 of 31/);
  assert.doesNotMatch(html, /aria-label="Join /);
});

test('a group goal shows the pooled line and no rank; the Vybe row is marked', () => {
  const text = textOf(
    list(
      h(row.ChallengeRow, {
        challenge: {
          ...base,
          ownership: 'vybe',
          mode: 'group_goal',
          title: 'This Month: 12 Session Days',
          goal: 120,
          groupGoal: { total: 84, target: 120 },
          me: { rank: null, progress: 6, joined: true },
          daysLeft: 0,
        },
        unit: 'sessions',
        to: '/challenges?open=c1',
      }),
    ),
  );
  assert.match(text, /84 of 120 sessions together · Ends today · 31 in/);
  assert.match(text, /Joined/);
  assert.doesNotMatch(text, /#/, 'a pooled target has no ranks, ever');
  assert.match(text, /Vybe/);
});

test('a row with no participants yet omits the count rather than printing a zero', () => {
  const text = textOf(
    list(
      h(row.ChallengeRow, {
        challenge: { ...base, stats: { totalParticipants: 0 }, participants: [], me: { rank: null, progress: 0, joined: false } },
        unit: 'km',
        to: '/challenges?open=c1',
      }),
    ),
  );
  assert.match(text, /Goal: 20 km · 5 days left/);
  assert.doesNotMatch(text, /0 in/);
});

test('the row skeleton keeps the row geometry, so the list does not shift when it fills', () => {
  const html = render(h(row.ChallengeRowSkeleton, { rows: 3 }));
  assert.equal((html.match(/min-h-18/g) || []).length, 3);
  assert.match(html, /aria-hidden="true"/);
});

/* ------------------------------------------------------------------ the board */

const entry = (rank, id, name, score, isMe = false) => ({ rank, user: actor(id, name), score, isMe });

const aBoard = (over) => ({
  mode: 'board',
  metric: 'session_days',
  dailyCap: null,
  proof: 'none',
  range: { key: 'week', weekKey: '2026-W39', start: '2026-09-21T00:00:00.000Z', end: '2026-09-28T00:00:00.000Z', timezone: 'UTC', resetsOn: 'monday' },
  entries: [entry(1, 'u1', 'Maya Kim', 12), entry(2, 'u2', 'Alex Stone', 11), entry(3, 'u3', 'Rio Vance', 9)],
  me: { score: 6, rank: 14, daysDone: 6, joinedDay: null },
  around: [],
  groupGoal: null,
  participants: 31,
  justMe: false,
  asOf: '2026-09-24T12:00:00.000Z',
  ...over,
});

const me = actor('me', 'Vybe Test User');

test('the board pins your row above the list when your rank is out of sight', () => {
  const html = render(h(board.ChallengeBoardPane, { board: aBoard(), me, unit: 'sessions' }));
  const text = textOf(html);
  assert.match(text, /Where you stand/);
  // Your row reads "You", is marked current, and comes before the top three.
  assert.match(html, /aria-current="true"/);
  assert.ok(text.indexOf('You') < text.indexOf('Maya Kim'), 'your row is above the list, not below it');
  assert.match(text, /14/);
  assert.match(text, /Maya Kim/);
  assert.match(text, /31 people in/);
});

test('a viewer already in the visible slice gets no second copy of their row', () => {
  const html = render(
    h(board.ChallengeBoardPane, {
      board: aBoard({ entries: [entry(1, 'me', 'Vybe Test User', 12, true), entry(2, 'u2', 'Alex Stone', 11)], me: { score: 12, rank: 1, daysDone: 12 } }),
      me,
      unit: 'sessions',
    }),
  );
  assert.doesNotMatch(textOf(html), /Where you stand/);
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
});

test('a rank the viewer has not earned pins nothing', () => {
  const html = render(h(board.ChallengeBoardPane, { board: aBoard({ me: { score: 0, rank: null, daysDone: 0 } }), me, unit: 'sessions' }));
  assert.doesNotMatch(textOf(html), /Where you stand/);
});

test('the gap between the top and your neighbourhood is drawn', () => {
  const html = render(
    h(board.ChallengeBoardPane, {
      board: aBoard({ around: [entry(13, 'u13', 'Sam Fox', 7), entry(14, 'me', 'Vybe Test User', 6, true), entry(15, 'u15', 'Jo Ray', 6)] }),
      me,
      unit: 'sessions',
    }),
  );
  const text = textOf(html);
  assert.match(text, /⋯/, 'the ranks are not contiguous, and that is a fact');
  assert.match(text, /Sam Fox/);
  assert.match(text, /Jo Ray/);
});

test('an empty board offers the one action that fills it, and never a zero row', () => {
  const html = render(
    h(board.ChallengeBoardPane, { board: aBoard({ entries: [], me: { score: 0, rank: null, daysDone: 0 } }), me, unit: 'sessions', onLogSession: () => {} }),
  );
  const text = textOf(html);
  assert.match(text, /Nobody has counted a day yet/);
  assert.match(text, /Log a session/);
});

test('a known minor reads their own row alone, and the screen says so', () => {
  const text = textOf(render(h(board.ChallengeBoardPane, { board: aBoard({ justMe: true, entries: [] }), me, unit: 'sessions' })));
  assert.match(text, /Standings are off for your account/);
  assert.match(text, /Vybe Test User|You/);
});

test('a group goal draws the pooled total, your part and who has counted', () => {
  const text = textOf(
    render(
      h(board.ChallengeBoardPane, {
        board: aBoard({
          mode: 'group_goal',
          entries: [],
          groupGoal: {
            target: 120,
            total: 84,
            myPart: 12,
            contributors: [{ user: actor('u1', 'Maya Kim'), score: 20, lastAt: '2026-09-24T09:00:00.000Z' }],
            reachedAt: null,
          },
        }),
        me,
        unit: 'sessions',
      }),
    ),
  );
  assert.match(text, /84 \/ 120/);
  assert.match(text, /sessions together/);
  assert.match(text, /Your part: 12/);
  assert.match(text, /Who has counted/);
  assert.match(text, /Maya Kim/);
});

test('a group goal with nothing pooled offers the next action instead of a zero share', () => {
  const text = textOf(
    render(
      h(board.ChallengeBoardPane, {
        board: aBoard({ mode: 'group_goal', entries: [], groupGoal: { target: 120, total: 0, myPart: 0, contributors: [], reachedAt: null } }),
        me,
        unit: 'sessions',
      }),
    ),
  );
  assert.match(text, /Log a session and your part shows up here/);
  assert.doesNotMatch(text, /Your part: 0/);
});

/* ------------------------------------------------------------------ the trophy */

test('a finished challenge links its trophy to Achievements, and an open one says nothing', () => {
  const html = render(h(board.ChallengeAward, { finished: true, to: '/achievements' }));
  assert.match(textOf(html), /Finished/);
  assert.match(html, /href="\/achievements"/);
  assert.match(textOf(html), /See it on your achievements/);
  assert.equal(render(h(board.ChallengeAward, { finished: false, to: '/achievements' })), '');
});

/* ------------------------------------------------------------------ no NaN anywhere */

test('no row or board state prints NaN, undefined or null', () => {
  const states = [
    h(row.ChallengeRow, { challenge: { _id: 'x', title: 'Bare row', goal: 0 }, unit: '', to: '/challenges?open=x' }),
    h(row.ChallengeRow, { challenge: { ...base, me: undefined, daysLeft: undefined }, unit: '', to: '/challenges?open=x' }),
  ];
  for (const state of states) {
    const html = list(state);
    for (const bad of ['NaN', 'undefined', 'null']) assert.ok(!textOf(html).includes(bad), `row prints ${bad}`);
  }
  const boards = [aBoard({ entries: [], me: { score: 0, rank: null, daysDone: 0 } }), aBoard({ around: [] })];
  for (const state of boards) {
    const html = render(h(board.ChallengeBoardPane, { board: state, me, unit: 'sessions' }));
    for (const bad of ['NaN', 'undefined']) assert.ok(!textOf(html).includes(bad), `board prints ${bad}`);
  }
});
