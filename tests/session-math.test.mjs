/**
 * The live session's pure logic (src/pages/workouts/session/math.ts), ported
 * from the mobile runner's sessionMath tests
 * (v2-main-mobile/__tests__/v2-active-workout.sessionMath.test.tsx): volume
 * in kilograms from mixed kg/lb sets, the counts, the derived clock, the
 * per-set payload shape and its stable ids.
 *
 * The payload cases double as the contract check for
 * int-vybe-backend/docs/workout-set-records.md: only documented keys, one
 * entry per exerciseId, every set with an explicit `completed` and
 * `weightUnit`, ids inside `^[A-Za-z0-9_-]{1,80}$`.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

const m = await import('../src/pages/workouts/session/math.ts');

const STARTED = '2026-09-21T10:00:00.000Z';
const at = (iso) => new Date(iso).getTime();

let seq = 0;
const set = (over = {}) => ({
  id: over.id ?? `s${(seq += 1)}`,
  reps: over.reps ?? null,
  weight: over.weight ?? null,
  weightUnit: over.weightUnit ?? 'kg',
  completed: over.completed ?? false,
  completedAt: over.completed ? STARTED : null,
  previous: over.previous ?? null,
});
const done = (weight, reps, over = {}) => set({ ...over, weight, reps, completed: true });
const exercise = (over = {}) => ({
  key: over.key ?? `k${(seq += 1)}`,
  exerciseId: over.exerciseId ?? 'bench-press',
  name: over.name ?? 'Bench press',
  sets: over.sets ?? [],
  restSeconds: over.restSeconds ?? 90,
  notes: over.notes ?? '',
  ...(over.collapsed === undefined ? {} : { collapsed: over.collapsed }),
});
const session = (over = {}) => ({
  sessionId: 'session-1',
  startedAt: over.startedAt ?? STARTED,
  finishedAt: over.finishedAt ?? null,
  name: over.name ?? 'Push day',
  type: over.type ?? 'strength',
  unit: over.unit ?? 'kg',
  exercises: over.exercises ?? [],
  notes: over.notes ?? '',
  clientRequestId: over.clientRequestId ?? 'req-aaaaaaaaaaaaaaaa',
  seedWorkoutId: over.seedWorkoutId ?? null,
});

/* ------------------------------------------------------------------ volume */

test('volume sums completed sets in kg, converting lb at exactly 0.45359237', () => {
  const s = session({
    exercises: [
      exercise({ sets: [done(100, 5), done(220, 5, { weightUnit: 'lb' })] }),
      // Not checked, so not volume — and a checked set with no load is not volume either.
      exercise({ name: 'Squat', exerciseId: 'squat', sets: [set({ weight: 140, reps: 3 }), done(0, 12)] }),
    ],
  });
  assert.ok(Math.abs(m.sessionVolumeKg(s) - (500 + 5 * 220 * m.KG_PER_LB)) < 1e-6);
  assert.equal(m.KG_PER_LB, 0.45359237);
  // A checked bodyweight set still counts as a set.
  assert.equal(m.completedSetCount(s), 3);
  assert.equal(m.totalSetCount(s), 4);
});

test('volume prints as a whole number in the session unit', () => {
  assert.equal(m.formatVolume(1234.6, 'kg'), '1,235 kg');
  assert.equal(m.formatVolume(1000, 'lb'), '2,205 lb');
  assert.equal(m.formatVolume(0, 'kg'), '0 kg');
});

test('units convert both ways and round to two decimals', () => {
  assert.equal(m.convertWeight(100, 'kg', 'lb'), 220.46);
  assert.equal(m.convertWeight(220, 'lb', 'kg'), 99.79);
  assert.equal(m.convertWeight(60, 'kg', 'kg'), 60);
  assert.equal(m.toKg(1, 'lb'), m.KG_PER_LB);
  assert.equal(m.weightUnitFor('imperial'), 'lb');
  assert.equal(m.weightUnitFor('metric'), 'kg');
});

