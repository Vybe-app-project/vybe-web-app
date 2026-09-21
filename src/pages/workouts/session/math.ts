import type { UnitSystem } from '../../../lib/unitConversions';
import type {
  BestSet,
  ExercisePayload,
  PreviousSet,
  RestTimerState,
  SessionExercise,
  SessionSeed,
  SessionSet,
  SessionSummary,
  SetRecordPayload,
  TemplateExercise,
  WeightUnit,
  WorkoutLogPayload,
  WorkoutSession,
} from './types';

/**
 * Pure arithmetic and formatting for the live session — the web port of the
 * mobile runner's `src/features/workout-session/sessionMath.ts` (plus the
 * parts of `restTimer.ts` and `sessionFinish.ts` a browser needs).
 *
 * Two rules carry most of the file. Units: a set keeps the unit it was
 * entered in and the server stores it; every total and comparison happens in
 * kilograms with the contract's exact factor (1 lb = 0.45359237 kg,
 * docs/workout-set-records.md) and converts for display only. Time: nothing
 * counts, everything is derived from an absolute instant — a hidden tab
 * throttles timers, so the header clock is `now − startedAt` and the rest
 * countdown is `deadline − now`. Both survive a reload for free.
 *
 * No React, no storage, no network: the store, the runner and the recap all
 * call in here, and tests/session-math.test.mjs imports it directly.
 */

export const KG_PER_LB = 0.45359237;

/** The contract's limits (docs/workout-set-records.md). */
export const MAX_REPS = 10_000;
export const MAX_WEIGHT = 100_000;
export const MAX_DURATION_MIN = 1440;
export const MAX_NAME_LENGTH = 120;
export const MAX_NOTES_LENGTH = 5000;
export const MAX_EXERCISE_NAME_LENGTH = 200;
/** 1–100 exercises, 0–100 sets per exercise. */
export const MAX_EXERCISES = 100;
export const MAX_SETS_PER_EXERCISE = 100;
/** A seed may plan this many sets per row; more is a template, not a session. */
export const MAX_PLANNED_SETS = 20;

export const EXERCISE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
/** The capability's format for `clientRequestId`. */
export const CLIENT_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;

export function roundWeight(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function toKg(weight: number, unit: WeightUnit): number {
  return unit === 'lb' ? weight * KG_PER_LB : weight;
}

export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kg / KG_PER_LB : kg;
}

/** Convert for display, or when a seed's kilograms land in an lb session; 2 dp. */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return roundWeight(fromKg(toKg(value, from), to));
}

/** The weight unit the member's Units setting implies — one account, one unit. */
export const weightUnitFor = (system: UnitSystem): WeightUnit => (system === 'imperial' ? 'lb' : 'kg');

/* ------------------------------------------------------ volume and counts */

/** A set counts toward volume when it is checked and carries both a load and reps. */
export function countsTowardVolume(set: SessionSet): boolean {
  return set.completed && (set.reps ?? 0) > 0 && (set.weight ?? 0) > 0;
}

export function setVolumeKg(set: SessionSet): number {
  return countsTowardVolume(set) ? (set.reps as number) * toKg(set.weight as number, set.weightUnit) : 0;
}

export function exerciseVolumeKg(exercise: Pick<SessionExercise, 'sets'>): number {
  return exercise.sets.reduce((sum, set) => sum + setVolumeKg(set), 0);
}

export function sessionVolumeKg(session: Pick<WorkoutSession, 'exercises'>): number {
  return session.exercises.reduce((sum, exercise) => sum + exerciseVolumeKg(exercise), 0);
}

export function completedSetCount(session: Pick<WorkoutSession, 'exercises'>): number {
  return session.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.completed).length, 0);
}

export function totalSetCount(session: Pick<WorkoutSession, 'exercises'>): number {
  return session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

/** At least one set and every one checked: the card collapses to its one line. */
export function isExerciseFinished(exercise: Pick<SessionExercise, 'sets'>): boolean {
  return exercise.sets.length > 0 && exercise.sets.every((set) => set.completed);
}

/** Nothing to lose: a session with no exercises is never offered for resume. */
export function isEmptySession(session: Pick<WorkoutSession, 'exercises'> | null | undefined): boolean {
  return !session || session.exercises.length === 0;
}

/** Finishing needs one completed set; the button says why otherwise. */
export function canFinish(session: Pick<WorkoutSession, 'exercises'> | null | undefined): boolean {
  return Boolean(session) && completedSetCount(session as Pick<WorkoutSession, 'exercises'>) > 0;
}

/** Whether a row is still on the table and still unchecked. */
export function isSetStillOpen(session: Pick<WorkoutSession, 'exercises'> | null | undefined, setId: string): boolean {
  const set = findSet(session, setId);
  return Boolean(set && !set.set.completed);
}

/** The exercise and set a set id belongs to, or null. */
export function findSet(
  session: Pick<WorkoutSession, 'exercises'> | null | undefined,
  setId: string,
): { exercise: SessionExercise; set: SessionSet; index: number } | null {
  for (const exercise of session?.exercises ?? []) {
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index >= 0) return { exercise, set: exercise.sets[index], index };
  }
  return null;
}

