/**
 * The progression hub's pure model (src/lib/progress.ts) over the Wave F1
 * records API: period ranges in the API's raw timezone convention, neutral
 * deltas, the Monday-first calendar grid with empty days present, pace and
 * distance in both unit systems, record formatting, the Epley trend series
 * and the flag-off detector.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const lib = await import('../src/lib/progress.ts');
const units = await import('../src/lib/unitConversions.ts');

const LB = 0.45359237;
const MINUS = '−';
const NOW = new Date(2026, 8, 20, 15, 30); // 20 Sep 2026, local clock

/* ------------------------------------------------------------------ periods */

test('periodRange: 7 / 30 / 91 / 365 local days ending today, offset raw (never negated)', () => {
  assert.deepEqual(lib.PERIOD_DAYS, { week: 7, month: 30, quarter: 91, year: 365 });
  assert.equal(lib.YEAR_FALLBACK, 'quarter');
  for (const [period, days] of Object.entries(lib.PERIOD_DAYS)) {
    const range = lib.periodRange(period, NOW);
    assert.equal(range.days, days, period);
    assert.equal(range.to, '2026-09-20', `${period} ends today`);
    assert.equal(range.timezoneOffsetMinutes, NOW.getTimezoneOffset(), `${period} sends getTimezoneOffset() as-is`);
    assert.equal(lib.calendarGrid(range, []).cells.length, days, `${period} covers exactly ${days} days`);
  }
  assert.equal(lib.periodRange('week', NOW).from, '2026-09-14');
  assert.equal(lib.periodRange('month', NOW).from, '2026-08-22');
  assert.equal(lib.periodRange('quarter', NOW).from, '2026-06-22');
  assert.equal(lib.periodRange('year', NOW).from, '2025-09-21');
  // Default `now` is the wall clock and the offset matches a fresh Date.
  const live = lib.periodRange('week');
  assert.equal(live.timezoneOffsetMinutes, new Date().getTimezoneOffset());
  assert.equal(lib.isProgressPeriod('year'), true);
  assert.equal(lib.isProgressPeriod('decade'), false);
  assert.equal(lib.isProgressPeriod(null), false);
});

