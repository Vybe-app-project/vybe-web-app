import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced, type Post, type PublicUser } from '../lib/hooks';
import { ButtonLink, Callout, EmptyState, ErrorState, PageHeader, SearchField, SegmentedControl, cx } from './ui';
import { Award, Search as SearchIcon } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import UserRow, { UserRowSkeleton } from './UserRow';
import { SuggestionList } from './SuggestionRow';

type TabKey = 'recommended' | 'trending' | 'people' | 'coaches';

/** The old Discover page is this hub's people tab, so it keeps that name. */
const TABS: { key: TabKey; label: string }[] = [
  { key: 'recommended', label: 'For you' },
  { key: 'trending', label: 'Trending' },
  { key: 'people', label: 'Discover' },
  { key: 'coaches', label: 'Coaches' },
];

const isTabKey = (v: string): v is TabKey => TABS.some((t) => t.key === v);

/** The band's context line: "Saturday, 20 September" in the viewer's locale. */
const todayLine = () => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function PostList({
  queryKey,
  feed,
  emptyTitle,
  emptyMessage,
}: {
  queryKey: string;
  feed: 'recommended' | 'trending';
  emptyTitle: string;
  emptyMessage: string;
}) {
  const endpoint = feed === 'recommended' ? '/posts/recommended' : '/posts/all/trendings';
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params: { page: 1, limit: 20 } });
      return (data.posts || []) as Post[];
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    );

  if (isError) return <ErrorState title="Could not load posts" error={error} retry={() => void refetch()} />;

  if (!data?.length)
    return (
      <EmptyState
        title={emptyTitle}
        message={emptyMessage}
        action={{ label: 'Find people to follow', to: '/search', variant: 'secondary' }}
      />
    );

  return (
    <div className="space-y-4">
      {data.map((post) => (
        <PostCard key={post._id} post={post} invalidate={[[queryKey], ['feed']]} />
      ))}
    </div>
  );
}

function PeopleList({
  queryKey,
  audience,
  search,
  emptyTitle,
  emptyMessage,
}: {
  queryKey: string;
  audience: 'people' | 'coaches';
  search: string;
  emptyTitle: string;
  emptyMessage: string;
}) {
  const endpoint = audience === 'people' ? '/users/all/search' : '/users/coaches';
  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: [queryKey, search],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params: search ? { q: search } : {} });
      return (data.users || data.coaches || []) as PublicUser[];
    },
  });

  if (isLoading)
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <UserRowSkeleton key={i} />
        ))}
      </div>
    );

  if (isError) return <ErrorState title="Could not load people" error={error} retry={() => void refetch()} />;

  if (!data?.length)
    return (
      <EmptyState
        variant={search ? 'no-results' : 'first-run'}
        size="sm"
        title={search ? `No matches for “${search}”` : emptyTitle}
        message={search ? 'Try a different name or username.' : emptyMessage}
      />
    );

  return (
    <div className={cx('space-y-2 transition-opacity dur-2', isPlaceholderData && 'opacity-60')} aria-busy={isPlaceholderData || undefined}>
      {data.map((user) => (
        <UserRow key={user._id} user={user} />
      ))}
    </div>
  );
}

export default function Discover() {
  // ?tab=people (the first-week card's "Follow someone", the WelcomeSheet's
  // "See more") opens that tab; the URL follows the tab so Back returns to it.
  const [params, setParams] = useSearchParams();
  const urlTab = params.get('tab');
  const [tab, setTab] = useState<TabKey>(urlTab && isTabKey(urlTab) ? urlTab : 'recommended');
  useEffect(() => {
    if (urlTab && isTabKey(urlTab)) setTab(urlTab);
  }, [urlTab]);
  const selectTab = (key: TabKey) => {
    setTab(key);
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (key === 'recommended') n.delete('tab');
        else n.set('tab', key);
        return n;
      },
      { replace: true },
    );
  };
  const [peopleQuery, setPeopleQuery] = useState('');
  const [coachQuery, setCoachQuery] = useState('');
  const peopleSearch = useDebounced(peopleQuery.trim(), 300);
  const coachSearch = useDebounced(coachQuery.trim(), 300);

  return (
    <>
      {/* The Explore hub wears the band; the shell renders it. Its one action is the search
          the hub is for, so the page body keeps to tonal controls. */}
      <PageHeader
        title="Explore"
        subtitle="Fresh posts, trending workouts and people worth following."
        band={{
          context: todayLine(),
          children: <p className="text-sm text-band-ink-2">Fresh posts, trending workouts and people worth following.</p>,
          action: (
            <ButtonLink to="/search" variant="primary" size="lg" icon={<SearchIcon size={18} />}>
              Search Vybe
            </ButtonLink>
          ),
        }}
      />
      <div className="w-full max-w-form space-y-section">
        {/* One underline row per screen: the hub's section tabs. These are a segmented control. */}
        <SegmentedControl
          aria-label="Explore"
          tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={tab}
          onChange={(key) => {
            if (isTabKey(key)) selectTab(key);
          }}
        />

        {tab === 'recommended' ? (
          <PostList
            queryKey="recommended-posts"
            feed="recommended"
            emptyTitle="Nothing recommended yet"
            emptyMessage="Follow a few athletes and react to posts so we can tune what shows up here."
          />
        ) : null}

        {tab === 'trending' ? (
          <PostList
            queryKey="trending-posts"
            feed="trending"
            emptyTitle="No trending posts right now"
            emptyMessage="Trending refreshes through the day as the community posts."
          />
        ) : null}

        {tab === 'people' ? (
          <div className="space-y-3">
            <SearchField
              label="Search people"
              hideLabel
              placeholder="Search people by name or username"
              value={peopleQuery}
              enterKeyHint="search"
              onChange={(e) => setPeopleQuery(e.target.value)}
            />
            {peopleSearch ? (
              <PeopleList
                queryKey="discover-people"
                audience="people"
                search={peopleSearch}
                emptyTitle="No one to show yet"
                emptyMessage="People appear here as they join Vybe. Try searching by name or username."
              />
            ) : (
              /* No query: people to follow with the reason next to every name (GET /searching/suggest). */
              <SuggestionList
                limit={10}
                heading="For you"
                emptyState={
                  <EmptyState
                    variant="first-run"
                    size="sm"
                    title="No one to show yet"
                    message="People appear here as they join Vybe. Try searching by name or username."
                  />
                }
              />
            )}
          </div>
        ) : null}

        {tab === 'coaches' ? (
          <div className="space-y-3">
            <SearchField
              label="Search coaches"
              hideLabel
              placeholder="Search coaches by name or speciality"
              value={coachQuery}
              enterKeyHint="search"
              onChange={(e) => setCoachQuery(e.target.value)}
            />
            <PeopleList
              queryKey="discover-coaches"
              audience="coaches"
              search={coachSearch}
              emptyTitle="No coaches yet"
              emptyMessage="Verified coaches show up here as they join Vybe."
            />
            <Callout
              tone="brand"
              icon={<Award size={20} className="text-brand" />}
              title="Are you a coach?"
              action={
                <ButtonLink to="/settings#coaching" variant="secondary" size="sm">
                  Apply
                </ButtonLink>
              }
            >
              Apply from Settings to get the Coach badge and a place in this directory.
            </Callout>
          </div>
        ) : null}
      </div>
    </>
  );
}