/**
 * What the card's one line quotes: the heaviest completed set, in kilograms.
 * A card nobody loaded (a bodyweight movement) has no heaviest set, so its
 * best is the most reps instead — "12 reps", never "0 kg × 12". Null when no
 * set was completed at all.
 */
export function bestSetOf(exercise: Pick<SessionExercise, 'sets'>): BestSet {
  let best: BestSet = null;
  let mostReps: BestSet = null;
  for (const set of exercise.sets) {
    if (!set.completed || (set.reps ?? 0) <= 0) continue;
    const reps = set.reps as number;
    if (!mostReps || reps > mostReps.reps) mostReps = { reps, weightKg: 0 };
    if ((set.weight ?? 0) <= 0) continue;
    const weightKg = toKg(set.weight as number, set.weightUnit);
    if (!best || weightKg > best.weightKg) best = { reps, weightKg: roundWeight(weightKg, 3) };
  }
  return best ?? mostReps;
}

/* ---------------------------------------------------------- formatting */

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const wholeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** "82.5 kg" — one unit per number, a space before it. */
export function formatWeight(valueInUnit: number, unit: WeightUnit): string {
  return `${numberFormat.format(valueInUnit)} ${unit}`;
}

export function formatWeightKg(kg: number, unit: WeightUnit): string {
  return formatWeight(roundWeight(fromKg(kg, unit)), unit);
}

/** Session volume as a whole number in the session unit: "12,340 kg". */
export function formatVolume(kg: number, unit: WeightUnit): string {
  return `${wholeFormat.format(Math.round(fromKg(kg, unit)))} ${unit}`;
}

/** The PREVIOUS ghost, in the session unit: "60 kg × 8". */
export function formatGhost(previous: PreviousSet | null | undefined, unit: WeightUnit): string {
  if (!previous) return '';
  if (previous.weight > 0) return `${formatWeight(convertWeight(previous.weight, previous.weightUnit, unit), unit)} × ${previous.reps}`;
  return `${previous.reps} ${previous.reps === 1 ? 'rep' : 'reps'}`;
}

