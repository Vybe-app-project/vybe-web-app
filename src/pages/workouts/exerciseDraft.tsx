import { useId } from 'react';
import { Button, Checkbox, IconButton, Input, Select, cx } from '../../components/ui';
import { Plus, Trash } from '../../components/icons';
import type { WorkoutExercise } from './model';

/**
 * The exercise rows shared by the workout editor and the session form.
 * Aggregate rows (sets × reps × weight, seconds) are the shape the social
 * catalogue and every older log use; a session logged by the set-aware
 * runner carries `setRecords`, and those rows edit each set on its own so a
 * PATCH never replaces individual sets with an aggregate (the API answers
 * 409 to that). Durations are entered in seconds, the unit the API, the seed
 * data and the mobile app all use.
 */

export type SetDraft = {
  id: string;
  completed: boolean;
  reps: string;
  weight: string;
  weightUnit: 'kg' | 'lb';
};

export type ExerciseDraft = {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  /** Seconds, as typed. */
  duration: string;
  notes: string;
  /** Stable id the records API keys on; kept when editing, never invented for aggregate rows. */
  exerciseId?: string;
  /** Present only for a set-aware exercise. */
  setRecords?: SetDraft[];
};

export type SetRecord = { id: string; completed: boolean; reps: number; weight: number; weightUnit: 'kg' | 'lb' };

/** A logged exercise: the aggregate fields plus, for set-aware logs, its individual sets. */
export type LogExercise = WorkoutExercise & {
  exerciseId?: string;
  weightUnit?: 'kg' | 'lb';
  setRecords?: SetRecord[];
};

export const emptyExercise = (): ExerciseDraft => ({
  name: '',
  sets: '',
  reps: '',
  weight: '',
  duration: '',
  notes: '',
});

const str = (v: number | undefined | null) => (v != null ? String(v) : '');

export const exerciseDraftFrom = (e: Partial<LogExercise>): ExerciseDraft => ({
  name: e.name ?? '',
  sets: str(e.sets),
  reps: str(e.reps),
  weight: str(e.weight),
  duration: str(e.duration),
  notes: e.notes ?? '',
  ...(e.exerciseId ? { exerciseId: e.exerciseId } : {}),
  ...(Array.isArray(e.setRecords)
    ? {
        setRecords: e.setRecords.map((s) => ({
          id: s.id,
          completed: s.completed !== false,
          reps: str(s.reps),
          weight: str(s.weight),
          weightUnit: s.weightUnit === 'lb' ? 'lb' : 'kg',
        })),
      }
    : {}),
});

const num = (v: string): number | undefined => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
};

const newSetId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export const emptySet = (unit: 'kg' | 'lb' = 'kg'): SetDraft => ({ id: newSetId(), completed: true, reps: '', weight: '', weightUnit: unit });

/** Only the keys the API accepts; `undefined` values drop out of the JSON body. */
export function toExercisePayload(d: ExerciseDraft): LogExercise {
  const base = {
    name: d.name.trim(),
    notes: d.notes.trim() || undefined,
    ...(d.exerciseId ? { exerciseId: d.exerciseId } : {}),
  };
  if (d.setRecords) {
    return {
      ...base,
      setRecords: d.setRecords.map((s) => ({
        id: s.id,
        completed: s.completed,
        reps: Math.round(num(s.reps) ?? 0),
        weight: num(s.weight) ?? 0,
        weightUnit: s.weightUnit,
      })),
    };
  }
  return {
    ...base,
    sets: num(d.sets),
    reps: num(d.reps),
    weight: num(d.weight),
    duration: num(d.duration),
  };
}

const UNIT_OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

