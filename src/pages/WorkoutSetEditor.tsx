import { Button, Input, Select } from './ui';
import {
  LIMITS, emptyLogExercise, emptySet, draftVolume,
  type LogExerciseDraft, type SetDraft, type LogExercise,
} from './workout-set-records';

export function WorkoutSetEditor({ value, onChange, error, previous, disabled = false, allowSetEntry = false }: {
  value: LogExerciseDraft[];
  onChange: (next: LogExerciseDraft[]) => void;
  error?: string;
  previous?: LogExercise[];
  disabled?: boolean;
  allowSetEntry?: boolean;
}) {
  const update = (index: number, patch: Partial<LogExerciseDraft>) =>
    onChange(value.map((exercise, i) => i === index ? { ...exercise, ...patch } : exercise));
  const volume = draftVolume(value);
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="type-label mb-2 text-text-2">Exercises and sets</legend>
      <p className="text-sm text-text-2">Only completed sets count toward volume. Enter external load only; 0 means no recorded external load.</p>
      {value.map((exercise, index) => {
        const setAware = exercise.setRecords !== undefined;
        const updateSet = (setId: string, patch: Partial<SetDraft>) =>
          update(index, { setRecords: exercise.setRecords!.map(set => set.id === setId ? { ...set, ...patch } : set) });
        const prior = previous?.find(item => item.exerciseId === exercise.exerciseId);
        return (
          <fieldset key={exercise.exerciseId} className="space-y-3 rounded-md border border-border-1 p-3 sm:p-4">
            <legend className="px-1 text-sm font-semibold text-text-1">Exercise {index + 1}</legend>
            <Input label={`Exercise ${index + 1} name`} value={exercise.name} maxLength={200}
              onChange={event => update(index, { name: event.target.value })} />
            {setAware ? (
              <>
                {exercise.setRecords!.map((set, setIndex) => {
                  const previousSet = prior?.setRecords?.find(item => item.id === set.id);
                  const prefix = `Exercise ${index + 1} set ${setIndex + 1}`;
                  return (
                    <fieldset key={set.id} className="space-y-3 rounded-sm bg-surface-2 p-3">
                      <legend className="text-sm font-medium text-text-1">Set {setIndex + 1}</legend>
                      {previousSet ? <p className="text-xs text-text-2">
                        Previously: {previousSet.reps} reps × {previousSet.weight} {previousSet.weightUnit} · {previousSet.completed ? 'completed' : 'not completed'}
                      </p> : null}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Input label={`${prefix} reps`} type="number" inputMode="numeric" min={0} max={LIMITS.reps} step={1}
                          value={set.reps} onChange={event => updateSet(set.id, { reps: event.target.value })} />
                        <Input label={`${prefix} weight`} type="number" inputMode="decimal" min={0} max={LIMITS.weight} step="any"
                          value={set.weight} onChange={event => updateSet(set.id, { weight: event.target.value })} />
                        <Select label={`${prefix} unit`} value={set.weightUnit}
                          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
                          onChange={unit => updateSet(set.id, { weightUnit: unit as 'kg' | 'lb' })} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text-1">
                          <input type="checkbox" aria-label={`${prefix} completed`} checked={set.completed}
                            className="h-5 w-5 accent-current" onChange={event => updateSet(set.id, { completed: event.target.checked })} />
                          Completed
                        </label>
                        <Button type="button" variant="ghost" aria-label={`Remove exercise ${index + 1} set ${setIndex + 1}`}
                          onClick={() => update(index, { setRecords: exercise.setRecords!.filter(item => item.id !== set.id) })}>Remove set</Button>
                      </div>
                    </fieldset>
                  );
                })}
                {exercise.setRecords!.length === 0 ? <p className="text-sm text-text-2">No individual sets recorded. Volume is 0.</p> : null}
                <Button type="button" variant="secondary" disabled={exercise.setRecords!.length >= LIMITS.sets}
                  aria-label={`Add set to exercise ${index + 1}`}
                  onClick={() => update(index, { setRecords: [...exercise.setRecords!, emptySet()] })}>Add set</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-text-2">Aggregate record. Individual set history was not recorded; these totals stay as entered.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input label={`Exercise ${index + 1} total sets`} type="number" min={0} max={10000} step="any"
                    value={exercise.sets} onChange={event => update(index, { sets: event.target.value })} />
                  <Input label={`Exercise ${index + 1} reps per set`} type="number" min={0} max={LIMITS.reps} step="any"
                    value={exercise.reps} onChange={event => update(index, { reps: event.target.value })} />
                  <Input label={`Exercise ${index + 1} weight`} type="number" min={0} max={LIMITS.weight} step="any"
                    value={exercise.weight} onChange={event => update(index, { weight: event.target.value })} />
                  <Select label={`Exercise ${index + 1} weight unit`} value={exercise.weightUnit}
                    options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
                    onChange={unit => update(index, { weightUnit: unit as 'kg' | 'lb' })} />
                </div>
                {allowSetEntry ? (
                  <div className="space-y-2">
                    <p className="text-xs text-text-2">To record what you do set by set, start blank. Aggregate totals will not be converted into completed sets.</p>
                    <Button type="button" variant="secondary" aria-label={`Record individual sets for exercise ${index + 1}`}
                      onClick={() => update(index, { setRecords: [emptySet()] })}>Record individual sets</Button>
                  </div>
                ) : null}
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label={`Exercise ${index + 1} duration (min)`} type="number" min={0} max={1440} step="any"
                value={exercise.duration} onChange={event => update(index, { duration: event.target.value })} />
              <Input label={`Exercise ${index + 1} distance (km)`} type="number" min={0} max={100000} step="any"
                value={exercise.distance} onChange={event => update(index, { distance: event.target.value })} />
            </div>
            <Input label={`Exercise ${index + 1} notes`} value={exercise.notes} maxLength={5000}
              onChange={event => update(index, { notes: event.target.value })} />
            <Button type="button" variant="ghost" aria-label={`Remove exercise ${index + 1}`} disabled={value.length === 1}
              onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove exercise</Button>
          </fieldset>
        );
      })}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" disabled={value.length >= LIMITS.exercises}
          onClick={() => onChange([...value, emptyLogExercise()])}>Add exercise</Button>
        <p role="status" className="text-sm tabular-nums text-text-2">
          {volume === null ? 'Complete the fields to calculate volume.' : `Session volume: ${volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`}
        </p>
      </div>
    </fieldset>
  );
}