/** A logged set: "60 kg × 8", or "12 reps" when it carried no load. */
export function formatSetLine(set: Pick<SessionSet, 'reps' | 'weight' | 'weightUnit'>, unit: WeightUnit): string {
  const reps = set.reps ?? 0;
  const weight = set.weight ?? 0;
  if (weight > 0) return `${formatWeight(convertWeight(weight, set.weightUnit, unit), unit)} × ${reps}`;
  return `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}

/** A best set (kilograms) in the session unit: "60 kg × 8". */
export function formatBestSetKg(best: BestSet, unit: WeightUnit): string {
  if (!best) return '';
  if (best.weightKg > 0) return `${formatWeightKg(best.weightKg, unit)} × ${best.reps}`;
  return `${best.reps} ${best.reps === 1 ? 'rep' : 'reps'}`;
}

/* ------------------------------------------------------------- the clock */

export function elapsedMs(startedAt: string, now: number = Date.now()): number {
  const started = new Date(startedAt).getTime();
  return Number.isFinite(started) ? Math.max(0, now - started) : 0;
}

/**
 * The header clock. An empty session reads 0:00 rather than the age of a
 * draft nobody logged a set into (the store re-bases `startedAt` when the
 * first exercise lands).
 */
export function sessionElapsedMs(
  session: Pick<WorkoutSession, 'startedAt' | 'exercises'> | null | undefined,
  now: number = Date.now(),
): number {
  if (!session || isEmptySession(session)) return 0;
  return elapsedMs(session.startedAt, now);
}

/** "12:34" under an hour, "1:02:03" over. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, '0');
  return hours ? `${hours}:${mm}:${String(seconds).padStart(2, '0')}` : `${mm}:${String(seconds).padStart(2, '0')}`;
}

/** Whole minutes for the log's `duration`: at least 1, at most the contract's 1440. */
export function durationMinutes(startedAt: string, finishedAt: string | null, now: number = Date.now()): number {
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 1;
  const ms = Math.max(0, (Number.isFinite(end) ? end : now) - started);
  return Math.min(MAX_DURATION_MIN, Math.max(1, Math.round(ms / 60_000)));
}

/* --------------------------------------------------------- the rest dock */

export const DEFAULT_REST_SECONDS = 90;
export const MIN_REST_SECONDS = 5;
export const MAX_REST_SECONDS = 600;
export const REST_STEP_SECONDS = 15;
/** What the card's rest menu offers; 0 is "off". */
export const REST_PRESETS: readonly number[] = Object.freeze([60, 90, 120, 180, 0]);

/** Seconds into the allowed band; anything unusable reads as the default. */
export function clampRestSeconds(value: unknown): number {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_REST_SECONDS;
  return Math.min(MAX_REST_SECONDS, Math.max(MIN_REST_SECONDS, seconds));
}

/** A rest a seed asked for: clamped, or off when the template said nothing usable. */
export function seedRestSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_REST_SECONDS;
  return clampRestSeconds(value);
}

export function startRest(input: { exerciseKey: string; setId: string; durationSec: number; now?: number }): RestTimerState {
  const now = input.now ?? Date.now();
  const durationSec = clampRestSeconds(input.durationSec);
  return { exerciseKey: input.exerciseKey, setId: input.setId, startedAt: now, deadline: now + durationSec * 1000, durationSec };
}

/**
 * Milliseconds left; never negative, never more than the configured rest.
 * The upper clamp keeps the dock's first render honest: the page's 1 s tick
 * is up to a second older than the check that started the rest, so
 * `deadline − now` could read 90.9 s and the clock "1:31" for a 1:30 rest.
 */
export function remainingMs(state: RestTimerState | null | undefined, now: number = Date.now()): number {
  if (!state) return 0;
  return Math.min(Math.max(0, state.durationSec) * 1000, Math.max(0, state.deadline - now));
}

export function isRestOver(state: RestTimerState | null | undefined, now: number = Date.now()): boolean {
  return Boolean(state) && remainingMs(state, now) === 0;
}

/**
 * ±15 s while a rest runs. The remainder is clamped to [0, MAX]; the total
 * moves with the delta and never falls below the remainder, so the progress
 * denominator stays sensible and `remainingMs`'s clamp cannot eat time that
 * was really added.
 */
export function adjustRest(state: RestTimerState, deltaSec: number, now: number = Date.now()): RestTimerState {
  const maxMs = MAX_REST_SECONDS * 1000;
  const remaining = Math.min(maxMs, Math.max(0, state.deadline - now + deltaSec * 1000));
  const durationSec = Math.min(
    MAX_REST_SECONDS,
    Math.max(MIN_REST_SECONDS, state.durationSec + deltaSec, Math.ceil(remaining / 1000)),
  );
  return { ...state, deadline: now + remaining, durationSec };
}

/** 0 at the start of the rest, 1 at the deadline. */
export function restProgress(state: RestTimerState | null | undefined, now: number = Date.now()): number {
  if (!state || state.durationSec <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(state, now) / (state.durationSec * 1000)));
}

/** "1:30", "0:07"; rounded up, so the dock never shows 0:00 with time left. */
export function formatRestClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ identifiers */

export function kebab(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function isValidExerciseId(value: unknown): value is string {
  return typeof value === 'string' && EXERCISE_ID_PATTERN.test(value);
}

/**
 * The contract's `exerciseId`: the library slug when the seed carries one,
 * otherwise `custom-<kebab(name)>`, so the same custom name always reads the
 * same records.
 */
export function exerciseSlug(name: string, explicit?: string | null): string {
  if (isValidExerciseId(explicit)) return explicit;
  const slug = kebab(name).slice(0, 73).replace(/-+$/g, '');
  return `custom-${slug || 'exercise'}`;
}

let idCounter = 0;

/** A stable id that satisfies `^[A-Za-z0-9_-]{1,80}$`. */
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${kebab(prefix) || 'id'}-${stamp}-${idCounter.toString(36)}${random}`.slice(0, 80);
}

/** One per session; re-sent verbatim on an idempotent retry. */
export function newClientRequestId(): string {
  let id = newId('req');
  while (id.length < 16) id += Math.random().toString(36).slice(2, 8);
  return id.slice(0, 100);
}

