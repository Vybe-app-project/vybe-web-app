/**
 * The Train hub's rows render from props alone (renderToString inside a
 * MemoryRouter): a workout row is one whole-row link plus one blue text
 * "Start", its meta line reads duration first, its preview names the first
 * three exercises, and nothing on it says "Not logged yet" or "Premade". A
 * programme row opens its schedule and carries no Start. The pure helpers
 * behind the meta and preview lines are pinned too.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const rows = await import('../src/pages/workouts/rows.tsx');

const render = (ui) => renderToString(h(MemoryRouter, null, h('ul', null, ui)));
const count = (html, needle) => html.split(needle).length - 1;

const yoga = {
  _id: 'w1',
  title: 'Recovery Yoga Flow',
  description: 'A gentle sequence emphasizing breathing, hips, and shoulders.',
  category: 'yoga',
  level: 'beginner',
  duration: 25,
  caloriesBurned: 90,
  isPremade: true,
  exercises: [{ name: 'Child Pose Breathing' }, { name: 'Low Lunge Flow' }, { name: 'Supported Pigeon' }, { name: 'Supine Twist' }],
};

test('workoutMeta: duration first, then level, category and energy; only what the record carries', () => {
  assert.equal(rows.workoutMeta(yoga), '25 min · Beginner · Yoga · 90 kcal');
  assert.equal(rows.workoutMeta({ ...yoga, duration: undefined, caloriesBurned: undefined }), 'Beginner · Yoga');
  assert.equal(rows.workoutMeta({ category: 'hiit', duration: 18 }), '18 min · HIIT');
  assert.equal(rows.workoutMeta({ exercises: [{ name: 'a' }, { name: 'b' }] }), '2 exercises', 'a bare record falls back to its exercise count');
  assert.equal(rows.workoutMeta(yoga, ['Done yesterday', false, null]), '25 min · Beginner · Yoga · 90 kcal · Done yesterday');
  assert.equal(rows.workoutMeta(yoga, ['Done yesterday', 'Private'], { compact: true }), '25 min · Done yesterday · Private', "a member's own row keeps duration and the extras only");
});

test('exercisePreview: the first three names, then how many more', () => {
  assert.equal(rows.exercisePreview(yoga.exercises), 'Child Pose Breathing · Low Lunge Flow · Supported Pigeon · +1');
  assert.equal(rows.exercisePreview(yoga.exercises.slice(0, 2)), 'Child Pose Breathing · Low Lunge Flow');
  assert.equal(rows.exercisePreview([]), '');
  assert.equal(rows.exercisePreview(undefined), '');
});

test('WorkoutRow: one whole-row link to the detail, one blue text Start, no description, no "Not logged yet", no Premade badge', () => {
  const html = render(h(rows.WorkoutRow, { workout: yoga, to: '/workouts/w1', startTo: '/workouts/history/new?from=w1' }));
  assert.match(html, /aria-label="Open Recovery Yoga Flow"[^>]*href="\/workouts\/w1"/);
  assert.equal(count(html, 'href="/workouts/history/new?from=w1"'), 1, 'exactly one Start link');
  assert.match(html, /aria-label="Start Recovery Yoga Flow"/);
  assert.ok(html.includes('>Start<'), 'the action reads "Start"');
  assert.ok(html.includes('text-brand'), 'the action is the blue text register');
  assert.ok(html.includes('25 min · Beginner · Yoga · 90 kcal'), 'meta line, duration first');
  assert.ok(html.includes('Child Pose Breathing · Low Lunge Flow · Supported Pigeon · +1'), 'exercise preview');
  assert.ok(!html.includes('Not logged yet'));
  assert.ok(!html.includes('Premade'));
  assert.ok(!html.includes('A gentle sequence'), 'the description stays on the detail sheet');
  assert.ok(!html.includes('More options'), 'a catalogue row has no overflow menu');
  assert.match(html, /aria-hidden="true"[^>]*class="[^"]*h-12 w-12/, 'the 48 px glyph tile is decorative');
  assert.ok(!html.includes('NaN'));
});

test('WorkoutRow: "Done …" and "Private" ride on the meta line only when passed; the owner menu appears only when given', () => {
  const html = render(h(rows.WorkoutRow, { workout: yoga, to: '/w', startTo: '/s', extra: ['Done yesterday', 'Private'], menu: [{ label: 'Edit' }], compact: true }));
  assert.ok(html.includes('25 min · Done yesterday · Private'));
  assert.ok(!html.includes('90 kcal'), 'compact rows drop the catalogue facets');
  assert.match(html, /aria-label="More options for Recovery Yoga Flow"/);
});

test('PlanRow: weeks · workouts · level, the first three workout titles, no Start', () => {
  const plan = {
    _id: 'p1',
    title: 'Four-Week Fitness Foundation',
    durationWeeks: 4,
    level: 'beginner',
    workouts: [
      { week: 1, day: 1, workout: { _id: 'a', title: 'Foundation Full Body' } },
      { week: 1, day: 3, workout: { _id: 'b', title: 'Low-Impact Cardio' } },
      { week: 1, day: 5, workout: { _id: 'c', title: 'Mobility Reset' } },
      { week: 2, day: 1, workout: { _id: 'd', title: 'Upper Body Strength' } },
      { week: 2, day: 3, workout: null },
    ],
  };
  const html = render(h(rows.PlanRow, { plan, to: '/workouts/plans/p1' }));
  assert.ok(html.includes('4 weeks · 4 workouts · Beginner'));
  assert.ok(html.includes('Foundation Full Body · Low-Impact Cardio · Mobility Reset · +1'));
  assert.match(html, /aria-label="Open Four-Week Fitness Foundation"[^>]*href="\/workouts\/plans\/p1"/);
  assert.ok(!html.includes('>Start<'), 'a programme row has no Start');
  assert.equal(rows.planMeta({ durationWeeks: 1, workouts: [] }), '1 week · Nothing scheduled yet', 'a zero is not a count');
});

test('RowSkeleton keeps the row geometry', () => {
  const html = renderToString(h(rows.RowSkeleton, { rows: 3 }));
  assert.equal(count(html, 'min-h-18'), 3);
  assert.match(html, /aria-hidden="true"/);
});
