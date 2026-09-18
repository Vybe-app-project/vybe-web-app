import type {
  CatalogCategory,
  CatalogLevel,
  CatalogPlan,
  CatalogWorkout,
  ExerciseBody,
  PlanBody,
  PlanEntryBody,
  PlanWorkoutRef,
  WorkoutBody,
} from './catalogApi';

/* ------------------------------------------------------------------ *
 * Catalog editor rules: draft shapes, validation and request bodies.
 *
 * Deliberately free of runtime imports (types only) so tests/*.test.mjs can
 * transpile and load this file directly in node:test. Every bound here
 * mirrors routes/adminCatalog.js in the backend; when one changes there it
 * has to change here, which is why they are named constants and not
 * literals scattered through the forms.
 * ------------------------------------------------------------------ */

export const LIMITS = {
  title: { min: 3, max: 120 },
  description: { max: 2000 },
  goal: { min: 1, max: 200 },
  durationWeeks: { min: 1, max: 52 },
  duration: { min: 1, max: 600 },
  caloriesBurned: { min: 0, max: 5000 },
  hashtags: { max: 20 },
  hashtag: { max: 30 },
  exercises: { min: 1, max: 50 },
  exercise: {
    name: { min: 1, max: 100 },
    sets: { min: 1, max: 100 },
    reps: { min: 1, max: 1000 },
    duration: { min: 1, max: 14400 },
    rest: { min: 0, max: 3600 },
    caloriesBurned: { min: 0, max: 5000 },
    notes: { max: 500 },
  },
  planWorkouts: { max: 100 },
  day: { min: 1, max: 7 },
  week: { min: 1, max: 52 },
  search: { max: 100 },
  page: { min: 1, max: 100000 },
  limit: { min: 1, max: 100 },
} as const;

export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

const HASHTAG_RE = /^[A-Za-z0-9_]{1,30}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/** Whether a route param can be a catalog id at all; anything else is a bad link, not a request worth making. */
export const isObjectId = (value: string | null | undefined): boolean => OBJECT_ID_RE.test(value ?? '');

let keySequence = 0;
/** Stable React keys for draft rows; the API ids are not usable for new rows. */
export const nextDraftKey = (): string => {
  keySequence += 1;
  return `draft-${keySequence}`;
};

/* -------------------------------------------------------------- numbers */

export type ParsedNumber = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'value'; value: number };

/** Whole-number parsing for text inputs: '' is empty, '12' is 12, anything else is invalid. */
export function parseWholeNumber(text: string): ParsedNumber {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { kind: 'empty' };
  if (!/^-?\d+$/.test(trimmed)) return { kind: 'invalid' };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { kind: 'invalid' };
  return { kind: 'value', value };
}

function boundedMessage(label: string, min: number, max: number, unit?: string): string {
  return `${label} must be a whole number from ${min} to ${max}${unit ? ` ${unit}` : ''}`;
}

/** Validates an optional whole number field; returns the error or null and the value (null when empty). */
function optionalWhole(
  text: string,
  label: string,
  { min, max }: { min: number; max: number },
  unit?: string,
): { error: string | null; value: number | null } {
  const parsed = parseWholeNumber(text);
  if (parsed.kind === 'empty') return { error: null, value: null };
  if (parsed.kind === 'invalid' || parsed.value < min || parsed.value > max) {
    return { error: boundedMessage(label, min, max, unit), value: null };
  }
  return { error: null, value: parsed.value };
}

/* ------------------------------------------------------------- hashtags */

