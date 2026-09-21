/**
 * For you's two controls on a card (P8c): Not interested and Snooze, and the
 * rows they leave behind. Following is chronological and offers neither.
 *
 *   Not interested   POST /feed/posts/:postId/not-interested, undone by the
 *                    DELETE beside it. The card gives way to one 56 px
 *                    hairline row — "Hidden. You’ll see less like this." and
 *                    Undo — and the ranker shows less from that author and
 *                    those tags (`RULE.notInterested`).
 *   Snooze           POST /feed/users/:userId/snooze { days: 7 | 30 }, undone
 *                    by its DELETE. The server hides the author from every
 *                    mode, so every card of theirs on the page goes; the one
 *                    whose menu was used leaves the row.
 *
 * Both are optimistic: the cards leave before the server answers and come
 * back with a quiet toast if it refuses. The row itself never shifts what
 * is on screen — it is the same height whatever it replaced, and it settles
 * (the post leaves the cache, the row goes) only once its five seconds are up
 * AND it is off screen: below the viewport nothing visible moves, above it
 * scroll anchoring holds the view still, and on a browser without anchoring
 * it simply stays until Home refetches or the mode changes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SNOOZE_DAYS,
  markNotInterested,
  snoozeAuthor,
  undoNotInterested,
  unsnoozeAuthor,
  type FeedResponse,
  type SnoozeDays,
} from '../lib/feedControls';
import { displayName, type Post, type PublicUser } from '../lib/hooks';
import { Button, Modal, cx, useToast } from './ui';

export const HIDDEN_ROW_UNDO_MS = 5_000;

/** Every word the two controls show. Sentence case, curly apostrophes, no exclamation marks. */
export const forYouCopy = Object.freeze({
  notInterested: 'Not interested',
  notInterestedHint: 'See fewer posts like this',
  snooze: (handle: string) => `Snooze ${handle}`,
  snoozeHint: 'Hide their posts for a while',
  hiddenRow: 'Hidden. You’ll see less like this.',
  snoozedRow: (handle: string, days: number) => `Snoozed ${handle} for ${days} days.`,
  undo: 'Undo',
  sheetTitle: (handle: string) => `Snooze ${handle}`,
  sheetBody: 'Their posts leave Home for a while. You still follow them.',
  period: (days: number) => `For ${days} days`,
  whySeeing: 'Why you’re seeing this',
  hideFailed: 'Could not hide this post.',
  undoFailed: 'Could not undo. The post stays hidden for now.',
  snoozeFailed: (handle: string) => `Could not snooze ${handle}.`,
  unsnoozeFailed: (handle: string) => `Could not undo the snooze on ${handle}.`,
});

export const handleOf = (author?: PublicUser | null): string => (author?.username ? `@${author.username}` : displayName(author));

export type HiddenEntry =
  | { kind: 'not_interested'; postId: string }
  | { kind: 'snooze'; postId: string; authorId: string; handle: string; days: SnoozeDays; primary: boolean };

type ForYouCache = { pages: FeedResponse[]; pageParams: unknown[] };

const omit = <T extends Record<string, unknown>>(record: T, keys: readonly string[]): T => {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
};

/* ------------------------------------------------------------------ settling */

/**
 * Whether a row whose time is up may leave without moving anything the
 * member can see. Below the viewport: nothing visible moves. Above it: the
 * browser's scroll anchoring keeps the view still, so only where that exists.
 * On screen: never — the row stays, Undo and all, until it is scrolled away.
 */
export function canSettle(rect: { top: number; bottom: number }, viewportHeight: number, anchoring: boolean): boolean {
  if (rect.top >= viewportHeight) return true;
  if (rect.bottom <= 0) return anchoring;
  return false;
}

