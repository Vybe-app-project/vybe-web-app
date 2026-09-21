import { create } from 'zustand';
import { api } from './api';
import { apiErrorDetails } from './apiError';
import { timezoneOffsetMinutes } from './timezone';

/**
 * Bring your history with you, and take it away again
 * (docs/api-contract.md, "Workout history: … CSV export and Strong/Hevy
 * import" and "Import preview and exercise mapping").
 *
 *   GET  /api/me/export/workouts.csv    streams text/csv as an attachment
 *                                       (vybe-workouts.csv), one row per set
 *   POST /api/me/import/workouts        a Strong or Hevy CSV, detected by its
 *                                       header row
 *   POST /api/me/import/workouts?dryRun=1  the same parse and library match,
 *                                       nothing written: what the commit
 *                                       would do with this text
 *
 * Both are bearer-only, so neither is a plain link: the CSV comes back as a
 * blob through the one axios client and is handed to the browser as an object
 * URL. There is no signed download URL in the contract to use instead.
 *
 * The body is multipart, always. The file is the `file` field and pasted text
 * is wrapped in the same field, because `express.json()` is capped at 2 MiB
 * in app.js while the import itself allows WORKOUT_IMPORT_MAX_BYTES (5 MiB):
 * a JSON `{ csv }` body would be refused by the parser before the route's own
 * limit ever applied. Options ride as multipart fields, which the controller
 * reads through the same `option()` helper as the query string.
 *
 * Literal request paths on purpose — scripts/audit-api-contracts.cjs pins
 * them against the backend route snapshot.
 */

/* ------------------------------------------------------------------ models */

/** The two exports the server's header sniffing knows. There is no third format. */
export type ImportFormat = 'strong' | 'hevy';

export type ImportWeightUnit = 'kg' | 'lbs';
export type ImportDistanceUnit = 'km' | 'miles' | 'm';

/** One source name the library (or the member's own pick) places on a library row. */
export type ImportMatchedRow = {
  name: string;
  count: number;
  workouts: number;
  /** The library slug, or the `custom-…` id a mapping chose (then `exerciseName` is null). */
  exerciseId: string;
  exerciseName: string | null;
};

/** One source name nothing places, with up to five library candidates, best first. */
export type ImportUnmatchedRow = {
  name: string;
  count: number;
  workouts: number;
  /** The `custom-<slug>` id the commit would file it under. */
  exerciseId: string;
  suggestions: Array<{ exerciseId: string; name: string }>;
};

/** `POST …?dryRun=1`: what the commit would do, with nothing written. */
export type ImportPreview = {
  dryRun: true;
  format: ImportFormat;
  /** Everything the file holds: sessions, set rows, distinct exercise names. */
  workouts: number;
  sets: number;
  exercises: number;
  /** Sessions with nothing storable; the commit skips them. */
  invalid: number;
  /** Sessions this member has already imported; the commit replays them. */
  alreadyImported: number;
  /** The unit the FILE names, or null when the caller's default was assumed. */
  unitDetected: ImportWeightUnit | null;
  distanceUnitDetected: ImportDistanceUnit | null;
  dateRange: { from: string; to: string } | null;
  notes: { workouts: number; exercises: number };
  matched: ImportMatchedRow[];
  unmatched: ImportUnmatchedRow[];
};

/** The commit's answer. `skipped` counts replays, `invalid` sessions with nothing storable. */
export type ImportResult = {
  format: ImportFormat;
  workouts: number;
  imported: number;
  skipped: number;
  invalid: number;
  unmatchedExercises: string[];
};

/** The member's picks: source name as written in the file → a library slug or a `custom-…` id. */
export type ImportMapping = Record<string, string>;

export type ImportOptions = {
  unit?: ImportWeightUnit;
  distanceUnit?: ImportDistanceUnit;
  mapping?: ImportMapping;
};

/* ------------------------------------------------------------------- rules */

/** WORKOUT_IMPORT_MAX_BYTES, the route's default. Checked here so a big file never leaves the device. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** MAPPING_MAX_ENTRIES: the route rejects a bigger mapping with 400 WORKOUT_IMPORT_INVALID. */
export const MAPPING_MAX_ENTRIES = 500;

/** A picker stub id: what the commit files an exercise under when it stays custom. */
export const CUSTOM_EXERCISE_ID = /^custom-[a-z0-9][a-z0-9-]{0,72}$/;

/** What the file picker accepts, and the one line that names the formats. */
export const IMPORT_ACCEPT = '.csv,.txt,text/csv,text/plain';
export const IMPORT_FORMATS_COPY = 'A Strong or Hevy CSV export. Vybe reads the file’s header row to tell which one it is.';

export const FORMAT_LABELS: Record<ImportFormat, string> = { strong: 'Strong', hevy: 'Hevy' };

/* ---------------------------------------------------------------- fetchers */

/** The export path, as the one axios client sends it (baseURL `/api`). */
export const WORKOUTS_CSV_PATH = '/me/export/workouts.csv';
export const WORKOUTS_CSV_FILE_NAME = 'vybe-workouts.csv';

