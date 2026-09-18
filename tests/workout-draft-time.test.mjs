import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
register('./ts-loader.mjs', import.meta.url);
const { restRemaining, emptyRestTimer, validWorkoutDraft } = await import('../src/lib/workoutDrafts.ts');
test('rest clock uses absolute deadline, expires after throttling and retains paused time', () => {
  const timer = { ...emptyRestTimer(), durationSeconds: 90, deadline: 100000 };
  assert.equal(restRemaining(timer, 40000), 60);
  assert.equal(restRemaining(timer, 99999), 1);
  assert.equal(restRemaining(timer, 900000), 0);
  assert.equal(restRemaining({ ...timer, deadline: null, pausedSeconds: 17 }, 900000), 17);
  assert.equal(restRemaining(emptyRestTimer(), 900000), 60);
});
test('unknown versions and owner mismatches cannot be resumed as valid drafts', () => {
  assert.equal(validWorkoutDraft({ version: 2 }, 'owner'), false);
  assert.equal(validWorkoutDraft({ version: 1, ownerId: 'someone-else' }, 'owner'), false);
  assert.equal(validWorkoutDraft(null, 'owner'), false);
});
