import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const enrolment = await import('../src/pages/workouts/enrolment.tsx');
const folders = await import('../src/pages/workouts/folders.tsx');
const programs = await import('../src/lib/programs.ts');
const continueMod = await import('../src/pages/workouts/continue.ts');
const { TRAIN, programSlotFromParams } = await import('../src/pages/workouts/sheet.ts');

const render = (ui) => renderToString(h(MemoryRouter, null, ui));
const count = (html, needle) => html.split(needle).length - 1;

/**
 * The programme surfaces, rendered from props alone (src/pages/workouts/enrolment.tsx)
 * and the rules they read from (src/lib/programs.ts).
 *
 * The register this is checked against: one filled blue per screen, so the
 * card's "Start this plan" is the only `btn-primary` before joining and there
 * is none after it; the schedule is a text-only day list with rest days named;
 * and nothing anywhere says a day was missed, that a week is locked or that
 * anything resets — a plan is a suggestion the member can leave and come back to.
 */

const row = (over = {}) => ({
  week: 1,
  day: 1,
  order: 1,
  workoutId: 'w1',
  title: 'Foundation Full Body',
  exerciseCount: 4,
  estimatedMin: 28,
  state: 'todo',
  isNext: false,
  ...over,
});

const progress = (done, total, skipped = 0) => ({ done, skipped, total, ratio: total ? done / (total - skipped) : 0 });

/* ------------------------------------------------------------------- card */

test('not enrolled: the shape of the plan, the promise that nothing is forced, and the page’s one filled blue', () => {
  const html = render(h(enrolment.EnrolmentCard, { state: 'none', durationWeeks: 4, sessionCount: 12, onStart: () => {} }));
  assert.ok(html.includes('12 sessions over 4 weeks.'), 'the plan is described before it is joined');
  assert.ok(html.includes('The schedule is a suggestion.'));
  assert.ok(html.includes('>Start this plan<'));
  assert.equal(count(html, 'btn-primary'), 1, 'exactly one filled blue');
  assert.ok(!html.includes('Week 2'), 'no programme state before there is one');
  // The vocabulary of punishment never appears on this surface.
  for (const banned of ['missed', 'behind', 'locked', 'reset', 'streak']) assert.ok(!html.toLowerCase().includes(banned), `“${banned}” is not this product`);
});

test('enrolled: the fraction, the one next-up row, and a blue text Start that carries the slot', () => {
  const to = TRAIN.liveSession({ from: 'w9', program: { planId: 'p1', week: 2, day: 3, order: 1 } });
  const html = render(
    h(enrolment.EnrolmentCard, {
      state: 'active',
      progress: progress(5, 12),
      suggestedWeek: 2,
      durationWeeks: 4,
      next: row({ week: 2, day: 3, workoutId: 'w9', title: 'Lower Body Strength', estimatedMin: 42, isNext: true }),
      nextTo: to,
      menu: [{ label: 'Pause' }],
    }),
  );
  assert.ok(html.includes('Week 2 of 4 · 5 of 12 done'));
  assert.ok(html.includes('Next: Wed · Lower Body Strength · 42 min'));
  // The href is HTML-escaped in the string React renders.
  assert.ok(html.includes(`href="${to.replace(/&/g, '&amp;')}"`), 'Start opens the runner with the slot attached');
  assert.ok(html.includes('text-brand'), 'Start is the blue text register');
  assert.equal(count(html, 'btn-primary'), 0, 'the filled blue is spent once the member is on the plan');
  assert.match(html, /aria-label="Plan options"/);
});

test('paused says so and keeps its next-up row; a finished plan reads as complete and offers no next', () => {
  const paused = render(h(enrolment.EnrolmentCard, { state: 'paused', progress: progress(5, 12), suggestedWeek: 2, durationWeeks: 4, next: row({ isNext: true }), nextTo: '/workouts/session' }));
  assert.ok(paused.includes('Paused · Week 2 of 4 · 5 of 12 done'));
  assert.ok(paused.includes('>Start<'), 'a paused plan is still a plan you can train today');

  const done = render(h(enrolment.EnrolmentCard, { state: 'completed', progress: progress(12, 12), suggestedWeek: 4, durationWeeks: 4 }));
  assert.ok(done.includes('Plan complete · 12 of 12 done'));
  assert.ok(!done.includes('Next:'));
});

test('a left enrolment reads as never having started, so the plan can simply be started again', () => {
  const html = render(h(enrolment.EnrolmentCard, { state: 'left', durationWeeks: 4, sessionCount: 12 }));
  assert.ok(html.includes('>Start this plan<'));
  assert.ok(!html.includes('Week'));
});

/* -------------------------------------------------------------- week list */

