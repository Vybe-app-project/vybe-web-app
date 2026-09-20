/**
 * Achievements: the row shape GET /api/achievements/user returns and the
 * pure display rules the page, the card grid and the Profile shortcut share.
 *
 * Import-free on purpose so `node --test` can load it through
 * tests/ts-loader.mjs and pin every rule without a DOM.
 *
 * Auto-award (features.achievementAutoAward, on in production since Wave E):
 * awards land on their own when a trigger fires, `awardedBy` says how
 * ('auto' | 'claim' | 'backfill'), `ackedAt` records that the member has seen
 * the "new award" notice on some device, and the Claim route stays reachable
 * only on servers where the flag is off. Coins are granted by Claim alone.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type Category =
  | 'workout'
  | 'nutrition'
  | 'social'
  | 'streak'
  | 'milestone'
  | 'special'
  | 'seasonal';

export type AwardedBy = 'auto' | 'claim' | 'backfill';

export type Achievement = {
  _id: string;
  name: string;
  title: string;
  description: string;
  category: Category;
  type?: 'single' | 'progressive' | 'recurring' | 'hidden';
  icon: string;
  iconColor?: string;
  rarity: Rarity;
  criteria: {
    type: string;
    value: number;
    timeframe?: string;
  };
  rewards?: {
    points?: number;
    coins?: number;
    experience?: number;
    badges?: string[];
    unlocks?: string[];
  };
  /** false once the catalogue retires a definition; list routes drop those rows. */
  isActive?: boolean;
  /** Additive since API 3740dd9: an earned row whose definition was retired keeps coming back with this flag. */
  retired?: boolean;
  isHidden?: boolean;
  isSeasonal?: boolean;
  season?: { startDate?: string; endDate?: string };
  stats?: { totalEarned?: number; totalUsers?: number; completionRate?: number };
  display?: { showProgress?: boolean; showPercentage?: boolean; order?: number };
  /* Present only on GET /achievements/user */
  isEarned?: boolean;
  earnedAt?: string | null;
  ackedAt?: string | null;
  awardedBy?: AwardedBy | null;
  progress?: number;
  required?: number;
  progressPercentage?: number;
  canClaim?: boolean;
};

export type AchievementListResponse = {
  success: boolean;
  achievements: Achievement[];
  pagination?: { page: number; limit: number; total: number; pages: number };
};

/** Rarity tiers, quietest first. */
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Category display order: what you train first, then who you train with. */
export const CATEGORIES: readonly Category[] = [
  'workout',
  'milestone',
  'streak',
  'nutrition',
  'social',
  'special',
  'seasonal',
];

export const rarityOf = (a: Pick<Achievement, 'rarity'>): Rarity =>
  RARITIES.includes(a.rarity) ? a.rarity : 'common';

export const categoryOf = (a: Pick<Achievement, 'category'>): Category =>
  CATEGORIES.includes(a.category) ? a.category : 'special';

/* -------------------------------------------------------------- visibility */

/** A retired definition: the catalogue keeps the row but no longer awards it. */
export const isRetired = (a: Pick<Achievement, 'isActive' | 'retired'>): boolean => a.retired === true || a.isActive === false;

/**
 * Retired rows stay out of the way unless the member already earned them;
 * an earned badge is theirs whatever the catalogue does later.
 */
export const isVisible = (a: Pick<Achievement, 'isActive' | 'retired' | 'isEarned'>): boolean =>
  !isRetired(a) || a.isEarned === true;

/**
 * The Claim control shows only where the server still runs the claim flow
 * (`claimAllowed`, false until capabilities have answered and false under
 * auto-award) and the row itself says the criteria are met.
 */
export const showClaim = (
  a: Pick<Achievement, 'canClaim' | 'isEarned'>,
  claimAllowed: boolean,
): boolean => claimAllowed && a.canClaim === true && a.isEarned !== true;

/* ------------------------------------------------------------- award state */

export type AwardState =
  | { kind: 'unearned' }
  | { kind: 'awarded'; label: 'Awarded'; showDate: false }
  | { kind: 'earned'; label: 'Earned'; showDate: true };

/**
 * Backfilled awards were granted silently for records that already existed,
 * so they read "Awarded" with no date fanfare. Anything else earned (auto,
 * claim, or a row from before awardedBy existed) shows when it happened.
 */
export function awardState(a: Pick<Achievement, 'isEarned' | 'awardedBy'>): AwardState {
  if (a.isEarned !== true) return { kind: 'unearned' };
  if (a.awardedBy === 'backfill') return { kind: 'awarded', label: 'Awarded', showDate: false };
  return { kind: 'earned', label: 'Earned', showDate: true };
}

