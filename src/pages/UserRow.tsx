import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compactNumber, displayName, followerCount, type PublicUser } from '../lib/hooks';
import { Avatar, Badge, Button, Card, SkeletonRow, Skeleton, useToast, type ButtonSize } from './ui';
import { BadgeCheck, Check, UserPlus } from './icons';

export type FollowState = 'none' | 'following' | 'requested';

function initialFollowState(user: PublicUser): FollowState {
  if (user.followStatus === 'following' || user.isFollowing) return 'following';
  if (user.followStatus === 'requested' || user.followStatus === 'pending') return 'requested';
  return 'none';
}

/**
 * Follow / Following / Requested toggle. Primary when there is no
 * relationship yet, quiet secondary once you follow (so "Following" never
 * reads as a call to action).
 */
export function FollowButton({
  user,
  onChanged,
  className = '',
  size = 'md',
  block = false,
}: {
  user: PublicUser;
  onChanged?: (state: FollowState) => void;
  className?: string;
  size?: ButtonSize;
  block?: boolean;
}) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<FollowState>(() => initialFollowState(user));

  // Keep in sync when the parent refetches the user (e.g. after accepting a request).
  useEffect(() => {
    setState(initialFollowState(user));
  }, [user.followStatus, user.isFollowing]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const label = state === 'following' ? 'Following' : state === 'requested' ? 'Requested' : 'Follow';
  const title =
    state === 'following'
      ? `Unfollow ${displayName(user)}`
      : state === 'requested'
        ? 'Withdraw follow request'
        : `Follow ${displayName(user)}`;

  return (
    <Button
      variant={state === 'none' ? 'primary' : 'secondary'}
      size={size}
      block={block}
      className={className}
      onClick={() => toggle.mutate()}
      loading={toggle.isPending}
      aria-pressed={state !== 'none'}
      title={title}
      icon={state === 'following' ? <Check size={18} /> : state === 'none' ? <UserPlus size={18} /> : undefined}
    >
      {label}
    </Button>
  );
}

/**
 * Role badges shared by rows and profile headers. `compact` (list rows) keeps
 * the name on one line: verified becomes the check glyph and only Coach stays
 * as a small badge.
 *
 * "Verified" keys on `isIdentityVerified`, the staff-granted flag -- never on
 * `isVerified`, which only records that the email was confirmed and is true
 * for every account (it put a Verified chip on every brand-new profile).
 */
export function UserBadges({ user, compact = false }: { user: PublicUser; compact?: boolean }) {
  if (compact) {
    return (
      <>
        {user.isIdentityVerified ? (
          <span role="img" aria-label="Verified" title="Verified" className="inline-flex shrink-0 text-brand">
            <BadgeCheck size={16} />
          </span>
        ) : null}
        {user.isCoach || user.isTrainer ? (
          <Badge tone="info" size="sm">
            Coach
          </Badge>
        ) : null}
      </>
    );
  }
  return (
    <>
      {user.isIdentityVerified ? (
        <Badge tone="brand">
          <BadgeCheck size={12} />
          Verified
        </Badge>
      ) : null}
      {user.isCoach || user.isTrainer ? <Badge tone="info">Coach</Badge> : null}
      {user.isPremium ? <Badge tone="accent">Premium</Badge> : null}
    </>
  );
}

/** Text link with a 44 px-tall hit area (pseudo-element, no visual change). */
export const ROW_LINK = 'relative truncate text-md font-semibold text-text-1 hover:underline before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[""]';

export default function UserRow({ user, trailing }: { user: PublicUser; trailing?: React.ReactNode }) {
  const me = useAuth((s) => s.user);
  const isMe = !!me && String(me._id) === String(user._id);
  const href = isMe ? '/profile' : `/u/${user._id}`;
  const followers = followerCount(user);

  return (
    <Card padded={false} className="flex items-center gap-3 p-3">
      <Link to={href} viewTransition className="shrink-0 rounded-full" aria-label={`Open ${displayName(user)}’s profile`}>
        <Avatar src={user.avatar} name={displayName(user)} size={44} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-x-2">
          <Link to={href} viewTransition className={ROW_LINK}>
            {displayName(user)}
          </Link>
          <UserBadges user={user} compact />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-text-2">
          <span className="truncate">@{user.username}</span>
          {followers > 0 ? (
            <span className="tabular shrink-0">
              {compactNumber(followers)} {followers === 1 ? 'follower' : 'followers'}
            </span>
          ) : null}
        </div>
        {user.bio ? <p className="mt-1 line-clamp-2 text-xs text-text-2">{user.bio}</p> : null}
      </div>
      <div className="shrink-0">{trailing ?? <FollowButton user={user} size="sm" />}</div>
    </Card>
  );
}

export function UserRowSkeleton() {
  return (
    <Card padded={false} className="flex items-center gap-3 p-3" aria-hidden="true">
      <SkeletonRow className="flex-1 py-0" />
      <Skeleton className="h-10 w-20 rounded-sm" />
    </Card>
  );
}
