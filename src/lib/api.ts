import axios, { AxiosError } from 'axios';
import { invalidateWorkoutDrafts } from './workoutDrafts';
import { sessionExpiredLoginUrl } from './authRedirect';
import {
  CONSUMER_TOKEN_KEY as TOKEN_KEY, readConsumerSession, readConsumerToken,
  readVerifiedConsumerToken, notifySessionChange, sessionEpoch, type SessionPersistence,
} from './consumerSession';
export type { SessionPersistence } from './consumerSession';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** The auth store handles the result and lets route guards navigate. */
    sessionVerification?: boolean;
    workoutSessionToken?: string;
    sessionEpoch?: number;
    sessionToken?: string | null;
  }
}

export const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) || '/api';

export const ORIGIN_BASE = API_BASE.replace(/\/api\/?$/, '');

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

export type UserSnapshot = { _id: string; username: string; fullName?: string; avatar?: string };

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const fingerprint = async (token: string) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const tokenStore = {
  get: readConsumerToken,
  /** Exactly one store holds the token, so switching persistence cannot leave a copy behind. */
  set: (t: string, persistence: SessionPersistence = 'local') => {
    const [target, other] = persistence === 'session' ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
    invalidateWorkoutDrafts();
    try {
      localStorage.removeItem(USER_SNAPSHOT_KEY);
      sessionStorage.removeItem(USER_SNAPSHOT_KEY);
      target.setItem(TOKEN_KEY, t);
      other.removeItem(TOKEN_KEY);
    } finally { notifySessionChange(); }
  },
  clear: (rejected = false) => {
    invalidateWorkoutDrafts();
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_SNAPSHOT_KEY);
      sessionStorage.removeItem(USER_SNAPSHOT_KEY);
    } finally { notifySessionChange('user', rejected); }
  },
  /** Which store currently holds the session, for anything that re-issues it. */
  persistence: (): SessionPersistence | null =>
    readConsumerSession()?.persistence ?? null,
  getAdmin: () => sessionStorage.getItem(ADMIN_TOKEN_KEY),
  setAdmin: (t: string) => { sessionStorage.setItem(ADMIN_TOKEN_KEY, t); notifySessionChange('admin'); },
  clearAdmin: () => { sessionStorage.removeItem(ADMIN_TOKEN_KEY); notifySessionChange('admin'); },
  getUser: async (): Promise<UserSnapshot | null> => {
    const session = readConsumerSession();
    const epoch = sessionEpoch();
    if (!session) return null;
    try {
      const storage = session.persistence === 'local' ? localStorage : sessionStorage;
      const parsed = JSON.parse(storage.getItem(USER_SNAPSHOT_KEY) ?? 'null');
      if (parsed?.sessionHash !== await fingerprint(session.token) || epoch !== sessionEpoch()
          || tokenStore.get() !== session.token || tokenStore.persistence() !== session.persistence) return null;
      const u = parsed.user;
      return u && typeof u._id === 'string' && typeof u.username === 'string'
        ? { _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar } : null;
    } catch { return null; }
  },
  setUser: async (u: UserSnapshot, token = readConsumerToken()) => {
    const session = readConsumerSession();
    const epoch = sessionEpoch();
    if (!session || token !== session.token) return;
    try {
      const sessionHash = await fingerprint(token);
      if (epoch !== sessionEpoch() || tokenStore.get() !== token || tokenStore.persistence() !== session.persistence) return;
      const storage = session.persistence === 'local' ? localStorage : sessionStorage;
      storage.setItem(USER_SNAPSHOT_KEY, JSON.stringify({
        sessionHash, user: { _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar } satisfies UserSnapshot,
      }));
    } catch { /* Missing snapshot support leaves explicit recovery, never a fabricated identity. */ }
  },
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
      headers: { Authorization: `Bearer ${token}`, 'X-Platform': 'web', 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  } catch {
    // fetch itself can throw synchronously in exotic embeds; still sign out.
  }
}