test('the best set of a card is its heaviest completed set, in kilograms', () => {
  const e = exercise({ sets: [done(60, 8), done(140, 1, { weightUnit: 'lb' }), done(80, 3), set({ weight: 200, reps: 1 })] });
  assert.deepEqual(m.bestSetOf(e), { reps: 3, weightKg: 80 });
  assert.equal(m.formatBestSetKg(m.bestSetOf(e), 'kg'), '80 kg × 3');
  // A card nobody loaded reads as reps, never "0 kg × 12".
  assert.deepEqual(m.bestSetOf(exercise({ sets: [done(0, 8), done(0, 12)] })), { reps: 12, weightKg: 0 });
  assert.equal(m.formatBestSetKg(m.bestSetOf(exercise({ sets: [done(0, 12)] })), 'kg'), '12 reps');
  assert.equal(m.bestSetOf(exercise({ sets: [set({ reps: 5 })] })), null);
});

/* ------------------------------------------------------------------- gates */

test('finishing needs one completed set; an exercise folds only when every set is checked', () => {
  assert.equal(m.canFinish(null), false);
  assert.equal(m.canFinish(session()), false);
  assert.equal(m.canFinish(session({ exercises: [exercise({ sets: [set({ reps: 5 })] })] })), false);
  assert.equal(m.canFinish(session({ exercises: [exercise({ sets: [done(60, 5)] })] })), true);
  assert.equal(m.isExerciseFinished(exercise({ sets: [] })), false);
  assert.equal(m.isExerciseFinished(exercise({ sets: [done(60, 5), set()] })), false);
  assert.equal(m.isExerciseFinished(exercise({ sets: [done(60, 5)] })), true);
  assert.equal(m.isEmptySession(session()), true);
  assert.equal(m.isEmptySession(null), true);
});

test('a set id resolves to its card, and an open row is one still unchecked', () => {
  const open = set({ id: 'open', reps: 5 });
  const s = session({ exercises: [exercise({ sets: [done(60, 5, { id: 'shut' }), open] })] });
  assert.equal(m.findSet(s, 'open').index, 1);
  assert.equal(m.findSet(s, 'nope'), null);
  assert.equal(m.isSetStillOpen(s, 'open'), true);
  assert.equal(m.isSetStillOpen(s, 'shut'), false);
  assert.equal(m.isSetStillOpen(null, 'open'), false);
});

/* ------------------------------------------------------------------- clock */

test('elapsed time is derived from startedAt, never counted', () => {
  const s = session({ exercises: [exercise({ sets: [set()] })] });
  assert.equal(m.sessionElapsedMs(s, at('2026-09-21T10:12:34.000Z')), 754_000);
  assert.equal(m.formatElapsed(754_000), '12:34');
  assert.equal(m.formatElapsed(3_723_000), '1:02:03');
  assert.equal(m.formatElapsed(0), '0:00');
  assert.equal(m.formatElapsed(-5), '0:00');
  // A hidden tab throttles the tick, so a clock read hours later is still right.
  assert.equal(m.formatElapsed(m.sessionElapsedMs(s, at('2026-09-21T12:30:09.000Z'))), '2:30:09');
  // An empty session reads 0:00 rather than the age of a draft nobody trained.
  assert.equal(m.sessionElapsedMs(session(), at('2026-09-21T12:00:00.000Z')), 0);
  assert.equal(m.sessionElapsedMs(null), 0);
  // A clock that somehow runs backwards never shows a negative.
  assert.equal(m.sessionElapsedMs(s, at('2026-09-21T09:00:00.000Z')), 0);
});

test("the log's duration is whole minutes, at least 1 and at most 1440", () => {
  assert.equal(m.durationMinutes(STARTED, '2026-09-21T10:45:00.000Z'), 45);
  assert.equal(m.durationMinutes(STARTED, '2026-09-21T10:45:40.000Z'), 46);
  assert.equal(m.durationMinutes(STARTED, '2026-09-21T10:00:05.000Z'), 1);
  assert.equal(m.durationMinutes(STARTED, '2026-09-25T10:00:00.000Z'), m.MAX_DURATION_MIN);
  assert.equal(m.durationMinutes(STARTED, null, at('2026-09-21T10:30:00.000Z')), 30);
});

/* -------------------------------------------------------------- rest dock */

