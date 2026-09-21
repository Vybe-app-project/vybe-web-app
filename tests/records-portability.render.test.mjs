/**
 * P4's two surfaces render from props alone (renderToString inside a
 * MemoryRouter): the personal-records shelf draws one row per movement with
 * its best set, the estimated 1RM marked "est.", the best volume and when,
 * each name linking to /exercises/<id>; the adjustments footer asks nothing
 * until it is opened; and the import preview's counts, skipped rows and
 * exercise table come out of the dry-run payload as the API sends it.
 *
 * The pure model (lib/progress `shelfRows`, the import page's `previewFacts`
 * / `skippedRows` / `newSessions` / `mappingRows`) is exercised here too, so a
 * shape change in the payload fails a test rather than printing a NaN.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { ToastProvider } = await import('../src/components/ui.tsx');
const lib = await import('../src/lib/progress.ts');
const records = await import('../src/lib/records.ts');
const shelf = await import('../src/pages/progress/RecordsShelf.tsx');
const importPage = await import('../src/pages/workouts/ImportWorkouts.tsx');

const NOW = new Date(2026, 8, 20, 12);
const render = (ui) => renderToString(h(MemoryRouter, null, ui));
/** The page itself needs the providers the shell gives it (toasts, the query client). */
const mount = (ui) =>
  renderToString(
    h(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      h(MemoryRouter, null, h(ToastProvider, null, ui)),
    ),
  );
const count = (html, needle) => html.split(needle).length - 1;
/** Visible text only: class names and pixel attributes are full of digits. */
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;|&#x2019;/g, '’').replace(/&#xB7;|&middot;/g, '·').replace(/\s+/g, ' ');

const WORKOUT = '66f0000000000000000000a1';
const WORKOUT_2 = '66f0000000000000000000a2';

const EXERCISES = [
  { exerciseId: 'barbell-squat', name: 'Barbell Squat', sessions: 4, sets: 12, measure: 'reps', best: null },
  { exerciseId: 'plank', name: 'Plank', sessions: 2, sets: 0, measure: 'duration', best: null },
  { exerciseId: 'never-logged', name: 'Zercher Squat', sessions: 0, sets: 0, measure: 'reps', best: null },
];

const RECORDS = {
  'barbell-squat': {
    heaviestWeightKg: { value: 105, unit: 'kg', reps: 5, weightKg: 105, setId: 's1', date: '2026-09-05T10:00:00.000Z', workoutId: WORKOUT },
    bestSetVolumeKg: { value: 525, unit: 'kg', reps: 5, weightKg: 105, setId: 's1', date: '2026-09-05T10:00:00.000Z', workoutId: WORKOUT },
    mostReps: { value: 12, unit: 'reps', reps: 12, weightKg: 60, setId: 's4', date: '2026-08-02T10:00:00.000Z', workoutId: WORKOUT_2 },
    estimatedOneRepMaxKg: { value: 122.5, unit: 'kg', estimated: true, reps: 5, weightKg: 105, setId: 's1', date: '2026-09-05T10:00:00.000Z', workoutId: WORKOUT },
    longestDurationMin: null,
  },
  plank: {
    heaviestWeightKg: null,
    bestSetVolumeKg: null,
    mostReps: null,
    estimatedOneRepMaxKg: null,
    longestDurationMin: { value: 2, unit: 'min', date: '2026-09-01T10:00:00.000Z', workoutId: WORKOUT_2 },
  },
  'never-logged': null,
};

/* ------------------------------------------------------------- the shelf */

test('shelfRows: the records the payload carries, in reading order, with the ids the route parses', () => {
  const rows = lib.shelfRows(EXERCISES, RECORDS, 'metric', NOW);
  assert.equal(rows.length, 2, 'an exercise the member never recorded produces no row');
  assert.deepEqual(
    rows.map((row) => row.exerciseId),
    ['barbell-squat', 'plank'],
  );
  const squat = rows[0];
  assert.deepEqual(
    squat.facts.map((fact) => `${fact.label} ${fact.value}`),
    ['Best set 105 kg × 5', '1RM 122.5 kg', 'Best volume 525 kg'],
  );
  assert.equal(squat.facts[1].estimated, true, 'only Epley is an estimate');
  assert.equal(squat.facts[0].estimated, false);
  assert.equal(squat.facts.length, lib.SHELF_FACTS_MAX, 'three facts keep the row readable at 390 px');
  assert.equal(squat.when, '5 Sep', 'the newest of the row’s records');
  // The id the maintenance routes parse: <workoutId>:<exerciseId>:<setId> for a set.
  assert.equal(records.recordIdOf('barbell-squat', squat.facts[0]), `${WORKOUT}:barbell-squat:s1`);
  // An aggregate record has no set, so its id is the two-part form.
  const plank = rows[1];
  assert.deepEqual(
    plank.facts.map((fact) => `${fact.label} ${fact.value}`),
    ['Longest hold 2:00'],
  );
  assert.equal(records.recordIdOf('plank', plank.facts[0]), `${WORKOUT_2}:plank`);
  // Nothing the route would refuse is ever built.
  assert.equal(records.recordIdOf('plank', { workoutId: 'not-an-object-id', setId: null }), null);
  assert.equal(records.recordIdOf('plank', { workoutId: WORKOUT, setId: 'has:colon' }), null);
  assert.equal(records.recordIdOf('plank', null), null);

  const imperial = lib.shelfRows(EXERCISES, RECORDS, 'imperial', NOW);
  assert.equal(imperial[0].facts[0].value, '231.5 lb × 5', 'the viewer’s units, converted once in the model');
  assert.equal(imperial[0].facts[1].value, '270.1 lb');
});

