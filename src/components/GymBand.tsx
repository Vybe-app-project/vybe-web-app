import type { CSSProperties, ReactNode } from 'react';
import { GymHeader } from './GymHeader';
import { cx, formatStat } from './ui';

/**
 * Gym copy and model helpers. The band component that used to live here is
 * gone — <GymHeader> (GymHeader.tsx) draws the gym, as a compact row on Home
 * and as a profile header on gym pages — and these helpers stay because the
 * pages, homeGym.ts and the tests import them from this path.
 */

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
  return options.long && n === 1 ? `${count} · Only you so far` : count;
};

/** The gym model GymHeader draws; homeGym.ts and the gym pages build it. Missing data is omitted, never zeroed. */
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

/** The no-gym copy. GymHeader's compact row uses `action` and `href`; the hero title and body are no longer drawn anywhere. */
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

/** Seeds the two soft circles of the cover art so a gym always looks like itself. */
export function coverSeed(id?: string): number {
  const text = id || 'vybe';
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}
const slot = (seed: number, n: number) => ((seed >>> (n * 4)) & 0xf) / 15;

/** Custom properties for `.gym-cover-geo-1/2` (GymHeader's banner fallback). */
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

/** @deprecated The shell band's props; only the shim below still reads them. Deleted with ShellBand. */
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

/**
 * @deprecated Compatibility shim for the shell: Layout.tsx renders it above
 * every hub until the shell package deletes ShellBand. It draws no band — the
 * chrome row the shell passes in keeps its place (a plain dark bar, so the
 * inverse wordmark still reads), a `full` band shows the compact <GymHeader>
 * so Home previews the real thing, and hub titles, figures and copy are
 * dropped: the page header below carries them. Delete with ShellBand.
 */
export function GymBand({ variant = 'hub', gym, loading = false, action, tabs, chrome, className }: GymBandProps) {
  return (
    <div className={className} data-band-shim={variant}>
      {chrome ? <div className="dark flex h-14 items-center gap-1 bg-surface-1 px-4 text-text-1 lg:px-6">{chrome}</div> : null}
      {variant === 'full' ? <GymHeader variant="compact" gym={gym ?? null} loading={loading} action={action} /> : null}
      {tabs && !loading ? <div className={cx('flex gap-1 overflow-x-auto px-4 py-2 lg:px-6', 'no-scrollbar')}>{tabs}</div> : null}
    </div>
  );
}
