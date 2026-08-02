import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import type { Post, PublicUser } from '../lib/hooks';
import { Button, EmptyState, ErrorState, Input, Tabs } from './ui';
import { Search as SearchIcon } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';
import UserRow, { UserRowSkeleton } from './UserRow';

type TabKey = 'recommended' | 'trending' | 'people' | 'coaches';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'recommended', label: 'For you' },
  { key: 'trending', label: 'Trending' },
  { key: 'people', label: 'People' },
  { key: 'coaches', label: 'Coaches' },
];

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
  const endpoint = feed === 'recommended'
    ? '/posts/recommended'
    : '/posts/all/trendings';
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params: { page: 1, limit: 20 } });
      return (data.posts || []) as Post[];
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    );

  if (isError)
    return (
      <ErrorState
        title="Could not load posts"
        message={errMsg(error, 'Please try again in a moment.')}
        action={
          <Button variant="primary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );

  if (!data?.length) return <EmptyState title={emptyTitle} message={emptyMessage} />;

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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [queryKey, search],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params: search ? { q: search } : {} });
      return (data.users || data.coaches || []) as PublicUser[];
    },
  });

  if (isLoading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <UserRowSkeleton key={i} />
        ))}
      </div>
    );

  if (isError)
    return (
      <ErrorState
        title="Could not load people"
        message={errMsg(error, 'Please try again in a moment.')}
        action={
          <Button variant="primary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );

  if (!data?.length) return <EmptyState title={emptyTitle} message={emptyMessage} />;

  return (
    <div className="space-y-3">
      {data.map((user) => (
        <UserRow key={user._id} user={user} />
      ))}
    </div>
  );
}

export default function Discover() {
  const [tab, setTab] = useState<TabKey>('recommended');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [coachQuery, setCoachQuery] = useState('');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold">Discover</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Fresh posts, trending workouts and people worth following.
        </p>
      </header>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(key) => setTab(key as TabKey)}
      />

      {tab === 'recommended' && (
        <PostList
          queryKey="recommended-posts"
          feed="recommended"
          emptyTitle="Nothing recommended yet"
          emptyMessage="Follow a few athletes and interact with posts so we can tune your recommendations."
        />
      )}

      {tab === 'trending' && (
        <PostList
          queryKey="trending-posts"
          feed="trending"
          emptyTitle="No trending posts"
          emptyMessage="Check back soon — trending posts refresh throughout the day."
        />
      )}

      {tab === 'people' && (
        <div className="space-y-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <Input
              className="!pl-9"
              placeholder="Search people by name or username"
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              aria-label="Search people"
            />
          </div>
          <PeopleList
            queryKey="discover-people"
            audience="people"
            search={peopleQuery.trim()}
            emptyTitle="No people found"
            emptyMessage="Try a different name or username."
          />
        </div>
      )}

      {tab === 'coaches' && (
        <div className="space-y-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <Input
              className="!pl-9"
              placeholder="Search coaches by name or speciality"
              value={coachQuery}
              onChange={(e) => setCoachQuery(e.target.value)}
              aria-label="Search coaches"
            />
          </div>
          <PeopleList
            queryKey="discover-coaches"
            audience="coaches"
            search={coachQuery.trim()}
            emptyTitle="No coaches found"
            emptyMessage="Try another speciality, or check back as more coaches join Vybe."
          />
        </div>
      )}
    </div>
  );
}
