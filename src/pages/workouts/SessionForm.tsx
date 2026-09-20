import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isValid } from 'date-fns';
import { api, errMsg } from '../../lib/api';
import { Button, Callout, DateField, Input, Select, Textarea, useToast } from '../../components/ui';
import { ExerciseRows, emptyExercise, exerciseDraftFrom, toExercisePayload, type ExerciseDraft, type LogExercise } from './exerciseDraft';
import { CATEGORY_OPTIONS } from './model';
import { LOGS_KEY, parseLogDate, type WorkoutLog } from './sessions';

/**
 * The session form: POST /workouts/logs for a new session, PATCH for an
 * existing one. The PATCH is revision-aware — it carries `setRecordsVersion: 1`
 * and `expectedRevision` so a log written by the set-aware runner is edited
 * rather than refused with a 409, and a stale copy is refused with the
 * server's own words instead of silently overwriting someone's sets.
 * `clientRequestId` is deliberately not sent (the allowlist rejects it).
 */

/** A session seeded from a workout or a previous log; no `_id` means it will be created. */
export type LogSeed = Partial<Omit<WorkoutLog, '_id'>>;

type FormState = {
  name: string;
  type: string;
  date: string;
  duration: string;
  caloriesBurned: string;
  notes: string;
  exercises: ExerciseDraft[];
};

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const formFrom = (log?: LogSeed | null): FormState => {
  const d = parseLogDate(log?.date) ?? new Date();
  return {
    name: log?.name ?? '',
    type: log?.type ?? 'strength',
    date: format(d, "yyyy-MM-dd'T'HH:mm"),
    duration: log?.duration != null && log.duration !== 0 ? String(log.duration) : '',
    caloriesBurned: log?.caloriesBurned != null && log.caloriesBurned !== 0 ? String(log.caloriesBurned) : '',
    notes: log?.notes ?? '',
    exercises: log?.exercises?.length ? log.exercises.map(exerciseDraftFrom) : [emptyExercise()],
  };
};

const isConflict = (e: unknown) => (e as { response?: { status?: number } } | null)?.response?.status === 409;

export function SessionForm({
  editing,
  seed,
  description,
  onSaved,
  onCancel,
}: {
  /** Existing log → PATCH. */
  editing?: WorkoutLog | null;
  /** Prefill for a new log → POST. */
  seed?: LogSeed | null;
  description?: string;
  onSaved: (saved: WorkoutLog | undefined) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => formFrom(editing ?? seed));
  const [errors, setErrors] = useState<{ date?: string; exercises?: string }>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      setConflict(null);
      const exercises: LogExercise[] = form.exercises.map(toExercisePayload).filter((e) => e.name.length > 0);
      const parsed = new Date(form.date);
      const next: typeof errors = {};
      if (!exercises.length) next.exercises = 'Add at least one exercise with a name.';
      if (!isValid(parsed)) next.date = 'Enter a valid date and time.';
      setErrors(next);
      if (next.exercises || next.date) throw Object.assign(new Error('validation'), { silent: true });

      const setAware = exercises.some((e) => e.setRecords !== undefined);
      const payload = {
        name: form.name.trim() || 'Workout',
        type: form.type,
        date: parsed.toISOString(),
        duration: num(form.duration) ?? 0,
        caloriesBurned: num(form.caloriesBurned) ?? 0,
        notes: form.notes.trim(),
        exercises,
        isCompleted: editing?.isCompleted ?? true,
        // Every PATCH speaks the set-aware contract; a POST only when it actually carries sets.
        ...(editing || setAware ? { setRecordsVersion: 1 } : {}),
        ...(editing ? { expectedRevision: editing.revision ?? 0 } : {}),
      };

      const { data } = editing
        ? await api.patch<{ workout?: WorkoutLog } | WorkoutLog>(`/workouts/logs/${editing._id}`, payload)
        : await api.post<{ workout?: WorkoutLog } | WorkoutLog>('/workouts/logs', payload);
      const saved = (data as { workout?: WorkoutLog })?.workout ?? (data as WorkoutLog);
      return saved && typeof saved === 'object' && '_id' in saved ? saved : undefined;
    },
    onSuccess: (saved) => {
      toast.success(editing ? 'Session saved' : 'Session logged');
      qc.invalidateQueries({ queryKey: LOGS_KEY });
      if (editing) qc.invalidateQueries({ queryKey: ['workout-log', editing._id] });
      // The progress hub's tiles, calendar, movements and records count this session too.
      qc.invalidateQueries({ queryKey: ['workout-progress'] });
      onSaved(saved);
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      const message = errMsg(e, 'Could not save session');
      if (isConflict(e)) {
        // The log moved on under us: refresh the copy on screen and say so where the member is looking.
        setConflict(message);
        qc.invalidateQueries({ queryKey: LOGS_KEY });
        if (editing) qc.invalidateQueries({ queryKey: ['workout-log', editing._id] });
        return;
      }
      toast.error(message);
    },
  });

  return (
    <form
      id={formId}
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {description ? <p className="text-sm text-text-2">{description}</p> : null}
      {conflict ? (
        <Callout tone="warning" title="This session changed since you opened it">
          <p>{conflict}</p>
        </Callout>
      ) : null}
      <Input label="Session name" hint="Optional. Defaults to “Workout”." placeholder="e.g. Push day A" autoComplete="off" value={form.name} onChange={(e) => set('name', e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Type" options={CATEGORY_OPTIONS} value={form.type} onChange={(v) => set('type', v)} />
        <DateField
          label="Date and time"
          type="datetime-local"
          containerClassName="col-span-2 sm:col-span-1"
          required
          value={form.date}
          error={errors.date}
          onChange={(e) => {
            set('date', e.target.value);
            if (errors.date) setErrors((er) => ({ ...er, date: undefined }));
          }}
        />
        <Input label="Duration (min)" type="number" inputMode="numeric" min={0} max={1440} placeholder="45" value={form.duration} onChange={(e) => set('duration', e.target.value)} />
        <Input label="Calories (kcal)" type="number" inputMode="numeric" min={0} placeholder="350" value={form.caloriesBurned} onChange={(e) => set('caloriesBurned', e.target.value)} />
      </div>

      <ExerciseRows
        value={form.exercises}
        showNotes={false}
        error={errors.exercises}
        onChange={(v) => {
          set('exercises', v);
          if (errors.exercises) setErrors((er) => ({ ...er, exercises: undefined }));
        }}
      />

      <Textarea label="Notes" hint="Optional. Energy, sleep, anything worth remembering." rows={2} autoGrow maxRows={6} value={form.notes} onChange={(e) => set('notes', e.target.value)} />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="quiet" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
          {editing ? 'Save changes' : 'Log session'}
        </Button>
      </div>
    </form>
  );
}