const week = (over = {}) => ({
  week: 1,
  done: 1,
  total: 3,
  days: [
    { day: 1, label: 'Mon', rest: false, rows: [row({ state: 'done' })] },
    { day: 2, label: 'Tue', rest: true, rows: [] },
    { day: 3, label: 'Wed', rest: false, rows: [row({ day: 3, workoutId: 'w2', title: 'Low-Impact Cardio', estimatedMin: 24, state: 'skipped' })] },
    { day: 4, label: 'Thu', rest: true, rows: [] },
    { day: 5, label: 'Fri', rest: false, rows: [row({ day: 5, workoutId: 'w3', title: 'Mobility Reset', estimatedMin: 16, isNext: true })] },
    { day: 6, label: 'Sat', rest: true, rows: [] },
    { day: 7, label: 'Sun', rest: true, rows: [] },
  ],
  ...over,
});

const weekList = (over = {}) =>
  render(
    h(enrolment.WeekList, {
      weeks: [week(), { week: 2, done: 0, total: 0, days: [{ day: 1, label: 'Mon', rest: true, rows: [] }] }],
      open: new Set([1]),
      onToggle: () => {},
      workoutTo: (id) => `/workouts/${id}`,
      ...over,
    }),
  );

test('the week list is a text-only day list: Monday to Sunday, rest days named and dimmed', () => {
  const html = weekList();
  assert.ok(html.includes('Mon · Foundation Full Body · 28 min'));
  assert.ok(html.includes('Wed · Low-Impact Cardio · 24 min'));
  assert.ok(html.includes('Tue · Rest'));
  assert.ok(html.includes('Sun · Rest'));
  assert.equal(count(html, ' · Rest'), 4, 'every empty day is a rest day, not an absence');
  assert.ok(html.includes('text-text-3'), 'rest days are dimmed');
  assert.ok(!html.includes('Nothing scheduled'));
});

test('a session that happened is ticked, one taken out says so, and the pointer is the only "Next"', () => {
  const html = weekList();
  assert.ok(html.includes('text-success'), 'the ✓ is the one place green means a completed state');
  assert.equal(count(html, '>Skipped<'), 1);
  assert.equal(count(html, '>Next<'), 1);
});

test('weeks collapse: a closed week draws its summary and none of its rows', () => {
  const html = weekList();
  assert.match(html, /aria-expanded="true"[\s\S]*?Week 1/);
  assert.ok(html.includes('>Week 2<'));
  assert.ok(html.includes('Rest week'), 'a week with nothing in it says so in its header');
  assert.equal(count(html, 'aria-expanded="false"'), 1);
});

test('the per-slot menu and the owner’s remove control only appear when they are given', () => {
  const plain = weekList();
  assert.ok(!plain.includes('Options for'));
  assert.ok(!plain.includes('Remove '));

  const full = weekList({
    menuFor: () => [{ label: 'Mark done' }],
    ownerAction: (r) => h('span', null, `Remove ${r.title}`),
  });
  assert.match(full, /aria-label="Options for Foundation Full Body on week 1, Mon"/);
  assert.ok(full.includes('Remove Foundation Full Body'));
});

test('a week header counts what is done while enrolled, and what there is before', () => {
  assert.equal(enrolment.weekSummary(week(), true), '1 of 3 done');
  assert.equal(enrolment.weekSummary(week(), false), '3 sessions');
  assert.equal(enrolment.weekSummary({ week: 2, done: 0, total: 0, days: [] }, true), 'Rest week');
  assert.equal(enrolment.slotLine('Mon', { title: 'Push day', estimatedMin: 0 }), 'Mon · Push day');
  assert.equal(enrolment.slotLine('Mon', { title: null, estimatedMin: 30 }), 'Mon · Session · 30 min');
});

/* ------------------------------------------------------------ the schedule */

test('scheduleWeeks reads a plan nobody has joined: every declared week, every day, states all todo', () => {
  const weeks = programs.scheduleWeeks({
    slots: [
      { week: 1, day: 1, workoutId: 'w1', title: 'Foundation Full Body', estimatedMin: 28 },
      { week: 1, day: 3, order: 2, workoutId: 'w2', title: 'Mobility Reset', estimatedMin: 16 },
    ],
    durationWeeks: 4,
  });
  assert.deepEqual(weeks.map((w) => w.week), [1, 2, 3, 4], 'a week the plan advertises is readable even when empty');
  assert.equal(weeks[0].days.length, 7);
  assert.equal(weeks[0].total, 2);
  assert.equal(weeks[0].done, 0);
  assert.equal(weeks[0].days[0].rows[0].state, 'todo');
  assert.equal(weeks[0].days[0].rows[0].order, 1, 'a slot with no order is the first of its day');
  assert.equal(weeks[0].days[2].rows[0].order, 2);
  assert.ok(weeks[0].days[1].rest);
  assert.equal(weeks[3].total, 0, 'an unfilled week is a rest week, not a missing one');
});

