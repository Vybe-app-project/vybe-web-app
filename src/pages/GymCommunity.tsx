import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Tabs,
  useToast,
} from './ui';
import { Check, Users, X } from './icons';

type Community = {
  _id: string;
  name?: string;
  description?: string;
  vicinity?: string;
  category?: string;
  photos?: { url?: string }[];
  coverImage?: string;
  stats?: { totalMembers?: number; activeMembers?: number; totalPosts?: number };
  isMember?: boolean;
  userRole?: string | null;
  settings?: { isPublic?: boolean; requireApproval?: boolean };
  userMembership?: { status?: string; requestId?: string; requestedAt?: string };
};

type Member = {
  _id?: string;
  role?: string;
  joinedAt?: string;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string };
};

type MembershipRequest = {
  _id: string;
  requestedAt?: string;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string };
};

type CommunityPost = {
  _id: string;
  content?: string;
  createdAt?: string;
  media?: { uri?: string; url?: string; type?: string }[];
  author?: { _id: string; username?: string; fullName?: string; avatar?: string };
  likes?: unknown[];
  comments?: unknown[];
};

const PAGE = 20;

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

function useDebounced<T>(value: T, delay = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

const coverOf = (c: Community) => mediaUrl(c.coverImage || c.photos?.[0]?.url || '');

function CommunityCard({
  community,
  onOpen,
  action,
}: {
  community: Community;
  onOpen: () => void;
  action?: React.ReactNode;
}) {
  const cover = coverOf(community);
  return (
    <article className="card overflow-hidden">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="h-28 w-full bg-[var(--color-surface-2)]">
          {cover ? (
            <img src={cover} alt={community.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
              <Users />
            </span>
          )}
        </div>
        <div className="space-y-1 p-3">
          <p className="truncate text-sm font-semibold">{community.name || 'Community'}</p>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {community.vicinity || community.description || 'Gym community'}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge>{community.stats?.totalMembers ?? 0} members</Badge>
            {community.category && <Badge>{community.category}</Badge>}
            {community.settings?.requireApproval && <Badge>Approval required</Badge>}
          </div>
        </div>
      </button>
      {action && <div className="border-t border-[var(--color-line)] p-3">{action}</div>}
    </article>
  );
}

function CommunityDetail({
  communityId,
  onClose,
}: {
  communityId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('posts');
  const [memberPage, setMemberPage] = useState(1);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    setTab('posts');
    setMemberPage(1);
  }, [communityId]);

  const detail = useQuery({
    queryKey: ['community', communityId],
    enabled: Boolean(communityId),
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}`);
      return (data.data || data) as Community;
    },
  });

  const members = useQuery({
    queryKey: ['community', communityId, 'members', memberPage],
    enabled: Boolean(communityId) && tab === 'members',
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/members`, {
        params: { page: memberPage, limit: PAGE },
      });
      return data.data as {
        members: Member[];
        pagination: { currentPage: number; totalPages: number; hasNext: boolean };
      };
    },
  });

  const requests = useQuery({
    queryKey: ['community', communityId, 'requests'],
    enabled: Boolean(communityId) && tab === 'requests',
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/membership-requests`, {
        params: { limit: 50 },
      });
      return (data.requests || []) as MembershipRequest[];
    },
  });

  const posts = useQuery({
    queryKey: ['community', communityId, 'posts'],
    enabled: Boolean(communityId) && tab === 'posts',
    queryFn: async () => {
      const { data } = await api.get(`/posts/gym/community/posts/all/${communityId}`, {
        params: { page: 1, limit: PAGE },
      });
      return (data.posts || []) as CommunityPost[];
    },
  });

  const approve = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(
        `/gyms/community/${communityId}/membership-requests/${requestId}/approve`,
      );
    },
    onSuccess: () => {
      toast.success('Member approved');
      requests.refetch();
      qc.invalidateQueries({ queryKey: ['community', communityId] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not approve the request')),
  });

  const deny = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/gyms/community/${communityId}/membership-requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Request denied');
      requests.refetch();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not deny the request')),
  });

  const leave = useMutation({
    mutationFn: async () => {
      await api.delete(`/gyms/community/${communityId}/membership`);
    },
    onSuccess: () => {
      toast.success('You left the community');
      setConfirmLeave(false);
      qc.invalidateQueries({ queryKey: ['communities'] });
      onClose();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not leave the community'));
      setConfirmLeave(false);
    },
  });

  const community = detail.data;
  const canModerate = ['owner', 'admin', 'moderator', 'founder'].includes(
    String(community?.userRole || '').toLowerCase(),
  );

  return (
    <Modal open={Boolean(communityId)} onClose={onClose} title={community?.name || 'Community'}>
      {detail.isLoading && <Skeleton className="h-40 w-full" />}
      {detail.isError && (
        <ErrorState message={errMsg(detail.error)} onRetry={() => detail.refetch()} />
      )}
      {community && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-[var(--color-muted)]">{community.vicinity}</p>
              {community.description && <p className="mt-1 text-sm">{community.description}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge>{community.stats?.totalMembers ?? 0} members</Badge>
                {community.category && <Badge>{community.category}</Badge>}
                {community.userRole && <Badge>{community.userRole}</Badge>}
              </div>
            </div>
            {community.isMember && (
              <Button variant="ghost" onClick={() => setConfirmLeave(true)}>
                Leave
              </Button>
            )}
          </div>

          <Tabs
            tabs={[
              { value: 'posts', label: 'Posts' },
              { value: 'members', label: 'Members' },
              ...(canModerate ? [{ value: 'requests', label: 'Requests' }] : []),
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'posts' && (
            <div className="space-y-3">
              {posts.isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              {posts.isError && (
                <ErrorState message={errMsg(posts.error)} onRetry={() => posts.refetch()} />
              )}
              {posts.isSuccess && (posts.data?.length || 0) === 0 && (
                <EmptyState
                  title="No posts yet"
                  description="Community posts will appear here."
                />
              )}
              {(posts.data || []).map((p) => {
                const media = p.media?.[0];
                const src = mediaUrl(media?.uri || media?.url || '');
                return (
                  <article key={p._id} className="rounded-xl bg-[var(--color-surface-2)] p-3">
                    <div className="flex items-center gap-2">
                      <Avatar
                        src={mediaUrl(p.author?.avatar)}
                        name={p.author?.fullName || p.author?.username}
                        size={30}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {p.author?.fullName || p.author?.username}
                        </p>
                        <p className="text-[11px] text-[var(--color-muted)]">
                          {ago(p.createdAt)}
                        </p>
                      </div>
                    </div>
                    {p.content && <p className="mt-2 whitespace-pre-wrap text-sm">{p.content}</p>}
                    {src && (
                      <img
                        src={src}
                        alt="post media"
                        className="mt-2 max-h-64 w-full rounded-lg object-cover"
                      />
                    )}
                    <p className="mt-2 text-[11px] text-[var(--color-muted)]">
                      {p.likes?.length ?? 0} likes · {p.comments?.length ?? 0} comments
                    </p>
                  </article>
                );
              })}
            </div>
          )}

          {tab === 'members' && (
            <div className="space-y-2">
              {members.isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              {members.isError && (
                <ErrorState message={errMsg(members.error)} onRetry={() => members.refetch()} />
              )}
              {members.isSuccess && (members.data?.members?.length || 0) === 0 && (
                <EmptyState title="No members" description="This community has no members yet." />
              )}
              <ul className="space-y-1">
                {(members.data?.members || []).map((m, i) => (
                  <li
                    key={m._id || m.user?._id || i}
                    className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] p-2"
                  >
                    <Avatar
                      src={mediaUrl(m.user?.avatar)}
                      name={m.user?.fullName || m.user?.username}
                      size={34}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {m.user?.fullName || m.user?.username || 'Member'}
                      </p>
                      <p className="text-[11px] text-[var(--color-muted)]">
                        joined {ago(m.joinedAt)}
                      </p>
                    </div>
                    {m.role && <Badge>{m.role}</Badge>}
                  </li>
                ))}
              </ul>
              {(members.data?.members?.length || 0) > 0 && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    disabled={memberPage === 1}
                    onClick={() => setMemberPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-[var(--color-muted)]">
                    Page {members.data?.pagination?.currentPage ?? memberPage}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={!members.data?.pagination?.hasNext}
                    onClick={() => setMemberPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === 'requests' && (
            <div className="space-y-2">
              {requests.isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              {requests.isError && (
                <ErrorState
                  message={errMsg(requests.error, 'You cannot moderate this community')}
                  onRetry={() => requests.refetch()}
                />
              )}
              {requests.isSuccess && (requests.data?.length || 0) === 0 && (
                <EmptyState
                  title="No pending requests"
                  description="Membership requests will show up here."
                />
              )}
              <ul className="space-y-1">
                {(requests.data || []).map((r) => (
                  <li
                    key={r._id}
                    className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] p-2"
                  >
                    <Avatar
                      src={mediaUrl(r.user?.avatar)}
                      name={r.user?.fullName || r.user?.username}
                      size={34}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {r.user?.fullName || r.user?.username}
                      </p>
                      <p className="text-[11px] text-[var(--color-muted)]">
                        requested {ago(r.requestedAt)}
                      </p>
                    </div>
                    <Button disabled={approve.isPending} onClick={() => approve.mutate(r._id)}>
                      <Check /> Approve
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={deny.isPending}
                      onClick={() => deny.mutate(r._id)}
                    >
                      <X /> Deny
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmLeave}
        title="Leave community"
        description="You will lose access to this community's posts and members."
        confirmLabel="Leave"
        destructive
        loading={leave.isPending}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => leave.mutate()}
      />
    </Modal>
  );
}

export default function GymCommunity() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('explore');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebounced(search);

  useEffect(() => setPage(1), [debounced, tab]);

  const explore = useQuery({
    queryKey: ['communities', 'explore', page, debounced],
    enabled: tab === 'explore',
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/explore', {
        params: { page, limit: PAGE, search: debounced || undefined },
      });
      return data.data as {
        gymCommunities: Community[];
        pagination: { currentPage: number; totalPages: number; hasNext: boolean };
      };
    },
  });

  const mine = useQuery({
    queryKey: ['communities', 'mine', page, debounced],
    enabled: tab === 'mine',
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/my-communities', {
        params: { page, limit: PAGE, search: debounced || undefined },
      });
      return data.data as {
        gymCommunities: Community[];
        pagination: { currentPage: number; totalPages: number; hasNext: boolean };
      };
    },
  });

  const join = useMutation({
    mutationFn: async (gymId: string) => {
      const { data } = await api.post('/gyms/community/join', { gymId });
      return data as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Joined the community');
      qc.invalidateQueries({ queryKey: ['communities'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not join this community')),
  });

  const active = tab === 'explore' ? explore : mine;
  const communities = useMemo(
    () => active.data?.gymCommunities || [],
    [active.data],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Gym communities</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Join the crews training at your gym and follow their posts.
        </p>
      </header>

      <Tabs
        tabs={[
          { value: 'explore', label: 'Explore' },
          { value: 'mine', label: 'My communities' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Input
        placeholder="Search communities"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {active.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      )}

      {active.isError && (
        <ErrorState message={errMsg(active.error)} onRetry={() => active.refetch()} />
      )}

      {active.isSuccess && communities.length === 0 && (
        <Card className="p-6">
          <EmptyState
            icon={<Users />}
            title={tab === 'mine' ? 'You have not joined any community' : 'No communities found'}
            description={
              tab === 'mine'
                ? 'Explore communities to find your gym crew.'
                : 'Try a different search or check back later.'
            }
          />
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {communities.map((c) => (
          <CommunityCard
            key={c._id}
            community={c}
            onOpen={() => setOpenId(c._id)}
            action={
              tab === 'explore' ? (
                c.userMembership?.status === 'pending' ? (
                  <Button className="w-full" variant="ghost" disabled>
                    Request pending
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={join.isPending}
                    onClick={() => join.mutate(c._id)}
                  >
                    {join.isPending ? <Spinner size={16} /> : 'Join'}
                  </Button>
                )
              ) : (
                <Button className="w-full" variant="ghost" onClick={() => setOpenId(c._id)}>
                  Open
                </Button>
              )
            }
          />
        ))}
      </div>

      {communities.length > 0 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-[var(--color-muted)]">
            Page {active.data?.pagination?.currentPage ?? page} of{' '}
            {active.data?.pagination?.totalPages ?? 1}
          </span>
          <Button
            variant="ghost"
            disabled={!active.data?.pagination?.hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <CommunityDetail communityId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
