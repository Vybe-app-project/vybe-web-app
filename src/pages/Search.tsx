import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { compactNumber, displayName, followerCount, useDebounced, type Post, type PublicUser } from '../lib/hooks';
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
  Skeleton,
  Tabs,
  cx,
  formatStat,
  humanize,
  useToast,
} from './ui';
import { ChevronRight, Clock, Hash, Lock, Search as SearchIcon, Users, X, Zap } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import UserRow, { UserRowSkeleton } from './UserRow';
import { dedupeRecentSearches, type RecentSearchLike } from '../lib/searchHistory';
import { usePeopleSearch } from './PeopleSearch';
import { MealTile, WorkoutTile, type MealItem, type WorkoutItem } from './ProfileTabs';

/** Every bucket the API's unified search returns. */
type SearchType = 'all' | 'users' | 'posts' | 'hashtags' | 'workouts' | 'meals' | 'challenges';

type Suggestion = {
  type: 'user' | 'hashtag';
  id: string;
  text: string;
  subtitle?: string;
  avatar?: string;
  isPrivate?: boolean;
};

type RecentSearch = { _id: string; query: string; type?: string; searchedAt?: string };

type HashtagResult = { hashtag: string; count: number };

type ChallengeResult = {
  _id: string;
  title: string;
  description?: string;
  type?: string;
  category?: string;
  goal?: number;
  goalUnit?: string;
  ownership?: 'user' | 'system';
  image?: string;
  stats?: { totalParticipants?: number };
  createdBy?: PublicUser | string | null;
};

type SearchResponse = {
  query: string;
  type: string;
  results: {
    users?: PublicUser[];
    posts?: Post[];
    hashtags?: HashtagResult[];
    workouts?: WorkoutItem[];
    meals?: MealItem[];
    challenges?: ChallengeResult[];
  };
};

const TYPE_TABS: { key: SearchType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'users', label: 'People' },
  { key: 'posts', label: 'Posts' },
  { key: 'hashtags', label: 'Hashtags' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'meals', label: 'Meals' },
  { key: 'challenges', label: 'Challenges' },
];

const isSearchType = (v: string | null): v is SearchType => !!v && TYPE_TABS.some((t) => t.key === v);

/** The API rejects anything longer; the field stops there instead of round-tripping a 400. */
export const SEARCH_QUERY_MAX = 100;

/** How much of each bucket the All tab shows before "See all". */
const ALL_TAB_PREVIEW: Record<Exclude<SearchType, 'all' | 'posts'>, number> = {
  users: 3,
  hashtags: 6,
  workouts: 4,
  meals: 4,
  challenges: 3,
};

const INPUT_ID = 'search-input';
const LISTBOX_ID = 'search-suggestions';
const optionId = (index: number) => `search-suggestion-${index}`;
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

function ChallengeTile({ challenge }: { challenge: ChallengeResult }) {
  const participants = challenge.stats?.totalParticipants ?? 0;
  const creator = challenge.createdBy && typeof challenge.createdBy === 'object' ? challenge.createdBy : null;
  return (
    <Card to={`/challenges?open=${challenge._id}`} linkLabel={`Open challenge ${challenge.title}`} padded={false} className="flex gap-3 p-3">
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-text">
        <Zap size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-md font-semibold text-text-1">{challenge.title}</p>
          {challenge.ownership === 'system' ? <Badge tone="info">Official</Badge> : null}
        </div>
        {challenge.description ? <p className="mt-0.5 line-clamp-2 text-xs text-text-2">{challenge.description}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {challenge.type ? <Badge tone="brand">{humanize(challenge.type)}</Badge> : null}
          {challenge.category ? <Badge>{humanize(challenge.category)}</Badge> : null}
          <span className="tabular ml-auto inline-flex items-center gap-1 text-xs text-text-2">
            <Users size={14} /> {formatStat(participants)}
          </span>
        </div>
        {creator ? <p className="mt-1 truncate text-2xs text-text-3">by {displayName(creator)}</p> : null}
      </div>
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

function SeeAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} icon={<ChevronRight size={16} />}>
      {label}
    </Button>
  );
}

