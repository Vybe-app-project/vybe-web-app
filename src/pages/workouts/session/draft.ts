import type { RestTimerState, WorkoutSession } from './types';

/**
 * The draft that makes a browser session survivable.
 *
 * A tab can be closed, reloaded, restored by the OS or killed by a
 * background purge, and none of that is a decision the member made — so the
 * session is mirrored to `localStorage` on every change and read back on
 * import. Because the clock is derived from `startedAt` and the rest dock
 * from an absolute `deadline`, a resumed draft is not an approximation: the
 * elapsed origin and the countdown are exactly where they were.
 *
 * One draft at a time, keyed by nothing but the app: a second session would
 * need an "active sessions" concept the API does not have, and two half-typed
 * sessions is worse than one. The envelope is versioned; an envelope from a
 * future or unknown version is dropped rather than guessed at, and a corrupt
 * value can never crash the runner.
 */

export const DRAFT_KEY = 'vybe.session.draft';
export const DRAFT_VERSION = 1 as const;

export type DraftEnvelope = {
  version: typeof DRAFT_VERSION;
  savedAt: string;
  session: WorkoutSession;
  rest: RestTimerState | null;
};

export type StoredDraft = { session: WorkoutSession; rest: RestTimerState | null; savedAt: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const UNITS = new Set(['kg', 'lb']);

/** Structural check, so a foreign or half-written value is simply not a draft. */
export function isWorkoutSession(value: unknown): value is WorkoutSession {
  if (!isRecord(value)) return false;
  if (typeof value.sessionId !== 'string' || typeof value.startedAt !== 'string') return false;
  if (typeof value.name !== 'string' || typeof value.clientRequestId !== 'string') return false;
  if (!UNITS.has(String(value.unit))) return false;
  if (!Array.isArray(value.exercises)) return false;
  return value.exercises.every(
    (exercise) =>
      isRecord(exercise) &&
      typeof exercise.key === 'string' &&
      typeof exercise.exerciseId === 'string' &&
      typeof exercise.name === 'string' &&
      Array.isArray(exercise.sets) &&
      exercise.sets.every((set) => isRecord(set) && typeof set.id === 'string' && typeof set.completed === 'boolean'),
  );
}

function isRestTimer(value: unknown): value is RestTimerState {
  return (
    isRecord(value) &&
    typeof value.deadline === 'number' &&
    typeof value.startedAt === 'number' &&
    typeof value.durationSec === 'number' &&
    typeof value.exerciseKey === 'string' &&
    typeof value.setId === 'string'
  );
}

/** The stored draft, or null when there is none (or it is not one). */
export function load(): StoredDraft | null {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(DRAFT_KEY);
  } catch {
    // Storage can be unavailable (privacy mode): the session still runs, it
    // just cannot be resumed.
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== DRAFT_VERSION) return null;
  if (!isWorkoutSession(parsed.session)) return null;
  return {
    session: parsed.session,
    rest: isRestTimer(parsed.rest) ? parsed.rest : null,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
  };
}

/** Written on every change; a write that fails costs the resume, not the session. */
export function save(session: WorkoutSession, rest: RestTimerState | null = null): void {
  const envelope: DraftEnvelope = { version: DRAFT_VERSION, savedAt: new Date().toISOString(), session, rest };
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    // Quota or privacy mode; nothing here is worth interrupting a set for.
  }
}

export function clear(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DRAFT_KEY);
  } catch {
    // A draft that cannot be removed is offered for resume again; Discard is there.
  }
}
