import { api } from './api';
import { humanize } from '../components/ui';
import type { ProgressHistory, ProgressRecord, ProgressRecords, RecordType } from './progress';

/**
 * The shared exercise library (docs/api-contract.md "Exercise library"): the
 * catalogue behind the workout picker and the exercise page, plus the two
 * owner-only reads the exercise page needs (records and history for one
 * `exerciseId`).
 *
 * `slug` IS the `exerciseId` the per-set workout contract expects, so the
 * picker writes `{ exerciseId: exercise.slug, name: exercise.name }` and the
 * records API keys on the same string. A free-text name keeps working
 * everywhere: an exercise with no `exerciseId` is a custom one.
 *
 * Literal request paths on purpose — scripts/audit-api-contracts.cjs pins
 * every one against the backend route snapshot.
 *
 * Media URLs are absolute, immutable and cacheable for a year; they are
 * always the ones the API returned (`media[].url`) and are never built here.
 * `width`/`height` come with every rendition so a list can reserve its box.
 *
 * The library is being imported into production, so until it lands the search
 * route may answer an empty list or 404: `isLibraryUnavailable` and
 * `metaIsEmpty` are what the picker feature-detects on. That is a quiet line,
 * never an error state.
 */

/* ------------------------------------------------------------------ models */

/** One rendition. `frame` 0 is the start position, 1 the end; widths are 200/400 (and 800 on the detail). */
export type ExerciseMedia = { frame: number; width: number; height: number; mime: string; url: string };

/** A list row. `equipment`, `category` and `level` may be null (the source did not say). */
export type ExerciseSummary = {
  slug: string;
  name: string;
  muscleGroups: string[];
  secondaryMuscleGroups: string[];
  equipment: string | null;
  category: string | null;
  level: string | null;
  media: ExerciseMedia[];
  isCustom: boolean;
  popularity: number;
};

/** A row of `/recent`: the id exactly as logged, plus when and how often. An id the library does not know is a stub. */
export type RecentExercise = ExerciseSummary & { exerciseId: string; lastLoggedAt?: string; timesLogged?: number };

export type ExerciseSearchPage = { exercises: ExerciseSummary[]; total: number; page: number; limit: number; hasNextPage: boolean };

export type ExerciseChip = { key: string; label: string };

export type ExerciseAttribution = {
  source?: string;
  label?: string;
  license?: string;
  licenseUrl?: string;
  url?: string;
  mediaLicense?: string;
  count?: number;
  /** The sentence to render. Generated from the rows' provenance fields. */
  text: string;
};

export type ExerciseMeta = {
  muscleGroups: ExerciseChip[];
  equipment: ExerciseChip[];
  categories: ExerciseChip[];
  levels: ExerciseChip[];
  attributions: ExerciseAttribution[];
  total: number;
};

/** The pinned per-exercise note: one per (member, exercise), separate from a session note. */
export type ExerciseNote = { exerciseId: string; note: string; updatedAt?: string };

export type ExerciseSource = { name?: string; id?: string; license?: string; licenseUrl?: string; url?: string };

/** The full definition from `/exercises/library/:slug`. */
export type Exercise = ExerciseSummary & {
  aliases?: string[];
  /** The source's own muscle labels, beside the canonical `muscleGroups` keys. */
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  force?: string | null;
  mechanic?: string | null;
  instructions?: string[];
  source?: ExerciseSource | null;
  mediaLicense?: string | null;
  attribution?: string | null;
  myNote?: ExerciseNote | null;
  updatedAt?: string;
};

export type ExerciseSearchParams = {
  q?: string;
  muscle?: string;
  equipment?: string;
  category?: string;
  level?: string;
  page?: number;
  limit?: number;
};

/* ---------------------------------------------------------------- fetchers */

/** How many rows one page of the picker holds (the route's ceiling is 50). */
export const EXERCISE_PAGE_SIZE = 20;

const trimmed = (v?: string | null): string | undefined => {
  const s = (v ?? '').trim();
  return s ? s : undefined;
};

/**
 * Search or browse. `q` ≤ 100 characters and literal; without it the list is
 * popularity-ordered. Limited to 300 requests per 15 minutes per member, so
 * every caller debounces.
 */
