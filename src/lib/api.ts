import axios, { AxiosError, type AxiosInstance } from 'axios';
import { sessionExpiredLoginUrl } from './authRedirect';
import { parseApiError, rateLimitedCopy } from './apiError';
import { webBuildToken, webClientHeader } from './clientHeader';
import { emitRateLimited, isUpdateRequiredResponse, useClientPolicy } from './clientPolicy';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export const ORIGIN_BASE = API_BASE.replace(/\/api\/?$/, '');

/**
 * Build identity. VITE_WEB_VERSION and VITE_WEB_BUILT_AT are defined by
 * vite.config.ts from package.json and the build clock; VITE_WEB_BUILD is the
 * deployed commit sha the release passes in (Dockerfile.release build arg).
 * Read property by property so Vite can inline each one.
 */
const BUILD_ENV = {
  VITE_WEB_VERSION: import.meta.env.VITE_WEB_VERSION as string | undefined,
  VITE_WEB_BUILD: import.meta.env.VITE_WEB_BUILD as string | undefined,
  VITE_WEB_BUILT_AT: import.meta.env.VITE_WEB_BUILT_AT as string | undefined,
};
export const WEB_VERSION: string | null = BUILD_ENV.VITE_WEB_VERSION || null;
export const WEB_BUILD: string | null = webBuildToken(BUILD_ENV);
/** `web/<version>+<build>`: what every request says about this bundle (services/clientPolicy.js). */
export const CLIENT_HEADER_VALUE = webClientHeader(BUILD_ENV);

/** The identity headers for a raw fetch that bypasses the axios instances. */
export function clientHeaders(): Record<string, string> {
  return { 'X-Vybe-Client': CLIENT_HEADER_VALUE, 'X-Platform': 'web' };
}

const TOKEN_KEY = 'vybe.token';
const ADMIN_TOKEN_KEY = 'vybe.adminToken';
// A minimal copy of the signed-in user (id, username, name, avatar) kept
// beside the token so the shell can paint offline. Never anything sensitive.
const USER_SNAPSHOT_KEY = 'vybe.user';
const SIGN_OUT_REASON_KEY = 'vybe.signOutReason';

// Consumer sessions live in localStorage so the installed PWA survives a
// relaunch -- unless the person unticks "Keep me signed in", in which case
// the token goes to sessionStorage and ends with the tab (a shared or public
// computer should not carry a 30-day session). Admin sessions always live in
// sessionStorage: they end with the tab, which is the right lifetime for a
// moderation console that shares its origin with the consumer app and is
// used from shared machines. The previous console kept the admin token in
// localStorage; any such token is dropped rather than migrated so it cannot
// outlive this change.
try {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
} catch {
  // Storage can be unavailable (privacy mode); nothing to clean up then.
}

