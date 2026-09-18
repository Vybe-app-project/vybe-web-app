import { createElement, lazy, useState, type ComponentType } from 'react';
import { create } from 'zustand';

/**
 * Route-change feedback for a code-split app.
 *
 * <BrowserRouter> commits every location change inside React.startTransition.
 * When the destination page's chunk is still downloading, React keeps the
 * previous page on screen — the URL flips, but the heading, the active tab
 * and the content do not move until the chunk arrives (2–3 s on a slow
 * connection). Nothing tells the user their tap registered.
 *
 * Two pieces close that gap:
 *  - the pending store: a nav control records where it is taking the user the
 *    moment it is activated (a normal, non-transition update, so it commits
 *    immediately); the shell highlights that destination at once and, past a
 *    short grace period, shows its chrome, a skeleton and a progress bar until
 *    the location catches up.
 *  - the preload registry: pages register their loader by path so the shell
 *    can warm a chunk on pointerdown/hover, and the tab roots while idle; a
 *    warmed page (lazyPage) renders without suspending.
 */

/**
 * How long a navigation may hold the previous page before the shell switches
 * to the destination's chrome, a skeleton and the progress bar. A chunk that
 * comes from the service worker or the HTTP cache lands well inside this, so
 * the common case never flashes anything; a real download shows feedback at
 * once after it.
 */
export const NAV_GRACE_MS = 150;

type PendingState = {
  /** Path the user is navigating to, or null when the location has caught up. */
  pendingPath: string | null;
  startedAt: number;
  /** The grace period has passed with the location still not caught up. */
  slow: boolean;
  /** A hard load's page region is showing its skeleton because the route's code is still downloading. */
  chunkLoading: boolean;
  start: (path: string) => void;
  finish: () => void;
  setChunkLoading: (loading: boolean) => void;
};

let graceTimer: ReturnType<typeof setTimeout> | null = null;
const clearGrace = () => {
  if (graceTimer !== null) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
};

export const usePendingNavigation = create<PendingState>((set) => ({
  pendingPath: null,
  startedAt: 0,
  slow: false,
  chunkLoading: false,
  start: (path) => {
    clearGrace();
    graceTimer = setTimeout(() => {
      graceTimer = null;
      set((s) => (s.pendingPath === path ? { slow: true } : s));
    }, NAV_GRACE_MS);
    set({ pendingPath: path, startedAt: Date.now(), slow: false });
  },
  finish: () => {
    clearGrace();
    set((s) => (s.pendingPath === null && !s.slow ? s : { pendingPath: null, startedAt: 0, slow: false }));
  },
  setChunkLoading: (chunkLoading) => set((s) => (s.chunkLoading === chunkLoading ? s : { chunkLoading })),
}));

/** True while route-change feedback (the progress bar) should be visible: a slow navigation, or a hard load still downloading its chunk. */
export const selectNavigating = (s: PendingState): boolean => s.slow || s.chunkLoading;

/** Pathname part of a `to` value (drops ?query and #hash). */
export function pathOf(to: string): string {
  const q = to.indexOf('?');
  const h = to.indexOf('#');
  const end = Math.min(q === -1 ? to.length : q, h === -1 ? to.length : h);
  return to.slice(0, end) || '/';
}

type Loader = () => Promise<unknown>;
const loaders = new Map<string, Loader>();
const inflight = new Map<string, Promise<void>>();

/** Register the chunk loader for a route path (exact pathname, e.g. '/meals'). */
export function registerPreload(path: string, loader: Loader): void {
  loaders.set(path, loader);
}

/**
 * Start downloading the chunk for a path. Safe to call repeatedly: each
 * loader runs once, and a failure is swallowed so a hover can never surface
 * an error (the real navigation will report it). Resolves when the chunk is
 * in memory; an unregistered path resolves at once.
 */
export function preload(to: string): Promise<void> {
  const path = pathOf(to);
  const loader = loaders.get(path);
  if (!loader) return Promise.resolve();
  const existing = inflight.get(path);
  if (existing) return existing;
  const p = loader().then(
    () => undefined,
    () => {
      inflight.delete(path); // a failed download may be retried on the next intent
    },
  );
  inflight.set(path, p);
  return p;
}

export function isPreloaded(to: string): boolean {
  return inflight.has(pathOf(to));
}

/** Test seam. */
export function resetPreloads(): void {
  loaders.clear();
  inflight.clear();
}

type PageModule<P> = { default: ComponentType<P> };

/**
 * A code-split page whose chunk can be warmed ahead of the navigation.
 *
 * React.lazy owns its own import() promise. Warming the module graph with a
 * separate import() leaves lazy's first render suspending on a promise of its
 * own, and because the page region's Suspense boundary is fresh for every
 * route React commits the skeleton at once and then holds it for its 300 ms
 * fallback throttle: a flash on every first visit to a section even with the
 * chunk already downloaded. Here the registry owns the promise instead. Once
 * it has resolved, the page renders the real component synchronously and
 * never suspends; only a chunk that is still downloading goes through lazy,
 * which is exactly when the skeleton and progress bar should show.
 *
 * `path` registers the loader for intent/idle preloads; pass null for detail
 * pages that are only reached through in-page links.
 */
export function lazyPage<P extends object>(path: string | null, load: () => Promise<PageModule<P>>): ComponentType<P> {
  let chunk: Promise<PageModule<P>> | null = null;
  let Ready: ComponentType<P> | null = null;
  const fetchChunk = (): Promise<PageModule<P>> => {
    if (!chunk) {
      chunk = load().then((mod) => {
        Ready = mod.default;
        return mod;
      });
      chunk.catch(() => {
        chunk = null; // let the next intent or mount try the download again
      });
    }
    return chunk;
  };
  const Lazy = lazy(fetchChunk);
  function Page(props: P) {
    // Decided once per mount: a chunk landing mid-life must not swap the
    // element type underneath a page that is already showing (a remount).
    const [Direct] = useState(() => Ready);
    return Direct ? createElement(Direct, props) : createElement(Lazy, props);
  }
  Page.displayName = `Page(${path ?? 'detail'})`;
  if (path) registerPreload(path, fetchChunk);
  return Page;
}

/**
 * Warm the given paths when the browser is idle. Skipped when the user asked
 * to save data; on such connections a tap-time preload is the better trade.
 */
export function preloadWhenIdle(paths: string[]): () => void {
  if (typeof window === 'undefined') return () => {};
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => {};
  const run = () => paths.forEach(preload);
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(run, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}
