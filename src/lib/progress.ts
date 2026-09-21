import { KG_PER_LB, KM_PER_MI, kgToLb, kmToMi, weightUnit, type UnitSystem } from './unitConversions';
import { formatBestSet, formatDuration, formatSummaryVolume, formatSummaryWeight } from './workoutSummary';
import { apiErrorDetails } from './apiError';

/**
 * The progression hub's pure model (design-progression-hub.md §3.8, §3.9, §4)
 * over the Wave F1 records API (docs/api-contract.md "Progression: suggested
 * next set, distance and pace records, summary rows and the training
 * calendar"). Every number on the wire is metric: kilograms, kilometres,
 * seconds per kilometre. Only the formatters here convert, and only for
 * display, in the viewer's unit system.
 *
 * Dates: the API keys local days as `YYYY-MM-DD` in the caller's raw
 * `getTimezoneOffset()` (lib/timezone.ts). Day arithmetic here goes through
 * `Date.UTC` on the key's parts, never `new Date('YYYY-MM-DD')`, so a weekday
 * or a shifted key never depends on the device's zone.
 *
 * No hooks, no DOM, no store: tests/progress-model.test.mjs loads this file
 * straight from source and the pure cards under pages/progress take `system`
 * as a prop.
 */

/* ------------------------------------------------------------------ wire types */

export type ProgressPeriod = 'week' | 'month' | 'quarter' | 'year';
export type ProgressMeasure = 'reps' | 'duration' | 'distance';
export type WeightUnit = 'kg' | 'lb';

export type RecordType =
  | 'heaviestWeightKg'
  | 'bestSetVolumeKg'
  | 'mostReps'
  | 'estimatedOneRepMaxKg'
  | 'longestDurationMin'
  | 'longestDistanceKm'
  | 'bestPaceSecPerKm';

/** One local day of `summary.byDay` (with volume) or `calendar.days` (without). */
export type ProgressDay = { date: string; sessions: number; minutes: number; volumeKg?: number };

export type ProgressPr = {
  exerciseId: string;
  exerciseName: string;
  type: RecordType;
  value: number;
  previousValue?: number | null;
  unit: string;
  reps?: number;
  weightKg?: number;
  setId?: string;
  estimated?: boolean;
  date: string;
  workoutId: string;
};

export type ProgressMuscleGroup = { group: string; sets: number; secondarySets: number };

export type ProgressBest = { type: RecordType; value: number; unit: string } | null;

export type ProgressExercise = {
  exerciseId: string;
  name: string;
  sessions: number;
  sets: number;
  measure: ProgressMeasure;
  best: ProgressBest;
};

export type ProgressPreviousWindow = {
  from: string;
  to: string;
  sessions: number;
  totalVolumeKg: number;
  totalMinutes: number;
  setCount: number;
};

/** GET /workouts/records/summary (span <= 92 days). */
export type ProgressSummary = {
  from: string;
  to: string;
  timezoneOffsetMinutes: number;
  sessions: number;
  totalVolumeKg: number;
  totalMinutes: number;
  setCount?: number;
  byDay: ProgressDay[];
  prCount: number;
  prs: ProgressPr[];
  previous?: ProgressPreviousWindow | null;
  muscleGroups?: ProgressMuscleGroup[];
  exercises?: ProgressExercise[];
};

/** GET /workouts/records/calendar (span <= 371 days; 404 FEATURE_DISABLED while the flag is off). */
export type ProgressCalendar = { from: string; to: string; timezoneOffsetMinutes: number; days: ProgressDay[] };

/** A set as logged (`id`, `completed`) or a synthetic row from a legacy aggregate (`synthetic: true`, no `completed`). */
export type HistorySet = {
  id?: string;
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
  completed?: boolean;
  synthetic?: boolean;
};

/** One session of GET /workouts/records/history; durationMin / distanceKm only when > 0. */
export type ProgressHistoryRow = {
  workoutId: string;
  date: string;
  name: string;
  exerciseName: string;
  sets: HistorySet[];
  volumeKg: number;
  durationMin?: number;
  distanceKm?: number;
};

export type ProgressHistory = { exerciseId: string; sessions: ProgressHistoryRow[]; total: number; page: number; hasNextPage: boolean };

export type ProgressRecord = {
  value: number;
  unit: string;
  date: string;
  workoutId: string;
  reps?: number;
  weightKg?: number;
  setId?: string;
  estimated?: boolean;
};

/** GET /workouts/records: one entry per requested id, null when never recorded. */
export type ProgressRecords = Record<string, Partial<Record<RecordType, ProgressRecord | null>> | null>;

