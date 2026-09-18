import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Select,
  Skeleton,
  Textarea,
  cx,
  humanize,
  useOnline,
  useToast,
  plural,
} from '../../components/ui';
import { ArrowDown, ArrowUp, ArrowLeft, Check, Dumbbell, Plus, Trash } from '../../components/icons';
import { AdminPageHeader, Stamp } from './AdminLayout';
import {
  CATALOG_CATEGORIES,
  CATALOG_LEVELS,
  catalogKeys,
  createCatalogWorkout,
  getCatalogWorkout,
  updateCatalogWorkout,
  type CatalogCategory,
  type CatalogLevel,
  type CatalogWorkout,
  type WorkoutBody,
} from './catalogApi';
import {
  CoverImageField,
  FactList,
  HashtagsField,
  SaveErrorCallout,
  WholeNumberInput,
  useUnsavedChangesWarning,
} from './catalogFields';
import {
  LIMITS,
  catalogErrorDetails,
  catalogReturnPath,
  isMissingRecordError,
  isObjectId,
  newExerciseDraft,
  seedableRecord,
  validateWorkoutDraft,
  workoutSession,
  workoutSessionBody,
  type CatalogErrorDetails,
  type EditorSession,
  type ExerciseDraft,
  type ExerciseErrors,
  type ExerciseField,
  type WorkoutDraft,
} from './catalogRules';

const CATEGORY_OPTIONS = CATALOG_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
const LEVEL_OPTIONS = CATALOG_LEVELS.map((l) => ({ value: l, label: humanize(l) }));
const FORM_ID = 'catalog-workout-form';

type Session = EditorSession<CatalogWorkout, WorkoutDraft>;

const exerciseFieldId = (key: string, field: ExerciseField) => `exercise-${key}-${field}`;

/* ----------------------------------------------------------- exercise row */

