import { formatDuration, formatSummaryVolume, formatSummaryWeight, type WorkoutSummaryUnit } from './workoutSummary';
import { recapKindLabel, type RecapKind } from './recapSummary';

/**
 * The recap viewer's view model: the owner's weekly or monthly recap as the
 * API hands it back (backend services/recaps.js recapView / recapListRow,
 * models/Recap.js) and the pure functions that turn it into words and
 * numbers. Every weight in a recap is stored in kilograms (`volumeKg`,
 * `prs[].value` with unit 'kg'); `unit` only says how to print them. Reps
 * and minutes carry no unit. Kept free of React so node:test can load it
 * straight from source.
 */

export type { RecapKind };

export type RecapStatus = 'ready' | 'quiet' | 'locked';

export type RecapRecordType = 'heaviestWeightKg' | 'bestSetVolumeKg' | 'mostReps' | 'estimatedOneRepMaxKg' | 'longestDurationMin';

export type RecapRecord = {
  exerciseId?: string;
  name: string;
  type: RecapRecordType;
  value: number;
  unit: 'kg' | 'reps' | 'min';
  previousValue: number | null;
  workoutId?: string;
};

export type RecapDay = { date: string; sessions: number; minutes: number };

export type RecapTopExercise = { exerciseId?: string; name: string; sessions: number; sets: number };

export type RecapWeeksKept = { count: number; targetDays: number };

export type RecapGym = { communityId: string; name: string; visits: number };

export type RecapBuddy = { userId: string; username?: string; fullName?: string; avatar?: string; sessions: number };

export type RecapPrevious = { sessions: number; minutes: number; volumeKg: number };

export type RecapProgress = { sessions: number; needed: number; unlocksOn: string | null };

export type RecapData = {
  sessions: number;
  minutes: number;
  /** Always kilograms. */
  volumeKg: number;
  activeDays: string[];
  byDay: RecapDay[];
  prs: RecapRecord[];
  topExercises: RecapTopExercise[];
  weeksKept: RecapWeeksKept | null;
  /** null when the source package is absent; an already-filtered list otherwise. */
  gyms: RecapGym[] | null;
  buddies: RecapBuddy[] | null;
  /** Only on a ready recap. */
  previous: RecapPrevious | null;
  /** Only on a locked month. */
  progress: RecapProgress | null;
};

export type RecapShare = { destination: 'vybe' | 'instagram' | 'system'; variant: 'story' | 'feed'; at: string };

export type RecapSummaryNumbers = { sessions: number; minutes: number; prCount: number };

export type RecapView = {
  _id: string;
  kind: RecapKind;
  periodKey: string;
  /** Server-formatted ("Sep 14–20, 2026", "September 2026"); print verbatim. */
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  timezone: string | null;
  timezoneOffsetMinutes: number;
  status: RecapStatus;
  final: boolean;
  version: number;
  generatedAt: string;
  viewedAt: string | null;
  shares: RecapShare[];
  summary: RecapSummaryNumbers;
  data: RecapData;
};

export type RecapListRow = {
  _id: string;
  kind: RecapKind;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  status: 'ready' | 'quiet';
  final: true;
  generatedAt: string;
  viewedAt: string | null;
  shared: boolean;
  summary: RecapSummaryNumbers;
};

const whole = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const count = (n: number, one: string, many = `${one}s`) => `${whole(n)} ${n === 1 ? one : many}`;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A 'YYYY-MM-DD' key read as a calendar date, never shifted by the browser's zone. */
const parts = (dateKey: string): { y: number; m: number; d: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
};

const weekdayIndex = (dateKey: string): number | null => {
  const p = parts(dateKey);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : null;
};

