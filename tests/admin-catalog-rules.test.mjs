import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The catalog editors' rules (src/pages/admin/catalogRules.ts) mirror the
 * backend validators in routes/adminCatalog.js. That file has no runtime
 * imports by design, so it can be transpiled here and exercised directly:
 * these tests pin the bounds, the PATCH diffing that keeps edits minimal,
 * the schedule ordering and the API error mapping the forms rely on.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadRules() {
  const source = fs.readFileSync(path.join(root, 'src/pages/admin/catalogRules.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  assert.doesNotMatch(outputText, /^\s*import\s/m, 'catalogRules.ts must stay free of runtime imports');
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const rules = await loadRules();

const workout = (over = {}) => ({
  _id: '64b000000000000000000001',
  title: 'Foundations',
  description: 'Base session',
  category: 'strength',
  level: 'beginner',
  duration: 30,
  caloriesBurned: 200,
  hashtags: ['strength', 'fullbody'],
  image: { uri: 'https://example.test/api/media/content/token' },
  exercises: [
    { _id: 'e1', name: 'Squat', sets: 3, reps: 12, duration: null, rest: 45, notes: null, caloriesBurned: null },
    { _id: 'e2', name: 'Plank', sets: 3, reps: null, duration: 45, rest: 30, notes: 'Neutral spine', caloriesBurned: null },
  ],
  isPremade: true,
  isPublic: true,
  createdBy: null,
  adminId: null,
  likesCount: 0,
  commentsCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const ref = (id, over = {}) => ({
  _id: id,
  title: `Workout ${id.slice(-1)}`,
  category: 'cardio',
  level: 'beginner',
  duration: 20,
  caloriesBurned: 100,
  image: null,
  isPremade: true,
  ...over,
});

const plan = (over = {}) => ({
  _id: '64b000000000000000000101',
  title: 'Starter plan',
  description: null,
  goal: 'Build a habit',
  durationWeeks: 4,
  level: 'beginner',
  hashtags: [],
  image: null,
  workouts: [
    { _id: 'p2', day: 3, week: 1, order: 2, workout: ref('64b0000000000000000000a2') },
    { _id: 'p1', day: 1, week: 1, order: 1, workout: ref('64b0000000000000000000a1') },
    { _id: 'p3', day: 1, week: 2, order: 3, workout: ref('64b0000000000000000000a3', { caloriesBurned: 50 }) },
  ],
  totalCaloriesBurned: 250,
  isPremade: true,
  isPublic: true,
  createdBy: null,
  adminId: null,
  likesCount: 0,
  commentsCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

test('bounds mirror routes/adminCatalog.js', () => {
  assert.deepEqual(rules.LIMITS.title, { min: 3, max: 120 });
  assert.equal(rules.LIMITS.description.max, 2000);
  assert.deepEqual(rules.LIMITS.goal, { min: 1, max: 200 });
  assert.deepEqual(rules.LIMITS.durationWeeks, { min: 1, max: 52 });
  assert.deepEqual(rules.LIMITS.duration, { min: 1, max: 600 });
  assert.deepEqual(rules.LIMITS.caloriesBurned, { min: 0, max: 5000 });
  assert.equal(rules.LIMITS.hashtags.max, 20);
  assert.deepEqual(rules.LIMITS.exercises, { min: 1, max: 50 });
  assert.deepEqual(rules.LIMITS.exercise.sets, { min: 1, max: 100 });
  assert.deepEqual(rules.LIMITS.exercise.reps, { min: 1, max: 1000 });
  assert.deepEqual(rules.LIMITS.exercise.duration, { min: 1, max: 14400 });
  assert.deepEqual(rules.LIMITS.exercise.rest, { min: 0, max: 3600 });
  assert.equal(rules.LIMITS.exercise.notes.max, 500);
  assert.equal(rules.LIMITS.planWorkouts.max, 100);
  assert.equal(rules.LIMITS.search.max, 100);
  assert.equal(rules.LIMITS.limit.max, 100);
});

test('whole-number parsing distinguishes empty, invalid and values', () => {
  assert.deepEqual(rules.parseWholeNumber(''), { kind: 'empty' });
  assert.deepEqual(rules.parseWholeNumber('   '), { kind: 'empty' });
  assert.deepEqual(rules.parseWholeNumber('12'), { kind: 'value', value: 12 });
  assert.deepEqual(rules.parseWholeNumber(' 7 '), { kind: 'value', value: 7 });
  assert.deepEqual(rules.parseWholeNumber('1.5'), { kind: 'invalid' });
  assert.deepEqual(rules.parseWholeNumber('1e3'), { kind: 'invalid' });
  assert.deepEqual(rules.parseWholeNumber('abc'), { kind: 'invalid' });
});

test('hashtags normalise like the API stores them', () => {
  assert.equal(rules.normalizeHashtag('#FullBody '), 'fullbody');
  assert.equal(rules.normalizeHashtag('core_work'), 'core_work');
  assert.equal(rules.normalizeHashtag('no spaces'), null);
  assert.equal(rules.normalizeHashtag('a'.repeat(31)), null);
  assert.equal(rules.normalizeHashtag('#'), null);
  const added = rules.addHashtags(['strength'], 'Strength, #Cardio bad-tag  legs');
  assert.deepEqual(added.tags, ['strength', 'cardio', 'legs']);
  assert.deepEqual(added.rejected, ['bad-tag']);
  assert.equal(added.full, false);
  const full = rules.addHashtags(Array.from({ length: 20 }, (_, i) => `t${i}`), 'extra');
  assert.equal(full.tags.length, 20);
  assert.equal(full.full, true);
});

test('a workout draft is validated against every bound before it is sent', () => {
  const draft = rules.workoutDraftFrom(null);
  const result = rules.validateWorkoutDraft(draft);
  assert.equal(result.ok, false);
  assert.match(result.fields.title, /3 to 120/);
  assert.equal(result.fields.category, 'Choose a category');
  assert.equal(Object.keys(result.exercises).length, 1, 'the blank starter exercise needs a name');

  draft.title = 'Core';
  draft.category = 'strength';
  draft.duration = '601';
  draft.caloriesBurned = '-1';
  draft.exercises[0].name = 'Plank';
  draft.exercises[0].sets = '0';
  draft.exercises[0].reps = '1001';
  draft.exercises[0].duration = '14401';
  draft.exercises[0].rest = '3601';
  draft.exercises[0].caloriesBurned = '5001';
  draft.exercises[0].notes = 'x'.repeat(501);
  const bounded = rules.validateWorkoutDraft(draft);
  assert.match(bounded.fields.duration, /1 to 600 minutes/);
  assert.match(bounded.fields.caloriesBurned, /0 to 5000/);
  const row = bounded.exercises[draft.exercises[0].key];
  assert.match(row.sets, /1 to 100/);
  assert.match(row.reps, /1 to 1000/);
  assert.match(row.duration, /1 to 14400 seconds/);
  assert.match(row.rest, /0 to 3600 seconds/);
  assert.match(row.caloriesBurned, /0 to 5000/);
  assert.match(row.notes, /500/);

  draft.duration = '';
  draft.caloriesBurned = '0';
  Object.assign(draft.exercises[0], { sets: '3', reps: '', duration: '45', rest: '0', caloriesBurned: '', notes: 'Neutral spine' });
  assert.equal(rules.validateWorkoutDraft(draft).ok, true);
});

test('creating a workout sends numbers as numbers and omits what is empty', () => {
  const draft = rules.workoutDraftFrom(null);
  Object.assign(draft, { title: '  Core Express ', category: 'hiit', level: 'intermediate', duration: '25', caloriesBurned: '', hashtags: ['#Core', 'core', 'hiit'] });
  Object.assign(draft.exercises[0], { name: ' Plank ', sets: '3', duration: '45', rest: '0', notes: '  ' });
  draft.image = { state: 'uploaded', key: 'uploads/64b000000000000000000009/media/x.jpg', previewUrl: 'blob:preview' };
  const body = rules.buildWorkoutBody(draft, null);
  assert.deepEqual(body, {
    title: 'Core Express',
    category: 'hiit',
    level: 'intermediate',
    exercises: [{ name: 'Plank', sets: 3, duration: 45, rest: 0 }],
    duration: 25,
    hashtags: ['core', 'hiit'],
    image: 'uploads/64b000000000000000000009/media/x.jpg',
  });
  assert.equal('description' in body, false);
  assert.equal('caloriesBurned' in body, false);
});

test('editing a workout sends only the fields that changed', () => {
  const original = workout();
  const untouched = rules.workoutDraftFrom(original);
  assert.deepEqual(rules.buildWorkoutBody(untouched, original), {}, 'an unchanged draft is not a change');

  const draft = rules.workoutDraftFrom(original);
  draft.title = 'Foundations II';
  draft.description = '';
  draft.duration = '';
  draft.hashtags = ['fullbody', 'strength'];
  draft.image = { state: 'none' };
  const body = rules.buildWorkoutBody(draft, original);
  assert.deepEqual(body, {
    title: 'Foundations II',
    description: null,
    duration: null,
    hashtags: ['fullbody', 'strength'],
    image: null,
  });

  const reordered = rules.workoutDraftFrom(original);
  reordered.exercises.reverse();
  const swapped = rules.buildWorkoutBody(reordered, original);
  assert.deepEqual(Object.keys(swapped), ['exercises']);
  assert.deepEqual(swapped.exercises, [
    { name: 'Plank', sets: 3, duration: 45, rest: 30, notes: 'Neutral spine' },
    { name: 'Squat', sets: 3, reps: 12, rest: 45 },
  ]);

  const echoed = rules.workoutDraftFrom(original);
  echoed.image = { state: 'current', uri: original.image.uri };
  assert.equal('image' in rules.buildWorkoutBody(echoed, original), false, 'an unchanged image is never re-sent');
});

test('plan drafts load in schedule order and save with a global order', () => {
  const original = plan();
  const draft = rules.planDraftFrom(original);
  assert.deepEqual(draft.entries.map((e) => [e.week, e.day, e.workout._id.slice(-2)]), [[1, 1, 'a1'], [1, 3, 'a2'], [2, 1, 'a3']]);
  assert.deepEqual(rules.buildPlanBody(draft, original), {}, 'reloading and saving is not a change');

  const bodies = rules.planEntryBodies(draft.entries);
  assert.deepEqual(bodies.map((b) => b.order), [1, 2, 3]);
  assert.equal(rules.estimatedPlanCalories(draft.entries), 250);

  // Two workouts on the same day keep the admin's sequence; moving swaps them.
  draft.entries.push({ key: 'k4', workout: ref('64b0000000000000000000a4'), week: 1, day: 1 });
  let ordered = rules.orderedEntries(draft.entries);
  assert.deepEqual(ordered.map((e) => e.workout._id.slice(-2)), ['a1', 'a4', 'a2', 'a3']);
  assert.deepEqual(rules.entryMoveability(draft.entries, 'k4'), { up: true, down: false });
  assert.deepEqual(rules.entryMoveability(draft.entries, draft.entries[1].key), { up: false, down: false }, 'alone on its day');
  const moved = rules.moveEntryWithinDay(draft.entries, 'k4', -1);
  ordered = rules.orderedEntries(moved);
  assert.deepEqual(ordered.map((e) => e.workout._id.slice(-2)), ['a4', 'a1', 'a2', 'a3']);
  assert.equal(rules.moveEntryWithinDay(moved, 'k4', -1), moved, 'cannot move past the start of the day');

  // Re-slotting drops the entry at the end of its new day.
  const reslotted = rules.reslotEntry(moved, 'k4', { day: 3 });
  ordered = rules.orderedEntries(reslotted);
  assert.deepEqual(ordered.map((e) => [e.day, e.workout._id.slice(-2)]), [[1, 'a1'], [3, 'a2'], [3, 'a4'], [1, 'a3']]);
  const body = rules.buildPlanBody({ ...draft, entries: reslotted }, original);
  assert.deepEqual(Object.keys(body), ['workouts']);
  assert.deepEqual(body.workouts, [
    { workout: '64b0000000000000000000a1', day: 1, week: 1, order: 1 },
    { workout: '64b0000000000000000000a2', day: 3, week: 1, order: 2 },
    { workout: '64b0000000000000000000a4', day: 3, week: 1, order: 3 },
    { workout: '64b0000000000000000000a3', day: 1, week: 2, order: 4 },
  ]);
});

test('a plan cannot be shortened under its own schedule', () => {
  const draft = rules.planDraftFrom(plan());
  draft.durationWeeks = '1';
  const result = rules.validatePlanDraft(draft);
  assert.equal(result.ok, false);
  assert.match(result.fields.durationWeeks, /scheduled past this length/);
  const orphan = draft.entries.find((e) => e.week === 2);
  assert.match(result.entries[orphan.key], /Week 2 is past the end/);

  draft.durationWeeks = '53';
  assert.match(rules.validatePlanDraft(draft).fields.durationWeeks, /1 to 52 weeks/);

  draft.durationWeeks = '4';
  draft.goal = '';
  assert.match(rules.validatePlanDraft(draft).fields.goal, /1 to 200/);
  draft.goal = 'Habit';
  assert.equal(rules.validatePlanDraft(draft).ok, true);
});

test('creating a plan sends the schedule and the parsed length', () => {
  const draft = rules.planDraftFrom(null);
  Object.assign(draft, { title: 'Kickstart', goal: 'Move daily', durationWeeks: '2', level: 'advanced' });
  draft.entries.push({ key: 'k1', workout: ref('64b0000000000000000000a1'), week: 2, day: 5 });
  assert.deepEqual(rules.buildPlanBody(draft, null), {
    title: 'Kickstart',
    goal: 'Move daily',
    level: 'advanced',
    workouts: [{ workout: '64b0000000000000000000a1', day: 5, week: 2, order: 1 }],
    durationWeeks: 2,
  });
});

test('API failures map to fields, rows and stale states', () => {
  const axiosLike = (status, data, extra = {}) => ({ response: { status, data }, ...extra });

  const validation = rules.catalogErrorDetails(axiosLike(400, {
    message: 'Exercise 2: sets must be a whole number from 1 to 100',
    errors: [
      { field: 'exercises', message: 'Exercise 2: sets must be a whole number from 1 to 100' },
      { field: 'title', message: 'Title must be 3 to 120 characters' },
    ],
  }));
  assert.equal(validation.status, 400);
  assert.equal(validation.fields.title, 'Title must be 3 to 120 characters');
  assert.deepEqual(validation.rows[2], { field: 'sets', message: 'Exercise 2: sets must be a whole number from 1 to 100' });
  assert.equal(validation.stale, false);

  const nameless = rules.catalogErrorDetails(axiosLike(400, {
    message: 'Exercise 1 needs a name of 1 to 100 characters',
    errors: [{ field: 'exercises', message: 'Exercise 1 needs a name of 1 to 100 characters' }],
  }));
  assert.equal(nameless.rows[1].field, undefined);

  const duplicate = rules.catalogErrorDetails(axiosLike(409, {
    message: 'A premade workout with this title already exists',
    errors: [{ field: 'title', message: 'Title is already used by another premade workout' }],
  }));
  assert.equal(duplicate.fields.title, 'Title is already used by another premade workout');
  assert.equal(duplicate.stale, false, 'a duplicate title is fixable in place');

  const concurrent = rules.catalogErrorDetails(axiosLike(409, {
    message: 'This item changed while you were editing it. Reload it and try again.',
  }));
  assert.equal(concurrent.stale, true);

  const gone = rules.catalogErrorDetails(axiosLike(404, { message: 'Premade workout not found' }));
  assert.equal(gone.stale, true);
  assert.equal(gone.message, 'Premade workout not found');

  const missing = rules.catalogErrorDetails(axiosLike(400, {
    message: 'Plan workouts must reference existing premade workouts',
    errors: [{ field: 'workouts', message: 'Plan workouts must reference existing premade workouts' }],
    invalidWorkoutIds: ['64b0000000000000000000a9'],
  }));
  assert.deepEqual(missing.invalidWorkoutIds, ['64b0000000000000000000a9']);
  assert.equal(missing.fields.workouts, 'Plan workouts must reference existing premade workouts');

  const image = rules.catalogErrorDetails(axiosLike(403, {
    message: 'Media belongs to another account',
    errors: [{ field: 'image', message: 'Media belongs to another account' }],
  }));
  assert.equal(image.fields.image, 'Media belongs to another account');

  const network = rules.catalogErrorDetails({ code: 'ERR_NETWORK', message: 'Network Error' }, 'fallback');
  assert.equal(network.status, null);
  assert.equal(network.offline, true);
  assert.match(network.message, /offline/);

  const unknown = rules.catalogErrorDetails(new Error('boom'), 'Could not save');
  assert.equal(unknown.message, 'boom');
  assert.deepEqual(unknown.fields, {});
});

test('a 404 about the image is a field problem; only a bare 404 means the record is gone', () => {
  const axiosLike = (status, data) => ({ response: { status, data } });
  const imageMissing = rules.catalogErrorDetails(axiosLike(404, {
    message: 'Completed media upload was not found',
    errors: [{ field: 'image', message: 'Completed media upload was not found' }],
  }));
  assert.equal(imageMissing.fields.image, 'Completed media upload was not found');
  assert.equal(imageMissing.gone, false);
  assert.equal(imageMissing.stale, false, 'a new upload fixes it in place');

  const planGone = rules.catalogErrorDetails(axiosLike(404, { message: 'Premade workout plan not found' }));
  assert.equal(planGone.gone, true);
  assert.equal(planGone.stale, true);

  const concurrent = rules.catalogErrorDetails(axiosLike(409, { message: 'This item changed while you were editing it. Reload it and try again.' }));
  assert.equal(concurrent.gone, false);
  assert.equal(concurrent.stale, true);

  assert.equal(rules.isMissingRecordError(axiosLike(404, { message: 'Premade workout not found' })), true);
  assert.equal(rules.isMissingRecordError(axiosLike(400, { message: 'Validation failed', errors: [{ field: 'id', message: 'A valid id is required' }] })), true);
  assert.equal(rules.isMissingRecordError(axiosLike(400, { message: 'Validation failed', errors: [{ field: 'title', message: 'Title is required' }] })), false);
  assert.equal(rules.isMissingRecordError(axiosLike(500, { message: 'Could not load' })), false);
  assert.equal(rules.isMissingRecordError(new Error('Network Error')), false);
});

test('the save banner spells out whole-body complaints instead of pointing at highlighted fields', () => {
  const axiosLike = (status, data) => ({ response: { status, data } });
  const unsupported = rules.catalogErrorDetails(axiosLike(400, {
    message: 'Validation failed',
    errors: [{ field: 'body', message: 'Request has an unsupported field: isPremade' }],
  }));
  assert.equal(rules.saveErrorText(unsupported), 'Validation failed. Request has an unsupported field: isPremade.');

  const nothing = rules.catalogErrorDetails(axiosLike(400, {
    message: 'At least one field to update is required',
    errors: [{ message: 'At least one field to update is required' }],
  }));
  assert.equal(rules.saveErrorText(nothing), 'At least one field to update is required.', 'the same sentence is not repeated');

  const fields = rules.catalogErrorDetails(axiosLike(400, {
    message: 'Validation failed',
    errors: [
      { field: 'title', message: 'Title must be 3 to 120 characters' },
      { field: 'exercises', message: 'Exercise 2: sets must be a whole number from 1 to 100' },
    ],
  }));
  assert.equal(rules.saveErrorText(fields), 'Validation failed. The highlighted fields explain what to fix.');

  const plain = rules.catalogErrorDetails(axiosLike(500, { message: 'Could not save the workout.' }));
  assert.equal(rules.saveErrorText(plain), 'Could not save the workout.');
});

test('editors return to the list view they were opened from, and only to the list', () => {
  const state = rules.catalogReturnState({ pathname: '/admin/catalog', search: '?tab=plans&q=core&page=2&limit=50' });
  assert.deepEqual(state, { from: '/admin/catalog?tab=plans&q=core&page=2&limit=50' });
  assert.equal(rules.catalogReturnPath(state, 'plans'), '/admin/catalog?tab=plans&q=core&page=2&limit=50');
  assert.equal(rules.catalogReturnPath(rules.catalogReturnState({ pathname: '/admin/catalog', search: '' }), 'workouts'), '/admin/catalog');
  // A bookmarked editor has no state; a foreign or malformed one is ignored.
  assert.equal(rules.catalogReturnPath(null, 'plans'), '/admin/catalog?tab=plans');
  assert.equal(rules.catalogReturnPath(undefined, 'workouts'), '/admin/catalog');
  assert.equal(rules.catalogReturnPath({ from: '/admin/users' }, 'workouts'), '/admin/catalog');
  assert.equal(rules.catalogReturnPath({ from: 'https://evil.test/admin/catalog' }, 'workouts'), '/admin/catalog');
  assert.equal(rules.catalogReturnPath({ from: '/admin/catalog/workouts/abc' }, 'workouts'), '/admin/catalog');
  assert.equal(rules.catalogReturnPath({ from: 42 }, 'plans'), '/admin/catalog?tab=plans');
});

test('editor ids and plan lengths are checked before they reach the API or the schedule', () => {
  assert.equal(rules.isObjectId('64b000000000000000000001'), true);
  assert.equal(rules.isObjectId('64B000000000000000000001'), true);
  assert.equal(rules.isObjectId('foo'), false);
  assert.equal(rules.isObjectId(''), false);
  assert.equal(rules.isObjectId(undefined), false);
  assert.equal(rules.parsePlanWeeks('4'), 4);
  assert.equal(rules.parsePlanWeeks(''), null, 'a cleared field keeps the schedule on its last valid length');
  assert.equal(rules.parsePlanWeeks('0'), null);
  assert.equal(rules.parsePlanWeeks('53'), null);
  assert.equal(rules.parsePlanWeeks('2.5'), null);
});

test('list state round-trips through the URL and rejects junk', () => {
  const params = (entries) => ({ get: (name) => (name in entries ? entries[name] : null) });
  assert.deepEqual(rules.parseListState(params({})), { tab: 'workouts', search: '', page: 1, limit: 20 });
  assert.deepEqual(rules.parseListState(params({ tab: 'plans', q: 'core', page: '3', limit: '50' })), { tab: 'plans', search: 'core', page: 3, limit: 50 });
  assert.deepEqual(rules.parseListState(params({ tab: 'nope', page: '0', limit: '7' })), { tab: 'workouts', search: '', page: 1, limit: 20 });
  assert.equal(rules.parseListState(params({ page: '100001' })).page, 1);
  assert.equal(rules.parseListState(params({ q: 'x'.repeat(150) })).search.length, 100);
  assert.deepEqual(rules.listStateParams({ tab: 'workouts', search: '', page: 1, limit: 20 }), {});
  assert.deepEqual(rules.listStateParams({ tab: 'plans', search: 'a', page: 2, limit: 100 }), { tab: 'plans', q: 'a', page: '2', limit: '100' });
  assert.equal(rules.pageCount(0, 20), 1);
  assert.equal(rules.pageCount(41, 20), 3);
  assert.equal(rules.rangeLabel(3, 20, 41, 'workouts'), '41–41 of 41 workouts');
  assert.equal(rules.rangeLabel(1, 20, 0, 'plans'), 'No plans');
});
