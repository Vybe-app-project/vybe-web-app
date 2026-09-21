/**
 * The live session's store and its draft (src/pages/workouts/session/{store,
 * draft}.ts). The transitions mirror the mobile store's
 * (v2-main-mobile/src/features/workout-session/store.ts): ✓ commits the
 * PREVIOUS placeholders when the fields are untouched, never overwrites a
 * typed value, starts the rest, and folds a finished card away.
 *
 * The draft is the web-specific half: every change is mirrored to
 * localStorage under a versioned key, so a reload resumes the same session
 * with the same elapsed origin and the same absolute rest deadline. A
 * localStorage shim stands in for the browser's — the store reads it at
 * import, so it is installed first.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./ts-loader.mjs', import.meta.url);

/* A localStorage the store can be pointed at, one session at a time. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};

const draft = await import('../src/pages/workouts/session/draft.ts');
const { useSessionStore, previousFor, sessionStats, restStats } = await import('../src/pages/workouts/session/store.ts');
const math = await import('../src/pages/workouts/session/math.ts');

const api = () => useSessionStore.getState();
const session = () => useSessionStore.getState().session;
const first = () => session().exercises[0];
const reset = () => {
  api().discard();
  store.clear();
};

const SEED = {
  name: 'Upper body strength',
  type: 'strength',
  workoutId: 'w1',
  exercises: [
    { name: 'Bench press', sets: 2, reps: 8, weight: 60, rest: 90 },
    { name: 'Row', exerciseId: 'barbell-row', sets: 1, reps: 10 },
  ],
};

/* -------------------------------------------------------------- starting */

test('start seeds the cards, the planned sets and the draft; discard forgets all of it', () => {
  reset();
  api().start({ from: SEED, unit: 'kg' });
  assert.equal(session().name, 'Upper body strength');
  assert.equal(session().seedWorkoutId, 'w1');
  assert.deepEqual(session().exercises.map((e) => [e.name, e.sets.length]), [['Bench press', 2], ['Row', 1]]);
  assert.equal(first().sets[0].previous, null, 'the PREVIOUS slot is empty until the records query answers');
  assert.ok(draft.load(), 'the draft exists from the first frame');
  assert.equal(draft.load().session.sessionId, session().sessionId);
  api().discard();
  assert.equal(session(), null);
  assert.equal(draft.load(), null);
});

test('an empty session starts with no cards and takes exercises by name', () => {
  reset();
  api().start({ unit: 'kg' });
  assert.equal(session().name, 'Workout');
  assert.equal(session().exercises.length, 0);
  api().addExercise('  Overhead press  ');
  assert.equal(first().name, 'Overhead press');
  assert.equal(first().exerciseId, 'custom-overhead-press', 'a free-text name becomes a stable slug');
  assert.equal(first().sets.length, 1);
  api().addExercise('');
  assert.equal(session().exercises.length, 1, 'a blank name is not an exercise');
  // The picker seam: an exercise added with a library id keeps it.
  api().addExercise('Barbell row', 'barbell-row');
  assert.equal(session().exercises[1].exerciseId, 'barbell-row');
});

test('the clock is re-based when the first exercise lands, so an old empty draft does not open on hours', () => {
  reset();
  api().start({ unit: 'kg' });
  useSessionStore.setState({ session: { ...session(), startedAt: '2020-01-01T00:00:00.000Z' } });
  api().addExercise('Squat');
  assert.ok(Date.now() - new Date(session().startedAt).getTime() < 5000);
  // A second exercise does not move it again.
  const startedAt = session().startedAt;
  api().addExercise('Deadlift');
  assert.equal(session().startedAt, startedAt);
});

/* ------------------------------------------------------------ typing sets */

test('a typed field is sanitised, and blank stays null rather than snapping to zero', () => {
  reset();
  api().start({ from: SEED, unit: 'kg' });
  const id = first().sets[0].id;
  api().setField(id, 'weight', '82,567');
  assert.equal(math.findSet(session(), id).set.weight, 82.56);
  api().setField(id, 'reps', '8.9');
  assert.equal(math.findSet(session(), id).set.reps, 89);
  api().setField(id, 'weight', '');
  assert.equal(math.findSet(session(), id).set.weight, null);
  assert.equal(draft.load().session.exercises[0].sets[0].weight, null, 'every keystroke reaches the draft');
});

