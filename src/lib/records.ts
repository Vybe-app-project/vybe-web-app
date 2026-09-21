import { api } from './api';
import { apiErrorDetails } from './apiError';
import { localDayParams } from './timezone';
import type { ProgressRecord, ProgressRecords, ProgressSummary, RecordType } from './progress';

/**
 * Records and records maintenance (docs/api-contract.md, "Workout records,
 * PREVIOUS ghost, exercise history and period summary" and its Wave H
 * "Records maintenance" section).
 *
 * Records are derived from the member's logs on every read and never stored,
 * so a correction is not an edit: it is an adjustment the derivation applies
 * before the maths. Two of them exist, each with an inverse for an Undo:
 *
 *   DELETE /workouts/records/:id        a typo set leaves EVERY record type
 *   POST   /workouts/records/:id/restore   of that exercise -- and comes back
 *   POST   /workouts/records/reset      sessions before a day stop counting
 *   DELETE /workouts/records/reset         for that one exercise
 *
 * `GET /workouts/records` and the PR banner read the corrected best; history,
 * PREVIOUS and the period summary keep the raw logs, because what happened
 * still happened.
 *
 * A record id is derived, never sent: `<workoutId>:<exerciseId>` for an
 * aggregate record (duration / distance / pace) and
 * `<workoutId>:<exerciseId>:<setId>` for a set record, built here from the
 * `workoutId` and `setId` every record entry already carries.
 *
 * Literal request paths on purpose -- scripts/audit-api-contracts.cjs pins
 * every one against the backend route snapshot, and
 * tests/records-shelf-contract.test.mjs pins them against
 * contracts/backend-routes.json.
 */

/* ------------------------------------------------------------------ models */

/** One exercise's records: every type the API keys, `null` where nothing was ever recorded. */
export type ExerciseRecords = Partial<Record<RecordType, ProgressRecord | null>>;

/** A removed set (or a session's aggregate), keyed by the record id that named it. */
export type RecordExclusion = {
  id: string;
  exerciseId: string;
  kind: 'exclude';
  recordId: string;
  workoutId: string;
  setId: string | null;
  createdAt?: string | null;
};

/** "Records before this day stop counting", one per exercise; a new one replaces it. */
export type RecordReset = {
  id: string;
  exerciseId: string;
  kind: 'reset';
  from: string | null;
  createdAt?: string | null;
};

export type RecordAdjustment = RecordExclusion | RecordReset;

/** What both maintenance writes answer: the recomputed records for that exercise (or null). */
export type RecordMaintenance = { recordId?: string; exerciseId: string; from?: string; records: ExerciseRecords | null };

/** The window a summary read covers, in the API's day keys plus its raw offset. */
export type SummaryWindow = { from: string; to: string };

/* ---------------------------------------------------------------- record ids */

/** The id alphabet the per-set contract and `parseRecordId` share. */
const ID_PART = /^[A-Za-z0-9_-]{1,80}$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * `<workoutId>:<exerciseId>[:<setId>]` for one record entry, or null when the
 * entry carries nothing the server would parse (a legacy row without a
 * `workoutId`, an id outside the alphabet). Never guess an id: an unparseable
 * one would answer 400 RECORD_ID_INVALID, so the row simply offers no removal.
 */
export function recordIdOf(exerciseId: string, record: { workoutId?: string | null; setId?: string | null } | null | undefined): string | null {
  const workoutId = record?.workoutId;
  if (typeof workoutId !== 'string' || !OBJECT_ID.test(workoutId)) return null;
  if (!ID_PART.test(exerciseId)) return null;
  const setId = record?.setId;
  if (setId === undefined || setId === null || setId === '') return `${workoutId}:${exerciseId}`;
  if (typeof setId !== 'string' || !ID_PART.test(setId)) return null;
  return `${workoutId}:${exerciseId}:${setId}`;
}

/* ---------------------------------------------------------------- fetchers */

/** How many ids `GET /workouts/records` takes in one read (the route's ceiling). */
export const RECORDS_ID_LIMIT = 50;