/** A set id that is not in `taken`: the id itself, else `<id>-2`, `<id>-3`… */
export function uniqueSetId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${id.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/* ----------------------------------------------------------- field input */

export type FieldRules = { allowDecimal: boolean; maxIntegerDigits: number; maxDecimals: number; max: number };

export const WEIGHT_RULES: FieldRules = Object.freeze({ allowDecimal: true, maxIntegerDigits: 6, maxDecimals: 2, max: MAX_WEIGHT });
export const REPS_RULES: FieldRules = Object.freeze({ allowDecimal: false, maxIntegerDigits: 5, maxDecimals: 0, max: MAX_REPS });

/**
 * What a typed field is allowed to hold. The mobile runner drives its own
 * keypad key by key; a browser `<input>` can receive a paste, an autofill or
 * a locale comma, so the same rules are applied to the whole string: one
 * decimal point at most, the rules' digit limits, nothing above the
 * contract's ceiling, and no sign or exponent.
 */
export function sanitizeField(text: string, rules: FieldRules): string {
  let value = text.replace(',', '.').replace(/[^\d.]/g, '');
  if (!rules.allowDecimal) value = value.replace(/\./g, '');
  const firstDot = value.indexOf('.');
  if (firstDot >= 0) value = `${value.slice(0, firstDot + 1)}${value.slice(firstDot + 1).replace(/\./g, '')}`;
  let [whole = '', decimals] = value.split('.');
  if (whole.length > 1) whole = whole.replace(/^0+(?=\d)/, '');
  whole = whole.slice(0, rules.maxIntegerDigits);
  if (decimals !== undefined) decimals = decimals.slice(0, rules.maxDecimals);
  const joined = decimals === undefined ? whole : `${whole}.${decimals}`;
  const numeric = Number(joined);
  if (Number.isFinite(numeric) && numeric > rules.max) return String(rules.max);
  return joined;
}

/** Field text → number; blank is null (not 0), so an untouched field never snaps to zero. */
export function parseFieldValue(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed || trimmed === '.') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Number → field text; null is blank. Never grouped — this is what an `<input>` holds. */
export function fieldText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(roundWeight(value, 2));
}

/* ------------------------------------------------------ session construction */

export function createSet(unit: WeightUnit, partial: Partial<Pick<SessionSet, 'id' | 'reps' | 'weight' | 'previous'>> = {}): SessionSet {
  return {
    id: partial.id ?? newId('set'),
    reps: partial.reps ?? null,
    weight: partial.weight ?? null,
    weightUnit: unit,
    completed: false,
    completedAt: null,
    previous: partial.previous ?? null,
  };
}

const plannedSets = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(MAX_PLANNED_SETS, Math.round(value)) : 1;

/**
 * A seed row as a card. A seed's weights are kilograms (templates and
 * aggregate logs store kg); they are converted into the session's unit, and a
 * set-aware log's own sets keep their own units.
 */
export function exerciseFromTemplate(input: TemplateExercise, unit: WeightUnit): SessionExercise {
  const name = (input.name || '').trim().slice(0, MAX_EXERCISE_NAME_LENGTH) || 'Exercise';
  const exerciseId = exerciseSlug(name, input.exerciseId);
  const records = (input.setRecords ?? []).slice(0, MAX_SETS_PER_EXERCISE);
  const sets: SessionSet[] = records.length
    ? records.map((record) => {
        const recordUnit: WeightUnit = record.weightUnit === 'lb' ? 'lb' : 'kg';
        const weight = typeof record.weight === 'number' && record.weight > 0 ? convertWeight(record.weight, recordUnit, unit) : null;
        return createSet(unit, { reps: typeof record.reps === 'number' && record.reps > 0 ? Math.round(record.reps) : null, weight });
      })
    : Array.from({ length: plannedSets(input.sets) }, () =>
        createSet(unit, {
          reps: typeof input.reps === 'number' && input.reps > 0 ? Math.round(input.reps) : null,
          weight:
            typeof input.weight === 'number' && input.weight > 0 ? convertWeight(input.weight, input.weightUnit ?? 'kg', unit) : null,
        }),
      );
  return {
    key: newId('ex'),
    exerciseId,
    name,
    sets,
    restSeconds: seedRestSeconds(input.rest),
    notes: (input.notes ?? '').trim().slice(0, MAX_NOTES_LENGTH),
  };
}

