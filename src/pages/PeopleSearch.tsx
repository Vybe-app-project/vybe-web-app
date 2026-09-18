import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { Avatar, Badge, EmptyState, ErrorState, Input, SkeletonRow, cx } from './ui';
import { BadgeCheck, Check, Clock, Search as SearchIcon, X } from './icons';

/**
 * One people typeahead for every "find a person" surface: New message (direct
 * and group), Add people, the Friends page and the Search page. Results
 * arrive as you type from the first character (debounced 200 ms, stale
 * requests aborted), each row shows avatar, name, @username and the
 * relationship, and the whole thing works from the keyboard: arrows move
 * between rows, Enter picks, Escape clears then closes.
 *
 * Rows stay real <button>s (not listbox options) so accessible names read
 * "Maya Kim @maya.kim Message" and the live suites' role queries keep working.
 */

export type Person = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
  isFriend?: boolean;
  isFollowing?: boolean;
  friendStatus?: string;
  friendRequestId?: string;
  /** services/chatAccess: may the viewer open a conversation with this person. */
  canMessage?: boolean;
  isOnline?: boolean;
};

export const personName = (u?: Person | null, fallback = 'Vybe user'): string => u?.fullName?.trim() || u?.username || fallback;

export const PEOPLE_SEARCH_LIMIT = 20;
export const PEOPLE_SEARCH_DEBOUNCE_MS = 200;

/** GET /users/all/search?q=&limit= — prefix-ranked, relationship flags included. */
export function usePeopleSearch(query: string, { enabled = true, limit = PEOPLE_SEARCH_LIMIT }: { enabled?: boolean; limit?: number } = {}) {
  const debounced = useDebounced(query.trim(), PEOPLE_SEARCH_DEBOUNCE_MS);
  const q = useQuery({
    queryKey: ['people-search', debounced, limit],
    enabled: enabled && debounced.length >= 1,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data } = await api.get('/users/all/search', { params: { q: debounced, limit }, signal });
      return (data.users || []) as Person[];
    },
  });
  return { ...q, debounced, settled: debounced === query.trim() };
}

/* ------------------------------------------------------------------ recent */

const RECENT_KEY = 'vybe.recentPeople';
const RECENT_MAX = 8;

const readRecent = (): Person[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as Person[]) : [];
    return Array.isArray(list) ? list.filter((u) => u && typeof u._id === 'string') : [];
  } catch {
    return [];
  }
};

const writeRecent = (list: Person[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Storage may be unavailable (private mode); recents are a convenience.
  }
  window.dispatchEvent(new Event('vybe:recent-people'));
};

/** Remember who was picked so the picker opens on them next time. */
export function rememberPerson(u: Person) {
  const compact: Person = { _id: u._id, username: u.username, fullName: u.fullName, avatar: u.avatar, isVerified: u.isVerified };
  writeRecent([compact, ...readRecent().filter((r) => r._id !== u._id)]);
}

export function forgetPerson(id: string) {
  writeRecent(readRecent().filter((r) => r._id !== id));
}

export function clearRecentPeople() {
  writeRecent([]);
}

