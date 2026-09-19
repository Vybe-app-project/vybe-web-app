/**
 * Keeping `settings.timezone` in step with the browser.
 *
 * Every server job that needs a zone (streaks, recaps, gym events, push
 * budget) reads `settings.timezone` and fails closed when it is absent; the
 * server never guesses a zone from an offset or an IP. So the web sends the
 * browser's IANA zone at sign-in and whenever the tab comes back into view,
 * but only when it would change something.
 *
 * The server canonicalises what it stores ('US/Eastern' -> 'America/New_York',
 * 'Asia/Calcutta' -> 'Asia/Kolkata' on newer ICU, 'Etc/UTC' -> 'UTC'), so
 * `browserZone !== storedZone` can be permanently true. `lastSentZone`
 * remembers what this tab already sent; without it such a browser would
 * PUT on every foreground.
 *
 * That memory lives in sessionStorage, which outlives a sign-out in the same
 * tab, so it is stored with the account that sent it and only ever read back
 * for that account: the next person to sign in on the tab starts clean.
 *
 * Import-free so tests can load it straight from source.
 */

/** The browser's IANA zone, or null when the runtime cannot say. Never throws. */
export const browserTimeZone = (): string | null => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.trim() ? zone.trim() : null;
  } catch {
    return null;
  }
};

export type TimezoneSyncInput = {
  browserZone: string | null;
  /** `user.settings.timezone`; undefined until the account has one. */
  storedZone: string | null | undefined;
  /** What this tab already sent for this account (memory + sessionStorage, see readSentZone). */
  lastSentZone: string | null;
  /** `document.visibilityState === 'visible'`; defaults to true. */
  visible?: boolean;
  /** A pending-deletion account gets 401 on every ordinary route; never write for it. */
  pendingDeletion?: boolean;
};

export type TimezoneSkipReason = 'no-browser-zone' | 'hidden' | 'pending-deletion' | 'same' | 'already-sent';

export type TimezoneSyncDecision = { action: 'put'; zone: string } | { action: 'skip'; reason: TimezoneSkipReason };

/** The decision table, in this order: no zone, hidden, pending deletion, same as stored, same as last sent, else put. */
export function timezoneSyncDecision(input: TimezoneSyncInput): TimezoneSyncDecision {
  const { browserZone, storedZone, lastSentZone, visible = true, pendingDeletion = false } = input;
  if (!browserZone) return { action: 'skip', reason: 'no-browser-zone' };
  if (visible === false) return { action: 'skip', reason: 'hidden' };
  if (pendingDeletion) return { action: 'skip', reason: 'pending-deletion' };
  if (storedZone && browserZone === storedZone) return { action: 'skip', reason: 'same' };
  if (lastSentZone && browserZone === lastSentZone) return { action: 'skip', reason: 'already-sent' };
  return { action: 'put', zone: browserZone };
}

/* ------------------------------------------------------------------ what this tab already sent */

/** One sessionStorage entry per tab: `{ userId, zone }` for the account that sent it. */
export const TZ_SENT_KEY = 'vybe.tzSent';

/** The part of the Storage interface the helpers use, so tests can pass a Map-backed stand-in. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * The zone this tab already sent for `userId`; null when nothing was sent,
 * when it was sent for another account, or when the entry cannot be read.
 */
export function readSentZone(storage: StorageLike | null | undefined, userId: string): string | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(TZ_SENT_KEY);
    if (!raw) return null;
    const entry: unknown = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') return null;
    const { userId: owner, zone } = entry as { userId?: unknown; zone?: unknown };
    return owner === userId && typeof zone === 'string' && zone ? zone : null;
  } catch {
    return null;
  }
}

/** Remember that `zone` was sent for `userId`, replacing whatever any account wrote before. Never throws. */
export function rememberSentZone(storage: StorageLike | null | undefined, userId: string, zone: string): void {
  try {
    storage?.setItem(TZ_SENT_KEY, JSON.stringify({ userId, zone }));
  } catch {
    // Quota or a privacy mode: the caller's memory copy still stops the loop for this page load.
  }
}

/** Drop the entry: on sign-out, and after a failed PUT so the next foreground tries again. Never throws. */
export function forgetSentZone(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(TZ_SENT_KEY);
  } catch {
    // Nothing to undo.
  }
}
