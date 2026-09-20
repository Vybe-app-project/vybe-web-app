import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { mediaUrl } from '../lib/api';
import { useBandCollapse } from '../lib/gymBand';
import { MapPin } from './icons';
import { MapTile, osmHref } from './MapTile';
import { AvatarStack, ButtonLink, Skeleton, cx, formatStat } from './ui';

/**
 * "1 member" / "128 members": every community starts at one (its creator), so
 * the singular is the normal case, not an edge case.
 *
 * `long` appends "Only you so far" at exactly one member. A bare "1 member"
 * is honest but reads like a screen that has not finished loading; the longer
 * form tells the founder that being alone is expected. Use it where there is
 * room for a sentence and keep the bare count in tight meta lines. The mobile
 * client makes the same split, so the two agree wherever they overlap.
 */
export const memberCountLabel = (n: number, options: { long?: boolean } = {}) => {
  const count = `${formatStat(n)} ${n === 1 ? 'member' : 'members'}`;
  return options.long && n === 1 ? `${count} \u00b7 Only you so far` : count;
};

/**
 * The gym band: the cover every hub wears. The gym is Vybe's social unit, so
 * the app opens on a place and its people rather than a dashboard.
 *
 *  full  — gym pages and Home. Kicker, gym name, meta, the member stack and the
 *          map tile, bottom-aligned over the cover; gym-scoped tabs on the band.
 *  hub   — every other hub. Hub title, one context line, ONE figure (only when
 *          it is above zero, else `children`), and the primary action.
 *
 * Dark in both themes: the section is scoped `.dark` like AuthShell, so the
 * semantic tokens inside resolve to the navy set while the page stays light.
 * Copy sits on the bottom scrim, never on bare cover art. The whole band is
 * sticky and collapses to a 56 px bar as the page scrolls (lib/gymBand.ts).
 *
 * Cover photos arrive as an already-resolved `photoUrl` (the shell resolves
 * `coverSourceOf()` + the place-photo proxy); a missing or broken photo falls
 * back to the seeded gradient, so the band never shows a hole.
 */

export type GymBandGym = {
  id?: string;
  name: string;
  /** Free text as the API shapes it ("Bethlehem, PA"). */
  city?: string;
  /** Resolved image URL or signed same-origin media path. */
  photoUrl?: string;
  memberCount?: number;
  /** Rendered only when a real number; the API often has none. */
  rating?: number | null;
  coords?: { lat: number; lng: number };
  /** Gym members (the API has no presence). Label them honestly via `peopleLabel`. */
  people?: Array<{ id: string; name: string; avatar?: string; initials?: string }>;
  /** Defaults to "<memberCount> members"; pass e.g. "Regulars this week" when the stack is the leaderboard. */
  peopleLabel?: string;
  /** The leaderboard's string ("14" or "a few"); the line is omitted when absent. Never a computed zero. */
  sessionsTodayLabel?: string;
};

export type GymBandProps = {
  variant?: 'full' | 'hub';
  /** null/undefined => the "find your gym" state. */
  gym?: GymBandGym | null;
  /** Hub title, e.g. "Workouts". */
  title?: string;
  /** e.g. "Your week at Bethlehem Barbell". */
  context?: string;
  /** Drawn ONLY when > 0. */
  figure?: number | null;
  figureLabel?: string;
  figureUnit?: string;
  /** Primary CTA (the one `--brand` control on the band; the mint stays in the pin and cover art). */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** Gym-scoped tabs rendered on the band. */
  tabs?: ReactNode;
  /** Brand / search / inbox / Log row rendered on the band; stays through the collapse. */
  chrome?: ReactNode;
  loading?: boolean;
  /** Replaces the figure block when `figure` is falsy. */
  children?: ReactNode;
  /** Heading element for the band title; the shell decides who owns the page h1. */
  titleAs?: 'h1' | 'h2' | 'p';
  className?: string;
};

export const NO_GYM_COPY = {
  kicker: 'Find your gym',
  title: 'Train somewhere?',
  body: 'Pick your gym and Vybe fills with the people who train there.',
  action: 'Find your gym',
  href: '/gyms',
} as const;

/** "14" -> "14 training today"; "a few" -> "A few training today". */
export function trainingTodayLine(label?: string | null): string | null {
  const text = (label ?? '').trim();
  if (!text || /^0+$/.test(text)) return null;
  return `${text[0].toUpperCase()}${text.slice(1)} training today`;
}