test('add set copies the row above and comes up unchecked; remove set takes it away', () => {
  reset();
  api().start({ unit: 'kg' });
  api().addExercise('Bench press');
  const key = first().key;
  api().setField(first().sets[0].id, 'weight', '60');
  api().setField(first().sets[0].id, 'reps', '8');
  api().addSet(key);
  assert.equal(first().sets.length, 2);
  assert.deepEqual([first().sets[1].weight, first().sets[1].reps, first().sets[1].completed], [60, 8, false]);
  api().removeSet(key, first().sets[1].id);
  assert.equal(first().sets.length, 1);
  api().removeExercise(key);
  assert.equal(session().exercises.length, 0);
});

/* ------------------------------------------------------- the PREVIOUS column */

test('the records answer fills every row s placeholder and a row past last time takes the final set', () => {
  reset();
  api().start({ from: SEED, unit: 'kg' });
  api().addSet(first().key); // three rows against two previous sets
  api().setPrevious('custom-bench-press', [
    { reps: 8, weight: 60, weightUnit: 'kg' },
    { reps: 6, weight: 65, weightUnit: 'kg' },
  ]);
  assert.deepEqual(first().sets.map((s) => s.previous?.weight), [60, 65, 65]);
  assert.equal(previousFor(undefined, 0), null);
  assert.equal(previousFor([], 0), null);
  // A deployment without the route answers `unavailable`; the column shows nothing.
  api().setPrevious('barbell-row', 'unavailable');
  assert.equal(session().exercises[1].sets[0].previous, null);
  assert.equal(api().previous['barbell-row'], 'unavailable');
});

test('✓ commits the placeholders when the fields are untouched and never overwrites a typed value', () => {
  reset();
  api().start({ from: { name: 'Push day', exercises: [{ name: 'Bench press', sets: 3 }] }, unit: 'kg' });
  api().setPrevious('custom-bench-press', [
    { reps: 8, weight: 60, weightUnit: 'kg' },
    { reps: 8, weight: 60, weightUnit: 'kg' },
    { reps: 8, weight: 60, weightUnit: 'kg' },
  ]);
  const [a, b, c] = first().sets.map((s) => s.id);

  api().toggleSet(a);
  assert.deepEqual([math.findSet(session(), a).set.weight, math.findSet(session(), a).set.reps], [60, 8]);
  assert.equal(math.findSet(session(), a).set.completed, true);
  assert.ok(math.findSet(session(), a).set.completedAt);

  api().setField(b, 'weight', '65');
  api().toggleSet(b);
  assert.deepEqual([math.findSet(session(), b).set.weight, math.findSet(session(), b).set.reps], [65, 8], 'the typed weight stands, the ghost fills the reps');

  // Reopening clears the completion but keeps what was committed.
  api().toggleSet(b);
  assert.equal(math.findSet(session(), b).set.completed, false);
  assert.equal(math.findSet(session(), b).set.weight, 65);

  // A row with no reps and no ghost is not a set: nothing is logged.
  api().setPrevious('custom-bench-press', 'unavailable');
  api().toggleSet(c);
  assert.equal(math.findSet(session(), c).set.completed, false);
});

test('a checked set starts the rest, and a card with rest off starts none', () => {
  reset();
  api().start({ from: { name: 'Push day', exercises: [{ name: 'Bench press', sets: 2, reps: 8, weight: 60, rest: 90 }] }, unit: 'kg' });
  api().toggleSet(first().sets[0].id);
  const rest = api().rest;
  assert.equal(rest.durationSec, 90);
  assert.equal(rest.setId, first().sets[0].id);
  assert.ok(rest.deadline - rest.startedAt === 90_000);
  assert.equal(restStats(rest, rest.startedAt).remainingMs, 90_000);
  assert.equal(restStats(null), null);

  api().addRest(15);
  assert.equal(api().rest.durationSec, 105);
  api().skipRest();
  assert.equal(api().rest, null);

  api().setRest(first().key, 0);
  api().toggleSet(first().sets[1].id);
  assert.equal(api().rest, null, 'rest off means no dock');
  api().setRest(first().key, 9999);
  assert.equal(first().restSeconds, math.MAX_REST_SECONDS);
});