test('scheduleWeeks prefers the enrolment view, and marks exactly the pointer as next', () => {
  const weeks = programs.scheduleWeeks({
    slots: [{ week: 1, day: 1, workoutId: 'ignored', title: 'Stale' }],
    schedule: [
      {
        week: 1,
        sessions: [
          { week: 1, day: 1, order: 1, workoutId: 'w1', title: 'Foundation Full Body', exerciseCount: 4, estimatedMin: 28, state: 'done' },
          { week: 1, day: 3, order: 1, workoutId: 'w2', title: 'Low-Impact Cardio', exerciseCount: 3, estimatedMin: 24, state: 'skipped' },
          { week: 1, day: 5, order: 1, workoutId: 'w3', title: 'Mobility Reset', exerciseCount: 4, estimatedMin: 16, state: 'todo' },
        ],
      },
    ],
    pointer: { week: 1, day: 5, order: 1 },
    durationWeeks: 1,
  });
  assert.ok(!JSON.stringify(weeks).includes('Stale'), 'the enrolment view wins over the plan document');
  assert.equal(weeks[0].done, 1);
  assert.equal(weeks[0].total, 3);
  const next = weeks[0].days.flatMap((d) => d.rows).filter((r) => r.isNext);
  assert.equal(next.length, 1);
  assert.equal(next[0].title, 'Mobility Reset');
});

test('the page opens on the suggested week, falls back to the pointer, then to the first week', () => {
  const weeks = [1, 2, 3].map((w) => ({ week: w, days: [], done: 0, total: 0 }));
  assert.equal(programs.openWeek(weeks, 2, { week: 3 }), 2);
  assert.equal(programs.openWeek(weeks, null, { week: 3 }), 3);
  assert.equal(programs.openWeek(weeks, 9, null), 1, 'a suggested week past the plan does not open nothing');
  assert.equal(programs.openWeek([], null, null), 1);
});

/* ----------------------------------------------------------- the one-liners */

test('the programme state is one line, and a number that is not there is left out', () => {
  assert.equal(programs.progressLine(progress(5, 12), 2, 4), 'Week 2 of 4 · 5 of 12 done');
  assert.equal(programs.progressLine(progress(5, 12, 2), 2, 4), 'Week 2 of 4 · 5 of 12 done · 2 skipped');
  assert.equal(programs.progressLine(progress(0, 0), 2, null), 'Week 2');
  assert.equal(programs.progressLine(null, null, 4), '');
  assert.equal(programs.nextUpLine({ day: 3, title: 'Lower Body Strength', estimatedMin: 42 }), 'Wed · Lower Body Strength · 42 min');
  assert.equal(programs.nextUpLine({ day: 3, title: 'Lower Body Strength', estimatedMin: null }), 'Wed · Lower Body Strength');
  assert.equal(programs.nextUpLine(null), '');
  assert.equal(programs.dayName(7), 'Sun');
  assert.equal(programs.dayName(9), 'Day 9');
});

test('a row’s meta says where the member is on that plan, and says nothing when they are not on it', () => {
  const item = (status, suggestedWeek, durationWeeks = 4) => ({
    enrollment: { status },
    plan: { _id: 'p1', title: 'Strength Builder', durationWeeks },
    pointer: null,
    progress: progress(0, 0),
    suggestedWeek,
  });
  assert.equal(programs.enrolledMeta(item('active', 2)), 'Enrolled · Week 2 of 4');
  assert.equal(programs.enrolledMeta(item('paused', 2)), 'Paused · Week 2 of 4');
  assert.equal(programs.enrolledMeta(item('completed', 4)), 'Completed');
  assert.equal(programs.enrolledMeta(item('left', 2)), null);
  assert.equal(programs.enrolledMeta(item('active', null, null)), 'Enrolled');
  assert.equal(programs.enrolledMeta(null), null);
  assert.equal(programs.enrolledMeta({ enrollment: null, plan: null, pointer: null, progress: progress(0, 0), suggestedWeek: null }), null);
});

test('"Shift schedule to this week" moves the anchor back whole weeks and nothing else', () => {
  const now = new Date(2026, 8, 21); // Monday 21 September 2026, local
  assert.equal(programs.shiftAnchor(1, now), '2026-09-21');
  assert.equal(programs.shiftAnchor(3, now), '2026-09-07');
  assert.equal(programs.shiftAnchor(0, now), '2026-09-21', 'a nonsense week is this week');
  assert.equal(programs.dateKey(new Date(2026, 0, 5)), '2026-01-05', 'a local date, never a UTC shift of it');
});

/* ------------------------------------------------------- the flag, the slot */

