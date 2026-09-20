import { differenceInCalendarDays, differenceInCalendarWeeks, format, isToday, isValid, isYesterday, parseISO, startOfDay, startOfWeek, subWeeks } from 'date-fns';
import { api } from '../../lib/api';
import type { LogExercise } from './exerciseDraft';

/**
 * Logged sessions (GET /workouts/logs) and the arithmetic the Train hub and
 * History derive from them: the week figure, the stats strip, the streak of
 * weeks kept, and "You, yesterday — bench press 82.5 kg × 5". Weeks start on
 * Monday, as the gym check-in board's do. Pure below `fetch*`, so the maths
 * is unit-tested without a DOM.
 */

export type WorkoutLog = {
  _id: string;
  date: string;
  name?: string;
  type?: string;
  duration?: number;
  caloriesBurned?: number;
  exercises: LogExercise[];
  notes?: string;
  hashtags?: string[];
  isCompleted?: boolean;
  createdAt?: string;
  /** 1 when the log carries individual sets; PATCH must echo it. */
  setRecordsVersion?: number;
  /** Optimistic-concurrency counter; PATCH sends it back as `expectedRevision`. */
  revision?: number;
  /** Server-computed tonnage in kg (individual sets counted only when completed). */
  volumeKg?: number;
};

export type LogsResponse = { workouts: WorkoutLog[]; total: number; page: number; hasNextPage: boolean };

export const LOGS_KEY = ['workout-logs'] as const;
export const LOGS_LIMIT = 100;

export async function fetchLogs(): Promise<LogsResponse> {
  const { data } = await api.get<LogsResponse>('/workouts/logs', { params: { page: 1, limit: LOGS_LIMIT } });
  return data;
}

export async function fetchLog(logId: string): Promise<WorkoutLog> {
  const { data } = await api.get<{ workout: WorkoutLog }>(`/workouts/logs/${logId}`);
  return data.workout;
}

/* ------------------------------------------------------------- utilities */

export const parseLogDate = (value?: string): Date | null => {
  if (!value) return null;
  const d = value.includes('T') ? parseISO(value) : new Date(value);
  return isValid(d) ? d : null;
};

export const dayKey = (d: Date) => format(startOfDay(d), 'yyyy-MM-dd');
export const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMMM'));

/** Newest first; an unparseable date sorts last. */
export const sortLogs = (logs: readonly WorkoutLog[]): WorkoutLog[] =>
  [...logs].sort((a, b) => (parseLogDate(b.date)?.getTime() ?? 0) - (parseLogDate(a.date)?.getTime() ?? 0));

/** Tonnage in kg: the server's figure when it sent one, else sets × reps × weight per exercise. */
export function sessionVolume(log: Pick<WorkoutLog, 'exercises' | 'volumeKg'>): number {
  if (typeof log.volumeKg === 'number' && Number.isFinite(log.volumeKg)) return log.volumeKg;
  return (log.exercises ?? []).reduce((sum, ex) => {
    if (Array.isArray(ex.setRecords)) {
      return sum + ex.setRecords.reduce((s, set) => s + (set.completed ? set.reps * set.weight * (set.weightUnit === 'lb' ? 0.45359237 : 1) : 0), 0);
    }
    return sum + (Number(ex.sets) || 0) * (Number(ex.reps) || 0) * (Number(ex.weight) || 0);
  }, 0);
}

/** "Yesterday", "3 days ago", "Last week", "3 weeks ago", "12 Jun". Relative to `now`. */
export function relativeDay(d: Date, now: Date = new Date()): string {
  const days = differenceInCalendarDays(now, d);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = differenceInCalendarWeeks(now, d, { weekStartsOn: 1 });
  if (weeks <= 1) return 'Last week';
  if (weeks < 5) return `${weeks} weeks ago`;
  return format(d, 'd MMM');
}

/* ------------------------------------------------------------- the week */

export type WeekTotals = { sessions: number; minutes: number; volumeKg: number };

const add = (acc: WeekTotals, log: WorkoutLog): WeekTotals => ({
  sessions: acc.sessions + 1,
  minutes: acc.minutes + (Number(log.duration) || 0),
  volumeKg: acc.volumeKg + sessionVolume(log),
});