test('the rest dock reads an absolute deadline, clamps its remainder and formats mm:ss', () => {
  const now = at(STARTED);
  const rest = m.startRest({ exerciseKey: 'k1', setId: 's1', durationSec: 90, now });
  assert.equal(rest.deadline, now + 90_000);
  // The page's 1 s tick can be a second behind the check that started the rest.
  assert.equal(m.formatRestClock(m.remainingMs(rest, now - 900)), '1:30');
  assert.equal(m.formatRestClock(m.remainingMs(rest, now + 83_000)), '0:07');
  assert.equal(m.remainingMs(rest, now + 200_000), 0);
  assert.equal(m.isRestOver(rest, now + 90_000), true);
  assert.equal(m.isRestOver(null), false);
  assert.equal(m.restProgress(rest, now + 45_000), 0.5);
  const longer = m.adjustRest(rest, 15, now);
  assert.equal(longer.durationSec, 105);
  assert.equal(m.formatRestClock(m.remainingMs(longer, now)), '1:45');
  const shorter = m.adjustRest(rest, -15, now);
  assert.equal(m.formatRestClock(m.remainingMs(shorter, now)), '1:15');
  assert.equal(m.clampRestSeconds(3), m.MIN_REST_SECONDS);
  assert.equal(m.clampRestSeconds(9999), m.MAX_REST_SECONDS);
  assert.equal(m.clampRestSeconds('nonsense'), m.DEFAULT_REST_SECONDS);
  assert.equal(m.seedRestSeconds(0), m.DEFAULT_REST_SECONDS);
  assert.equal(m.seedRestSeconds(120), 120);
});

/* ------------------------------------------------------------ identifiers */

test('exerciseSlug takes the library id when it is one, else custom-<kebab(name)>', () => {
  assert.equal(m.exerciseSlug('Bench Press'), 'custom-bench-press');
  assert.equal(m.exerciseSlug('  Café  Curl!! '), 'custom-cafe-curl');
  assert.equal(m.exerciseSlug('Bench Press', 'barbell-bench-press'), 'barbell-bench-press');
  assert.equal(m.exerciseSlug('Bench Press', 'not valid!'), 'custom-bench-press');
  assert.equal(m.exerciseSlug('???'), 'custom-exercise');
  assert.ok(m.EXERCISE_ID_PATTERN.test(m.exerciseSlug('x'.repeat(300))));
});

test('generated ids satisfy the contract patterns and do not repeat', () => {
  const ids = new Set(Array.from({ length: 200 }, () => m.newId('set')));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(m.EXERCISE_ID_PATTERN.test(id), id);
  const key = m.newClientRequestId();
  assert.ok(m.CLIENT_REQUEST_ID_PATTERN.test(key), key);
});

test('a colliding set id is renamed rather than trusted, inside the 80-character limit', () => {
  const taken = new Set(['s1', 's1-2']);
  assert.equal(m.uniqueSetId('s0', taken), 's0');
  assert.equal(m.uniqueSetId('s1', taken), 's1-3');
  const long = 'x'.repeat(80);
  assert.equal(m.uniqueSetId(long, new Set([long])).length, 80);
  assert.match(m.uniqueSetId(long, new Set([long])), /-2$/);
});

/* -------------------------------------------------------------- the field */

test('a typed field keeps only a number the contract accepts, and blank stays null', () => {
  assert.equal(m.sanitizeField('82,5', m.WEIGHT_RULES), '82.5');
  assert.equal(m.sanitizeField('82.567', m.WEIGHT_RULES), '82.56');
  assert.equal(m.sanitizeField('1.2.3', m.WEIGHT_RULES), '1.23');
  assert.equal(m.sanitizeField('-5e3', m.WEIGHT_RULES), '53');
  assert.equal(m.sanitizeField('007', m.WEIGHT_RULES), '7');
  assert.equal(m.sanitizeField('0.5', m.WEIGHT_RULES), '0.5');
  assert.equal(m.sanitizeField('999999999', m.WEIGHT_RULES), String(m.MAX_WEIGHT));
  assert.equal(m.sanitizeField('8.5', m.REPS_RULES), '85');
  assert.equal(m.sanitizeField('abc', m.REPS_RULES), '');
  assert.equal(m.parseFieldValue(''), null, 'an untouched field is null, never 0');
  assert.equal(m.parseFieldValue('.'), null);
  assert.equal(m.parseFieldValue('82,5'), 82.5);
  assert.equal(m.fieldText(null), '');
  assert.equal(m.fieldText(82.5), '82.5');
  assert.equal(m.fieldText(1200), '1200', 'a field never holds a thousands separator');
});