/** Seeds the two soft circles so a gym always looks like itself. */
export function coverSeed(id?: string): number {
  const text = id || 'vybe';
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}
const slot = (seed: number, n: number) => ((seed >>> (n * 4)) & 0xf) / 15;

export function coverGeometry(id?: string): CSSProperties {
  const s = coverSeed(id);
  return {
    '--geo1-x': `${-30 + slot(s, 0) * 30}%`,
    '--geo1-y': `${-10 + slot(s, 1) * 50}%`,
    '--geo1-d': `${220 + slot(s, 2) * 140}px`,
    '--geo2-x': `${60 + slot(s, 3) * 35}%`,
    '--geo2-y': `${-40 + slot(s, 4) * 50}%`,
    '--geo2-d': `${180 + slot(s, 5) * 160}px`,
  } as CSSProperties;
}

function Cover({ gym }: { gym?: GymBandGym | null }) {
  const [broken, setBroken] = useState(false);
  const url = gym?.photoUrl ? mediaUrl(gym.photoUrl) : '';
  useEffect(() => setBroken(false), [url]);
  return (
    <div className="gym-band-cover" aria-hidden="true" style={coverGeometry(gym?.id)}>
      {url && !broken ? (
        <img src={url} alt="" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <>
          <span className="gym-band-geo gym-band-geo-1" />
          <span className="gym-band-geo gym-band-geo-2" />
        </>
      )}
    </div>
  );
}

function Meta({ gym }: { gym: GymBandGym }) {
  const showMembersHere = !gym.people?.length && typeof gym.memberCount === 'number' && gym.memberCount > 0;
  const hasRating = typeof gym.rating === 'number' && Number.isFinite(gym.rating) && gym.rating > 0;
  if (!showMembersHere && !hasRating) return null;
  return (
    <p className="gym-band-meta tabular">
      {showMembersHere ? (
        <>
          <b>{formatStat(gym.memberCount)}</b> {gym.memberCount === 1 ? 'member' : 'members'}
        </>
      ) : null}
      {showMembersHere && hasRating ? ' · ' : null}
      {hasRating ? (
        <>
          <b>{gym.rating!.toFixed(1)}</b> rating
        </>
      ) : null}
    </p>
  );
}

function Now({ gym }: { gym: GymBandGym }) {
  const people = gym.people ?? [];
  const label = gym.peopleLabel ?? (typeof gym.memberCount === 'number' && gym.memberCount > 0 ? memberCountLabel(gym.memberCount) : null);
  const live = trainingTodayLine(gym.sessionsTodayLabel);
  if (!people.length && !live) return null;
  return (
    <div className="gym-band-now">
      {people.length ? (
        <span className="gym-band-stack">
          <AvatarStack users={people.map((p) => ({ src: p.avatar, name: p.name, seed: p.id }))} size={30} max={4} />
          {label ? <span className="gym-band-now-label">{label}</span> : null}
        </span>
      ) : null}
      {live ? (
        <span className="gym-band-live">
          <i aria-hidden="true" />
          {live}
        </span>
      ) : null}
    </div>
  );
}