test('day keys: shifting crosses months and years by calendar days, weekday from the date alone', () => {
  assert.equal(lib.shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(lib.shiftDateKey('2024-03-01', -1), '2024-02-29');
  assert.equal(lib.shiftDateKey('2026-01-01', -1), '2025-12-31');
  assert.equal(lib.shiftDateKey('2026-09-20', 0), '2026-09-20');
  assert.equal(lib.mondayIndex('2026-09-01'), 1, 'a Tuesday');
  assert.equal(lib.mondayIndex('2026-09-14'), 0, 'a Monday');
  assert.equal(lib.mondayIndex('2026-09-20'), 6, 'a Sunday');
  assert.deepEqual(lib.parseDateKey('2026-02-30'), null);
  assert.deepEqual(lib.parseDateKey('2026-9-3'), null);
  assert.deepEqual(lib.parseDateKey('2026-09-03'), { y: 2026, m: 9, d: 3 });
});

test('periodLabel: same month, across months, across years; shortDate on keys and instants', () => {
  assert.equal(lib.periodLabel({ from: '2026-09-01', to: '2026-09-07' }), '1–7 Sep');
  assert.equal(lib.periodLabel({ from: '2026-08-22', to: '2026-09-20' }), '22 Aug–20 Sep');
  assert.equal(lib.periodLabel({ from: '2025-09-21', to: '2026-09-20' }), '21 Sep 2025–20 Sep 2026');
  assert.equal(lib.periodLabel({ from: 'nope', to: '2026-09-20' }), '');
  assert.equal(lib.shortDate('2026-09-03', NOW), '3 Sep');
  assert.equal(lib.shortDate('2025-09-03', NOW), '3 Sep 2025');
  assert.equal(lib.shortDate('2026-09-03T10:00:00.000Z', NOW), '3 Sep');
  assert.equal(lib.shortDate('', NOW), '');
  assert.equal(lib.shortDate('garbage', NOW), '');
});

/* ------------------------------------------------------------------ deltas and tiles */

test('deltas are neutral numbers: "+2", "−1" with U+2212, "same"; volume compares whole units after conversion', () => {
  assert.equal(lib.countDelta(4, 2), '+2');
  assert.equal(lib.countDelta(2, 3), `${MINUS}1`);
  assert.equal(lib.countDelta(2, 3).charCodeAt(0), 0x2212, 'a real minus sign, not a hyphen');
  assert.equal(lib.countDelta(3, 3), 'same');
  assert.equal(lib.volumeDelta(1000, 0, 'lb'), '+2,205 lb');
  assert.equal(lib.volumeDelta(3491.17, 3491.17, 'kg'), 'same');
  assert.equal(lib.volumeDelta(1000, 1000.4, 'kg'), 'same', 'float noise under half a unit is not a change');
  assert.equal(lib.volumeDelta(800, 2000, 'kg'), `${MINUS}1,200 kg`);
  assert.equal(lib.minutesDelta(145, 30), '+115 min');
  assert.equal(lib.minutesDelta(30, 30), 'same');
});

test('statTiles: four rows, hints only when the API sent `previous`', () => {
  const summary = { sessions: 4, setCount: 20, totalVolumeKg: 3491.17, totalMinutes: 145, previous: { from: '', to: '', sessions: 2, totalVolumeKg: 1000, totalMinutes: 145, setCount: 21 } };
  const tiles = lib.statTiles(summary, 'kg', 30);
  assert.deepEqual(tiles.map((t) => t.key), ['sessions', 'sets', 'volume', 'minutes']);
  assert.deepEqual(tiles.map((t) => t.label), ['Sessions', 'Sets', 'Volume', 'Minutes']);
  assert.deepEqual(tiles.map((t) => t.value), ['4', '20', '3,491 kg', '2 h 25 min']);
  assert.deepEqual(tiles.map((t) => t.hint), ['+2 vs the previous 30 days', `${MINUS}1 vs the previous 30 days`, '+2,491 kg vs the previous 30 days', 'same as the previous 30 days']);
  const lb = lib.statTiles(summary, 'lb', 7);
  assert.equal(lb[2].value, '7,697 lb');
  assert.equal(lb[2].hint, '+5,492 lb vs the previous 7 days');
  const withoutPrevious = lib.statTiles({ sessions: 1, setCount: 3, totalVolumeKg: 100, totalMinutes: 20 }, 'kg', 30);
  for (const tile of withoutPrevious) assert.equal(tile.hint, undefined);
  const empty = lib.statTiles(undefined, 'kg', 30);
  assert.deepEqual(empty.map((t) => t.value), ['0', '0', '0 kg', '0 min']);
  for (const tile of [...tiles, ...withoutPrevious, ...empty]) assert.ok(!`${tile.value} ${tile.hint ?? ''}`.includes('NaN'));
});

/* ------------------------------------------------------------------ calendar */

test('calendarGrid: every day present once, missing dates at zero, Monday-first padding, a year fits 53 columns', () => {
  const range = { from: '2026-09-01', to: '2026-09-10' };
  const grid = lib.calendarGrid(range, [
    { date: '2026-09-01', sessions: 1, minutes: 45 },
    { date: '2026-09-03', sessions: 5, minutes: 90 },
    { date: '2026-09-07', sessions: 2, minutes: 30 },
  ], NOW);
  assert.deepEqual(grid.cells.map((c) => c.date), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  assert.equal(new Set(grid.cells.map((c) => c.date)).size, 10, 'each day once');
  const second = grid.cells[1];
  assert.equal(second.sessions, 0);
  assert.equal(second.level, 0);
  assert.equal(second.label, '2 Sep, 0 sessions');
  assert.equal(grid.cells[0].label, '1 Sep, 1 session');
  assert.equal(grid.cells[2].level, 3, 'five sessions cap at the top of the ramp');
  assert.equal(grid.cells[6].level, 2);
  assert.equal(grid.totalSessions, 8);
  assert.equal(grid.activeDays, 3);
  // 2026-09-01 is a Tuesday: one null before it; every column has seven slots.
  assert.equal(grid.columns[0][0], null);
  assert.equal(grid.columns[0][1]?.date, '2026-09-01');
  for (const column of grid.columns) assert.equal(column.length, 7);
  assert.equal(grid.columns.length, 2);
  assert.equal(grid.columns.flat().filter(Boolean).length, 10, 'padding adds no cells');

  const year = lib.calendarGrid(lib.periodRange('year', NOW), [], NOW);
  assert.equal(year.cells.length, 365);
  assert.ok(year.columns.length <= 53, `year columns: ${year.columns.length}`);
  assert.equal(year.columns.flat().filter(Boolean).length, 365);

  assert.equal(lib.rampLevel(0), 0);
  assert.equal(lib.rampLevel(1), 1);
  assert.equal(lib.rampLevel(2), 2);
  assert.equal(lib.rampLevel(5), 3);
  assert.deepEqual(lib.calendarGrid({ from: '2026-09-10', to: '2026-09-01' }, []).cells, [], 'an inverted range draws nothing');
  assert.deepEqual(lib.calendarGrid({ from: 'x', to: 'y' }, []).columns, []);
});

/* ------------------------------------------------------------------ pace, distance, clocks */

test('pace and distance print in both systems; clocks roll into hours', () => {
  assert.equal(lib.formatPace(300, 'metric'), '5:00 /km');
  assert.equal(lib.formatPace(300, 'imperial'), '8:03 /mi');
  assert.equal(lib.formatPace(324, 'metric'), '5:24 /km');
  assert.equal(lib.formatPace(0, 'metric'), '');
  assert.equal(lib.formatDistanceKm(5, 'metric'), '5.0 km');
  assert.equal(lib.formatDistanceKm(5, 'imperial'), '3.1 mi');
  assert.equal(lib.formatDistanceKm(42.195, 'metric'), '42.2 km');
  assert.equal(lib.formatClock(3723), '1:02:03');
  assert.equal(lib.formatClock(324), '5:24');
  assert.equal(lib.formatClock(0), '0:00');
  assert.equal(units.KM_PER_MI, 1.609344);
  assert.equal(units.kmToMi(5), 3.1);
  assert.equal(units.miToKm(3.1), 4.99);
  assert.equal(units.distanceUnit('metric'), 'km');
  assert.equal(units.distanceUnit('imperial'), 'mi');
});

/* ------------------------------------------------------------------ records */

test('formatRecordValue converts kg and km for display and leaves reps and clocks alone', () => {
  assert.equal(lib.formatRecordValue('estimatedOneRepMaxKg', 140, 'imperial'), '308.6 lb');
  assert.equal(lib.formatRecordValue('estimatedOneRepMaxKg', 140, 'metric'), '140 kg');
  assert.equal(lib.formatRecordValue('heaviestWeightKg', 102.5, 'metric'), '102.5 kg');
  assert.equal(lib.formatRecordValue('bestSetVolumeKg', 1200, 'metric'), '1,200 kg');
  assert.equal(lib.formatRecordValue('mostReps', 20), '20 reps');
  assert.equal(lib.formatRecordValue('mostReps', 1), '1 rep');
  assert.equal(lib.formatRecordValue('longestDurationMin', 27), '27:00');
  assert.equal(lib.formatRecordValue('longestDurationMin', 1.5), '1:30');
  assert.equal(lib.formatRecordValue('longestDistanceKm', 5, 'imperial'), '3.1 mi');
  assert.equal(lib.formatRecordValue('bestPaceSecPerKm', 324, 'metric'), '5:24 /km');
  assert.deepEqual([...lib.RECORD_TYPES], ['heaviestWeightKg', 'bestSetVolumeKg', 'mostReps', 'estimatedOneRepMaxKg', 'longestDurationMin', 'longestDistanceKm', 'bestPaceSecPerKm']);
  assert.deepEqual(Object.values(lib.RECORD_TYPE_TITLES), ['Heaviest weight', 'Best set volume', 'Most reps', 'Estimated 1RM', 'Longest hold', 'Longest distance', 'Best pace']);
  assert.equal(lib.lowerIsBetter('bestPaceSecPerKm'), true);
  assert.equal(lib.lowerIsBetter('mostReps'), false);
});

test('recordRows: "was" from previousValue, dates short, estimated flagged, unknown types dropped', () => {
  const prs = [
    { exerciseId: 'squat', exerciseName: 'Squat', type: 'estimatedOneRepMaxKg', value: 140, previousValue: 135, unit: 'kg', estimated: true, date: '2026-09-03T10:00:00.000Z', workoutId: 'w1' },
    { exerciseId: 'run', exerciseName: 'Run', type: 'bestPaceSecPerKm', value: 300, previousValue: 324, unit: 's/km', date: '2026-09-02T10:00:00.000Z', workoutId: 'w2' },
    { exerciseId: 'row', exerciseName: 'Row', type: 'mostReps', value: 15, previousValue: null, unit: 'reps', date: '2026-09-01T10:00:00.000Z', workoutId: 'w3' },
    { exerciseId: 'x', exerciseName: 'X', type: 'fastestSprint', value: 1, unit: '?', date: '2026-09-01T10:00:00.000Z', workoutId: 'w4' },
  ];
  const rows = lib.recordRows(prs, 'imperial', NOW);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].title, rows[0].value, rows[0].was, rows[0].date, rows[0].estimated], ['Estimated 1RM', '308.6 lb', '297.6 lb', '3 Sep', true]);
  assert.deepEqual([rows[1].title, rows[1].value, rows[1].was], ['Best pace', '8:03 /mi', '8:41 /mi']);
  assert.deepEqual(lib.recordRows(prs, 'metric', NOW)[1].was, '5:24 /km');
  assert.equal(rows[2].was, null);
  assert.equal(new Set(rows.map((r) => r.key)).size, 3, 'keys are unique');
  assert.deepEqual(lib.recordRows(undefined, 'metric'), []);
});

