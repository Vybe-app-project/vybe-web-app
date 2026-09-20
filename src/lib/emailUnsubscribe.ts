/**
 * One-click email unsubscribe: the token rule, the reader for the landing
 * URL, and the sentences the page shows for each answer from
 * `POST /api/email/unsubscribe` (vybe-backend/controllers/emailUnsubscribeController.js).
 *
 * Import-free on purpose: tests/email-unsubscribe.test.mjs transpiles this
 * file in memory and imports it directly (see passwordReset.ts for the same
 * arrangement).
 */

/**
 * The API mints tokens as 32 random bytes rendered base64url (43 characters)
 * and accepts /^[A-Za-z0-9_-]{32,128}$/ (services/emailUnsubscribe.js
 * TOKEN_PATTERN). Anything else is refused before a request is made, which
 * also keeps a stray path from spending the per-IP limiter.
 */
export const UNSUBSCRIBE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export const isUnsubscribeToken = (value: string | null | undefined): boolean =>
  typeof value === 'string' && UNSUBSCRIBE_TOKEN_RE.test(value);

/**
 * The landing accepts the token in the path (/email/unsubscribe/<token>, the
 * shape a mailer builds with resolveFrontendUrl) or as `?token=` for a link
 * that was hand-built; the path wins when both are present.
 */
export function readUnsubscribeToken({ param, search }: { param?: string | null; search?: string | null }): string {
  const fromPath = typeof param === 'string' ? param.trim() : '';
  if (fromPath) return fromPath;
  if (typeof search !== 'string' || !search) return '';
  try {
    return (new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('token') ?? '').trim();
  } catch {
    return '';
  }
}

/** The nine email kinds plus `all` (models/EmailUnsubscribeToken.js EMAIL_UNSUBSCRIBE_KINDS). */
export const UNSUBSCRIBE_KINDS = [
  'newFollowers',
  'workoutPosts',
  'likes',
  'comments',
  'friendRequests',
  'weeklyRecap',
  'checkins',
  'achievements',
  'productUpdates',
  'all',
] as const;
export type UnsubscribeKind = (typeof UNSUBSCRIBE_KINDS)[number];

export const isUnsubscribeKind = (value: unknown): value is UnsubscribeKind =>
  typeof value === 'string' && (UNSUBSCRIBE_KINDS as readonly string[]).includes(value);

/**
 * The noun for each kind in the success sentence. These match the row titles
 * on the Settings email card the page links to, so "likes" here where the
 * API's own label says "kudos".
 */
const KIND_LABELS: Record<Exclude<UnsubscribeKind, 'all'>, string> = {
  newFollowers: 'new follower',
  workoutPosts: 'posts from people you follow',
  likes: 'likes',
  comments: 'comments',
  friendRequests: 'follow requests',
  weeklyRecap: 'weekly recap',
  checkins: 'check-ins',
  achievements: 'achievements',
  productUpdates: 'marketing and product updates',
};

export function unsubscribeKindLabel(kind: string | null | undefined): string | null {
  if (!isUnsubscribeKind(kind) || kind === 'all') return null;
  return KIND_LABELS[kind];
}

const ALL_MESSAGE = 'You are unsubscribed from all Vybe email. Sign-in codes and account notices still arrive.';
const GENERIC_DONE = 'You are unsubscribed.';

/**
 * The sentence under "You are unsubscribed". A known kind gets the web's own
 * wording; an unknown kind (a future email kind this build does not know)
 * falls back to the server's sentence so nothing is invented.
 */
export function unsubscribeSuccessMessage(kind: string | null | undefined, serverMessage?: unknown): string {
  if (kind === 'all') return ALL_MESSAGE;
  const label = unsubscribeKindLabel(kind);
  if (label) return `You are unsubscribed from ${label} email. Your other choices are unchanged.`;
  const fallback = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  return fallback || GENERIC_DONE;
}

