/**
 * The first-week Get started card on Home (design-first-week-and-people.md
 * §3.1, §4): the day line, the visibility rule, the step judging, today's
 * step in the server planner's order, the day-2 people nudge, the starter
 * session picked from the premade catalogue, the per-account dismissal, the
 * banned-word walk, and the source pins that keep the card wired the way the
 * brief says (one Feed mount, the kill-switch read, no flagged route).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./ts-loader.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const fw = await import('../src/lib/firstWeek.ts');

const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

/** Steps with every key `todo` except the overrides. */
const stepsWith = (overrides = {}) => fw.STEP_KEYS.map((key) => ({ key, status: overrides[key] ?? 'todo' }));

const SEED = {
  _id: 'w1',
  title: 'Foundation Full Body',
  category: 'strength',
  duration: 28,
  level: 'beginner',
  caloriesBurned: 190,
  exercises: [
    { name: 'Bodyweight Squat', sets: 3, reps: 12, rest: 45 },
    { name: 'Incline Push-Up', sets: 3, reps: 10, rest: 45 },
    { name: 'Glute Bridge', sets: 3, reps: 15, rest: 30 },
    { name: 'Dead Bug', sets: 3, reps: 10, rest: 30 },
  ],
};

/* ------------------------------------------------------------- day line */

test('firstWeekDay is a calendar position in the device zone; windowDay is elapsed time', () => {
  const created = local(2026, 9, 14, 23, 30);
  assert.equal(fw.firstWeekDay(created, local(2026, 9, 15, 8, 0)), 2, 'the morning after a 23:30 sign-up is day 2');
  assert.equal(fw.windowDay(created, local(2026, 9, 15, 8, 0)), 1, 'while less than 24 h have elapsed');
  assert.equal(fw.firstWeekDay(created, local(2026, 9, 14, 23, 45)), 1, 'same day');
  assert.equal(fw.firstWeekDay(created, local(2026, 9, 20, 23, 59)), 7, 'day 7 at 23:59');
  assert.equal(fw.isWithinWindow(created, local(2026, 9, 20, 23, 59)), true);
  assert.equal(fw.firstWeekDay(created, local(2026, 9, 22, 12, 0)), 7, 'clamped to 7, never 9');
  assert.equal(fw.firstWeekDay(created, local(2026, 9, 10, 12, 0)), 1, 'a future createdAt is day 1');
  assert.equal(fw.windowDay(created, local(2026, 9, 10, 12, 0)), 1);
  assert.equal(fw.localDayNumber(local(2026, 9, 15, 23, 59)) - fw.localDayNumber(local(2026, 9, 14, 0, 0)), 1, 'one calendar day apart, whatever the hours');
  assert.equal(fw.localDayNumber(local(2026, 9, 15, 0, 0)), fw.localDayNumber(local(2026, 9, 15, 23, 59)), 'the same calendar day');
});

