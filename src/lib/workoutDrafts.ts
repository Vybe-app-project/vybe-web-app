export const WORKOUT_DRAFT_DB = 'vybe-workout-drafts';
const GENERATION = 'vybe.workout-drafts.generation';
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,100}$/;
export type RestTimer = {
  durationSeconds: number;
  deadline: number | null;
  pausedSeconds: number | null;
  scope: string;
};
export type WorkoutDraft = {
  version: 1;
  ownerId: string;
  draftId: string;
  clientRequestId: string;
  updatedAt: number;
  form: Record<string, unknown>;
  editing: Record<string, unknown> | null;
  seed: Record<string, unknown> | null;
  timer: RestTimer;
  pending: { payload: Record<string, unknown>; targetId: string | null } | null;
};
type Scope = { ownerId: string; token: string; generation: string; sessionHash: string };
let active: Scope | null = null;
let serial: Promise<unknown> = Promise.resolve();
let issue: string | null = null;
const error = (message: string): never => { throw new Error(message); };
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = serial.then(operation, operation);
  serial = result.then(() => undefined, () => undefined);
  return result;
};
const generation = () => localStorage.getItem(GENERATION) ?? 'initial';
const assertScope = (scope: Scope) => {
  if (active !== scope || generation() !== scope.generation || localStorage.getItem('vybe.token') !== scope.token) {
    error('Your account changed. Reload before using a workout draft.');
  }
};
async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return error('Workout draft storage is unavailable. No workout will be sent until storage works.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKOUT_DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts', { keyPath: 'ownerId' });
      request.result.createObjectStore('meta');
    };
    request.onerror = () => reject(new Error('Could not open workout draft storage. Check browser storage permissions.'));
    request.onblocked = () => reject(new Error('Workout draft storage is blocked by another tab. Close it and retry.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function transaction<T>(run: (drafts: IDBObjectStore, meta: IDBObjectStore, result: (value: T) => void, fail: (message: string) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(['drafts', 'meta'], 'readwrite');
    let value: T;
    let failure = 'Workout draft could not be stored. Storage may be full or unavailable; your unsynced input is still on screen.';
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = () => { db.close(); reject(new Error(failure)); };
    tx.onerror = () => { /* onabort reports the actual transaction failure. */ };
    try {
      run(tx.objectStore('drafts'), tx.objectStore('meta'), next => { value = next; }, message => { failure = message; tx.abort(); });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : failure;
      tx.abort();
    }
  });
}
function revokeLocally() {
  active = null;
  if (typeof indexedDB !== 'undefined') {
    void enqueue(() => transaction<void>((drafts, meta, done) => {
      drafts.clear(); meta.clear(); done(undefined);
    })).catch(() => { issue = 'Local workout drafts could not be purged. They remain inaccessible; retry storage cleanup.'; });
  }
}
/** Synchronous generation revocation survives navigation interrupting IDB cleanup. */
export function invalidateWorkoutDrafts() {
  try { localStorage.setItem(GENERATION, crypto.randomUUID()); }
  catch { issue = 'Browser storage is unavailable. Workout recovery is disabled.'; }
  revokeLocally();
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === 'vybe.token' || event.key === GENERATION || event.key === null) revokeLocally();
  });
}

