/**
 * Sign-up progress and the sign-in email survive a reload.
 *
 * On a phone the person leaves the tab to read the code in Mail, and iOS
 * often reloads the PWA on return; the form used to come back at step 1 with
 * an empty email, forcing a second code (which counts against the 5-per-15-
 * minute cap). Everything here lives in sessionStorage: it is scoped to the
 * tab, dies with it, and never holds a password.
 *
 * Import-free on purpose: tests/auth-onboarding.test.mjs transpiles this file
 * in memory and imports the result directly.
 */

export const REGISTER_DRAFT_KEY = 'vybe.registerDraft';
export const LOGIN_EMAIL_DRAFT_KEY = 'vybe.loginEmail';
export const WELCOME_PENDING_KEY = 'vybe.welcomePending';

/** The API expires codes after 5 minutes; a resend is allowed after 45 s. */
export const OTP_VALID_MS = 5 * 60 * 1000;
export const RESEND_COOLDOWN_S = 45;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type RegisterStep = 1 | 2 | 3;

export type RegisterDraft = {
  step: RegisterStep;
  email: string;
  /** When the code was sent (step 2), so the resend countdown is honoured. */
  sentAt?: number;
  /** The 10-minute registration proof (step 3). */
  preToken?: string;
  /** What was typed on step 3 so a reload does not empty the form (never the password). */
  fullName?: string;
  username?: string;
};

const MAX_FULL_NAME = 100;
const MAX_USERNAME = 30;
const typedText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
};

/** Expiry of a JWT in ms since the epoch, read without verifying (display only). */
export function jwtExpiryMs(token: string | null | undefined): number | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    if (typeof atob !== 'function') return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const isEmailish = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Restore the draft, degrading gracefully: a code older than its lifetime or
 * a dead registration proof sends the person back to step 1 with the email
 * still filled in, never to a step whose credential has already expired.
 */
export function readRegisterDraft(storage: StorageLike | null | undefined, now = Date.now()): RegisterDraft | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(REGISTER_DRAFT_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: Partial<RegisterDraft>;
  try {
    parsed = JSON.parse(raw) as Partial<RegisterDraft>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !isEmailish(parsed.email)) return null;
  const email = parsed.email.trim().toLowerCase();

  if (parsed.step === 3) {
    const expiry = jwtExpiryMs(parsed.preToken);
    // Five seconds of slack so a proof that dies mid-submit is not restored.
    if (typeof parsed.preToken === 'string' && expiry !== null && expiry > now + 5_000) {
      const fullName = typedText(parsed.fullName, MAX_FULL_NAME);
      const username = typedText(parsed.username, MAX_USERNAME)?.replace(/\s/g, '');
      return {
        step: 3,
        email,
        preToken: parsed.preToken,
        sentAt: typeof parsed.sentAt === 'number' ? parsed.sentAt : undefined,
        ...(fullName ? { fullName } : {}),
        ...(username ? { username } : {}),
      };
    }
    return { step: 1, email };
  }
  if (parsed.step === 2) {
    if (typeof parsed.sentAt === 'number' && now - parsed.sentAt >= 0 && now - parsed.sentAt < OTP_VALID_MS) {
      return { step: 2, email, sentAt: parsed.sentAt };
    }
    return { step: 1, email };
  }
  return { step: 1, email };
}

export function writeRegisterDraft(storage: StorageLike | null | undefined, draft: RegisterDraft): void {
  try {
    if (draft.step === 1 && !draft.email) {
      storage?.removeItem(REGISTER_DRAFT_KEY);
      return;
    }
    storage?.setItem(REGISTER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or unavailable: the form still works, it just will not survive a reload.
  }
}

export function clearRegisterDraft(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(REGISTER_DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Seconds left on the resend cooldown for a code sent at `sentAt`. */
export function resendSecondsLeft(sentAt: number | undefined, now = Date.now(), cooldownSeconds = RESEND_COOLDOWN_S): number {
  if (typeof sentAt !== 'number') return 0;
  const elapsed = Math.floor((now - sentAt) / 1000);
  return Math.max(0, Math.min(cooldownSeconds, cooldownSeconds - elapsed));
}

export function readDraftEmail(storage: StorageLike | null | undefined): string {
  try {
    const value = storage?.getItem(LOGIN_EMAIL_DRAFT_KEY);
    return typeof value === 'string' && value.length <= 254 ? value : '';
  } catch {
    return '';
  }
}

export function writeDraftEmail(storage: StorageLike | null | undefined, email: string): void {
  try {
    if (!email) storage?.removeItem(LOGIN_EMAIL_DRAFT_KEY);
    else storage?.setItem(LOGIN_EMAIL_DRAFT_KEY, email.slice(0, 254));
  } catch {
    // Best effort only.
  }
}

export function clearDraftEmail(storage: StorageLike | null | undefined): void {
  writeDraftEmail(storage, '');
}

/**
 * Sign-up hands off to the first-run sheet with this one-shot marker rather
 * than a URL param alone: the moment the store has a user, GuestOnly (still
 * mounted on /register) renders its own redirect to the post-sign-in target,
 * which wins the race against a `navigate('/?welcome=1')` and drops the
 * param. The marker is set before the store update and read once by the
 * sheet, so it also survives a hard reload in between.
 */
export function markWelcomePending(storage: StorageLike | null | undefined): void {
  try {
    storage?.setItem(WELCOME_PENDING_KEY, '1');
  } catch {
    // Without storage the sheet simply does not open; sign-up still completes.
  }
}

/** Reads and clears the marker; true exactly once per sign-up. */
export function takeWelcomePending(storage: StorageLike | null | undefined): boolean {
  try {
    const pending = storage?.getItem(WELCOME_PENDING_KEY) === '1';
    if (pending) storage?.removeItem(WELCOME_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}