test('RecordsShelf: a row per movement, links to the exercise page, "est." on the estimate', () => {
  const rows = lib.shelfRows(EXERCISES, RECORDS, 'metric', NOW);
  const html = render(h(shelf.RecordsShelf, { rows, showAll: false, onRemove: () => {}, onReset: () => {} }));
  assert.match(html, /data-testid="progress-bests"/);
  assert.ok(html.includes('Personal records'));
  assert.ok(html.includes('2 movements'));
  assert.ok(html.includes('href="/exercises/barbell-squat"'), 'the name is the link to the movement');
  assert.ok(html.includes('href="/exercises/plank"'));
  const text = textOf(html);
  assert.ok(text.includes('Best set 105 kg × 5'), text.slice(0, 400));
  assert.ok(text.includes('1RM 122.5 kg est.'), 'the estimate is marked');
  assert.ok(text.includes('Best volume 525 kg'));
  assert.ok(text.includes('Longest hold 2:00'));
  assert.ok(text.includes('· 5 Sep'));
  assert.ok(html.includes('aria-label="Records for Barbell Squat"'), 'the row menu names its movement');
  assert.ok(!html.includes('NaN'));
  // Nothing on the shelf competes for the screen's one blue.
  assert.ok(!html.includes('btn-primary'));

  const empty = render(h(shelf.RecordsShelf, { rows: [], showAll: false }));
  assert.ok(empty.includes('Records appear after your first logged sets.'));
  assert.ok(!empty.includes('<li'), 'no row, no dash, no zero');

  const loading = render(h(shelf.RecordsShelf, { rows: [], loading: true, showAll: false }));
  assert.ok(!loading.includes('Records appear after'), 'the empty state waits for the query');
  assert.equal(count(loading, '<li'), 3, 'skeleton rows in the final geometry');
});

test('RecordsShelf: eight rows until "Show all"', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({
    exerciseId: `lift-${i}`,
    name: `Lift ${i}`,
    when: '5 Sep',
    facts: [{ type: 'heaviestWeightKg', label: 'Best set', value: '100 kg × 5', estimated: false, date: '2026-09-05T10:00:00.000Z', workoutId: WORKOUT, setId: 's1' }],
  }));
  const collapsed = render(h(shelf.RecordsShelf, { rows: many, showAll: false, onToggle: () => {} }));
  assert.equal(count(collapsed, 'href="/exercises/'), shelf.SHELF_COLLAPSED);
  assert.ok(collapsed.includes('Show all'));
  const expanded = render(h(shelf.RecordsShelf, { rows: many, showAll: true, onToggle: () => {} }));
  assert.equal(count(expanded, 'href="/exercises/'), 11);
  assert.ok(expanded.includes('Show fewer'));
});

test('RecordAdjustments: closed it offers "Show" and claims no count; open it lists each undo', () => {
  const closed = render(h(shelf.RecordAdjustments, { open: false, rows: [], onOpen: () => {} }));
  assert.match(closed, /data-testid="progress-adjustments"/);
  assert.ok(closed.includes('Adjustments'));
  assert.ok(closed.includes('Show'));
  assert.ok(!closed.includes('Nothing has been removed'), 'nothing is claimed before the read');

  const rows = [
    { id: 'a1', exerciseId: 'barbell-squat', name: 'Barbell Squat', kind: 'exclude', text: lib.adjustmentLine('exclude', null, null) },
    { id: 'a2', exerciseId: 'plank', name: 'Plank', kind: 'reset', text: lib.adjustmentLine('reset', null, '1 Jan') },
  ];
  const open = render(h(shelf.RecordAdjustments, { open: true, rows, onUndo: () => {} }));
  const text = textOf(open);
  assert.ok(text.includes('Barbell Squat — One record removed'), text.slice(0, 300));
  assert.ok(text.includes('Plank — Records before 1 Jan do not count'));
  assert.equal(count(open, '>Undo<'), 2);

  const none = render(h(shelf.RecordAdjustments, { open: true, rows: [] }));
  assert.ok(none.includes('Nothing has been removed or reset.'));
});

test('ResetRecordsDialog renders nothing while it is closed', () => {
  const html = render(h(shelf.ResetRecordsDialog, { row: null, onClose: () => {}, onConfirm: () => {} }));
  assert.ok(!html.includes('Start fresh'), html);
});

/* ------------------------------------------------------------ the import */

