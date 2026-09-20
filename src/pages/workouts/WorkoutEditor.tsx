import { useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../../lib/api';
import { Button, Checkbox, ErrorState, Input, Select, Skeleton, Textarea, useToast } from '../../components/ui';
import { RouteSheet } from '../../components/RouteSheet';
import { CoverPicker } from './CoverPicker';
import { ExerciseRows, emptyExercise, exerciseDraftFrom, toExercisePayload, type ExerciseDraft } from './exerciseDraft';
import { CATEGORY_OPTIONS, LEVEL_OPTIONS, fetchWorkout, type SaveEnvelope, type SocialWorkout } from './model';
import { TRAIN, useSheetClose, useSheetNav } from './sheet';

/**
 * /workouts/new and /workouts/:workoutId/edit — the library workout editor as
 * a route: a sheet over the page that opened it on desktop, a page on phones.
 * Edits go to the full update route. The PATCH /workouts/:id route was a
 * privacy toggle that answered 200 while dropping every other field, which is
 * how "Workout saved" once meant nothing was saved.
 */

type FormState = {
  title: string;
  description: string;
  category: string;
  level: string;
  duration: string;
  caloriesBurned: string;
  hashtags: string;
  isPublic: boolean;
  exercises: ExerciseDraft[];
  /** `undefined` = untouched, `null` = removed, string = new upload key. */
  imageKey: string | null | undefined;
};

const formFrom = (w?: SocialWorkout | null): FormState => ({
  title: w?.title ?? '',
  description: w?.description ?? '',
  category: w?.category ?? 'strength',
  level: w?.level ?? 'beginner',
  duration: w?.duration != null ? String(w.duration) : '',
  caloriesBurned: w?.caloriesBurned != null ? String(w.caloriesBurned) : '',
  hashtags: (w?.hashtags ?? []).join(', '),
  isPublic: w?.isPublic ?? true,
  exercises: w?.exercises && w.exercises.length ? w.exercises.map(exerciseDraftFrom) : [emptyExercise()],
  imageKey: undefined,
});

function EditorSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading workout">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function WorkoutForm({ editing, onDone }: { editing: SocialWorkout | null; onDone: (saved: SocialWorkout) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const close = useSheetClose(editing ? TRAIN.workout(editing._id) : TRAIN.hub);
  const [form, setForm] = useState<FormState>(() => formFrom(editing));
  const [errors, setErrors] = useState<{ title?: string; exercises?: string }>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const exercises = form.exercises.map(toExercisePayload).filter((e) => e.name.length > 0);
      const next: typeof errors = {};
      if (!form.title.trim()) next.title = 'Give the workout a title.';
      if (!exercises.length) next.exercises = 'Add at least one exercise with a name.';
      setErrors(next);
      if (next.title || next.exercises) throw Object.assign(new Error('validation'), { silent: true });
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        level: form.level,
        duration: form.duration ? Number(form.duration) : undefined,
        caloriesBurned: form.caloriesBurned ? Number(form.caloriesBurned) : undefined,
        hashtags: form.hashtags
          .split(',')
          .map((t) => t.trim().replace(/^#/, '').toLowerCase())
          .filter(Boolean),
        isPublic: form.isPublic,
        exercises,
      };
      if (form.imageKey) payload.image = { uri: form.imageKey };
      else if (form.imageKey === null && editing?.image?.uri) payload.image = null;

      const { data } = editing
        ? await api.put<SaveEnvelope>(`/workouts/update/${editing._id}`, payload)
        : await api.post<SaveEnvelope>('/workouts/create', payload);
      const saved = data?.data ?? data?.workout;
      // Only celebrate once the server has echoed the saved document back.
      if (!saved?._id || (editing && saved.title !== payload.title)) {
        throw new Error('The server did not confirm the save. Nothing was changed.');
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(editing ? 'Workout saved' : 'Workout created');
      if (editing) qc.setQueryData<SocialWorkout>(['workout', editing._id], (old) => (old ? { ...old, ...saved } : saved));
      qc.invalidateQueries({ queryKey: ['workouts'] });
      if (editing) qc.invalidateQueries({ queryKey: ['workout', editing._id] });
      onDone(saved);
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      toast.error(errMsg(e, 'Could not save workout'));
    },
  });

  return (
    <form
      id={formId}
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      {editing ? null : <p className="text-sm text-text-2">A reusable session you can log, share or add to a plan.</p>}
      <Input
        label="Title"
        placeholder="e.g. Push day A"
        autoComplete="off"
        required
        value={form.title}
        error={errors.title}
        onChange={(e) => {
          set('title', e.target.value);
          if (errors.title) setErrors((er) => ({ ...er, title: undefined }));
        }}
      />
      <Textarea label="Description" hint="Optional. What the session is for and how to run it." rows={2} autoGrow maxRows={6} value={form.description} onChange={(e) => set('description', e.target.value)} />
      <CoverPicker storageKey={form.imageKey ?? null} existingUri={editing?.image?.uri} onChange={(key) => set('imageKey', key)} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Category" options={CATEGORY_OPTIONS} value={form.category} onChange={(v) => set('category', v)} />
        <Select label="Level" options={LEVEL_OPTIONS} value={form.level} onChange={(v) => set('level', v)} />
        <Input label="Duration (min)" type="number" inputMode="numeric" min={0} max={1440} placeholder="45" value={form.duration} onChange={(e) => set('duration', e.target.value)} />
        <Input label="Calories (kcal)" type="number" inputMode="numeric" min={0} placeholder="350" value={form.caloriesBurned} onChange={(e) => set('caloriesBurned', e.target.value)} />
      </div>
      <Input label="Hashtags" hint="Comma separated. The # is optional." placeholder="legday, strength" autoComplete="off" value={form.hashtags} onChange={(e) => set('hashtags', e.target.value)} />
      <Checkbox checked={form.isPublic} onChange={(v) => set('isPublic', v)} label="Share publicly" description="Anyone on Vybe can find, like and save this workout." />

      <ExerciseRows
        value={form.exercises}
        error={errors.exercises}
        onChange={(v) => {
          set('exercises', v);
          if (errors.exercises) setErrors((er) => ({ ...er, exercises: undefined }));
        }}
      />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="quiet" onClick={close} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
          {editing ? 'Save changes' : 'Create workout'}
        </Button>
      </div>
    </form>
  );
}

export default function WorkoutEditor() {
  const { workoutId } = useParams();
  const editing = Boolean(workoutId);
  const navigate = useNavigate();
  const { state } = useSheetNav();
  const close = useSheetClose(workoutId ? TRAIN.workout(workoutId) : TRAIN.hub);
  const workout = useQuery({ queryKey: ['workout', workoutId], queryFn: () => fetchWorkout(workoutId!), enabled: editing });
  const title = editing ? 'Edit workout' : 'New workout';

  return (
    <RouteSheet title={title} onClose={close}>
      {editing && workout.isLoading ? (
        <EditorSkeleton />
      ) : editing && (workout.isError || !workout.data) ? (
        <ErrorState error={workout.error} title="Workout not found" message="It may have been deleted or made private." onRetry={() => workout.refetch()} />
      ) : (
        <WorkoutForm
          key={workout.data?._id ?? 'new'}
          editing={workout.data ?? null}
          onDone={(saved) => {
            // A new workout opens in place of its editor (same sheet, same background); an edit just closes.
            if (editing) close();
            else navigate(TRAIN.workout(saved._id), { replace: true, viewTransition: true, state });
          }}
        />
      )}
    </RouteSheet>
  );
}
