/**
 * For you impressions (P8c). The ranker excludes what it already showed a
 * viewer for `seenExclusionDays` — but only from sightings the device posts
 * to `POST /feed/impressions`. Until this module, nothing did, so For you
 * re-ranked the same posts every session.
 *
 * "Seen" is a card at least half on screen (or covering half the viewport,
 * for a card taller than it) for one second, measured by one
 * IntersectionObserver per feed. Sightings queue and go as one batch every
 * IMPRESSION_FLUSH_MS or at IMPRESSION_FLUSH_MAX ids, and at once with
 * `keepalive` when the page hides. One tab posts a post id once (the session
 * set), a failed batch is retried once and then dropped, and the first
 * `404 FEATURE_DISABLED` stops posting for the rest of the session. Nothing
 * here is shown to anyone: no toast, no error state.
 *
 * Only For you posts. Latest is never logged — the server would drop the
 * rows anyway (`models/FeedImpression.js MODES`), so posting them would be
 * traffic that records nothing. The caller enables the hook for the mode
 * the server said it served, not the one that was asked for.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  IMPRESSION_DWELL_MS,
  IMPRESSION_FLUSH_MAX,
  IMPRESSION_FLUSH_MS,
  IMPRESSION_VISIBLE_RATIO,
  isFeatureDisabled,
  recordImpressions,
  recordImpressionsKeepalive,
  type FeedImpression,
} from './feedControls';

/* ------------------------------------------------------------------ the queue */

/** What one tab remembers across Home mounts: ids already posted, and whether the server refused the surface. */
export type ImpressionSession = { seen: Set<string>; disabled: boolean };

export const newImpressionSession = (): ImpressionSession => ({ seen: new Set<string>(), disabled: false });

const SESSION = newImpressionSession();

export type ImpressionQueueOptions = {
  /** The client's POST; rejects on any non-2xx. */
  send: (items: FeedImpression[]) => Promise<unknown>;
  /** The keepalive POST for pagehide; never awaited. */
  sendKeepalive: (items: FeedImpression[]) => void;
  session?: ImpressionSession;
  maxBatch?: number;
  flushMs?: number;
  /** The pause before the one retry. */
  retryMs?: number;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  wait?: (ms: number) => Promise<void>;
};

export type ImpressionQueue = {
  /** Queue one sighting; false when the id was already posted this session or the surface is off. */
  add: (postId: string, reqId?: string) => boolean;
  /** Send what is queued now. Returns how many sightings left the queue. */
  flush: (options?: { keepalive?: boolean }) => Promise<number>;
  pending: () => number;
  /** Drop the timer without sending (unmount without a flush). */
  stop: () => void;
};

export function createImpressionQueue({
  send,
  sendKeepalive,
  session = SESSION,
  maxBatch = IMPRESSION_FLUSH_MAX,
  flushMs = IMPRESSION_FLUSH_MS,
  retryMs = 1_500,
  now = () => new Date(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: ImpressionQueueOptions): ImpressionQueue {
  let pending: FeedImpression[] = [];
  let timer: unknown = null;

  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  /** One attempt, one retry after a pause, then silence. A refused surface ends the session's posting. */
  const deliver = async (batch: FeedImpression[]) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (session.disabled) return;
      try {
        await send(batch);
        return;
      } catch (e) {
        if (isFeatureDisabled(e)) {
          session.disabled = true;
          return;
        }
        if (attempt === 0) await wait(retryMs);
      }
    }
  };

  const flush = async ({ keepalive = false } = {}) => {
    stop();
    if (session.disabled) {
      pending = [];
      return 0;
    }
    if (!pending.length) return 0;
    const batch = pending;
    pending = [];
    if (keepalive) sendKeepalive(batch);
    else await deliver(batch);
    return batch.length;
  };

  const add = (postId: string, reqId?: string) => {
    if (session.disabled || !postId || session.seen.has(postId)) return false;
    session.seen.add(postId);
    pending.push({ post: postId, mode: 'foryou', ...(reqId ? { reqId } : {}), seenAt: now().toISOString() });
    if (pending.length >= maxBatch) {
      void flush();
    } else if (timer === null) {
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, flushMs);
    }
    return true;
  };

  return { add, flush, pending: () => pending.length, stop };
}

