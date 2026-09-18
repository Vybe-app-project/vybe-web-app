/**
 * Presentation helpers for challenges. Pure so node:test can cover them: the
 * detail modal once printed "3653 days, 315.6B remaining" (milliseconds run
 * through the stat formatter), "Sep 17 to Sep 17" for a ten-year window and
 * "100 custom" for a custom goal unit.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (iso?: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
};

const monthDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const monthDayYear = (d: Date) => `${monthDay(d)}, ${d.getFullYear()}`;

/** Days from `now` to the end, rounded up; 0 when the end has passed. */
export function daysRemaining(endIso?: string | null, now: Date = new Date()): number {
  const end = parse(endIso);
  if (!end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

/** Whole days between two instants, rounded up, never below 1 for a valid window. */
export function windowDays(startIso?: string | null, endIso?: string | null): number {
  const start = parse(startIso);
  const end = parse(endIso);
  if (!start || !end) return 0;
  return Math.max(1, Math.ceil(Math.abs(end.getTime() - start.getTime()) / DAY_MS));
}

/**
 * "Sep 18 – Oct 19" inside one year, "Sep 18, 2026 – Sep 18, 2036" across
 * years, "From Sep 18, 2026" when the end is unknown.
 */
export function formatChallengeWindow(startIso?: string | null, endIso?: string | null): string {
  const start = parse(startIso);
  const end = parse(endIso);
  if (!start && !end) return 'Open-ended';
  if (start && !end) return `From ${monthDayYear(start)}`;
  if (!start && end) return `Until ${monthDayYear(end)}`;
  const s = start as Date;
  const e = end as Date;
  if (s.getFullYear() !== e.getFullYear()) return `${monthDayYear(s)} – ${monthDayYear(e)}`;
  return `${monthDay(s)} – ${monthDay(e)}, ${e.getFullYear()}`;
}

/** "3 weeks remaining", "Ends today", "" once over. Weeks past 14 days, years past 2. */
export function remainingLabel(endIso?: string | null, now: Date = new Date()): string {
  const days = daysRemaining(endIso, now);
  if (!parse(endIso)) return '';
  if (days === 0) return '';
  if (days === 1) return 'Ends today';
  if (days > 730) {
    const years = Math.round(days / 365);
    return `${years} years remaining`;
  }
  if (days > 60) {
    const months = Math.round(days / 30);
    return `${months} months remaining`;
  }
  if (days > 14) {
    const weeks = Math.round(days / 7);
    return `${weeks} weeks remaining`;
  }
  return `${days} days remaining`;
}

export type TimeBadgeTone = 'neutral' | 'success' | 'accent' | 'info';

export type TimeBadge = { label: string; tone: TimeBadgeTone; urgent: boolean; state: 'closed' | 'ended' | 'today' | 'soon' | 'open' | 'ongoing' };

/**
 * Time-left badge: Closed / Ended / Ends today / N days left (ember) /
 * N weeks left / Ongoing for a window longer than a year (the official
 * catalog challenges run ten years; "122 months left" is noise).
 */
export function timeBadgeFor(
  challenge: { isActive?: boolean; endDate?: string | null },
  now: Date = new Date(),
): TimeBadge {
  if (challenge.isActive === false) return { label: 'Closed', tone: 'neutral', urgent: false, state: 'closed' };
  const end = parse(challenge.endDate);
  if (!end) return { label: 'Open', tone: 'success', urgent: false, state: 'open' };
  if (end.getTime() <= now.getTime()) return { label: 'Ended', tone: 'neutral', urgent: false, state: 'ended' };
  const days = daysRemaining(challenge.endDate, now);
  if (days <= 1) return { label: 'Ends today', tone: 'accent', urgent: true, state: 'today' };
  if (days <= 3) return { label: `${days} days left`, tone: 'accent', urgent: true, state: 'soon' };
  if (days > 365) return { label: 'Ongoing', tone: 'info', urgent: false, state: 'ongoing' };
  if (days > 14) return { label: `${Math.round(days / 7)} weeks left`, tone: 'success', urgent: false, state: 'open' };
  return { label: `${days} days left`, tone: 'success', urgent: false, state: 'open' };
}

/**
 * The word printed after a goal number. A built-in unit is humanised
 * ("workouts"); a custom unit uses the creator's label or nothing at all, so
 * "40 / 100" rather than "40 / 100 custom".
 */
export function unitLabel(goalUnit?: string | null, goalUnitLabel?: string | null): string {
  if (goalUnit === 'custom') return (goalUnitLabel ?? '').trim();
  if (!goalUnit) return '';
  return goalUnit.replace(/_/g, ' ').toLowerCase();
}

/** "40 / 100 pull-ups" or "40 / 100" when there is no unit word. */
export function withUnit(text: string, unit: string): string {
  return unit ? `${text} ${unit}` : text;
}

const SINGULAR_UNITS: Record<string, string> = {
  workouts: 'workout',
  calories: 'calorie',
  steps: 'step',
  pounds: 'pound',
  miles: 'mile',
  minutes: 'minute',
};

/**
 * "1 workout", "2 workouts": built-in units singularise for exactly one. A
 * creator's custom label is printed as written, whatever the count.
 */
export function pluralUnit(unit: string, count: number): string {
  if (count === 1 && SINGULAR_UNITS[unit]) return SINGULAR_UNITS[unit];
  return unit;
}