export type ProgressBasisSet = { reps: number; weight: number; weightUnit: WeightUnit; working: boolean };
export type ProgressBasis = { workoutId: string; date: string; sets: ProgressBasisSet[] };

export type ProgressSuggested = {
  kind: 'add' | 'hold' | 'deload';
  weight: number;
  weightUnit: WeightUnit;
  reps: number;
  range: { min: number; max: number };
  rule: 'top-of-range-twice' | 'below-range-twice' | 'hold';
  step: number;
  basis: ProgressBasis[];
};

/** GET /workouts/records/previous: `suggested` exists only while the flag is on. */
export type ProgressPreviousResponse = { previous: unknown; suggested?: ProgressSuggested | null };

/* ------------------------------------------------------------------ copy */

export const PROGRESS_STRINGS = {
  title: 'Progress',
  subtitle: 'Sessions, sets, volume and minutes over your own history.',
  period: 'Period',
  tiles: { sessions: 'Sessions', sets: 'Sets', volume: 'Volume', minutes: 'Minutes' },
  calendar: 'Training days',
  calendarLegend: '0 · 1 · 2 · 3+ sessions',
  yearSummaryNote: 'Everything except Training days covers the last 3 months.',
  yearAllQuarterNote: 'Everything here covers the last 3 months.',
  yearFallback: 'Showing 3 months. The year view arrives with a later update.',
  muscles: 'Muscle groups',
  musclesFootnote: 'Counts sets on exercises the library knows. Custom exercises count under Other.',
  showAll: 'Show all',
  showFewer: 'Show fewer',
  movements: 'Movements',
  records: 'Records',
  recordsEmptyTitle: 'No new records this period',
  recordsEmptyBody: 'Log a session and beat your own past.',
  bests: 'Personal records',
  bestsEmpty: 'Records appear after your first logged sets.',
  bestsRemove: 'Remove this record',
  bestsReset: 'Start fresh from a date…',
  bestsResetTitle: 'Start fresh?',
  bestsResetConfirm: 'Start fresh',
  bestsResetFrom: 'Records set before',
  bestsResetUndo: 'You can undo this.',
  bestsPerExercise: 'Starting fresh applies to one movement at a time, from its own menu.',
  adjustments: 'Adjustments',
  adjustmentsShow: 'Show',
  adjustmentsNone: 'Nothing has been removed or reset.',
  undo: 'Undo',
  estimateMark: 'est.',
  emptyTitle: 'Nothing logged this period',
  emptyBody: 'Log a session and this fills in.',
  emptyCta: 'Log session',
  cardError: 'Could not load your progress.',
  retry: 'Try again',
  trend: 'Trend',
  trendEmpty: 'Two sessions and the trend draws itself',
  lastHundred: 'Last 100 sessions',
  approximate: 'approximate',
  basedOn: 'Based on',
  settingsTitle: 'Workouts',
  suggestions: 'Suggestions',
  suggestionsBody: 'One line under Previous with the rule spelled out. Never a plan.',
  repRange: 'Default rep range',
  lowest: 'Lowest reps',
  highest: 'Highest reps',
  saveRange: 'Save range',
  resetRange: 'Back to 8–12',
  rangeError: 'Lowest must be below highest',
} as const;

/* ------------------------------------------------------------------ periods */

export const PERIOD_DAYS: Record<ProgressPeriod, number> = { week: 7, month: 30, quarter: 91, year: 365 };

/** The summary is capped at 92 days, so the Year chip reads the quarter for everything but the calendar. */
export const YEAR_FALLBACK: ProgressPeriod = 'quarter';

export const PERIODS: ReadonlyArray<{ key: ProgressPeriod; label: string }> = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: '3 months' },
  { key: 'year', label: 'Year' },
];

export const isProgressPeriod = (value: unknown): value is ProgressPeriod => typeof value === 'string' && value in PERIOD_DAYS;

export type ProgressRange = { from: string; to: string; days: number; timezoneOffsetMinutes: number };

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The device's local day of a Date as `YYYY-MM-DD`. */
export const localDateKey = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Calendar parts of a `YYYY-MM-DD` key, or null for anything else (including 2026-02-30). */
export function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

const utcOfKey = (key: string): number | null => {
  const parts = parseDateKey(key);
  return parts ? Date.UTC(parts.y, parts.m - 1, parts.d) : null;
};

const keyOfUtc = (t: number): string => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

/** `key` moved by whole calendar days; DST never shortens or lengthens a step. */
export const shiftDateKey = (key: string, days: number): string => {
  const t = utcOfKey(key);
  return t === null ? key : keyOfUtc(t + days * DAY_MS);
};