/* ------------------------------------------------------- session from a seed */

test('a seed becomes cards: planned sets, kilograms into the session unit, a slug per row', () => {
  const s = m.createSession(
    {
      name: 'Upper body strength',
      type: 'strength',
      workoutId: 'w1',
      exercises: [
        { name: 'Bench press', sets: 3, reps: 8, weight: 60, rest: 120 },
        { name: '', sets: 2 },
        { name: 'Row', exerciseId: 'barbell-row', sets: 999 },
      ],
    },
    { unit: 'lb', now: at(STARTED) },
  );
  assert.equal(s.name, 'Upper body strength');
  assert.equal(s.startedAt, STARTED);
  assert.equal(s.seedWorkoutId, 'w1');
  assert.equal(s.exercises.length, 2, 'a nameless row is not an exercise');
  assert.equal(s.exercises[0].sets.length, 3);
  assert.equal(s.exercises[0].restSeconds, 120);
  assert.deepEqual(
    s.exercises[0].sets.map((row) => [row.reps, row.weight, row.weightUnit]),
    [
      [8, 132.28, 'lb'],
      [8, 132.28, 'lb'],
      [8, 132.28, 'lb'],
    ],
  );
  assert.equal(s.exercises[1].exerciseId, 'barbell-row');
  assert.equal(s.exercises[1].sets.length, m.MAX_PLANNED_SETS, 'a runaway template is capped');
  assert.equal(m.createSession(null, { unit: 'kg' }).name, 'Workout');
  assert.ok(m.CLIENT_REQUEST_ID_PATTERN.test(s.clientRequestId));
});

test("a repeated log's own sets keep their own units and counts", () => {
  const s = m.createSession(
    { name: 'Push day', exercises: [{ name: 'Bench press', setRecords: [{ reps: 5, weight: 225, weightUnit: 'lb' }, { reps: 5, weight: 100 }] }] },
    { unit: 'kg' },
  );
  assert.deepEqual(
    s.exercises[0].sets.map((row) => [row.reps, row.weight]),
    [
      [5, 102.06],
      [5, 100],
    ],
  );
});

/* ------------------------------------------------------------- the payload */

const payloadSession = () =>
  session({
    notes: 'felt strong',
    exercises: [
      exercise({ exerciseId: 'bench-press', notes: 'pause at the bottom', sets: [done(100, 5, { id: 'a1' }), set({ id: 'a2', weight: 105 }), set({ id: 'a3' })] }),
      exercise({ name: 'Untouched', exerciseId: 'untouched', sets: [set({ id: 'u1' })] }),
    ],
  });

test('the payload sends only documented fields and drops the rows nobody touched', () => {
  const payload = m.buildWorkoutLogPayload(payloadSession(), { now: at('2026-09-21T10:45:00.000Z') });
  assert.deepEqual(Object.keys(payload).sort(), ['date', 'duration', 'exercises', 'name', 'notes', 'setRecordsVersion', 'type']);
  assert.equal(payload.setRecordsVersion, 1);
  assert.equal(payload.duration, 45);
  assert.equal(payload.date, STARTED);
  assert.equal(payload.name, 'Push day');
  assert.equal(payload.notes, 'felt strong');
  assert.equal(payload.exercises.length, 1, 'an exercise with nothing typed is not sent');
  assert.deepEqual(Object.keys(payload.exercises[0]).sort(), ['exerciseId', 'name', 'notes', 'setRecords']);
  assert.equal(payload.exercises[0].setRecords.length, 2, 'the blank third row is not sent');
  assert.deepEqual(Object.keys(payload.exercises[0].setRecords[0]).sort(), ['completed', 'id', 'reps', 'weight', 'weightUnit']);
  assert.deepEqual(payload.exercises[0].setRecords[0], { id: 'a1', completed: true, reps: 5, weight: 100, weightUnit: 'kg' });
  assert.deepEqual(payload.exercises[0].setRecords[1], { id: 'a2', completed: false, reps: 0, weight: 105, weightUnit: 'kg' });
  assert.equal('clientRequestId' in payload, false);
});

