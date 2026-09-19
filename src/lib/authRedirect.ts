/**
 * Where a person lands after signing in, and how an expired session hands
 * them to the sign-in page without losing their place.
 *
 * Import-free on purpose: tests/auth-onboarding.test.mjs transpiles this file
 * in memory and imports the result directly, so it must not depend on
 * anything else (see passwordReset.ts for the same arrangement).
 */

/** Pages a signed-in person must never be bounced back to. */
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password', '/admin'];

/**
 * Only a same-origin absolute path may be used as a destination. Protocol-
 * relative URLs (`//evil.example`), backslash tricks, whitespace and the auth
 * pages themselves are refused so a crafted link cannot turn sign-in into an
 * open redirect or a loop.
 */
export function safeNextPath(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') return null;
  const value = candidate.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\s\\]/.test(value)) return null;
  const path = value.split(/[?#]/)[0];
  if (AUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`))) return null;
  return value;
}

export type FromLocation = { pathname?: string; search?: string } | null | undefined;

/** RequireAuth stores the attempted location in router state; flatten it. */
export function fromPath(from: FromLocation): string | null {
  if (!from?.pathname) return null;
  return `${from.pathname}${from.search ?? ''}`;
}

/**
 * Router state (an in-app redirect) wins over `?next=` (a link or the
 * session-expiry hand-off), and both fall back to Home. Login and GuestOnly
 * must agree on this or the guard's redirect overrides the page's target.
 */
export function postLoginTarget({ from, next }: { from?: FromLocation; next?: string | null }): string {
  return safeNextPath(fromPath(from)) ?? safeNextPath(next) ?? '/';
}

export const SESSION_EXPIRED_PARAM = 'expired';

/**
 * The 401 interceptor performs a hard navigation (it runs outside React, and
 * the token is already gone), so the intended path has to travel in the URL.
 */
export function sessionExpiredLoginUrl(pathname: string, search = ''): string {
  const params = new URLSearchParams({ [SESSION_EXPIRED_PARAM]: '1' });
  const next = safeNextPath(`${pathname}${search}`);
  if (next && next !== '/') params.set('next', next);
  return `/login?${params.toString()}`;
}

export type LoginNotice = { kind: 'expired' | 'reset' | 'signed-out-all'; tone: 'warning' | 'success'; text: string };

/** The one notice the sign-in page shows on arrival, if any. */
export function loginNoticeFor(params: { get(name: string): string | null }): LoginNotice | null {
  if (params.get(SESSION_EXPIRED_PARAM) === '1') {
    return { kind: 'expired', tone: 'warning', text: 'Your session expired. Sign in again to continue.' };
  }
  if (params.get('reset') === '1') {
    return { kind: 'reset', tone: 'success', text: 'Password updated. Sign in with your new password.' };
  }
  return null;
}

export const LOGIN_MISMATCH_COPY = 'That email and password don’t match. Check both, or reset your password.';
export const OFFLINE_COPY = 'Could not reach Vybe. Check your connection and try again.';

/** The subset of an Axios error this module reads; typed structurally to stay import-free. */
type HttpFailure = { code?: string; response?: { status?: number; data?: unknown; headers?: unknown } };

export type LoginFailure = { text: string; offerReset: boolean; retryAfterSec?: number | null };

/**
 * How long until a 429 clears, for a person. The same function lives in
 * apiError.ts; it is repeated here because this module must stay
 * import-free, and tests/client-policy.test.mjs pins the two equal.
 */
export function retryWaitCopy(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return 'in a moment';
  const seconds = Math.ceil(sec);
  if (seconds < 90) return `in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  if (seconds < 90 * 60) {
    const minutes = Math.ceil(seconds / 60);
    return `in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.ceil(seconds / 3600);
  return `in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * The 429 sentence for sign-in, where "attempts" is the honest word. Equal to
 * apiError.ts's rateLimitedCopy(sec, 'attempts'); the pin is in
 * tests/client-policy.test.mjs.
 */
export function rateLimitedCopy(sec: number | null | undefined): string {
  return `Too many attempts. Try again ${retryWaitCopy(sec)}.`;
}

const positiveSeconds = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
};

const headerOf = (headers: unknown, name: string): unknown => {
  if (!headers || typeof headers !== 'object') return null;
  const record = headers as Record<string, unknown> & { get?: (name: string) => unknown };
  try {
    if (typeof record.get === 'function') {
      const got = record.get(name);
      if (got !== undefined && got !== null) return got;
    }
  } catch {
    // Plain lookup below.
  }
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? record[key] : null;
};

/**
 * Seconds until a 429 clears. The auth limiter (app.js authLimiter) sends
 * only the Retry-After header; the per-account limiters put retryAfterSec
 * in the body; data export spells it retryAfter.
 */
export function retryAfterSecondsOf(failure: HttpFailure): number | null {
  const data = failure.response?.data as { retryAfterSec?: unknown; retryAfter?: unknown } | undefined;
  return (
    positiveSeconds(data?.retryAfterSec) ??
    positiveSeconds(data?.retryAfter) ??
    positiveSeconds(headerOf(failure.response?.headers, 'retry-after'))
  );
}

/**
 * The API answers every credential failure with one neutral sentence (so it
 * cannot be used to enumerate accounts); the page turns that into copy for a
 * person, with the reset path right there. Other statuses (unverified,
 * suspended, rate-limited) carry a message worth showing as-is.
 */
export function loginFailure(error: unknown, { online = true, fallback }: { online?: boolean; fallback: string }): LoginFailure {
  const failure = (error && typeof error === 'object' ? error : {}) as HttpFailure;
  const status = failure.response?.status;
  const data = failure.response?.data as { message?: unknown } | undefined;
  const message = typeof data?.message === 'string' ? data.message.trim() : '';

  if (online === false || failure.code === 'ERR_NETWORK' || (!status && failure.code === 'ECONNABORTED')) {
    return { text: OFFLINE_COPY, offerReset: false };
  }
  if (status === 429) {
    // The limiter's own text names no wait; the header does. Typed fields stay.
    const retryAfterSec = retryAfterSecondsOf(failure);
    return { text: rateLimitedCopy(retryAfterSec), offerReset: false, retryAfterSec };
  }
  if (status === 400 || status === 401) return { text: LOGIN_MISMATCH_COPY, offerReset: true };
  return { text: message || fallback, offerReset: false };
}

/** `?welcome=1` opens the first-run sheet on any signed-in page (deep link / QA); sign-up itself uses the sessionStorage marker in authDrafts.ts. */
export const WELCOME_PARAM = 'welcome';
