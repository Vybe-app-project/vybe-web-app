import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compactNumber, displayName, followerCount, type PublicUser } from '../lib/hooks';
import { Avatar, Badge, Button, Card, Skeleton, useToast } from './ui';

export type FollowState = 'none' | 'following' | 'requested';

function initialFollowState(user: PublicUser): FollowState {
  if (user.followStatus === 'following' || user.isFollowing) return 'following';
  if (user.followStatus === 'requested' || user.followStatus === 'pending') return 'requested';
  return 'none';
}

export function FollowButton({
  user,
  onChanged,
  className = '',
}: {
  user: PublicUser;
  onChanged?: (state: FollowState) => void;
  className?: string;
}) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<FollowState>(initialFollowState(user));

  const toggle = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/users/follow/${user._id}`);
      return data as { isFollowing?: boolean; followStatus?: string; message?: string };
    },
    onSuccess: (data) => {
      const next: FollowState =
        data.followStatus === 'requested' || data.followStatus === 'pending'
          ? 'requested'
          : data.isFollowing || data.followStatus === 'following'
            ? 'following'
            : 'none';
      setState(next);
      onChanged?.(next);
      toast.success(
        next === 'following'
          ? `Following ${displayName(user)}`
          : next === 'requested'
            ? 'Follow request sent'
            : `Unfollowed ${displayName(user)}`,
      );
      qc.invalidateQueries({ queryKey: ['user', user._id] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update follow status.')),
  });

  if (me && String(me._id) === String(user._id)) return null;

  return (
    <Button
      variant={state === 'following' ? 'ghost' : 'primary'}
      className={className}
      onClick={() => toggle.mutate()}
      loading={toggle.isPending}
      disabled={toggle.isPending}
    >
      {state === 'following' ? 'Following' : state === 'requested' ? 'Requested' : 'Follow'}
    </Button>
  );
}

export default function UserRow({ user }: { user: PublicUser }) {
  const me = useAuth((s) => s.user);
  const isMe = !!me && String(me._id) === String(user._id);
  const href = isMe ? '/profile' : `/u/${user._id}`;

  return (
    <Card className="flex items-center gap-3 p-3">
      <Link to={href}>
        <Avatar src={mediaUrl(user.avatar)} name={displayName(user)} size={44} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link to={href} className="truncate text-sm font-semibold hover:underline">
            {displayName(user)}
          </Link>
          {user.isVerified && <Badge variant="brand">Verified</Badge>}
          {(user.isCoach || user.isTrainer) && <Badge>Coach</Badge>}
        </div>
        <div className="truncate text-xs text-[var(--color-muted)]">
          @{user.username}
          {followerCount(user) > 0 && ` · ${compactNumber(followerCount(user))} followers`}
        </div>
        {user.bio && (
          <p className="mt-1 line-clamp-2 text-xs text-[var(--color-muted)]">{user.bio}</p>
        )}
      </div>
      <FollowButton user={user} />
    </Card>
  );
}

export function UserRowSkeleton() {
  return (
    <Card className="flex items-center gap-3 p-3">
      <Skeleton className="h-11 w-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-8 w-20 rounded-xl" />
    </Card>
  );
}
