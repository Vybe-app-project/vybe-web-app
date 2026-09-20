import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg } from '../lib/api';
import { displayName, type PublicUser, useIsCompact } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  PageHeader,
  SearchField,
  SkeletonRow,
  Tabs,
  cx,
  useToast,
} from './ui';
import { Check, Compass, MessageCircle, User, UserPlus, Users, X } from './icons';
import { PrivateMark, ROW_LINK, UserBadges } from './UserRow';
import PeopleSearch, { type Person } from './PeopleSearch';
import { SuggestionList } from './SuggestionRow';

type FriendRequest = {
  _id: string;
  sender?: PublicUser;
  receiver?: PublicUser;
  createdAt?: string;
};

type FollowRequest = {
  _id: string;
  requester?: PublicUser;
  createdAt?: string;
};

type TabKey = 'friends' | 'pending' | 'sent' | 'follows';
const TAB_KEYS: TabKey[] = ['friends', 'pending', 'sent', 'follows'];
const isTab = (v: string | null): v is TabKey => !!v && (TAB_KEYS as string[]).includes(v);

const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

/* ------------------------------------------------------------------ rows */

function PersonRow({ user, meta, actions }: { user?: PublicUser; meta?: string; actions?: ReactNode }) {
  if (!user) return null;
  const name = displayName(user);
  const href = `/u/${user._id}`;
  return (
    <li className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors dur-1 hover:bg-surface-2 sm:px-4">
      <Link to={href} viewTransition className="shrink-0 rounded-full" aria-label={`Open ${name}’s profile`}>
        <Avatar src={user.avatar} name={name} size={44} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-x-2">
          <Link to={href} viewTransition className={ROW_LINK}>
            {name}
          </Link>
          <UserBadges user={user} compact />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-text-2">
          <span className="truncate">@{user.username}</span>
          {meta ? <span className="shrink-0 text-text-3">{meta}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </li>
  );
}

function ListShell({
  query,
  count,
  empty,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  count: number;
  empty: ReactNode;
  children: ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-1 p-3" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} className="px-1" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (count === 0) return <>{empty}</>;
  return <ul className="divide-y divide-line">{children}</ul>;
}

/* ------------------------------------------------------------------ page */

export default function Friends() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabKey = isTab(tabParam) ? tabParam : 'friends';
  const setTab = (next: string) =>
    setParams(
      (prev) => {
        if (next === 'friends') prev.delete('tab');
        else prev.set('tab', next);
        return prev;
      },
      { replace: true },
    );

  const [filter, setFilter] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [removeTarget, setRemoveTarget] = useState<PublicUser | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['friends'] });
    qc.invalidateQueries({ queryKey: ['followRequests'] });
  };

  const friends = useQuery({
    queryKey: ['friends', 'list'],
    queryFn: async () => {
      const { data } = await api.get('/friends/list');
      return (data.friends || []) as PublicUser[];
    },
  });

  const pending = useQuery({
    queryKey: ['friends', 'pending'],
    queryFn: async () => {
      const { data } = await api.get('/friends/pending');
      return (data.requests || []) as FriendRequest[];
    },
  });

  const sent = useQuery({
    queryKey: ['friends', 'sent'],
    queryFn: async () => {
      const { data } = await api.get('/friends/sent');
      return (data.requests || []) as FriendRequest[];
    },
  });

  const followRequests = useQuery({
    queryKey: ['followRequests'],
    queryFn: async () => {
      const { data } = await api.get('/users/follow-requests');
      return (data.requests || []) as FollowRequest[];
    },
  });

  const sendRequest = useMutation({
    mutationFn: async (receiverId: string) => {
      await api.post('/friends/send', { receiverId });
    },
    onSuccess: () => {
      toast.success('Friend request sent');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send the request.')),
  });

  const acceptFriend = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/friends/requests/${requestId}/accept`);
    },
    onSuccess: () => {
      toast.success('Friend request accepted');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not accept the request.')),
  });

  // The receiver declines an incoming request through /friends/incoming/:id;
  // the sender withdraws one through /friends/requests/:id. Declining used to
  // call the sender's route, which answered 404 and left the request pending.
  const declineFriend = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/friends/incoming/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Request removed');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not remove the request.')),
  });
  const withdrawRequest = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/friends/requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Request removed');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not remove the request.')),
  });

  const removeFriend = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/friends/${userId}`);
    },
    onSuccess: () => {
      toast.success('Friend removed');
      setRemoveTarget(null);
      invalidate();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not remove this friend.'));
      setRemoveTarget(null);
    },
  });

  const acceptFollow = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/users/follow-requests/${requestId}/accept`);
    },
    onSuccess: () => {
      toast.success('Follow request approved');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not approve the follow request.')),
  });

  const rejectFollow = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/users/follow-requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Follow request declined');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not decline the follow request.')),
  });

  const visibleFriends = useMemo(() => {
    const list = friends.data || [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => `${u.fullName || ''} ${u.username || ''}`.toLowerCase().includes(q));
  }, [friends.data, filter]);

  /** Relationship lookup for the people-search results. */
  const relationship = useMemo(() => {
    const map = new Map<string, { status: 'friends' | 'requested' | 'incoming'; requestId?: string }>();
    for (const u of friends.data || []) map.set(String(u._id), { status: 'friends' });
    for (const r of sent.data || []) if (r.receiver?._id) map.set(String(r.receiver._id), { status: 'requested', requestId: r._id });
    for (const r of pending.data || []) if (r.sender?._id) map.set(String(r.sender._id), { status: 'incoming', requestId: r._id });
    return map;
  }, [friends.data, sent.data, pending.data]);

  const compact = useIsCompact();

  const tabs = [
    { key: 'friends', label: 'Friends', count: friends.data?.length, icon: compact ? undefined : <Users size={16} /> },
    { key: 'pending', label: 'Requests', count: pending.data?.length || undefined, icon: compact ? undefined : <UserPlus size={16} /> },
    { key: 'sent', label: 'Sent', count: sent.data?.length || undefined },
    { key: 'follows', label: 'Follow requests', count: followRequests.data?.length || undefined },
  ];

  const searching = peopleQuery.trim().length >= 1;

  return (
    <div className="mx-auto w-full max-w-[52rem] space-y-6">
      <PageHeader
        title="Friends"
        subtitle="Your circle, plus the requests waiting on you."
        actions={
          <ButtonLink to="/discover" variant="secondary" icon={<Compass size={18} />}>
            Explore people
          </ButtonLink>
        }
        mobileActions={
          <IconButton to="/discover" label="Explore people">
            <Compass size={22} />
          </IconButton>
        }
      />

      {/* Add a friend: the shared people typeahead, results as you type. */}
      <Card className="space-y-3">
        <PeopleSearch
          query={peopleQuery}
          onQueryChange={setPeopleQuery}
          label="Add a friend"
          hideLabel={false}
          hint={searching ? undefined : 'Search by name or username.'}
          placeholder="Search people"
          recent={false}
          trailingInteractive
          emptyState={<span className="sr-only">Type to search people on Vybe.</span>}
          listClassName="min-h-0 max-h-[24rem]"
          onPick={(u) => navigate(`/u/${u._id}`, { viewTransition: true })}
          trailing={(u: Person) => {
            const rel = relationship.get(String(u._id));
            if (rel?.status === 'friends' || u.isFriend) {
              return (
                <Badge tone="brand" className="h-10 px-3">
                  <Check size={14} />
                  Friends
                </Badge>
              );
            }
            if (rel?.status === 'incoming' && rel.requestId) {
              return (
                <Button
                  variant="primary"
                  icon={<Check size={16} />}
                  loading={acceptFriend.isPending && acceptFriend.variables === rel.requestId}
                  onClick={() => acceptFriend.mutate(rel.requestId!)}
                >
                  Accept
                </Button>
              );
            }
            if (rel?.status === 'requested' || u.friendStatus === 'requested') {
              return (
                <Button
                  variant="secondary"
                  title="Withdraw request"
                  loading={withdrawRequest.isPending && withdrawRequest.variables === rel?.requestId}
                  onClick={() => rel?.requestId && withdrawRequest.mutate(rel.requestId)}
                >
                  Requested
                </Button>
              );
            }
            return (
              <Button
                variant="primary"
                icon={<UserPlus size={16} />}
                loading={sendRequest.isPending && sendRequest.variables === u._id}
                onClick={() => sendRequest.mutate(u._id)}
              >
                Add
              </Button>
            );
          }}
        />
      </Card>

      {/* People to follow, with the reason next to every name (GET /searching/suggest). */}
      <Card className="space-y-3">
        <SuggestionList
          limit={5}
          heading="For you"
          emptyState={
            <EmptyState
              variant="first-run"
              size="sm"
              title="Follow people from your gym or contacts"
              message="Suggestions appear here as people you may know join Vybe."
              action={{ label: 'Explore people', to: '/discover', variant: 'secondary', icon: <Compass size={18} /> }}
            />
          }
        />
      </Card>

      <section className="space-y-4" aria-label="Friends and requests">
        <Tabs aria-label="Friends lists" tabs={tabs} value={tab} onChange={setTab} size={compact ? 'sm' : 'md'} />

        <Card padded={false} className={cx('overflow-hidden', 'anim-fade-in')} key={tab}>
          {tab === 'friends' && (
            <>
              {(friends.data?.length || 0) > 5 ? (
                <div className="border-b border-line p-3 sm:p-4">
                  <SearchField
                    label="Filter friends"
                    hideLabel
                    placeholder="Filter by name"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
              ) : null}
              <ListShell
                query={friends}
                count={visibleFriends.length}
                empty={
                  filter.trim() ? (
                    <EmptyState variant="no-results" size="sm" title="No friends match" message="Try a different name." />
                  ) : (
                    <EmptyState
                      title="No friends yet"
                      message="Search for people above, or explore who is training near you."
                      action={{ label: 'Explore people', to: '/discover', icon: <Compass size={18} /> }}
                    />
                  )
                }
              >
                {visibleFriends.map((u) => (
                  <PersonRow
                    key={u._id}
                    user={u}
                    actions={
                      <>
                        <IconButton to={`/messages/new?to=${u._id}`} state={{ peer: u }} label={`Message ${displayName(u)}`}>
                          <MessageCircle size={20} />
                        </IconButton>
                        <Menu
                          label={`More options for ${displayName(u)}`}
                          items={[
                            { label: 'View profile', icon: <User size={18} />, to: `/u/${u._id}` },
                            { label: 'Remove friend', icon: <X size={18} />, danger: true, divider: true, onSelect: () => setRemoveTarget(u) },
                          ]}
                        />
                      </>
                    }
                  />
                ))}
              </ListShell>
            </>
          )}

          {tab === 'pending' && (
            <ListShell
              query={pending}
              count={pending.data?.length || 0}
              empty={
                <EmptyState
                  variant="no-results"
                  icon={<UserPlus size={26} />}
                  title="No requests waiting"
                  message="When someone asks to be your friend, you can accept or decline it here."
                />
              }
            >
              {(pending.data || []).map((r) => (
                <PersonRow
                  key={r._id}
                  user={r.sender}
                  meta={ago(r.createdAt)}
                  actions={
                    <>
                      <Button
                        variant="primary"
                        icon={<Check size={16} />}
                        loading={acceptFriend.isPending && acceptFriend.variables === r._id}
                        disabled={declineFriend.isPending}
                        onClick={() => acceptFriend.mutate(r._id)}
                      >
                        Accept
                      </Button>
                      <IconButton
                        label={`Decline ${displayName(r.sender)}`}
                        disabled={acceptFriend.isPending || declineFriend.isPending}
                        onClick={() => declineFriend.mutate(r._id)}
                      >
                        <X size={20} />
                      </IconButton>
                    </>
                  }
                />
              ))}
            </ListShell>
          )}

          {tab === 'sent' && (
            <ListShell
              query={sent}
              count={sent.data?.length || 0}
              empty={
                <EmptyState
                  variant="no-results"
                  icon={<UserPlus size={26} />}
                  title="Nothing pending"
                  message="Requests you send stay here until they are answered."
                  action={{ label: 'Explore people', to: '/discover', variant: 'secondary' }}
                />
              }
            >
              {(sent.data || []).map((r) => (
                <PersonRow
                  key={r._id}
                  user={r.receiver}
                  meta={`Sent ${ago(r.createdAt)}`}
                  actions={
                    <Button
                      variant="secondary"
                      loading={withdrawRequest.isPending && withdrawRequest.variables === r._id}
                      onClick={() => withdrawRequest.mutate(r._id)}
                    >
                      Withdraw
                    </Button>
                  }
                />
              ))}
            </ListShell>
          )}

          {tab === 'follows' && (
            <ListShell
              query={followRequests}
              count={followRequests.data?.length || 0}
              empty={
                <EmptyState
                  variant="no-results"
                  icon={<Users size={26} />}
                  title="No follow requests"
                  message="When your profile is private, people asking to follow you appear here for approval."
                  action={{ label: 'Privacy settings', to: '/settings#privacy', variant: 'secondary' }}
                />
              }
            >
              {(followRequests.data || []).map((r) => (
                <PersonRow
                  key={r._id}
                  user={r.requester}
                  meta={ago(r.createdAt)}
                  actions={
                    <>
                      <Button
                        variant="primary"
                        icon={<Check size={16} />}
                        loading={acceptFollow.isPending && acceptFollow.variables === r._id}
                        disabled={rejectFollow.isPending}
                        onClick={() => acceptFollow.mutate(r._id)}
                      >
                        Approve
                      </Button>
                      <IconButton
                        label={`Decline ${displayName(r.requester)}`}
                        disabled={acceptFollow.isPending || rejectFollow.isPending}
                        onClick={() => rejectFollow.mutate(r._id)}
                      >
                        <X size={20} />
                      </IconButton>
                    </>
                  }
                />
              ))}
            </ListShell>
          )}
        </Card>
      </section>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${displayName(removeTarget)} as a friend?`}
        message="You can send a new request later. They will not be notified."
        confirmLabel="Remove friend"
        destructive
        loading={removeFriend.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeFriend.mutate(removeTarget._id)}
      />
    </div>
  );
}
