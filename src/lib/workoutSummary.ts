import { kgToLb } from './unitConversions';

/**
 * The workout share card the API snapshots onto a post (backend
 * models/Post.js WorkoutSummarySchema, built by services/workoutRecords.js).
 * Every number is stored in kilograms; `unit` is the unit the member trained
 * in and only says how to print them (absent on cards stored before it
 * existed, which read as kg). Fields the author hid (`hiddenFields`) are
 * removed by the server before storage, so a renderer shows what is present
 * and never re-derives a hidden number.
 */
export type WorkoutSummaryUnit = 'kg' | 'lb';

export type WorkoutSummaryBestSet = { reps: number; weightKg?: number };

export type WorkoutSummaryExercise = {
  exerciseId?: string;
  name: string;
  setCount: number;
  bestSet?: WorkoutSummaryBestSet | null;
};

export type WorkoutSummary = {
  workoutId: string;
  name?: string;
  date?: string;
  durationMin?: number;
  setCount?: number;
  exerciseCount?: number;
  volumeKg?: number;
  unit?: WorkoutSummaryUnit;
  prCount?: number;
  exercises?: WorkoutSummaryExercise[];
  muscleGroups?: string[];
  hiddenFields?: Array<'weights' | 'volume' | 'duration'>;
};

/** The unit the card prints in; kg when the API did not say. */
export function summaryUnit(summary: Pick<WorkoutSummary, 'unit'>): WorkoutSummaryUnit {
  return summary.unit === 'lb' ? 'lb' : 'kg';
}

const whole = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const oneDecimal = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** A load in the card's unit, e.g. 102.06 kg on an lb card -> "225 lb". */
export function formatSummaryWeight(kg: number, unit: WorkoutSummaryUnit): string {
  if (!Number.isFinite(kg) || kg < 0) return '';
  return unit === 'lb' ? `${oneDecimal(kgToLb(kg))} lb` : `${oneDecimal(kg)} kg`;
}

/** Total volume in the card's unit, rounded to whole units (it is a sum). */
export function formatSummaryVolume(kg: number, unit: WorkoutSummaryUnit): string {
  if (!Number.isFinite(kg) || kg < 0) return '';
  return unit === 'lb' ? `${whole(kgToLb(kg))} lb` : `${whole(kg)} kg`;
}

/** "225 lb × 8" for a loaded set (weight first, the Hevy/Strong convention mobile uses), "12 reps" when the set carried no load or the author hid weights. */
export function formatBestSet(best: WorkoutSummaryBestSet | null | undefined, unit: WorkoutSummaryUnit): string {
  if (!best || !Number.isFinite(best.reps)) return '';
  const reps = Math.max(0, Math.round(best.reps));
  if (typeof best.weightKg === 'number' && best.weightKg > 0) return `${formatSummaryWeight(best.weightKg, unit)} × ${reps}`;
  return `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export type SummaryStat = { key: 'exercises' | 'sets' | 'volume' | 'prs' | 'duration'; label: string; value: string };

/**
 * The headline numbers in display order. Absent fields (hidden by the author,
 * or empty) produce no stat rather than a zero, so a card never claims a
 * number the author removed.
 */
export function summaryStats(summary: WorkoutSummary): SummaryStat[] {
  const unit = summaryUnit(summary);
  const stats: SummaryStat[] = [];
  const exercises = summary.exerciseCount ?? summary.exercises?.length;
  if (typeof exercises === 'number' && exercises > 0) stats.push({ key: 'exercises', label: exercises === 1 ? 'exercise' : 'exercises', value: whole(exercises) });
  if (typeof summary.setCount === 'number' && summary.setCount > 0) stats.push({ key: 'sets', label: summary.setCount === 1 ? 'set' : 'sets', value: whole(summary.setCount) });
  if (typeof summary.volumeKg === 'number' && summary.volumeKg > 0) stats.push({ key: 'volume', label: 'volume', value: formatSummaryVolume(summary.volumeKg, unit) });
  if (typeof summary.durationMin === 'number' && summary.durationMin > 0) stats.push({ key: 'duration', label: 'time', value: formatDuration(summary.durationMin) });
  if (typeof summary.prCount === 'number' && summary.prCount > 0) stats.push({ key: 'prs', label: summary.prCount === 1 ? 'PR' : 'PRs', value: whole(summary.prCount) });
  return stats;
}

/** Whether a post payload carries a renderable card. */
export function hasWorkoutSummary(value: unknown): value is WorkoutSummary {
  return !!value && typeof value === 'object' && typeof (value as WorkoutSummary).workoutId === 'string';
}