/** `#FullBody ` -> `fullbody`; null when the tag cannot be stored. */
export function normalizeHashtag(raw: string): string | null {
  const tag = String(raw ?? '').trim().replace(/^#+/, '');
  if (!HASHTAG_RE.test(tag)) return null;
  return tag.toLowerCase();
}

/** Splits pasted or typed text on whitespace and commas. */
export function splitHashtagInput(text: string): string[] {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Adds every valid tag from `raw` to `current`, de-duplicated; reports the ones it could not take. */
export function addHashtags(current: string[], raw: string): { tags: string[]; rejected: string[]; full: boolean } {
  const tags = [...current];
  const rejected: string[] = [];
  let full = false;
  for (const part of splitHashtagInput(raw)) {
    const tag = normalizeHashtag(part);
    if (!tag) {
      rejected.push(part);
      continue;
    }
    if (tags.includes(tag)) continue;
    if (tags.length >= LIMITS.hashtags.max) {
      full = true;
      break;
    }
    tags.push(tag);
  }
  return { tags, rejected, full };
}

export function normalizeHashtagList(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeHashtag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/* ---------------------------------------------------------------- image */

export type ImageDraft =
  | { state: 'none' }
  | { state: 'current'; uri: string }
  | { state: 'uploaded'; key: string; previewUrl: string };

/** What to send as `image`: a key to set, null to clear, undefined to leave alone. */
export function imageChange(draft: ImageDraft, hadImage: boolean): string | null | undefined {
  if (draft.state === 'uploaded') return draft.key;
  if (draft.state === 'none' && hadImage) return null;
  return undefined;
}

function imageDraftFrom(image: { uri: string } | null | undefined): ImageDraft {
  return image?.uri ? { state: 'current', uri: image.uri } : { state: 'none' };
}

/* -------------------------------------------------------------- workouts */

export const EXERCISE_NUMBER_FIELDS = ['sets', 'reps', 'duration', 'rest', 'caloriesBurned'] as const;
export type ExerciseNumberField = (typeof EXERCISE_NUMBER_FIELDS)[number];
export type ExerciseField = 'name' | ExerciseNumberField | 'notes';

export type ExerciseDraft = {
  key: string;
  name: string;
  sets: string;
  reps: string;
  duration: string;
  rest: string;
  caloriesBurned: string;
  notes: string;
  /** Notes stay collapsed until the row has some or the editor opens them. */
  showNotes: boolean;
};

export type WorkoutDraft = {
  title: string;
  description: string;
  category: CatalogCategory | '';
  level: CatalogLevel;
  duration: string;
  caloriesBurned: string;
  hashtags: string[];
  image: ImageDraft;
  exercises: ExerciseDraft[];
};

const text = (value: number | string | null | undefined): string => (value === null || value === undefined ? '' : String(value));

export function newExerciseDraft(): ExerciseDraft {
  return { key: nextDraftKey(), name: '', sets: '', reps: '', duration: '', rest: '', caloriesBurned: '', notes: '', showNotes: false };
}

export function workoutDraftFrom(workout: CatalogWorkout | null): WorkoutDraft {
  if (!workout) {
    return {
      title: '',
      description: '',
      category: '',
      level: 'beginner',
      duration: '',
      caloriesBurned: '',
      hashtags: [],
      image: { state: 'none' },
      exercises: [newExerciseDraft()],
    };
  }
  return {
    title: workout.title ?? '',
    description: workout.description ?? '',
    category: workout.category,
    level: workout.level ?? 'beginner',
    duration: text(workout.duration),
    caloriesBurned: text(workout.caloriesBurned),
    hashtags: [...(workout.hashtags ?? [])],
    image: imageDraftFrom(workout.image),
    exercises: (workout.exercises ?? []).map((exercise) => ({
      key: nextDraftKey(),
      name: exercise.name ?? '',
      sets: text(exercise.sets),
      reps: text(exercise.reps),
      duration: text(exercise.duration),
      rest: text(exercise.rest),
      caloriesBurned: text(exercise.caloriesBurned),
      notes: exercise.notes ?? '',
      showNotes: Boolean(exercise.notes),
    })),
  };
}

export type ExerciseErrors = Partial<Record<ExerciseField | 'row', string>>;

export type WorkoutValidation = {
  ok: boolean;
  /** Top-level field -> message. */
  fields: Partial<Record<'title' | 'description' | 'category' | 'level' | 'duration' | 'caloriesBurned' | 'hashtags' | 'exercises' | 'image', string>>;
  /** Exercise draft key -> field errors. */
  exercises: Record<string, ExerciseErrors>;
};

const EXERCISE_LABELS: Record<ExerciseNumberField, string> = {
  sets: 'Sets',
  reps: 'Reps',
  duration: 'Duration',
  rest: 'Rest',
  caloriesBurned: 'Calories',
};
const EXERCISE_UNITS: Partial<Record<ExerciseNumberField, string>> = { duration: 'seconds', rest: 'seconds' };

function exerciseBody(draft: ExerciseDraft): { body: ExerciseBody; errors: ExerciseErrors } {
  const errors: ExerciseErrors = {};
  const name = draft.name.trim();
  if (name.length < LIMITS.exercise.name.min || name.length > LIMITS.exercise.name.max) {
    errors.name = `Give this exercise a name of ${LIMITS.exercise.name.min} to ${LIMITS.exercise.name.max} characters`;
  }
  const body: ExerciseBody = { name };
  for (const field of EXERCISE_NUMBER_FIELDS) {
    const { error, value } = optionalWhole(draft[field], EXERCISE_LABELS[field], LIMITS.exercise[field], EXERCISE_UNITS[field]);
    if (error) errors[field] = error;
    else if (value !== null) body[field] = value;
  }
  const notes = draft.notes.trim();
  if (notes.length > LIMITS.exercise.notes.max) {
    errors.notes = `Notes must be ${LIMITS.exercise.notes.max} characters or fewer`;
  } else if (notes) {
    body.notes = notes;
  }
  return { body, errors };
}

export function validateWorkoutDraft(draft: WorkoutDraft): WorkoutValidation {
  const fields: WorkoutValidation['fields'] = {};
  const title = draft.title.trim();
  if (title.length < LIMITS.title.min || title.length > LIMITS.title.max) {
    fields.title = `Title must be ${LIMITS.title.min} to ${LIMITS.title.max} characters`;
  }
  if (draft.description.trim().length > LIMITS.description.max) {
    fields.description = `Description must be ${LIMITS.description.max} characters or fewer`;
  }
  if (!draft.category) fields.category = 'Choose a category';
  const duration = optionalWhole(draft.duration, 'Duration', LIMITS.duration, 'minutes');
  if (duration.error) fields.duration = duration.error;
  const calories = optionalWhole(draft.caloriesBurned, 'Calories burned', LIMITS.caloriesBurned);
  if (calories.error) fields.caloriesBurned = calories.error;
  if (draft.hashtags.length > LIMITS.hashtags.max) fields.hashtags = `Use at most ${LIMITS.hashtags.max} hashtags`;
  else if (draft.hashtags.some((tag) => normalizeHashtag(tag) === null)) {
    fields.hashtags = `Hashtags can only use letters, numbers and underscores (1 to ${LIMITS.hashtag.max} characters)`;
  }

  const exercises: Record<string, ExerciseErrors> = {};
  if (draft.exercises.length < LIMITS.exercises.min) fields.exercises = 'Add at least one exercise';
  else if (draft.exercises.length > LIMITS.exercises.max) fields.exercises = `A workout can have at most ${LIMITS.exercises.max} exercises`;
  for (const exercise of draft.exercises) {
    const { errors } = exerciseBody(exercise);
    if (Object.keys(errors).length) exercises[exercise.key] = errors;
  }

  return { ok: Object.keys(fields).length === 0 && Object.keys(exercises).length === 0, fields, exercises };
}

/** Wire shape of the exercise list; used both for the body and for change detection. */
export function exerciseBodies(draft: WorkoutDraft): ExerciseBody[] {
  return draft.exercises.map((exercise) => exerciseBody(exercise).body);
}

function storedExerciseBodies(workout: CatalogWorkout): ExerciseBody[] {
  return (workout.exercises ?? []).map((exercise) => {
    const body: ExerciseBody = { name: exercise.name };
    for (const field of EXERCISE_NUMBER_FIELDS) {
      const value = exercise[field];
      if (value !== null && value !== undefined) body[field] = value;
    }
    if (exercise.notes) body.notes = exercise.notes;
    return body;
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function wholeOrNull(textValue: string): number | null {
  const parsed = parseWholeNumber(textValue);
  return parsed.kind === 'value' ? parsed.value : null;
}

/**
 * Body for POST (no original) or PATCH (diff against `original`). The PATCH
 * body carries only fields that changed, so an edit by one admin never
 * clobbers a field another admin changed in between, and `image` is sent
 * only when it was replaced or cleared. Call after validateWorkoutDraft.
 */
export function buildWorkoutBody(draft: WorkoutDraft, original: CatalogWorkout | null): WorkoutBody {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const duration = wholeOrNull(draft.duration);
  const caloriesBurned = wholeOrNull(draft.caloriesBurned);
  const hashtags = normalizeHashtagList(draft.hashtags);
  const exercises = exerciseBodies(draft);
  const image = imageChange(draft.image, Boolean(original?.image?.uri));

  if (!original) {
    const body: WorkoutBody = {
      title,
      category: draft.category || undefined,
      level: draft.level,
      exercises,
    };
    if (description) body.description = description;
    if (duration !== null) body.duration = duration;
    if (caloriesBurned !== null) body.caloriesBurned = caloriesBurned;
    if (hashtags.length) body.hashtags = hashtags;
    if (typeof image === 'string') body.image = image;
    return body;
  }

  const body: WorkoutBody = {};
  if (title !== original.title) body.title = title;
  if (description !== (original.description ?? '')) body.description = description || null;
  if (draft.category && draft.category !== original.category) body.category = draft.category;
  if (draft.level !== (original.level ?? 'beginner')) body.level = draft.level;
  if (duration !== (original.duration ?? null)) body.duration = duration;
  if (caloriesBurned !== (original.caloriesBurned ?? null)) body.caloriesBurned = caloriesBurned;
  if (!sameJson(hashtags, normalizeHashtagList(original.hashtags ?? []))) body.hashtags = hashtags;
  if (!sameJson(exercises, storedExerciseBodies(original))) body.exercises = exercises;
  if (image !== undefined) body.image = image;
  return body;
}

/* ----------------------------------------------------------------- plans */

export type PlanEntryDraft = {
  key: string;
  workout: PlanWorkoutRef;
  week: number;
  day: number;
};

export type PlanDraft = {
  title: string;
  description: string;
  goal: string;
  durationWeeks: string;
  level: CatalogLevel;
  hashtags: string[];
  image: ImageDraft;
  entries: PlanEntryDraft[];
};

export function planDraftFrom(plan: CatalogPlan | null): PlanDraft {
  if (!plan) {
    return {
      title: '',
      description: '',
      goal: '',
      durationWeeks: '4',
      level: 'beginner',
      hashtags: [],
      image: { state: 'none' },
      entries: [],
    };
  }
  return {
    title: plan.title ?? '',
    description: plan.description ?? '',
    goal: plan.goal ?? '',
    durationWeeks: text(plan.durationWeeks),
    level: plan.level ?? 'beginner',
    hashtags: [...(plan.hashtags ?? [])],
    image: imageDraftFrom(plan.image),
    entries: scheduleOrder(plan.workouts ?? []).map((entry) => ({
      key: nextDraftKey(),
      workout: entry.workout,
      week: entry.week,
      day: entry.day,
    })),
  };
}

/** Stored entries in schedule order: week, then day, then their saved `order`. */
function scheduleOrder<T extends { week: number; day: number; order?: number }>(entries: T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (
      a.entry.week - b.entry.week
      || a.entry.day - b.entry.day
      || (a.entry.order ?? 0) - (b.entry.order ?? 0)
      || a.index - b.index
    ))
    .map(({ entry }) => entry);
}

/**
 * Draft entries in the order they are shown and saved: by week, then day,
 * keeping the draft's own sequence inside a day. That sequence is what the
 * move up/down controls edit, and `order` on the wire is the position in
 * this list (index + 1), the same global numbering the production seed
 * writes and the mobile app displays.
 */
export function orderedEntries(entries: PlanEntryDraft[]): PlanEntryDraft[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.week - b.entry.week || a.entry.day - b.entry.day || a.index - b.index)
    .map(({ entry }) => entry);
}

export function planEntryBodies(entries: PlanEntryDraft[]): PlanEntryBody[] {
  return orderedEntries(entries).map((entry, index) => ({
    workout: entry.workout._id,
    day: entry.day,
    week: entry.week,
    order: index + 1,
  }));
}

function storedPlanEntryBodies(plan: CatalogPlan): PlanEntryBody[] {
  return scheduleOrder(plan.workouts ?? []).map((entry, index) => ({
    workout: entry.workout._id,
    day: entry.day,
    week: entry.week,
    order: index + 1,
  }));
}

/** Moves the entry `key` one step among the entries that share its week and day. */
export function moveEntryWithinDay(entries: PlanEntryDraft[], key: string, direction: -1 | 1): PlanEntryDraft[] {
  const ordered = orderedEntries(entries);
  const at = ordered.findIndex((entry) => entry.key === key);
  if (at < 0) return entries;
  const target = at + direction;
  if (target < 0 || target >= ordered.length) return entries;
  const a = ordered[at];
  const b = ordered[target];
  if (a.week !== b.week || a.day !== b.day) return entries;
  const next = [...ordered];
  next[at] = b;
  next[target] = a;
  return next;
}

/** Same-slot neighbours decide whether the move controls are enabled. */
export function entryMoveability(entries: PlanEntryDraft[], key: string): { up: boolean; down: boolean } {
  const ordered = orderedEntries(entries);
  const at = ordered.findIndex((entry) => entry.key === key);
  if (at < 0) return { up: false, down: false };
  const same = (other: PlanEntryDraft | undefined) => Boolean(other) && other!.week === ordered[at].week && other!.day === ordered[at].day;
  return { up: same(ordered[at - 1]), down: same(ordered[at + 1]) };
}

/** Re-slots an entry; it lands after the entries already in the new slot. */
export function reslotEntry(entries: PlanEntryDraft[], key: string, slot: { week?: number; day?: number }): PlanEntryDraft[] {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) return entries;
  const moved = { ...entry, week: slot.week ?? entry.week, day: slot.day ?? entry.day };
  return [...entries.filter((candidate) => candidate.key !== key), moved];
}

export function estimatedPlanCalories(entries: PlanEntryDraft[]): number {
  return entries.reduce((total, entry) => total + (entry.workout.caloriesBurned ?? 0), 0);
}

export type PlanValidation = {
  ok: boolean;
  fields: Partial<Record<'title' | 'description' | 'goal' | 'durationWeeks' | 'level' | 'hashtags' | 'workouts' | 'image', string>>;
  /** Entry draft key -> message. */
  entries: Record<string, string>;
};

/** Plan length as a number when the text holds a valid one, else null. */
export function parsePlanWeeks(text: string): number | null {
  const parsed = parseWholeNumber(text);
  if (parsed.kind !== 'value') return null;
  if (parsed.value < LIMITS.durationWeeks.min || parsed.value > LIMITS.durationWeeks.max) return null;
  return parsed.value;
}

export const planWeeks = (draft: PlanDraft): number | null => parsePlanWeeks(draft.durationWeeks);

export function validatePlanDraft(draft: PlanDraft): PlanValidation {
  const fields: PlanValidation['fields'] = {};
  const title = draft.title.trim();
  if (title.length < LIMITS.title.min || title.length > LIMITS.title.max) {
    fields.title = `Title must be ${LIMITS.title.min} to ${LIMITS.title.max} characters`;
  }
  if (draft.description.trim().length > LIMITS.description.max) {
    fields.description = `Description must be ${LIMITS.description.max} characters or fewer`;
  }
  const goal = draft.goal.trim();
  if (goal.length < LIMITS.goal.min || goal.length > LIMITS.goal.max) {
    fields.goal = `Goal must be ${LIMITS.goal.min} to ${LIMITS.goal.max} characters`;
  }
  const weeks = planWeeks(draft);
  if (weeks === null) {
    fields.durationWeeks = boundedMessage('Plan length', LIMITS.durationWeeks.min, LIMITS.durationWeeks.max, 'weeks');
  }
  if (draft.hashtags.length > LIMITS.hashtags.max) fields.hashtags = `Use at most ${LIMITS.hashtags.max} hashtags`;
  else if (draft.hashtags.some((tag) => normalizeHashtag(tag) === null)) {
    fields.hashtags = `Hashtags can only use letters, numbers and underscores (1 to ${LIMITS.hashtag.max} characters)`;
  }
  if (draft.entries.length > LIMITS.planWorkouts.max) {
    fields.workouts = `A plan can schedule at most ${LIMITS.planWorkouts.max} workouts`;
  }

  const entries: Record<string, string> = {};
  for (const entry of draft.entries) {
    if (!OBJECT_ID_RE.test(entry.workout?._id ?? '')) entries[entry.key] = 'This workout reference is not valid';
    else if (entry.day < LIMITS.day.min || entry.day > LIMITS.day.max) entries[entry.key] = 'Day must be 1 to 7';
    else if (entry.week < LIMITS.week.min || entry.week > LIMITS.week.max) entries[entry.key] = 'Week must be 1 to 52';
    else if (weeks !== null && entry.week > weeks) {
      entries[entry.key] = `Week ${entry.week} is past the end of this ${weeks}-week plan`;
    }
  }
  if (weeks !== null && Object.values(entries).some((message) => message.startsWith('Week '))) {
    fields.durationWeeks = 'Some workouts are scheduled past this length. Move or remove them first.';
  }

  return { ok: Object.keys(fields).length === 0 && Object.keys(entries).length === 0, fields, entries };
}

/** POST body (no original) or PATCH diff. Sending `workouts` replaces the whole schedule. */
export function buildPlanBody(draft: PlanDraft, original: CatalogPlan | null): PlanBody {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const goal = draft.goal.trim();
  const weeks = planWeeks(draft);
  const hashtags = normalizeHashtagList(draft.hashtags);
  const workouts = planEntryBodies(draft.entries);
  const image = imageChange(draft.image, Boolean(original?.image?.uri));

  if (!original) {
    const body: PlanBody = { title, goal, level: draft.level, workouts };
    if (weeks !== null) body.durationWeeks = weeks;
    if (description) body.description = description;
    if (hashtags.length) body.hashtags = hashtags;
    if (typeof image === 'string') body.image = image;
    return body;
  }

  const body: PlanBody = {};
  if (title !== original.title) body.title = title;
  if (description !== (original.description ?? '')) body.description = description || null;
  if (goal !== (original.goal ?? '')) body.goal = goal;
  if (weeks !== null && weeks !== original.durationWeeks) body.durationWeeks = weeks;
  if (draft.level !== (original.level ?? 'beginner')) body.level = draft.level;
  if (!sameJson(hashtags, normalizeHashtagList(original.hashtags ?? []))) body.hashtags = hashtags;
  if (!sameJson(workouts, storedPlanEntryBodies(original))) body.workouts = workouts;
  if (image !== undefined) body.image = image;
  return body;
}

/* --------------------------------------------------------- editor seeding */

/** The slice of a TanStack query result the seeding rule looks at. */
export type DetailQueryState<T> = {
  data: T | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
};

/**
 * The record an editor may seed its draft from, or null while it has to keep
 * waiting. TanStack hands back the cached copy of a stale or invalidated entry
 * at once and refreshes it in the background, so "data is defined" is not
 * "data is current": a draft seeded from that copy and diffed against the
 * refreshed record would send another admin's change back as a revert. Only a
 * settled fetch counts. The detail queries pair this with staleTime 0 so every
 * mount does refetch; a cache the app still considers fresh is served idle,
 * and the gate alone could not tell it from the server.
 */
export function seedableRecord<T>(query: DetailQueryState<T>): T | null {
  if (query.status !== 'success' || query.fetchStatus !== 'idle' || query.data === undefined) return null;
  return query.data;
}

/**
 * A draft and the record it was seeded from travel together, so the PATCH
 * diff is always taken against what the admin actually saw and edited, never
 * against a copy that arrived later. `id` is the route param the session was
 * built for; a session for another id is never reused.
 */
export type EditorSession<TRecord, TDraft> = { id: string; baseline: TRecord | null; draft: TDraft };

export function workoutSession(id: string, workout: CatalogWorkout | null): EditorSession<CatalogWorkout, WorkoutDraft> {
  return { id, baseline: workout, draft: workoutDraftFrom(workout) };
}

export function planSession(id: string, plan: CatalogPlan | null): EditorSession<CatalogPlan, PlanDraft> {
  return { id, baseline: plan, draft: planDraftFrom(plan) };
}

export const workoutSessionBody = (session: EditorSession<CatalogWorkout, WorkoutDraft>): WorkoutBody =>
  buildWorkoutBody(session.draft, session.baseline);

export const planSessionBody = (session: EditorSession<CatalogPlan, PlanDraft>): PlanBody =>
  buildPlanBody(session.draft, session.baseline);

/* ----------------------------------------------------------- API errors */

export type CatalogErrorDetails = {
  status: number | null;
  message: string;
  /** Top-level field -> message, as reported by the API. */
  fields: Record<string, string>;
  /** 1-based exercise / plan-workout row -> message, parsed from the API's "Exercise N: ..." wording. */
  rows: Record<number, { field?: string; message: string }>;
  invalidWorkoutIds: string[];
  /** The record itself is gone: a 404 about the workout or plan, not about a field such as the image. */
  gone: boolean;
  /** The record changed under us or was deleted; the draft must be reloaded. */
  stale: boolean;
  offline: boolean;
};

const ROW_RE = /^(?:Exercise|Plan workout) (\d+)(?::\s*(\w+))?/;

/**
 * Normalises an Axios failure from the catalog API into something the forms
 * can place: per-field messages, per-row messages (the API validates nested
 * exercises and plan entries with a "Exercise 3: sets must ..." prefix) and
 * the ids of plan workouts that no longer exist.
 */
export function catalogErrorDetails(error: unknown, fallback = 'Something went wrong'): CatalogErrorDetails {
  const ax = (error ?? {}) as { response?: { status?: number; data?: unknown }; code?: string; message?: string };
  const status = typeof ax.response?.status === 'number' ? ax.response.status : null;
  const data = (ax.response?.data ?? {}) as {
    message?: unknown;
    errors?: unknown;
    invalidWorkoutIds?: unknown;
  };
  const fields: Record<string, string> = {};
  const rows: Record<number, { field?: string; message: string }> = {};
  if (Array.isArray(data.errors)) {
    for (const entry of data.errors as Array<{ field?: unknown; message?: unknown; msg?: unknown }>) {
      const message = typeof entry?.message === 'string' ? entry.message : typeof entry?.msg === 'string' ? entry.msg : '';
      if (!message) continue;
      const field = typeof entry?.field === 'string' && entry.field ? entry.field : 'body';
      const row = message.match(ROW_RE);
      if (row && (field === 'exercises' || field === 'workouts')) {
        rows[Number(row[1])] = { field: row[2], message };
      }
      if (!fields[field]) fields[field] = message;
    }
  }
  const offline = status === null && (ax.code === 'ERR_NETWORK' || (typeof navigator !== 'undefined' && navigator.onLine === false));
  const message = typeof data.message === 'string' && data.message
    ? data.message
    : offline
      ? 'You appear to be offline. Check your connection and try again.'
      : (typeof ax.message === 'string' && ax.message) || fallback;
  // The media verifier also answers 404 ("Completed media upload was not
  // found"), but with errors[].field === 'image'; only a bare 404 means the
  // workout or plan itself is gone.
  const gone = status === 404 && Object.keys(fields).length === 0;
  return {
    status,
    message,
    fields,
    rows,
    invalidWorkoutIds: Array.isArray(data.invalidWorkoutIds) ? data.invalidWorkoutIds.map(String) : [],
    gone,
    stale: gone || (status === 409 && !fields.title),
    offline,
  };
}

/**
 * Whether a failed detail load means "no such record": the API's 404, or its
 * 400 for an id that cannot be one (errors[].field === 'id').
 */
export function isMissingRecordError(error: unknown): boolean {
  const ax = (error ?? {}) as { response?: { status?: number; data?: { errors?: unknown } } };
  const status = ax.response?.status;
  if (status === 404) return true;
  if (status !== 400) return false;
  const errors = ax.response?.data?.errors;
  return Array.isArray(errors) && errors.some((entry) => (entry as { field?: unknown } | null)?.field === 'id');
}

/**
 * Body text for the generic save-failure banner. Whole-body complaints arrive
 * under the pseudo-field 'body' and nothing on the form can highlight them, so
 * they are spelled out instead of counted.
 */
export function saveErrorText(details: CatalogErrorDetails): string {
  const sentences = [details.message];
  if (details.fields.body && details.fields.body !== details.message) sentences.push(details.fields.body);
  const highlighted = Object.keys(details.fields).filter((field) => field !== 'body').length + Object.keys(details.rows).length;
  if (highlighted) sentences.push('The highlighted fields explain what to fix');
  return sentences.map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`)).join(' ');
}

/* ---------------------------------------------------------- list state */

export type CatalogTab = 'workouts' | 'plans';

export const catalogListPath = (tab: CatalogTab) => (tab === 'plans' ? '/admin/catalog?tab=plans' : '/admin/catalog');
export const workoutEditorPath = (id: string | 'new') => `/admin/catalog/workouts/${id}`;
export const planEditorPath = (id: string | 'new') => `/admin/catalog/plans/${id}`;

const LIST_PATH_RE = /^\/admin\/catalog(?:\?[^#\s]*)?$/;

/** The state the list page attaches to its editor links; catalogReturnPath reads it back. */
export const catalogReturnState = (location: { pathname: string; search: string }): { from: string } => ({
  from: `${location.pathname}${location.search}`,
});

/**
 * Where an editor goes back to. The list page passes its own location
 * (`/admin/catalog?tab=plans&q=core&page=2`) through navigation state so the
 * admin lands on the same tab, filter and page; anything else in that state,
 * or none at all (a bookmarked editor), falls back to the plain tab.
 */
export function catalogReturnPath(state: unknown, tab: CatalogTab): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && LIST_PATH_RE.test(from) ? from : catalogListPath(tab);
}

export type CatalogListState = { tab: CatalogTab; search: string; page: number; limit: number };

/** Reads the list state from the URL, falling back to defaults for anything malformed. */
export function parseListState(params: { get(name: string): string | null }): CatalogListState {
  const tab: CatalogTab = params.get('tab') === 'plans' ? 'plans' : 'workouts';
  const search = (params.get('q') ?? '').slice(0, LIMITS.search.max);
  const page = parseWholeNumber(params.get('page') ?? '');
  const limit = parseWholeNumber(params.get('limit') ?? '');
  return {
    tab,
    search,
    page: page.kind === 'value' && page.value >= LIMITS.page.min && page.value <= LIMITS.page.max ? page.value : 1,
    limit: limit.kind === 'value' && (PAGE_SIZES as readonly number[]).includes(limit.value) ? limit.value : DEFAULT_PAGE_SIZE,
  };
}

/** Serialises list state back to query params, omitting defaults so the URL stays short. */
export function listStateParams(state: CatalogListState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.tab !== 'workouts') out.tab = state.tab;
  if (state.search) out.q = state.search;
  if (state.page > 1) out.page = String(state.page);
  if (state.limit !== DEFAULT_PAGE_SIZE) out.limit = String(state.limit);
  return out;
}

export function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, limit)));
}

export function rangeLabel(page: number, limit: number, total: number, noun: string): string {
  if (!total) return `No ${noun}`;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
}
