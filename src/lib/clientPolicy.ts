/**
 * What the API client tells the rest of the app about the server's policy
 * answers, without either side importing the other:
 *
 *  - the 426 latch: one `CLIENT_UPDATE_REQUIRED` answer and the app shows the
 *    full-screen "Reload Vybe" prompt (components/UpdateRequiredScreen.tsx);
 *  - the rate-limit bus: every 429 is announced so one listener
 *    (components/ApiNotices.tsx) can toast it, except on the surfaces that
 *    show the error inline (sign-in, sign-up, password reset, support);
 *  - the reload guard: a page that reloads because of a 426 stamps
 *    sessionStorage, and a second 426 within a minute is shown, not
 *    auto-reloaded, so a floor above the newest build cannot loop a tab.
 *
 * api.ts writes here from its interceptors; components subscribe. Pattern of
 * the mobile app's src/store/clientPolicyLatch.ts.
 */
import { create } from 'zustand';

export const UPDATE_REQUIRED_STATUS = 426;
export const UPDATE_REQUIRED_CODE = 'CLIENT_UPDATE_REQUIRED';

export type UpdateRequiredNotice = {
  message: string | null;
  platform: string | null;
  minVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
  /** When the 426 arrived (this tab's clock). */
  at: number;
};

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** `true` for a 426 that carries the client-policy code; any other 426 is left to the caller. */
export function isUpdateRequiredResponse(status: unknown, body: unknown): boolean {
  if (status !== UPDATE_REQUIRED_STATUS) return false;
  const code = (body as { code?: unknown } | null | undefined)?.code;
  return code === UPDATE_REQUIRED_CODE;
}

/** Shape a 426 body into a notice; every field but `at` may be null. */
export function noticeFrom(body: unknown, now: number = Date.now()): UpdateRequiredNotice {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return {
    message: text(record.message),
    platform: text(record.platform),
    minVersion: text(record.minVersion),
    latestVersion: text(record.latestVersion),
    storeUrl: text(record.storeUrl),
    at: now,
  };
}

type ClientPolicyState = {
  updateRequired: UpdateRequiredNotice | null;
  /** Record a 426. A repeat refreshes the details; subscribers treat it as the same state. */
  noteUpdateRequired: (body: unknown) => UpdateRequiredNotice;
  clear: () => void;
};

export const useClientPolicy = create<ClientPolicyState>((set) => ({
  updateRequired: null,
  noteUpdateRequired: (body) => {
    const notice = noticeFrom(body);
    set({ updateRequired: notice });
    return notice;
  },
  clear: () => set({ updateRequired: null }),
}));

/* ------------------------------------------------------------------ 429 bus */

export type RateLimitedEvent = {
  /** The request path as axios saw it (relative to the API base). */
  url: string;
  retryAfterSec: number | null;
  at: number;
};

type RateLimitedListener = (event: RateLimitedEvent) => void;
const rateLimitedListeners = new Set<RateLimitedListener>();

/** Subscribe to every 429 the API client sees. Returns the unsubscribe. */
export function onRateLimited(listener: RateLimitedListener): () => void {
  rateLimitedListeners.add(listener);
  return () => {
    rateLimitedListeners.delete(listener);
  };
}

export function emitRateLimited(event: RateLimitedEvent): void {
  for (const listener of rateLimitedListeners) {
    try {
      listener(event);
    } catch {
      // One listener must not stop the others.
    }
  }
}

/**
 * Surfaces whose forms show the error next to the button; a toast on top
 * would say the same thing twice. Matched on the API path, with or without
 * the /api prefix or an origin.
 */
const INLINE_ERROR_PREFIXES = ['/auth/', '/admins/login', '/admins/request-reset', '/admins/reset-password', '/support/message'];

const apiPathOf = (url: string): string => {
  let path = url.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return path;
    }
  }
  path = path.split(/[?#]/)[0];
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/^\/api(?=\/|$)/, '');
};

export function isInlineErrorSurface(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url) return false;
  const path = apiPathOf(url);
  return INLINE_ERROR_PREFIXES.some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)));
}

/* ------------------------------------------------------------------ reload guard */

export const RELOAD_GUARD_KEY = 'vybe.reload426At';
/** Two 426 reloads closer than this are a loop, not an update. */
export const RELOAD_GUARD_MS = 60_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
};

/** False within a minute of the last 426 reload in this tab; true otherwise (and when storage is unavailable). */
export function shouldAutoReload(now: number = Date.now(), storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(RELOAD_GUARD_KEY);
    const last = raw ? Number(raw) : NaN;
    if (!Number.isFinite(last)) return true;
    return now - last >= RELOAD_GUARD_MS || now < last - RELOAD_GUARD_MS;
  } catch {
    return true;
  }
}

export function stampReload(now: number = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // Privacy mode: the guard is best effort.
  }
}

const CONTROLLER_CHANGE_WAIT_MS = 2_000;

/**
 * Reload onto the newest build. The service worker (vite.config.ts:
 * registerType 'prompt', skipWaiting false) may be holding the new shell as
 * a waiting worker, and a bare location.reload() would serve the precached
 * old one again, so the registrations are updated and any waiting worker is
 * told to take over first, with a bounded wait for the controller change.
 */
export async function reloadForUpdate(): Promise<void> {
  stampReload();
  try {
    const container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (container && typeof container.getRegistrations === 'function') {
      const registrations = await container.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
      const waiting = registrations.map((registration) => registration.waiting).filter((worker): worker is ServiceWorker => Boolean(worker));
      if (waiting.length) {
        const changed = new Promise<void>((resolve) => {
          const done = () => {
            container.removeEventListener('controllerchange', done);
            resolve();
          };
          container.addEventListener('controllerchange', done);
          setTimeout(done, CONTROLLER_CHANGE_WAIT_MS);
        });
        for (const worker of waiting) worker.postMessage({ type: 'SKIP_WAITING' });
        await changed;
      }
    }
  } catch {
    // The reload below is the point; the worker dance is best effort.
  }
  if (typeof location !== 'undefined') location.reload();
}