/** A fresh session, seeded or empty. */
export function createSession(
  seed: SessionSeed | null | undefined,
  options: { unit: WeightUnit; name?: string; now?: number },
): WorkoutSession {
  const now = options.now ?? Date.now();
  const name = (options.name ?? seed?.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || 'Workout';
  return {
    sessionId: newId('session'),
    startedAt: new Date(now).toISOString(),
    finishedAt: null,
    name,
    type: (seed?.type ?? 'strength') || 'strength',
    unit: options.unit,
    exercises: (seed?.exercises ?? [])
      .filter((row) => (row?.name ?? '').trim().length > 0)
      .slice(0, MAX_EXERCISES)
      .map((row) => exerciseFromTemplate(row, options.unit)),
    notes: '',
    clientRequestId: newClientRequestId(),
    seedWorkoutId: seed?.workoutId ?? null,
  };
}

/* ------------------------------------------------------------- the payload */

/**
 * An exercise's sets as the server takes them. A row nobody touched and
 * never checked sends nothing; a typed but unchecked row travels with
 * `completed: false`, which is what keeps it out of volume server-side.
 */
export function payloadSets(exercise: Pick<SessionExercise, 'sets'>): SetRecordPayload[] {
  return exercise.sets
    .filter((set) => set.completed || set.reps !== null || set.weight !== null)
    .slice(0, MAX_SETS_PER_EXERCISE)
    .map((set) => ({
      id: set.id,
      completed: set.completed,
      reps: Math.min(MAX_REPS, Math.max(0, Math.round(set.reps ?? 0))),
      weight: Math.min(MAX_WEIGHT, Math.max(0, roundWeight(set.weight ?? 0, 3))),
      weightUnit: set.weightUnit,
    }));
}

/**
 * The exercises as the server accepts them: ONE entry per exerciseId. A
 * session can hold the same movement twice — a template with a repeated row,
 * "Bench Press" and "bench press" both slugging to `custom-bench-press` —
 * and the validator answers 400 to a repeated exerciseId on every attempt, a
 * draft nobody could ever save. Cards sharing an id are merged here in
 * first-appearance order: sets concatenated in card order, notes joined, the
 * first card's name. A set-id collision is renamed rather than trusted.
 */
export function payloadExercises(session: Pick<WorkoutSession, 'exercises'>): ExercisePayload[] {
  const byId = new Map<string, { entry: ExercisePayload; notes: string[]; setIds: Set<string> }>();
  for (const exercise of session.exercises) {
    const setRecords = payloadSets(exercise);
    if (!setRecords.length) continue;
    const name = exercise.name.trim().slice(0, MAX_EXERCISE_NAME_LENGTH) || 'Exercise';
    let merged = byId.get(exercise.exerciseId);
    if (!merged) {
      merged = { entry: { exerciseId: exercise.exerciseId, name, setRecords: [] }, notes: [], setIds: new Set() };
      byId.set(exercise.exerciseId, merged);
    }
    for (const set of setRecords) {
      const id = uniqueSetId(set.id, merged.setIds);
      merged.setIds.add(id);
      merged.entry.setRecords.push(id === set.id ? set : { ...set, id });
    }
    const notes = exercise.notes.trim();
    if (notes) merged.notes.push(notes);
  }
  return Array.from(byId.values())
    .slice(0, MAX_EXERCISES)
    .map(({ entry, notes }) => {
      if (notes.length) entry.notes = notes.join('\n').slice(0, MAX_NOTES_LENGTH);
      entry.setRecords = entry.setRecords.slice(0, MAX_SETS_PER_EXERCISE);
      return entry;
    });
}

export function buildWorkoutLogPayload(
  session: WorkoutSession,
  options: { includeClientRequestId?: boolean; now?: number } = {},
): WorkoutLogPayload {
  const now = options.now ?? Date.now();
  const payload: WorkoutLogPayload = {
    name: session.name.trim().slice(0, MAX_NAME_LENGTH) || 'Workout',
    type: session.type || 'strength',
    date: session.startedAt,
    duration: durationMinutes(session.startedAt, session.finishedAt, now),
    setRecordsVersion: 1,
    exercises: payloadExercises(session),
  };
  const notes = session.notes.trim();
  if (notes) payload.notes = notes.slice(0, MAX_NOTES_LENGTH);
  if (options.includeClientRequestId) payload.clientRequestId = session.clientRequestId;
  return payload;
}

/* -------------------------------------------------------------- the recap */

/** The recap's numbers; exercises with no completed set are left out. */
export function summarizeSession(session: WorkoutSession, options: { now?: number } = {}): SessionSummary {
  const now = options.now ?? Date.now();
  return {
    name: session.name.trim() || 'Workout',
    date: session.startedAt,
    durationMin: durationMinutes(session.startedAt, session.finishedAt, now),
    setCount: completedSetCount(session),
    volumeKg: roundWeight(sessionVolumeKg(session), 3),
    unit: session.unit,
    exercises: session.exercises
      .map((exercise) => ({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        setCount: exercise.sets.filter((set) => set.completed).length,
        bestSet: bestSetOf(exercise),
      }))
      .filter((exercise) => exercise.setCount > 0),
  };
}
