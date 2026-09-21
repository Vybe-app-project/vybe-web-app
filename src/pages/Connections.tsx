import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  displayName,
  followerCount,
  followingCount,
  useDebounced,
  useInfiniteScroll,
  type PublicUser,
} from '../lib/hooks';
import { Button, ButtonLink, EmptyState, ErrorState, PageHeader, SearchField, SegmentedControl, Spinner } from './ui';
import { Compass, Lock, UserPlus, Users } from './icons';
import UserRow, { UserRowSkeleton } from './UserRow';

export type ConnectionKind = 'followers' | 'following';
export const CONNECTION_KINDS: ConnectionKind[] = ['followers', 'following'];
export const isConnectionKind = (v: string | undefined): v is ConnectionKind =>
  v === 'followers' || v === 'following';

const PAGE_SIZE = 24;

type ConnectionsPage = {
  users: PublicUser[];
  pagination?: { page: number; limit: number; total: number; hasMore: boolean };
  total?: number;
};

/** A list of people reads best at feed width; the shell owns the gutter. */
const PAGE = 'mx-auto w-full max-w-feed space-y-section';

/**
 * Followers / Following lists (mobile parity with the follow-interaction
 * screen). Reached from the stat tiles on /profile and /u/:id, which were
 * inert or sent people to the Friends list, a different relationship.
 *
 * Routes: /profile/:kind for your own lists, /u/:id/:kind for anyone else's.
 * The API returns 404 for a private account you do not follow; that renders
 * as a locked state with the follow call to action rather than an error.
 */
export default function Connections() {
  const { id: routeId, kind: kindParam } = useParams<{ id?: string; kind?: string }>();
  const { pathname } = useLocation();
  const me = useAuth((s) => s.user);
  const own = pathname.startsWith('/profile');
  const kind: ConnectionKind | null = isConnectionKind(kindParam) ? kindParam : null;
  const id = own ? String(me?._id || '') : String(routeId || '');
  const base = own ? '/profile' : `/u/${id}`;

  const [term, setTerm] = useState('');
  const searchKey = useDebounced(term.trim(), 300);
  useEffect(() => setTerm(''), [kind, id]);

  const owner = useQuery({
    queryKey: own ? ['me'] : ['user', id],
    enabled: !!id && !!kind,
    queryFn: async () => {
      const { data } = await api.get(own ? '/users/me' : `/users/${id}`);
      return (data.user || data) as PublicUser;
    },
    initialData: own ? ((me as PublicUser) ?? undefined) : undefined,
  });

  const list = useInfiniteQuery({
    queryKey: ['connections', id, kind, searchKey],
    enabled: !!id && !!kind,
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get(`/users/statistics/conn/all/social/populate/${id}/connections`, {
        params: { type: kind, page: pageParam, limit: PAGE_SIZE, ...(searchKey ? { searchKey } : {}) },
      });
      return (data.data || data) as ConnectionsPage;
    },
    getNextPageParam: (last, all) => (last.pagination?.hasMore ? all.length + 1 : undefined),
  });

  const people = useMemo(() => list.data?.pages.flatMap((p) => p.users || []) ?? [], [list.data]);
  const total = list.data?.pages[0]?.pagination?.total ?? list.data?.pages[0]?.total;
  const sentinelRef = useInfiniteScroll(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, Boolean(list.hasNextPage));

  if (!kind || !id) return <Navigate to={own ? '/profile' : routeId ? `/u/${routeId}` : '/discover'} replace />;
  // Your own id in the /u/ form is the same page as /profile/:kind.
  if (!own && me && String(me._id) === id) return <Navigate to={`/profile/${kind}`} replace />;

  const ownerUser = owner.data;
  const name = own ? 'You' : displayName(ownerUser);
  const status = (list.error as { response?: { status?: number } } | null)?.response?.status;
  const locked = list.isError && status === 404 && !own;
  const noun = kind === 'followers' ? 'followers' : 'following';
  const heading = kind === 'followers' ? 'Followers' : 'Following';

  const tabs = [
    {
      key: 'followers',
      label: 'Followers',
      count: ownerUser ? followerCount(ownerUser) : undefined,
      to: `${base}/followers`,
      icon: <Users size={16} />,
    },
    {
      key: 'following',
      label: 'Following',
      count: ownerUser ? followingCount(ownerUser) : undefined,
      to: `${base}/following`,
      icon: <UserPlus size={16} />,
    },
  ];

  const empty = searchKey ? (
    <EmptyState variant="no-results" size="sm" title={`No one matches “${searchKey}”`} message="Check the spelling or clear the search." />
  ) : own ? (
    kind === 'followers' ? (
      <EmptyState
        family="social"
        title="No followers yet"
        message="Share your profile, post a session or follow people you train with; followers usually follow back."
        action={{ label: 'Explore people', to: '/discover', icon: <Compass size={18} /> }}
      />
    ) : (
      <EmptyState
        family="social"
        title="Not following anyone yet"
        message="Follow athletes and coaches to fill your feed with their sessions, meals and wins."
        action={{ label: 'Explore people', to: '/discover', icon: <Compass size={18} /> }}
      />
    )
  ) : (
    <EmptyState
      variant="no-results"
      icon={kind === 'followers' ? <Users size={26} /> : <UserPlus size={26} />}
      title={kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
      message={kind === 'followers' ? `${name} doesn’t have followers yet.` : `${name} isn’t following anyone yet.`}
    />
  );

  return (
    <div className={PAGE}>
      <PageHeader
        title={own ? heading : `${name}’s ${noun}`}
        subtitle={own ? 'Who follows you, and who you follow.' : undefined}
        back={base}
      />

      <section className="space-y-4" aria-label={`${name}’s connections`}>
        {/* The shell's section tabs are the only underline tabs; a page switch is the sliding segmented control. */}
        <SegmentedControl aria-label="Connections" tabs={tabs} value={kind} />

        {locked ? (
          <EmptyState
            icon={<Lock size={26} />}
            title="This list is private"
            message={`Follow ${name} to see who they follow and who follows them. They approve requests themselves.`}
            action={<ButtonLink to={base} variant="primary">Back to profile</ButtonLink>}
          />
        ) : (
          <>
            <SearchField
              label={`Search ${noun}`}
              hideLabel
              placeholder={`Search ${noun}`}
              value={term}
              maxLength={100}
              onChange={(e) => setTerm(e.target.value)}
              enterKeyHint="search"
            />

            {list.isLoading || owner.isLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label={`Loading ${noun}`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <UserRowSkeleton key={i} />
                ))}
              </div>
            ) : list.isError ? (
              <ErrorState
                error={list.error}
                title={`${heading} unavailable`}
                message={errMsg(list.error, 'The list did not load.')}
                onRetry={() => list.refetch()}
              />
            ) : people.length === 0 ? (
              empty
            ) : (
              <>
                <p className="t-meta">
                  {typeof total === 'number'
                    ? `${total.toLocaleString()} ${searchKey ? 'match' : 'account'}${total === 1 ? '' : searchKey ? 'es' : 's'}`
                    : null}
                </p>
                <ul className="space-y-2" aria-label={heading}>
                  {people.map((u) => (
                    <li key={u._id}>
                      <UserRow user={u} />
                    </li>
                  ))}
                </ul>
                <div ref={sentinelRef} aria-hidden="true" />
                {list.hasNextPage ? (
                  <div className="flex justify-center py-2">
                    <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                      Show more
                    </Button>
                  </div>
                ) : list.isFetchingNextPage ? (
                  <div className="flex justify-center py-2">
                    <Spinner />
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