/** Drop repeated queries (case-insensitively), keeping the most recent; shared with the header search. */
export function dedupeRecent<T extends RecentSearchLike>(items: T[]): T[] {
  return dedupeRecentSearches(items);
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const urlQuery = params.get('q') || '';
  const urlType: SearchType = isSearchType(params.get('type')) ? (params.get('type') as SearchType) : 'all';

  const [term, setTerm] = useState(urlQuery);
  const [type, setType] = useState<SearchType>(urlType);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => setTerm(urlQuery.slice(0, SEARCH_QUERY_MAX)), [urlQuery]);
  useEffect(() => setType(urlType), [urlType]);

  const debounced = useDebounced(term.trim(), 300);
  const activeQuery = urlQuery.trim().slice(0, SEARCH_QUERY_MAX);

  /* ---------------- suggestions while typing ---------------- */
  const suggestions = useQuery({
    queryKey: ['search-suggestions', debounced],
    enabled: focused && debounced.length >= 2 && debounced.length <= SEARCH_QUERY_MAX,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get('/search/suggestions', { params: { q: debounced } });
      return (data.suggestions || []) as Suggestion[];
    },
  });
  const options = suggestions.data || [];
  // New words, new list: nothing is highlighted until the person arrows down.
  // (Not tied to `focused`: reopening the list with ArrowDown highlights the
  // first option, and this must not undo that.)
  useEffect(() => setActiveIndex(-1), [debounced]);

  /* ---------------- recent + trending ---------------- */
  const recent = useQuery({
    queryKey: ['search-recent'],
    queryFn: async () => {
      const { data } = await api.get('/search/recent', { params: { limit: 10 } });
      return dedupeRecent((data.recentSearches || []) as RecentSearch[]);
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

  function closeSuggestions() {
    setFocused(false);
    setActiveIndex(-1);
  }

  function runSearch(value: string, nextType: SearchType = type) {
    const trimmed = value.trim().slice(0, SEARCH_QUERY_MAX);
    closeSuggestions();
    searchInput()?.blur();
    if (!trimmed) {
      setParams({});
      return;
    }
    setParams({ q: trimmed, type: nextType });
  }

  function switchType(next: SearchType) {
    setType(next);
    setParams({ q: activeQuery, type: next });
  }

  function chooseSuggestion(s: Suggestion) {
    closeSuggestions();
    if (s.type === 'user') {
      // A person in the dropdown is a destination, not a query.
      searchInput()?.blur();
      navigate(`/u/${s.id}`, { viewTransition: true });
      return;
    }
    setTerm(s.text);
    runSearch(s.text, 'posts');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (activeIndex >= 0 && options[activeIndex]) {
      chooseSuggestion(options[activeIndex]);
      return;
    }
    runSearch(term);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) {
      if (e.key === 'ArrowDown' && options.length && debounced.length >= 2) {
        // Closed with Escape, or focus returned: the arrow reopens the list.
        e.preventDefault();
        setFocused(true);
        setActiveIndex(0);
      } else if (e.key === 'Escape' && term) {
        e.preventDefault();
        clearAll();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Home' && options.length) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && options.length) {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSuggestions();
    }
    // Enter is handled by the form submit so a highlighted option wins.
  }

  function clearAll() {
    setTerm('');
    setParams({});
    searchInput()?.focus();
  }

  // People tab: results as you type (the same typeahead as New message), no
  // submit needed. Other tabs keep the suggestion dropdown.
  const liveTyping = type === 'users' && term.trim().length >= 1 && term.trim() !== activeQuery;
  const livePeople = usePeopleSearch(term, { enabled: liveTyping });
  const r = results.data?.results;
  const users = r?.users || [];
  const posts = r?.posts || [];
  const hashtags = r?.hashtags || [];
  const workouts = r?.workouts || [];
  const meals = r?.meals || [];
  const challenges = r?.challenges || [];
  const nothingFound =
    results.isSuccess && !users.length && !posts.length && !hashtags.length && !workouts.length && !meals.length && !challenges.length;
  const showSuggestions = focused && debounced.length >= 2 && options.length > 0 && !liveTyping;
  const all = type === 'all';
  const preview = <T,>(list: T[], key: keyof typeof ALL_TAB_PREVIEW): { items: T[]; more: number } => {
    if (!all) return { items: list, more: 0 };
    const items = list.slice(0, ALL_TAB_PREVIEW[key]);
    return { items, more: list.length - items.length };
  };
  const peopleShown = preview(users, 'users');
  const hashtagsShown = preview(hashtags, 'hashtags');
  const workoutsShown = preview(workouts, 'workouts');
  const mealsShown = preview(meals, 'meals');
  const challengesShown = preview(challenges, 'challenges');

  // "Popular" implies signal. The API filters to followed accounts; if an
  // older API answers with unfollowed ones, say what the list really is.
  const trendingUsers = trending.data?.users || [];
  const popularHeading = useMemo(
    () => (trendingUsers.length && trendingUsers.every((u) => followerCount(u) > 0) ? 'Popular athletes' : 'People to follow'),
    [trendingUsers],
  );

  return (
    <>
      <PageHeader title="Search" subtitle="People, posts, hashtags, workouts, meals and challenges across Vybe." />
      <div className="w-full max-w-form space-y-5">
        <form onSubmit={onSubmit} role="search" className="relative">
          <Input
            id={INPUT_ID}
            type="search"
            inputMode="search"
            autoComplete="off"
            maxLength={SEARCH_QUERY_MAX}
            leading={<SearchIcon size={18} />}
            label="Search"
            hideLabel
            placeholder="Search people, posts, workouts, meals…"
            value={term}
            enterKeyHint="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={showSuggestions && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            className={cx(!!term && 'pr-12')}
            onChange={(e) => {
              setTerm(e.target.value);
              // Typing after Escape reopens the list.
              setFocused(true);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (blurTimer.current) window.clearTimeout(blurTimer.current);
              setFocused(true);
            }}
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => closeSuggestions(), 150);
            }}
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
              <ul id={LISTBOX_ID} role="listbox" aria-label="Suggestions">
                {options.map((s, index) => {
                  const active = index === activeIndex;
                  return (
                    <li key={`${s.type}-${s.id}`} id={optionId(index)} role="option" aria-selected={active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={cx(
                          'flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors dur-1 hover:bg-surface-2',
                          active && 'bg-surface-2',
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => chooseSuggestion(s)}
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
                          {s.subtitle ? (
                            <span className="flex items-center gap-1 text-xs text-text-2">
                              <span className="truncate">{s.subtitle}</span>
                              {s.isPrivate ? (
                                <span role="img" aria-label="Private account" title="Private account" className="inline-flex shrink-0 text-text-3">
                                  <Lock size={12} />
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        {s.type === 'user' ? <ChevronRight size={16} className="shrink-0 text-text-3" aria-hidden="true" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </form>

        {activeQuery ? (
          <Tabs
            aria-label="Result type"
            tabs={TYPE_TABS.map((t) => ({ key: t.key, label: t.label }))}
            value={type}
            size="sm"
            onChange={(key) => switchType(isSearchType(key) ? key : 'all')}
          />
        ) : null}

        {/* ---------- People tab: live typeahead ---------- */}
        {liveTyping ? (
          <section aria-label={`People matching ${term.trim()}`} aria-live="polite" aria-busy={livePeople.isFetching || undefined} className="space-y-2">
            <SubHeading>People</SubHeading>
            {livePeople.isPending && !livePeople.data ? (
              <>
                <UserRowSkeleton />
                <UserRowSkeleton />
              </>
            ) : livePeople.isError ? (
              <ErrorState title="Search failed" error={livePeople.error} retry={() => void livePeople.refetch()} />
            ) : livePeople.data?.length ? (
              livePeople.data.map((u) => <UserRow key={u._id} user={u as PublicUser} />)
            ) : livePeople.settled ? (
              <EmptyState variant="no-results" size="sm" title={`No one matches “${term.trim()}”`} message="Check the spelling, or try their @username." />
            ) : null}
          </section>
        ) : null}

        {/* ---------- landing state: recent + trending ---------- */}
        {!activeQuery && !liveTyping ? (
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
                  {trendingUsers.length ? (
                    <div className="space-y-2">
                      <h3 className="type-label text-text-2">{popularHeading}</h3>
                      <div className="space-y-2">
                        {trendingUsers.map((u) => (
                          <UserRow key={u._id} user={u} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {!trending.data?.hashtags?.length && !trendingUsers.length ? (
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
            message={
              all
                ? 'Check the spelling, try fewer words, or search a hashtag instead.'
                : `Nothing in ${TYPE_TABS.find((t) => t.key === type)?.label.toLowerCase() ?? 'this tab'} matches. Try the All tab or fewer words.`
            }
            action={all ? { label: 'Clear search', onClick: clearAll, variant: 'secondary' } : { label: 'Search everything', onClick: () => switchType('all'), variant: 'secondary' }}
          />
        ) : null}

        {activeQuery && results.isSuccess && !nothingFound ? (
          <div className="space-y-8">
            {hashtagsShown.items.length ? (
              <section aria-labelledby="res-hashtags">
                <SubHeading action={hashtagsShown.more > 0 ? <SeeAll label="See all hashtags" onClick={() => switchType('hashtags')} /> : undefined}>
                  <span id="res-hashtags">Hashtags</span>
                </SubHeading>
                <HashtagList hashtags={hashtagsShown.items} />
              </section>
            ) : null}

            {peopleShown.items.length ? (
              <section aria-labelledby="res-people" className="space-y-2">
                <SubHeading action={peopleShown.more > 0 ? <SeeAll label="See all people" onClick={() => switchType('users')} /> : undefined}>
                  <span id="res-people">People</span>
                </SubHeading>
                {peopleShown.items.map((u) => (
                  <UserRow key={u._id} user={u} />
                ))}
              </section>
            ) : null}

            {workoutsShown.items.length ? (
              <section aria-labelledby="res-workouts">
                <SubHeading action={workoutsShown.more > 0 ? <SeeAll label="See all workouts" onClick={() => switchType('workouts')} /> : undefined}>
                  <span id="res-workouts">Workouts</span>
                </SubHeading>
                <div className="grid gap-3 sm:grid-cols-2">
                  {workoutsShown.items.map((w) => (
                    <WorkoutTile key={w._id} workout={w} />
                  ))}
                </div>
              </section>
            ) : null}

            {mealsShown.items.length ? (
              <section aria-labelledby="res-meals">
                <SubHeading action={mealsShown.more > 0 ? <SeeAll label="See all meals" onClick={() => switchType('meals')} /> : undefined}>
                  <span id="res-meals">Meals</span>
                </SubHeading>
                <div className="grid gap-3 sm:grid-cols-2">
                  {mealsShown.items.map((m) => (
                    <MealTile key={m._id} meal={m} />
                  ))}
                </div>
              </section>
            ) : null}

            {challengesShown.items.length ? (
              <section aria-labelledby="res-challenges">
                <SubHeading action={challengesShown.more > 0 ? <SeeAll label="See all challenges" onClick={() => switchType('challenges')} /> : undefined}>
                  <span id="res-challenges">Challenges</span>
                </SubHeading>
                <div className="grid gap-3 sm:grid-cols-2">
                  {challengesShown.items.map((c) => (
                    <ChallengeTile key={c._id} challenge={c} />
                  ))}
                </div>
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
