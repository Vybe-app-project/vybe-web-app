/**
 * The live session's shape on the web — a port of the mobile runner's
 * `src/features/workout-session/types.ts`, trimmed to what a browser session
 * needs: reps × weight sets, one rest timer, one draft.
 *
 * What the mobile types carry and this one deliberately does not: measures
 * (timed / distance / rounds), sides, supersets, set types, RPE, per-set
 * notes, PR hits and programme pointers. Every one of those rides a sidecar
 * route or a phone-local store; none of them is on `POST /workouts/logs`, so
 * the web port stays on the per-set contract in
 * `int-vybe-backend/docs/workout-set-records.md` and nothing else.
 */

export type WeightUnit = 'kg' | 'lb';

/**
 * A set from the member's last session with this exerciseId
 * (`GET /workouts/records/previous`): the PREVIOUS column, and the value a ✓
 * commits when the row's fields are untouched.
 */
export type PreviousSet = {
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
  /** The server derived it from an aggregate log rather than a recorded set. */
  synthetic?: boolean;
};

export type SessionSet = {
  /** Client-generated, stable, `^[A-Za-z0-9_-]{1,80}$` (the contract's set id). */
  id: string;
  /** null until the lifter has typed something; 0 is a real (uncheckable) value. */
  reps: number | null;
  weight: number | null;
  weightUnit: WeightUnit;
  completed: boolean;
  completedAt: string | null;
  /** Empty until the records query answers; the row's placeholders come from here. */
  previous?: PreviousSet | null;
};

export type SessionExercise = {
  /** Row key, stable across edits, unique within the session. */
  key: string;
  /** The per-set contract's `exerciseId`: a library slug or `custom-<kebab(name)>`. */
  exerciseId: string;
  name: string;
  sets: SessionSet[];
  /** Rest a checked set of this exercise starts, in seconds; 0 means off. */
  restSeconds: number;
  notes: string;
  /** A finished card collapses to one line; reopened by the chevron. */
  collapsed?: boolean;
};

export type WorkoutSession = {
  sessionId: string;
  /** ISO. The header clock is `now − startedAt`, never a ticking counter. */
  startedAt: string;
  finishedAt: string | null;
  name: string;
  /** A `CATEGORIES` value (src/pages/workouts/model.ts). */
  type: string;
  /** Display and entry unit for this session; follows the member's Units setting. */
  unit: WeightUnit;
  exercises: SessionExercise[];
  notes: string;
  /**
   * Generated once per session and re-sent verbatim on a retry. Sent as
   * `clientRequestId` ONLY when `capabilities.workoutLogIdempotency` is true;
   * an older deployment answers 400 to the unknown field.
   */
  clientRequestId: string;
  /** The library workout or past log this session was seeded from, for "started from". */
  seedWorkoutId: string | null;
};

/** Rest timer state; the deadline is absolute, so a hidden tab costs nothing. */
export type RestTimerState = {
  exerciseKey: string;
  setId: string;
  /** Epoch ms when the rest started. */
  startedAt: number;
  /** Epoch ms when the rest ends. */
  deadline: number;
  durationSec: number;
};

/** One exercise as a seed hands it over (a library workout's row, or a past log's). */
export type TemplateExercise = {
  name: string;
  exerciseId?: string | null;
  sets?: number | null;
  reps?: number | null;
  /** Kilograms, the unit templates and aggregate logs store. */
  weight?: number | null;
  weightUnit?: WeightUnit;
  notes?: string | null;
  /** Seconds, from a library row's `rest`. */
  rest?: number | null;
  /** A past log's individual sets, when it was written by a set-aware client. */
  setRecords?: Array<{ id?: string; reps?: number; weight?: number; weightUnit?: WeightUnit }>;
};

/** What `start({ from })` takes: a library workout, a past log, or nothing. */
export type SessionSeed = {
  name?: string | null;
  type?: string | null;
  /** The workout or log id the session came from. */
  workoutId?: string | null;
  exercises?: TemplateExercise[];
};

/* --------------------------------------------------------------- the wire */

export type SetRecordPayload = {
  id: string;
  completed: boolean;
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
};

export type ExercisePayload = {
  exerciseId: string;
  name: string;
  setRecords: SetRecordPayload[];
  notes?: string;
};

/** `POST /workouts/logs` body for a set-aware session. */
export type WorkoutLogPayload = {
  name: string;
  type: string;
  date: string;
  duration: number;
  setRecordsVersion: 1;
  exercises: ExercisePayload[];
  notes?: string;
  clientRequestId?: string;
};

/* ------------------------------------------------------------- the recap */

export type BestSet = { reps: number; weightKg: number } | null;

export type SessionSummaryExercise = {
  exerciseId: string;
  name: string;
  setCount: number;
  bestSet: BestSet;
};

/** The recap's numbers: what `summarizeSession` returns. */
export type SessionSummary = {
  name: string;
  date: string;
  durationMin: number;
  setCount: number;
  volumeKg: number;
  unit: WeightUnit;
  exercises: SessionSummaryExercise[];
};
