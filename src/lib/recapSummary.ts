import { formatDuration, formatSummaryVolume, type WorkoutSummaryUnit } from './workoutSummary';

/**
 * The recap share card the API snapshots onto a post (backend
 * models/extensions/post/recaps.js, built by services/recapSummary.js from
 * the author's own Recap). Behaviour numbers only: sessions, minutes, records,
 * the top exercise names, weeks kept, and the total volume unless the author
 * hid weights (the server drops `volumeKg` then). Gyms and buddies never ride
 * on a card. The recap has no unit of its own, so volume prints in the
 * viewer's unit.
 *
 * `kind` gained `'year'` with v2-be-h9-recaps-year: buildPostRecapSummary
 * passes the recap's own kind through, so a shared Year in Vybe card arrives
 * here with the same fields a month does.
 */
export type RecapKind = 'week' | 'month' | 'year';

export type RecapSummary = {
  recapId: string;
  kind: RecapKind;
  periodKey: string;
  periodLabel: string;
  sessions: number;
  minutes: number;
  volumeKg?: number;
  prCount?: number;
  topExercises?: string[];
  weeksKept?: number;
  hiddenFields?: Array<'weights' | 'gyms' | 'buddies'>;
};

export const RECAP_KINDS: readonly RecapKind[] = ['week', 'month', 'year'];

export function hasRecapSummary(value: unknown): value is RecapSummary {
  return !!value && typeof value === 'object'
    && typeof (value as RecapSummary).recapId === 'string'
    && RECAP_KINDS.includes((value as RecapSummary).kind);
}

export function recapKindLabel(kind: RecapKind): string {
  if (kind === 'year') return 'Year in Vybe';
  return kind === 'month' ? 'Monthly recap' : 'Weekly recap';
}

const whole = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export type RecapStat = { key: 'sessions' | 'time' | 'volume' | 'prs' | 'weeks'; label: string; value: string };

/**
 * Headline numbers in display order. Absent or zero fields produce no stat
 * (a hidden volume never resurfaces; a week with no records shows no "0 PRs").
 * `weeksKept` only means something on a monthly card.
 */
export function recapStats(summary: RecapSummary, unit: WorkoutSummaryUnit): RecapStat[] {
  const stats: RecapStat[] = [];
  if (summary.sessions > 0) stats.push({ key: 'sessions', label: summary.sessions === 1 ? 'session' : 'sessions', value: whole(summary.sessions) });
  if (summary.minutes > 0) stats.push({ key: 'time', label: 'trained', value: formatDuration(summary.minutes) });
  if (typeof summary.volumeKg === 'number' && summary.volumeKg > 0) stats.push({ key: 'volume', label: 'lifted', value: formatSummaryVolume(summary.volumeKg, unit) });
  if (typeof summary.prCount === 'number' && summary.prCount > 0) stats.push({ key: 'prs', label: summary.prCount === 1 ? 'PR' : 'PRs', value: whole(summary.prCount) });
  // Weeks kept means something over a month or a year, not over one week.
  if (summary.kind !== 'week' && typeof summary.weeksKept === 'number' && summary.weeksKept > 0) {
    stats.push({ key: 'weeks', label: summary.weeksKept === 1 ? 'week kept' : 'weeks kept', value: whole(summary.weeksKept) });
  }
  return stats;
}
