import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardMedia,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SearchField,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  Tabs,
  cx,
  humanize,
  useToast,
} from './ui';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Heart,
  Lock,
  MapPin,
  MessageCircle,
  Users,
  X,
} from './icons';

/* ------------------------------------------------------------------ types */

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
  medias?: { uri?: string; url?: string; type?: string }[];
  author?: { _id: string; username?: string; fullName?: string; avatar?: string };
  likes?: unknown[];
  comments?: unknown[];
};

type Paged<T> = {
  gymCommunities: T[];
  pagination: { currentPage: number; totalPages: number; hasNext: boolean };
};

type ListTab = 'explore' | 'mine';

const PAGE = 18;
const MOD_ROLES = ['owner', 'admin', 'moderator', 'founder'];

/* ------------------------------------------------------------------ helpers */

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

const coverOf = (c: Community) => mediaUrl(c.coverImage || c.photos?.[0]?.url || '');
const nameOf = (u?: { username?: string; fullName?: string }) => u?.fullName?.trim() || u?.username || 'Member';
const isModRole = (role?: string | null) => MOD_ROLES.includes(String(role || '').toLowerCase());

function Pager({
  page,
  totalPages,
  hasNext,
  onPrev,
  onNext,
  className,
}: {
  page: number;
  totalPages?: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  return (
    <nav aria-label="Pagination" className={cx('flex items-center justify-between gap-3', className)}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev} icon={<ChevronLeft size={16} />}>
        Previous
      </Button>
      <span className="tabular text-xs font-semibold text-text-2">
        Page {page}
        {totalPages ? ` of ${Math.max(totalPages, 1)}` : ''}
      </span>
      <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext} iconRight={<ChevronRight size={16} />}>
        Next
      </Button>
    </nav>
  );
}

function CommunityCardSkeleton() {
  return (
    <div className="card p-3">
      <Skeleton className="aspect-video w-full rounded-md" />
      <div className="mt-3 space-y-2 px-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-20 rounded-xs" />
          <Skeleton className="h-6 w-16 rounded-xs" />
        </div>
      </div>
      <Skeleton className="mt-3 h-11 w-full rounded-sm" />
    </div>
  );
}

function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return null;
  return <Badge tone={isModRole(role) ? 'brand' : 'neutral'}>{humanize(role)}</Badge>;
}

/* ------------------------------------------------------------------ card */

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
  const members = community.stats?.totalMembers ?? 0;
  return (
    <article className="card flex flex-col p-3">
      <button
        type="button"
        onClick={onOpen}
        className="group -m-1 flex-1 rounded-md p-1 text-left"
        aria-label={`${community.name || 'Community'} — open`}
      >
        <CardMedia ratio="16/9">
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-text-3">
              <Users size={28} />
            </span>
          )}
        </CardMedia>
        <div className="mt-3 space-y-1 px-1">
          <p className="truncate text-md font-semibold text-text-1 group-hover:underline group-hover:underline-offset-2">
            {community.name || 'Community'}
          </p>
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-text-2">
            {community.vicinity ? <MapPin size={13} className="shrink-0 text-text-3" /> : null}
            <span className="truncate">{community.vicinity || community.description || 'Gym community'}</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge tone="neutral">
              <Users size={12} />
              <span className="tabular">{members}</span> {members === 1 ? 'member' : 'members'}
            </Badge>
            {community.category ? <Badge tone="neutral">{humanize(community.category)}</Badge> : null}
            {community.settings?.requireApproval ? (
              <Badge tone="warning">
                <Lock size={12} />
                Approval
              </Badge>
            ) : null}
            {community.isMember ? <RoleBadge role={community.userRole || 'member'} /> : null}
          </div>
        </div>
      </button>
      {action ? <div className="mt-3 border-t border-line pt-3">{action}</div> : null}
    </article>
  );
}

/* ------------------------------------------------------------------ detail */