function ExerciseRow({
  index,
  count,
  draft,
  errors,
  disabled,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  count: number;
  draft: ExerciseDraft;
  errors: ExerciseErrors;
  disabled: boolean;
  onChange: (patch: Partial<ExerciseDraft>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const position = index + 1;
  const label = draft.name.trim() || `Exercise ${position}`;
  const bounds = LIMITS.exercise;
  return (
    <li>
      <fieldset
        className={cx(
          'rounded-md border bg-surface-2/40 p-3 sm:p-4',
          errors.row ? 'border-danger' : 'border-line',
        )}
        aria-describedby={errors.row ? exerciseFieldId(draft.key, 'name') + '-row' : undefined}
      >
        <legend className="sr-only">Exercise {position}</legend>
        <div className="flex items-start gap-3">
          <span className="type-stat mt-3 w-6 shrink-0 text-center text-sm text-text-3" aria-hidden="true">
            {position}
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <Input
              id={exerciseFieldId(draft.key, 'name')}
              label="Exercise name"
              value={draft.name}
              maxLength={bounds.name.max}
              disabled={disabled}
              error={errors.name}
              autoComplete="off"
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <WholeNumberInput id={exerciseFieldId(draft.key, 'sets')} label="Sets" value={draft.sets} onChange={(v) => onChange({ sets: v })} min={bounds.sets.min} max={bounds.sets.max} error={errors.sets} disabled={disabled} />
              <WholeNumberInput id={exerciseFieldId(draft.key, 'reps')} label="Reps" value={draft.reps} onChange={(v) => onChange({ reps: v })} min={bounds.reps.min} max={bounds.reps.max} error={errors.reps} disabled={disabled} />
              <WholeNumberInput id={exerciseFieldId(draft.key, 'duration')} label="Duration" unit="s" value={draft.duration} onChange={(v) => onChange({ duration: v })} min={bounds.duration.min} max={bounds.duration.max} error={errors.duration} disabled={disabled} hint="Seconds" />
              <WholeNumberInput id={exerciseFieldId(draft.key, 'rest')} label="Rest" unit="s" value={draft.rest} onChange={(v) => onChange({ rest: v })} min={bounds.rest.min} max={bounds.rest.max} error={errors.rest} disabled={disabled} hint="Seconds" />
              <WholeNumberInput id={exerciseFieldId(draft.key, 'caloriesBurned')} label="Calories" value={draft.caloriesBurned} onChange={(v) => onChange({ caloriesBurned: v })} min={bounds.caloriesBurned.min} max={bounds.caloriesBurned.max} error={errors.caloriesBurned} disabled={disabled} hint="kcal" />
            </div>
            {draft.showNotes ? (
              <Textarea
                id={exerciseFieldId(draft.key, 'notes')}
                label="Notes"
                rows={2}
                autoGrow
                value={draft.notes}
                maxLength={bounds.notes.max}
                disabled={disabled}
                error={errors.notes}
                hint={`${draft.notes.length}/${bounds.notes.max}. Form cues, tempo, equipment.`}
                onChange={(e) => onChange({ notes: e.target.value })}
              />
            ) : (
              <Button size="sm" variant="link" disabled={disabled} onClick={() => onChange({ showNotes: true })}>
                Add notes
              </Button>
            )}
            {errors.row ? (
              <p id={exerciseFieldId(draft.key, 'name') + '-row'} role="alert" className="text-xs text-danger">
                {errors.row}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1" role="group" aria-label={`Reorder or remove ${label}`}>
            <IconButton id={`exercise-${draft.key}-up`} label={`Move ${label} up`} size={40} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={18} />
            </IconButton>
            <IconButton id={`exercise-${draft.key}-down`} label={`Move ${label} down`} size={40} disabled={disabled || index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown size={18} />
            </IconButton>
            <IconButton label={`Remove ${label}`} size={40} variant="danger" disabled={disabled} onClick={onRemove}>
              <Trash size={18} />
            </IconButton>
          </div>
        </div>
      </fieldset>
    </li>
  );
}

/* ------------------------------------------------------------------ page */

function EditorSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true" aria-label="Loading workout">
      <div className="space-y-5">
        <Card>
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-11 sm:col-span-2" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-24 sm:col-span-2" />
          </div>
        </Card>
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-32" />
          <Skeleton className="mt-3 h-32" />
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 aspect-video w-full" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-11" />
        </Card>
      </div>
    </div>
  );
}

export default function AdminCatalogWorkout() {
  const { workoutId } = useParams();
  const isNew = !workoutId || workoutId === 'new';
  const id = isNew ? '' : (workoutId as string);
  const validId = isNew || isObjectId(id);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const backTo = catalogReturnPath(location.state, 'workouts');

  // staleTime 0: every mount refetches, and the draft below is seeded only
  // once that fetch settles (see seedableRecord), never from the cached copy.
  const detail = useQuery({
    queryKey: catalogKeys.workout(id),
    queryFn: () => getCatalogWorkout(id),
    enabled: !isNew && validId,
    staleTime: 0,
  });

  const [session, setSession] = useState<Session | null>(() => (isNew ? workoutSession('', null) : null));
  const current = session && session.id === id ? session : null;
  const draft = current?.draft ?? null;
  const baseline = current?.baseline ?? null;
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<CatalogErrorDetails | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Seed from the record fetched for this mount. Until the admin types, a
  // fresher copy (an explicit reload, a refetch) may still replace the draft;
  // after that the draft is theirs and only Reload swaps it.
  const record = seedableRecord(detail)?.workout ?? null;
  useEffect(() => {
    if (isNew || !record) return;
    if (current && (touched || current.baseline === record)) return;
    setSession(workoutSession(id, record));
    if (!current) {
      // A session for another id (or the first one) starts clean.
      setTouched(false);
      setAttempted(false);
      setServerError(null);
    }
  }, [isNew, id, record, current, touched]);

  useEffect(() => {
    if (!focusKey) return;
    const el = document.getElementById(focusKey);
    if (el) el.focus();
    setFocusKey(null);
  }, [focusKey, draft]);

  const validation = useMemo(() => (draft ? validateWorkoutDraft(draft) : null), [draft]);
  const body = useMemo<WorkoutBody>(() => (current ? workoutSessionBody(current) : {}), [current]);
  const dirty = isNew ? touched : Object.keys(body).length > 0;

  const save = useMutation({
    mutationFn: (payload: WorkoutBody) => (isNew ? createCatalogWorkout(payload) : updateCatalogWorkout(id, payload)),
    onSuccess: (workout) => {
      toast.success(isNew ? `Created “${workout.title}”` : `Saved “${workout.title}”`);
      qc.setQueryData(catalogKeys.workout(workout._id), { workout, usedByPlans: detail.data?.usedByPlans ?? 0 });
      void qc.invalidateQueries({ queryKey: catalogKeys.workouts });
      // Plans embed a summary of each scheduled workout (title, calories…).
      if (!isNew) void qc.invalidateQueries({ queryKey: catalogKeys.plans });
      setTouched(false);
      navigate(backTo);
    },
    onError: (e) => {
      const details = catalogErrorDetails(e, isNew ? 'Could not create this workout.' : 'Could not save this workout.');
      setServerError(details);
      setAnnouncement(details.message);
    },
  });

  useUnsavedChangesWarning(dirty && !save.isPending);

  const change = (patch: Partial<WorkoutDraft>) => {
    setSession((s) => (s && s.id === id ? { ...s, draft: { ...s.draft, ...patch } } : s));
    setTouched(true);
    // Field-level complaints from the last attempt are about values that are
    // now changing; a stale-record notice must stay until the admin reloads.
    setServerError((error) => (error && error.stale ? error : null));
  };

  const changeExercise = (key: string, patch: Partial<ExerciseDraft>) => {
    if (!draft) return;
    change({ exercises: draft.exercises.map((exercise) => (exercise.key === key ? { ...exercise, ...patch } : exercise)) });
  };

  const addExercise = () => {
    if (!draft) return;
    const next = newExerciseDraft();
    change({ exercises: [...draft.exercises, next] });
    setFocusKey(exerciseFieldId(next.key, 'name'));
    setAnnouncement(`Exercise ${draft.exercises.length + 1} added`);
  };

  const removeExercise = (key: string) => {
    if (!draft) return;
    const index = draft.exercises.findIndex((exercise) => exercise.key === key);
    const removed = draft.exercises[index];
    const rest = draft.exercises.filter((exercise) => exercise.key !== key);
    change({ exercises: rest });
    setAnnouncement(`Removed ${removed?.name.trim() || `exercise ${index + 1}`}. ${plural(rest.length, 'exercise')} left.`);
    const neighbour = rest[Math.min(index, rest.length - 1)];
    setFocusKey(neighbour ? exerciseFieldId(neighbour.key, 'name') : 'catalog-add-exercise');
  };

  const moveExercise = (key: string, direction: -1 | 1) => {
    if (!draft) return;
    const index = draft.exercises.findIndex((exercise) => exercise.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.exercises.length) return;
    const next = [...draft.exercises];
    [next[index], next[target]] = [next[target], next[index]];
    change({ exercises: next });
    const name = next[target].name.trim() || 'Exercise';
    setAnnouncement(`${name} moved to position ${target + 1} of ${next.length}`);
    // Keep focus on the control that was pressed unless it just became disabled at an end.
    const atEnd = direction === -1 ? target === 0 : target === next.length - 1;
    setFocusKey(`exercise-${key}-${atEnd ? (direction === -1 ? 'down' : 'up') : direction === -1 ? 'up' : 'down'}`);
  };

  const reload = async () => {
    const result = await detail.refetch();
    if (result.data) {
      setSession(workoutSession(id, result.data.workout));
      setTouched(false);
      setServerError(null);
      setAttempted(false);
      setAnnouncement('Reloaded the saved version');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !validation || save.isPending) return;
    setAttempted(true);
    if (!validation.ok) {
      const first = validation.fields.title
        ?? validation.fields.category
        ?? validation.fields.duration
        ?? validation.fields.caloriesBurned
        ?? validation.fields.description
        ?? validation.fields.hashtags
        ?? validation.fields.exercises
        ?? 'Check the highlighted fields';
      setAnnouncement(first);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#${FORM_ID} [aria-invalid="true"]`)?.focus();
      });
      return;
    }
    if (!isNew && Object.keys(body).length === 0) {
      toast.info('Nothing has changed.');
      return;
    }
    save.mutate(body);
  };

  const leave = () => {
    if (dirty && !save.isPending) setConfirmLeave(true);
    else navigate(backTo);
  };

  // Server-side complaints are merged over the client's own, field by field.
  const fieldError = (field: keyof NonNullable<typeof validation>['fields']): string | undefined => (
    serverError?.fields[field] ?? (attempted ? validation?.fields[field] : undefined)
  );
  const exerciseErrors = (exercise: ExerciseDraft, index: number): ExerciseErrors => {
    const own = attempted ? validation?.exercises[exercise.key] ?? {} : {};
    const server = serverError?.rows[index + 1];
    if (!server) return own;
    const field = server.field as ExerciseField | undefined;
    return field && field !== 'name' && ['sets', 'reps', 'duration', 'rest', 'caloriesBurned', 'notes'].includes(field)
      ? { ...own, [field]: server.message }
      : { ...own, row: server.message };
  };

  const title = isNew ? 'New workout' : baseline ? `Edit “${baseline.title}”` : 'Edit workout';
  const saving = save.isPending;
  const canSave = online && !saving && (isNew || dirty);

  const actions = (
    <>
      <Button variant="ghost" onClick={leave} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" form={FORM_ID} variant="primary" icon={<Check size={18} />} loading={saving} disabled={!canSave}>
        {isNew ? 'Create workout' : 'Save changes'}
      </Button>
    </>
  );

  if (!isNew && (!validId || detail.isError)) {
    return (
      <div className="space-y-5">
        <AdminPageHeader title="Edit workout" />
        <Card>
          {!validId || isMissingRecordError(detail.error) ? (
            <EmptyState
              variant="error"
              title="Workout not found"
              message="It may have been deleted by another administrator, or the link is wrong."
              action={{ label: 'Back to catalog', to: backTo, icon: <ArrowLeft size={18} />, variant: 'secondary' }}
            />
          ) : (
            <ErrorState error={detail.error} title="Could not load this workout" retry={() => void detail.refetch()} />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={title}
        subtitle={
          isNew
            ? 'A premade workout is published to every member’s library the moment it is created.'
            : 'Changes publish immediately and are recorded in the audit log.'
        }
        actions={draft ? actions : undefined}
      />

      <div className="-mt-2">
        <ButtonLink
          to={backTo}
          variant="link"
          size="sm"
          icon={<ArrowLeft size={16} />}
          onClick={(e) => {
            // Same guard as Cancel: a plain click asks before discarding edits.
            if (dirty && !saving) {
              e.preventDefault();
              setConfirmLeave(true);
            }
          }}
        >
          Back to catalog
        </ButtonLink>
      </div>

      {!online ? (
        <Callout tone="warning" title="You’re offline">
          {draft
            ? 'Keep editing; saving becomes available again once the connection is back.'
            : 'The latest saved version loads once the connection is back.'}
        </Callout>
      ) : null}

      <SaveErrorCallout details={serverError} onReload={isNew ? undefined : () => void reload()} backTo={backTo} />

      {!draft || !validation ? (
        <EditorSkeleton />
      ) : (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={onSubmit}
          aria-busy={saving || undefined}
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
        >
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader title="Basics" subtitle="What members see on the workout card." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Title"
                  containerClassName="sm:col-span-2"
                  value={draft.title}
                  maxLength={LIMITS.title.max}
                  autoComplete="off"
                  disabled={saving}
                  error={fieldError('title')}
                  hint={`${LIMITS.title.min}–${LIMITS.title.max} characters, unique among premade workouts.`}
                  onChange={(e) => change({ title: e.target.value })}
                />
                <Select
                  label="Category"
                  options={CATEGORY_OPTIONS}
                  value={draft.category || null}
                  placeholder="Choose a category"
                  disabled={saving}
                  error={fieldError('category')}
                  onChange={(v) => change({ category: v as CatalogCategory })}
                />
                <Select
                  label="Level"
                  options={LEVEL_OPTIONS}
                  value={draft.level}
                  disabled={saving}
                  error={fieldError('level')}
                  onChange={(v) => change({ level: v as CatalogLevel })}
                />
                <WholeNumberInput
                  label="Duration"
                  unit="minutes"
                  value={draft.duration}
                  min={LIMITS.duration.min}
                  max={LIMITS.duration.max}
                  disabled={saving}
                  error={fieldError('duration')}
                  onChange={(v) => change({ duration: v })}
                />
                <WholeNumberInput
                  label="Calories burned"
                  unit="kcal"
                  value={draft.caloriesBurned}
                  min={LIMITS.caloriesBurned.min}
                  max={LIMITS.caloriesBurned.max}
                  disabled={saving}
                  error={fieldError('caloriesBurned')}
                  hint="Estimated total; also feeds plan calorie totals."
                  onChange={(v) => change({ caloriesBurned: v })}
                />
                <Textarea
                  label="Description"
                  containerClassName="sm:col-span-2"
                  rows={3}
                  autoGrow
                  value={draft.description}
                  maxLength={LIMITS.description.max}
                  disabled={saving}
                  error={fieldError('description')}
                  hint={`${draft.description.length}/${LIMITS.description.max}`}
                  onChange={(e) => change({ description: e.target.value })}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`Exercises (${draft.exercises.length})`}
                subtitle={`${LIMITS.exercises.min}–${LIMITS.exercises.max} exercises, in the order members perform them.`}
                action={
                  <Button
                    id="catalog-add-exercise"
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    disabled={saving || draft.exercises.length >= LIMITS.exercises.max}
                    onClick={addExercise}
                  >
                    Add exercise
                  </Button>
                }
              />
              {fieldError('exercises') ? (
                <p role="alert" className="mb-3 text-xs text-danger">{fieldError('exercises')}</p>
              ) : null}
              {draft.exercises.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<Dumbbell size={24} />}
                  title="No exercises yet"
                  message="A workout needs at least one exercise before it can be saved."
                  action={{ label: 'Add exercise', onClick: addExercise, icon: <Plus size={18} />, variant: 'secondary' }}
                />
              ) : (
                <ol className="space-y-3" aria-label="Exercises">
                  {draft.exercises.map((exercise, index) => (
                    <ExerciseRow
                      key={exercise.key}
                      index={index}
                      count={draft.exercises.length}
                      draft={exercise}
                      errors={exerciseErrors(exercise, index)}
                      disabled={saving}
                      onChange={(patch) => changeExercise(exercise.key, patch)}
                      onRemove={() => removeExercise(exercise.key)}
                      onMove={(direction) => moveExercise(exercise.key, direction)}
                    />
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <aside className="space-y-5">
            <Card>
              <CoverImageField value={draft.image} onChange={(image) => change({ image })} disabled={saving} error={fieldError('image')} />
            </Card>
            <Card>
              <HashtagsField tags={draft.hashtags} onChange={(hashtags) => change({ hashtags })} disabled={saving} error={fieldError('hashtags')} />
            </Card>
            {baseline ? (
              <Card>
                <CardHeader title="Details" />
                <FactList
                  facts={[
                    { label: 'Scheduled in', value: plural(detail.data?.usedByPlans ?? 0, 'plan') },
                    { label: 'Engagement', value: `${plural(baseline.likesCount, 'like')}, ${plural(baseline.commentsCount, 'comment')}` },
                    { label: 'Created', value: <Stamp iso={baseline.createdAt} /> },
                    { label: 'Last updated', value: <Stamp iso={baseline.updatedAt} /> },
                    { label: 'Workout ID', value: baseline._id, mono: true },
                  ]}
                />
              </Card>
            ) : null}
          </aside>
        </form>
      )}

      <ConfirmDialog
        open={confirmLeave}
        title="Discard changes?"
        message="Your unsaved edits to this workout will be lost."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          setTouched(false);
          navigate(backTo);
        }}
      />

      <p className="sr-only" role="status">{announcement}</p>
    </div>
  );
}
