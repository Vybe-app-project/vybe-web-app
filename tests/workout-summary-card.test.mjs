/**
 * The workout share card on posts: numbers print in the unit the member
 * trained in (the API stores kilograms), hidden fields never resurface, and
 * the card is wired into the feed card and the public post page.
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
const lib = await import('../src/lib/workoutSummary.ts');

const LB = 0.45359237;
const card = {
  workoutId: '6aad635402be1805f4b9ef72',
  name: 'Push day',
  date: '2026-09-18T18:30:00.000Z',
  durationMin: 62,
  setCount: 18,
  exerciseCount: 5,
  volumeKg: 12400 * LB,
  unit: 'lb',
  prCount: 2,
  muscleGroups: ['chest', 'shoulders', 'triceps'],
  exercises: [
    { exerciseId: 'bench-press', name: 'Bench press', setCount: 4, bestSet: { reps: 5, weightKg: 225 * LB } },
    { exerciseId: 'push-up', name: 'Push-up', setCount: 3, bestSet: { reps: 20, weightKg: 0 } },
    { name: 'Dip', setCount: 3, bestSet: null },
    { name: 'Fly', setCount: 4, bestSet: { reps: 12, weightKg: 15 * LB } },
    { name: 'Skullcrusher', setCount: 4, bestSet: { reps: 10, weightKg: 60 * LB } },
  ],
};

test('numbers print in the unit the member trained in; kg is the default for old cards', () => {
  assert.equal(lib.summaryUnit({ unit: 'lb' }), 'lb');
  assert.equal(lib.summaryUnit({}), 'kg');
  assert.equal(lib.summaryUnit({ unit: 'stone' }), 'kg');
  assert.equal(lib.formatSummaryWeight(225 * LB, 'lb'), '225 lb');
  assert.equal(lib.formatSummaryWeight(102.5, 'kg'), '102.5 kg');
  assert.equal(lib.formatSummaryVolume(12400 * LB, 'lb'), '12,400 lb');
  assert.equal(lib.formatSummaryVolume(5624.6, 'kg'), '5,625 kg');
  assert.equal(lib.formatBestSet({ reps: 5, weightKg: 225 * LB }, 'lb'), '225 lb × 5');
  assert.equal(lib.formatBestSet({ reps: 20, weightKg: 0 }, 'lb'), '20 reps');
  assert.equal(lib.formatBestSet({ reps: 1 }, 'kg'), '1 rep');
  assert.equal(lib.formatBestSet(null, 'kg'), '');
  assert.equal(lib.formatDuration(62), '1 h 2 min');
  assert.equal(lib.formatDuration(45), '45 min');
  assert.equal(lib.formatDuration(120), '2 h');
});

test('hidden or empty fields produce no stat, never a zero', () => {
  const stats = lib.summaryStats(card).map((s) => [s.key, s.value]);
  assert.deepEqual(stats, [['exercises', '5'], ['sets', '18'], ['volume', '12,400 lb'], ['duration', '1 h 2 min'], ['prs', '2']]);
  // The author hid weights and volume (the API removed volumeKg) and duration.
  const hidden = { ...card, volumeKg: undefined, durationMin: undefined, prCount: 0, hiddenFields: ['weights', 'volume', 'duration'] };
  assert.deepEqual(lib.summaryStats(hidden).map((s) => s.key), ['exercises', 'sets']);
  assert.deepEqual(lib.summaryStats({ workoutId: 'x' }), []);
  assert.equal(lib.hasWorkoutSummary(card), true);
  assert.equal(lib.hasWorkoutSummary(null), false);
  assert.equal(lib.hasWorkoutSummary({ name: 'no id' }), false);
});

test('the card renders the unit, the best sets, the muscle groups and the overflow', async () => {
  const { createElement: h } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { WorkoutSummaryCard } = await import('../src/pages/WorkoutSummaryCard.tsx');
  const html = renderToString(h(MemoryRouter, null, h(WorkoutSummaryCard, { summary: card })));
  assert.match(html, /aria-label="Workout summary: Push day"/);
  assert.match(html, /data-unit="lb"/);
  for (const text of ['12,400 lb', '225 lb × 5', '20 reps', '1 h 2 min', 'chest', 'shoulders', 'triceps', '+1 more exercise']) {
    assert.ok(html.includes(text), `card shows ${text}`);
  }
  assert.ok(!html.includes('NaN'));
  // A kg card with nothing hidden and no name falls back to "Workout".
  const kg = renderToString(h(MemoryRouter, null, h(WorkoutSummaryCard, { summary: { workoutId: 'x', setCount: 3, volumeKg: 1200, exercises: [{ name: 'Squat', setCount: 3, bestSet: { reps: 5, weightKg: 100 } }] } })));
  assert.match(kg, /Workout summary: Workout"/);
  assert.ok(kg.includes('1,200 kg') && kg.includes('100 kg × 5'));
});

test('feed cards and the public post page show the card between media and text', () => {
  const postCard = read('src/pages/PostCard.tsx');
  const publicPost = read('src/pages/PublicPost.tsx');
  for (const source of [postCard, publicPost]) {
    assert.match(source, /hasWorkoutSummary\(post\.workoutSummary\) \? <WorkoutSummaryCard summary=\{post\.workoutSummary\} className="mt-3" \/> : null/);
    assert.ok(source.indexOf('<PostMediaGrid') < source.indexOf('<WorkoutSummaryCard summary'), 'media first');
    assert.ok(source.indexOf('<WorkoutSummaryCard summary') < source.indexOf('<PostContent text={post.content}'), 'card before the text');
  }
  assert.match(read('src/lib/hooks.ts'), /workoutSummary\?: WorkoutSummary;/);
});
