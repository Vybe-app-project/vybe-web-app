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
 * remembers what this session already sent; without it such a browser would
 * PUT on every foreground.
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
  /** What this session already sent (memory + sessionStorage). */
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