export type SessionPersistence = 'local' | 'session';
export type UserSnapshot = { _id: string; username: string; fullName?: string; avatar?: string };

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const readStorage = (storage: Storage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const tokenStore = {
  get: () => readStorage(localStorage, TOKEN_KEY) ?? readStorage(sessionStorage, TOKEN_KEY),
  /** Exactly one store holds the token, so switching persistence cannot leave a copy behind. */
  set: (t: string, persistence: SessionPersistence = 'local') => {
    const [target, other] = persistence === 'session' ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
    target.setItem(TOKEN_KEY, t);
    other.removeItem(TOKEN_KEY);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    safe(() => localStorage.removeItem(USER_SNAPSHOT_KEY), undefined);
  },
  /** Which store currently holds the session, for anything that re-issues it. */
  persistence: (): SessionPersistence | null =>
    readStorage(localStorage, TOKEN_KEY) ? 'local' : readStorage(sessionStorage, TOKEN_KEY) ? 'session' : null,
  getAdmin: () => sessionStorage.getItem(ADMIN_TOKEN_KEY),
  setAdmin: (t: string) => sessionStorage.setItem(ADMIN_TOKEN_KEY, t),
  clearAdmin: () => sessionStorage.removeItem(ADMIN_TOKEN_KEY),
  getUser: (): UserSnapshot | null =>
    safe(() => {
      const raw = localStorage.getItem(USER_SNAPSHOT_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<UserSnapshot>) : null;
      return parsed && typeof parsed._id === 'string' && typeof parsed.username === 'string' ? (parsed as UserSnapshot) : null;
    }, null),
  setUser: (u: { _id: string; username: string; fullName?: string; avatar?: string }) =>
    safe(
      () =>
        localStorage.setItem(
          USER_SNAPSHOT_KEY,
          JSON.stringify({ _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar } satisfies UserSnapshot),
        ),
      undefined,
    ),
};

/**
 * Why the last session ended, for the sign-in page to explain. Set right
 * before the hard redirect below and read once by Login; sessionStorage so it
 * survives the navigation and nothing else.
 */
export type SignOutReason = 'session-ended' | 'signed-out-all';
export const signOutReason = {
  set: (reason: SignOutReason) => safe(() => sessionStorage.setItem(SIGN_OUT_REASON_KEY, reason), undefined),
  take: (): SignOutReason | null =>
    safe(() => {
      const value = sessionStorage.getItem(SIGN_OUT_REASON_KEY);
      sessionStorage.removeItem(SIGN_OUT_REASON_KEY);
      return value === 'session-ended' || value === 'signed-out-all' ? value : null;
    }, null),
};

/**
 * Revoke a bearer token on the server as the user signs out.
 *
 * Two things made the obvious `api.post('/auth/logout')` a no-op: the axios
 * request interceptor reads the token store asynchronously, so clearing the
 * store on the next line sent the request unauthenticated; and the page then
 * navigates to /login, which aborts any in-flight XHR. This uses fetch with
 * `keepalive`, which the browser completes after navigation, and puts the
 * token on the request explicitly. Best-effort by design: signing out must
 * never be blocked by the network.
 */
export function revokeSession(path: string, token: string | null): void {
  if (!token) return;
  try {
    void fetch(`${API_BASE.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, ...clientHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  } catch {
    // fetch itself can throw synchronously in exotic embeds; still sign out.
  }
}

export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });
export const adminApi = axios.create({ baseURL: API_BASE, timeout: 30000 });

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

/**
 * Public pages that need no session and must stay put when a stale stored
 * token answers 401 (App's bootstrap GETs /users/me whenever a token is in
 * storage). The one-click unsubscribe landing is mid-POST with a single-use
 * token in its URL; a hard navigation would race that POST, copy the token
 * into /login?next=, and re-POST it after sign-in. The token store is still
 * cleared, useAuth settles to signed out, and the page offers sign-in itself.
 */
const NO_SESSION_PATHS = ['/unsubscribe', '/email/unsubscribe'];

const pathIsUnder = (pathname: string, paths: readonly string[]): boolean =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Session-version invalidation: the API revokes tokens on password change,
 * "Sign out of all devices" on another device, or the 30-day expiry. This
 * runs outside React and the token is already gone, so it is a hard
 * navigation; the path the person was on travels in `?next=`, `?expired=1`
 * tells the sign-in page to say why they are there, and signOutReason keeps
 * the finer reason for the same page (it used to bounce to a bare /login and
 * drop the RequireAuth `from` state on the floor).
 */
function onUnauthorized(kind: 'user' | 'admin') {
  if (kind === 'admin') {
    tokenStore.clearAdmin();
    if (!location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
  } else {
    const hadSession = !!tokenStore.get();
    tokenStore.clear();
    if (pathIsUnder(location.pathname, AUTH_PATHS)) return;
    if (hadSession) signOutReason.set('session-ended');
    // A no-session page keeps its URL; the reason waits for the sign-in link it offers.
    if (pathIsUnder(location.pathname, NO_SESSION_PATHS)) return;
    location.href = sessionExpiredLoginUrl(location.pathname, location.search);
  }
}

/**
 * The one set of interceptors every axios instance gets. `kind` picks the
 * token store and the 401 hand-off; null (the pre-token sign-up client) sends
 * the identity headers only. Response side: a 426 with CLIENT_UPDATE_REQUIRED
 * latches the reload prompt, a 429 is announced for the toast, a 401 ends the
 * session unless it is REAUTH_REQUIRED (a step-up prompt, not a lost session).
 * The error is always re-thrown so callers keep their own handling.
 */
export function installClientInterceptors(instance: AxiosInstance, kind: 'user' | 'admin' | null): void {
  instance.interceptors.request.use((config) => {
    const t = kind === 'admin' ? tokenStore.getAdmin() : kind === 'user' ? tokenStore.get() : null;
    if (t) config.headers.Authorization = `Bearer ${t}`;
    if (!config.headers.has('X-Vybe-Client')) config.headers.set('X-Vybe-Client', CLIENT_HEADER_VALUE);
    config.headers['X-Platform'] = 'web';
    return config;
  });
  instance.interceptors.response.use(
    (r) => r,
    (err: AxiosError) => {
      const status = err.response?.status;
      if (status === 426 && isUpdateRequiredResponse(status, err.response?.data)) {
        useClientPolicy.getState().noteUpdateRequired(err.response?.data);
      } else if (status === 429) {
        emitRateLimited({ url: err.config?.url ?? '', retryAfterSec: parseApiError(err).retryAfterSec, at: Date.now() });
      } else if (status === 401 && kind) {
        // 401 REAUTH_REQUIRED asks for a fresh X-Reauth token (the account
        // lifecycle and data-export routes), not a new session; only the
        // user client ever receives it.
        const code = (err.response?.data as { code?: string } | undefined)?.code;
        if (kind === 'admin') onUnauthorized('admin');
        else if (code !== 'REAUTH_REQUIRED') onUnauthorized('user');
      }
      return Promise.reject(err);
    },
  );
}

installClientInterceptors(api, 'user');
installClientInterceptors(adminApi, 'admin');

/**
 * Copy for a person from anything a request threw. Reads every API error
 * shape (src/lib/apiError.ts) and never returns axios's own text; a 429 is
 * one sentence naming the wait ("Too many attempts. Try again in about 12
 * minutes." on the auth routes, "You’re doing that too often. Try again
 * in about 12 minutes." elsewhere), a 5xx without copy is "Something went
 * wrong on our side."
 */
export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  return parseApiError(e, fallback).message;
}

export { parseApiError, rateLimitedCopy };
export type { ParsedApiError } from './apiError';

/** Per-field messages from a 400 (`{ errors: { username: '…' } }`), when the API sent them. */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  const d = (e as AxiosError<{ errors?: unknown }>)?.response?.data as { errors?: unknown } | undefined;
  const errors = d?.errors;
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return {};
  return Object.fromEntries(
    Object.entries(errors as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v),
  ) as Record<string, string>;
}

/** Resolve possibly-relative media paths returned by the API. */
export function mediaUrl(u?: string | null): string {
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
  return `${ORIGIN_BASE}${u.startsWith('/') ? '' : '/'}${u}`;
}