export function useRecentPeople(): Person[] {
  const [list, setList] = useState<Person[]>(() => (typeof window === 'undefined' ? [] : readRecent()));
  useEffect(() => {
    const sync = () => setList(readRecent());
    window.addEventListener('vybe:recent-people', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('vybe:recent-people', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return list;
}

/* ------------------------------------------------------------------ row */

export function RelationshipBadge({ user }: { user: Person }) {
  if (user.isFriend || user.friendStatus === 'friends') {
    return (
      <Badge tone="brand" size="sm">
        Friends
      </Badge>
    );
  }
  if (user.isFollowing) {
    return (
      <Badge tone="neutral" size="sm">
        Following
      </Badge>
    );
  }
  return null;
}

export function PersonRow({
  user,
  onClick,
  trailing,
  trailingInteractive = false,
  selected,
  meta,
  disabled,
  className,
  buttonRef,
  onKeyDown,
  'data-index': dataIndex,
}: {
  user: Person;
  onClick: () => void;
  trailing?: ReactNode;
  /**
   * The trailing slot holds its own buttons (Add / Accept …): it is rendered
   * beside the row button rather than inside it, since a button may not
   * contain another button.
   */
  trailingInteractive?: boolean;
  /** Multi-select: renders as a checkbox row. */
  selected?: boolean;
  meta?: ReactNode;
  disabled?: boolean;
  className?: string;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  'data-index'?: number;
}) {
  const name = personName(user);
  const aside = trailingInteractive && !!trailing;
  return (
    <li className={cx('flex items-center rounded-md transition-colors dur-1', aside && (selected ? 'bg-brand-soft' : 'hover:bg-surface-2'), aside && className)}>
      <button
        type="button"
        ref={buttonRef}
        data-index={dataIndex}
        onClick={onClick}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role={selected === undefined ? undefined : 'checkbox'}
        aria-checked={selected === undefined ? undefined : selected}
        className={cx(
          'flex min-h-14 w-full min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors dur-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
          !aside && (selected ? 'bg-brand-soft' : 'hover:bg-surface-2 active:bg-surface-2 focus-visible:bg-surface-2'),
          disabled && 'opacity-60',
          !aside && className,
        )}
      >
        <span className="relative shrink-0">
          <Avatar src={user.avatar} name={name} size={40} />
          {user.isOnline ? <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-1 bg-success" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text-1">{name}</span>
            {user.isVerified ? (
              <span role="img" aria-label="Verified" className="inline-flex shrink-0 text-brand">
                <BadgeCheck size={14} />
              </span>
            ) : null}
            <RelationshipBadge user={user} />
          </span>
          <span className="flex min-w-0 items-center gap-2 text-xs text-text-2">
            {user.username ? <span className="truncate">@{user.username}</span> : null}
            {meta}
          </span>
        </span>
        {!aside ? trailing : null}
      </button>
      {aside ? <div className="flex shrink-0 items-center gap-1.5 pr-3">{trailing}</div> : null}
    </li>
  );
}

export function SelectionCheck({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors dur-1',
        on ? 'border-brand bg-brand text-on-brand' : 'border-control bg-surface-2 text-transparent',
      )}
    >
      <Check size={14} strokeWidth={2.8} />
    </span>
  );
}

/* ------------------------------------------------------------------ component */

export type PeopleSearchProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onPick: (user: Person) => void;
  /** `multi` renders checkbox rows and keeps the query after a pick. */
  mode?: 'single' | 'multi';
  selectedIds?: ReadonlySet<string>;
  /** Never offered (yourself, people already in the group). */
  excludeIds?: ReadonlySet<string>;
  /** Shown while the query is empty, e.g. the friends list. */
  emptyList?: Person[];
  emptyHeading?: string;
  emptyListLoading?: boolean;
  emptyListError?: unknown;
  onRetryEmptyList?: () => void;
  /** Fallback when there is no `emptyList` and no recent people. */
  emptyState?: ReactNode;
  /** Offer recently picked people while the query is empty. */
  recent?: boolean;
  /** Per-row action on the right. Defaults to "Message" / a checkbox. */
  trailing?: (user: Person) => ReactNode;
  /** Set when `trailing` renders buttons of its own (see PersonRow). */
  trailingInteractive?: boolean;
  meta?: (user: Person) => ReactNode;
  label?: string;
  hideLabel?: boolean;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputId?: string;
  /** Height cap for the results region. */
  listClassName?: string;
  limit?: number;
};

export default function PeopleSearch({
  query,
  onQueryChange,
  onPick,
  mode = 'single',
  selectedIds,
  excludeIds,
  emptyList,
  emptyHeading = 'Friends',
  emptyListLoading = false,
  emptyListError,
  onRetryEmptyList,
  emptyState,
  recent = true,
  trailing,
  trailingInteractive = false,
  meta,
  label = 'Search people',
  hideLabel = true,
  hint,
  placeholder = 'Search by name or @username',
  autoFocus = false,
  inputId,
  listClassName,
  limit = PEOPLE_SEARCH_LIMIT,
}: PeopleSearchProps) {
  const trimmed = query.trim();
  const searching = trimmed.length >= 1;
  const results = usePeopleSearch(query, { limit });
  const recentPeople = useRecentPeople();
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useMemo(() => `people-${Math.random().toString(36).slice(2, 8)}`, []);

  const visible = useMemo(() => {
    const seen = new Set<string>(excludeIds ? [...excludeIds] : []);
    const pick = (list: Person[] | undefined) => (list || []).filter((u) => (seen.has(u._id) ? false : (seen.add(u._id), true)));
    if (searching) {
      const q = trimmed.toLowerCase();
      // Friends who match show first, then the network, so a friend is never
      // pushed below strangers with a similar name.
      const friendHits = pick((emptyList || []).filter((u) => `${u.fullName || ''} ${u.username || ''}`.toLowerCase().includes(q)));
      return [...friendHits, ...pick(results.data)];
    }
    if (emptyList) return pick(emptyList);
    return recent ? pick(recentPeople) : [];
  }, [searching, trimmed, emptyList, results.data, recent, recentPeople, excludeIds]);

  rowRefs.current.length = visible.length;

  const focusRow = useCallback((i: number) => {
    const el = rowRefs.current[i];
    if (el) el.focus();
  }, []);

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && visible.length) {
      e.preventDefault();
      focusRow(0);
    } else if (e.key === 'Enter' && visible.length && mode === 'single') {
      e.preventDefault();
      onPick(visible[0]);
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault();
        e.stopPropagation();
        onQueryChange('');
      }
    }
  };

  const onRowKeyDown = (i: number) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(Math.min(i + 1, visible.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (i === 0) inputRef.current?.focus();
        else focusRow(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(0);
        break;
      case 'End':
        e.preventDefault();
        focusRow(visible.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
        break;
      default:
        // Keep typing from a row: send the keystroke back to the field.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onQueryChange(query + e.key);
          inputRef.current?.focus();
        }
    }
  };

  const pick = (u: Person) => {
    if (mode === 'single') rememberPerson(u);
    onPick(u);
  };

  const showLoading = searching && results.isPending && !results.data && visible.length === 0;
  const showEmptyLoading = !searching && !!emptyList && emptyListLoading && visible.length === 0;
  const busy = showLoading || (searching && results.isFetching && !results.settled);

  return (
    <div className="space-y-3">
      <Input
        ref={inputRef}
        id={inputId}
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        label={label}
        hideLabel={hideLabel}
        hint={hint}
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        enterKeyHint="search"
        aria-controls={listId}
        aria-busy={busy || undefined}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        leading={<SearchIcon size={18} />}
        className="[&::-webkit-search-cancel-button]:hidden"
        trailing={
          query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xs text-text-2 hover:bg-surface-3 hover:text-text-1"
            >
              <X size={16} />
            </button>
          ) : undefined
        }
      />

      <div id={listId} className={cx('-mx-1 min-h-40 overflow-y-auto', listClassName)} aria-live="polite" aria-busy={busy || undefined}>
        {showLoading || showEmptyLoading ? (
          <ul aria-label="Loading people">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="px-3">
                <SkeletonRow />
              </li>
            ))}
          </ul>
        ) : searching && results.isError && visible.length === 0 ? (
          <ErrorState error={results.error} title="Search failed" onRetry={() => results.refetch()} />
        ) : !searching && emptyList && emptyListError && visible.length === 0 ? (
          <ErrorState error={emptyListError} title="Couldn’t load your friends" onRetry={onRetryEmptyList} />
        ) : visible.length === 0 ? (
          searching ? (
            results.settled && !results.isFetching ? (
              <EmptyState variant="no-results" size="sm" title={`No one matches “${trimmed}”`} message="Check the spelling, or try their @username." />
            ) : (
              <ul aria-label="Loading people">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="px-3">
                    <SkeletonRow />
                  </li>
                ))}
              </ul>
            )
          ) : (
            emptyState ?? <p className="px-3 py-6 text-center text-sm text-text-2">Type a name or @username to find people on Vybe.</p>
          )
        ) : (
          <>
            {!searching ? (
              <div className="flex items-center justify-between px-3 pb-1">
                <h3 className="type-label text-text-3">{emptyList ? emptyHeading : 'Recent'}</h3>
                {!emptyList && recent ? (
                  <button type="button" onClick={clearRecentPeople} className="text-xs font-semibold text-text-2 hover:text-text-1 hover:underline">
                    Clear
                  </button>
                ) : null}
              </div>
            ) : null}
            <ul className="space-y-0.5" aria-label={searching ? `People matching ${trimmed}` : emptyList ? emptyHeading : 'Recent people'}>
              {visible.map((u, i) => {
                const on = selectedIds?.has(u._id) ?? false;
                return (
                  <PersonRow
                    key={u._id}
                    user={u}
                    data-index={i}
                    buttonRef={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    onKeyDown={onRowKeyDown(i)}
                    onClick={() => pick(u)}
                    trailingInteractive={trailingInteractive && !!trailing}
                    selected={mode === 'multi' ? on : undefined}
                    meta={meta ? meta(u) : !searching && !emptyList ? <Clock size={12} className="shrink-0 text-text-3" aria-label="Recent" /> : undefined}
                    trailing={
                      trailing ? (
                        trailing(u)
                      ) : mode === 'multi' ? (
                        <SelectionCheck on={on} />
                      ) : u.canMessage === false ? (
                        <span className="shrink-0 text-xs font-medium text-text-3">Friends only</span>
                      ) : (
                        <span className="shrink-0 text-xs font-semibold text-brand-text">Message</span>
                      )
                    }
                  />
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