export async function bindWorkoutDraftAccount(ownerId: string, token: string) {
  if (!ownerId || !token || localStorage.getItem('vybe.token') !== token) return error('A verified account is required for workout recovery.');
  const currentGeneration = generation();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const sessionHash = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  return enqueue(async () => {
    if (generation() !== currentGeneration || localStorage.getItem('vybe.token') !== token) return error('Your account changed. Reload before using a workout draft.');
    const scope = active?.ownerId === ownerId && active.token === token && active.generation === currentGeneration
      ? active : { ownerId, token, generation: currentGeneration, sessionHash };
    await transaction<void>((drafts, meta, done, fail) => {
      const request = meta.get('scope');
      request.onsuccess = () => {
        if (generation() !== currentGeneration || localStorage.getItem('vybe.token') !== token) { fail('Your account changed.'); return; }
        const old = request.result;
        if (old?.ownerId !== ownerId || old?.sessionHash !== sessionHash || old?.generation !== currentGeneration) drafts.clear();
        meta.put({ ownerId, sessionHash, generation: currentGeneration }, 'scope');
        done(undefined);
      };
    });
    active = scope;
    issue = null;
  });
}
export const workoutDraftStorageIssue = () => issue;
export function reportWorkoutDraftStorageIssue(message: string) { issue = message; }
export function workoutDraftSessionToken(ownerId: string) {
  if (!active || active.ownerId !== ownerId) return error('Your workout draft no longer belongs to the active session.');
  assertScope(active);
  return active.token;
}
export function validWorkoutDraft(value: unknown, ownerId: string): value is WorkoutDraft {
  const draft = value as WorkoutDraft | null;
  if (!draft || draft.version !== 1 || draft.ownerId !== ownerId || !REQUEST_ID.test(draft.draftId)
      || !REQUEST_ID.test(draft.clientRequestId) || !Number.isFinite(draft.updatedAt) || !draft.form) return false;
  for (const key of ['name', 'type', 'date', 'duration', 'caloriesBurned', 'notes']) if (typeof draft.form[key] !== 'string') return false;
  const exercises = draft.form.exercises as Array<Record<string, unknown>>;
  if (!Array.isArray(exercises) || !exercises.length || exercises.length > 100) return false;
  for (const ex of exercises) {
    if (!ex || typeof ex.name !== 'string' || typeof ex.exerciseId !== 'string'
        || ['sets', 'reps', 'weight', 'duration', 'distance', 'notes'].some(key => typeof ex[key] !== 'string')) return false;
    if (ex.setRecords !== undefined) {
      if (!Array.isArray(ex.setRecords) || ex.setRecords.length > 100) return false;
      if (ex.setRecords.some(set => !set || typeof set.id !== 'string' || typeof set.reps !== 'string'
          || typeof set.weight !== 'string' || !['kg', 'lb'].includes(set.weightUnit) || typeof set.completed !== 'boolean')) return false;
    }
  }
  const timer = draft.timer;
  if (!timer || !Number.isFinite(timer.durationSeconds) || timer.durationSeconds < 1 || timer.durationSeconds > 86400
      || typeof timer.scope !== 'string'
      || (timer.deadline !== null && !Number.isFinite(timer.deadline))
      || (timer.pausedSeconds !== null && (!Number.isFinite(timer.pausedSeconds) || timer.pausedSeconds < 0))) return false;
  if (draft.pending !== null && (!draft.pending?.payload || typeof draft.pending.payload !== 'object'
      || (draft.pending.targetId !== null && typeof draft.pending.targetId !== 'string')
      || (draft.pending.targetId === null && draft.pending.payload.clientRequestId !== draft.clientRequestId))) return false;
  return draft.editing === null || (typeof draft.editing?._id === 'string');
}

async function scoped<T>(ownerId: string, action: (drafts: IDBObjectStore, done: (value: T) => void, fail: (message: string) => void) => void): Promise<T> {
  const scope = active;
  if (!scope || scope.ownerId !== ownerId) return error('Workout recovery requires the current verified account.');
  return enqueue(async () => {
    assertScope(scope);
    return transaction<T>((drafts, meta, done, fail) => {
      const request = meta.get('scope');
      request.onsuccess = () => {
        try { assertScope(scope); } catch { fail('Your account changed. Reload before using a workout draft.'); return; }
        if (request.result?.ownerId !== ownerId || request.result?.sessionHash !== scope.sessionHash
            || request.result?.generation !== scope.generation) { fail('Another session changed local workout storage. Reload to continue.'); return; }
        action(drafts, done, fail);
      };
    });
  });
}
export function loadWorkoutDraft(ownerId: string): Promise<WorkoutDraft | null> {
  return scoped(ownerId, (drafts, done, fail) => {
    const request = drafts.get(ownerId);
    request.onsuccess = () => {
      if (request.result === undefined) done(null);
      else if (validWorkoutDraft(request.result, ownerId)) done(request.result);
      else fail('This local workout draft has an unsupported or invalid format. Discard it explicitly; it has not been sent.');
    };
  });
}
export function persistWorkoutDraft(draft: WorkoutDraft): Promise<void> {
  if (!validWorkoutDraft(draft, draft.ownerId)) return Promise.reject(new Error('This workout draft cannot be safely stored.'));
  return scoped(draft.ownerId, (drafts, done, fail) => {
    const request = drafts.get(draft.ownerId);
    request.onsuccess = () => {
      if (request.result && request.result.draftId !== draft.draftId) { fail('Another local workout draft exists. Resume or discard it first.'); return; }
      try {
        drafts.put(draft);
        done(undefined);
      } catch {
        fail('Workout draft could not be stored. Storage may be full or unavailable; your unsynced input is still on screen.');
      }
    };
  });
}
export function removeWorkoutDraft(ownerId: string, draftId?: string): Promise<void> {
  return scoped(ownerId, (drafts, done, fail) => {
    const request = drafts.get(ownerId);
    request.onsuccess = () => {
      if (draftId && request.result && request.result.draftId !== draftId) { fail('The local draft changed. Reload before discarding.'); return; }
      try { drafts.delete(ownerId); done(undefined); }
      catch { fail('The server save may be complete, but the local draft could not be cleared. Retry local cleanup.'); }
    };
  });
}
export const emptyRestTimer = (): RestTimer => ({ durationSeconds: 60, deadline: null, pausedSeconds: null, scope: 'Session' });
export function restRemaining(timer: RestTimer, now = Date.now()) {
  return timer.deadline !== null ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : timer.pausedSeconds ?? timer.durationSeconds;
}
