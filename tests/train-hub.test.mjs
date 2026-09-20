/**
 * The Train hub's week arithmetic (src/pages/workouts/sessions.ts): the band
 * figure, the strip, the streak of weeks kept and the card's session line all
 * come from here, so a wrong week boundary would print a wrong number on
 * every Train surface.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);
const s = await import('../src/pages/workouts/sessions.ts');

// Sunday 20 September 2026, midday. The Monday-start week runs 14–20 Sep.
const NOW = new Date(2026, 8, 20, 12);
const log = (date, over = {}) => ({ _id: date, date: new Date(date).toISOString(), exercises: [], ...over });

test('weekTotals splits Monday-start weeks and sums minutes and tonnage', () => {
  const logs = [
    log('2026-09-14T07:00', { duration: 45, exercises: [{ name: 'Squat', sets: 5, reps: 5, weight: 100 }] }), // Monday, this week
    log('2026-09-20T09:00', { duration: 30, volumeKg: 1200 }), // Sunday, this week
    log('2026-09-13T18:00', { duration: 60, exercises: [{ name: 'Bench', sets: 3, reps: 8, weight: 60 }] }), // Sunday, last week
    log('2026-09-01T18:00', { duration: 60 }), // out of both windows
  ];
  const { week, lastWeek } = s.weekTotals(logs, NOW);
  assert.deepEqual(week, { sessions: 2, minutes: 75, volumeKg: 2500 + 1200 });
  assert.deepEqual(lastWeek, { sessions: 1, minutes: 60, volumeKg: 1440 });
  assert.deepEqual(s.weekTotals([], NOW), { week: s.EMPTY_WEEK, lastWeek: s.EMPTY_WEEK });
});

test('sessionVolume prefers the server figure, then completed sets, then the aggregate', () => {
  assert.equal(s.sessionVolume({ volumeKg: 321, exercises: [{ name: 'x', sets: 1, reps: 1, weight: 1 }] }), 321);
  assert.equal(
    s.sessionVolume({
      exercises: [{ name: 'Bench', setRecords: [{ id: 'a', completed: true, reps: 5, weight: 100, weightUnit: 'kg' }, { id: 'b', completed: false, reps: 5, weight: 100, weightUnit: 'kg' }, { id: 'c', completed: true, reps: 2, weight: 100, weightUnit: 'lb' }] }],
    }),
    500 + 2 * 100 * 0.45359237,
  );
  assert.equal(s.sessionVolume({ exercises: [{ name: 'Row', sets: 4, reps: 10, weight: 40 }] }), 1600);
});

test('weeksKept counts consecutive Monday weeks and does not break on an open week', () => {
  const everyWeek = ['2026-09-19', '2026-09-10', '2026-09-02', '2026-08-26'].map((d) => log(`${d}T08:00`));
  assert.equal(s.weeksKept(everyWeek, NOW), 4, 'this week and three before it');
  const openWeek = ['2026-09-13', '2026-09-06', '2026-08-30'].map((d) => log(`${d}T08:00`));
  assert.equal(s.weeksKept(openWeek, NOW), 3, 'nothing yet this week: last three weeks still count');
  const gap = ['2026-09-19', '2026-09-02'].map((d) => log(`${d}T08:00`));
  assert.equal(s.weeksKept(gap, NOW), 1, 'a missed week ends the run');
  assert.equal(s.weeksKept([], NOW), 0);
});

test('dayStreak counts back from today or, when today is still open, from yesterday', () => {
  assert.equal(s.dayStreak(['2026-09-20', '2026-09-19', '2026-09-18'].map((d) => log(`${d}T08:00`)), NOW), 3);
  assert.equal(s.dayStreak(['2026-09-19', '2026-09-18', '2026-09-16'].map((d) => log(`${d}T08:00`)), NOW), 2);
  assert.equal(s.dayStreak(['2026-09-17'].map((d) => log(`${d}T08:00`)), NOW), 0);
});

test('relativeDay reads as a person would say it', () => {
  assert.equal(s.relativeDay(new Date(2026, 8, 20, 8), NOW), 'Today');
  assert.equal(s.relativeDay(new Date(2026, 8, 19, 8), NOW), 'Yesterday');
  assert.equal(s.relativeDay(new Date(2026, 8, 17, 8), NOW), '3 days ago');
  assert.equal(s.relativeDay(new Date(2026, 8, 10, 8), NOW), 'Last week');
  assert.equal(s.relativeDay(new Date(2026, 8, 1, 8), NOW), '2 weeks ago', 'Monday-start weeks: 31 Aug–6 Sep is two weeks before 14–20 Sep');
  assert.equal(s.relativeDay(new Date(2026, 7, 20, 8), NOW), '4 weeks ago');
  assert.equal(s.relativeDay(new Date(2026, 5, 12, 8), NOW), '12 Jun');
});

test('lastDoneByTitle keeps the newest session per title, case-insensitively', () => {
  const map = s.lastDoneByTitle([log('2026-09-01T08:00', { name: 'Push A' }), log('2026-09-19T08:00', { name: 'push a' }), log('2026-09-10T08:00', { name: 'Pull B' }), log('2026-09-11T08:00', { name: '' })]);
  assert.equal(map.get('push a')._id, '2026-09-19T08:00');
  assert.equal(map.get('pull b')._id, '2026-09-10T08:00');
  assert.equal(map.size, 2, 'a nameless session has no title to match');
});

test('topSet quotes the heaviest lift, else the first timed or rep-only movement', () => {
  assert.deepEqual(
    s.topSet({ exercises: [{ name: 'Row', sets: 3, reps: 10, weight: 40 }, { name: 'Bench press', sets: 5, reps: 5, weight: 82.5 }] }),
    { name: 'Bench press', weightKg: 82.5, reps: 5 },
  );
  assert.deepEqual(s.topSet({ exercises: [{ name: 'Squat', setRecords: [{ id: 'a', completed: true, reps: 3, weight: 220, weightUnit: 'lb' }, { id: 'b', completed: false, reps: 1, weight: 300, weightUnit: 'lb' }] }] }), {
    name: 'Squat',
    weightKg: 220 * 0.45359237,
    reps: 3,
  });
  assert.deepEqual(s.topSet({ exercises: [{ name: 'Plank', duration: 90 }] }), { name: 'Plank', seconds: 90 });
  assert.deepEqual(s.topSet({ exercises: [{ name: 'Push-up', sets: 3, reps: 15 }] }), { name: 'Push-up', sets: 3, reps: 15 });
  assert.equal(s.topSet({ exercises: [] }), null);
});
