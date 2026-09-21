import { create } from 'zustand';
import * as draft from './draft';
import {
  MAX_EXERCISES,
  MAX_EXERCISE_NAME_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SETS_PER_EXERCISE,
  REPS_RULES,
  WEIGHT_RULES,
  adjustRest as adjustRestState,
  canFinish,
  clampRestSeconds,
  completedSetCount,
  convertWeight,
  createSession,
  createSet,
  exerciseSlug,
  findSet,
  isEmptySession,
  isExerciseFinished,
  isRestOver,
  parseFieldValue,
  remainingMs,
  sanitizeField,
  sessionElapsedMs,
  sessionVolumeKg,
  startRest,
  totalSetCount,
} from './math';
import type { PreviousSet, RestTimerState, SessionExercise, SessionSeed, SessionSet, WeightUnit, WorkoutSession } from './types';

/**
 * The live session's state. Same store pattern as `src/lib/units.ts`: a
 * plain zustand store with the reducers on it, so the runner, the recap and
 * the Train hub's resume bar all read one source and nothing has to be
 * threaded through props.
 *
 * Every reducer that changes the session writes the draft (that is the whole
 * point of the persisted shape — see draft.ts), and the store is rehydrated
 * from the draft at import, so the first render after a reload already has
 * the session and the rest countdown. An empty draft (a session with no
 * exercises) is dropped on hydration: it carries no set anyone typed.
 *
 * The reducers mirror the mobile store's transitions
 * (`v2-main-mobile/src/features/workout-session/store.ts`), minus everything
 * that belongs to a phone: notifications, the interval dock, PR detection,
 * measures and sides.
 */

/** Records lookup per exerciseId: absent = not asked, 'loading', 'unavailable' (the route 404s), or the sets. */
export type PreviousState = 'loading' | 'unavailable' | PreviousSet[];

type SessionStore = {
  session: WorkoutSession | null;
  rest: RestTimerState | null;
  /** Keyed by exerciseId; `unavailable` is how a deployment without the records route reads. */
  previous: Record<string, PreviousState>;

  /** Replace whatever is open with a fresh session seeded from `from` (or empty). */
  start: (input: { from?: SessionSeed | null; name?: string; unit: WeightUnit }) => void;
  /** The session as it stands, whether it came from a seed or a resumed draft. */
  addExercise: (name: string, exerciseId?: string | null) => void;
  removeExercise: (key: string) => void;
  toggleCollapsed: (key: string) => void;
  addSet: (key: string) => void;
  removeSet: (key: string, setId: string) => void;
  setField: (setId: string, field: 'weight' | 'reps', text: string) => void;
  toggleSet: (setId: string, now?: number) => void;
  setRest: (key: string, seconds: number) => void;
  addRest: (deltaSec: number, now?: number) => void;
  skipRest: () => void;
  /** Called when the countdown reaches zero, so the dock leaves on its own. */
  clearFinishedRest: (now?: number) => void;
  setName: (name: string) => void;
  setNotes: (notes: string) => void;
  /** The records answer for one exercise (or that the route is not deployed). */
  setPrevious: (exerciseId: string, value: PreviousState) => void;
  /** Stamp `finishedAt` and hand the session over to the recap. */
  finish: (now?: number) => WorkoutSession | null;
  /** The log is saved (or the member discarded): forget everything. */
  discard: () => void;
};

/* --------------------------------------------------------------- helpers */

const mapExercise = (session: WorkoutSession, key: string, fn: (exercise: SessionExercise) => SessionExercise): WorkoutSession => ({
  ...session,
  exercises: session.exercises.map((exercise) => (exercise.key === key ? fn(exercise) : exercise)),
});

const mapSet = (session: WorkoutSession, setId: string, fn: (set: SessionSet) => SessionSet): WorkoutSession => ({
  ...session,
  exercises: session.exercises.map((exercise) =>
    exercise.sets.some((set) => set.id === setId)
      ? { ...exercise, sets: exercise.sets.map((set) => (set.id === setId ? fn(set) : set)) }
      : exercise,
  ),
});

/**
 * The PREVIOUS row a set borrows from: row n of the card takes row n of last
 * session, and a row past last session's count takes its final set (labelled
 * as a fallback by the row, so the member sees it is not a like-for-like).
 */
export function previousFor(sets: readonly PreviousSet[] | undefined, index: number): PreviousSet | null {
  if (!sets || !sets.length) return null;
  return sets[index] ?? sets[sets.length - 1] ?? null;
}

/** The session with every row's `previous` slot refreshed from a records answer. */
function withPrevious(session: WorkoutSession, previous: Record<string, PreviousState>): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => {
      const answer = previous[exercise.exerciseId];
      const sets = Array.isArray(answer) ? answer : undefined;
      return { ...exercise, sets: exercise.sets.map((set, index) => ({ ...set, previous: previousFor(sets, index) })) };
    }),
  };
}