test('movementRows and muscleRows follow the API order and label the best in the viewer\'s units', () => {
  const movements = lib.movementRows([
    { exerciseId: 'squat', name: 'Squat', sessions: 4, sets: 12, measure: 'reps', best: { type: 'estimatedOneRepMaxKg', value: 140, unit: 'kg' } },
    { exerciseId: 'plank', name: 'Plank', sessions: 2, sets: 0, measure: 'duration', best: { type: 'longestDurationMin', value: 2, unit: 'min' } },
    { exerciseId: 'run', name: 'Run', sessions: 1, sets: 0, measure: 'distance', best: { type: 'bestPaceSecPerKm', value: 324, unit: 's/km' } },
    { exerciseId: 'row', name: 'Row', sessions: 1, sets: 3, measure: 'reps', best: null },
  ], 'imperial');
  assert.deepEqual(movements.map((m) => m.best), ['Estimated 1RM 308.6 lb', 'Longest hold 2:00', 'Best pace 8:41 /mi', null]);
  assert.deepEqual(movements.map((m) => m.sessionsLabel), ['4 sessions', '2 sessions', '1 session', '1 session']);

  assert.equal(lib.muscleName('front-delts'), 'Front delts');
  assert.equal(lib.muscleName('other'), 'Other');
  assert.equal(lib.MUSCLE_GROUPS.length, 16);
  const groups = [
    { group: 'other', sets: 10, secondarySets: 0 },
    { group: 'glutes', sets: 6, secondarySets: 0 },
    { group: 'hamstrings', sets: 0, secondarySets: 6 },
    ...lib.MUSCLE_GROUPS.filter((g) => g !== 'glutes' && g !== 'hamstrings').map((group) => ({ group, sets: 0, secondarySets: 0 })),
  ];
  assert.equal(groups.length, 17);
  const collapsed = lib.muscleRows(groups, false);
  assert.equal(collapsed.rows.length, 8);
  assert.equal(collapsed.hasMore, true);
  assert.equal(collapsed.total, 17);
  assert.deepEqual([collapsed.rows[0].name, collapsed.rows[0].fraction], ['Other', 1]);
  assert.equal(collapsed.rows[1].fraction, 0.6);
  assert.equal(collapsed.rows[2].secondarySets, 6);
  assert.equal(lib.muscleRows(groups, true).rows.length, 17);
  assert.equal(lib.muscleRows([], false).hasMore, false);
  assert.equal(lib.muscleRows([{ group: 'chest', sets: 0, secondarySets: 0 }], true).rows[0].fraction, 0, 'no division by zero');
});