test('firstWeekDay counts calendar days across a DST change (node spawned under TZ=America/New_York)', () => {
  // The host zone may never cross a transition, so the module runs in a child
  // pinned to New York, where 2026-03-08 has 23 hours and 2026-11-01 has 25.
  const loader = pathToFileURL(path.join(root, 'tests', 'ts-loader.mjs')).href;
  const module = pathToFileURL(path.join(root, 'src', 'lib', 'firstWeek.ts')).href;
  const script = `
    import { register } from 'node:module';
    register(${JSON.stringify(loader)});
    const fw = await import(${JSON.stringify(module)});
    const local = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
    process.stdout.write(JSON.stringify({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      springOffsets: [new Date(2026, 2, 8, 1).getTimezoneOffset(), new Date(2026, 2, 9, 1).getTimezoneOffset()],
      afterSpringForward: fw.firstWeekDay(local(2026, 3, 8, 10), local(2026, 3, 9, 10)),
      intoSpringForward: fw.firstWeekDay(local(2026, 3, 7, 23, 30), local(2026, 3, 8, 8)),
      afterFallBack: fw.firstWeekDay(local(2026, 11, 1, 10), local(2026, 11, 2, 10)),
      weekAcrossSpring: fw.firstWeekDay(local(2026, 3, 5, 12), local(2026, 3, 11, 12)),
      clampedAcrossSpring: fw.firstWeekDay(local(2026, 3, 5, 12), local(2026, 3, 12, 12)),
      sameDay: fw.firstWeekDay(local(2026, 3, 8, 0, 30), local(2026, 3, 8, 23, 30)),
    }));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.zone, 'America/New_York', 'the child honours TZ');
  assert.deepEqual(out.springOffsets, [300, 240], 'the clocks moved on 2026-03-08');
  assert.equal(out.afterSpringForward, 2, 'the day after a 23 h local day is day 2, not day 1');
  assert.equal(out.intoSpringForward, 2, 'the morning after a late sign-up is day 2 even when that morning came an hour early');
  assert.equal(out.afterFallBack, 2, 'the day after a 25 h local day is day 2');
  assert.equal(out.weekAcrossSpring, 7);
  assert.equal(out.clampedAcrossSpring, 7, 'clamped, never 8');
  assert.equal(out.sameDay, 1);
});

test('the window closes on day 8', () => {
  const created = local(2026, 9, 14, 0, 10);
  assert.equal(fw.windowDay(created, local(2026, 9, 20, 23, 59)), 7);
  assert.equal(fw.isWithinWindow(created, local(2026, 9, 20, 23, 59)), true);
  assert.equal(fw.windowDay(created, local(2026, 9, 21, 0, 11)), 8);
  assert.equal(fw.isWithinWindow(created, local(2026, 9, 21, 0, 11)), false);
});

test('parseCreatedAt reads an ISO string, a number and a Date and rejects garbage', () => {
  assert.equal(fw.parseCreatedAt('2026-09-14T12:00:00.000Z'), Date.parse('2026-09-14T12:00:00.000Z'));
  assert.equal(fw.parseCreatedAt(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(fw.parseCreatedAt(new Date(1_700_000_000_000)), 1_700_000_000_000);
  for (const bad of [undefined, null, '', '  ', 'yesterday', Number.NaN, {}, new Date('nope')]) assert.equal(fw.parseCreatedAt(bad), null, String(bad));
});

test('the day line is a position, never a remaining count', () => {
  assert.equal(fw.firstWeekStrings.day(3), 'Day 3 of your first week');
  assert.doesNotMatch(fw.firstWeekStrings.day(3), /left|remaining/i);
});

/* ------------------------------------------------------------ visibility */

test('decideCard hides in the documented order and shows with steps null inside the window', () => {
  const now = local(2026, 9, 16, 12, 0);
  const base = { userId: 'u1', createdAt: new Date(local(2026, 9, 14, 9, 0)).toISOString(), now, dismissedAt: null, steps: null };
  assert.deepEqual(fw.decideCard(base), { show: true });
  assert.deepEqual(fw.decideCard({ ...base, featureOff: true }), { show: false, reason: 'flag-off' });
  assert.deepEqual(fw.decideCard({ ...base, userId: null }), { show: false, reason: 'no-user' });
  assert.deepEqual(fw.decideCard({ ...base, createdAt: undefined }), { show: false, reason: 'no-created-at' });
  assert.deepEqual(fw.decideCard({ ...base, now: local(2026, 9, 22, 12, 0) }), { show: false, reason: 'window-passed' });
  assert.deepEqual(fw.decideCard({ ...base, dismissedAt: now - 1000 }), { show: false, reason: 'dismissed' });
  assert.deepEqual(fw.decideCard({ ...base, steps: stepsWith({ 'first-move': 'done', 'social-spark': 'done', 'join-gym': 'done', 'first-meal': 'done' }) }), {
    show: false,
    reason: 'all-done',
  });
  assert.deepEqual(
    fw.decideCard({ ...base, steps: stepsWith({ 'first-move': 'unavailable', 'social-spark': 'unavailable', 'join-gym': 'unavailable', 'first-meal': 'unavailable' }) }),
    { show: false, reason: 'nothing-available' },
  );
  assert.deepEqual(fw.decideCard({ ...base, steps: stepsWith({ 'first-move': 'done' }) }), { show: true });
  assert.deepEqual(fw.decideCard({ ...base, steps: stepsWith({ 'first-move': 'done', 'join-gym': 'unavailable', 'social-spark': 'done', 'first-meal': 'done' }) }), {
    show: false,
    reason: 'all-done',
  }, 'an unavailable step does not keep the card up');
});

/* ----------------------------------------------------------------- steps */

const sources = (over = {}) => ({
  workoutLogs: fw.sourceValue(0),
  following: 0,
  communities: fw.sourceValue(0),
  meals: fw.sourceValue({ lastLoggedDate: null }),
  ...over,
});

test('buildSteps judges each step from its sources', () => {
  const status = (key, s) => fw.buildSteps(s).find((x) => x.key === key).status;
  assert.equal(status('first-move', sources()), 'todo');
  assert.equal(status('first-move', sources({ workoutLogs: fw.sourceValue(1) })), 'done');
  assert.equal(status('join-gym', sources({ communities: fw.SOURCE_NOT_DEPLOYED })), 'unavailable');
  assert.ok(!fw.visibleSteps(fw.buildSteps(sources({ communities: fw.SOURCE_NOT_DEPLOYED }))).some((s) => s.key === 'join-gym'), 'an unavailable row hides');
  assert.equal(status('join-gym', sources({ communities: fw.sourceValue(1) })), 'done');
  assert.equal(status('first-meal', sources()), 'todo');
  assert.equal(status('first-meal', sources({ meals: fw.sourceValue({ lastLoggedDate: '2026-09-15T12:00:00.000Z' }) })), 'done');
  assert.equal(status('social-spark', sources({ following: 0 })), 'todo');
  assert.equal(status('social-spark', sources({ following: 2 })), 'done');
  assert.equal(status('first-move', sources({ workoutLogs: fw.SOURCE_ERROR })), 'unknown', 'a lone failed read is unknown, rendered as to do');
  assert.equal(status('social-spark', sources({ following: null })), 'unknown', 'no following count and no achievements');
});

test('achievements are a second vote: progress on a workouts row marks first-move done, a followers row marks social-spark done', () => {
  const ach = (criteriaType, progress, isEarned = false) => ({ name: 'x', criteriaType, progress, isEarned });
  const steps = fw.buildSteps(sources({ achievements: fw.sourceValue([ach('workouts', 1), ach('followers', 0, true)]) }));
  assert.equal(steps.find((s) => s.key === 'first-move').status, 'done');
  assert.equal(steps.find((s) => s.key === 'social-spark').status, 'done');
  const errored = fw.buildSteps(sources({ achievements: fw.SOURCE_ERROR, workoutLogs: fw.sourceValue(1) }));
  assert.equal(errored.find((s) => s.key === 'first-move').status, 'done', 'a failed achievements read does not undo the logs answer');
  assert.deepEqual(fw.normalizeAchievement({ title: 'First Move', criteria: { type: 'workouts', value: 1 }, progress: 2, isEarned: false }), {
    name: 'First Move',
    criteriaType: 'workouts',
    progress: 2,
    isEarned: false,
  });
  assert.equal(fw.normalizeAchievement({}), null);
});

test('followingCountOf reads the array, then followingCount, then stats.following', () => {
  assert.equal(fw.followingCountOf({ following: ['a', 'b'] }), 2);
  assert.equal(fw.followingCountOf({ followingCount: 3 }), 3);
  assert.equal(fw.followingCountOf({ stats: { following: 4 } }), 4);
  assert.equal(fw.followingCountOf({ username: 'x' }), null);
  assert.equal(fw.followingCountOf(null), null);
});

test('progressOf counts visible steps only; nothingAnswered needs every step unknown or unavailable', () => {
  assert.deepEqual(fw.progressOf(stepsWith({ 'first-move': 'done', 'join-gym': 'unavailable' })), { done: 1, total: 3 });
  assert.equal(fw.nothingAnswered(stepsWith({ 'first-move': 'unknown', 'social-spark': 'unknown', 'join-gym': 'unknown', 'first-meal': 'unknown' })), true);
  assert.equal(fw.nothingAnswered(stepsWith({ 'first-move': 'unknown', 'social-spark': 'unavailable', 'join-gym': 'unknown', 'first-meal': 'unknown' })), true);
  assert.equal(fw.nothingAnswered(stepsWith({ 'first-move': 'unknown' })), false, 'one real answer is enough');
});

/* ----------------------------------------------------------------- today */

test("todaysStep follows the server's day-2 planner table", () => {
  assert.deepEqual(fw.TODAY_STEP_ORDER, ['first-move', 'join-gym', 'social-spark', 'first-meal']);
  const table = [
    [{}, 'first-move'],
    [{ 'first-move': 'done' }, 'join-gym'],
    [{ 'first-move': 'done', 'join-gym': 'done' }, 'social-spark'],
    [{ 'first-move': 'done', 'join-gym': 'done', 'social-spark': 'done' }, 'first-meal'],
    [{ 'first-move': 'done', 'join-gym': 'done', 'social-spark': 'done', 'first-meal': 'done' }, null],
    [{ 'join-gym': 'done', 'social-spark': 'done', 'first-meal': 'done' }, 'first-move'],
  ];
  for (const [state, expected] of table) assert.equal(fw.todaysStep(stepsWith(state)), expected, JSON.stringify(state));
  assert.equal(fw.todaysStep(stepsWith({ 'first-move': 'unknown' })), 'first-move', 'unknown counts as open');
  assert.equal(fw.todaysStep(stepsWith({ 'first-move': 'unavailable' })), 'join-gym', 'unavailable is skipped');
});

test('starterOffered until the first log exists', () => {
  assert.equal(fw.starterOffered(stepsWith()), true);
  assert.equal(fw.starterOffered(stepsWith({ 'first-move': 'unknown' })), true);
  assert.equal(fw.starterOffered(stepsWith({ 'first-move': 'done' })), false);
});

/* ---------------------------------------------------------- people nudge */

test('peopleNudgeVisible waits for day 2 and goes once the step is done', () => {
  assert.equal(fw.peopleNudgeVisible(1, stepsWith()), false, 'day 1 leaves people to the WelcomeSheet');
  assert.equal(fw.peopleNudgeVisible(2, stepsWith()), true);
  assert.equal(fw.peopleNudgeVisible(5, stepsWith({ 'social-spark': 'unknown' })), true);
  assert.equal(fw.peopleNudgeVisible(2, stepsWith({ 'social-spark': 'done' })), false);
  assert.equal(fw.peopleNudgeVisible(2, stepsWith({ 'social-spark': 'unavailable' })), false);
});

test('cardRows applies the nudge, collapses done steps and picks today among the drawn rows', () => {
  const day1 = fw.cardRows(stepsWith({ 'first-move': 'done', 'join-gym': 'done' }), 1);
  assert.deepEqual(day1.open, ['first-meal'], 'social-spark is not drawn on day 1');
  assert.deepEqual(day1.done, ['first-move', 'join-gym']);
  assert.equal(day1.today, 'first-meal', 'today falls through to a drawn row');
  const day3 = fw.cardRows(stepsWith({ 'first-move': 'done', 'join-gym': 'done' }), 3);
  assert.deepEqual(day3.open, ['social-spark', 'first-meal'], 'display order');
  assert.equal(day3.today, 'social-spark', 'planner order');
  const onlyPeople = fw.cardRows(stepsWith({ 'first-move': 'done', 'join-gym': 'done', 'first-meal': 'done' }), 1);
  assert.deepEqual(onlyPeople.open, [], 'nothing to draw on day 1: the container hides the card until day 2');
  assert.equal(onlyPeople.today, null);
  const hidden = fw.cardRows(stepsWith({ 'join-gym': 'unavailable' }), 2);
  assert.deepEqual(hidden.open, ['first-move', 'social-spark', 'first-meal']);
});

/* --------------------------------------------------------------- starter */

test('pickStarterTemplate matches by title (loosely), then by the four moves, else null', () => {
  const other = { _id: 'o', title: 'Morning Mobility', exercises: [{ name: 'Cat Cow', sets: 1, reps: 10 }] };
  assert.equal(fw.pickStarterTemplate([other, { ...SEED, title: 'foundation full body' }])._id, 'w1');
  assert.equal(fw.pickStarterTemplate([other, { ...SEED, title: 'Foundation Full-Body' }])._id, 'w1');
  assert.equal(fw.pickStarterTemplate([other, { ...SEED, _id: 'renamed', title: 'Beginner Base' }])._id, 'renamed', 'the four names still find it');
  assert.equal(fw.pickStarterTemplate([other]), null);
  assert.equal(fw.pickStarterTemplate([]), null);
  assert.equal(fw.pickStarterTemplate(null), null);
  assert.equal(fw.pickStarterTemplate(undefined), null);
});

test('starterMinutes prefers the catalogue duration and falls back to 18', () => {
  assert.equal(fw.STARTER_SESSION_MINUTES, 18);
  assert.equal(fw.starterMinutes(SEED), 28);
  assert.equal(fw.starterMinutes(null), 18);
  assert.equal(fw.starterMinutes({ ...SEED, duration: 0 }), 18);
  assert.equal(fw.starterMinutes({ ...SEED, duration: undefined }), 18);
  assert.equal(fw.starterMinutes({ ...SEED, duration: 27.6 }), 28);
});

test('starterLogSeed names the log Start here and forwards only name, sets and reps', () => {
  const seed = fw.starterLogSeed(SEED);
  assert.equal(seed.name, 'Start here');
  assert.equal(seed.type, 'strength');
  assert.equal(seed.duration, 28);
  assert.equal(seed.exercises.length, 4);
  assert.deepEqual(seed.exercises[0], { name: 'Bodyweight Squat', sets: 3, reps: 12 });
  for (const exercise of seed.exercises) {
    assert.ok(!('rest' in exercise), 'rest is not a log field');
    assert.ok(!('weight' in exercise));
    assert.ok(typeof exercise.sets === 'number' && typeof exercise.reps === 'number');
  }
  assert.ok(!('caloriesBurned' in seed), 'the member fills in what they actually did');
  assert.deepEqual(Object.keys(seed).sort(), ['duration', 'exercises', 'name', 'type']);

  const fallback = fw.starterLogSeed(null);
  assert.equal(fallback.name, 'Start here');
  assert.equal(fallback.type, 'strength');
  assert.equal(fallback.duration, 18);
  assert.deepEqual(
    fallback.exercises.map((e) => e.name),
    ['Bodyweight Squat', 'Incline Push-Up', 'Glute Bridge', 'Dead Bug'],
  );
  fallback.exercises[0].sets = 99;
  assert.equal(fw.STARTER_FALLBACK.exercises[0].sets, 3, 'the constant is not shared by reference');

  const yoga = fw.starterLogSeed({ ...SEED, category: 'yoga' });
  assert.equal(yoga.type, 'yoga');
  const empty = fw.starterLogSeed({ ...SEED, exercises: [] });
  assert.equal(empty.exercises.length, 4, 'an entry without exercises still seeds the four moves');
});

test('the hrefs point at routes the app has', () => {
  assert.deepEqual(fw.STEP_HREFS, {
    'first-move': '/workouts/logs?log=1',
    'social-spark': '/discover?tab=people',
    'join-gym': '/gyms',
    'first-meal': '/meals?log=1',
  });
  assert.equal(fw.STARTER_HREF, '/workouts/logs?log=1&starter=1');
  assert.equal(fw.START_EMPTY_HREF, '/workouts/logs?log=1');
  const app = read('src/App.tsx');
  for (const href of [...Object.values(fw.STEP_HREFS), fw.STARTER_HREF]) {
    const route = href.replace(/^\//, '').split('?')[0];
    assert.match(app, new RegExp(`path="${route}"`), `${href} has a route`);
  }
});

/* ------------------------------------------------------------- dismissal */

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    map,
  };
};

test('dismissal is per account, undone by clearDismissed, and never throws on a broken storage', () => {
  const storage = fakeStorage();
  assert.equal(fw.readDismissedAt(storage, 'u1'), null);
  fw.writeDismissed(storage, 'u1', 1_700_000_000_000);
  assert.equal(fw.readDismissedAt(storage, 'u1'), 1_700_000_000_000);
  assert.equal(fw.readDismissedAt(storage, 'u2'), null, 'another account is untouched');
  assert.deepEqual(JSON.parse(storage.getItem(fw.FIRST_WEEK_DISMISSED_KEY)), { u1: new Date(1_700_000_000_000).toISOString() });
  fw.writeDismissed(storage, 'u2', 1_700_000_100_000);
  fw.clearDismissed(storage, 'u1');
  assert.equal(fw.readDismissedAt(storage, 'u1'), null);
  assert.equal(fw.readDismissedAt(storage, 'u2'), 1_700_000_100_000);
  fw.clearDismissed(storage, 'u2');
  assert.equal(storage.getItem(fw.FIRST_WEEK_DISMISSED_KEY), null, 'an empty map is removed');
  assert.equal(fw.readDismissedAt(storage, null), null);
  fw.writeDismissed(storage, null, 1);
  assert.equal(storage.map.size, 0);

  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  assert.doesNotThrow(() => fw.writeDismissed(broken, 'u1', 1));
  assert.doesNotThrow(() => fw.clearDismissed(broken, 'u1'));
  assert.equal(fw.readDismissedAt(broken, 'u1'), null);
  assert.equal(fw.readDismissedAt(null, 'u1'), null);
  assert.equal(fw.readDismissedAt(undefined, 'u1'), null);

  storage.setItem(fw.FIRST_WEEK_DISMISSED_KEY, 'not json');
  assert.equal(fw.readDismissedAt(storage, 'u1'), null);
  storage.setItem(fw.FIRST_WEEK_DISMISSED_KEY, JSON.stringify({ u1: 'garbage' }));
  assert.equal(fw.readDismissedAt(storage, 'u1'), null);
});

/* --------------------------------------------------------------- strings */

const bannedPattern = (() => {
  const words = fw.FIRST_WEEK_BANNED.filter((w) => w !== '!').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${words.join('|')})\\b`, 'i');
})();

