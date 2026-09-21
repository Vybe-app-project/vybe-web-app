import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compactNumber, displayName, followerCount, type PublicUser } from '../lib/hooks';
import { Avatar, Badge, Button, Skeleton, humanize, useToast, type ButtonSize } from './ui';
import { BadgeCheck, Check, Lock, UserPlus } from './icons';

export type FollowState = 'none' | 'following' | 'requested';

function initialFollowState(user: PublicUser): FollowState {
  if (user.followStatus === 'following' || user.isFollowing) return 'following';
  if (user.followStatus === 'requested' || user.followStatus === 'pending') return 'requested';
  return 'none';
}

/** Private account (API sends `isPrivate`; profiles also carry settings.privacy). */
export const isPrivateAccount = (user?: Pick<PublicUser, 'isPrivate' | 'settings'> | null) =>
  user?.isPrivate === true || user?.settings?.privacy === 'private';

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

/** Small lock after the handle of a private account, so the state is known before tapping through. */
export function PrivateMark({ user, size = 12 }: { user?: Pick<PublicUser, 'isPrivate' | 'settings'> | null; size?: number }) {
  if (!isPrivateAccount(user)) return null;
  return (
    <span role="img" aria-label="Private account" title="Private account" className="inline-flex shrink-0 text-text-3">
      <Lock size={size} />
    </span>
  );
}

/**
 * Role badges shared by rows and profile headers. `compact` (list rows) keeps
 * the name on one line: verified becomes the check glyph and only Coach stays
 * as a small badge.
 *
 * The check is the operator-set `isIdentityVerified`, never `isVerified`:
 * the latter only means the e-mail was confirmed, which every active
 * account has, so it rendered a "Verified" badge on everybody.
 */
export function UserBadges({ user, compact = false }: { user: PublicUser; compact?: boolean }) {
  const verified = user.isIdentityVerified === true;
  if (compact) {
    return (
      <>
        {verified ? (
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
      {verified ? (
        <Badge tone="brand">
          <BadgeCheck size={12} />
          Verified
        </Badge>
      ) : null}
      {user.isCoach || user.isTrainer ? <Badge tone="info">Coach</Badge> : null}
    </>
  );
}

/** Text link with a 44 px-tall hit area (pseudo-element, no visual change), for a name that links inside a list item. */
export const ROW_LINK = 'relative truncate text-md font-semibold text-text-1 hover:underline before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[""]';

/**
 * The whole-row profile link of a person row: an overlay under the action,
 * carrying the `.pressable` wash, bleeding 8 px past the text on each side so
 * the wash has an edge. Shared with the Friends page's rows.
 */
export const ROW_OVERLAY = 'pressable absolute -inset-x-2 inset-y-0 z-[1] rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus';

/**
 * One person, as Instagram lists them: a 44 px avatar, the bold name, the
 * handle and followers under it, the action at the right. No card and no
 * rule — the row is the unit, and a list spaces its rows itself. The whole
 * row opens the profile (an overlay link with the press wash); the action
 * sits above the overlay, so a Follow never navigates.
 */
export default function UserRow({ user, trailing, below }: { user: PublicUser; trailing?: React.ReactNode; below?: React.ReactNode }) {
  const me = useAuth((s) => s.user);
  const isMe = !!me && String(me._id) === String(user._id);
  const href = isMe ? '/profile' : `/u/${user._id}`;
  const followers = followerCount(user);

  return (
    <div className="relative flex min-h-16 items-center gap-3 py-2">
      <Link to={href} viewTransition className={ROW_OVERLAY} aria-label={`Open ${displayName(user)}’s profile`} />
      <Avatar src={user.avatar} name={displayName(user)} size={44} seed={user._id} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-x-2">
          <span className="t-name truncate text-text-1">{displayName(user)}</span>
          <UserBadges user={user} compact />
        </div>
        <div className="t-meta flex flex-wrap items-center gap-x-3">
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="truncate">@{user.username}</span>
            <PrivateMark user={user} />
          </span>
          {followers > 0 ? (
            <span className="tabular shrink-0">
              {compactNumber(followers)} {followers === 1 ? 'follower' : 'followers'}
            </span>
          ) : null}
        </div>
        {below}
        {(user.isCoach || user.isTrainer) && user.fields?.length ? (
          <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Coaching specialties">
            {user.fields.slice(0, 4).map((f) => (
              <li key={f}>
                <Badge tone="info" size="sm">
                  {humanize(f)}
                </Badge>
              </li>
            ))}
            {user.fields.length > 4 ? (
              <li>
                <Badge size="sm">+{user.fields.length - 4}</Badge>
              </li>
            ) : null}
          </ul>
        ) : null}
        {user.bio ? <p className="mt-1 line-clamp-2 text-xs text-text-2">{user.bio}</p> : null}
      </div>
      <div className="relative z-[2] shrink-0">{trailing ?? <FollowButton user={user} size="sm" />}</div>
    </div>
  );
}

/** The row's exact geometry while it loads: the 44 px disc, two lines, the 40 px action. */
export function UserRowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 py-2" aria-hidden="true">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-32 max-w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-10 w-20 rounded-sm" />
    </div>
  );
}
