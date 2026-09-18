export type WeightUnit = 'kg' | 'lb';
export type SetRecord = { id: string; completed: boolean; reps: number; weight: number; weightUnit: WeightUnit };
export type LogExercise = {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weightUnit?: WeightUnit;
  duration?: number;
  distance?: number;
  notes?: string;
  exerciseId?: string;
  setRecords?: SetRecord[];
};
export type SetDraft = Omit<SetRecord, 'reps' | 'weight'> & { reps: string; weight: string };
export type LogExerciseDraft = {
  name: string; sets: string; reps: string; weight: string; weightUnit: WeightUnit;
  duration: string; distance: string; notes: string; exerciseId: string; setRecords?: SetDraft[];
};
export const LIMITS = { exercises: 100, sets: 100, reps: 10000, weight: 100000 } as const;
export const LB_TO_KG = 0.45359237;
const id = () => crypto.randomUUID();
const text = (value?: number) => value == null ? '' : String(value);
export const emptySet = (): SetDraft => ({ id: id(), reps: '0', weight: '0', weightUnit: 'kg', completed: false });
export const emptyLogExercise = (): LogExerciseDraft => ({
  exerciseId: id(), name: '', sets: '', reps: '', weight: '', weightUnit: 'kg',
  duration: '', distance: '', notes: '', setRecords: [emptySet()],
});
export const logExerciseDraftFrom = (exercise: LogExercise): LogExerciseDraft => ({
  name: exercise.name, sets: text(exercise.sets), reps: text(exercise.reps),
  weight: text(exercise.weight), weightUnit: exercise.weightUnit ?? 'kg',
  duration: text(exercise.duration), distance: text(exercise.distance), notes: exercise.notes ?? '',
  exerciseId: exercise.exerciseId ?? id(),
  ...(exercise.setRecords === undefined ? {} : { setRecords: exercise.setRecords.map(set => ({
    ...set, reps: String(set.reps), weight: String(set.weight),
  })) }),
});

export const exerciseVolumeKg = (exercise: LogExercise): number => exercise.setRecords !== undefined
  ? exercise.setRecords.reduce((sum, set) => sum + (set.completed ? set.reps * set.weight * (set.weightUnit === 'lb' ? LB_TO_KG : 1) : 0), 0)
  : (exercise.sets ?? 0) * (exercise.reps ?? 0) * (exercise.weight ?? 0) * (exercise.weightUnit === 'lb' ? LB_TO_KG : 1);
export const sessionVolume = (log: { exercises: LogExercise[] }): number =>
  (log.exercises ?? []).reduce((sum, exercise) => sum + exerciseVolumeKg(exercise), 0);

const value = (input: string, label: string, max: number, integer = false): number => {
  const number = Number(input);
  if (!input.trim() || !Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`${label}: enter ${integer ? 'a whole number' : 'a number'} from 0 to ${max}.`);
  }
  return number;
};
export function toLogExercisePayload(draft: LogExerciseDraft): LogExercise {
  if (!draft.name.trim() || draft.name.length > 200) throw new Error('Each exercise needs a name, up to 200 characters.');
  if (draft.notes.length > 5000) throw new Error('Exercise notes must be 5000 characters or fewer.');
  const base: LogExercise = {
    name: draft.name.trim(), exerciseId: draft.exerciseId, notes: draft.notes,
    ...(draft.duration.trim() ? { duration: value(draft.duration, 'Exercise duration', 1440) } : {}),
    ...(draft.distance.trim() ? { distance: value(draft.distance, 'Distance', 100000) } : {}),
  };
  if (draft.setRecords !== undefined) {
    if (draft.setRecords.length > LIMITS.sets) throw new Error(`Use at most ${LIMITS.sets} sets per exercise.`);
    return { ...base, setRecords: draft.setRecords.map(set => {
      if (!['kg', 'lb'].includes(set.weightUnit)) throw new Error('Choose kg or lb.');
      return { id: set.id, completed: set.completed, weightUnit: set.weightUnit,
        reps: value(set.reps, 'Set reps', LIMITS.reps, true),
        weight: value(set.weight, 'Set weight', LIMITS.weight) };
    }) };
  }
  return {
    ...base, weightUnit: draft.weightUnit,
    ...(draft.sets.trim() ? { sets: value(draft.sets, 'Sets', 10000) } : {}),
    ...(draft.reps.trim() ? { reps: value(draft.reps, 'Reps', LIMITS.reps) } : {}),
    ...(draft.weight.trim() ? { weight: value(draft.weight, 'Weight', LIMITS.weight) } : {}),
  };
}

/** Repeating a session is a new plan, not evidence its previous sets were done. */
export function repeatedExercises(exercises: LogExercise[]): LogExercise[] {
  return exercises.map(exercise => ({
    ...exercise,
    exerciseId: id(),
    ...(exercise.setRecords === undefined ? {} : {
      setRecords: exercise.setRecords.map(set => ({ ...set, id: id(), completed: false })),
    }),
  }));
}

export function draftVolume(drafts: LogExerciseDraft[]): number | null {
  try { return sessionVolume({ exercises: drafts.map(toLogExercisePayload) }); }
  catch { return null; }
}
