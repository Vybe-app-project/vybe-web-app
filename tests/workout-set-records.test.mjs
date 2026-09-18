import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
register('./ts-loader.mjs', import.meta.url);
const { sessionVolume, toLogExercisePayload, logExerciseDraftFrom, repeatedExercises, emptyLogExercise, draftVolume, LB_TO_KG } =
  await import('../src/pages/workout-set-records.ts');

const recorded = {
  name: 'Squat', exerciseId: 'ex-1',
  sets: 99, reps: 99, weight: 99,
  setRecords: [
    { id: 's1', reps: 5, weight: 100, weightUnit: 'kg', completed: true },
    { id: 's2', reps: 8, weight: 120, weightUnit: 'lb', completed: true },
    { id: 's3', reps: 8, weight: 120, weightUnit: 'kg', completed: false },
  ],
};

test('volume uses completed sets, explicit mixed units, then legacy fallback', () => {
  assert.equal(sessionVolume({ exercises: [recorded, { name: 'Legacy row', sets: 3, reps: 10, weight: 20 }] }), 500 + 960 * LB_TO_KG + 600);
  assert.equal(sessionVolume({ exercises: [{ name: 'Row', sets: 1, reps: 5, weight: 100, weightUnit: 'lb' }] }), 500 * LB_TO_KG);
  assert.equal(sessionVolume({ exercises: [{ ...recorded, setRecords: [] }] }), 0);
  assert.equal(sessionVolume({ exercises: [{ ...recorded, setRecords: [{ ...recorded.setRecords[0], weight: 0 }] }] }), 0);
});
test('editing preserves set IDs, completion and units without sending misleading aggregates', () => {
  const draft = logExerciseDraftFrom(recorded);
  draft.setRecords[0].reps = '6';
  draft.setRecords[1].completed = false;
  draft.setRecords.splice(2, 1);
  const payload = toLogExercisePayload(draft);
  assert.equal(payload.exerciseId, recorded.exerciseId);
  assert.deepEqual(payload.setRecords, [{ ...recorded.setRecords[0], reps: 6 }, { ...recorded.setRecords[1], completed: false }]);
  assert.equal(payload.sets, undefined);
  assert.equal(sessionVolume({ exercises: [payload] }), 600);
});
test('legacy edit round trip preserves aggregates, distance and notes without per-set invention', () => {
  const legacy = { name: 'Carry', sets: 2, reps: 5, weight: 20, duration: 4, distance: 0.1, notes: 'Legacy' };
  const payload = toLogExercisePayload(logExerciseDraftFrom(legacy));
  for (const [key, value] of Object.entries(legacy)) assert.equal(payload[key], value);
  assert.equal(payload.setRecords, undefined);
  assert.equal(payload.weightUnit, 'kg');
});
test('repeat generates fresh stable IDs and prior loads but never copies completion as proof', () => {
  const repeated = repeatedExercises([recorded])[0];
  assert.notEqual(repeated.exerciseId, recorded.exerciseId);
  assert.ok(repeated.setRecords.every((set, index) => set.id !== recorded.setRecords[index].id && !set.completed));
  assert.equal(repeated.setRecords[1].weight, 120);
  assert.equal(repeated.setRecords[1].weightUnit, 'lb');
  assert.equal(sessionVolume({ exercises: [repeated] }), 0);
  assert.equal(repeatedExercises([{ name: 'Old', sets: 3, reps: 5, weight: 40 }])[0].setRecords, undefined);
});
test('new sets start incomplete with zero external load, and invalid drafts do not silently become zero', () => {
  const draft = emptyLogExercise();
  draft.name = 'Push-up';
  assert.equal(draftVolume([draft]), 0);
  for (const value of ['', '-1', 'NaN', 'Infinity', '100001']) {
    draft.setRecords[0].weight = value;
    assert.throws(() => toLogExercisePayload(draft), /Set weight/);
    assert.equal(draftVolume([draft]), null);
  }
  draft.setRecords[0].weight = '0';
  draft.setRecords[0].reps = '1.5';
  assert.throws(() => toLogExercisePayload(draft), /whole number/);
});
