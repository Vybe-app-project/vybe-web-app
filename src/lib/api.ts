import axios, { AxiosError } from 'axios';
import { sessionExpiredLoginUrl } from './authRedirect';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export const ORIGIN_BASE = API_BASE.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'vybe.token';
const ADMIN_TOKEN_KEY = 'vybe.adminToken';

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
  },
  /** Which store currently holds the session, for anything that re-issues it. */
  persistence: (): SessionPersistence | null =>
    readStorage(localStorage, TOKEN_KEY) ? 'local' : readStorage(sessionStorage, TOKEN_KEY) ? 'session' : null,
  getAdmin: () => sessionStorage.getItem(ADMIN_TOKEN_KEY),
  setAdmin: (t: string) => sessionStorage.setItem(ADMIN_TOKEN_KEY, t),
  clearAdmin: () => sessionStorage.removeItem(ADMIN_TOKEN_KEY),
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

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

/**
 * Session-version invalidation: the API revokes tokens on password change,
 * sign-out on another device, or the 30-day expiry. This runs outside React
 * and the token is already gone, so it is a hard navigation; the path the
 * person was on travels in `?next=` and `?expired=1` tells the sign-in page
 * to say why they are there (it used to bounce to a bare /login and drop the
 * RequireAuth `from` state on the floor).
 */
function onUnauthorized(kind: 'user' | 'admin') {
  if (kind === 'admin') {
    tokenStore.clearAdmin();
    if (!location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
  } else {
    tokenStore.clear();
    if (!AUTH_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))) {
      location.href = sessionExpiredLoginUrl(location.pathname, location.search);
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
