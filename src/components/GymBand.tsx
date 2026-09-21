import type { CSSProperties, ReactNode } from 'react';
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