export async function searchExercises(params: ExerciseSearchParams = {}): Promise<ExerciseSearchPage> {
  const { data } = await api.get<ExerciseSearchPage>('/exercises/library', {
    params: {
      q: trimmed(params.q)?.slice(0, 100),
      muscle: trimmed(params.muscle),
      equipment: trimmed(params.equipment),
      category: trimmed(params.category),
      level: trimmed(params.level),
      page: params.page ?? 1,
      limit: params.limit ?? EXERCISE_PAGE_SIZE,
    },
  });
  return {
    exercises: data?.exercises ?? [],
    total: Number(data?.total ?? 0),
    page: Number(data?.page ?? params.page ?? 1),
    limit: Number(data?.limit ?? params.limit ?? EXERCISE_PAGE_SIZE),
    hasNextPage: Boolean(data?.hasNextPage),
  };
}

/** The chips and the attribution rows in one call. */
export async function fetchExerciseMeta(): Promise<ExerciseMeta> {
  const { data } = await api.get<ExerciseMeta>('/exercises/library/meta');
  return {
    muscleGroups: data?.muscleGroups ?? [],
    equipment: data?.equipment ?? [],
    categories: data?.categories ?? [],
    levels: data?.levels ?? [],
    attributions: data?.attributions ?? [],
    total: Number(data?.total ?? 0),
  };
}

/** The viewer's 20 most recently logged exercises, newest first; stubs for ids the library does not know. */
export async function fetchRecentExercises(): Promise<RecentExercise[]> {
  const { data } = await api.get<{ exercises?: RecentExercise[] }>('/exercises/library/recent');
  return data?.exercises ?? [];
}

export async function fetchExercise(slug: string): Promise<Exercise> {
  const { data } = await api.get<{ exercise?: Exercise }>(`/exercises/library/${slug}`);
  if (!data?.exercise) throw new Error('Exercise not found');
  return data.exercise;
}

/** 1–500 characters, trimmed. Answers 201 on the first write and 200 on a replace. */
export async function putExerciseNote(slug: string, note: string): Promise<ExerciseNote> {
  const { data } = await api.put<{ note?: ExerciseNote }>(`/exercises/library/${slug}/note`, { note: note.trim() });
  return data?.note ?? { exerciseId: slug, note: note.trim() };
}

export async function deleteExerciseNote(slug: string): Promise<void> {
  await api.delete(`/exercises/library/${slug}/note`);
}

/** The member's own records for one exercise, or null when they have never logged it. */
export async function fetchExerciseRecords(exerciseId: string): Promise<Partial<Record<RecordType, ProgressRecord | null>> | null> {
  const { data } = await api.get<{ records?: ProgressRecords }>('/workouts/records', { params: { exerciseId } });
  return data?.records?.[exerciseId] ?? null;
}

/**
 * Every session with this exercise, newest first. `all=1` raises the page
 * rule to 100 by default and 500 at most, which is the exercise page's read.
 */
export async function fetchExerciseHistory(exerciseId: string, page = 1, limit = 100): Promise<ProgressHistory> {
  const { data } = await api.get<ProgressHistory>('/workouts/records/history', { params: { exerciseId, all: 1, page, limit } });
  return { exerciseId, sessions: data?.sessions ?? [], total: Number(data?.total ?? 0), page: Number(data?.page ?? page), hasNextPage: Boolean(data?.hasNextPage) };
}

/* -------------------------------------------------------------- query keys */

const filterKey = (p: ExerciseSearchParams) => [trimmed(p.q) ?? '', p.muscle ?? '', p.equipment ?? '', p.category ?? '', p.level ?? ''] as const;

export const exerciseKeys = {
  all: ['exercise-library'] as const,
  meta: () => ['exercise-library', 'meta'] as const,
  recent: () => ['exercise-library', 'recent'] as const,
  /** One key per filter set; the page is the infinite query's page param. */
  search: (params: ExerciseSearchParams = {}) => ['exercise-library', 'search', ...filterKey(params)] as const,
  detail: (slug: string) => ['exercise-library', 'exercise', slug] as const,
  records: (exerciseId: string) => ['exercise-library', 'records', exerciseId] as const,
  history: (exerciseId: string) => ['exercise-library', 'history', exerciseId] as const,
};

/* ----------------------------------------------------------------- helpers */

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null | undefined)?.response?.status;

