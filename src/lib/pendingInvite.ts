/**
 * The invite code a person arrives with survives sign-up (Wave F,
 * design-first-week-and-people.md §3.4 "signed out: the code is kept … and
 * redeemed on the first authenticated screen").
 *
 * /join/<code> sends a new person to /register?invite=<CODE>. The moment the
 * account exists, GuestOnly redirects to the post-sign-in target and drops
 * every query parameter but ?next=, so the code is kept in sessionStorage
 * (scoped to the tab, gone when it closes) the same way the welcome marker
 * is (lib/authDrafts.ts). The welcome sheet offers it once signed in; the
 * Settings field prefills from it until it is used or the tab ends. The
 * 30-day rule mirrors the phone's store and is kept for parity.
 */
import type { StorageLike } from './authDrafts';
import { formatInviteCode, normaliseInviteCode } from './invites';

export const PENDING_INVITE_KEY = 'vybe.pendingInvite';
export const PENDING_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Stored = { code: string; at: number };

/** Keep a code as a person or a link wrote it; returns the normalised code, or null (and stores nothing) when it is not one. */
export function rememberPendingInvite(storage: StorageLike | null | undefined, raw: unknown, now = Date.now()): string | null {
  const code = normaliseInviteCode(raw);
  if (!code) return null;
  try {
    storage?.setItem(PENDING_INVITE_KEY, JSON.stringify({ code, at: now } satisfies Stored));
  } catch {
    // Storage full or unavailable: the person can still type the code later.
  }
  return code;
}

/** The kept code, or null; an entry older than the rule or not a code is removed as it is read. */
export function readPendingInvite(storage: StorageLike | null | undefined, now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PENDING_INVITE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: Partial<Stored> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<Stored>;
  } catch {
    parsed = null;
  }
  const code = parsed && typeof parsed === 'object' ? normaliseInviteCode(parsed.code) : null;
  const at = parsed && typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : null;
  if (!code || at === null || now - at < 0 || now - at >= PENDING_INVITE_TTL_MS) {
    clearPendingInvite(storage);
    return null;
  }
  return code;
}

export function clearPendingInvite(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * What Settings › Have a code? starts with. An explicit ?invite= in the URL
 * (the landing's "Use this code on the web") is the member's present intent
 * and wins over a code kept since sign-up in this tab; a stale kept code must
 * never be the one redeemed, since the API allows one redemption per account.
 * A code is shown as VYBE-XXXX-XXXX; anything else as written, so a mistyped
 * value is visible before Use code.
 */
export function initialInviteValue(search: string, storage: StorageLike | null | undefined, now = Date.now()): string {
  const fromUrl = (new URLSearchParams(search).get('invite') ?? '').trim() || null;
  const initial = fromUrl ?? readPendingInvite(storage, now) ?? '';
  return formatInviteCode(initial) ?? initial;
}