/* ------------------------------------------------------------------ trends */

const history = [
  {
    workoutId: 'new', date: '2026-09-10T10:00:00.000Z', name: 'B', exerciseName: 'Squat', volumeKg: 0,
    sets: [
      { id: 's1', reps: 8, weight: 225, weightUnit: 'lb', completed: true },
      { id: 's2', reps: 8, weight: 315, weightUnit: 'lb', completed: false },
    ],
  },
  {
    workoutId: 'old', date: '2026-09-01T10:00:00.000Z', name: 'A', exerciseName: 'Squat', volumeKg: 0,
    sets: [
      { id: 's3', reps: 10, weight: 100, weightUnit: 'kg', completed: true },
      { id: 's4', reps: 13, weight: 100, weightUnit: 'kg', completed: true },
      { id: 's5', reps: 5, weight: 120, weightUnit: 'kg', completed: false },
    ],
  },
  { workoutId: 'legacy', date: '2026-08-01T10:00:00.000Z', name: 'L', exerciseName: 'Squat', volumeKg: 0, sets: [{ reps: 10, weight: 200, weightUnit: 'kg', synthetic: true }] },
  { workoutId: 'none', date: '2026-08-15T10:00:00.000Z', name: 'N', exerciseName: 'Squat', volumeKg: 0, sets: [{ id: 's6', reps: 10, weight: 0, weightUnit: 'kg', completed: true }] },
];