/** What the CSV holds, for the line under the row. */
export const WORKOUTS_CSV_COPY =
  'One row per set, oldest first: date, session, exercise, set, weight in kg, reps, time, distance, RPE and your notes.';

/**
 * The whole history as one CSV. The route is bearer-only, so this is a blob
 * read through the one client rather than a link; the caller turns it into a
 * download. The server's own attachment name is preferred when it sent one.
 */
export async function fetchWorkoutsCsv(): Promise<{ blob: Blob; fileName: string }> {
  const response = await api.get<Blob>(WORKOUTS_CSV_PATH, { responseType: 'blob' });
  const disposition = String(response.headers?.['content-disposition'] ?? '');
  const named = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: response.data, fileName: named?.[1]?.trim() || WORKOUTS_CSV_FILE_NAME };
}

/** Hand a blob to the browser as a download and release the object URL. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same task can cancel the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The multipart body both calls share. `csv` is sent as the `file` field
 * whichever way the member supplied it, so the server has one code path and
 * the 5 MiB ceiling is the route's, not the JSON parser's.
 */
function importForm(csv: Blob, fileName: string, options: ImportOptions, dryRun: boolean): FormData {
  const form = new FormData();
  form.append('file', csv, fileName);
  form.append('timezoneOffsetMinutes', String(timezoneOffsetMinutes()));
  if (options.unit) form.append('unit', options.unit);
  if (options.distanceUnit) form.append('distanceUnit', options.distanceUnit);
  // A JSON string in a multipart field, which is the shape the route documents
  // (the field cap is 64 KiB, so 500 entries fit with room to spare).
  if (options.mapping && Object.keys(options.mapping).length) form.append('mapping', JSON.stringify(options.mapping));
  form.append('dryRun', dryRun ? '1' : '0');
  return form;
}

/** Pasted text as the same `file` field, so one body shape covers both inputs. */
export const csvBlobOf = (text: string): Blob => new Blob([text], { type: 'text/csv' });

/** The preview: the same parse, match and mapping as the commit, nothing written. */
export async function previewWorkoutImport(csv: Blob, fileName: string, options: ImportOptions = {}): Promise<ImportPreview> {
  const { data } = await api.post<ImportPreview>('/me/import/workouts', importForm(csv, fileName, options, true));
  return data;
}

/** The commit. A re-upload of the same sessions replays instead of duplicating. */
export async function commitWorkoutImport(csv: Blob, fileName: string, options: ImportOptions = {}): Promise<ImportResult> {
  const { data } = await api.post<ImportResult>('/me/import/workouts', importForm(csv, fileName, options, false));
  return data;
}

/* -------------------------------------------------------------- query keys */

export const portabilityKeys = {
  all: ['workout-portability'] as const,
  preview: (token: string, mappingToken: string, unit: string) => ['workout-portability', 'preview', token, mappingToken, unit] as const,
};

/** A stable key for one picked file or pasted text, so re-previewing the same input is a cache hit. */
export const sourceToken = (fileName: string, size: number, lastModified?: number): string =>
  `${fileName}:${size}:${lastModified ?? 0}`;

/* ----------------------------------------------------------------- helpers */

/**
 * "This deployment has no import/export": an unclaimed path under /api
 * answers `404 { error: { code: 'NOT_FOUND' } }`, and every entry point to
 * this flow hides on it rather than showing an error. The route's own 400s
 * and the 413 are real answers and keep their own copy.
 */
export function isNotDeployed(error: unknown): boolean {
  const details = apiErrorDetails(error);
  return details.status === 404 && (details.code === null || details.code === 'NOT_FOUND');
}

/** The route's error codes, so a page can answer the ones worth a different sentence. */
export const importErrorCode = (error: unknown): string | null => apiErrorDetails(error).code;

/**
 * Whether this deployment has the two routes, for the entry points.
 *
 * Neither route can be probed cheaply — the export streams the whole history
 * and the import needs a body — so nothing is asked in advance: the rows are
 * offered, and the first 404 NOT_FOUND from either one takes its entry points
 * away for the rest of the session. Optimistic by design: the routes are in
 * the contract snapshot, so the honest default is that they are there, and a
 * server without them hides them after one attempt instead of flashing an
 * entry point that disappears on every load.
 */
export const usePortabilitySupport = create<{
  importSupported: boolean;
  exportSupported: boolean;
  markMissing: (kind: 'import' | 'export') => void;
}>((set) => ({
  importSupported: true,
  exportSupported: true,
  markMissing: (kind) => set(kind === 'import' ? { importSupported: false } : { exportSupported: false }),
}));

/** Note a 404 NOT_FOUND against the surface that raised it; anything else is left alone. */
export function noteIfMissing(kind: 'import' | 'export', error: unknown): boolean {
  if (!isNotDeployed(error)) return false;
  usePortabilitySupport.getState().markMissing(kind);
  return true;
}

/** "42 sessions" / "1 session". Kept here so the page and its tests agree. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${Math.max(0, Math.round(n)).toLocaleString()} ${Math.round(n) === 1 ? one : many}`;