function CommunityDetail({
  communityId,
  onClose,
}: {
  communityId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'posts' | 'members' | 'requests'>('posts');
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
      return (data.data || data.gymCommunity || data) as Community;
    },
  });

  const community = detail.data;
  const canModerate = isModRole(community?.userRole);

  const members = useQuery({
    queryKey: ['community', communityId, 'members', memberPage],
    enabled: Boolean(communityId) && tab === 'members',
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/members`, {
        params: { page: memberPage, limit: 20 },
      });
      return (data.data || data) as {
        members: Member[];
        pagination?: { currentPage: number; totalPages: number; hasNext: boolean };
      };
    },
  });

  const requests = useQuery({
    queryKey: ['community', communityId, 'requests'],
    enabled: Boolean(communityId) && canModerate,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/membership-requests`, {
        params: { limit: 50 },
      });
      return (data.requests || data.data?.requests || []) as MembershipRequest[];
    },
  });

  const posts = useQuery({
    queryKey: ['community', communityId, 'posts'],
    enabled: Boolean(communityId) && tab === 'posts',
    queryFn: async () => {
      const { data } = await api.get(`/posts/gym/community/posts/all/${communityId}`, {
        params: { page: 1, limit: 20 },
      });
      return (data.posts || []) as CommunityPost[];
    },
  });

  const approve = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/gyms/community/${communityId}/membership-requests/${requestId}/approve`);
    },
    onSuccess: () => {
      toast.success('Member approved');
      qc.invalidateQueries({ queryKey: ['community', communityId] });
      qc.invalidateQueries({ queryKey: ['communities'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not approve the request')),
  });

  const deny = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/gyms/community/${communityId}/membership-requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Request declined');
      qc.invalidateQueries({ queryKey: ['community', communityId, 'requests'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not decline the request')),
  });

  const leave = useMutation({
    mutationFn: async () => {
      await api.delete(`/gyms/community/${communityId}/membership`);
    },
    onSuccess: () => {
      toast.success('You left the community');
      setConfirmLeave(false);
      qc.invalidateQueries({ queryKey: ['communities'] });
      qc.invalidateQueries({ queryKey: ['community', communityId] });
      onClose();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not leave the community'));
      setConfirmLeave(false);
    },
  });

  const cover = community ? coverOf(community) : '';
  const pendingCount = requests.data?.length ?? 0;

  return (
    <Modal
      open={Boolean(communityId)}
      onClose={onClose}
      size="lg"
      title={community?.name || 'Community'}
      description={community?.vicinity || undefined}
    >
      {detail.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="aspect-video w-full rounded-md" />
          <SkeletonText lines={2} />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : null}
      {detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : null}
      {community ? (
        <div className="space-y-5">
          {cover ? (
            <CardMedia ratio="16/9">
              <img src={cover} alt={community.name || 'Community cover'} className="h-full w-full object-cover" />
            </CardMedia>
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              {community.description ? (
                <p className="prose-measure text-base text-text-1">{community.description}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">
                  <Users size={12} />
                  <span className="tabular">{community.stats?.totalMembers ?? 0}</span> members
                </Badge>
                {typeof community.stats?.totalPosts === 'number' ? (
                  <Badge tone="neutral">
                    <span className="tabular">{community.stats.totalPosts}</span> posts
                  </Badge>
                ) : null}
                {community.category ? <Badge tone="neutral">{humanize(community.category)}</Badge> : null}
                {community.settings?.isPublic === false ? (
                  <Badge tone="warning">
                    <Lock size={12} />
                    Private
                  </Badge>
                ) : null}
                {community.isMember ? <RoleBadge role={community.userRole || 'member'} /> : null}
              </div>
            </div>
            {community.isMember ? (
              <Button variant="secondary" size="sm" onClick={() => setConfirmLeave(true)}>
                Leave
              </Button>
            ) : null}
          </div>

          <Tabs
            aria-label="Community sections"
            tabs={[
              { value: 'posts', label: 'Posts' },
              { value: 'members', label: 'Members', count: community.stats?.totalMembers },
              ...(canModerate
                ? [{ value: 'requests', label: 'Requests', count: pendingCount || undefined }]
                : []),
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />

          {tab === 'posts' ? (
            <div className="space-y-3">
              {posts.isLoading ? (
                <div className="space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-md bg-surface-2 p-3">
                      <SkeletonRow className="py-0" />
                      <SkeletonText lines={2} className="mt-3" />
                    </div>
                  ))}
                </div>
              ) : null}
              {posts.isError ? <ErrorState error={posts.error} onRetry={() => posts.refetch()} /> : null}
              {posts.isSuccess && (posts.data?.length || 0) === 0 ? (
                <EmptyState
                  size="sm"
                  title="No posts yet"
                  message={
                    community.isMember
                      ? 'Be the first to post — share a session from the Home feed and tag this community.'
                      : 'Members have not posted here yet. Join to see what they share.'
                  }
                  action={community.isMember ? { label: 'Go to feed', to: '/?compose=1', variant: 'secondary' } : undefined}
                />
              ) : null}
              {(posts.data || []).map((p) => {
                const media = p.media?.[0] || p.medias?.[0];
                const src = mediaUrl(media?.uri || media?.url || '');
                const author = p.author;
                return (
                  <article key={p._id} className="rounded-md bg-surface-2 p-3">
                    <div className="flex items-center gap-2.5">
                      {author?._id ? (
                        <Link to={`/u/${author._id}`} viewTransition className="flex min-w-0 items-center gap-2.5 rounded-sm">
                          <Avatar src={author.avatar} name={nameOf(author)} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-text-1">{nameOf(author)}</span>
                            <span className="block text-xs text-text-3">{ago(p.createdAt)}</span>
                          </span>
                        </Link>
                      ) : (
                        <>
                          <Avatar name="Member" size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-text-1">Member</span>
                            <span className="block text-xs text-text-3">{ago(p.createdAt)}</span>
                          </span>
                        </>
                      )}
                    </div>
                    <Link to={`/p/${p._id}`} viewTransition className="mt-2 block rounded-sm">
                      {p.content ? <p className="prose-measure whitespace-pre-wrap text-base text-text-1">{p.content}</p> : null}
                      {src ? (
                        <CardMedia className="mt-2 max-h-72">
                          <img src={src} alt="" loading="lazy" className="max-h-72 w-full object-cover" />
                        </CardMedia>
                      ) : null}
                    </Link>
                    <div className="mt-2 flex items-center gap-4 text-xs text-text-2">
                      <span className="inline-flex items-center gap-1">
                        <Heart size={14} />
                        <span className="tabular">{p.likes?.length ?? 0}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle size={14} />
                        <span className="tabular">{p.comments?.length ?? 0}</span>
                      </span>
                      <Link to={`/p/${p._id}`} viewTransition className="ml-auto font-semibold text-brand-text underline-offset-2 hover:underline">
                        Open post
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {tab === 'members' ? (
            <div className="space-y-2">
              {members.isLoading ? (
                <div aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))}
                </div>
              ) : null}
              {members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} /> : null}
              {members.isSuccess && (members.data?.members?.length || 0) === 0 ? (
                <EmptyState size="sm" icon={<Users size={24} />} title="No members to show" message="This community has no visible members yet." />
              ) : null}
              {(members.data?.members?.length || 0) > 0 ? (
                <ul className="divide-y divide-line">
                  {(members.data?.members || []).map((m, i) => {
                    const name = nameOf(m.user);
                    const row = (
                      <>
                        <Avatar src={m.user?.avatar} name={name} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text-1">{name}</span>
                          {m.joinedAt ? <span className="block text-xs text-text-3">Joined {ago(m.joinedAt)}</span> : null}
                        </span>
                        <RoleBadge role={m.role} />
                      </>
                    );
                    return (
                      <li key={m._id || m.user?._id || i}>
                        {m.user?._id ? (
                          <Link to={`/u/${m.user._id}`} viewTransition className="flex min-h-14 items-center gap-3 rounded-sm px-1 py-2 transition-colors dur-1 hover:bg-surface-2">
                            {row}
                          </Link>
                        ) : (
                          <div className="flex min-h-14 items-center gap-3 px-1 py-2">{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {(members.data?.members?.length || 0) > 0 || memberPage > 1 ? (
                <Pager
                  page={members.data?.pagination?.currentPage ?? memberPage}
                  totalPages={members.data?.pagination?.totalPages}
                  hasNext={Boolean(members.data?.pagination?.hasNext)}
                  onPrev={() => setMemberPage((p) => Math.max(1, p - 1))}
                  onNext={() => setMemberPage((p) => p + 1)}
                />
              ) : null}
            </div>
          ) : null}

          {tab === 'requests' ? (
            <div className="space-y-2">
              {requests.isLoading ? (
                <div aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))}
                </div>
              ) : null}
              {requests.isError ? (
                <ErrorState
                  error={requests.error}
                  title="Requests are unavailable"
                  message={errMsg(requests.error, 'Only moderators can review membership requests.')}
                  onRetry={() => requests.refetch()}
                />
              ) : null}
              {requests.isSuccess && pendingCount === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<Check size={24} />}
                  title="No pending requests"
                  message="New requests to join appear here for you to approve or decline."
                />
              ) : null}
              {pendingCount > 0 ? (
                <ul className="divide-y divide-line">
                  {(requests.data || []).map((r) => {
                    const name = nameOf(r.user);
                    return (
                      <li key={r._id} className="flex flex-wrap items-center gap-3 py-2">
                        <Avatar src={r.user?.avatar} name={name} size="md" />
                        <div className="min-w-0 flex-1">
                          {r.user?._id ? (
                            <Link to={`/u/${r.user._id}`} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
                              {name}
                            </Link>
                          ) : (
                            <p className="truncate text-sm font-semibold text-text-1">{name}</p>
                          )}
                          {r.requestedAt ? <p className="text-xs text-text-3">Requested {ago(r.requestedAt)}</p> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<Check size={16} />}
                            loading={approve.isPending && approve.variables === r._id}
                            disabled={approve.isPending || deny.isPending}
                            onClick={() => approve.mutate(r._id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<X size={16} />}
                            loading={deny.isPending && deny.variables === r._id}
                            disabled={approve.isPending || deny.isPending}
                            onClick={() => deny.mutate(r._id)}
                          >
                            Decline
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmLeave}
        title="Leave this community?"
        description="You will stop seeing its posts and members. You can ask to join again later."
        confirmLabel="Leave community"
        destructive
        loading={leave.isPending}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => leave.mutate()}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ page */

export default function GymCommunity() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<ListTab>('explore');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebounced(search.trim(), 400);

  useEffect(() => setPage(1), [debounced, tab]);

  const explore = useQuery({
    queryKey: ['communities', 'explore', page, debounced],
    enabled: tab === 'explore',
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/explore', {
        params: { page, limit: PAGE, search: debounced || undefined },
      });
      return data.data as Paged<Community>;
    },
  });

  const mine = useQuery({
    queryKey: ['communities', 'mine', page, debounced],
    enabled: tab === 'mine',
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/my-communities', {
        params: { page, limit: PAGE, search: debounced || undefined },
      });
      return data.data as Paged<Community>;
    },
  });

  const join = useMutation({
    mutationFn: async (gymId: string) => {
      const { data } = await api.post('/gyms/community/join', { gymId });
      return data as { message?: string; membership?: { status?: string } };
    },
    onSuccess: (data) => {
      const msg = data?.message || '';
      if (/cancel/i.test(msg)) toast.info('Request withdrawn');
      else if (/request|approval|pending/i.test(msg)) toast.info(msg || 'Request sent — a moderator will review it');
      else toast.success(msg || 'You joined the community');
      qc.invalidateQueries({ queryKey: ['communities'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not join this community')),
  });

  const active = tab === 'explore' ? explore : mine;
  const communities = useMemo(() => active.data?.gymCommunities || [], [active.data]);
  const pagination = active.data?.pagination;

  return (
    <div className="space-y-6">
      <PageHeader title="Communities" subtitle="Join the crews training at your gym and follow what they post." />

      <Tabs
        variant="segmented"
        aria-label="Community lists"
        tabs={[
          { value: 'explore', label: 'Explore' },
          { value: 'mine', label: 'My communities' },
        ]}
        value={tab}
        onChange={(k) => setTab(k as ListTab)}
      />

      <SearchField
        label={tab === 'mine' ? 'Search my communities' : 'Search communities'}
        hideLabel
        placeholder={tab === 'mine' ? 'Search your communities' : 'Search by gym or community name'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {active.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading communities">
          {Array.from({ length: 6 }).map((_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
      ) : null}

      {active.isError ? <ErrorState error={active.error} onRetry={() => active.refetch()} /> : null}

      {active.isSuccess && communities.length === 0 ? (
        tab === 'mine' ? (
          debounced ? (
            <EmptyState
              variant="no-results"
              title={`None of your communities match “${debounced}”`}
              message="Try another name, or clear the search to see them all."
              action={{ label: 'Clear search', onClick: () => setSearch(''), variant: 'secondary' }}
            />
          ) : (
            <EmptyState
              icon={<Globe size={26} />}
              title="You have not joined a community yet"
              message="Communities are built around gyms. Find yours and join the people you already train next to."
              action={{ label: 'Explore communities', onClick: () => setTab('explore') }}
              secondaryAction={{ label: 'Find gyms nearby', to: '/gyms' }}
            />
          )
        ) : debounced ? (
          <EmptyState
            variant="no-results"
            title={`No communities match “${debounced}”`}
            message="Check the spelling, or search the gym directory — a community starts the moment someone joins a gym."
            action={{ label: 'Search gyms', to: '/gyms', variant: 'secondary' }}
          />
        ) : (
          <EmptyState
            icon={<Globe size={26} />}
            title="No communities to explore yet"
            message="Nobody has started a community around a gym near you. Find your gym and be the first."
            action={{ label: 'Find gyms', to: '/gyms' }}
          />
        )
      ) : null}

      {communities.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {communities.map((c) => {
              const pending = c.userMembership?.status === 'pending';
              const busy = join.isPending && join.variables === c._id;
              return (
                <CommunityCard
                  key={c._id}
                  community={c}
                  onOpen={() => setOpenId(c._id)}
                  action={
                    tab === 'explore' && !c.isMember ? (
                      pending ? (
                        <Button
                          block
                          variant="secondary"
                          loading={busy}
                          disabled={join.isPending && !busy}
                          onClick={() => join.mutate(c._id)}
                        >
                          Cancel request
                        </Button>
                      ) : (
                        <Button
                          block
                          variant="primary"
                          loading={busy}
                          disabled={join.isPending && !busy}
                          onClick={() => join.mutate(c._id)}
                        >
                          {c.settings?.requireApproval ? 'Request to join' : 'Join'}
                        </Button>
                      )
                    ) : (
                      <Button block variant="secondary" onClick={() => setOpenId(c._id)}>
                        Open
                      </Button>
                    )
                  }
                />
              );
            })}
          </div>
          <Pager
            page={pagination?.currentPage ?? page}
            totalPages={pagination?.totalPages}
            hasNext={Boolean(pagination?.hasNext)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </>
      ) : null}

      <CommunityDetail communityId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
