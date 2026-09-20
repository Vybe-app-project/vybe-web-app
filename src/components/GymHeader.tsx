import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { mediaUrl } from '../lib/api';
import { NO_GYM_COPY, coverGeometry, memberCountLabel } from './GymBand';
import type { GymBandGym } from './GymBand';
import { ChevronRight, MapPin } from './icons';
import { Metric } from './Metric';
import { PlaceImage } from './PlaceImage';
import { Skeleton, cx, hasMetric } from './ui';

/**
 * The gym as Instagram draws an account. Pure props — no query, no hook:
 * Home passes what `useHomeGym` returns, a gym page passes its own
 * `bandGymOf` payload, and both keep ownership of loading and membership.
 *
 *  compact — Home. One 72 px row: 48 px round crest (the cover thumb, else a
 *            neutral initials disc) · bold name · "1 member · Bethlehem" · one
 *            blue text button (Open for a member, Join otherwise). Hairline
 *            below. No gym: a single 48 px "Find your gym" row. Never a hero.
 *  profile — gym pages. Optional 3:1 banner that scrolls away; an 88 px crest
 *            (overlapping the banner by 24 px) with three metrics beside it
 *            (posts · members · this week); name and vicinity; two full-width
 *            buttons (blue Join / Set as my gym, tonal Share); then the tab
 *            strip as `children`.
 *
 * Geometry is reserved: the crest box is always drawn (`photoUrl` may arrive
 * after the first render — the cover is its own query), the name block holds
 * two lines whether or not there is a vicinity, and each skeleton is the exact
 * final size. Numbers obey the zero rule (hasMetric): a count of 0 is not a
 * member count and a missing stat leaves its column empty.
 */

export type GymHeaderStats = { posts?: number | null; members?: number | null; thisWeek?: number | null };

export type GymHeaderProps = {
  /** `compact` is Home's 72 px row; `profile` is the gym page's header. */
  variant: 'compact' | 'profile';
  /** null = no gym: compact draws the 48 px "Find your gym" row, profile draws nothing. */
  gym: GymBandGym | null;
  /** The viewer belongs to this gym: compact's default button reads Open instead of Join. */
  member?: boolean;
  /** A gym the account points at is still loading: a skeleton of the exact final geometry. Not for "no gym", which is a designed state. */
  loading?: boolean;
  /** Profile stats. A stat that is 0, null or missing leaves its column empty — never a zero. `members` defaults to `gym.memberCount`. */
  stats?: GymHeaderStats;
  /** The one blue control. `undefined` = the default (compact: Open / Join linking to the gym page; profile: none); `null` = none. */
  action?: ReactNode;
  /** The tonal second control on the profile header (Share, Message). */
  secondary?: ReactNode;
  /** Profile: draw the 3:1 banner — the gym's photo, else the cover art. Defaults to "only when there is a photo". */
  banner?: boolean;
  /** Profile: the tab strip, rendered full-bleed under the buttons. */
  children?: ReactNode;
  className?: string;
};

const ROW = 'flex items-center gap-3 border-b border-line px-4 lg:px-6';

