import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { compactNumber, useDebounced, type Post, type PublicUser } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  SegmentedControl,
  Skeleton,
  cx,
  formatStat,
  humanize,
  useToast,
} from './ui';
import { Clock, Hash, Heart, Search as SearchIcon, X } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import UserRow, { UserRowSkeleton } from './UserRow';
import { CoverArt, type SocialWorkout } from './Workouts';

type SearchType = 'all' | 'users' | 'posts' | 'hashtags' | 'workouts';

/** Search results carry a like count instead of the like list. */
type SearchWorkout = Omit<SocialWorkout, 'likes'> & { likeCount?: number };

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
    workouts?: SearchWorkout[];
    [k: string]: any;
  };
};

const TYPE_TABS: { key: SearchType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'users', label: 'People' },
  { key: 'posts', label: 'Posts' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'hashtags', label: 'Hashtags' },
];

const isSearchType = (v: string | null): v is SearchType => !!v && TYPE_TABS.some((t) => t.key === v);

const INPUT_ID = 'search-input';
const searchInput = () => document.getElementById(INPUT_ID) as HTMLInputElement | null;

function HashtagList({ hashtags }: { hashtags: HashtagResult[] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Hashtags">
      {hashtags.map((h) => (
        <li key={h.hashtag}>
          <Chip to={`/search?q=${encodeURIComponent(`#${h.hashtag}`)}&type=posts`} icon={<Hash size={14} />}>
            {h.hashtag}
            <span className="tabular ml-1.5 font-medium text-text-3">{compactNumber(h.count)}</span>
          </Chip>
        </li>
      ))}
    </ul>
  );
}

/** Compact workout row: cover, title, category and the author, linking to the workout page. */
function WorkoutResultRow({ workout }: { workout: SearchWorkout }) {
  const author = workout.createdBy;
  const exercises = workout.exercises?.length ?? 0;
  return (
    <Card padded={false} className="relative flex items-center gap-3 p-3">
      <Link to={`/workouts/${workout._id}`} viewTransition aria-label={`Open ${workout.title}`} className="absolute inset-0 z-[1] rounded-[inherit]" />
      <span className="h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-surface-2">
        <CoverArt workout={workout as SocialWorkout} compact />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-md font-semibold text-text-1">{workout.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
          <Badge tone="brand" size="sm">
            {humanize(workout.category)}
          </Badge>
          {workout.isPremade ? (
            <Badge tone="accent" size="sm">
              Premade
            </Badge>
          ) : null}
          <span className="tabular">
            {formatStat(exercises)} {exercises === 1 ? 'exercise' : 'exercises'}
          </span>
          {workout.duration ? <span className="tabular">{formatStat(workout.duration)} min</span> : null}
          {author ? <span className="truncate">by {author.fullName || `@${author.username ?? 'unknown'}`}</span> : workout.isPremade ? <span>by Vybe</span> : null}
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-text-2 tabular" aria-label={`${formatStat(workout.likeCount ?? 0)} likes`}>
        <Heart size={16} /> {formatStat(workout.likeCount ?? 0)}
      </span>
    </Card>
  );
}

function SubHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-10 items-center justify-between gap-3">
      <h2 className="type-heading text-md text-text-1">{children}</h2>
      {action}
    </div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const urlQuery = params.get('q') || '';
  const urlType: SearchType = isSearchType(params.get('type')) ? (params.get('type') as SearchType) : 'all';

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
    searchInput()?.blur();
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

  function clearAll() {
    setTerm('');
    setParams({});
    searchInput()?.focus();
  }

  const users = results.data?.results?.users || [];
  const posts = results.data?.results?.posts || [];
  const hashtags = results.data?.results?.hashtags || [];
  const workouts = results.data?.results?.workouts || [];
  const nothingFound = results.isSuccess && !users.length && !posts.length && !hashtags.length && !workouts.length;
  const showSuggestions = focused && debounced.length >= 2 && !!suggestions.data?.length;

  return (
    <>
      <PageHeader title="Search" subtitle="People, posts, workouts and hashtags across Vybe." />
      <div className="w-full max-w-form space-y-5">
        <form onSubmit={onSubmit} role="search" className="relative">
          <Input
            id={INPUT_ID}
            type="search"
            inputMode="search"
            autoComplete="off"
            leading={<SearchIcon size={18} />}
            label="Search"
            hideLabel
            placeholder="Search people, posts, workouts and hashtags"
            value={term}
            enterKeyHint="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="search-suggestions"
            className={cx(!!term && 'pr-12')}
            onChange={(e) => setTerm(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            trailing={
              term ? (
                <IconButton size={40} label="Clear search" onClick={clearAll} className="text-text-2">
                  <X size={20} />
                </IconButton>
              ) : undefined
            }
          />

          {showSuggestions ? (
            <Card padded={false} className="anim-pop-in absolute z-20 mt-2 w-full overflow-hidden p-1 shadow-2">
              <ul id="search-suggestions" role="listbox" aria-label="Suggestions">
                {suggestions.data!.map((s) => (
                  <li key={`${s.type}-${s.id}`} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors dur-1 hover:bg-surface-2"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setTerm(s.text);
                        runSearch(s.text, s.type === 'hashtag' ? 'posts' : 'users');
                      }}
                    >
                      {s.type === 'user' ? (
                        <Avatar src={s.avatar} name={s.text} size="sm" />
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                          <Hash size={16} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-1">{s.text}</span>
                        {s.subtitle ? <span className="block truncate text-xs text-text-2">{s.subtitle}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </form>

        {activeQuery ? (
          <SegmentedControl
            aria-label="Result type"
            tabs={TYPE_TABS.map((t) => ({ key: t.key, label: t.label }))}
            value={type}
            onChange={(key) => {
              const next = isSearchType(key) ? key : 'all';
              setType(next);
              setParams({ q: activeQuery, type: next });
            }}
          />
        ) : null}

        {/* ---------- landing state: recent + trending ---------- */}
        {!activeQuery ? (
          <div className="space-y-8">
            <section aria-labelledby="recent-heading">
              <SubHeading
                action={
                  recent.data?.length ? (
                    <Button variant="ghost" size="sm" onClick={() => clearRecent.mutate()} loading={clearRecent.isPending}>
                      Clear all
                    </Button>
                  ) : null
                }
              >
                <span id="recent-heading">Recent searches</span>
              </SubHeading>
              {recent.isLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full rounded-sm" />
                  ))}
                </div>
              ) : recent.isError ? (
                <p className="text-sm text-text-2">{errMsg(recent.error, 'Recent searches are unavailable right now.')}</p>
              ) : recent.data?.length ? (
                <ul className="-mx-1">
                  {recent.data.map((r) => (
                    <li key={r._id}>
                      <button
                        type="button"
                        onClick={() => {
                          setTerm(r.query);
                          runSearch(r.query, isSearchType(r.type ?? null) ? (r.type as SearchType) : 'all');
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-1 transition-colors dur-1 hover:bg-surface-2"
                      >
                        <Clock size={18} className="shrink-0 text-text-3" />
                        <span className="truncate">{r.query}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-text-2">
                  Searches you run will show up here so you can jump back in.
                </p>
              )}
            </section>

            <section aria-labelledby="trending-heading">
              <SubHeading>
                <span id="trending-heading">Trending now</span>
              </SubHeading>
              {trending.isLoading ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-24 rounded-xs" />
                  ))}
                </div>
              ) : trending.isError ? (
                <p className="text-sm text-text-2">{errMsg(trending.error, 'Trending content is unavailable right now.')}</p>
              ) : (
                <div className="space-y-5">
                  {trending.data?.hashtags?.length ? (
                    <HashtagList hashtags={trending.data.hashtags.map((h) => ({ hashtag: h._id, count: h.count }))} />
                  ) : null}
                  {trending.data?.users?.length ? (
                    <div className="space-y-2">
                      <h3 className="type-label text-text-2">Popular athletes</h3>
                      <div className="space-y-2">
                        {trending.data.users.map((u) => (
                          <UserRow key={u._id} user={u} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {!trending.data?.hashtags?.length && !trending.data?.users?.length ? (
                    <EmptyState
                      size="sm"
                      title="Nothing trending yet"
                      message="Trending hashtags and athletes appear as the community gets active."
                      action={{ label: 'Explore posts', to: '/discover', variant: 'secondary' }}
                    />
                  ) : null}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {/* ---------- results ---------- */}
        {activeQuery && results.isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Searching">
            <UserRowSkeleton />
            <UserRowSkeleton />
            <PostCardSkeleton />
          </div>
        ) : null}

        {activeQuery && results.isError ? (
          <ErrorState title="Search failed" error={results.error} retry={() => void results.refetch()} />
        ) : null}

        {activeQuery && nothingFound ? (
          <EmptyState
            variant="no-results"
            title={`No results for “${activeQuery}”`}
            message="Check the spelling, try fewer words, or search a hashtag or workout name instead."
            action={{ label: 'Clear search', onClick: clearAll, variant: 'secondary' }}
          />
        ) : null}

        {activeQuery && results.isSuccess && !nothingFound ? (
          <div className="space-y-8">
            {hashtags.length ? (
              <section aria-labelledby="res-hashtags">
                <SubHeading>
                  <span id="res-hashtags">Hashtags</span>
                </SubHeading>
                <HashtagList hashtags={hashtags} />
              </section>
            ) : null}

            {users.length ? (
              <section aria-labelledby="res-people" className="space-y-2">
                <SubHeading>
                  <span id="res-people">People</span>
                </SubHeading>
                {users.map((u) => (
                  <UserRow key={u._id} user={u} />
                ))}
              </section>
            ) : null}

            {workouts.length ? (
              <section aria-labelledby="res-workouts" className="space-y-2">
                <SubHeading
                  action={
                    type === 'all' && workouts.length >= 5 ? (
                      <Button variant="ghost" size="sm" onClick={() => setParams({ q: activeQuery, type: 'workouts' })}>
                        See all
                      </Button>
                    ) : null
                  }
                >
                  <span id="res-workouts">Workouts</span>
                </SubHeading>
                {(type === 'all' ? workouts.slice(0, 5) : workouts).map((w) => (
                  <WorkoutResultRow key={w._id} workout={w} />
                ))}
              </section>
            ) : null}

            {posts.length ? (
              <section aria-labelledby="res-posts" className="space-y-4">
                <SubHeading>
                  <span id="res-posts">Posts</span>
                </SubHeading>
                {posts.map((p) => (
                  <PostCard key={p._id} post={p} invalidate={[['search', activeQuery, type], ['feed']]} />
                ))}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