/* ------------------------------------------------------------------ "seen" */

export type SeenEntryLike = {
  isIntersecting: boolean;
  intersectionRatio: number;
  intersectionRect?: { height: number } | null;
  rootBounds?: { height: number } | null;
};

/**
 * Half the card on screen — or, for a card taller than the viewport, which
 * can never show half of itself, half the viewport covered by it. Observed
 * at thresholds 0 · 0.1 · 0.25 · 0.5 so the tall case still gets a callback.
 */
export const SEEN_THRESHOLDS: readonly number[] = [0, 0.1, 0.25, 0.5];

export function isSeenEntry(entry: SeenEntryLike, ratio = IMPRESSION_VISIBLE_RATIO): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= ratio) return true;
  const root = entry.rootBounds?.height ?? 0;
  const shown = entry.intersectionRect?.height ?? 0;
  return root > 0 && shown >= root * ratio;
}

/* ------------------------------------------------------------------ the hook */

type Watched = { postId: string };

/**
 * `refFor(postId, reqId)` gives a stable callback ref for a card's root; the
 * feed passes it to the card while For you is the served mode. One observer
 * watches every registered root, a one-second dwell turns a sighting into a
 * queued impression, and the queue flushes on its own clock, on pagehide
 * and when the hook is disabled (a mode switch, leaving Home).
 */
export function useFeedImpressions(enabled: boolean): { refFor: (postId: string, reqId?: string) => (node: HTMLElement | null) => void } {
  const registry = useRef(new Map<Element, Watched>());
  const reqIds = useRef(new Map<string, string | undefined>());
  const callbacks = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const timers = useRef(new Map<Element, ReturnType<typeof setTimeout>>());
  const observer = useRef<IntersectionObserver | null>(null);
  const queue = useRef<ImpressionQueue | null>(null);
  if (!queue.current) {
    queue.current = createImpressionQueue({ send: recordImpressions, sendKeepalive: recordImpressionsKeepalive, session: SESSION });
  }

  const unwatch = useCallback((el: Element) => {
    observer.current?.unobserve(el);
    const t = timers.current.get(el);
    if (t) clearTimeout(t);
    timers.current.delete(el);
    registry.current.delete(el);
  }, []);

  const refFor = useCallback(
    (postId: string, reqId?: string) => {
      reqIds.current.set(postId, reqId);
      let cb = callbacks.current.get(postId);
      if (!cb) {
        cb = (node: HTMLElement | null) => {
          for (const [el, meta] of registry.current) if (meta.postId === postId) unwatch(el);
          // A post this tab already posted needs no second watch.
          if (!node || SESSION.seen.has(postId)) return;
          registry.current.set(node, { postId });
          observer.current?.observe(node);
        };
        callbacks.current.set(postId, cb);
      }
      return cb;
    },
    [unwatch],
  );

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const q = queue.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (isSeenEntry(entry)) {
            if (!timers.current.has(el)) {
              timers.current.set(
                el,
                setTimeout(() => {
                  timers.current.delete(el);
                  const meta = registry.current.get(el);
                  if (meta) q?.add(meta.postId, reqIds.current.get(meta.postId));
                  io.unobserve(el);
                }, IMPRESSION_DWELL_MS),
              );
            }
          } else {
            const t = timers.current.get(el);
            if (t) {
              clearTimeout(t);
              timers.current.delete(el);
            }
          }
        }
      },
      { threshold: [...SEEN_THRESHOLDS] },
    );
    observer.current = io;
    for (const el of registry.current.keys()) io.observe(el);

    // The document is going away or being hidden: what was seen leaves now, on a request the browser keeps alive.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void q?.flush({ keepalive: true });
    };
    const onPageHide = () => void q?.flush({ keepalive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      io.disconnect();
      observer.current = null;
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
      // Leaving For you: the page is still here, so the client's own POST does.
      void q?.flush();
    };
  }, [enabled]);

  return { refFor };
}