/** An auto award the member has not yet acknowledged on any device. */
export const isNewAward = (a: Pick<Achievement, 'isEarned' | 'awardedBy' | 'ackedAt'>): boolean =>
  a.isEarned === true && a.awardedBy === 'auto' && !a.ackedAt;

/* ---------------------------------------------------------------- criteria */

/** Mirrors services/achievementAwards.js NUMBER_UNITS so web and push copy agree. */
const NUMBER_UNITS: Readonly<Record<string, readonly [string, string]>> = {
  workouts: ['session', 'sessions'],
  posts: ['post', 'posts'],
  followers: ['follower', 'followers'],
  likes: ['kudos received', 'kudos received'],
  comments: ['comment received', 'comments received'],
  steps: ['step', 'steps'],
  weeksKept: ['week kept', 'weeks kept'],
};

/** "1 / 4 weeks kept", "9 / 10 followers"; unknown criteria fall back to the humanised key. */
export function criteriaUnit(type: string | undefined, count: number): string {
  const units = type ? NUMBER_UNITS[type] : undefined;
  if (units) return count === 1 ? units[0] : units[1];
  return String(type ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

const EXPLAINERS: Readonly<Record<string, string>> = {
  weeksKept: 'Weeks kept counts weeks in a row in which you met your Weekly Rhythm target.',
};

/** A one-line explanation for criteria whose name alone does not say what counts. */
export const criteriaExplainer = (type: string | undefined): string | undefined =>
  type ? EXPLAINERS[type] : undefined;

/* ----------------------------------------------------------------- summary */

export type AchievementSummary = {
  /** Visible rows: active ones plus retired ones the member earned. */
  total: number;
  earned: number;
  /** Rows the server says can be claimed (meaningful only where Claim is allowed). */
  claimable: number;
  /** Auto awards not yet acknowledged. */
  newAwards: number;
  /** Unearned rows with some progress logged. */
  inProgress: number;
  /** Points banked from earned rows. */
  points: number;
  /** Points waiting behind claimable rows. */
  pendingPoints: number;
  /** The member's Weekly Rhythm run from the weeksKept row, when the catalogue has one. */
  weeksKept: { progress: number; required: number } | null;
  milestones: { earned: number; total: number };
};

const requiredOf = (a: Achievement): number => {
  const value = Number(a.required ?? a.criteria?.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const progressOf = (a: Achievement): number => {
  const value = Number(a.progress);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export function summarize(rows: readonly Achievement[] | null | undefined): AchievementSummary {
  const visible = (rows ?? []).filter(isVisible);
  let earned = 0;
  let claimable = 0;
  let newAwards = 0;
  let inProgress = 0;
  let points = 0;
  let pendingPoints = 0;
  let weeksKept: AchievementSummary['weeksKept'] = null;
  const milestones = { earned: 0, total: 0 };
  for (const a of visible) {
    const isEarned = a.isEarned === true;
    if (isEarned) {
      earned += 1;
      points += a.rewards?.points ?? 0;
    } else if (a.canClaim === true) {
      claimable += 1;
      pendingPoints += a.rewards?.points ?? 0;
    }
    if (isNewAward(a)) newAwards += 1;
    if (!isEarned && progressOf(a) > 0) inProgress += 1;
    if (a.criteria?.type === 'weeksKept' && !weeksKept) {
      weeksKept = { progress: progressOf(a), required: requiredOf(a) };
    }
    if (categoryOf(a) === 'milestone') {
      milestones.total += 1;
      if (isEarned) milestones.earned += 1;
    }
  }
  return { total: visible.length, earned, claimable, newAwards, inProgress, points, pendingPoints, weeksKept, milestones };
}

/** The categories and rarities actually present in a loaded list, in display order. */
export function filterOptionsFrom(rows: readonly Achievement[] | null | undefined): {
  categories: Category[];
  rarities: Rarity[];
} {
  const visible = (rows ?? []).filter(isVisible);
  const categories = new Set(visible.map(categoryOf));
  const rarities = new Set(visible.map(rarityOf));
  return {
    categories: CATEGORIES.filter((c) => categories.has(c)),
    rarities: RARITIES.filter((r) => rarities.has(r)),
  };
}

/** Per-member fields the catalogue routes do not carry; borrowed from the /user list. */
export function withMemberFields(row: Achievement, own: Achievement | undefined): Achievement {
  if (!own) return row;
  return {
    ...row,
    isEarned: own.isEarned,
    earnedAt: own.earnedAt,
    retired: own.retired ?? row.retired,
    ackedAt: own.ackedAt,
    awardedBy: own.awardedBy,
    progress: own.progress,
    required: own.required,
    progressPercentage: own.progressPercentage,
    canClaim: own.canClaim,
  };
}