test('trendSeries(reps): best Epley per session from completed non-synthetic 1–12-rep sets, oldest first, lb through 0.45359237', () => {
  const metric = lib.trendSeries('reps', history, 'metric', NOW);
  assert.equal(metric.what, 'Estimated 1RM');
  assert.equal(metric.unit, 'kg');
  assert.equal(metric.lowerIsBetter, false);
  assert.deepEqual(metric.points.map((p) => p.workoutId), ['old', 'new'], 'synthetic and bodyweight-only sessions draw no point');
  assert.equal(metric.points[0].value, 133.3, '100 kg × 10 → 133.3 kg; the 13-rep set and the unchecked 120 kg set are skipped');
  assert.equal(metric.points[1].value, Math.round(225 * LB * (1 + 8 / 30) * 10) / 10);
  assert.equal(metric.points[0].label, '1 Sep');
  const imperial = lib.trendSeries('reps', history, 'imperial', NOW);
  assert.equal(imperial.unit, 'lb');
  assert.equal(imperial.points[1].value, 285, '225 lb × 8 → 285 lb');
  assert.equal(imperial.points[0].value, Math.round((100 / LB) * (1 + 10 / 30) * 10) / 10);
  assert.equal(lib.trendDescription(metric), 'Estimated 1RM over 2 sessions, from 1 Sep to 10 Sep');
  assert.equal(lib.trendDescription({ ...metric, points: [] }), 'Estimated 1RM: no sessions yet');
  assert.equal(lib.formatTrendValue(imperial, 285), '285 lb');
});

test('trendSeries(distance) is pace = minutes × 60 / km, lower is better; (duration) is seconds', () => {
  const runs = [
    { workoutId: 'r2', date: '2026-09-03T10:00:00.000Z', name: 'Day 2', exerciseName: 'Run', sets: [], volumeKg: 0, durationMin: 25, distanceKm: 5 },
    { workoutId: 'r1', date: '2026-09-01T10:00:00.000Z', name: 'Day 1', exerciseName: 'Run', sets: [], volumeKg: 0, durationMin: 27, distanceKm: 5 },
    { workoutId: 'r0', date: '2026-08-30T10:00:00.000Z', name: 'Day 0', exerciseName: 'Run', sets: [], volumeKg: 0, distanceKm: 3 },
  ];
  const pace = lib.trendSeries('distance', runs, 'metric', NOW);
  assert.equal(pace.lowerIsBetter, true);
  assert.equal(pace.unit, 's/km');
  assert.deepEqual(pace.points.map((p) => p.value), [324, 300], 'the run without a time has no pace');
  assert.equal(lib.formatTrendValue(pace, 324), '5:24 /km');
  const miles = lib.trendSeries('distance', runs, 'imperial', NOW);
  assert.equal(miles.unit, 's/mi');
  assert.deepEqual(miles.points.map((p) => p.value), [521, 483]);
  assert.equal(lib.formatTrendValue(miles, 483), '8:03 /mi');
  const holds = lib.trendSeries('duration', [
    { workoutId: 'h1', date: '2026-09-01T10:00:00.000Z', name: 'H', exerciseName: 'Plank', sets: [], volumeKg: 0, durationMin: 1.5 },
    { workoutId: 'h0', date: '2026-08-01T10:00:00.000Z', name: 'H', exerciseName: 'Plank', sets: [], volumeKg: 0 },
  ], 'metric', NOW);
  assert.deepEqual(holds.points.map((p) => p.value), [90]);
  assert.equal(lib.formatTrendValue(holds, 90), '1:30');
});