/** Every string the module can produce, calling functions with representative arguments. */
function walkStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    out.push(String(value(3, 4)));
    out.push(String(value(18)));
    out.push(String(value(['Log a workout', 'Follow someone'])));
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) walkStrings(v, out);
  return out;
}

const assertNoBanned = (text, where) => {
  assert.doesNotMatch(text, bannedPattern, `${where}: ${text}`);
  assert.ok(!text.includes('!'), `${where} has an exclamation mark: ${text}`);
};

test('no banned word or exclamation mark in any first-week string', () => {
  assert.ok(fw.FIRST_WEEK_BANNED.includes('streak') && fw.FIRST_WEEK_BANNED.includes('!'));
  const all = walkStrings(fw.firstWeekStrings);
  assert.ok(all.length >= 25, `walked ${all.length} strings`);
  for (const s of all) assertNoBanned(s, 'firstWeekStrings');
  for (const s of all) assert.doesNotMatch(s, /e-mail/i);
});

test('the copy is the spec copy, verbatim', () => {
  const s = fw.firstWeekStrings;
  assert.equal(s.card.title, 'Get started');
  assert.equal(s.card.progress(1, 4), '1 of 4 done');
  assert.equal(s.card.doneLine(['Log a workout', 'Follow someone']), 'Log a workout, Follow someone — done');
  assert.equal(s.today, 'Today');
  assert.deepEqual(s.steps['first-move'], { title: 'Log a workout', body: 'Any length counts.' });
  assert.deepEqual(s.steps['social-spark'], { title: 'Follow someone', body: 'Kudos on a post counts too.' });
  // Gym-agnostic on purpose: Home says "Find your gym" once, in the gym header's no-gym row, and nowhere else.
  assert.deepEqual(s.steps['join-gym'], { title: 'Join a gym', body: 'See who trains where you do.' });
  assert.deepEqual(s.steps['first-meal'], { title: 'Log a meal', body: 'A snack counts.' });
  assert.equal(s.dismiss.label, 'Not now, hide this card');
  assert.equal(s.dismiss.toast, 'Card hidden.');
  assert.equal(s.dismiss.undo, 'Undo');
  assert.equal(s.states.loading, 'Checking your first steps');
  assert.equal(s.states.error, 'Couldn’t load your first steps.');
  assert.equal(s.states.retryLabel, 'Retry loading your first steps');
  assert.equal(s.states.offline, 'You’re offline. Your first steps will show when you’re back online.');
  assert.equal(s.starter.sheetTitle, 'Your first session');
  assert.equal(s.starter.title(18), 'Start here · 18 min');
  assert.equal(s.starter.body(18), 'Four moves, bodyweight, about 18 minutes. Any length counts.');
  assert.equal(s.starter.empty, 'Start empty');
  assert.equal(s.starter.emptyBody, 'Add your own exercises.');
  assert.equal(s.starter.unavailable, 'The starter session isn’t available right now. Start empty instead.');
  assert.equal(s.starter.loading, 'Checking the starter session');
  assert.equal(s.starter.logDescription, 'Your first session is filled in. Adjust what you actually did.');
  assert.equal(s.starter.closeLabel, 'Close your first session');
  assert.ok(!('label' in s.starter) && !('emptyLabel' in s.starter), 'the starter links carry no name override: the visible text is the name');
});