const PREVIEW = {
  dryRun: true,
  format: 'strong',
  workouts: 84,
  sets: 612,
  exercises: 3,
  invalid: 1,
  alreadyImported: 2,
  unitDetected: null,
  distanceUnitDetected: null,
  dateRange: { from: '2023-01-10T14:00:00.000Z', to: '2026-03-08T11:00:00.000Z' },
  notes: { workouts: 31, exercises: 12 },
  matched: [
    { name: 'Bench Press (Barbell)', count: 212, workouts: 70, exerciseId: 'barbell-bench-press', exerciseName: 'Barbell Bench Press' },
    { name: 'Squat (Barbell)', count: 180, workouts: 60, exerciseId: 'barbell-squat', exerciseName: 'Barbell Squat' },
  ],
  unmatched: [
    {
      name: 'Chest Fly (Machine)',
      count: 45,
      workouts: 15,
      exerciseId: 'custom-chest-fly-machine',
      suggestions: [
        { exerciseId: 'pec-deck', name: 'Pec Deck' },
        { exerciseId: 'cable-fly', name: 'Cable Fly' },
      ],
    },
  ],
};

test('the preview reads the dry-run payload: counts, range, and what the commit passes over', () => {
  const facts = importPage.previewFacts(PREVIEW);
  assert.equal(facts[0], '84 sessions · 612 sets · 3 exercises');
  assert.equal(facts[1], '10 Jan 2023 to 8 Mar');
  assert.equal(importPage.newSessions(PREVIEW), 81, 'workouts minus the replays and the unstorable ones');

  const skipped = importPage.skippedRows(PREVIEW);
  assert.deepEqual(
    skipped.map((row) => [row.key, row.count]),
    [
      ['already', 2],
      ['invalid', 1],
    ],
  );
  // The API reports counts, never lines: neither row pretends to name one, and
  // each sentence agrees with its own count.
  assert.match(skipped[0].reason, /^sessions are already on Vybe/);
  assert.match(skipped[1].reason, /^session holds no sets/);
  assert.match(importPage.skippedRows({ ...PREVIEW, alreadyImported: 1, invalid: 2 })[0].reason, /^session is already on Vybe/);
  assert.match(importPage.skippedRows({ ...PREVIEW, alreadyImported: 1, invalid: 2 })[1].reason, /^sessions hold no sets/);
  assert.deepEqual(importPage.skippedRows({ ...PREVIEW, alreadyImported: 0, invalid: 0 }), [], 'no zeros');
  assert.equal(importPage.newSessions({ ...PREVIEW, workouts: 1, alreadyImported: 5, invalid: 0 }), 0, 'never negative');
});

test('mappingRows + MappingTable: matched names are settled, unmatched ones offer the picker', () => {
  const rows = importPage.mappingRows(PREVIEW, {});
  assert.deepEqual(
    rows.map((row) => [row.name, row.target, row.resolved]),
    [
      ['Bench Press (Barbell)', 'Barbell Bench Press', true],
      ['Squat (Barbell)', 'Barbell Squat', true],
      ['Chest Fly (Machine)', null, false],
    ],
  );
  const html = render(h(importPage.MappingTable, { rows, onChoose: () => {}, onKeepCustom: () => {} }));
  assert.match(html, /data-testid="import-mapping"/);
  const text = textOf(html);
  assert.ok(text.includes('Bench Press (Barbell) Barbell Bench Press · 212 sets'), text.slice(0, 400));
  assert.ok(text.includes('Chest Fly (Machine) Custom exercise · 45 sets'));
  assert.equal(count(html, '>Choose<'), 1, 'only the unmatched name is asked about');
  assert.equal(count(html, '>Keep as custom<'), 1);
  assert.ok(!html.includes('NaN'));

  // A pick settles the row and prints what was chosen.
  const picked = importPage.mappingRows(PREVIEW, { 'Chest Fly (Machine)': 'Pec Deck' });
  assert.deepEqual(picked[2], { name: 'Chest Fly (Machine)', sets: 45, target: 'Pec Deck', resolved: true, suggestions: PREVIEW.unmatched[0].suggestions });
  const after = render(h(importPage.MappingTable, { rows: picked, onChoose: () => {}, onKeepCustom: () => {} }));
  assert.equal(count(after, '>Choose<'), 0);
  assert.ok(textOf(after).includes('Chest Fly (Machine) Pec Deck · 45 sets'));

  assert.deepEqual(importPage.mappingRows(undefined, {}), [], 'nothing before the preview answers');
});

test('the import page renders its first step without a session or a picked file', () => {
  const html = mount(h(importPage.default));
  assert.match(html, /data-testid="import-pick"/);
  assert.ok(html.includes('Choose a file'));
  assert.ok(html.includes('A Strong or Hevy CSV export.'), 'the formats are named once');
  assert.ok(html.includes('Or paste the file’s text') || textOf(html).includes('Or paste the file’s text'));
  assert.equal(count(html, 'btn-primary'), 1, 'one filled blue on the screen');
  assert.ok(!html.includes('NaN'));
});