test('clientRequestId travels only when the capability says it may', () => {
  const s = payloadSession();
  assert.equal(m.buildWorkoutLogPayload(s, { includeClientRequestId: true }).clientRequestId, s.clientRequestId);
  assert.equal('clientRequestId' in m.buildWorkoutLogPayload(s), false);
});

test('cards sharing an exerciseId merge into one entry the validator accepts', () => {
  const merged = m.payloadExercises({
    exercises: [
      exercise({ name: 'Bench Press', exerciseId: 'custom-bench-press', notes: 'bar felt light', sets: [done(60, 5, { id: 'dup' })] }),
      exercise({ name: 'Row', exerciseId: 'barbell-row', sets: [done(60, 8, { id: 'r1' })] }),
      exercise({ name: 'bench press', exerciseId: 'custom-bench-press', notes: 'second round', sets: [done(90, 8, { id: 'dup' })] }),
    ],
  });
  assert.deepEqual(merged.map((e) => e.exerciseId), ['custom-bench-press', 'barbell-row']);
  assert.equal(merged[0].name, 'Bench Press', 'the first card names the merged entry');
  assert.equal(merged[0].notes, 'bar felt light\nsecond round');
  assert.deepEqual(merged[0].setRecords.map((s) => s.id), ['dup', 'dup-2'], 'a duplicate set id is renamed, not trusted');
  const ids = merged.flatMap((e) => e.setRecords.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(m.EXERCISE_ID_PATTERN.test(id), id);
});

test('the payload clamps every number into the contract band', () => {
  const payload = m.buildWorkoutLogPayload(
    session({
      name: 'x'.repeat(400),
      notes: 'n'.repeat(6000),
      exercises: [exercise({ name: 'e'.repeat(400), sets: [done(1e9, 1e9, { id: 'big' })] })],
    }),
  );
  assert.equal(payload.name.length, m.MAX_NAME_LENGTH);
  assert.equal(payload.notes.length, m.MAX_NOTES_LENGTH);
  assert.equal(payload.exercises[0].name.length, m.MAX_EXERCISE_NAME_LENGTH);
  assert.deepEqual(payload.exercises[0].setRecords[0], { id: 'big', completed: true, reps: m.MAX_REPS, weight: m.MAX_WEIGHT, weightUnit: 'kg' });
});

/* --------------------------------------------------------------- the recap */

test('the recap summarises completed sets, the best set per exercise and the session unit', () => {
  const summary = m.summarizeSession(
    session({
      finishedAt: '2026-09-21T10:45:00.000Z',
      exercises: [
        exercise({ exerciseId: 'bench-press', name: 'Bench press', sets: [done(60, 8), done(80, 3), set({ reps: 5 })] }),
        exercise({ exerciseId: 'squat', name: 'Squat', sets: [set({ reps: 5 })] }),
      ],
    }),
  );
  assert.equal(summary.name, 'Push day');
  assert.equal(summary.durationMin, 45);
  assert.equal(summary.setCount, 2);
  assert.equal(summary.volumeKg, 720);
  assert.equal(summary.unit, 'kg');
  assert.deepEqual(summary.exercises, [{ exerciseId: 'bench-press', name: 'Bench press', setCount: 2, bestSet: { reps: 3, weightKg: 80 } }]);
  assert.equal(m.summarizeSession(session({ unit: 'lb' })).unit, 'lb');
});

test('the PREVIOUS ghost prints in the session unit and says nothing when there is nothing', () => {
  assert.equal(m.formatGhost({ reps: 8, weight: 60, weightUnit: 'kg' }, 'kg'), '60 kg × 8');
  assert.equal(m.formatGhost({ reps: 3, weight: 225, weightUnit: 'lb' }, 'kg'), '102.1 kg × 3');
  assert.equal(m.formatGhost({ reps: 12, weight: 0, weightUnit: 'kg' }, 'kg'), '12 reps');
  assert.equal(m.formatGhost(null, 'kg'), '');
  assert.equal(m.formatSetLine({ reps: 8, weight: 60, weightUnit: 'kg' }, 'lb'), '132.3 lb × 8');
  assert.equal(m.formatSetLine({ reps: null, weight: null, weightUnit: 'kg' }, 'kg'), '0 reps');
});
