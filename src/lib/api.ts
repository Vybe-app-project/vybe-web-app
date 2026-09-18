import axios, { AxiosError } from 'axios';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export const ORIGIN_BASE = API_BASE.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'vybe.token';
const ADMIN_TOKEN_KEY = 'vybe.adminToken';

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

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
  getAdmin: () => sessionStorage.getItem(ADMIN_TOKEN_KEY),
  setAdmin: (t: string) => sessionStorage.setItem(ADMIN_TOKEN_KEY, t),
  clearAdmin: () => sessionStorage.removeItem(ADMIN_TOKEN_KEY),
};

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

/** Session-version invalidation: the API revokes tokens on password change. */
function onUnauthorized(kind: 'user' | 'admin') {
  if (kind === 'admin') {
    tokenStore.clearAdmin();
    if (!location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
  } else {
    tokenStore.clear();
    if (!location.pathname.startsWith('/login')) location.href = '/login';
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