function SetRows({ value, onChange, exerciseIndex }: { value: SetDraft[]; onChange: (next: SetDraft[]) => void; exerciseIndex: number }) {
  const update = (i: number, patch: Partial<SetDraft>) => onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const unit = value[value.length - 1]?.weightUnit ?? 'kg';
  return (
    <div className="space-y-2">
      <p className="type-label text-text-2">Sets</p>
      {value.length === 0 ? <p className="text-xs text-text-3">No sets. Add one, or remove the exercise.</p> : null}
      <ol className="space-y-2">
        {value.map((s, i) => (
          <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,5rem)_auto] items-end gap-2">
            <span className="type-stat mb-3 w-5 text-sm text-text-3" aria-hidden="true">
              {i + 1}
            </span>
            <Input
              label={`Set ${i + 1} reps`}
              hideLabel
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Reps"
              value={s.reps}
              onChange={(e) => update(i, { reps: e.target.value })}
            />
            <Input
              label={`Set ${i + 1} weight`}
              hideLabel
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              placeholder="Weight"
              value={s.weight}
              onChange={(e) => update(i, { weight: e.target.value })}
            />
            <Select label={`Set ${i + 1} unit`} hideLabel options={UNIT_OPTIONS} value={s.weightUnit} onChange={(v) => update(i, { weightUnit: v === 'lb' ? 'lb' : 'kg' })} />
            <div className="flex items-center gap-1 pb-0.5">
              <Checkbox checked={s.completed} onChange={(v) => update(i, { completed: v })} label={<span className="sr-only">Set {i + 1} completed</span>} />
              <IconButton label={`Remove set ${i + 1} from exercise ${exerciseIndex + 1}`} variant="ghost" size={40} onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
                <Trash size={18} />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="quiet" size="sm" icon={<Plus size={16} />} onClick={() => onChange([...value, emptySet(unit)])}>
        Add set
      </Button>
    </div>
  );
}

/**
 * Repeating exercise rows. Every field is labelled; the remove control is a
 * 44 px icon button. Duration is entered in seconds.
 */
export function ExerciseRows({
  value,
  onChange,
  showNotes = true,
  error,
}: {
  value: ExerciseDraft[];
  onChange: (next: ExerciseDraft[]) => void;
  showNotes?: boolean;
  error?: string;
}) {
  const update = (i: number, patch: Partial<ExerciseDraft>) => onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const headingId = useId();

  return (
    <fieldset className="space-y-3" aria-describedby={error ? `${headingId}-error` : undefined}>
      <legend id={headingId} className="type-label mb-2 text-text-2">
        Exercises
      </legend>
      {value.map((row, i) => (
        <div key={row.exerciseId ?? i} className={cx('@container space-y-3 rounded-md bg-surface-2 p-3', row.setRecords && 'ring-1 ring-line')}>
          <div className="flex items-end gap-2">
            <Input label={`Exercise ${i + 1}`} placeholder="e.g. Back squat" autoComplete="off" value={row.name} onChange={(e) => update(i, { name: e.target.value })} />
            {value.length > 1 ? (
              <IconButton label={`Remove exercise ${i + 1}`} variant="ghost" className="mb-0.5 text-text-2 hover:text-danger" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
                <Trash size={20} />
              </IconButton>
            ) : null}
          </div>
          {row.setRecords ? (
            <SetRows value={row.setRecords} exerciseIndex={i} onChange={(setRecords) => update(i, { setRecords })} />
          ) : (
            <div className="grid grid-cols-2 gap-2 @sm:grid-cols-4">
              <Input label="Sets" type="number" inputMode="numeric" min={0} placeholder="0" value={row.sets} onChange={(e) => update(i, { sets: e.target.value })} />
              <Input label="Reps" type="number" inputMode="numeric" min={0} placeholder="0" value={row.reps} onChange={(e) => update(i, { reps: e.target.value })} />
              <Input label="Weight (kg)" type="number" inputMode="decimal" min={0} step="0.5" placeholder="0" value={row.weight} onChange={(e) => update(i, { weight: e.target.value })} />
              <Input
                label="Seconds"
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                placeholder="0"
                title="Timed work, in seconds (180 = 3 minutes)"
                value={row.duration}
                onChange={(e) => update(i, { duration: e.target.value })}
              />
            </div>
          )}
          {showNotes ? <Input label="Notes" hint="Optional. Tempo, cues, how it felt." value={row.notes} onChange={(e) => update(i, { notes: e.target.value })} /> : null}
        </div>
      ))}
      {error ? (
        <p id={`${headingId}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="secondary" icon={<Plus size={18} />} onClick={() => onChange([...value, emptyExercise()])}>
        Add exercise
      </Button>
    </fieldset>
  );
}
