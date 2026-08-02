import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { Link } from 'react-router-dom';
import { api, errMsg, mediaUrl } from '../lib/api';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Spinner,
  Tabs,
  useToast,
} from './ui';
import { Check, Users, X } from './icons';

type PublicUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  bio?: string;
  isVerified?: boolean;
};

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

function PersonRow({
  user,
  meta,
  actions,
}: {
  user?: PublicUser;
  meta?: string;
  actions?: React.ReactNode;
}) {
  if (!user) return null;
  return (
    <li className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-[var(--color-surface-2)]">
      <Avatar src={mediaUrl(user.avatar)} name={user.fullName || user.username} size={44} />
      <div className="min-w-0 flex-1">
        <Link
          to={`/u/${user.username || user._id}`}
          className="flex items-center gap-2 truncate text-sm font-medium hover:underline"
        >
          {user.fullName || user.username || 'Member'}
          {user.isVerified && <Badge>Verified</Badge>}
        </Link>
        <p className="truncate text-xs text-[var(--color-muted)]">
          @{user.username}
          {meta ? ` · ${meta}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </li>
  );
}

function ListShell({
  query,
  emptyTitle,
  emptyDescription,
  children,
  count,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
  count: number;
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={errMsg(query.error)} onRetry={() => query.refetch()} />;
  }
  if (count === 0) {
    return <EmptyState icon={<Users />} title={emptyTitle} description={emptyDescription} />;
  }
  return <ul className="divide-y divide-[var(--color-line)]">{children}</ul>;
}

export default function Friends() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('friends');
  const [search, setSearch] = useState('');
  const [removeTarget, setRemoveTarget] = useState<PublicUser | null>(null);
  const [inviteId, setInviteId] = useState('');

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
      setInviteId('');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send the request')),
  });

  const acceptFriend = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/friends/requests/${requestId}/accept`);
    },
    onSuccess: () => {
      toast.success('Friend request accepted');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not accept the request')),
  });

  const declineFriend = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/friends/requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Request removed');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not remove the request')),
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
      toast.error(errMsg(e, 'Could not remove this friend'));
      setRemoveTarget(null);
    },
  });

  const acceptFollow = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/users/follow-requests/${requestId}/accept`);
    },
    onSuccess: () => {
      toast.success('Follow request accepted');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not accept the follow request')),
  });

  const rejectFollow = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/users/follow-requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Follow request rejected');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not reject the follow request')),
  });

  const visibleFriends = useMemo(() => {
    const list = friends.data || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) =>
      `${u.fullName || ''} ${u.username || ''}`.toLowerCase().includes(q),
    );
  }, [friends.data, search]);

  const tabs = [
    { value: 'friends', label: `Friends${friends.data ? ` (${friends.data.length})` : ''}` },
    { value: 'pending', label: `Requests${pending.data?.length ? ` (${pending.data.length})` : ''}` },
    { value: 'sent', label: `Sent${sent.data?.length ? ` (${sent.data.length})` : ''}` },
    {
      value: 'follows',
      label: `Follow requests${followRequests.data?.length ? ` (${followRequests.data.length})` : ''}`,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Friends</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Manage your friendships, incoming requests and follow approvals.
        </p>
      </header>

      <div className="card p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = inviteId.trim();
            if (id) sendRequest.mutate(id);
          }}
        >
          <Input
            placeholder="Send a friend request by user ID"
            value={inviteId}
            onChange={(e) => setInviteId(e.target.value)}
          />
          <Button type="submit" disabled={!inviteId.trim() || sendRequest.isPending}>
            {sendRequest.isPending ? <Spinner size={16} /> : 'Send'}
          </Button>
        </form>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="card overflow-hidden">
        {tab === 'friends' && (
          <>
            <div className="border-b border-[var(--color-line)] p-3">
              <Input
                placeholder="Search friends"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ListShell
              query={friends}
              count={visibleFriends.length}
              emptyTitle="No friends yet"
              emptyDescription="Send a request to start building your circle."
            >
              {visibleFriends.map((u) => (
                <PersonRow
                  key={u._id}
                  user={u}
                  actions={
                    <Button variant="ghost" onClick={() => setRemoveTarget(u)}>
                      Remove
                    </Button>
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
            emptyTitle="No pending requests"
            emptyDescription="Incoming friend requests will show up here."
          >
            {(pending.data || []).map((r) => (
              <PersonRow
                key={r._id}
                user={r.sender}
                meta={ago(r.createdAt)}
                actions={
                  <>
                    <Button
                      disabled={acceptFriend.isPending}
                      onClick={() => acceptFriend.mutate(r._id)}
                    >
                      <Check /> Accept
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={declineFriend.isPending}
                      onClick={() => declineFriend.mutate(r._id)}
                    >
                      <X /> Decline
                    </Button>
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
            emptyTitle="No sent requests"
            emptyDescription="Requests you send stay here until answered."
          >
            {(sent.data || []).map((r) => (
              <PersonRow
                key={r._id}
                user={r.receiver}
                meta={`sent ${ago(r.createdAt)}`}
                actions={
                  <Button
                    variant="ghost"
                    disabled={declineFriend.isPending}
                    onClick={() => declineFriend.mutate(r._id)}
                  >
                    Cancel
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
            emptyTitle="No follow requests"
            emptyDescription="People asking to follow your private profile appear here."
          >
            {(followRequests.data || []).map((r) => (
              <PersonRow
                key={r._id}
                user={r.requester}
                meta={ago(r.createdAt)}
                actions={
                  <>
                    <Button
                      disabled={acceptFollow.isPending}
                      onClick={() => acceptFollow.mutate(r._id)}
                    >
                      <Check /> Accept
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={rejectFollow.isPending}
                      onClick={() => rejectFollow.mutate(r._id)}
                    >
                      <X /> Reject
                    </Button>
                  </>
                }
              />
            ))}
          </ListShell>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove friend"
        description={`${removeTarget?.fullName || removeTarget?.username || 'This person'} will be removed from your friends.`}
        confirmLabel="Remove"
        destructive
        loading={removeFriend.isPending}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeFriend.mutate(removeTarget._id)}
      />
    </div>
  );
}
