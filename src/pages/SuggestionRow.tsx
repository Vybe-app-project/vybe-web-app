import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { displayName } from '../lib/hooks';
import {
  FOR_YOU,
  NOT_INTERESTED,
  OPEN_PROFILE,
  SUGGESTIONS_ERROR,
  UNDO,
  UNDO_WINDOW_MS,
  WHY_THIS_SUGGESTION,
  focusAfterDismiss,
  hiddenCopy,
  parseSuggestions,
  reasonChips,
  type PeopleSuggestion,
} from '../lib/peopleSuggestions';
import { Badge, ErrorState, Menu, useToast } from './ui';
import { User, X } from './icons';
import UserRow, { FollowButton, UserRowSkeleton } from './UserRow';

/**
 * People to follow with the reason next to every name (Wave F,
 * design-first-week-and-people.md §3.2). Fed by GET /searching/suggest, which
 * is not behind the invites flag, so the chips and "Not interested" work on
 * every host. Shared by Discover › People (empty query) and Friends › For you.
 */

/** Every suggestion list shares this prefix so one dismissal updates all of them. */
export const SUGGESTIONS_KEY = ['people-suggestions'] as const;
export const suggestionsKey = (limit: number) => [...SUGGESTIONS_KEY, limit] as const;

/** The chip row: "Invited you" first and accented, the server's sentence verbatim, the check-in chip. */
export function ReasonChips({ row }: { row: PeopleSuggestion }) {
  const chips = reasonChips(row);
  if (!chips.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={WHY_THIS_SUGGESTION}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <Badge tone={chip.accent ? 'brand' : 'neutral'} size="sm" data-testid="reason-chip">
            {chip.text}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** One row: the shared UserRow, Follow through the shared button, the chip row, and an overflow menu with "Not interested". */
export default function SuggestionRow({ row, onDismiss }: { row: PeopleSuggestion; onDismiss?: (row: PeopleSuggestion) => void }) {
  const name = displayName(row);
  return (
    <UserRow
      user={row}
      below={<ReasonChips row={row} />}
      trailing={
        <span className="flex items-center gap-1">
          <FollowButton user={row} size="sm" />
          <Menu
            label={`More options for ${name}`}
            size={40}
            items={[
              { label: OPEN_PROFILE, icon: <User size={18} />, to: `/u/${row._id}` },
              { label: NOT_INTERESTED, icon: <X size={18} />, onSelect: () => onDismiss?.(row) },
            ]}
          />
        </span>
      }
    />
  );
}

export function useSuggestions(limit: number) {
  return useQuery({
    queryKey: suggestionsKey(limit),
    staleTime: 60_000,
    queryFn: async () => {
      // Never a search term from these lists: it disables the cold-start fill.
      const { data } = await api.get('/searching/suggest', { params: { limit } });
      return parseSuggestions(data);
    },
  });
}

type Pending = { timer: ReturnType<typeof setTimeout>; toastId: number; restore: () => void };

/**
 * "Not interested": the row leaves every suggestion list at once and an Undo
 * toast stands for six seconds; only then is POST /searching/exclude/:id sent
 * (the API has no un-exclude, so Undo can only be honest while the write has
 * not happened). The toast leaves with the write: it pauses its own timer
 * under a pointer or focus, and would otherwise stand with an Undo that no
 * longer does anything. Leaving the page inside the window sends the pending
 * writes immediately, so a navigation never loses a dismissal.
 */
export function useDismissSuggestion() {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useRef(new Map<string, Pending>());

  const exclude = useCallback(
    (id: string) => {
      api.post(`/searching/exclude/${id}`).catch(() => {
        // The hide did not stick on the server: refetch so the list is honest.
        void qc.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
      });
    },
    [qc],
  );

  useEffect(
    () => () => {
      for (const [id, entry] of pending.current) {
        clearTimeout(entry.timer);
        toast.dismiss(entry.toastId);
        exclude(id);
      }
      pending.current.clear();
    },
    [exclude, toast],
  );

  return useCallback(
    (row: PeopleSuggestion) => {
      const id = String(row._id);
      if (pending.current.has(id)) return;
      const positions = qc
        .getQueriesData<PeopleSuggestion[]>({ queryKey: SUGGESTIONS_KEY })
        .map(([key, data]) => [key, data ? data.findIndex((u) => String(u._id) === id) : -1] as const)
        .filter(([, index]) => index >= 0);
      qc.setQueriesData<PeopleSuggestion[]>({ queryKey: SUGGESTIONS_KEY }, (old) => old?.filter((u) => String(u._id) !== id));
      const restore = () => {
        for (const [key, index] of positions) {
          qc.setQueryData<PeopleSuggestion[]>(key, (old) => {
            if (!old || old.some((u) => String(u._id) === id)) return old;
            const next = old.slice();
            next.splice(Math.min(index, next.length), 0, row);
            return next;
          });
        }
      };
      const timer = setTimeout(() => {
        const entry = pending.current.get(id);
        pending.current.delete(id);
        if (entry) toast.dismiss(entry.toastId);
        exclude(id);
      }, UNDO_WINDOW_MS);
      const toastId = toast.info(hiddenCopy(displayName(row)), {
        duration: UNDO_WINDOW_MS,
        action: {
          label: UNDO,
          onClick: () => {
            const entry = pending.current.get(id);
            if (!entry) return;
            clearTimeout(entry.timer);
            pending.current.delete(id);
            entry.restore();
          },
        },
      });
      pending.current.set(id, { timer, toastId, restore });
    },
    [qc, toast, exclude],
  );
}

/** Skeletons while loading, an error with retry, the caller's empty state, else the rows under a "For you" heading. */
export function SuggestionList({ limit, heading = FOR_YOU, emptyState }: { limit: number; heading?: string; emptyState?: ReactNode }) {
  const suggestions = useSuggestions(limit);
  const dismiss = useDismissSuggestion();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rows = suggestions.data ?? [];

  // "Not interested" unmounts the row, its menu and the trigger that opened
  // it, which would leave keyboard focus on the document body (the Undo toast
  // is never focused). Focus is moved on purpose (lib/peopleSuggestions
  // focusAfterDismiss): to the overflow trigger of the row that takes the
  // removed one's place, to the heading when it was the last row, or to the
  // page's main region when the list empties into its empty state.
  const onDismiss = (row: PeopleSuggestion) => {
    const where = focusAfterDismiss(rows.findIndex((u) => String(u._id) === String(row._id)), rows.length);
    const nextTrigger = where.kind === 'row' ? listRef.current?.children.item(where.index)?.querySelector<HTMLElement>('[aria-haspopup="menu"]') : null;
    const target = nextTrigger ?? (where.kind === 'main' ? document.getElementById('main') : headingRef.current);
    dismiss(row);
    target?.focus({ preventScroll: true });
  };

  if (suggestions.isSuccess && rows.length === 0) return <>{emptyState ?? null}</>;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="type-label text-text-2">
        {heading}
      </h2>
      {suggestions.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: Math.min(limit, 3) }).map((_, i) => (
            <UserRowSkeleton key={i} />
          ))}
        </div>
      ) : suggestions.isError ? (
        <ErrorState title={SUGGESTIONS_ERROR} error={suggestions.error} retry={() => void suggestions.refetch()} />
      ) : (
        <ul ref={listRef} className="space-y-2">
          {rows.map((row) => (
            <li key={row._id}>
              <SuggestionRow row={row} onDismiss={onDismiss} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
