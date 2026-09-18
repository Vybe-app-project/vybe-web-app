import { useEffect, useId, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  isToday,
  isValid,
  isYesterday,
  parseISO,
  startOfDay,
  subDays,
} from 'date-fns';
import { api, errMsg, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  bindWorkoutDraftAccount, loadWorkoutDraft, persistWorkoutDraft, removeWorkoutDraft,
  workoutDraftSessionToken, emptyRestTimer, WorkoutDraftConflict, type WorkoutDraft, type WorkoutDraftHandle,
} from '../lib/workoutDrafts';
import { WorkoutRestTimer } from './WorkoutRestTimer';
import { formatSeconds } from '../lib/duration';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonTile,
  StatGrid,
  StatTile,
  Textarea,
  VIZ,
  chartTheme,
  cx,
  formatStat,
  humanize,
  useIsCompact,
  useToast,
  type MenuItem,
} from './ui';
import { Activity, Clock, Copy, Dumbbell, Edit, Flame, Plus, Trash, Zap } from './icons';
import {
  CATEGORY_OPTIONS,
  MetaList,
  type SocialWorkout,
} from './Workouts';
import { WorkoutSetEditor } from './WorkoutSetEditor';
import {
  emptyLogExercise, logExerciseDraftFrom, toLogExercisePayload, repeatedExercises, sessionVolume,
  type LogExercise, type LogExerciseDraft,
} from './workout-set-records';
export { sessionVolume } from './workout-set-records';

/* ------------------------------------------------------------------ types */

type WorkoutLog = {
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
  setRecordsVersion?: number;
  revision?: number;
};