/* ------------------------------------------------------------ source pins */

test('firstWeek.ts is import-free and free of hex colours', () => {
  const src = read('src/lib/firstWeek.ts');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b/);
});

test('Feed mounts the card once, right after the stories-and-composer region and before the feed', () => {
  const feed = read('src/pages/Feed.tsx');
  assert.match(feed, /^import FirstWeekCard from '\.\/FirstWeekCard';$/m);
  // Gym First: the stories row and the composer share one hairline region; the first-week module follows it.
  assert.match(feed, /<StoryTray variant="home"[^>]*\/>\s*<Composer[\s\S]*?\/>\s*<\/div>\s*<FirstWeekCard className="my-4" \/>/);
  assert.equal((feed.match(/<FirstWeekCard[^>]*\/>/g) || []).length, 1);
  assert.match(read('src/App.tsx'), /<WelcomeSheet \/>/, 'the WelcomeSheet stays mounted from App.tsx');
  assert.ok(!feed.includes('WelcomeSheet'), 'Feed does not mount a second WelcomeSheet');
});

test('the card reads only the getStartedCard kill switch and never a Wave F flag or route', () => {
  const card = read('src/pages/FirstWeekCard.tsx');
  assert.match(card, /features\?\.getStartedCard === false/);
  // An unanswered switch starts no read, but the card's frame is drawn in its loading state (the day
  // line is known), so it never pops into Home a beat after the page (Instagram rebuild, Q2).
  assert.match(card, /const featurePending = capabilities\.isPending;/);
  assert.match(card, /steps: null, featureOff: featurePending \|\| featureOff \}/, 'no read starts until the switch has answered');
  assert.match(card, /decideCard\(\{ userId, createdAt, now, dismissedAt, steps, featureOff \}\)/, 'the frame shows while the switch is undecided');
  assert.doesNotMatch(card, /useFeature\(['"]getStartedCard/);
  assert.doesNotMatch(card, /useFeature\(/);
  assert.doesNotMatch(card, /liveVideoEnabled|useLiveEnabled|livestreamRelay|features\.live\b/, 'the card never reads the Live gates');
  assert.equal((card.match(/useCapabilities\(\)/g) || []).length, 1, 'one capabilities read, the shared hook');
  for (const path of ['/invites', '/rhythm', '/onboarding', '/searching/suggest']) assert.ok(!card.includes(path), `${path} is not read by the card`);
  assert.doesNotMatch(card, /invited|activeThisWeek|healthImport|progression/);
  assert.doesNotMatch(card, /#[0-9a-fA-F]{3,6}\b/, 'tokens only');
  assert.ok(!card.includes('.message'), 'meals/streak.message is never rendered');
  assert.match(card, /lastLoggedDate/);
});

test('every api.get literal in the card and the model is pinned in contracts/backend-routes.json', () => {
  const contracts = read('contracts/backend-routes.json');
  const pinned = new Set([...contracts.matchAll(/"path":\s*"([^"]+)"/g)].map((m) => m[1]));
  const literals = [];
  for (const file of ['src/pages/FirstWeekCard.tsx', 'src/lib/firstWeek.ts']) {
    for (const m of read(file).matchAll(/api\.get(?:<[^>]*>)?\(\s*'([^']+)'/g)) literals.push(m[1]);
  }
  assert.ok(literals.length >= 4, `found ${literals.length} api.get literals`);
  for (const literal of literals) assert.ok(pinned.has(`/api${literal}`), `${literal} is pinned`);
  // The achievements vote goes through the shared hook, whose literal is pinned too.
  assert.match(read('src/pages/FirstWeekCard.tsx'), /fetchMyAchievements/);
  assert.ok(pinned.has('/api/achievements/user'));
  assert.ok(literals.includes('/workouts/commom/workouts/all/premade/fetch'), "the server's spelling is the pin");
  assert.ok(literals.includes('/workouts/logs') && literals.includes('/gyms/community/my-communities') && literals.includes('/meals/streak'));
});

test('History forwards ?starter=1 to the session route, which seeds the form from it; Discover opens the tab from ?tab=', () => {
  // /workouts/logs?log=1&starter=1 → (shell redirect) /workouts/history?log=1&starter=1 → /workouts/history/new?starter=1
  const history = read('src/pages/WorkoutHistory.tsx');
  assert.match(history, /params\.get\(['"]starter['"]\)/);
  assert.match(history, /n\.delete\('starter'\)/);
  assert.match(history, /TRAIN\.newSession\(\{ from: fromId \?\? undefined, starter: wantsStarter \}\)/);
  const session = read('src/pages/workouts/SessionDetail.tsx');
  assert.match(session, /params\.get\('starter'\) === '1'/);
  assert.match(session, /starterLogSeed\(/);
  assert.match(session, /pickStarterTemplate\(/);
  assert.match(session, /queryKey: \['workouts', 'premade'\]/);
  assert.equal(fw.STARTER_SEED_KEY, 'starter');
  assert.match(session, /key: STARTER_SEED_KEY/, 'the starter seed is keyed by the shared constant');
  assert.match(session, /description = firstWeekStrings\.starter\.logDescription;/, 'the starter gets its own description, never "Based on Start here."');
  assert.doesNotMatch(session, /Based on Start here/);
  const discover = read('src/pages/Discover.tsx');
  assert.match(discover, /useSearchParams/);
  assert.match(discover, /get\(['"]tab['"]\)/);
  assert.match(discover, /isTabKey\(urlTab\)/);
});

test('dismissing moves focus off the card before it leaves, and Undo brings it back', () => {
  const card = read('src/pages/FirstWeekCard.tsx');
  assert.match(card, /focusAfter\(event\.currentTarget\.closest\('\[role="region"\]'\)\);\s*writeDismissed\(/, 'focus moves first, while the card is still in the DOM');
  assert.match(card, /getElementById\('main'\)/, 'the shell’s main landmark is the fallback');
  assert.match(card, /restoreFocus\.current = true;/);
  assert.match(card, /\[data-testid="first-week-dismiss"\]'\)\?\.focus\(\)/);
});

test('the new test ids and labels exist and no existing ones were renamed', () => {
  const card = read('src/pages/FirstWeekCard.tsx');
  for (const id of ['first-week-card', 'first-week-day-line', 'first-week-today-tag', 'first-week-dismiss', 'starter-start-here', 'starter-start-empty']) {
    assert.ok(card.includes(`data-testid="${id}"`), id);
  }
  assert.ok(card.includes('data-testid={testId}') && card.includes('`first-week-row-${row.key}`'));
  const feed = read('src/pages/Feed.tsx');
  assert.match(feed, /aria-label="Loading your feed"/, 'an existing Feed label is untouched');
});