test('a flag-off answer is a state, not an error; anything else is an error', () => {
  const err = (status, code) => ({ response: { status, data: code ? { code, feature: 'programs' } : {} } });
  assert.equal(programs.isFeatureDisabled(err(404, 'FEATURE_DISABLED')), true);
  assert.equal(programs.isFeatureDisabled(err(404)), true, 'a deployment with no router mounted reads the same way');
  assert.equal(programs.isFeatureDisabled(err(404, 'PLAN_NOT_FOUND')), false);
  assert.equal(programs.isFeatureDisabled(err(500)), false);
  assert.equal(programs.isFeatureDisabled(null), false);
  assert.equal(programs.disabledFeature(err(404, 'FEATURE_DISABLED')), 'programs');
  assert.equal(programs.disabledFeature(err(500)), null);
});

test('the runner URL carries the slot, and reads it back only when all four parts are there', () => {
  assert.equal(TRAIN.liveSession({ from: 'w1' }), '/workouts/session?from=w1');
  assert.equal(TRAIN.liveSession({ from: 'w1', program: { planId: 'p1', week: 2, day: 3, order: 1 } }), '/workouts/session?from=w1&plan=p1&week=2&day=3&order=1');
  assert.equal(TRAIN.liveSession({ program: null }), '/workouts/session');
  assert.deepEqual(programSlotFromParams(new URLSearchParams('plan=p1&week=2&day=3&order=1')), { planId: 'p1', week: 2, day: 3, order: 1 });
  assert.equal(programSlotFromParams(new URLSearchParams('plan=p1&week=2&day=3')), null, 'a half-written link marks nothing');
  assert.equal(programSlotFromParams(new URLSearchParams('plan=p1&week=0&day=3&order=1')), null);
  assert.equal(programSlotFromParams(new URLSearchParams('from=w1')), null);
});

test('the hub continues the running plan at its pointer, never a paused or finished one', () => {
  const item = (status, pointer) => ({ enrollment: { status }, plan: { _id: 'p1', title: 'Strength Builder', durationWeeks: 6 }, pointer, progress: progress(4, 18), suggestedWeek: 2 });
  const pointer = { week: 2, day: 3, order: 1, workoutId: 'w9' };
  const going = continueMod.continueProgramOf([item('active', pointer)]);
  assert.equal(going.label, 'Continue Strength Builder · Week 2 · Day 3');
  assert.equal(going.workoutId, 'w9');
  assert.equal(going.to, '/workouts/session?from=w9&plan=p1&week=2&day=3&order=1');
  assert.equal(continueMod.continueProgramOf([item('paused', pointer)]), null, 'a paused plan was paused on purpose');
  assert.equal(continueMod.continueProgramOf([item('completed', null)]), null);
  assert.equal(continueMod.continueProgramOf([item('active', null)]), null, 'a finished schedule has nothing to continue');
  assert.equal(continueMod.continueProgramOf([]), null);
});

/* ----------------------------------------------------------------- folders */

test('the folder chips exist only once the member has a folder, and Unfiled only once something is in it', () => {
  const list = [
    { _id: 'f1', name: 'Push days', order: 0, count: 3 },
    { _id: 'f2', name: 'Pull days', order: 1, count: 2 },
  ];
  assert.deepEqual(folders.folderChips([], 0, 5), [], 'nobody is shown an organising system they never asked for');
  const chips = folders.folderChips(list, 4, 9);
  assert.deepEqual(chips.map((c) => c.label), ['All', 'Push days', 'Pull days', 'Unfiled']);
  assert.deepEqual(chips.map((c) => c.count), [9, 3, 2, 4]);
  assert.equal(folders.folderChips(list, 0, 5).length, 3, 'no Unfiled chip when nothing is unfiled');
  assert.equal(folders.folderTotal(chips, 'f1'), 3);
  assert.equal(folders.folderTotal(chips, 'nope'), undefined);

  assert.equal(folders.inFolder({ folder: 'f1' }, 'all'), true);
  assert.equal(folders.inFolder({ folder: 'f1' }, 'f1'), true);
  assert.equal(folders.inFolder({ folder: 'f1' }, 'f2'), false);
  assert.equal(folders.inFolder({ folder: null }, 'unfiled'), true);
  assert.equal(folders.inFolder({}, 'unfiled'), true, 'a routine from before folders existed is unfiled');
  assert.equal(folders.inFolder({ folder: 'f1' }, 'unfiled'), false);

  const html = render(h(folders.FolderChips, { chips, value: 'f1', onChange: () => {} }));
  assert.match(html, /aria-label="Folders"/);
  assert.ok(html.includes('Push days 3'));
  assert.equal(count(html, 'aria-pressed="true"'), 1, 'one chip is chosen at a time');
  assert.equal(render(h(folders.FolderChips, { chips: [], value: 'all', onChange: () => {} })), '');
});
