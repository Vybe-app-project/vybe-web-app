import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { displayName, followerCount, followingCount, postCount, type PublicUser } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  PageHeader,
  Skeleton,
  SkeletonTile,
  StatGrid,
  StatTile,
  Tabs,
  cx,
  formatStat,
  humanize,
  useToast,
  type MenuItem,
} from './ui';
import { Calendar, Check, Copy, Flag, Lock, MapPin, MessageCircle, ShareUp, Shield, UserPlus, Users, X } from './icons';
import { FollowButton, UserBadges } from './UserRow';
import { useReportModal } from './Report';
import { PAGE, ProfileCover } from './Profile';
import { PROFILE_TABS, ProfileMeals, ProfilePosts, ProfileWorkouts, isProfileTab, type ProfileTabKey } from './ProfileTabs';

type FriendStatus = 'none' | 'requested' | 'incoming' | 'friends' | 'pending' | string;

const joinedLabel = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export default function UserProfile() {
  const { id = '' } = useParams();
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { report, reportModal } = useReportModal();

  const tabParam = params.get('tab');
  const tab: ProfileTabKey = isProfileTab(tabParam) ? tabParam : 'posts';
  const setTab = (next: string) => {
    setParams(
      (prev) => {
        if (next === 'posts') prev.delete('tab');
        else prev.set('tab', next);
        return prev;
      },
      { replace: true },
    );
  };

  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);

  const userQuery = useQuery({
    queryKey: ['user', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get(`/users/${id}`);
      return (data.user || data) as PublicUser & { friendStatus?: FriendStatus; friendRequestId?: string };
    },
  });

  const refreshRelationship = () => {
    qc.invalidateQueries({ queryKey: ['user', id] });
    qc.invalidateQueries({ queryKey: ['friends'] });
  };

  const block = useMutation({
    mutationFn: async () => {
      await api.post('/users/block', { userId: id });
    },
    onSuccess: () => {
      toast.success(`${displayName(userQuery.data)} blocked`);
      setConfirmBlock(false);
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['user', id] });
      qc.invalidateQueries({ queryKey: ['friends'] });
      navigate('/discover', { replace: true });
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not block this user.'));
      setConfirmBlock(false);
    },
  });

  const addFriend = useMutation({
    mutationFn: async () => {
      await api.post('/friends/send', { receiverId: id });
    },
    onSuccess: () => {
      toast.success('Friend request sent');
      refreshRelationship();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send the friend request.')),
  });

  const cancelFriend = useMutation({
    mutationFn: async (requestId?: string) => {
      if (requestId) await api.delete(`/friends/requests/${requestId}`);
      else await api.delete(`/friends/requests/with/${id}`);
    },
    onSuccess: () => {
      toast.success('Friend request withdrawn');
      refreshRelationship();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not withdraw the request.')),
  });

  const acceptFriend = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/friends/requests/${requestId}/accept`);
    },
    onSuccess: () => {
      toast.success(`You and ${displayName(userQuery.data)} are now friends`);
      refreshRelationship();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not accept the request.')),
  });

  // The receiver's route. DELETE /friends/requests/:id is the sender's
  // withdraw and answers 404 for the receiver.
  const declineFriend = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/friends/incoming/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Friend request declined');
      refreshRelationship();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not decline the request.')),
  });

  const removeFriend = useMutation({
    mutationFn: async () => {
      await api.delete(`/friends/${id}`);
    },
    onSuccess: () => {
      toast.success('Friend removed');
      setConfirmUnfriend(false);
      refreshRelationship();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not remove this friend.'));
      setConfirmUnfriend(false);
    },
  });

  async function shareProfile() {
    const user = userQuery.data;
    if (!user) return;
    const url = `${window.location.origin}/u/${user._id}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${displayName(user)} on Vybe`, url });
        return;
      }
      await copyLink();
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      toast.error('Could not share this profile.');
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/u/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Profile link copied');
    } catch {
      toast.error('Could not copy the link.');
    }
  }

  if (me && String(me._id) === String(id)) return <Navigate to="/profile" replace />;

  if (userQuery.isLoading) {
    return (
      <div className={PAGE} aria-busy="true">
        <PageHeader title="Profile" back />
        <Card padded={false} className="overflow-hidden">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <Skeleton className="h-24 w-24 rounded-full ring-4 ring-surface-1" />
              <div className="flex gap-2">
                <Skeleton className="h-11 w-28 rounded-sm" />
                <Skeleton className="h-11 w-11 rounded-sm" />
                <Skeleton className="h-11 w-11 rounded-sm" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
        </Card>
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonTile key={i} />
          ))}
        </StatGrid>
      </div>
    );
  }

  if (userQuery.isError || !userQuery.data) {
    return (
      <div className={PAGE}>
        <PageHeader title="Profile" back />
        <ErrorState
          error={userQuery.error}
          title="Profile not found"
          message={errMsg(userQuery.error, 'This account may have been removed, or it is not visible to you.')}
          action={
            <Button variant="primary" onClick={() => navigate('/discover')}>
              Explore people
            </Button>
          }
        />
      </div>
    );
  }

  const user = userQuery.data;
  const name = displayName(user);
  const isPrivate = user.settings?.privacy === 'private' || user.isPrivate === true;
  const canViewContent = user.canViewContent !== false;
  const friendStatus: FriendStatus = user.friendStatus || 'none';
  const requestId = user.friendRequestId;
  const joined = joinedLabel(user.createdAt);
  const friendBusy = addFriend.isPending || cancelFriend.isPending || acceptFriend.isPending || declineFriend.isPending;

  const menuItems: MenuItem[] = [
    { label: 'Share profile', icon: <ShareUp size={18} />, onSelect: shareProfile },
    { label: 'Copy link', icon: <Copy size={18} />, onSelect: copyLink },
    {
      label: 'Report',
      description: 'Flag this account for review',
      icon: <Flag size={18} />,
      divider: true,
      onSelect: () => report({ targetType: 'user', targetId: id, targetLabel: name }),
    },
    ...(friendStatus === 'friends'
      ? [{ label: 'Remove friend', icon: <X size={18} />, danger: true, onSelect: () => setConfirmUnfriend(true) } as MenuItem]
      : []),
    { label: 'Block', icon: <Shield size={18} />, danger: true, onSelect: () => setConfirmBlock(true) },
  ];

  const friendControl =
    friendStatus === 'friends' ? (
      <Badge tone="brand" className="h-11 px-3 text-xs">
        <Users size={14} />
        Friends
      </Badge>
    ) : friendStatus === 'incoming' && requestId ? (
      <>
        <Button
          variant="secondary"
          icon={<Check size={18} />}
          loading={acceptFriend.isPending}
          disabled={friendBusy}
          onClick={() => acceptFriend.mutate(requestId)}
        >
          Accept request
        </Button>
        <IconButton
          label={`Decline ${name}’s friend request`}
          variant="secondary"
          disabled={friendBusy}
          aria-busy={declineFriend.isPending || undefined}
          onClick={() => declineFriend.mutate(requestId)}
        >
          <X size={20} />
        </IconButton>
      </>
    ) : friendStatus === 'requested' || friendStatus === 'pending' ? (
      <Button
        variant="secondary"
        title="Withdraw friend request"
        loading={cancelFriend.isPending}
        disabled={friendBusy}
        onClick={() => cancelFriend.mutate(requestId)}
      >
        Requested
      </Button>
    ) : (
      <Button
        variant="secondary"
        icon={<UserPlus size={18} />}
        loading={addFriend.isPending}
        disabled={friendBusy}
        onClick={() => addFriend.mutate()}
      >
        Add friend
      </Button>
    );

  // The ⋯ menu lives in the shell's top bar below `lg` (right edge, always
  // reachable) and in the hero action row on desktop.
  const overflowMenu = <Menu label="More options" items={menuItems} />;

  return (
    <div className={PAGE}>
      <PageHeader title={name} back mobileActions={overflowMenu} actions={<></>} />

      <Card padded={false} className="overflow-hidden">
        <ProfileCover src={user.coverPicture} />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="relative z-[1] w-fit">
              <Avatar src={user.avatar} name={name} size={96} className="bg-surface-1 ring-4 ring-surface-1" />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pb-1">
              <FollowButton user={user} onChanged={() => userQuery.refetch()} />
              {friendControl}
              <IconButton
                label={`Message ${name}`}
                variant="secondary"
                onClick={() =>
                  navigate(`/messages/new?to=${encodeURIComponent(user._id)}`, {
                    state: { peer: { _id: user._id, username: user.username, fullName: user.fullName, avatar: user.avatar } },
                    viewTransition: true,
                  })
                }
              >
                <MessageCircle size={20} />
              </IconButton>
              <span className="hidden lg:inline-flex">
                <Menu label="More options" items={menuItems} triggerClassName="border border-line-strong bg-surface-2 hover:bg-surface-3" />
              </span>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="type-heading text-xl text-text-1">{name}</h2>
              <UserBadges user={user} />
              {isPrivate ? (
                <Badge>
                  <Lock size={12} />
                  Private
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-text-2">@{user.username}</p>
            {user.bio ? <p className="prose-measure mt-3 whitespace-pre-wrap text-base text-text-1">{user.bio}</p> : null}
            {user.fields?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Coaching specialties">
                {user.fields.map((f) => (
                  <Badge key={f} tone="info">
                    {humanize(f)}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-2">
              {user.location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} className="text-text-3" aria-hidden="true" />
                  {user.location}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} className="text-text-3" aria-hidden="true" />
                {joined ? `Joined ${joined}` : 'Joined recently'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <StatGrid>
        <StatTile label="Posts" value={formatStat(postCount(user))} onClick={canViewContent ? () => setTab('posts') : undefined} />
        <StatTile
          label="Followers"
          value={formatStat(followerCount(user))}
          to={canViewContent ? `/u/${user._id}/followers` : undefined}
          hint={canViewContent ? undefined : 'Private'}
        />
        <StatTile
          label="Following"
          value={formatStat(followingCount(user))}
          to={canViewContent ? `/u/${user._id}/following` : undefined}
          hint={canViewContent ? undefined : 'Private'}
        />
        <StatTile
          label="Workouts"
          value={formatStat(user.stats?.workouts || 0)}
          onClick={canViewContent ? () => setTab('workouts') : undefined}
          tone="brand"
        />
      </StatGrid>

      {!canViewContent ? (
        <Card>
          <EmptyState
            icon={<Lock size={26} />}
            title="This account is private"
            message={`Follow ${name} to see their posts, workouts and meals. They approve requests themselves.`}
            action={<FollowButton user={user} onChanged={() => userQuery.refetch()} />}
          />
        </Card>
      ) : (
        <section className="space-y-4" aria-label={`${name}’s activity`}>
          <Tabs
            aria-label="Profile content"
            tabs={PROFILE_TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
            value={tab}
            onChange={setTab}
          />
          <div className={cx('anim-fade-in')} key={tab}>
            {tab === 'posts' && <ProfilePosts userId={user._id} name={name} />}
            {tab === 'workouts' && <ProfileWorkouts userId={user._id} name={name} />}
            {tab === 'meals' && <ProfileMeals userId={user._id} name={name} />}
          </div>
        </section>
      )}

      {reportModal}

      <ConfirmDialog
        open={confirmUnfriend}
        title={`Remove ${name} as a friend?`}
        message="You can send a new request later. They will not be notified."
        confirmLabel="Remove friend"
        destructive
        loading={removeFriend.isPending}
        onConfirm={() => removeFriend.mutate()}
        onCancel={() => setConfirmUnfriend(false)}
      />

      <ConfirmDialog
        open={confirmBlock}
        title={`Block ${name}?`}
        message="You will no longer see each other’s posts, comments or messages, and any follow or friend relationship is removed. You can unblock them later under Settings › Blocked accounts."
        confirmLabel="Block"
        destructive
        loading={block.isPending}
        onConfirm={() => block.mutate()}
        onCancel={() => setConfirmBlock(false)}
      />
    </div>
  );
}