/** 0 = Monday … 6 = Sunday, from the calendar date alone. */
export const mondayIndex = (key: string): number => {
  const t = utcOfKey(key);
  return t === null ? 0 : (new Date(t).getUTCDay() + 6) % 7;
};

/**
 * `days` local days ending today, as the API's day keys, plus the raw
 * `getTimezoneOffset()` the API expects (never negated; see lib/timezone.ts).
 */
export function periodRange(period: ProgressPeriod, now: Date = new Date()): ProgressRange {
  const days = PERIOD_DAYS[period];
  const to = localDateKey(now);
  return { from: shiftDateKey(to, -(days - 1)), to, days, timezoneOffsetMinutes: now.getTimezoneOffset() };
}

/** "1–7 Sep" · "22 Aug–20 Sep" · "21 Sep 2025–20 Sep 2026". */
export function periodLabel({ from, to }: { from: string; to: string }): string {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (!a || !b) return '';
  if (a.y !== b.y) return `${a.d} ${MONTHS_SHORT[a.m - 1]} ${a.y}–${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS_SHORT[a.m - 1]}–${b.d} ${MONTHS_SHORT[b.m - 1]}`;
  if (a.d === b.d) return `${a.d} ${MONTHS_SHORT[a.m - 1]}`;
  return `${a.d}–${b.d} ${MONTHS_SHORT[a.m - 1]}`;
}

/**
 * "3 Sep" for a day key or an ISO instant (read on the device's clock), with
 * the year appended when it is not `now`'s year.
 */
