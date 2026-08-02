import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import {
  compactNumber,
  displayName,
  useDebounced,
  type Post,
  type PublicUser,
} from '../lib/hooks';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Tabs,
  useToast,
} from './ui';
import { Search as SearchIcon, X } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import UserRow, { UserRowSkeleton } from './UserRow';

type SearchType = 'all' | 'users' | 'posts' | 'hashtags';

type Suggestion = {
  type: 'user' | 'hashtag';
  id: string;
  text: string;
  subtitle?: string;
  avatar?: string;
};

type RecentSearch = { _id: string; query: string; type?: string; searchedAt?: string };

type HashtagResult = { hashtag: string; count: number };

type SearchResponse = {
  query: string;
  type: string;
  results: {
    users?: PublicUser[];
    posts?: Post[];
    hashtags?: HashtagResult[];
    [k: string]: any;
  };
};

const TYPE_TABS: { key: SearchType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'users', label: 'People' },
  { key: 'posts', label: 'Posts' },
  { key: 'hashtags', label: 'Hashtags' },
];

function HashtagList({ hashtags }: { hashtags: HashtagResult[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {hashtags.map((h) => (
        <Link
          key={h.hashtag}
          to={`/search?q=${encodeURIComponent(`#${h.hashtag}`)}&type=posts`}
          className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--color-brand)]"
        >
          #{h.hashtag}
          <span className="ml-1.5 text-[var(--color-muted)]">{compactNumber(h.count)}</span>
        </Link>
      ))}
    </div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const urlQuery = params.get('q') || '';
  const urlType = (params.get('type') as SearchType) || 'all';

  const [term, setTerm] = useState(urlQuery);
  const [type, setType] = useState<SearchType>(urlType);
  const [focused, setFocused] = useState(false);

  useEffect(() => setTerm(urlQuery), [urlQuery]);
  useEffect(() => setType(urlType), [urlType]);

  const debounced = useDebounced(term.trim(), 300);
  const activeQuery = urlQuery.trim();

  /* ---------------- suggestions while typing ---------------- */
  const suggestions = useQuery({
    queryKey: ['search-suggestions', debounced],
    enabled: focused && debounced.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/search/suggestions', { params: { q: debounced } });
      return (data.suggestions || []) as Suggestion[];
    },
  });

  /* ---------------- recent + trending ---------------- */
  const recent = useQuery({
    queryKey: ['search-recent'],
    queryFn: async () => {
      const { data } = await api.get('/search/recent', { params: { limit: 10 } });
      return (data.recentSearches || []) as RecentSearch[];
    },
  });

  const trending = useQuery({
    queryKey: ['search-trending'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get('/search/trending');
      return (data.trending || { hashtags: [], users: [] }) as {
        hashtags: { _id: string; count: number }[];
        users: PublicUser[];
      };
    },
  });

  const clearRecent = useMutation({
    mutationFn: async () => {
      await api.delete('/search/recent');
    },
    onSuccess: () => {
      toast.success('Recent searches cleared');
      qc.invalidateQueries({ queryKey: ['search-recent'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not clear your recent searches.')),
  });

  /* ---------------- the actual search ---------------- */
  const results = useQuery({
    queryKey: ['search', activeQuery, type],
    enabled: activeQuery.length > 0,
    queryFn: async () => {
      const { data } = await api.get('/search', {
        params: { q: activeQuery, type, page: 1, limit: 20 },
      });
      return data as SearchResponse;
    },
  });

  // A completed search writes history server side, so refresh the recent list.
  useEffect(() => {
    if (results.isSuccess) qc.invalidateQueries({ queryKey: ['search-recent'] });
  }, [results.isSuccess, results.dataUpdatedAt, qc]);

  function runSearch(value: string, nextType: SearchType = type) {
    const trimmed = value.trim();
    setFocused(false);
    if (!trimmed) {
      setParams({});
      return;
    }
    setParams({ q: trimmed, type: nextType });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch(term);
  }

  const users = results.data?.results?.users || [];
  const posts = results.data?.results?.posts || [];
  const hashtags = results.data?.results?.hashtags || [];
  const nothingFound =
    results.isSuccess && !users.length && !posts.length && !hashtags.length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <form onSubmit={onSubmit} className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
        <Input
          className="!pl-9 !pr-9"
          placeholder="Search people, posts and hashtags"
          value={term}
          aria-label="Search"
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => setFocused(true)}
        />
        {term && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTerm('');
              setParams({});
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {focused && debounced.length >= 2 && !!suggestions.data?.length && (
          <Card className="absolute z-20 mt-2 w-full overflow-hidden p-1">
            {suggestions.data.map((s) => (
              <button
                key={`${s.type}-${s.id}`}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--color-surface-2)]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const value = s.type === 'hashtag' ? s.text : s.text;
                  setTerm(value);
                  runSearch(value, s.type === 'hashtag' ? 'posts' : 'users');
                }}
              >
                {s.type === 'user' ? (
                  <Avatar src={mediaUrl(s.avatar)} name={s.text} size={28} />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-surface-2)] text-xs">
                    #
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.text}</span>
                  {s.subtitle && (
                    <span className="block truncate text-xs text-[var(--color-muted)]">
                      {s.subtitle}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </Card>
        )}
      </form>

      {activeQuery && (
        <Tabs
          tabs={TYPE_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={type}
          onChange={(key) => {
            setType(key as SearchType);
            setParams({ q: activeQuery, type: key as string });
          }}
        />
      )}

      {/* ---------- landing state: recent + trending ---------- */}
      {!activeQuery && (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold">Recent searches</h2>
              {!!recent.data?.length && (
                <Button
                  variant="ghost"
                  onClick={() => clearRecent.mutate()}
                  loading={clearRecent.isPending}
                >
                  Clear all
                </Button>
              )}
            </div>
            {recent.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-xl" />
                ))}
              </div>
            ) : recent.isError ? (
              <p className="text-sm text-[var(--color-muted)]">
                {errMsg(recent.error, 'Recent searches are unavailable right now.')}
              </p>
            ) : recent.data?.length ? (
              <div className="space-y-1">
                {recent.data.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => {
                      setTerm(r.query);
                      runSearch(r.query);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]"
                  >
                    <SearchIcon className="h-4 w-4 text-[var(--color-muted)]" />
                    <span className="truncate">{r.query}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No recent searches"
                message="Search for people, posts or hashtags to get started."
              />
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold">Trending now</h2>
            {trending.isLoading ? (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-24 rounded-full" />
                ))}
              </div>
            ) : trending.isError ? (
              <p className="text-sm text-[var(--color-muted)]">
                {errMsg(trending.error, 'Trending content is unavailable right now.')}
              </p>
            ) : (
              <div className="space-y-4">
                {trending.data?.hashtags?.length ? (
                  <HashtagList
                    hashtags={trending.data.hashtags.map((h) => ({
                      hashtag: h._id,
                      count: h.count,
                    }))}
                  />
                ) : null}
                {trending.data?.users?.length ? (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Popular athletes
                    </h3>
                    {trending.data.users.map((u) => (
                      <UserRow key={u._id} user={u} />
                    ))}
                  </div>
                ) : null}
                {!trending.data?.hashtags?.length && !trending.data?.users?.length && (
                  <EmptyState
                    title="Nothing trending yet"
                    message="Trending hashtags and athletes appear as the community gets active."
                  />
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ---------- results ---------- */}
      {activeQuery && results.isLoading && (
        <div className="space-y-3">
          <UserRowSkeleton />
          <UserRowSkeleton />
          <PostCardSkeleton />
        </div>
      )}

      {activeQuery && results.isError && (
        <ErrorState
          title="Search failed"
          message={errMsg(results.error, 'Please try a different query.')}
          action={
            <Button variant="primary" onClick={() => results.refetch()}>
              Try again
            </Button>
          }
        />
      )}

      {activeQuery && nothingFound && (
        <EmptyState
          title={`No results for “${activeQuery}”`}
          message="Try a different spelling, or search for a hashtag instead."
        />
      )}

      {activeQuery && results.isSuccess && (
        <div className="space-y-6">
          {!!hashtags.length && (
            <section>
              <h2 className="mb-2 text-sm font-bold">Hashtags</h2>
              <HashtagList hashtags={hashtags} />
            </section>
          )}

          {!!users.length && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold">People</h2>
              {users.map((u) => (
                <UserRow key={u._id} user={u} />
              ))}
            </section>
          )}

          {!!posts.length && (
            <section className="space-y-4">
              <h2 className="text-sm font-bold">Posts</h2>
              {posts.map((p) => (
                <PostCard
                  key={p._id}
                  post={p}
                  invalidate={[['search', activeQuery, type], ['feed']]}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