/** "Sep 26" from '2026-09-26'; the key itself when it is not a date. */
export function shortDate(dateKey: string): string {
  const p = parts(dateKey);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${p.d}` : dateKey;
}

/** The label under a day cell: the weekday for a week ("Mon"), the day number for a month ("14"). */
export function dayLabel(dateKey: string, kind: RecapKind): string {
  const p = parts(dateKey);
  if (!p) return dateKey;
  if (kind === 'month') return String(p.d);
  const weekday = weekdayIndex(dateKey);
  return weekday === null ? dateKey : WEEKDAYS_SHORT[weekday];
}

/** Column of a day in a Monday-first grid (0 = Monday … 6 = Sunday); 0 when the key is not a date. */
export function mondayFirstIndex(dateKey: string): number {
  const weekday = weekdayIndex(dateKey);
  return weekday === null ? 0 : (weekday + 6) % 7;
}

/** "Monday, Sep 14: 1 session, 50 min" for a day cell's accessible name. */
export function dayDescription(day: RecapDay): string {
  const weekday = weekdayIndex(day.date);
  const when = weekday === null ? day.date : `${WEEKDAYS_LONG[weekday]}, ${shortDate(day.date)}`;
  if (!day.sessions) return `${when}: rest`;
  const time = formatDuration(day.minutes);
  return `${when}: ${count(day.sessions, 'session')}${time ? `, ${time}` : ''}`;
}

export const recapTitle = (kind: RecapKind): string => recapKindLabel(kind);

/** The badge on a recap whose period is still running. */
export function runningBadge(recap: Pick<RecapView, 'kind' | 'final'>): string | null {
  if (recap.final) return null;
  return recap.kind === 'month' ? 'This month so far' : 'This week so far';
}

export type RecapStat = { key: 'sessions' | 'time' | 'volume' | 'records' | 'weeks'; label: string; value: string };

/**
 * Headline numbers in display order. Zero or absent produces no stat, so a
 * quiet period never reads "0 kg" and an absent weeks-kept source never
 * shows a zero.
 */
export function recapHeadline(data: RecapData, unit: WorkoutSummaryUnit): RecapStat[] {
  const stats: RecapStat[] = [];
  if (data.sessions > 0) stats.push({ key: 'sessions', label: data.sessions === 1 ? 'Session' : 'Sessions', value: whole(data.sessions) });
  if (data.minutes > 0) stats.push({ key: 'time', label: 'Time trained', value: formatDuration(data.minutes) });
  if (typeof data.volumeKg === 'number' && data.volumeKg > 0) stats.push({ key: 'volume', label: 'Volume lifted', value: formatSummaryVolume(data.volumeKg, unit) });
  if (data.prs.length > 0) stats.push({ key: 'records', label: data.prs.length === 1 ? 'Record' : 'Records', value: whole(data.prs.length) });
  if (data.weeksKept && data.weeksKept.count > 0) {
    stats.push({ key: 'weeks', label: data.weeksKept.count === 1 ? 'Week kept' : 'Weeks kept', value: whole(data.weeksKept.count) });
  }
  return stats;
}

const RECORD_TYPE_LABELS: Record<RecapRecordType, string> = {
  heaviestWeightKg: 'Heaviest weight',
  bestSetVolumeKg: 'Best set volume',
  mostReps: 'Most reps',
  estimatedOneRepMaxKg: 'Estimated 1RM',
  longestDurationMin: 'Longest duration',
};

export function recordTypeLabel(type: string): string {
  return (RECORD_TYPE_LABELS as Record<string, string>)[type] ?? 'Record';
}

const recordValue = (record: Pick<RecapRecord, 'type' | 'unit'>, value: number, unit: WorkoutSummaryUnit): string => {
  if (record.unit === 'reps' || record.type === 'mostReps') {
    const reps = Math.max(0, Math.round(value));
    return `${whole(reps)} ${reps === 1 ? 'rep' : 'reps'}`;
  }
  if (record.unit === 'min' || record.type === 'longestDurationMin') return formatDuration(value) || '0 min';
  return formatSummaryWeight(value, unit);
};

/** "209.4 lb → 220.5 lb" when the beaten value is known, "220.5 lb" otherwise; reps and minutes carry no unit conversion. */
export function recordLine(record: RecapRecord, unit: WorkoutSummaryUnit): string {
  const now = recordValue(record, record.value, unit);
  if (typeof record.previousValue === 'number' && Number.isFinite(record.previousValue)) {
    return `${recordValue(record, record.previousValue, unit)} → ${now}`;
  }
  return now;
}

export type RecapDelta = { value: number | string; direction: 'up' | 'down' | 'flat'; label: string };
export type RecapDeltas = { sessions?: RecapDelta; time?: RecapDelta; volume?: RecapDelta };

const direction = (diff: number): RecapDelta['direction'] => (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat');

/**
 * "Compare" deltas against the member's own previous period. Only a ready
 * recap carries `previous`; anything else compares to nothing (no loss
 * statement on a quiet stretch).
 */
export function compareDeltas(data: RecapData, unit: WorkoutSummaryUnit, kind: RecapKind): RecapDeltas {
  const previous = data.previous;
  if (!previous) return {};
  const label = kind === 'month' ? 'vs last month' : 'vs last week';
  const deltas: RecapDeltas = {};
  const sessions = data.sessions - previous.sessions;
  deltas.sessions = { value: sessions, direction: direction(sessions), label };
  const minutes = data.minutes - previous.minutes;
  const time = formatDuration(Math.abs(minutes));
  deltas.time = { value: minutes === 0 ? '±0' : `${minutes > 0 ? '+' : '−'}${time}`, direction: direction(minutes), label };
  const volumeKg = data.volumeKg - previous.volumeKg;
  const volume = formatSummaryVolume(Math.abs(volumeKg), unit);
  deltas.volume = { value: volumeKg === 0 ? '±0' : `${volumeKg > 0 ? '+' : '−'}${volume}`, direction: direction(volumeKg), label };
  return deltas;
}

/** The API's own sentence for a share attempted on a locked month. */
export const LOCKED_SHARE_MESSAGE = 'This recap unlocks later in the month. Share it once it is ready.';

/**
 * Why a month is still locked, from the API's progress block: the count is
 * only phrased as "N of M" while it is short of M, the unlock date only when
 * the calendar still holds the month. Nothing about the rule (the day, the
 * minimum) is hard-coded here.
 */
export function lockedCopy(progress: RecapProgress | null | undefined): string {
  if (!progress) return 'This recap unlocks later in the month.';
  const short = progress.sessions < progress.needed;
  const soFar = short
    ? `${whole(progress.sessions)} of ${count(progress.needed, 'session')} so far.`
    : `${count(progress.sessions, 'session')} so far.`;
  if (progress.unlocksOn) {
    return short
      ? `${soFar} Unlocks on ${shortDate(progress.unlocksOn)} with ${count(progress.needed, 'session')} or more.`
      : `${soFar} Unlocks on ${shortDate(progress.unlocksOn)}.`;
  }
  if (short) {
    const remaining = progress.needed - progress.sessions;
    return `${soFar} Log ${count(remaining, 'more session')} to unlock this month.`;
  }
  return `${soFar} This month unlocks shortly.`;
}

export function quietCopy(kind: RecapKind): string {
  return kind === 'month' ? 'A quiet month. The next one is a fresh start.' : 'A quiet week. The next one is a fresh start.';
}

/** "8 weeks kept · 3+ days a week" */
export function weeksKeptCopy(weeksKept: RecapWeeksKept): string {
  return `${count(weeksKept.count, 'week')} kept · ${weeksKept.targetDays}+ ${weeksKept.targetDays === 1 ? 'day' : 'days'} a week`;
}

export function activeDaysCopy(activeDays: string[]): string {
  return count(activeDays.length, 'active day');
}

/** "4 sessions · 3 h 12 min · 2 records" for a list row; "No sessions" for a quiet one. */
export function summaryLine(summary: RecapSummaryNumbers): string {
  if (!summary.sessions) return 'No sessions';
  const bits = [count(summary.sessions, 'session')];
  const time = formatDuration(summary.minutes);
  if (time) bits.push(time);
  if (summary.prCount > 0) bits.push(count(summary.prCount, 'record'));
  return bits.join(' · ');
}

export const HIDDEN_FIELDS = ['weights', 'gyms', 'buddies'] as const;
export type HiddenField = (typeof HIDDEN_FIELDS)[number];

export const HIDDEN_FIELD_LABELS: Record<HiddenField, string> = {
  weights: 'Hide weights',
  gyms: 'Hide gyms',
  buddies: 'Hide buddies',
};

/** Honest helper text: only weights change the card; gyms and buddies are never on one. */
export const HIDDEN_FIELD_HELP: Record<HiddenField, string> = {
  weights: 'Leaves the volume you lifted off the card.',
  gyms: 'Gyms never appear on a shared card. This only records your choice.',
  buddies: 'Buddies never appear on a shared card. This only records your choice.',
};

export const isHiddenField = (value: unknown): value is HiddenField => typeof value === 'string' && (HIDDEN_FIELDS as readonly string[]).includes(value);

/** The exact POST /posts/create body for a recap card: whitelisted, deduped hidden fields and a trimmed caption. */
export function sharePostBody({ recapId, caption, hiddenFields }: { recapId: string; caption?: string | null; hiddenFields?: readonly string[] | null }) {
  const hidden: HiddenField[] = [];
  for (const field of hiddenFields ?? []) {
    if (isHiddenField(field) && !hidden.includes(field)) hidden.push(field);
  }
  return {
    content: (caption ?? '').trim(),
    medias: [] as never[],
    hashtags: [] as string[],
    isPublic: true,
    recapSummary: { recapId, hiddenFields: hidden },
  };
}

export const canShare = (recap: Pick<RecapView, 'status'> | null | undefined): boolean => !!recap && recap.status !== 'locked';

/** History rows minus the ones already shown as current cards (the last closed week is both, Monday to Sunday evening). */
export function dedupeHistory<T extends { _id: string }>(rows: T[], currentIds: Iterable<string | null | undefined>): T[] {
  const skip = new Set<string>();
  for (const id of currentIds) if (id) skip.add(id);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (skip.has(row._id) || seen.has(row._id)) continue;
    seen.add(row._id);
    out.push(row);
  }
  return out;
}