const supportsAnchoring = (): boolean => {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overflow-anchor', 'auto');
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ the row */

export function HiddenPostRow({
  entry,
  onUndo,
  onSettle,
  undoPending = false,
  className,
}: {
  entry: HiddenEntry;
  onUndo: (postId: string) => void;
  onSettle: (postId: string) => void;
  undoPending?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef(onSettle);
  settle.current = onSettle;

  useEffect(() => {
    const el = ref.current;
    const done = () => settle.current(entry.postId);
    if (!el || typeof IntersectionObserver === 'undefined') {
      const t = setTimeout(done, HIDDEN_ROW_UNDO_MS);
      return () => clearTimeout(t);
    }
    let expired = false;
    const anchoring = supportsAnchoring();
    const check = () => {
      if (!expired) return;
      if (canSettle(el.getBoundingClientRect(), window.innerHeight, anchoring)) done();
    };
    // Any change in visibility re-asks; the timer asks once when the five seconds are up.
    const io = new IntersectionObserver(check, { threshold: 0 });
    io.observe(el);
    const t = setTimeout(() => {
      expired = true;
      check();
    }, HIDDEN_ROW_UNDO_MS);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, [entry.postId]);

  const text = entry.kind === 'snooze' ? forYouCopy.snoozedRow(entry.handle, entry.days) : forYouCopy.hiddenRow;
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid="hidden-post-row"
      data-kind={entry.kind}
      className={cx('feed-rule flex h-14 items-center gap-3', className)}
    >
      <p className="t-body min-w-0 flex-1 truncate text-text-2">{text}</p>
      <button
        type="button"
        onClick={() => onUndo(entry.postId)}
        disabled={undoPending}
        aria-busy={undoPending || undefined}
        className="pressable t-body -mr-2 inline-flex h-11 shrink-0 items-center rounded-sm px-2 font-semibold text-brand-text hover:underline disabled:opacity-60"
      >
        {forYouCopy.undo}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ the sheet */

/** The periods the server accepts (`FeedPreference.SNOOZE_DAYS`), as two plain buttons. Text and tone only: Home's one filled button is elsewhere. */
export function SnoozeSheet({
  post,
  onClose,
  onPick,
  pending = null,
}: {
  post: Post | null;
  onClose: () => void;
  onPick: (days: SnoozeDays) => void;
  pending?: SnoozeDays | null;
}) {
  const handle = handleOf(post?.author);
  return (
    <Modal open={!!post} onClose={onClose} title={forYouCopy.sheetTitle(handle)} description={forYouCopy.sheetBody} size="sm">
      <div className="grid gap-2 pb-1" role="group" aria-label="Snooze period">
        {SNOOZE_DAYS.map((days) => (
          <Button
            key={days}
            variant="secondary"
            size="lg"
            block
            onClick={() => onPick(days)}
            loading={pending === days}
            disabled={pending !== null && pending !== days}
            data-testid={`snooze-${days}`}
          >
            {forYouCopy.period(days)}
          </Button>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ the hook */

export type ForYouControls = {
  hidden: Readonly<Record<string, HiddenEntry>>;
  notInterested: (post: Post) => void;
  openSnooze: (post: Post) => void;
  undo: (postId: string) => void;
  settle: (postId: string) => void;
  undoPending: boolean;
  /** The snooze sheet; mount it once on the page. */
  sheet: ReactNode;
};

/**
 * `posts` is the list as rendered (so a snooze can find the author's other
 * cards); `active` is whether For you is the served mode. Leaving For you or
 * leaving Home settles every pending row at once, so the cache never hands a
 * hidden post back on the way in.
 */
export function useForYouControls({ active, posts }: { active: boolean; posts: readonly Post[] }): ForYouControls {
  const qc = useQueryClient();
  const toast = useToast();
  const [hidden, setHidden] = useState<Record<string, HiddenEntry>>({});
  const [snoozeTarget, setSnoozeTarget] = useState<Post | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const dropFromCache = useCallback(
    (ids: ReadonlySet<string>) => {
      qc.setQueryData<ForYouCache>(['feed', 'foryou'], (old) =>
        old ? { ...old, pages: old.pages.map((page) => ({ ...page, posts: (page.posts || []).filter((p) => !ids.has(p._id)) })) } : old,
      );
    },
    [qc],
  );

  /** The row's time is up and it is off screen: the post leaves the cache and the entry goes. A snooze settles the whole author. */
  const settle = useCallback(
    (postId: string) => {
      const entry = hiddenRef.current[postId];
      if (!entry) return;
      const ids = new Set<string>([postId]);
      if (entry.kind === 'snooze') {
        for (const e of Object.values(hiddenRef.current)) if (e.kind === 'snooze' && e.authorId === entry.authorId) ids.add(e.postId);
      }
      dropFromCache(ids);
      setHidden((h) => omit(h, [...ids]));
    },
    [dropFromCache],
  );

  const settleAll = useCallback(() => {
    const ids = new Set(Object.keys(hiddenRef.current));
    if (!ids.size) return;
    dropFromCache(ids);
    setHidden({});
  }, [dropFromCache]);

  useEffect(() => {
    if (!active) settleAll();
  }, [active, settleAll]);
  useEffect(() => () => settleAll(), [settleAll]);

  // Snooze applies to every mode: Following and its quiet poll re-read on their next look.
  const invalidateOtherModes = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['feed', 'latest'] });
    void qc.invalidateQueries({ queryKey: ['feed', 'peek'] });
  }, [qc]);

  const hide = useMutation({
    mutationFn: (post: Post) => markNotInterested(post._id),
    onMutate: (post) => setHidden((h) => ({ ...h, [post._id]: { kind: 'not_interested', postId: post._id } })),
    onError: (e, post) => {
      setHidden((h) => omit(h, [post._id]));
      toast.error(e, forYouCopy.hideFailed);
    },
  });

  const unhide = useMutation({
    mutationFn: (postId: string) => undoNotInterested(postId),
    onMutate: (postId) => {
      const previous = hiddenRef.current[postId];
      setHidden((h) => omit(h, [postId]));
      return previous;
    },
    onError: (e, _postId, previous) => {
      if (previous) setHidden((h) => ({ ...h, [previous.postId]: previous }));
      toast.error(e, forYouCopy.undoFailed);
    },
  });

  const snooze = useMutation({
    mutationFn: ({ post, days }: { post: Post; days: SnoozeDays }) => snoozeAuthor(String(post.author?._id), days),
    onMutate: ({ post, days }) => {
      const authorId = String(post.author?._id ?? '');
      const handle = handleOf(post.author);
      const entries: Record<string, HiddenEntry> = {};
      for (const p of posts) {
        if (String(p.author?._id ?? '') !== authorId) continue;
        entries[p._id] = { kind: 'snooze', postId: p._id, authorId, handle, days, primary: p._id === post._id };
      }
      setHidden((h) => ({ ...h, ...entries }));
      setSnoozeTarget(null);
      return Object.keys(entries);
    },
    onError: (e, { post }, ids) => {
      if (ids) setHidden((h) => omit(h, ids));
      toast.error(e, forYouCopy.snoozeFailed(handleOf(post.author)));
    },
    onSuccess: invalidateOtherModes,
  });

  const unsnooze = useMutation({
    mutationFn: (entry: Extract<HiddenEntry, { kind: 'snooze' }>) => unsnoozeAuthor(entry.authorId),
    onMutate: (entry) => {
      const restored = Object.values(hiddenRef.current).filter((e): e is Extract<HiddenEntry, { kind: 'snooze' }> => e.kind === 'snooze' && e.authorId === entry.authorId);
      setHidden((h) => omit(h, restored.map((e) => e.postId)));
      return restored;
    },
    onError: (e, entry, restored) => {
      if (restored) setHidden((h) => ({ ...h, ...Object.fromEntries(restored.map((r) => [r.postId, r])) }));
      toast.error(e, forYouCopy.unsnoozeFailed(entry.handle));
    },
    onSuccess: invalidateOtherModes,
  });

  const undo = useCallback(
    (postId: string) => {
      const entry = hiddenRef.current[postId];
      if (!entry) return;
      if (entry.kind === 'snooze') unsnooze.mutate(entry);
      else unhide.mutate(postId);
    },
    [unhide, unsnooze],
  );

  const pendingDays: SnoozeDays | null = snooze.isPending ? snooze.variables.days : null;

  return {
    hidden,
    notInterested: (post) => hide.mutate(post),
    openSnooze: setSnoozeTarget,
    undo,
    settle,
    undoPending: unhide.isPending || unsnooze.isPending,
    sheet: (
      <SnoozeSheet
        post={snoozeTarget}
        onClose={() => setSnoozeTarget(null)}
        onPick={(days) => {
          if (snoozeTarget) snooze.mutate({ post: snoozeTarget, days });
        }}
        pending={pendingDays}
      />
    ),
  };
}