export const EMPTY_WEEK: WeekTotals = { sessions: 0, minutes: 0, volumeKg: 0 };

/** Totals for the Monday-start week containing `now`, and the week before it. */
export function weekTotals(logs: readonly WorkoutLog[], now: Date = new Date()): { week: WeekTotals; lastWeek: WeekTotals } {
  const start = startOfWeek(now, { weekStartsOn: 1 });
  const prevStart = subWeeks(start, 1);
  let week = EMPTY_WEEK;
  let lastWeek = EMPTY_WEEK;
  for (const log of logs) {
    const d = parseLogDate(log.date);
    if (!d) continue;
    if (d >= start) week = add(week, log);
    else if (d >= prevStart) lastWeek = add(lastWeek, log);
  }
  return { week, lastWeek };
}

/**
 * Consecutive Monday-start weeks with at least one session, counted back from
 * this week. The current week counts when it has a session and does not break
 * the run while it is still open: a member who trained every week until last
 * Sunday has kept all of them on Monday morning.
 */
export function weeksKept(logs: readonly WorkoutLog[], now: Date = new Date()): number {
  const weeks = new Set<number>();
  for (const log of logs) {
    const d = parseLogDate(log.date);
    if (d) weeks.add(startOfWeek(d, { weekStartsOn: 1 }).getTime());
  }
  let cursor = startOfWeek(now, { weekStartsOn: 1 });
  let run = 0;
  if (!weeks.has(cursor.getTime())) cursor = subWeeks(cursor, 1);
  while (weeks.has(cursor.getTime())) {
    run += 1;
    cursor = subWeeks(cursor, 1);
  }
  return run;
}

/** Consecutive trained days ending today (or yesterday, if today is still open). */
export function dayStreak(logs: readonly WorkoutLog[], now: Date = new Date()): number {
  const days = new Set<string>();
  for (const log of logs) {
    const d = parseLogDate(log.date);
    if (d) days.add(dayKey(d));
  }
  const end = startOfDay(now);
  let cursor = days.has(dayKey(end)) ? end : new Date(end.getTime() - 86_400_000);
  let run = 0;
  while (days.has(dayKey(cursor))) {
    run += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return run;
}

/* -------------------------------------------------- the card's session line */

/** The most recent session per workout title (a log seeded from a library workout carries its title). */
export function lastDoneByTitle(logs: readonly WorkoutLog[]): Map<string, WorkoutLog> {
  const out = new Map<string, WorkoutLog>();
  for (const log of sortLogs(logs)) {
    const key = (log.name ?? '').trim().toLowerCase();
    if (key && !out.has(key)) out.set(key, log);
  }
  return out;
}

export type TopSet = { name: string; weightKg?: number; reps?: number; sets?: number; seconds?: number };

/** The heaviest lift of a session, else its first exercise with any fact: what the card quotes. */
export function topSet(log: Pick<WorkoutLog, 'exercises'>): TopSet | null {
  let best: TopSet | null = null;
  for (const ex of log.exercises ?? []) {
    if (!ex.name) continue;
    if (Array.isArray(ex.setRecords) && ex.setRecords.length) {
      const heaviest = ex.setRecords.filter((s) => s.completed !== false).reduce<(typeof ex.setRecords)[number] | null>((m, s) => (m == null || s.weight > m.weight ? s : m), null);
      if (heaviest && heaviest.weight > 0) {
        const kg = heaviest.weight * (heaviest.weightUnit === 'lb' ? 0.45359237 : 1);
        if (!best || (best.weightKg ?? 0) < kg) best = { name: ex.name, weightKg: kg, reps: heaviest.reps };
      }
      continue;
    }
    const weight = Number(ex.weight) || 0;
    if (weight > 0) {
      if (!best || (best.weightKg ?? 0) < weight) best = { name: ex.name, weightKg: weight, reps: Number(ex.reps) || undefined };
    } else if (!best) {
      if (ex.duration) best = { name: ex.name, seconds: Number(ex.duration) };
      else if (ex.reps) best = { name: ex.name, sets: Number(ex.sets) || undefined, reps: Number(ex.reps) };
    }
  }
  return best;
}
