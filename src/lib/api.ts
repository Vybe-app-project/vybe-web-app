import axios, { AxiosError } from 'axios';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export const ORIGIN_BASE = API_BASE.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'vybe.token';
const ADMIN_TOKEN_KEY = 'vybe.adminToken';
// A minimal copy of the signed-in user (id, username, name, avatar) kept
// beside the token so the shell can paint offline. Never anything sensitive.
const USER_SNAPSHOT_KEY = 'vybe.user';
const SIGN_OUT_REASON_KEY = 'vybe.signOutReason';

// Consumer sessions live in localStorage so the installed PWA survives a
// relaunch. Admin sessions live in sessionStorage: they end with the tab,
// which is the right lifetime for a moderation console that shares its origin
// with the consumer app and is used from shared machines. The previous
// console kept the admin token in localStorage; any such token is dropped
// rather than migrated so it cannot outlive this change.
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

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    safe(() => localStorage.removeItem(USER_SNAPSHOT_KEY), undefined);
  },
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
  if (t) config.headers.Authorization = `Bearer ${t}`;
  config.headers['X-Platform'] = 'web';
  return config;
});

adminApi.interceptors.request.use((config) => {
  const t = tokenStore.getAdmin();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  config.headers['X-Platform'] = 'web';
  return config;
});

/**
 * The API answers 401 when this session was revoked: a password change,
 * "Sign out of all devices" on another device, or plain expiry. The bounce to
 * /login used to be silent; the reason travels with it so the sign-in page
 * can say what happened instead of just "Welcome back".
 */
function onUnauthorized(kind: 'user' | 'admin') {
  if (kind === 'admin') {
    tokenStore.clearAdmin();
    if (!location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
  } else {
    const hadSession = !!tokenStore.get();
    tokenStore.clear();
    if (!location.pathname.startsWith('/login')) {
      if (hadSession) signOutReason.set('session-ended');
      location.href = '/login';
    }
  }
}

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401) onUnauthorized('user');
    return Promise.reject(err);
  },
);
adminApi.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401) onUnauthorized('admin');
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

/** Resolve possibly-relative media paths returned by the API. */
export function mediaUrl(u?: string | null): string {
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
  return `${ORIGIN_BASE}${u.startsWith('/') ? '' : '/'}${u}`;
}