/* ------------------------------------------------------------- the store */

const hydrated = draft.load();
/** A draft with no exercises is nothing anyone typed; it is dropped, not offered. */
const initial = hydrated && !isEmptySession(hydrated.session) ? hydrated : null;
if (hydrated && !initial) draft.clear();

export const useSessionStore = create<SessionStore>((set, get) => {
  /** Commit a session change and mirror it to storage in one place. */
  const commit = (session: WorkoutSession | null, rest: RestTimerState | null | undefined = undefined) => {
    const nextRest = rest === undefined ? get().rest : rest;
    set({ session, rest: nextRest });
    if (session) draft.save(session, nextRest);
    else draft.clear();
  };

  return {
    session: initial?.session ?? null,
    rest: initial && !isRestOver(initial.rest) ? initial.rest : null,
    previous: {},

    start({ from, name, unit }) {
      const session = createSession(from ?? null, { unit, name });
      set({ previous: {} });
      commit(session, null);
    },

    addExercise(name, exerciseId) {
      const session = get().session;
      const clean = (name ?? '').trim().slice(0, MAX_EXERCISE_NAME_LENGTH);
      if (!session || !clean || session.exercises.length >= MAX_EXERCISES) return;
      const answer = get().previous[exerciseSlug(clean, exerciseId)];
      const sets = Array.isArray(answer) ? answer : undefined;
      const exercise: SessionExercise = {
        key: `ex-${session.exercises.length}-${Date.now().toString(36)}`,
        exerciseId: exerciseSlug(clean, exerciseId),
        name: clean,
        sets: [createSet(session.unit, { previous: previousFor(sets, 0) })],
        restSeconds: 90,
        notes: '',
      };
      // The clock starts with the first exercise, so a draft that sat open
      // overnight does not open on a two-hour session nobody trained.
      const startedAt = isEmptySession(session) ? new Date().toISOString() : session.startedAt;
      commit({ ...session, startedAt, exercises: [...session.exercises, exercise] });
    },

    removeExercise(key) {
      const session = get().session;
      if (!session) return;
      const rest = get().rest?.exerciseKey === key ? null : get().rest;
      commit({ ...session, exercises: session.exercises.filter((exercise) => exercise.key !== key) }, rest);
    },

    toggleCollapsed(key) {
      const session = get().session;
      if (!session) return;
      commit(mapExercise(session, key, (exercise) => ({ ...exercise, collapsed: !exercise.collapsed })));
    },

    addSet(key) {
      const session = get().session;
      if (!session) return;
      const exerciseId = session.exercises.find((exercise) => exercise.key === key)?.exerciseId ?? '';
      const answer = get().previous[exerciseId];
      const sets = Array.isArray(answer) ? answer : undefined;
      commit(
        mapExercise(session, key, (exercise) => {
          if (exercise.sets.length >= MAX_SETS_PER_EXERCISE) return exercise;
          // "+ Add set" copies the row above — the numbers a lifter is most
          // likely to repeat — and comes up unchecked.
          const above = exercise.sets[exercise.sets.length - 1];
          const next = createSet(session.unit, {
            reps: above?.reps ?? null,
            weight: above?.weight ?? null,
            previous: previousFor(sets, exercise.sets.length),
          });
          return { ...exercise, collapsed: false, sets: [...exercise.sets, next] };
        }),
      );
    },

    removeSet(key, setId) {
      const session = get().session;
      if (!session) return;
      const rest = get().rest?.setId === setId ? null : get().rest;
      commit(
        mapExercise(session, key, (exercise) => ({ ...exercise, sets: exercise.sets.filter((row) => row.id !== setId) })),
        rest,
      );
    },

    setField(setId, field, text) {
      const session = get().session;
      if (!session) return;
      const clean = sanitizeField(text, field === 'weight' ? WEIGHT_RULES : REPS_RULES);
      const value = parseFieldValue(clean);
      commit(
        mapSet(session, setId, (row) => ({
          ...row,
          [field]: field === 'reps' && value !== null ? Math.round(value) : value,
        })),
      );
    },

    toggleSet(setId, now = Date.now()) {
      const session = get().session;
      const found = findSet(session, setId);
      if (!session || !found) return;
      const { exercise, set: row, index } = found;

      if (row.completed) {
        // Reopening expands the card again: the row is being worked on.
        const reopened = mapExercise(mapSet(session, setId, (s) => ({ ...s, completed: false, completedAt: null })), exercise.key, (e) => ({
          ...e,
          collapsed: false,
        }));
        commit(reopened, get().rest?.setId === setId ? null : get().rest);
        return;
      }

      // ✓ commits the placeholders: every field still empty takes the
      // PREVIOUS value shown in the row. A typed value is never overwritten.
      const answer = get().previous[exercise.exerciseId];
      const previous = row.previous ?? previousFor(Array.isArray(answer) ? answer : undefined, index);
      const reps = row.reps ?? (previous ? previous.reps : null);
      const weight = row.weight ?? (previous ? convertWeight(previous.weight, previous.weightUnit, row.weightUnit) : null);
      // A row with no reps to check is not a set; the runner keeps the field
      // focused instead of logging a zero.
      if (reps === null || reps <= 0) return;

      let next = mapSet(session, setId, (s) => ({
        ...s,
        reps: Math.round(reps),
        weight,
        completed: true,
        completedAt: new Date(now).toISOString(),
      }));
      // Focus mode: a finished card folds away, but only when there is
      // somewhere else to go and it holds more than one set.
      const updated = next.exercises.find((e) => e.key === exercise.key);
      if (updated && next.exercises.length >= 2 && updated.sets.length >= 2 && isExerciseFinished(updated)) {
        next = mapExercise(next, exercise.key, (e) => ({ ...e, collapsed: true }));
      }
      const restSeconds = exercise.restSeconds;
      const rest = restSeconds > 0 ? startRest({ exerciseKey: exercise.key, setId, durationSec: restSeconds, now }) : null;
      commit(next, rest);
    },

    setRest(key, seconds) {
      const session = get().session;
      if (!session) return;
      const restSeconds = seconds <= 0 ? 0 : clampRestSeconds(seconds);
      const rest = restSeconds === 0 && get().rest?.exerciseKey === key ? null : get().rest;
      commit(mapExercise(session, key, (exercise) => ({ ...exercise, restSeconds })), rest);
    },

    addRest(deltaSec, now = Date.now()) {
      const rest = get().rest;
      const session = get().session;
      if (!rest || !session) return;
      const next = adjustRestState(rest, deltaSec, now);
      set({ rest: next });
      draft.save(session, next);
    },

    skipRest() {
      const session = get().session;
      set({ rest: null });
      if (session) draft.save(session, null);
    },

    clearFinishedRest(now = Date.now()) {
      const rest = get().rest;
      if (!rest || !isRestOver(rest, now)) return;
      const session = get().session;
      set({ rest: null });
      if (session) draft.save(session, null);
    },

    setName(name) {
      const session = get().session;
      if (!session) return;
      commit({ ...session, name: name.slice(0, MAX_NAME_LENGTH) });
    },

    setNotes(notes) {
      const session = get().session;
      if (!session) return;
      commit({ ...session, notes: notes.slice(0, MAX_NOTES_LENGTH) });
    },

    setPrevious(exerciseId, value) {
      const previous = { ...get().previous, [exerciseId]: value };
      set({ previous });
      const session = get().session;
      // Only the placeholders move, so this never touches a typed value.
      if (session) commit(withPrevious(session, previous));
    },

    finish(now = Date.now()) {
      const session = get().session;
      if (!session || !canFinish(session)) return null;
      const finished = { ...session, finishedAt: new Date(now).toISOString() };
      commit(finished, null);
      return finished;
    },

    discard() {
      set({ previous: {} });
      commit(null, null);
    },
  };
});

