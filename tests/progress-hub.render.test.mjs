/**
 * The progression hub's pure cards render from props alone (renderToString
 * inside a MemoryRouter): four neutral tiles with no trend icon or verdict
 * colour, one calendar cell per day with a spoken label and a link to the
 * log for trained days, the records "was" line, the muscle footnote, and
 * never a NaN. `system` and `unit` are props, so the zustand units store is
 * never read under renderToString.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { ProgressTiles } = await import('../src/pages/progress/ProgressTiles.tsx');
const { TrainingCalendar } = await import('../src/pages/progress/TrainingCalendar.tsx');
const { MuscleGroups } = await import('../src/pages/progress/MuscleGroups.tsx');
const { Movements } = await import('../src/pages/progress/Movements.tsx');
const { RecordsList } = await import('../src/pages/progress/RecordsList.tsx');
const lib = await import('../src/lib/progress.ts');

const NOW = new Date(2026, 8, 20, 12);
const render = (ui) => renderToString(h(MemoryRouter, null, ui));
const count = (html, needle) => html.split(needle).length - 1;

// The TrendingUp / TrendingDown glyphs (components/icons.tsx) by their path data.
const TRENDING_UP = 'm3 17 6-6 4 4 8-8';
const TRENDING_DOWN = 'm3 7 6 6 4-4 8 8';
const VERDICT_CLASS = /\b(text|bg|border)-(success|danger|accent)\b/;

const summary = {
  from: '2026-08-22T00:00:00.000Z',
  to: '2026-09-20T23:59:59.999Z',
  timezoneOffsetMinutes: 240,
  sessions: 4,
  totalVolumeKg: 3491.17,
  totalMinutes: 145,
  setCount: 20,
  byDay: [],
  prCount: 2,
  prs: [],
  previous: { from: '', to: '', sessions: 2, totalVolumeKg: 3491.17, totalMinutes: 175, setCount: 20 },
};

test('ProgressTiles: four tiles, the delta as neutral hint text, no trend icon, no verdict colour', () => {
  const html = render(h(ProgressTiles, { summary, unit: 'lb', days: 30 }));
  assert.match(html, /data-testid="progress-tiles"/);
  assert.match(html, /aria-label="This period"/);
  for (const label of ['Sessions', 'Sets', 'Volume', 'Minutes']) assert.ok(html.includes(label), label);
  assert.equal(count(html, 'vs the previous 30 days') + count(html, 'same as the previous 30 days'), 4, 'every tile carries a hint');
  assert.ok(html.includes('+2 vs the previous 30 days'), 'sessions up by two');
  assert.ok(html.includes('same as the previous 30 days'), 'equal volume and sets read "same"');
  assert.ok(html.includes('−30 min vs the previous 30 days'), 'fewer minutes with a real minus sign');
  assert.ok(html.includes('7,697 lb'), 'volume in the caller\'s unit');
  assert.ok(!html.includes(TRENDING_UP) && !html.includes(TRENDING_DOWN), 'no trend arrows');
  assert.doesNotMatch(html, VERDICT_CLASS, 'no success / danger / accent class');
  assert.ok(!html.includes('NaN'));

  const bare = render(h(ProgressTiles, { summary: { ...summary, previous: null }, unit: 'kg', days: 7 }));
  assert.equal(count(bare, 'previous 7 days'), 0, 'no hint without a previous window');
  assert.ok(bare.includes('3,491 kg'));
  const loading = render(h(ProgressTiles, { summary: undefined, unit: 'kg', days: 7, loading: true }));
  assert.ok(!loading.includes('Sessions'), 'skeleton tiles while loading');
  assert.ok(!loading.includes('NaN'));
});

test('TrainingCalendar: one cell per day with data-level and a spoken label; trained days link to the log', () => {
  const range = { from: '2026-09-01', to: '2026-09-10' };
  const days = [
    { date: '2026-09-01', sessions: 1, minutes: 45 },
    { date: '2026-09-03', sessions: 2, minutes: 60 },
    { date: '2026-09-07', sessions: 4, minutes: 90 },
  ];
  const html = render(h(TrainingCalendar, { range, days, now: NOW }));
  assert.match(html, /data-testid="progress-calendar"/);
  assert.match(html, /aria-label="Training days"/);
  assert.equal(count(html, 'data-level="'), 10, 'one <li> per day of the window');
  assert.equal(count(html, 'data-level="0"'), 7);
  assert.equal(count(html, 'data-level="1"'), 1);
  assert.equal(count(html, 'data-level="2"'), 1);
  assert.equal(count(html, 'data-level="3"'), 1);
  assert.ok(html.includes('href="/workouts/logs#day-2026-09-03"'), 'a trained day links to its log section');
  assert.ok(html.includes('href="/workouts/logs#day-2026-09-07"'));
  assert.ok(!html.includes('#day-2026-09-02'), 'an empty day is not a link');
  assert.ok(html.includes('<span class="sr-only">1 Sep, 1 session</span>'));
  assert.ok(html.includes('<span class="sr-only">2 Sep, 0 sessions</span>'));
  assert.ok(html.includes('3 Sep, 2 sessions'));
  assert.ok(html.includes('0 · 1 · 2 · 3+ sessions'), 'the legend');
  assert.ok(html.includes('3 training days · 7 sessions'));
  assert.ok(html.includes('bg-brand/25') && html.includes('bg-brand/55') && html.includes('bg-brand"'), 'the brand ramp');
  assert.doesNotMatch(html, VERDICT_CLASS);
  assert.ok(!html.includes('NaN'));

  const year = render(h(TrainingCalendar, { range: lib.periodRange('year', NOW), days: [], note: 'Showing 3 months. The year view arrives with a later update.', now: NOW }));
  assert.equal(count(year, 'data-level="'), 365);
  assert.ok(year.includes('Showing 3 months. The year view arrives with a later update.'));
  assert.ok(year.includes('>Sep<') && year.includes('>Jan<'), 'month labels over a year');
  assert.ok(!year.includes('NaN'));

  const week = render(h(TrainingCalendar, { range: lib.periodRange('week', NOW), days: [], now: NOW }));
  assert.equal(count(week, 'data-level="'), 7);
  assert.ok(week.includes('0 training days · 0 sessions'));
});

test('RecordsList: "was" for a pace record in the viewer\'s units, the empty state otherwise', () => {
  const prs = [
    { exerciseId: 'run', exerciseName: 'Run', type: 'bestPaceSecPerKm', value: 300, previousValue: 324, unit: 's/km', date: '2026-09-03T10:00:00.000Z', workoutId: 'w2' },
    { exerciseId: 'squat', exerciseName: 'Squat', type: 'estimatedOneRepMaxKg', value: 140, previousValue: 135, unit: 'kg', estimated: true, date: '2026-09-01T10:00:00.000Z', workoutId: 'w1' },
  ];
  const metric = render(h(RecordsList, { prs, system: 'metric', showAll: false, now: NOW }));
  assert.match(metric, /data-testid="progress-records"/);
  assert.ok(metric.includes('was 5:24 /km'), 'the beaten pace');
  assert.ok(metric.includes('5:00 /km'));
  assert.ok(metric.includes('Estimated 1RM: <span class="text-text-1">140 kg</span>, was 135 kg · 1 Sep'));
  assert.ok(metric.includes('2 records'));
  const imperial = render(h(RecordsList, { prs, system: 'imperial', showAll: false, now: NOW }));
  assert.ok(imperial.includes('was 8:41 /mi'));
  assert.ok(imperial.includes('308.6 lb'));
  const empty = render(h(RecordsList, { prs: [], system: 'metric', showAll: false, now: NOW }));
  assert.ok(empty.includes('No new records this period'));
  assert.ok(empty.includes('Log a session and beat your own past.'));
  assert.ok(!empty.includes('Show all'));
  const many = Array.from({ length: 25 }, (_, i) => ({ ...prs[1], workoutId: `w${i}`, date: '2026-09-01T10:00:00.000Z' }));
  const collapsed = render(h(RecordsList, { prs: many, system: 'metric', showAll: false, onToggle: () => {}, now: NOW }));
  assert.equal(count(collapsed, '<li'), 20);
  assert.ok(collapsed.includes('Show all'));
  const expanded = render(h(RecordsList, { prs: many, system: 'metric', showAll: true, onToggle: () => {}, now: NOW }));
  assert.equal(count(expanded, '<li'), 25);
  assert.ok(expanded.includes('Show fewer'));
  for (const html of [metric, imperial, empty, collapsed]) {
    assert.ok(!html.includes('NaN'));
    assert.doesNotMatch(html, VERDICT_CLASS);
  }
});

test('MuscleGroups: Other, "+n secondary", the library footnote, top eight until Show all', () => {
  const groups = [
    { group: 'other', sets: 10, secondarySets: 0 },
    { group: 'glutes', sets: 6, secondarySets: 0 },
    { group: 'hamstrings', sets: 0, secondarySets: 6 },
    ...lib.MUSCLE_GROUPS.filter((g) => g !== 'glutes' && g !== 'hamstrings').map((group) => ({ group, sets: 0, secondarySets: 0 })),
  ];
  const html = render(h(MuscleGroups, { groups, showAll: false, onToggle: () => {} }));
  assert.match(html, /data-testid="progress-muscles"/);
  assert.ok(html.includes('Other'));
  assert.ok(html.includes('Front delts'));
  assert.ok(html.includes('+6 secondary'));
  assert.ok(html.includes('Counts sets on exercises the library knows. Custom exercises count under Other.'));
  assert.equal(count(html, '<li'), 8);
  assert.ok(html.includes('Show all'));
  assert.ok(html.includes('width:100%') && html.includes('width:60%'), 'bars against the busiest group');
  const all = render(h(MuscleGroups, { groups, showAll: true, onToggle: () => {} }));
  assert.equal(count(all, '<li'), 17);
  assert.ok(all.includes('Show fewer'));
  const empty = render(h(MuscleGroups, { groups: [], showAll: false }));
  assert.ok(empty.includes('Log a session and this fills in.'));
  for (const out of [html, all, empty]) {
    assert.ok(!out.includes('NaN'));
    assert.doesNotMatch(out, VERDICT_CLASS);
  }
});

test('Movements: a button per exercise with sessions and the best in the viewer\'s units', () => {
  const exercises = [
    { exerciseId: 'squat', name: 'Squat', sessions: 4, sets: 12, measure: 'reps', best: { type: 'estimatedOneRepMaxKg', value: 140, unit: 'kg' } },
    { exerciseId: 'run', name: 'Run', sessions: 1, sets: 0, measure: 'distance', best: { type: 'bestPaceSecPerKm', value: 324, unit: 's/km' } },
    { exerciseId: 'row', name: 'Row', sessions: 1, sets: 3, measure: 'reps', best: null },
  ];
  const html = render(h(Movements, { exercises, system: 'imperial', onOpen: () => {} }));
  assert.match(html, /data-testid="progress-movements"/);
  assert.equal(count(html, '<button'), 3);
  assert.ok(html.includes('4 sessions · Estimated 1RM 308.6 lb'));
  assert.ok(html.includes('1 session · Best pace 8:41 /mi'));
  assert.ok(html.includes('>Row<'));
  const empty = render(h(Movements, { exercises: [], system: 'metric', onOpen: () => {} }));
  assert.ok(empty.includes('Log a session and this fills in.'));
  assert.ok(!html.includes('NaN'));
  assert.doesNotMatch(html, VERDICT_CLASS);
});