/**
 * The member's bests for up to 50 exercises. Every requested id comes back as
 * a key, `null` when they have never recorded it; an empty list makes no
 * request (the route requires `exerciseId`).
 */
export async function fetchRecords(exerciseIds: ReadonlyArray<string>): Promise<ProgressRecords> {
  const ids = [...new Set(exerciseIds.filter((id) => typeof id === 'string' && id))].slice(0, RECORDS_ID_LIMIT);
  if (!ids.length) return {};
  const { data } = await api.get<{ records?: ProgressRecords }>('/workouts/records', { params: { exerciseId: ids.join(',') } });
  return data?.records ?? {};
}

/** The period summary (span at most 92 days), read on the caller's own clock. */
export async function fetchRecordsSummary(window: SummaryWindow): Promise<ProgressSummary> {
  const { data } = await api.get<ProgressSummary>('/workouts/records/summary', { params: { from: window.from, to: window.to, ...localDayParams() } });
  return data;
}

/** What the member has done to one exercise's records: exclusions first, then its reset. */
export async function fetchAdjustments(exerciseId: string): Promise<RecordAdjustment[]> {
  const { data } = await api.get<{ exerciseId: string; adjustments?: RecordAdjustment[] }>('/workouts/records/adjustments', { params: { exerciseId } });
  return data?.adjustments ?? [];
}

/** "Remove this record": the set leaves every record type of that exercise. Idempotent. */
export async function deleteRecord(recordId: string): Promise<RecordMaintenance> {
  const { data } = await api.delete<RecordMaintenance>(`/workouts/records/${encodeURIComponent(recordId)}`);
  return data;
}

/** The Undo of a removal. 404 RECORD_NOT_FOUND when there is no exclusion to lift. */
export async function restoreRecord(recordId: string): Promise<RecordMaintenance> {
  const { data } = await api.post<RecordMaintenance>(`/workouts/records/${encodeURIComponent(recordId)}/restore`);
  return data;
}

/**
 * "Start fresh from a date": sessions of this exercise dated before `from`
 * stop feeding its records. `from` is a `YYYY-MM-DD` calendar day read at the
 * start of day in the caller's offset, and must not be in the future.
 */
export async function resetRecords(exerciseId: string, from: string): Promise<RecordMaintenance> {
  const { data } = await api.post<RecordMaintenance>('/workouts/records/reset', { exerciseId, from, ...localDayParams() });
  return data;
}

/** The Undo of a reset. 404 RECORD_RESET_NOT_FOUND when the exercise has none. */
export async function clearRecordsReset(exerciseId: string): Promise<RecordMaintenance> {
  const { data } = await api.delete<RecordMaintenance>('/workouts/records/reset', { params: { exerciseId } });
  return data;
}

/* -------------------------------------------------------------- query keys */

export const recordKeys = {
  all: ['workout-records'] as const,
  bests: (exerciseIds: ReadonlyArray<string>) => ['workout-records', 'bests', [...exerciseIds].sort().join(',')] as const,
  summary: (window: SummaryWindow) => ['workout-records', 'summary', window.from, window.to] as const,
  adjustments: (exerciseId: string) => ['workout-records', 'adjustments', exerciseId] as const,
};

/* ----------------------------------------------------------------- helpers */

/**
 * "This deployment has no such route": the API answers an unclaimed path
 * under /api with `404 { error: { code: 'NOT_FOUND' } }`, so a surface built
 * on a route the server has not shipped hides itself instead of showing an
 * error. A route-level 404 (`RECORD_NOT_FOUND`, `RECORD_RESET_NOT_FOUND`,
 * `FEATURE_DISABLED`) is an answer about the data and never read as absence.
 */
export function isNotDeployed(error: unknown): boolean {
  const details = apiErrorDetails(error);
  return details.status === 404 && (details.code === null || details.code === 'NOT_FOUND');
}

/** The one 404 both removals answer when nothing of the caller's matches. */
export const isRecordGone = (error: unknown): boolean => {
  const details = apiErrorDetails(error);
  return details.status === 404 && (details.code === 'RECORD_NOT_FOUND' || details.code === 'RECORD_RESET_NOT_FOUND');
};