/* ------------------------------------------------------------- selectors */

/** The session on screen, or null. One stable reference per change. */
export const useActiveSession = (): WorkoutSession | null => useSessionStore((s) => s.session);

/** The running rest, or null. */
export const useRestTimer = (): RestTimerState | null => useSessionStore((s) => s.rest);

/** Whether a session is open and worth resuming (the hub's "Resume session"). */
export const useHasSession = (): boolean => useSessionStore((s) => s.session !== null && !isEmptySession(s.session));

/**
 * The header's three numbers and the gates around them. `elapsedMs` is
 * computed from the `now` the caller passes (the runner ticks a clock and
 * corrects it on `visibilitychange`), never from a counter.
 */
export function sessionStats(session: WorkoutSession | null, now: number = Date.now()) {
  return {
    elapsedMs: sessionElapsedMs(session, now),
    volumeKg: session ? sessionVolumeKg(session) : 0,
    setCount: session ? completedSetCount(session) : 0,
    plannedSets: session ? totalSetCount(session) : 0,
    canFinish: canFinish(session),
  };
}

/** The rest dock's numbers, or null when nothing is resting. */
export function restStats(rest: RestTimerState | null, now: number = Date.now()) {
  if (!rest) return null;
  const left = remainingMs(rest, now);
  return { remainingMs: left, over: left === 0, durationSec: rest.durationSec, setId: rest.setId, exerciseKey: rest.exerciseKey };
}