export function shortDate(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '';
  const parts = parseDateKey(value);
  let d: number;
  let m: number;
  let y: number;
  if (parts) {
    ({ d, m, y } = parts);
  } else {
    const at = new Date(value);
    if (!Number.isFinite(at.getTime())) return '';
    d = at.getDate();
    m = at.getMonth() + 1;
    y = at.getFullYear();
  }
  const base = `${d} ${MONTHS_SHORT[m - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

/* ------------------------------------------------------------------ numbers */

const MINUS = '−';
const whole = (n: number) => Math.round(Math.abs(n)).toLocaleString(undefined, { maximumFractionDigits: 0 });
const oneDecimal = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export const countLabel = (n: number, one: string, many = `${one}s`) => `${whole(n)} ${Math.round(n) === 1 ? one : many}`;

/** A neutral delta: "+2", "−1" (U+2212), "same". Never a colour, never a verdict. */
const signed = (diff: number, suffix = ''): string => (diff === 0 ? 'same' : `${diff > 0 ? '+' : MINUS}${whole(diff)}${suffix}`);

export const countDelta = (now: number, before: number): string => signed(Math.round(now) - Math.round(before));

export const minutesDelta = (now: number, before: number): string => signed(Math.round(now) - Math.round(before), ' min');

/** Compared in whole units after conversion, so 0.4 kg of float noise never reads as a change. */
export function volumeDelta(nowKg: number, beforeKg: number, unit: WeightUnit): string {
  const shown = (kg: number) => Math.round(unit === 'lb' ? kgToLb(kg) : kg);
  return signed(shown(nowKg) - shown(beforeKg), ` ${unit}`);
}

export type ProgressTile = { key: 'sessions' | 'sets' | 'volume' | 'minutes'; label: string; value: string; hint?: string };

const hintFor = (delta: string, days: number) => (delta === 'same' ? `same as the previous ${days} days` : `${delta} vs the previous ${days} days`);

/**
 * The four "This period" tiles. `hint` is the neutral delta against the
 * previous window, or undefined when the API sent no `previous`.
 */
export function statTiles(
  summary: Pick<ProgressSummary, 'sessions' | 'setCount' | 'totalVolumeKg' | 'totalMinutes' | 'previous'> | null | undefined,
  unit: WeightUnit,
  days: number,
): ProgressTile[] {
  const sessions = summary?.sessions ?? 0;
  const sets = summary?.setCount ?? 0;
  const volumeKg = summary?.totalVolumeKg ?? 0;
  const minutes = summary?.totalMinutes ?? 0;
  const previous = summary?.previous ?? null;
  return [
    { key: 'sessions', label: PROGRESS_STRINGS.tiles.sessions, value: whole(sessions), hint: previous ? hintFor(countDelta(sessions, previous.sessions), days) : undefined },
    { key: 'sets', label: PROGRESS_STRINGS.tiles.sets, value: whole(sets), hint: previous ? hintFor(countDelta(sets, previous.setCount ?? 0), days) : undefined },
    { key: 'volume', label: PROGRESS_STRINGS.tiles.volume, value: formatSummaryVolume(volumeKg, unit) || `0 ${unit}`, hint: previous ? hintFor(volumeDelta(volumeKg, previous.totalVolumeKg, unit), days) : undefined },
    { key: 'minutes', label: PROGRESS_STRINGS.tiles.minutes, value: formatDuration(minutes) || '0 min', hint: previous ? hintFor(minutesDelta(minutes, previous.totalMinutes), days) : undefined },
  ];
}

/* ------------------------------------------------------------------ calendar */

export type RampLevel = 0 | 1 | 2 | 3;

export const rampLevel = (sessions: number): RampLevel => (sessions <= 0 ? 0 : sessions === 1 ? 1 : sessions === 2 ? 2 : 3);

export type CalendarCell = { date: string; sessions: number; minutes: number; level: RampLevel; label: string };

export type CalendarGrid = {
  /** Monday-first columns of seven; null pads the first and last week. */
  columns: Array<Array<CalendarCell | null>>;
  cells: CalendarCell[];
  totalSessions: number;
  activeDays: number;
};

/**
 * Every day of [from, to] once, in order, with missing dates at zero, laid
 * out in Monday-first week columns. Works over `calendar.days` or
 * `summary.byDay` alike (both carry date / sessions / minutes).
 */
export function calendarGrid(range: { from: string; to: string }, days: ReadonlyArray<ProgressDay> | null | undefined, now: Date = new Date()): CalendarGrid {
  const byDate = new Map<string, ProgressDay>();
  for (const day of days ?? []) byDate.set(day.date, day);
  const start = utcOfKey(range.from);
  const end = utcOfKey(range.to);
  const cells: CalendarCell[] = [];
  let totalSessions = 0;
  let activeDays = 0;
  if (start !== null && end !== null && start <= end) {
    for (let t = start; t <= end; t += DAY_MS) {
      const date = keyOfUtc(t);
      const row = byDate.get(date);
      const sessions = Math.max(0, Math.round(row?.sessions ?? 0));
      const minutes = Math.max(0, Math.round(row?.minutes ?? 0));
      totalSessions += sessions;
      if (sessions > 0) activeDays += 1;
      cells.push({ date, sessions, minutes, level: rampLevel(sessions), label: `${shortDate(date, now)}, ${countLabel(sessions, 'session')}` });
    }
  }
  const columns: Array<Array<CalendarCell | null>> = [];
  let column: Array<CalendarCell | null> = [];
  if (cells.length) for (let i = 0; i < mondayIndex(cells[0].date); i += 1) column.push(null);
  for (const cell of cells) {
    column.push(cell);
    if (column.length === 7) {
      columns.push(column);
      column = [];
    }
  }
  if (column.length) {
    while (column.length < 7) column.push(null);
    columns.push(column);
  }
  return { columns, cells, totalSessions, activeDays };
}

/* ------------------------------------------------------------------ muscle groups */

/** models/ExerciseDefinition.js MUSCLE_GROUPS, in the canonical order the API sorts ties by. */
export const MUSCLE_GROUPS: readonly string[] = [
  'chest',
  'upper-back',
  'lats',
  'lower-back',
  'front-delts',
  'side-delts',
  'rear-delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
];

/** 'front-delts' → 'Front delts'; 'other' → 'Other'. */
export function muscleName(group: string): string {
  const text = group.replace(/-/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

export type MuscleRow = { group: string; name: string; sets: number; secondarySets: number; fraction: number };

export const MUSCLE_ROWS_COLLAPSED = 8;

/** Rows in the API's order with a bar fraction against the busiest group; the top 8 unless `showAll`. */
export function muscleRows(groups: ReadonlyArray<ProgressMuscleGroup> | null | undefined, showAll: boolean, limit = MUSCLE_ROWS_COLLAPSED): { rows: MuscleRow[]; hasMore: boolean; total: number } {
  const list = (groups ?? []).filter((g) => g && typeof g.group === 'string');
  const busiest = list.reduce((best, g) => Math.max(best, g.sets || 0), 0);
  const rows = list.map((g) => ({
    group: g.group,
    name: muscleName(g.group),
    sets: Math.max(0, Math.round(g.sets || 0)),
    secondarySets: Math.max(0, Math.round(g.secondarySets || 0)),
    fraction: busiest > 0 ? Math.min(1, Math.max(0, (g.sets || 0) / busiest)) : 0,
  }));
  return { rows: showAll ? rows : rows.slice(0, limit), hasMore: rows.length > limit, total: rows.length };
}

/* ------------------------------------------------------------------ time, pace, distance */

/** "5:24" · "1:02:03" from whole seconds. */
export function formatClock(totalSec: number): string {
  const total = Math.max(0, Math.round(Number(totalSec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Seconds per kilometre on the wire → "5:24 /km" or "8:41 /mi". */
export function formatPace(secPerKm: number, system: UnitSystem): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '';
  return system === 'imperial' ? `${formatClock(secPerKm * KM_PER_MI)} /mi` : `${formatClock(secPerKm)} /km`;
}

/** Kilometres on the wire → "5.0 km" or "3.1 mi". */
export function formatDistanceKm(km: number, system: UnitSystem): string {
  if (!Number.isFinite(km) || km < 0) return '';
  return system === 'imperial' ? `${kmToMi(km).toFixed(1)} mi` : `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

/** A load in the unit it was logged in: "100 kg", "102.5 kg", "225 lb". */
export const formatLoggedWeight = (weight: number, unit: WeightUnit): string => `${oneDecimal(Number(weight) || 0)} ${unit}`;

/* ------------------------------------------------------------------ records */

export const RECORD_TYPES: readonly RecordType[] = [
  'heaviestWeightKg',
  'bestSetVolumeKg',
  'mostReps',
  'estimatedOneRepMaxKg',
  'longestDurationMin',
  'longestDistanceKm',
  'bestPaceSecPerKm',
];

export const RECORD_TYPE_TITLES: Record<RecordType, string> = {
  heaviestWeightKg: 'Heaviest weight',
  bestSetVolumeKg: 'Best set volume',
  mostReps: 'Most reps',
  estimatedOneRepMaxKg: 'Estimated 1RM',
  longestDurationMin: 'Longest hold',
  longestDistanceKm: 'Longest distance',
  bestPaceSecPerKm: 'Best pace',
};

export const isRecordType = (value: unknown): value is RecordType => typeof value === 'string' && (RECORD_TYPES as readonly string[]).includes(value);

/** Lower is better for pace only. */
export const lowerIsBetter = (type: RecordType): boolean => type === 'bestPaceSecPerKm';

/** A record's number in the viewer's system: kg → lb, km → mi, s/km → /mi, minutes → a clock. */
export function formatRecordValue(type: RecordType, value: number, system: UnitSystem = 'metric'): string {
  if (!Number.isFinite(value)) return '';
  switch (type) {
    case 'heaviestWeightKg':
    case 'estimatedOneRepMaxKg':
      return formatSummaryWeight(value, weightUnit(system));
    case 'bestSetVolumeKg':
      return formatSummaryVolume(value, weightUnit(system));
    case 'mostReps':
      return countLabel(value, 'rep');
    case 'longestDurationMin':
      return formatClock(value * 60);
    case 'longestDistanceKm':
      return formatDistanceKm(value, system);
    case 'bestPaceSecPerKm':
      return formatPace(value, system);
  }
}

export type RecordRow = {
  key: string;
  exerciseId: string;
  exerciseName: string;
  title: string;
  value: string;
  /** The beaten value, formatted; null when the API sent none. */
  was: string | null;
  date: string;
  estimated: boolean;
};

/** "Estimated 1RM: 308.6 lb, was 297.6 lb · 3 Sep", newest first as the API sends them. */
export function recordRows(prs: ReadonlyArray<ProgressPr> | null | undefined, system: UnitSystem, now: Date = new Date()): RecordRow[] {
  return (prs ?? [])
    .filter((pr) => pr && isRecordType(pr.type) && Number.isFinite(pr.value))
    .map((pr, index) => ({
      key: `${pr.workoutId}:${pr.exerciseId}:${pr.type}:${pr.setId ?? index}`,
      exerciseId: pr.exerciseId,
      exerciseName: pr.exerciseName || pr.exerciseId,
      title: RECORD_TYPE_TITLES[pr.type],
      value: formatRecordValue(pr.type, pr.value, system),
      was: typeof pr.previousValue === 'number' && Number.isFinite(pr.previousValue) ? formatRecordValue(pr.type, pr.previousValue, system) : null,
      date: shortDate(pr.date, now),
      estimated: pr.estimated === true,
    }));
}

/* ------------------------------------------------------------------ records shelf */

/**
 * The shelf's reading order: the heaviest set first (what a lifter looks for),
 * then the estimate it implies, then the best single-set volume, then the
 * aggregate records a timed or distance movement carries, then reps.
 */
export const SHELF_ORDER: readonly RecordType[] = [
  'heaviestWeightKg',
  'estimatedOneRepMaxKg',
  'bestSetVolumeKg',
  'longestDurationMin',
  'longestDistanceKm',
  'bestPaceSecPerKm',
  'mostReps',
];

/**
 * How many facts one row shows. Three keeps the line readable at 390 px and
 * is what the row is for — the best set, the estimate it implies and the best
 * volume; SHELF_ORDER puts those first, so "Most reps" survives only for a
 * movement that has nothing else (a bodyweight lift).
 */
export const SHELF_FACTS_MAX = 3;

/** Short labels for a dense row; the long titles stay on the trend sheet. */
export const SHELF_LABELS: Record<RecordType, string> = {
  heaviestWeightKg: 'Best set',
  estimatedOneRepMaxKg: '1RM',
  bestSetVolumeKg: 'Best volume',
  mostReps: 'Most reps',
  longestDurationMin: 'Longest hold',
  longestDistanceKm: 'Longest distance',
  bestPaceSecPerKm: 'Best pace',
};

export type ShelfFact = {
  type: RecordType;
  label: string;
  value: string;
  /** Epley: shown with "est." so an estimate is never read as a lift that happened. */
  estimated: boolean;
  date: string;
  workoutId: string;
  /** The achieving set, or null for an aggregate (duration / distance / pace) record. */
  setId: string | null;
};

export type ShelfRow = {
  exerciseId: string;
  name: string;
  facts: ShelfFact[];
  /** "3 Sep": when the newest of this row's records was set. */
  when: string;
};

/**
 * One row per movement: its best set, the estimated 1RM, the best volume and
 * when, from `GET /workouts/records` keyed by the exercises the summary named.
 * An exercise the member has never recorded produces no row at all — the zero
 * rule: a missing record is omitted, never drawn as a dash.
 */
export function shelfRows(
  exercises: ReadonlyArray<{ exerciseId: string; name?: string }> | null | undefined,
  records: ProgressRecords | null | undefined,
  system: UnitSystem,
  now: Date = new Date(),
): ShelfRow[] {
  const rows: ShelfRow[] = [];
  for (const exercise of exercises ?? []) {
    const id = exercise?.exerciseId;
    if (typeof id !== 'string' || !id) continue;
    const entry = records?.[id];
    if (!entry) continue;
    const facts: ShelfFact[] = [];
    for (const type of SHELF_ORDER) {
      const record = entry[type];
      if (!record || !Number.isFinite(record.value)) continue;
      // The heaviest set reads as the set it was ("105 kg × 5"), which is what
      // the number means; every other type is its own formatted value.
      const value =
        type === 'heaviestWeightKg' && Number.isFinite(record.reps)
          ? formatBestSet({ reps: record.reps as number, weightKg: record.weightKg ?? record.value }, weightUnit(system))
          : formatRecordValue(type, record.value, system);
      if (!value) continue;
      facts.push({
        type,
        label: SHELF_LABELS[type],
        value,
        estimated: record.estimated === true,
        date: record.date,
        workoutId: record.workoutId,
        setId: record.setId ?? null,
      });
    }
    if (!facts.length) continue;
    facts.length = Math.min(facts.length, SHELF_FACTS_MAX);
    const newest = facts.reduce((best, fact) => (Date.parse(fact.date) > Date.parse(best) ? fact.date : best), facts[0].date);
    rows.push({ exerciseId: id, name: exercise.name || id, facts, when: shortDate(newest, now) });
  }
  return rows;
}

/**
 * "Removed 105 kg × 5, 3 Sep" / "Records before 1 Jan do not count" — one
 * line per active adjustment, in the words of what it did. `from` and the
 * record's own label come from the API; nothing is inferred.
 */
export function adjustmentLine(kind: 'exclude' | 'reset', detail: string | null, when: string | null): string {
  if (kind === 'reset') return when ? `Records before ${when} do not count` : 'Records before a chosen day do not count';
  return detail ? `Removed ${detail}` : 'One record removed';
}

/* ------------------------------------------------------------------ movements */

export type MovementRow = { exerciseId: string; name: string; sessions: number; sessionsLabel: string; sets: number; measure: ProgressMeasure; best: string | null };

/** The top ten as the API ranks them; `best` reads "Estimated 1RM 308.6 lb" / "Longest hold 2:00" / "Best pace 5:24 /km". */
export function movementRows(exercises: ReadonlyArray<ProgressExercise> | null | undefined, system: UnitSystem): MovementRow[] {
  return (exercises ?? [])
    .filter((row) => row && typeof row.exerciseId === 'string' && row.exerciseId)
    .map((row) => ({
      exerciseId: row.exerciseId,
      name: row.name || row.exerciseId,
      sessions: row.sessions,
      sessionsLabel: countLabel(row.sessions, 'session'),
      sets: row.sets,
      measure: row.measure,
      best: row.best && isRecordType(row.best.type) ? `${RECORD_TYPE_TITLES[row.best.type]} ${formatRecordValue(row.best.type, row.best.value, system)}` : null,
    }));
}

/* ------------------------------------------------------------------ trends */

const EPLEY_MAX_REPS = 12;

const toKg = (weight: number, unit: WeightUnit | undefined): number => (Number(weight) || 0) * (unit === 'lb' ? KG_PER_LB : 1);

/** Epley: weight × (1 + reps / 30), for 1–12 reps; the API uses the same bound. */
const epleyKg = (weightKg: number, reps: number): number | null => {
  if (!(weightKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > EPLEY_MAX_REPS) return null;
  return weightKg * (1 + reps / 30);
};

export type TrendPoint = { date: string; label: string; value: number; workoutId: string };

export type TrendSeries = {
  points: TrendPoint[];
  /** kg / lb for reps, s for duration, s/km or s/mi for distance. */
  unit: string;
  /** The axis label: "Estimated 1RM", "Time", "Pace". */
  what: string;
  lowerIsBetter: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One point per session, oldest first, in the viewer's units. Reps: the best
 * Epley estimate over completed, non-synthetic sets of 1–12 reps with a load.
 * Duration: seconds. Distance: pace (seconds per km or mile), lower is better.
 * Sessions without a qualifying number produce no point.
 */
export function trendSeries(measure: ProgressMeasure, history: ReadonlyArray<ProgressHistoryRow> | null | undefined, system: UnitSystem, now: Date = new Date()): TrendSeries {
  const rows = [...(history ?? [])].filter((row) => row && typeof row.date === 'string').sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const point = (row: ProgressHistoryRow, value: number): TrendPoint => ({ date: row.date, label: shortDate(row.date, now), value, workoutId: row.workoutId });
  if (measure === 'duration') {
    const points = rows.filter((row) => (row.durationMin ?? 0) > 0).map((row) => point(row, Math.round((row.durationMin as number) * 60)));
    return { points, unit: 's', what: 'Time', lowerIsBetter: false };
  }
  if (measure === 'distance') {
    const points: TrendPoint[] = [];
    for (const row of rows) {
      const km = row.distanceKm ?? 0;
      const min = row.durationMin ?? 0;
      if (!(km > 0) || !(min > 0)) continue;
      const secPerKm = (min * 60) / km;
      points.push(point(row, Math.round(system === 'imperial' ? secPerKm * KM_PER_MI : secPerKm)));
    }
    return { points, unit: system === 'imperial' ? 's/mi' : 's/km', what: 'Pace', lowerIsBetter: true };
  }
  const points: TrendPoint[] = [];
  for (const row of rows) {
    let best = 0;
    for (const set of row.sets ?? []) {
      if (!set || set.synthetic === true || set.completed !== true) continue;
      const estimate = epleyKg(toKg(set.weight, set.weightUnit), Math.round(Number(set.reps) || 0));
      if (estimate !== null && estimate > best) best = estimate;
    }
    if (best > 0) points.push(point(row, round1(system === 'imperial' ? kgToLb(best) : best)));
  }
  return { points, unit: weightUnit(system), what: 'Estimated 1RM', lowerIsBetter: false };
}

/** A spoken summary for the chart's role="img": "Estimated 1RM over 6 sessions, from 1 Jul to 3 Sep". */
export function trendDescription(series: TrendSeries): string {
  const n = series.points.length;
  if (n === 0) return `${series.what}: no sessions yet`;
  const first = series.points[0].label;
  const last = series.points[n - 1].label;
  return n === 1 ? `${series.what} over 1 session, ${first}` : `${series.what} over ${countLabel(n, 'session')}, from ${first} to ${last}`;
}

/** The chart's own value formatter in the series' unit. */
export function formatTrendValue(series: Pick<TrendSeries, 'unit'>, value: number): string {
  if (series.unit === 's') return formatClock(value);
  if (series.unit === 's/km') return `${formatClock(value)} /km`;
  if (series.unit === 's/mi') return `${formatClock(value)} /mi`;
  return `${oneDecimal(value)} ${series.unit}`;
}

/* ------------------------------------------------------------------ sessions list */

export type SessionLine = { text: string; approximate: boolean };

/** "100 kg × 12, 12, 12 · 90 kg × 10" over completed (or synthetic) sets, grouped by load in the unit logged. */
export function formatRepsSets(sets: ReadonlyArray<HistorySet> | null | undefined): SessionLine {
  const shown = (sets ?? []).filter((set) => set && (set.completed === true || set.synthetic === true));
  const approximate = shown.some((set) => set.synthetic === true);
  const groups: Array<{ key: string; load: string | null; reps: number[] }> = [];
  for (const set of shown) {
    const weight = Number(set.weight) || 0;
    const load = weight > 0 ? formatLoggedWeight(weight, set.weightUnit === 'lb' ? 'lb' : 'kg') : null;
    const key = load ?? 'bodyweight';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.reps.push(Math.round(Number(set.reps) || 0));
    else groups.push({ key, load, reps: [Math.round(Number(set.reps) || 0)] });
  }
  const text = groups.map((g) => (g.load ? `${g.load} × ${g.reps.join(', ')}` : `${g.reps.join(', ')} reps`)).join(' · ');
  return { text, approximate };
}

/** One line per history session: reps grouped by load, a timed hold as a clock, a distance with its time and pace. */
export function sessionLine(row: ProgressHistoryRow, system: UnitSystem): SessionLine {
  const km = row.distanceKm ?? 0;
  const min = row.durationMin ?? 0;
  if (km > 0) {
    const parts = [formatDistanceKm(km, system)];
    if (min > 0) parts.push(formatClock(min * 60), formatPace((min * 60) / km, system));
    return { text: parts.join(' · '), approximate: false };
  }
  const reps = formatRepsSets(row.sets);
  if (reps.text) return reps;
  if (min > 0) return { text: formatClock(min * 60), approximate: false };
  return { text: 'No completed sets', approximate: false };
}

/* ------------------------------------------------------------------ suggestion */

const RULE_SHORT: Record<ProgressSuggested['kind'], string> = {
  add: 'top of your range twice',
  hold: 'one more rep than last time',
  deload: 'below your range twice',
};

/** "Try 102.5 kg × 8 · top of your range twice" in S1's own unit, printed as-is. */
export function suggestionLine(s: ProgressSuggested): string {
  const load = formatLoggedWeight(s.weight, s.weightUnit);
  const lead = s.kind === 'add' ? `Try ${load} × ${s.reps}` : s.kind === 'deload' ? `Lighter this time: ${load} × ${s.reps}` : `Same weight, aim for ${s.reps}`;
  return `${lead} · ${RULE_SHORT[s.kind]}`;
}

/** The rule in one sentence, with the step and unit from the response. */
export function suggestionRule(s: ProgressSuggested): string {
  if (s.kind === 'add') return `When every working set reaches the top of your rep range two sessions in a row, the suggestion adds ${formatLoggedWeight(s.step, s.weightUnit)}.`;
  if (s.kind === 'deload') return 'When a working set falls below the bottom of your range two sessions in a row, the suggestion takes ten percent off.';
  return 'Otherwise the suggestion keeps the weight and adds one rep.';
}

/** "3 Sep · 100 kg × 12, 12, 12" over the sets the rule counted. */
export function basisLine(entry: ProgressBasis, now: Date = new Date()): string {
  const counted = entry.sets.filter((set) => set.working);
  const sets = formatRepsSets((counted.length ? counted : entry.sets).map((set) => ({ ...set, completed: true })));
  return `${shortDate(entry.date, now)} · ${sets.text || 'no working sets'}`;
}

export const rangeNote = (range: { min: number; max: number }): string => `Your range: ${range.min}–${range.max} reps. Change it in Settings.`;

/* ------------------------------------------------------------------ flags and preferences */

/** The 404 every Wave F route answers while its flag is off for the caller; the client hides, never errors. */
export function isFeatureDisabled(e: unknown): boolean {
  const details = apiErrorDetails(e);
  return details.status === 404 && details.code === 'FEATURE_DISABLED';
}

export const DEFAULT_REP_RANGE = Object.freeze({ min: 8, max: 12 });
export const REP_RANGE_BOUNDS = Object.freeze({ min: 1, max: 50 });

export type WorkoutPreferences = { progressionHints: boolean; defaultRepRange: { min: number; max: number } };

type WorkoutSettingsLike = { progressionHints?: unknown; defaultRepRange?: { min?: unknown; max?: unknown } | null };

const isWholeInBounds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= REP_RANGE_BOUNDS.min && value <= REP_RANGE_BOUNDS.max;

/** A valid stored range or null (the same rule the API applies: whole numbers 1–50, min < max). */
export function validRepRange(range: { min?: unknown; max?: unknown } | null | undefined): { min: number; max: number } | null {
  if (!range) return null;
  return isWholeInBounds(range.min) && isWholeInBounds(range.max) && range.min < range.max ? { min: range.min, max: range.max } : null;
}

/** `settings.workout` with the schema defaults for anything missing or malformed. */
export function workoutPreferencesOf(user: { settings?: { workout?: WorkoutSettingsLike | null } | null } | null | undefined): WorkoutPreferences {
  const workout = user?.settings?.workout ?? null;
  return {
    progressionHints: workout?.progressionHints !== false,
    defaultRepRange: validRepRange(workout?.defaultRepRange) ?? { ...DEFAULT_REP_RANGE },
  };
}