test('a finished card folds away only when there is another card and more than one set', () => {
  reset();
  api().start({ from: { name: 'Push day', exercises: [{ name: 'Bench press', sets: 2, reps: 8, weight: 60 }] }, unit: 'kg' });
  api().toggleSet(first().sets[0].id);
  api().toggleSet(first().sets[1].id);
  assert.equal(first().collapsed, undefined, 'the only card on the page stays open');

  reset();
  api().start({
    from: { name: 'Push day', exercises: [{ name: 'Bench press', sets: 2, reps: 8, weight: 60 }, { name: 'Row', sets: 1, reps: 10, weight: 40 }] },
    unit: 'kg',
  });
  api().toggleSet(first().sets[0].id);
  assert.equal(first().collapsed, undefined, 'one set of two is not a finished card');
  api().toggleSet(first().sets[1].id);
  assert.equal(first().collapsed, true);
  api().toggleCollapsed(first().key);
  assert.equal(first().collapsed, false);
  // A single-set card never folds.
  api().toggleSet(session().exercises[1].sets[0].id);
  assert.equal(session().exercises[1].collapsed, undefined);
});

/* -------------------------------------------------------------- finishing */

test('finish needs a completed set, stamps finishedAt and keeps the draft until the log is saved', () => {
  reset();
  api().start({ from: SEED, unit: 'kg' });
  assert.equal(api().finish(), null, 'nothing to finish without a completed set');
  api().setField(first().sets[0].id, 'reps', '8');
  api().setField(first().sets[0].id, 'weight', '60');
  api().toggleSet(first().sets[0].id);
  const finished = api().finish();
  assert.ok(finished.finishedAt);
  assert.equal(api().rest, null, 'the dock closes with the session');
  assert.ok(draft.load(), 'a reload on the recap still resumes');
  const stats = sessionStats(finished, new Date(finished.startedAt).getTime() + 754_000);
  assert.equal(math.formatElapsed(stats.elapsedMs), '12:34');
  assert.equal(stats.setCount, 1);
  assert.equal(stats.volumeKg, 480);
  assert.equal(stats.plannedSets, 3);
  assert.equal(stats.canFinish, true);
  assert.deepEqual(sessionStats(null), { elapsedMs: 0, volumeKg: 0, setCount: 0, plannedSets: 0, canFinish: false });
});

/* ----------------------------------------------------------------- draft */

test('the draft round-trips the session and the rest deadline under a versioned key', () => {
  reset();
  api().start({ from: SEED, unit: 'lb' });
  api().toggleSet(first().sets[0].id);
  const raw = JSON.parse(store.get(draft.DRAFT_KEY));
  assert.equal(raw.version, draft.DRAFT_VERSION);
  assert.equal(draft.DRAFT_KEY, 'vybe.session.draft');
  assert.ok(raw.savedAt);
  const stored = draft.load();
  assert.equal(stored.session.startedAt, session().startedAt, 'the elapsed origin survives a reload exactly');
  assert.equal(stored.session.unit, 'lb');
  assert.equal(stored.rest.deadline, api().rest.deadline, 'the countdown resumes from an absolute deadline');
});

test('a corrupt, foreign or future-version draft is dropped rather than guessed at', () => {
  reset();
  store.set(draft.DRAFT_KEY, 'not json');
  assert.equal(draft.load(), null);
  store.set(draft.DRAFT_KEY, JSON.stringify({ version: 99, session: {} }));
  assert.equal(draft.load(), null);
  store.set(draft.DRAFT_KEY, JSON.stringify({ version: 1, session: { sessionId: 'x' } }));
  assert.equal(draft.load(), null);
  api().start({ from: SEED, unit: 'kg' });
  const good = JSON.parse(store.get(draft.DRAFT_KEY));
  assert.ok(draft.load());
  // A session whose sets are not sets is not a draft.
  store.set(draft.DRAFT_KEY, JSON.stringify({ ...good, session: { ...good.session, exercises: [{ key: 'k', exerciseId: 'e', name: 'n', sets: [{ nope: true }] }] } }));
  assert.equal(draft.load(), null);
  // A rest that is not a rest is simply absent; the session still resumes.
  store.set(draft.DRAFT_KEY, JSON.stringify({ ...good, rest: { broken: true } }));
  assert.equal(draft.load().rest, null);
  assert.ok(draft.load().session);
  draft.clear();
  assert.equal(draft.load(), null);
});

test('storage that throws never costs a set', () => {
  reset();
  const working = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  try {
    assert.equal(draft.load(), null);
    api().start({ from: SEED, unit: 'kg' });
    api().toggleSet(first().sets[0].id);
    assert.equal(api().session.exercises[0].sets[0].completed, true, 'the session runs; only the resume is lost');
    draft.clear();
  } finally {
    globalThis.localStorage = working;
    reset();
  }
});