export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });
export const adminApi = axios.create({ baseURL: API_BASE, timeout: 30000 });

api.interceptors.request.use((config) => {
  const t = tokenStore.get();
  if ('workoutSessionToken' in config && (!config.workoutSessionToken || config.workoutSessionToken !== t || readVerifiedConsumerToken() !== t)) {
    throw new Error('Your account changed. This workout request was not sent.');
  }
  config.sessionEpoch = sessionEpoch();
  config.sessionToken = t;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  config.headers['X-Platform'] = 'web';
  return config;
}, error => { throw error; }, { synchronous: true });

adminApi.interceptors.request.use((config) => {
  const t = tokenStore.getAdmin();
  config.sessionEpoch = sessionEpoch('admin');
  config.sessionToken = t;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  config.headers['X-Platform'] = 'web';
  return config;
}, error => { throw error; }, { synchronous: true });

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];
const PUBLIC_AUTH_ENDPOINTS = new Set([
  '/auth/login', '/auth/register-password', '/auth/sendEmailOtp', '/auth/verifyEmailOtp',
  '/auth/request-reset', '/auth/reset-password', '/admins/login', '/admins/request-reset', '/admins/reset-password',
]);
export function isSessionRejected(error: unknown): boolean {
  const response = (error as AxiosError<{ message?: string }> | undefined)?.response;
  return response?.status === 401 || (response?.status === 403 && [
    'This account is currently unavailable', 'Email verification is required',
  ].includes(response.data?.message ?? ''));
}

function onUnauthorized(kind: 'user' | 'admin', authorization: unknown, redirect: boolean) {
  const current = kind === 'admin' ? tokenStore.getAdmin() : tokenStore.get();
  // An old request must not invalidate a newer sign-in, or treat a failed
  // public login attempt as an expired authenticated session.
  if (!current || authorization !== `Bearer ${current}`) return;
  if (kind === 'admin') {
    tokenStore.clearAdmin();
    if (redirect && !location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
  } else {
    signOutReason.set('session-ended');
    tokenStore.clear(true);
    if (redirect && !AUTH_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))) {
      location.href = sessionExpiredLoginUrl(location.pathname, location.search ?? '');
    }
  }
}

api.interceptors.response.use(
  (r) => {
    if (r.config.sessionEpoch !== sessionEpoch() || r.config.sessionToken !== tokenStore.get()) throw new Error('Your account changed. This response was ignored.');
    return r;
  },
  (err: AxiosError) => {
    if (!PUBLIC_AUTH_ENDPOINTS.has(err.config?.url ?? '') && err.config?.sessionEpoch === sessionEpoch() && isSessionRejected(err)) onUnauthorized('user', err.config?.headers.get('Authorization'), !err.config?.sessionVerification);
    return Promise.reject(err);
  },
);
adminApi.interceptors.response.use(
  (r) => {
    if (r.config.sessionEpoch !== sessionEpoch('admin') || r.config.sessionToken !== tokenStore.getAdmin()) throw new Error('Your administrator account changed. This response was ignored.');
    return r;
  },
  (err: AxiosError) => {
    if (!PUBLIC_AUTH_ENDPOINTS.has(err.config?.url ?? '') && err.config?.sessionEpoch === sessionEpoch('admin') && err.response?.status === 401) onUnauthorized('admin', err.config?.headers.get('Authorization'), !err.config?.sessionVerification);
    return Promise.reject(err);
  },
);

export function errMsg(e: unknown, fallback = 'Something went wrong'): string {
  const ax = e as AxiosError<{ message?: string; error?: string; errors?: any[] }>;
  const d = ax?.response?.data as any;
  if (d?.message) return d.message;
  if (d?.error) return d.error;
  if (Array.isArray(d?.errors) && d.errors[0]?.msg) return d.errors[0].msg;
  if (ax?.message) return ax.message;
  return fallback;
}

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