/**
 * "The library is not on this deployment yet": the routes answer 404 until
 * the import lands, and 501 if the feature is off. Never an error state —
 * the picker says one quiet line and free-text names keep working.
 */
export const isLibraryUnavailable = (error: unknown): boolean => {
  const status = statusOf(error);
  return status === 404 || status === 501;
};

/** A meta payload that resolved but holds nothing: the import has not run. */
export const metaIsEmpty = (meta: ExerciseMeta | null | undefined): boolean =>
  !!meta && meta.total <= 0 && meta.muscleGroups.length === 0 && meta.equipment.length === 0;

/** The one line the picker shows instead of chips and rows while the import is still running. */
export const LIBRARY_UNAVAILABLE_COPY = 'The exercise library is still loading onto Vybe — type the name for now.';

/**
 * The rendition to draw at `width` for `frame`: the exact width when the API
 * sent it, else the smallest one above it, else the largest below. Null when
 * the exercise has no photos, and the caller draws its glyph tile instead.
 */
export function thumbnailOf(summary: Pick<ExerciseSummary, 'media'> | null | undefined, width = 200, frame = 0): ExerciseMedia | null {
  const media = (summary?.media ?? []).filter((m) => m && typeof m.url === 'string' && m.url && Number.isFinite(m.width) && Number.isFinite(m.height));
  const pool = media.filter((m) => m.frame === frame);
  if (!pool.length) return null;
  const exact = pool.find((m) => m.width === width);
  if (exact) return exact;
  const bigger = pool.filter((m) => m.width > width).sort((a, b) => a.width - b.width);
  return bigger[0] ?? [...pool].sort((a, b) => b.width - a.width)[0] ?? null;
}

/** How many frames the exercise has photos for, in frame order. */
export const framesOf = (exercise: Pick<ExerciseSummary, 'media'> | null | undefined): number[] =>
  [...new Set((exercise?.media ?? []).map((m) => m.frame))].filter((f) => Number.isFinite(f)).sort((a, b) => a - b);

export type ExerciseLabels = Readonly<Record<string, string>>;

/** key → label for every chip group, so a row can print "EZ curl bar" rather than humanising the key. */
export function labelsOf(meta: ExerciseMeta | null | undefined): ExerciseLabels {
  const out: Record<string, string> = {};
  for (const group of [meta?.muscleGroups, meta?.equipment, meta?.categories, meta?.levels]) {
    for (const chip of group ?? []) if (chip?.key && chip.label) out[chip.key] = chip.label;
  }
  return out;
}

const labelFor = (key: string | null | undefined, labels?: ExerciseLabels): string => (key ? labels?.[key] ?? humanize(key) : '');

/** "Barbell · Quads · Beginner" — equipment, the primary muscle, level; only what the row carries. */
export function exerciseMetaLine(
  exercise: Pick<ExerciseSummary, 'equipment' | 'muscleGroups' | 'level'> | null | undefined,
  labels?: ExerciseLabels,
): string {
  return [labelFor(exercise?.equipment, labels), labelFor(exercise?.muscleGroups?.[0], labels), labelFor(exercise?.level, labels)].filter(Boolean).join(' · ');
}

/** The glyph + label + value rows of the exercise page: only the facts the record carries. */
export function exerciseFacts(exercise: Exercise | null | undefined, labels?: ExerciseLabels): Array<{ key: string; label: string; value: string }> {
  if (!exercise) return [];
  const list = (keys: string[] | undefined, own: string[] | undefined): string =>
    (own?.length ? own.map((m) => humanize(m)) : (keys ?? []).map((k) => labelFor(k, labels))).filter(Boolean).join(', ');
  return [
    { key: 'equipment', label: 'Equipment', value: labelFor(exercise.equipment, labels) },
    { key: 'primary', label: 'Primary', value: list(exercise.muscleGroups, exercise.primaryMuscles) },
    { key: 'secondary', label: 'Secondary', value: list(exercise.secondaryMuscleGroups, exercise.secondaryMuscles) },
    { key: 'level', label: 'Level', value: labelFor(exercise.level, labels) },
    { key: 'force', label: 'Force', value: humanize(exercise.force) },
    { key: 'mechanic', label: 'Mechanic', value: humanize(exercise.mechanic) },
  ].filter((row) => row.value);
}
