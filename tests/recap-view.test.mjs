/** The recap viewer's view model: units, records, locked copy, the share body, history dedupe. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);
const lib = await import('../src/lib/recapView.ts');

const ready = {
  sessions: 4,
  minutes: 192,
  volumeKg: 14200,
  activeDays: ['2026-09-14', '2026-09-16', '2026-09-17', '2026-09-19'],
  byDay: [
    { date: '2026-09-14', sessions: 1, minutes: 50 },
    { date: '2026-09-15', sessions: 0, minutes: 0 },
  ],
  prs: [{ exerciseId: 'bench', name: 'Bench press', type: 'heaviestWeightKg', value: 100, unit: 'kg', previousValue: 95 }],
  topExercises: [{ exerciseId: 'bench', name: 'Bench press', sessions: 3, sets: 12 }],
  weeksKept: { count: 8, targetDays: 3 },
  gyms: null,
  buddies: null,
  previous: { sessions: 3, minutes: 150, volumeKg: 12000 },
  progress: null,
};

test('headline numbers follow the viewer unit and skip zero or absent values', () => {
  const lb = lib.recapHeadline(ready, 'lb');
  assert.deepEqual(lb.map((s) => [s.key, s.value]), [['sessions', '4'], ['time', '3 h 12 min'], ['volume', '31,306 lb'], ['records', '1'], ['weeks', '8']]);
  assert.equal(lib.recapHeadline(ready, 'kg').find((s) => s.key === 'volume').value, '14,200 kg');
  const keys = lib.recapHeadline({ ...ready, volumeKg: 0, weeksKept: null, prs: [] }, 'kg').map((s) => s.key);
  assert.deepEqual(keys, ['sessions', 'time']);
  assert.deepEqual(lib.recapHeadline({ ...ready, sessions: 0, minutes: 0, volumeKg: 0, prs: [], weeksKept: null }, 'kg'), []);
  assert.equal(lib.recapHeadline({ ...ready, sessions: 1 }, 'kg')[0].label, 'Session');
});

test('record lines convert kilogram records only and keep the beaten value', () => {
  const heaviest = ready.prs[0];
  assert.equal(lib.recordLine(heaviest, 'lb'), '209.4 lb → 220.5 lb');
  assert.equal(lib.recordLine(heaviest, 'kg'), '95 kg → 100 kg');
  assert.equal(lib.recordLine({ ...heaviest, previousValue: null }, 'kg'), '100 kg');
  assert.equal(lib.recordLine({ name: 'Pull-up', type: 'mostReps', value: 12, unit: 'reps', previousValue: 10 }, 'lb'), '10 reps → 12 reps');
  assert.equal(lib.recordLine({ name: 'Pull-up', type: 'mostReps', value: 1, unit: 'reps', previousValue: null }, 'lb'), '1 rep');
  assert.equal(lib.recordLine({ name: 'Plank', type: 'longestDurationMin', value: 75, unit: 'min', previousValue: null }, 'kg'), '1 h 15 min');
  assert.equal(lib.recordLine({ name: 'Run', type: 'longestDurationMin', value: 45, unit: 'min', previousValue: 30 }, 'kg'), '30 min → 45 min');
  assert.equal(lib.recordLine({ name: 'Squat', type: 'estimatedOneRepMaxKg', value: 150.5, unit: 'kg', previousValue: null }, 'kg'), '150.5 kg');
  assert.equal(lib.recordTypeLabel('heaviestWeightKg'), 'Heaviest weight');
  assert.equal(lib.recordTypeLabel('bestSetVolumeKg'), 'Best set volume');
  assert.equal(lib.recordTypeLabel('estimatedOneRepMaxKg'), 'Estimated 1RM');
  assert.equal(lib.recordTypeLabel('something-new'), 'Record');
});

test('compare deltas exist only when the API sent a previous period', () => {
  assert.deepEqual(lib.compareDeltas({ ...ready, previous: null }, 'kg', 'week'), {});
  const deltas = lib.compareDeltas(ready, 'kg', 'week');
  assert.deepEqual(deltas.sessions, { value: 1, direction: 'up', label: 'vs last week' });
  assert.deepEqual(deltas.time, { value: '+42 min', direction: 'up', label: 'vs last week' });
  assert.deepEqual(deltas.volume, { value: '+2,200 kg', direction: 'up', label: 'vs last week' });
  const down = lib.compareDeltas({ ...ready, sessions: 2, minutes: 150, volumeKg: 11000 }, 'lb', 'month');
  assert.equal(down.sessions.direction, 'down');
  assert.deepEqual(down.time, { value: '±0', direction: 'flat', label: 'vs last month' });
  assert.equal(down.volume.value, '−2,205 lb');
});

test('locked copy reads the progress block and never says "4 of 3"', () => {
  assert.equal(lib.lockedCopy({ sessions: 2, needed: 3, unlocksOn: '2026-09-26' }), '2 of 3 sessions so far. Unlocks on Sep 26 with 3 sessions or more.');
  assert.equal(lib.lockedCopy({ sessions: 2, needed: 3, unlocksOn: null }), '2 of 3 sessions so far. Log 1 more session to unlock this month.');
  assert.equal(lib.lockedCopy({ sessions: 0, needed: 3, unlocksOn: null }), '0 of 3 sessions so far. Log 3 more sessions to unlock this month.');
  const plenty = lib.lockedCopy({ sessions: 4, needed: 3, unlocksOn: '2026-09-26' });
  assert.equal(plenty, '4 sessions so far. Unlocks on Sep 26.');
  assert.ok(!plenty.includes('4 of 3'));
  assert.equal(lib.lockedCopy({ sessions: 3, needed: 3, unlocksOn: null }), '3 sessions so far. This month unlocks shortly.');
  assert.equal(lib.lockedCopy(null), 'This recap unlocks later in the month.');
  assert.equal(lib.LOCKED_SHARE_MESSAGE, 'This recap unlocks later in the month. Share it once it is ready.');
  assert.equal(lib.canShare({ status: 'locked' }), false);
  assert.equal(lib.canShare({ status: 'ready' }), true);
  assert.equal(lib.canShare({ status: 'quiet' }), true);
  assert.equal(lib.canShare(null), false);
});

test('words for quiet periods, weeks kept, days and list rows', () => {
  assert.equal(lib.quietCopy('week'), 'A quiet week. The next one is a fresh start.');
  assert.equal(lib.quietCopy('month'), 'A quiet month. The next one is a fresh start.');
  assert.equal(lib.weeksKeptCopy({ count: 8, targetDays: 3 }), '8 weeks kept · 3+ days a week');
  assert.equal(lib.weeksKeptCopy({ count: 1, targetDays: 1 }), '1 week kept · 1+ day a week');
  assert.equal(lib.activeDaysCopy(ready.activeDays), '4 active days');
  assert.equal(lib.activeDaysCopy(['2026-09-14']), '1 active day');
  assert.equal(lib.summaryLine({ sessions: 4, minutes: 192, prCount: 2 }), '4 sessions · 3 h 12 min · 2 records');
  assert.equal(lib.summaryLine({ sessions: 1, minutes: 45, prCount: 0 }), '1 session · 45 min');
  assert.equal(lib.summaryLine({ sessions: 0, minutes: 0, prCount: 0 }), 'No sessions');
  assert.equal(lib.recapTitle('week'), 'Weekly recap');
  assert.equal(lib.recapTitle('month'), 'Monthly recap');
  assert.equal(lib.runningBadge({ kind: 'week', final: false }), 'This week so far');
  assert.equal(lib.runningBadge({ kind: 'month', final: false }), 'This month so far');
  assert.equal(lib.runningBadge({ kind: 'month', final: true }), null);
  // Calendar keys are read as dates, never shifted by the browser's zone.
  assert.equal(lib.dayLabel('2026-09-14', 'week'), 'Mon');
  assert.equal(lib.dayLabel('2026-09-20', 'week'), 'Sun');
  assert.equal(lib.dayLabel('2026-09-05', 'month'), '5');
  assert.equal(lib.shortDate('2026-09-26'), 'Sep 26');
  assert.equal(lib.dayDescription({ date: '2026-09-14', sessions: 1, minutes: 50 }), 'Monday, Sep 14: 1 session, 50 min');
  assert.equal(lib.dayDescription({ date: '2026-09-15', sessions: 0, minutes: 0 }), 'Tuesday, Sep 15: rest');
});

test('the share body is exactly what POST /posts/create accepts', () => {
  assert.deepEqual(lib.sharePostBody({ recapId: 'abc', caption: '  Good week  ', hiddenFields: ['weights', 'weights', 'gyms', 'volume', 'buddies'] }), {
    content: 'Good week',
    medias: [],
    hashtags: [],
    isPublic: true,
    recapSummary: { recapId: 'abc', hiddenFields: ['weights', 'gyms', 'buddies'] },
  });
  assert.deepEqual(lib.sharePostBody({ recapId: 'abc' }), {
    content: '',
    medias: [],
    hashtags: [],
    isPublic: true,
    recapSummary: { recapId: 'abc', hiddenFields: [] },
  });
  assert.deepEqual(lib.HIDDEN_FIELDS, ['weights', 'gyms', 'buddies']);
});

test('a web share leaves weights off unless the member switches them on', () => {
  // The same default as every export and the mobile share sheet: weights are opt-in.
  assert.deepEqual(lib.SHARE_DEFAULT_HIDDEN, ['weights']);
  assert.deepEqual(lib.shareHiddenFields(false), ['weights']);
  assert.deepEqual(lib.shareHiddenFields(true), []);
  assert.deepEqual(lib.sharePostBody({ recapId: 'abc', hiddenFields: lib.shareHiddenFields(false) }).recapSummary, { recapId: 'abc', hiddenFields: ['weights'] });
  // The switch is only offered when it changes the card: the card shows volume only above zero.
  assert.equal(lib.offersWeights({ volumeKg: 14200 }), true);
  assert.equal(lib.offersWeights({ volumeKg: 0 }), false);
  assert.equal(lib.offersWeights({}), false);
  assert.equal(lib.INCLUDE_WEIGHTS_LABEL, 'Include weights');
  assert.match(lib.INCLUDE_WEIGHTS_HELP, /volume you lifted/);
  // The description names volume and only promises weeks kept on a monthly card.
  const week = lib.shareDescription({ kind: 'week', data: ready });
  assert.equal(week, 'The card carries your sessions, time, records and most trained exercises. Volume lifted only goes on when you include it. Gyms and buddies never appear on a card.');
  const month = lib.shareDescription({ kind: 'month', data: ready });
  assert.ok(month.includes('most trained exercises, plus weeks kept.'));
  assert.ok(!lib.shareDescription({ kind: 'month', data: { ...ready, weeksKept: null } }).includes('weeks kept'));
  assert.ok(!lib.shareDescription({ kind: 'week', data: { ...ready, volumeKg: 0 } }).includes('Volume lifted'));
  assert.equal(lib.captionPlaceholder('week'), 'Say something about the week');
  assert.equal(lib.captionPlaceholder('month'), 'Say something about the month');
});

test('the comparison sits behind a toggle whose label names the previous period', () => {
  assert.equal(lib.compareLabel('week', false), 'Compare with last week');
  assert.equal(lib.compareLabel('month', false), 'Compare with last month');
  assert.equal(lib.compareLabel('week', true), 'Hide comparison');
  assert.equal(lib.hasDeltas({}), false);
  assert.equal(lib.hasDeltas(lib.compareDeltas(ready, 'kg', 'week')), true);
  assert.deepEqual(lib.MONDAY_FIRST_WEEKDAYS, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

test('a history row is named by kind, period, badges and its summary', () => {
  const row = { kind: 'week', periodLabel: 'Sep 14–20, 2026', viewedAt: null, shared: true, summary: { sessions: 4, minutes: 192, prCount: 2 } };
  assert.equal(lib.historyRowLabel(row), 'Weekly recap: Sep 14–20, 2026, new, shared. 4 sessions, 3 h 12 min, 2 records');
  assert.equal(lib.historyRowLabel({ ...row, viewedAt: '2026-09-21T12:00:00.000Z', shared: false }), 'Weekly recap: Sep 14–20, 2026. 4 sessions, 3 h 12 min, 2 records');
  assert.equal(lib.historyRowLabel({ ...row, kind: 'month', periodLabel: 'August 2026', viewedAt: 'x', shared: false, summary: { sessions: 0, minutes: 0, prCount: 0 } }), 'Monthly recap: August 2026. No sessions');
  // The prefix is the label the row always carried; only the tail grew.
  assert.ok(lib.historyRowLabel(row).startsWith('Weekly recap: Sep 14–20, 2026'));
});

test('history drops the rows already shown as current cards and repeated ids', () => {
  const rows = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'b' }];
  assert.deepEqual(lib.dedupeHistory(rows, ['a', null, undefined]), [{ _id: 'b' }, { _id: 'c' }]);
  assert.deepEqual(lib.dedupeHistory(rows, []), [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]);
});