export type UnsubscribeFailure =
  | { kind: 'network' }
  | { kind: 'invalid-link' }
  | { kind: 'used-or-expired' }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'failed'; message: string };

/** The subset of an Axios error this module reads; typed structurally to stay import-free. */
type HttpFailure = {
  code?: string;
  response?: { status?: number; data?: unknown };
};

const RATE_LIMIT_FALLBACK = 'Too many unsubscribe requests from this connection. Try again in about 15 minutes.';
const FAILED_FALLBACK = 'Could not update your email preferences. Try the link again in a moment.';

/**
 * Sorts a failed POST into the states the page renders.
 *
 * - No response (or the browser reports offline): a connectivity problem; the page offers Try again.
 * - 400 TOKEN_REQUIRED / TOKEN_MALFORMED: the link itself is wrong; nothing to retry.
 * - 404 TOKEN_INVALID: unknown, already spent, or the account is gone; a retry would only repeat the 404.
 * - 429: the per-IP limiter (30 per 15 minutes); the API's sentence names the wait.
 * - Anything else: the API's sentence when it sent one, else the fallback; Try again is offered.
 */
export function classifyUnsubscribeFailure(error: unknown, { online = true }: { online?: boolean } = {}): UnsubscribeFailure {
  const failure = (error && typeof error === 'object' ? error : {}) as HttpFailure;
  const status = failure.response?.status;
  const data = failure.response?.data as { code?: unknown; message?: unknown } | undefined;
  const code = typeof data?.code === 'string' ? data.code : '';
  const message = typeof data?.message === 'string' ? data.message.trim() : '';

  if (online === false || failure.code === 'ERR_NETWORK' || (!status && (failure.code === 'ECONNABORTED' || failure.code === 'ETIMEDOUT'))) {
    return { kind: 'network' };
  }
  if (status === 400 && (code === 'TOKEN_REQUIRED' || code === 'TOKEN_MALFORMED')) return { kind: 'invalid-link' };
  if (status === 404 && code === 'TOKEN_INVALID') return { kind: 'used-or-expired' };
  if (status === 429) return { kind: 'rate-limited', message: message || RATE_LIMIT_FALLBACK };
  return { kind: 'failed', message: message || FAILED_FALLBACK };
}

export function unsubscribeFailureMessage(failure: UnsubscribeFailure): string {
  switch (failure.kind) {
    case 'network':
      return 'Could not reach Vybe. Check your connection and try again.';
    case 'invalid-link':
      return 'This link is not valid.';
    case 'used-or-expired':
      return 'This link has already been used or has expired.';
    case 'rate-limited':
    case 'failed':
      return failure.message;
  }
}

/** Only a connectivity problem or a server-side failure is worth a second POST. */
export const canRetryUnsubscribe = (failure: UnsubscribeFailure): boolean => failure.kind === 'network' || failure.kind === 'failed';

/** Where "Manage email preferences" goes: the card on Settings, via sign-in when there is no session. */
export const EMAIL_PREFERENCES_PATH = '/settings#email';
export const manageEmailPreferencesPath = (signedIn: boolean): string =>
  signedIn ? EMAIL_PREFERENCES_PATH : `/login?next=${encodeURIComponent(EMAIL_PREFERENCES_PATH)}`;

/**
 * The confirm question, in the web's own words, once the read-only preview
 * (GET /api/email/unsubscribe/:token, D-62) has said which kind the link is
 * for. Unknown or missing kind: the generic question. The API's own sentences
 * say "e-mail"; the product says "email", so they are never shown.
 */
export function unsubscribeConfirmQuestion(kind: string | null | undefined): string {
  if (kind === 'all') return 'Stop all Vybe email? Sign-in codes and account notices still arrive.';
  const label = unsubscribeKindLabel(kind);
  if (label) return `Stop ${label}? Your other choices stay as they are.`;
  return 'Stop these emails from Vybe? Sign-in codes and account notices still arrive.';
}
