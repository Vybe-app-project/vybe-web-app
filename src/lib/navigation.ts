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
 *    immediately); the shell highlights that destination and shows a progress
 *    bar until the location catches up.
 *  - the preload registry: pages register their loader by path so the shell
 *    can warm a chunk on pointerdown/hover, and the tab roots while idle.
 */

type PendingState = {
  /** Path the user is navigating to, or null when the location has caught up. */
  pendingPath: string | null;
  startedAt: number;
  /** The page region is showing its skeleton because the route's code is still downloading. */
  chunkLoading: boolean;
  start: (path: string) => void;
  finish: () => void;
  setChunkLoading: (loading: boolean) => void;
};

export const usePendingNavigation = create<PendingState>((set) => ({
  pendingPath: null,
  startedAt: 0,
  chunkLoading: false,
  start: (path) => set({ pendingPath: path, startedAt: Date.now() }),
  finish: () => set((s) => (s.pendingPath === null ? s : { pendingPath: null, startedAt: 0 })),
  setChunkLoading: (chunkLoading) => set((s) => (s.chunkLoading === chunkLoading ? s : { chunkLoading })),
}));

/** True while any route-change feedback should be visible. */
export const selectNavigating = (s: PendingState): boolean => s.pendingPath !== null || s.chunkLoading;

/** Pathname part of a `to` value (drops ?query and #hash). */
export function pathOf(to: string): string {
  const q = to.indexOf('?');
  const h = to.indexOf('#');
  const end = Math.min(q === -1 ? to.length : q, h === -1 ? to.length : h);
  return to.slice(0, end) || '/';
}

type Loader = () => Promise<unknown>;
const loaders = new Map<string, Loader>();
const warmed = new Set<string>();

/** Register the chunk loader for a route path (exact pathname, e.g. '/meals'). */
export function registerPreload(path: string, loader: Loader): void {
  loaders.set(path, loader);
}

/**
 * Start downloading the chunk for a path. Safe to call repeatedly: each
 * loader runs once, and a failure is swallowed so a hover can never surface
 * an error (the real navigation will report it).
 */
export function preload(to: string): void {
  const path = pathOf(to);
  const loader = loaders.get(path);
  if (!loader || warmed.has(path)) return;
  warmed.add(path);
  loader().catch(() => warmed.delete(path));
}

export function isPreloaded(to: string): boolean {
  return warmed.has(pathOf(to));
}

/** Test seam. */
export function resetPreloads(): void {
  loaders.clear();
  warmed.clear();
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