/* ------------------------------------------------------------------ session lines and the suggestion */

test('sessionLine: reps grouped by load in the unit logged, synthetic rows approximate, timed and distance rows in their own words', () => {
  assert.deepEqual(lib.formatRepsSets([
    { id: 'a', reps: 12, weight: 100, weightUnit: 'kg', completed: true },
    { id: 'b', reps: 12, weight: 100, weightUnit: 'kg', completed: true },
    { id: 'c', reps: 10, weight: 90, weightUnit: 'kg', completed: true },
    { id: 'd', reps: 10, weight: 90, weightUnit: 'kg', completed: false },
  ]), { text: '100 kg × 12, 12 · 90 kg × 10', approximate: false });
  assert.deepEqual(lib.formatRepsSets([{ reps: 10, weight: 60, weightUnit: 'kg', synthetic: true }, { reps: 10, weight: 60, weightUnit: 'kg', synthetic: true }]), { text: '60 kg × 10, 10', approximate: true });
  assert.deepEqual(lib.formatRepsSets([{ id: 'p', reps: 20, weight: 0, weightUnit: 'kg', completed: true }]), { text: '20 reps', approximate: false });
  assert.equal(lib.sessionLine({ workoutId: 'r', date: '', name: '', exerciseName: '', sets: [], volumeKg: 0, durationMin: 27, distanceKm: 5 }, 'metric').text, '5.0 km · 27:00 · 5:24 /km');
  assert.equal(lib.sessionLine({ workoutId: 'r', date: '', name: '', exerciseName: '', sets: [], volumeKg: 0, durationMin: 27, distanceKm: 5 }, 'imperial').text, '3.1 mi · 27:00 · 8:41 /mi');
  assert.equal(lib.sessionLine({ workoutId: 'r', date: '', name: '', exerciseName: '', sets: [], volumeKg: 0, distanceKm: 5 }, 'metric').text, '5.0 km');
  assert.equal(lib.sessionLine({ workoutId: 'p', date: '', name: '', exerciseName: '', sets: [], volumeKg: 0, durationMin: 2 }, 'metric').text, '2:00');
  assert.equal(lib.sessionLine({ workoutId: 'e', date: '', name: '', exerciseName: '', sets: [{ id: 'x', reps: 5, weight: 50, weightUnit: 'kg', completed: false }], volumeKg: 0 }, 'metric').text, 'No completed sets');
});

test('the suggestion prints in S1\'s unit as-is, names its rule and its two basis sessions', () => {
  const suggested = {
    kind: 'add', weight: 102.5, weightUnit: 'kg', reps: 8, range: { min: 8, max: 12 }, rule: 'top-of-range-twice', step: 2.5,
    basis: [
      { workoutId: 'w2', date: '2026-09-03T10:00:00.000Z', sets: [{ reps: 12, weight: 100, weightUnit: 'kg', working: true }, { reps: 12, weight: 100, weightUnit: 'kg', working: true }, { reps: 15, weight: 60, weightUnit: 'kg', working: false }] },
      { workoutId: 'w1', date: '2026-09-01T10:00:00.000Z', sets: [{ reps: 12, weight: 100, weightUnit: 'kg', working: true }] },
    ],
  };
  assert.equal(lib.suggestionLine(suggested), 'Try 102.5 kg × 8 · top of your range twice');
  assert.equal(lib.suggestionRule(suggested), 'When every working set reaches the top of your rep range two sessions in a row, the suggestion adds 2.5 kg.');
  assert.equal(lib.basisLine(suggested.basis[0], NOW), '3 Sep · 100 kg × 12, 12', 'only the sets the rule counted');
  assert.equal(lib.suggestionLine({ ...suggested, kind: 'hold', reps: 9, rule: 'hold' }), 'Same weight, aim for 9 · one more rep than last time');
  assert.equal(lib.suggestionRule({ ...suggested, kind: 'hold' }), 'Otherwise the suggestion keeps the weight and adds one rep.');
  assert.equal(lib.suggestionLine({ ...suggested, kind: 'deload', weight: 90, rule: 'below-range-twice' }), 'Lighter this time: 90 kg × 8 · below your range twice');
  assert.equal(lib.suggestionRule({ ...suggested, kind: 'deload' }), 'When a working set falls below the bottom of your range two sessions in a row, the suggestion takes ten percent off.');
  assert.equal(lib.suggestionLine({ ...suggested, weight: 230, weightUnit: 'lb', step: 5 }), 'Try 230 lb × 8 · top of your range twice', 'an lb suggestion is never converted');
  assert.equal(lib.suggestionRule({ ...suggested, weightUnit: 'lb', step: 5 }), 'When every working set reaches the top of your rep range two sessions in a row, the suggestion adds 5 lb.');
  assert.equal(lib.rangeNote({ min: 8, max: 12 }), 'Your range: 8–12 reps. Change it in Settings.');
});