/** "1 member · Bethlehem, PA": only what is true. A zero member count is not a member count. */
export function compactMetaLine(gym: GymBandGym): string | null {
  const parts = [hasMetric(gym.memberCount) ? memberCountLabel(gym.memberCount) : null, gym.city?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "Bethlehem, PA · 4.6 rating": the vicinity when known, the rating only when it is a number. */
export function profileMetaLine(gym: GymBandGym): string | null {
  const rating = typeof gym.rating === 'number' && Number.isFinite(gym.rating) && gym.rating > 0 ? `${gym.rating.toFixed(1)} rating` : null;
  const parts = [gym.city?.trim() || null, rating].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The gym page for a gym with an id; a bare place has nowhere to go yet. */
export function gymHref(gym: GymBandGym): string | null {
  return gym.id ? `/gyms/${encodeURIComponent(gym.id)}` : null;
}

/** The crest box is always reserved; `photo` false keeps the initials disc even when a photo exists (the banner already shows it). */
function Crest({ gym, size, photo = true, className }: { gym: GymBandGym; size: 48 | 88; photo?: boolean; className?: string }) {
  return (
    <PlaceImage
      src={photo ? gym.photoUrl ?? null : null}
      name={gym.name}
      className={cx('rounded-full', size === 48 ? 'h-12 w-12' : 'h-22 w-22', className)}
      textClassName={size === 48 ? 'text-sm' : 'text-2xl'}
    />
  );
}

function FindGymRow({ className }: { className?: string }) {
  return (
    <Link to={NO_GYM_COPY.href} viewTransition className={cx(ROW, 'pressable h-12 text-text-1', className)}>
      <MapPin size={22} className="shrink-0 text-text-2" />
      <span className="t-body flex-1 truncate font-semibold">{NO_GYM_COPY.action}</span>
      <ChevronRight size={18} className="shrink-0 text-text-3" />
    </Link>
  );
}

function CompactRow({ gym, member, action, className }: { gym: GymBandGym; member: boolean; action: ReactNode; className?: string }) {
  const href = gymHref(gym);
  const meta = compactMetaLine(gym);
  const defaultAction = href ? (
    <Link to={href} viewTransition className="pressable -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-sm px-2 text-sm font-semibold text-brand">
      {member ? 'Open' : 'Join'}
    </Link>
  ) : null;
  return (
    <div className={cx(ROW, 'h-18', className)}>
      <Crest gym={gym} size={48} />
      <div className="min-w-0 flex-1">
        <p className="t-name truncate text-text-1">{gym.name}</p>
        {meta ? <p className="t-meta truncate">{meta}</p> : null}
      </div>
      {action === undefined ? defaultAction : action}
    </div>
  );
}

function CompactSkeleton({ className }: { className?: string }) {
  return (
    <div className={cx(ROW, 'h-18', className)} aria-busy="true">
      <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-36 max-w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-10" />
    </div>
  );
}

/** The 3:1 banner: the photo, or the cover art with two circles seeded from the gym id. Scrolls away; reserved by aspect-ratio. */
function Banner({ gym }: { gym: GymBandGym }) {
  const [broken, setBroken] = useState(false);
  const url = gym.photoUrl ? mediaUrl(gym.photoUrl) : '';
  useEffect(() => setBroken(false), [url]);
  return (
    <div className="gym-cover relative aspect-[3/1] w-full overflow-hidden" aria-hidden="true" style={coverGeometry(gym.id)}>
      {url && !broken ? (
        <img src={url} alt="" decoding="async" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <>
          <span className="gym-cover-geo gym-cover-geo-1" />
          <span className="gym-cover-geo gym-cover-geo-2" />
        </>
      )}
    </div>
  );
}

function StatCell({ value, label }: { value?: number | null; label: string }) {
  return (
    <div className="flex min-w-0 justify-center">
      <Metric value={value} label={label} size="md" align="center" compact />
    </div>
  );
}

function ProfileHeader({
  gym,
  stats,
  action,
  secondary,
  banner,
  children,
  className,
}: {
  gym: GymBandGym;
  stats?: GymHeaderStats;
  action: ReactNode;
  secondary: ReactNode;
  banner: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const meta = profileMetaLine(gym);
  const members = stats?.members ?? gym.memberCount;
  return (
    <div className={className}>
      {banner ? <Banner gym={gym} /> : null}
      <div className="px-4 lg:px-6">
        <div className={cx('flex items-center gap-4', banner && '-mt-6')}>
          <Crest gym={gym} size={88} photo={!banner} className={banner ? 'ring-[3px] ring-bg' : undefined} />
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            <StatCell value={stats?.posts} label="posts" />
            <StatCell value={members} label={members === 1 ? 'member' : 'members'} />
            <StatCell value={stats?.thisWeek} label="this week" />
          </div>
        </div>
        <div className="mt-3 min-h-12">
          <p className="t-title truncate text-text-1">{gym.name}</p>
          {meta ? <p className="t-body truncate text-text-2">{meta}</p> : null}
        </div>
        {action || secondary ? (
          <div className="mt-3 flex gap-2 [&>*]:min-w-0 [&>*]:flex-1">
            {action}
            {secondary}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function ProfileSkeleton({ banner, className }: { banner: boolean; className?: string }) {
  return (
    <div className={className} aria-busy="true">
      {banner ? <Skeleton className="aspect-[3/1] w-full rounded-none" /> : null}
      <div className="px-4 lg:px-6">
        <div className={cx('flex items-center gap-4', banner && '-mt-6')}>
          <Skeleton className="h-22 w-22 shrink-0 rounded-full" />
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <Skeleton className="h-6 w-8" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 min-h-12 space-y-2">
          <Skeleton className="h-5 w-40 max-w-full" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 flex-1" />
        </div>
      </div>
    </div>
  );
}

export function GymHeader({ variant, gym, member = false, loading = false, stats, action, secondary, banner, children, className }: GymHeaderProps) {
  if (variant === 'compact') {
    if (loading) return <CompactSkeleton className={className} />;
    if (!gym) return <FindGymRow className={className} />;
    return <CompactRow gym={gym} member={member} action={action} className={className} />;
  }
  if (loading) return <ProfileSkeleton banner={banner ?? false} className={className} />;
  if (!gym) return null;
  return (
    <ProfileHeader gym={gym} stats={stats} action={action ?? null} secondary={secondary ?? null} banner={banner ?? !!gym.photoUrl} className={className}>
      {children}
    </ProfileHeader>
  );
}