type LogsResponse = {
  workouts: WorkoutLog[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

/** A session seeded from a workout or a previous log; no `_id` means it will be created. */
type LogSeed = Partial<Omit<WorkoutLog, '_id'>> & { previousExercises?: LogExercise[] };

/* -------------------------------------------------------------- utilities */

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const parseDate = (value?: string): Date | null => {
  if (!value) return null;
  const d = value.includes('T') ? parseISO(value) : new Date(value);
  return isValid(d) ? d : null;
};

const dayKey = (d: Date) => format(startOfDay(d), 'yyyy-MM-dd');

const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMMM'));

const plural = (n: number, one: string, many = `${one}s`) => `${formatStat(n)} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------- form types */

type FormState = {
  name: string;
  type: string;
  date: string;
  duration: string;
  caloriesBurned: string;
  notes: string;
  exercises: LogExerciseDraft[];
};

const formFrom = (log?: LogSeed | null): FormState => {
  const d = parseDate(log?.date) ?? new Date();
  return {
    name: log?.name ?? '',
    type: log?.type ?? 'strength',
    date: format(d, "yyyy-MM-dd'T'HH:mm"),
    duration: log?.duration != null && log.duration !== 0 ? String(log.duration) : '',
    caloriesBurned: log?.caloriesBurned != null && log.caloriesBurned !== 0 ? String(log.caloriesBurned) : '',
    notes: log?.notes ?? '',
    exercises: log?.exercises?.length ? log.exercises.map(logExerciseDraftFrom) : [emptyLogExercise()],
  };
};

/**
 * Seed a fresh session from a library workout ("Log this workout"). Exercise
 * prescriptions are seconds; private exercise and session durations are minutes.
 */
const seedFromWorkout = (w: SocialWorkout): LogSeed => ({
  name: w.title,
  type: w.category,
  duration: w.duration,
  caloriesBurned: w.caloriesBurned,
  exercises: (w.exercises ?? []).map((e) => ({
    name: e.name,
    sets: e.sets,
    reps: e.reps,
    weight: e.weight,
    duration: e.duration == null ? undefined : e.duration / 60,
    notes: e.notes,
  })),
});

/** Seed a fresh session from a past one ("Log again"): same content, dated now. */
const seedFromLog = (log: WorkoutLog): LogSeed => {
  const exercises = repeatedExercises(log.exercises);
  return {
    name: log.name, type: log.type, duration: log.duration,
    caloriesBurned: log.caloriesBurned, notes: log.notes, exercises,
    previousExercises: log.exercises.map((exercise, i) => ({
      ...exercise, exerciseId: exercises[i].exerciseId,
      ...(exercise.setRecords === undefined ? {} : { setRecords: exercise.setRecords.map((set, j) => ({
        ...set, id: exercises[i].setRecords![j].id,
      })) }),
    })),
    setRecordsVersion: log.setRecordsVersion,
  };
};

/* --------------------------------------------------------------- log modal */

function LogModal({
  initialDraft,
  handle,
  initiallyStored,
  onClose,
  onReload,
}: {
  initialDraft: WorkoutDraft;
  handle: WorkoutDraftHandle;
  initiallyStored: boolean;
  onClose: (draft: WorkoutDraft | null) => void;
  onReload: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const [draft, setDraft] = useState(initialDraft);
  const form = draft.form as FormState;
  const editing = draft.editing as WorkoutLog | null;
  const seed = draft.seed as LogSeed | null;
  const [errors, setErrors] = useState<{ date?: string; exercises?: string; duration?: string; calories?: string }>({});
  const [saveError, setSaveError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [stored, setStored] = useState(initiallyStored);
  const [conflicted, setConflicted] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const finished = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const storageFailed = (error: unknown) => {
    if (error instanceof WorkoutDraftConflict) setConflicted(true);
    setStorageError(errMsg(error, 'Could not store this local workout.'));
  };
  useEffect(() => {
    if (finished.current || conflicted || (initiallyStored && draft === initialDraft)) return;
    let current = true;
    setStored(false);
    void persistWorkoutDraft(draft, handle).then(() => {
      if (current) { setStored(true); setStorageError(''); }
    }, error => {
      if (current) storageFailed(error);
    });
    return () => { current = false; };
  }, [draft, handle, initiallyStored, initialDraft, conflicted]);
  const change = (patch: Partial<WorkoutDraft>) => {
    const next = { ...latest.current, ...patch, updatedAt: Date.now() };
    latest.current = next;
    setStored(false);
    setDraft(next);
  };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    change({ form: { ...latest.current.form, [k]: v } });
  const closeForLater = async () => {
    if (save.isPending || conflicted) return;
    try {
      let snapshot: WorkoutDraft;
      do {
        snapshot = latest.current;
        await persistWorkoutDraft(snapshot, handle);
      } while (latest.current !== snapshot);
      onClose(snapshot);
    } catch (error) { storageFailed(error); }
  };

  const save = useMutation({
    mutationFn: async () => {
      setSaveError('');
      if (conflicted) throw new WorkoutDraftConflict();
      const draft = latest.current;
      const form = draft.form as FormState;
      const editing = draft.editing as WorkoutLog | null;
      const seed = draft.seed as LogSeed | null;
      const sessionToken = workoutDraftSessionToken(draft.ownerId);
      if (acknowledged) {
        await removeWorkoutDraft(handle);
        return;
      }
      let pending = draft.pending;
      if (!pending) {
      if ((editing?.setRecordsVersion ?? seed?.setRecordsVersion ?? 1) !== 1) {
        throw new Error('This session uses a newer set format. Update the app before editing it.');
      }
      let exercises: LogExercise[];
      try { exercises = form.exercises.map(toLogExercisePayload); }
      catch (error) {
        setErrors({ exercises: (error as Error).message });
        throw Object.assign(new Error('validation'), { silent: true });
      }
      const parsed = new Date(form.date);
      const duration = num(form.duration);
      const caloriesBurned = num(form.caloriesBurned);
      const next: typeof errors = {};
      if (!exercises.length) next.exercises = 'Add at least one exercise with a name.';
      if (!isValid(parsed)) next.date = 'Enter a valid date and time.';
      if (form.duration.trim() && (duration === undefined || duration > 1440)) next.duration = 'Enter a duration from 0 to 1440 minutes.';
      if (form.caloriesBurned.trim() && (caloriesBurned === undefined || caloriesBurned > 100000)) next.calories = 'Enter calories from 0 to 100000.';
      setErrors(next);
      if (Object.keys(next).length) throw Object.assign(new Error('validation'), { silent: true });

      const payload = {
        name: form.name.trim() || 'Workout',
        type: form.type,
        date: parsed.toISOString(),
        duration: duration ?? 0,
        caloriesBurned: caloriesBurned ?? 0,
        notes: form.notes.trim(),
        exercises,
        isCompleted: editing?.isCompleted ?? true,
        ...(editing?.setRecordsVersion === 1 || seed?.setRecordsVersion === 1 || exercises.some(ex => ex.setRecords !== undefined)
          ? { setRecordsVersion: 1 } : {}),
        ...(editing ? { expectedRevision: editing.revision ?? 0 } : {}),
        ...(!editing ? { clientRequestId: draft.clientRequestId } : {}),
      };
      pending = { payload, targetId: editing?._id ?? null };
      }
      const locked = { ...draft, pending, updatedAt: Date.now() };
      latest.current = locked;
      setStored(false);
      setDraft(locked);
      await persistWorkoutDraft(locked, handle);
      const config = { workoutSessionToken: sessionToken };
      let data: { workout?: WorkoutLog & { user?: string } };
      try {
        const response = pending.targetId
          ? await api.patch(`/workouts/logs/${pending.targetId}`, pending.payload, config)
          : await api.post('/workouts/logs', pending.payload, config);
        data = response.data;
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 400) change({ pending: null });
        throw error;
      }
      workoutDraftSessionToken(draft.ownerId);
      if (!data?.workout?._id || data.workout.user !== draft.ownerId
          || (pending.targetId && data.workout._id !== pending.targetId)) {
        throw new Error('Save acknowledgement was incomplete. Your original request is kept for safe retry.');
      }
      finished.current = true;
      setAcknowledged(true);
      await removeWorkoutDraft(handle);
    },
    onSuccess: () => {
      toast.success(editing ? 'Session saved' : 'Session logged');
      qc.invalidateQueries({ queryKey: ['workout-logs'] });
      onClose(null);
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      if (e instanceof WorkoutDraftConflict) storageFailed(e);
      if ((e as { response?: { status?: number } }).response?.status === 409) {
        qc.invalidateQueries({ queryKey: ['workout-logs'] });
      }
      const message = errMsg(e, 'Could not save session');
      setSaveError(message);
      toast.error(message);
    },
  });

  return (
    <Modal
      open
      onClose={() => { void closeForLater(); }}
      title={editing ? 'Edit session' : 'Log a session'}
      description={editing ? undefined : seed?.name ? `Based on ${seed.name}. Adjust what you actually did.` : 'What you did, when, and how much you moved.'}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => { void closeForLater(); }} disabled={save.isPending || conflicted}>
            Save for later
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDiscarding(true)} disabled={save.isPending}>Discard draft</Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={conflicted}>
            {acknowledged ? 'Retry local cleanup' : draft.pending ? 'Retry save' : editing ? 'Save changes' : 'Log session'}
          </Button>
        </>
      }
    >
      <p role="status" className="text-sm text-text-2">
        {acknowledged ? 'Saved on server. Clearing the local copy.'
          : storageError ? 'Local only · unsynced · not saved on this device'
            : stored ? 'Local only · unsynced · saved on this device' : 'Local only · unsynced · storing on this device…'}
      </p>
      {storageError ? <p role="alert" className="text-sm text-danger">{storageError}</p> : null}
      {conflicted ? <Button variant="secondary" onClick={() => setConfirmReload(true)}>Reload latest draft</Button> : null}
      {draft.pending && !acknowledged ? <p className="text-sm text-text-2">A save may already have reached the server. Retry the same request to check safely; authoring is locked until it is resolved or explicitly discarded.</p> : null}
      <form
        id={formId}
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={Boolean(draft.pending) || acknowledged || save.isPending} className="space-y-5">
        <Input
          label="Session name"
          hint="Optional. Defaults to “Workout”."
          placeholder="e.g. Push day A"
          autoComplete="off"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
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
          <Input
            label="Duration (min)"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            placeholder="45"
            value={form.duration}
            error={errors.duration}
            onChange={(e) => set('duration', e.target.value)}
          />
          <Input
            label="Calories (kcal)"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="350"
            value={form.caloriesBurned}
            error={errors.calories}
            onChange={(e) => set('caloriesBurned', e.target.value)}
          />
        </div>

        <WorkoutSetEditor
          value={form.exercises}
          previous={editing?.exercises ?? seed?.previousExercises ?? seed?.exercises}
          allowSetEntry={!editing}
          disabled={save.isPending || Boolean(draft.pending) || acknowledged}
          error={errors.exercises}
          onChange={(v) => {
            set('exercises', v);
            if (errors.exercises) setErrors((er) => ({ ...er, exercises: undefined }));
          }}
        />
        {saveError ? (
          <div role="alert" className="space-y-2 rounded-md border border-border-1 p-3 text-sm text-danger">
            <p>{saveError}</p>
            <p>Your draft is retained. Create retries reuse the same request ID. For an edit conflict, review history and explicitly discard this local copy before reopening the latest revision.</p>
          </div>
        ) : null}

        <Textarea
          label="Notes"
          hint="Optional. Energy, sleep, anything worth remembering."
          rows={2}
          autoGrow
          maxRows={6}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
        </fieldset>
        <WorkoutRestTimer timer={draft.timer} exercises={form.exercises} onChange={timer => change({ timer })} />
      </form>
      <ConfirmDialog open={discarding} title="Discard local workout draft?"
        message="This removes only this device’s unsynced draft and rest timer. A save already received by the server is not deleted."
        confirmLabel="Discard draft" destructive onCancel={() => setDiscarding(false)}
        onConfirm={() => {
          finished.current = true;
          void removeWorkoutDraft(handle).then(() => onClose(null), error => {
            finished.current = false; storageFailed(error); setDiscarding(false);
          });
        }} />
      <ConfirmDialog open={confirmReload} title="Reload latest workout draft?"
        message="Copy any unsaved input from this tab first. Reloading replaces this editor with the latest local recovery state; it does not merge or publish your edits."
        confirmLabel="Reload latest draft" onCancel={() => setConfirmReload(false)}
        onConfirm={() => { finished.current = true; onReload(); }} />
    </Modal>
  );
}

/* --------------------------------------------------------------- session card */

function SessionCard({
  log,
  onEdit,
  onRepeat,
  onDelete,
}: {
  log: WorkoutLog;
  onEdit: (log: WorkoutLog) => void;
  onRepeat: (log: WorkoutLog) => void;
  onDelete: (log: WorkoutLog) => void;
}) {
  const d = parseDate(log.date);
  const volume = sessionVolume(log);
  const exercises = log.exercises ?? [];
  const menu: MenuItem[] = [
    { label: 'Edit', icon: <Edit size={18} />, onSelect: () => onEdit(log) },
    { label: 'Log again', description: 'Same session, dated now', icon: <Copy size={18} />, onSelect: () => onRepeat(log) },
    { label: 'Delete', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => onDelete(log) },
  ];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold text-text-1">{log.name || 'Workout'}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
            {d ? (
              <time dateTime={d.toISOString()} className="tabular">
                {format(d, 'HH:mm')}
              </time>
            ) : (
              <span>Unknown time</span>
            )}
            {log.type ? <Badge size="sm">{humanize(log.type)}</Badge> : null}
          </p>
        </div>
        <Menu items={menu} label={`Options for ${log.name || 'workout'}`} className="-mr-2 -mt-1.5" />
      </div>

      <MetaList
        items={[
          !!log.duration && { icon: <Clock size={14} />, label: `${formatStat(log.duration)} min` },
          !!log.caloriesBurned && { icon: <Flame size={14} />, label: `${formatStat(log.caloriesBurned)} kcal` },
          volume > 0 && { icon: <Dumbbell size={14} />, label: `${formatStat(volume, { compact: volume >= 10_000 })} kg lifted`, title: `${volume.toLocaleString()} kg` },
          { icon: <Activity size={14} />, label: plural(exercises.length, 'exercise') },
        ]}
      />

      {exercises.length > 0 ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {exercises.map((ex, i) => {
            const facts = [
              ex.sets ? `${formatStat(ex.sets)} × ${formatStat(ex.reps ?? 0)}` : ex.reps ? `${formatStat(ex.reps)} reps` : null,
              ex.weight ? `${formatStat(ex.weight)} ${ex.weightUnit ?? 'kg'}` : null,
              ex.duration ? formatSeconds(ex.duration * 60) : null,
              ex.distance ? `${formatStat(ex.distance)} km` : null,
            ].filter(Boolean) as string[];
            return (
              <li key={`${log._id}-${i}`} className="flex min-h-10 items-center justify-between gap-3 rounded-sm bg-surface-2 px-3 py-1.5 text-sm">
                <span className="truncate font-medium text-text-1">{ex.name}</span>
                {ex.setRecords !== undefined ? (
                  <details className="min-w-0 text-sm text-text-2">
                    <summary className="min-h-11 cursor-pointer py-2">{ex.setRecords.filter(set => set.completed).length}/{ex.setRecords.length} sets completed</summary>
                    <ol className="space-y-1">
                      {ex.setRecords.map((set, setIndex) => <li key={set.id}>
                        Set {setIndex + 1}: {set.reps} × {set.weight} {set.weightUnit} · {set.completed ? 'completed' : 'not completed'}
                      </li>)}
                    </ol>
                  </details>
                ) : facts.length ? (
                  <span className="type-stat shrink-0 text-sm text-text-2">
                    {facts.map((f, j) => (
                      <span key={f} className={cx(j > 0 && 'ml-2.5')}>
                        {f}
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {log.notes ? <p className="prose-measure text-sm text-text-2">{log.notes}</p> : null}
    </Card>
  );
}

/* -------------------------------------------------------------- week chart */

type Metric = 'volume' | 'minutes' | 'sessions';
const METRICS: Array<{ key: Metric; label: string; unit: string }> = [
  { key: 'volume', label: 'Volume', unit: 'kg' },
  { key: 'minutes', label: 'Minutes', unit: 'min' },
  { key: 'sessions', label: 'Sessions', unit: '' },
];

function WeekChart({
  data,
  metric,
  onMetric,
  loading,
}: {
  data: Array<{ day: string; date: string; volume: number; minutes: number; sessions: number }>;
  metric: Metric;
  onMetric: (m: Metric) => void;
  loading: boolean;
}) {
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const empty = !loading && data.every((d) => d[metric] === 0);
  return (
    <Card padded={false} className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="type-heading text-lg text-text-1">Last 7 days</h2>
          <p className="text-xs text-text-2">{meta.key === 'volume' ? 'Completed sets plus legacy aggregates, converted to kg' : meta.key === 'minutes' ? 'Time trained per day' : 'Sessions per day'}</p>
        </div>
        <SegmentedControl
          aria-label="Chart metric"
          tabs={METRICS.map((m) => ({ key: m.key, label: m.label }))}
          value={metric}
          onChange={(k) => onMetric(k as Metric)}
        />
      </div>
      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : (
        <div className="relative h-52 w-full" role="img" aria-label={`${meta.label} for the last 7 days`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="28%">
              <CartesianGrid {...chartTheme.cartesianGrid} strokeDasharray="3 3" />
              <XAxis dataKey="day" {...chartTheme.axisProps} />
              <YAxis {...chartTheme.axisProps} allowDecimals={false} width={44} tickFormatter={(v: number) => formatStat(v, { compact: true })} />
              <Tooltip
                {...chartTheme.tooltip}
                formatter={(value) => [`${formatStat(Number(value ?? 0))}${meta.unit ? ` ${meta.unit}` : ''}`, meta.label]}
                labelFormatter={(_label, payload) => {
                  const iso = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
                  const d = iso ? parseISO(iso) : null;
                  return d && isValid(d) ? format(d, 'EEEE d MMM') : String(_label);
                }}
              />
              <Bar dataKey={metric} fill={VIZ.brand} radius={[6, 6, 0, 0]} maxBarSize={40} animationDuration={chartTheme.animationDuration} />
            </BarChart>
          </ResponsiveContainer>
          {empty ? (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-text-3">No sessions in the last 7 days</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function WorkoutLogs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const ownerId = useAuth(state => state.user?._id);
  const ownerToken = useAuth(state => state.verifiedToken);
  const [activeDraft, setActiveDraft] = useState<WorkoutDraft | null>(null);
  const [draftHandle, setDraftHandle] = useState<WorkoutDraftHandle | null>(null);
  const [initiallyStored, setInitiallyStored] = useState(false);
  const [recoverable, setRecoverable] = useState<WorkoutDraft | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WorkoutLog | null>(null);
  const [metric, setMetric] = useState<Metric>('volume');
  const compact = useIsCompact();
  const loadRecovery = useCallback(async () => {
    setStorageLoading(true);
    setRecoveryError('');
    setActiveDraft(null);
    setDraftHandle(null);
    setRecoverable(null);
    try {
      if (!ownerId || !ownerToken || tokenStore.get() !== ownerToken) throw new Error('Your account changed. Reload before recovering a workout.');
      await bindWorkoutDraftAccount(ownerId, ownerToken);
      const found = await loadWorkoutDraft(ownerId);
      setDraftHandle(found.handle);
      setRecoverable(found.draft);
      setRecoveryError(found.error ?? '');
    } catch (error) {
      setRecoveryError(errMsg(error, 'Could not open local workout storage.'));
    } finally { setStorageLoading(false); }
  }, [ownerId, ownerToken]);
  useEffect(() => { void loadRecovery(); }, [loadRecovery]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workout-logs', ownerId],
    queryFn: async (): Promise<LogsResponse> => {
      const { data } = await api.get<LogsResponse>('/workouts/logs', { params: { page: 1, limit: 100 } });
      return data;
    },
  });

  const logs = useMemo(
    () =>
      [...(data?.workouts ?? [])].sort((a, b) => (parseDate(b.date)?.getTime() ?? 0) - (parseDate(a.date)?.getTime() ?? 0)),
    [data],
  );

  const openEditor = (editing: WorkoutLog | null, seed: LogSeed | null) => {
    if (!ownerId || !draftHandle || storageLoading || recoveryError) { toast.error('Open local workout storage before starting a session.'); return; }
    if (recoverable) { toast.error('Resume or discard your local workout draft first.'); return; }
    const draft: WorkoutDraft = {
      version: 1, ownerId, draftId: crypto.randomUUID(), clientRequestId: crypto.randomUUID(),
      updatedAt: Date.now(), form: formFrom(editing ?? seed), editing, seed,
      timer: emptyRestTimer(), pending: null,
    };
    setInitiallyStored(false);
    setActiveDraft(draft);
  };
  const openNew = (next?: { key: string; value: LogSeed } | null) => openEditor(null, next?.value ?? null);

  // Deep links: ?log=1 opens the form; ?from=<workoutId> prefills it from a library workout.
  const wantsLog = params.get('log') === '1';
  const fromId = params.get('from');
  const fromWorkout = useQuery({
    queryKey: ['workout', fromId],
    queryFn: async (): Promise<SocialWorkout> => {
      const { data } = await api.get<{ data: SocialWorkout }>(`/workouts/workout/info/single-workout/${fromId}`);
      return data.data;
    },
    enabled: Boolean(fromId),
  });

  useEffect(() => {
    if (!wantsLog) return;
    if (storageLoading) return;
    if (fromId && fromWorkout.isPending) return; // wait for the prefill
    if (fromId && fromWorkout.isError) toast.error('Could not load that workout; starting an empty session.');
    openNew(fromId && fromWorkout.data ? { key: fromWorkout.data._id, value: seedFromWorkout(fromWorkout.data) } : null);
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('log');
        n.delete('from');
        return n;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog, fromId, fromWorkout.isPending, fromWorkout.isError, fromWorkout.data, storageLoading]);

  const remove = useMutation({
    mutationFn: async (log: WorkoutLog) => {
      await api.delete(`/workouts/logs/${log._id}`);
      return log._id;
    },
    onMutate: async (log) => {
      await qc.cancelQueries({ queryKey: ['workout-logs'] });
      const previous = qc.getQueryData<LogsResponse>(['workout-logs', ownerId]);
      if (previous) {
        qc.setQueryData<LogsResponse>(['workout-logs', ownerId], {
          ...previous,
          workouts: previous.workouts.filter((w) => w._id !== log._id),
          total: Math.max(0, previous.total - 1),
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['workout-logs', ownerId], ctx.previous);
      toast.error(errMsg(e, 'Could not delete session'));
    },
    onSuccess: () => toast.success('Session deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['workout-logs'] });
    },
  });

  /* ---- derived: 14-day buckets → this week, last week, streak */
  const { chartData, week, lastWeek, streak } = useMemo(() => {
    const end = startOfDay(new Date());
    const start = subDays(end, 13);
    const buckets = new Map<string, { volume: number; sessions: number; minutes: number }>();
    for (const day of eachDayOfInterval({ start, end })) buckets.set(dayKey(day), { volume: 0, sessions: 0, minutes: 0 });
    const trainedDays = new Set<string>();
    for (const log of logs) {
      const d = parseDate(log.date);
      if (!d) continue;
      const k = dayKey(d);
      trainedDays.add(k);
      const bucket = buckets.get(k);
      if (!bucket) continue;
      bucket.volume += sessionVolume(log);
      bucket.sessions += 1;
      bucket.minutes += Number(log.duration) || 0;
    }
    const rows = [...buckets.entries()].map(([key, value]) => ({
      day: format(parseISO(key), 'EEE'),
      date: key,
      ...value,
      volume: Math.round(value.volume),
    }));
    const sum = (list: typeof rows) =>
      list.reduce(
        (acc, r) => ({ volume: acc.volume + r.volume, sessions: acc.sessions + r.sessions, minutes: acc.minutes + r.minutes }),
        { volume: 0, sessions: 0, minutes: 0 },
      );
    const thisWeek = rows.slice(7);
    const prevWeek = rows.slice(0, 7);

    // Streak: consecutive trained days ending today (or yesterday, if today is still open).
    let cursor = trainedDays.has(dayKey(end)) ? end : subDays(end, 1);
    let run = 0;
    while (trainedDays.has(dayKey(cursor))) {
      run += 1;
      cursor = subDays(cursor, 1);
    }
    return { chartData: thisWeek, week: sum(thisWeek), lastWeek: sum(prevWeek), streak: run };
  }, [logs]);

  const lastTrained = logs.length ? parseDate(logs[0].date) : null;
  const daysSince = lastTrained ? differenceInCalendarDays(new Date(), lastTrained) : null;

  /* ---- history grouped by day */
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: WorkoutLog[] }> = [];
    for (const log of logs) {
      const d = parseDate(log.date);
      const key = d ? dayKey(d) : 'unknown';
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(log);
      else out.push({ key, label: d ? dayLabel(d) : 'Unknown date', items: [log] });
    }
    return out;
  }, [logs]);

  const delta = (now: number, before: number) => (before === 0 && now === 0 ? undefined : { value: now - before, label: 'vs last week' });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workout log"
        subtitle="Every session you have completed, with weekly volume."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => openNew()} disabled={storageLoading}>
            Log session
          </Button>
        }
        mobileActions={
          <IconButton label="Log session" onClick={() => openNew()} disabled={storageLoading}>
            <Plus size={24} />
          </IconButton>
        }
      />

      {storageLoading ? <p role="status" className="text-sm text-text-2">Checking local workout drafts…</p> : null}
      {recoveryError ? <Card className="space-y-3">
        <p role="alert" className="text-sm text-danger">{recoveryError}</p>
        <Button variant="secondary" onClick={() => { void loadRecovery(); }}>Retry draft storage</Button>
        <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>Discard local draft</Button>
      </Card> : null}
      {recoverable && recoverable.ownerId === ownerId && !activeDraft ? <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-text-1">Unsynced workout on this device</h2>
        <p className="text-sm text-text-2">Local only. Saved {new Date(recoverable.updatedAt).toLocaleString()}. Nothing will be published automatically.</p>
        {Date.now() - recoverable.updatedAt > 7 * 86400000 ? <p className="text-sm text-text-2">This draft is over 7 days old. Review its date, values and server history before saving.</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => { setInitiallyStored(true); setActiveDraft(recoverable); setRecoverable(null); }}>Resume workout draft</Button>
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>Discard local draft</Button>
        </div>
      </Card> : null}

      {isLoading ? (
        <StatGrid columns={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonTile key={i} />
          ))}
        </StatGrid>
      ) : (
        <StatGrid columns={4}>
          <StatTile
            label="Sessions this week"
            value={formatStat(week.sessions)}
            icon={<Dumbbell size={18} />}
            tone="brand"
            delta={delta(week.sessions, lastWeek.sessions)}
            spark={compact ? undefined : chartData.map((d) => d.sessions)}
          />
          <StatTile
            label="Time this week"
            value={formatStat(week.minutes)}
            unit="min"
            icon={<Clock size={18} />}
            delta={delta(week.minutes, lastWeek.minutes)}
            spark={compact ? undefined : chartData.map((d) => d.minutes)}
          />
          <StatTile
            label="Lifted this week"
            value={formatStat(week.volume, { compact: week.volume >= 10_000 })}
            unit="kg"
            icon={<Activity size={18} />}
            delta={delta(week.volume, lastWeek.volume)}
            spark={compact ? undefined : chartData.map((d) => d.volume)}
          />
          <StatTile
            label="Streak"
            value={formatStat(streak)}
            unit={streak === 1 ? 'day' : 'days'}
            icon={<Zap size={18} filled={streak > 0} />}
            tone={streak > 0 ? 'accent' : 'neutral'}
            hint={
              streak > 0
                ? 'Train today to keep it going'
                : daysSince == null
                  ? 'Log a session to start one'
                  : daysSince === 0
                    ? 'Starts with today’s session'
                    : `Last session ${plural(daysSince, 'day')} ago`
            }
          />
        </StatGrid>
      )}

      <WeekChart data={chartData} metric={metric} onMetric={setMetric} loading={isLoading} />

      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card space-y-3 p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
              <div className="grid gap-1.5 sm:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title="Could not load your sessions" onRetry={() => refetch()} />
      ) : logs.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          message="Log your first session and your weekly volume, time and streak start building here."
          action={{ label: 'Log session', onClick: () => openNew(), icon: <Plus size={18} /> }}
          secondaryAction={{ label: 'Start from a workout', to: '/workouts', variant: 'secondary' }}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`day-${g.key}`} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`day-${g.key}`} className="type-label text-text-2">
                  {g.label}
                </h2>
                <span className="text-xs text-text-3">{plural(g.items.length, 'session')}</span>
              </div>
              <div className="space-y-3">
                {g.items.map((log) => (
                  <SessionCard
                    key={log._id}
                    log={log}
                    onEdit={(l) => openEditor(l, null)}
                    onRepeat={(l) => openNew({ key: `repeat:${l._id}:${Date.now()}`, value: seedFromLog(l) })}
                    onDelete={setPendingDelete}
                  />
                ))}
              </div>
            </section>
          ))}
          {data?.hasNextPage ? (
            <p className="text-center text-xs text-text-3">Showing your latest {formatStat(logs.length)} of {formatStat(data.total)} sessions.</p>
          ) : null}
        </div>
      )}

      {activeDraft && draftHandle && activeDraft.ownerId === ownerId ? <LogModal key={activeDraft.draftId} initialDraft={activeDraft}
        handle={draftHandle} initiallyStored={initiallyStored} onReload={() => { void loadRecovery(); }}
        onClose={draft => {
          if (draft) { setActiveDraft(null); setRecoverable(draft); }
          else void loadRecovery();
        }} /> : null}
      <ConfirmDialog open={confirmDiscard} title="Discard local workout draft?"
        message="Only the local unsynced copy and timer will be removed. A workout already received by the server is not deleted."
        confirmLabel="Discard draft" destructive onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          if (!draftHandle) return;
          void removeWorkoutDraft(draftHandle).then(() => {
            setConfirmDiscard(false); void loadRecovery();
          }, error => { setRecoveryError(errMsg(error)); setConfirmDiscard(false); });
        }} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete session?"
        message={`${pendingDelete?.name || 'This session'} will be removed from your log and your weekly totals.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