function FullBody({ gym, Heading }: { gym: GymBandGym; Heading: 'h1' | 'h2' | 'p' }) {
  return (
    <div className="gym-band-main gym-band-main-full">
      <div className="min-w-0">
        <p className="gym-band-kicker">
          <MapPin size={14} />
          <span className="gym-band-kicker-text">Your gym{gym.city?.trim() ? ` · ${gym.city.trim()}` : ''}</span>
        </p>
        <Heading className="type-display gym-band-title text-band">{gym.name}</Heading>
        <Meta gym={gym} />
        <Now gym={gym} />
      </div>
      {gym.coords ? (
        <a
          className="gym-band-map"
          href={osmHref(gym.coords.lat, gym.coords.lng)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${gym.name} on OpenStreetMap`}
        >
          <MapTile lat={gym.coords.lat} lng={gym.coords.lng} size={84} className="gym-band-map-art" />
        </a>
      ) : null}
    </div>
  );
}

function NoGymBody({ Heading, action }: { Heading: 'h1' | 'h2' | 'p'; action?: ReactNode }) {
  return (
    <div className="gym-band-main gym-band-main-full">
      <div className="min-w-0">
        <p className="gym-band-kicker">
          <MapPin size={14} />
          <span className="gym-band-kicker-text">{NO_GYM_COPY.kicker}</span>
        </p>
        <Heading className="type-display gym-band-title text-band">{NO_GYM_COPY.title}</Heading>
        <p className="gym-band-body-copy">{NO_GYM_COPY.body}</p>
        <div className="gym-band-actions">
          {action ?? (
            <ButtonLink to={NO_GYM_COPY.href} variant="primary">
              {NO_GYM_COPY.action}
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}

function HubBody({
  gym,
  title,
  context,
  figure,
  figureLabel,
  figureUnit,
  action,
  secondaryAction,
  children,
  Heading,
}: Pick<GymBandProps, 'gym' | 'title' | 'context' | 'figure' | 'figureLabel' | 'figureUnit' | 'action' | 'secondaryAction' | 'children'> & {
  Heading: 'h1' | 'h2' | 'p';
}) {
  const hasFigure = typeof figure === 'number' && Number.isFinite(figure) && figure > 0;
  const contextLine = context ?? (gym ? undefined : NO_GYM_COPY.kicker);
  return (
    <div className="gym-band-main gym-band-main-hub">
      <div className="gym-band-hub-text">
        {title ? <Heading className="type-display gym-band-title text-h1">{title}</Heading> : null}
        {contextLine ? (
          gym || context ? (
            <p className="gym-band-context">{contextLine}</p>
          ) : (
            <Link to={NO_GYM_COPY.href} className="gym-band-context gym-band-context-link">
              <MapPin size={14} />
              {contextLine}
            </Link>
          )
        ) : null}
      </div>
      {hasFigure ? (
        <p className="gym-band-figure">
          <span className="type-stat text-figure">
            {formatStat(figure)}
            {figureUnit ? <span className="gym-band-figure-unit">{figureUnit}</span> : null}
          </span>
          {figureLabel ? <span className="gym-band-figure-label">{figureLabel}</span> : null}
        </p>
      ) : children ? (
        <div className="gym-band-next">{children}</div>
      ) : null}
      {action || secondaryAction ? (
        <div className="gym-band-actions">
          {secondaryAction}
          {action}
        </div>
      ) : null}
    </div>
  );
}

function BandSkeleton({ variant }: { variant: 'full' | 'hub' }) {
  return (
    <div className={cx('gym-band-main', variant === 'full' ? 'gym-band-main-full' : 'gym-band-main-hub')} aria-hidden="true">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-28 bg-band-chip" />
        <Skeleton className={cx('mt-3 bg-band-chip', variant === 'full' ? 'h-8 w-2/3 max-w-xs' : 'h-7 w-40')} />
        <Skeleton className="mt-3 h-3 w-36 bg-band-chip" />
      </div>
      {variant === 'full' ? <Skeleton className="h-[84px] w-[84px] rounded-md bg-band-chip" /> : <Skeleton className="h-12 w-20 bg-band-chip" />}
    </div>
  );
}

export function GymBand({
  variant = 'hub',
  gym,
  title,
  context,
  figure,
  figureLabel,
  figureUnit,
  action,
  secondaryAction,
  tabs,
  chrome,
  loading = false,
  children,
  titleAs = 'h1',
  className,
}: GymBandProps) {
  const { ref, collapsed } = useBandCollapse<HTMLElement>();
  const Heading = titleAs;
  const barTitle = loading ? '' : variant === 'full' ? gym?.name ?? NO_GYM_COPY.title : title ?? gym?.name ?? '';
  return (
    <section
      ref={ref}
      className={cx('gym-band dark', className)}
      data-variant={variant}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-loading={loading ? 'true' : undefined}
      aria-label={variant === 'full' ? (gym ? `${gym.name}, your gym` : NO_GYM_COPY.kicker) : title}
      aria-busy={loading || undefined}
    >
      <Cover gym={loading ? null : gym} />
      <div className="gym-band-scrim" aria-hidden="true" />
      <div className="gym-band-chrome">
        {chrome}
        {barTitle ? (
          <span className="gym-band-bar-title text-md" aria-hidden={!collapsed}>
            {barTitle}
          </span>
        ) : null}
      </div>
      <div className="gym-band-body">
        {loading ? (
          <BandSkeleton variant={variant} />
        ) : variant === 'full' ? (
          gym ? (
            <FullBody gym={gym} Heading={Heading} />
          ) : (
            <NoGymBody Heading={Heading} action={action} />
          )
        ) : (
          <HubBody
            gym={gym}
            title={title}
            context={context}
            figure={figure}
            figureLabel={figureLabel}
            figureUnit={figureUnit}
            action={action}
            secondaryAction={secondaryAction}
            Heading={Heading}
          >
            {children}
          </HubBody>
        )}
        {tabs && !loading ? <div className="gym-band-tabs">{tabs}</div> : null}
      </div>
    </section>
  );
}