/* ------------------------------------------------------------------ flags and preferences */

test('isFeatureDisabled is true only for a 404 carrying code FEATURE_DISABLED', () => {
  assert.equal(lib.isFeatureDisabled({ response: { status: 404, data: { code: 'FEATURE_DISABLED', message: "The training calendar isn't available on your account yet.", feature: 'progression' } } }), true);
  assert.equal(lib.isFeatureDisabled({ response: { status: 404, data: { message: 'Not found' } } }), false, 'a plain 404');
  assert.equal(lib.isFeatureDisabled({ response: { status: 403, data: { code: 'FEATURE_DISABLED' } } }), false);
  assert.equal(lib.isFeatureDisabled({ response: { status: 404, data: { error: { code: 'FEATURE_DISABLED' } } } }), true, 'the enveloped shape too');
  assert.equal(lib.isFeatureDisabled(new Error('boom')), false);
  assert.equal(lib.isFeatureDisabled(null), false);
});

test('workoutPreferencesOf: 8–12 and hints on by default; a stored range and switch are echoed; junk falls back', () => {
  assert.deepEqual(lib.workoutPreferencesOf({}), { progressionHints: true, defaultRepRange: { min: 8, max: 12 } });
  assert.deepEqual(lib.workoutPreferencesOf(null), { progressionHints: true, defaultRepRange: { min: 8, max: 12 } });
  assert.deepEqual(lib.workoutPreferencesOf({ settings: { workout: { progressionHints: false, defaultRepRange: { min: 5, max: 8 } } } }), { progressionHints: false, defaultRepRange: { min: 5, max: 8 } });
  assert.deepEqual(lib.workoutPreferencesOf({ settings: { workout: { defaultRepRange: { min: 12, max: 8 } } } }).defaultRepRange, { min: 8, max: 12 }, 'an inverted range is not trusted');
  assert.deepEqual(lib.workoutPreferencesOf({ settings: { workout: { defaultRepRange: { min: '5', max: 8 } } } }).defaultRepRange, { min: 8, max: 12 });
  assert.deepEqual(lib.validRepRange({ min: 1, max: 50 }), { min: 1, max: 50 });
  assert.equal(lib.validRepRange({ min: 0, max: 50 }), null);
  assert.equal(lib.validRepRange({ min: 8, max: 8 }), null);
  assert.deepEqual(lib.DEFAULT_REP_RANGE, { min: 8, max: 12 });
  assert.deepEqual(lib.REP_RANGE_BOUNDS, { min: 1, max: 50 });
});

test('the copy carries no exclamation marks and none of the design\'s banned words', () => {
  const banned = /streak|missed|lost|behind|crushed|beast|smash|weak|fat\b|weight loss|lean|calories|burn|!/i;
  const walk = (value) => (typeof value === 'string' ? [value] : Object.values(value).flatMap(walk));
  for (const text of [...walk(lib.PROGRESS_STRINGS), ...Object.values(lib.RECORD_TYPE_TITLES)]) {
    assert.doesNotMatch(text, banned, text);
  }
});
