import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { eachDayOfInterval, format, isValid, parseISO, startOfDay, subDays } from 'date-fns';
import { api, errMsg } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Textarea,
  useToast,
} from './ui';
import { Dumbbell, Plus, Trash, Edit, Clock, TrendingUp } from './icons';

/* ------------------------------------------------------------------ types */

type LogExercise = {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  duration?: number;
  distance?: number;
  notes?: string;
};

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
};

type LogsResponse = {
  workouts: WorkoutLog[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

const TYPES = [
  'strength',
  'cardio',
  'yoga',
  'running',
  'hiit',
  'flexibility',
  'sports',
  'other',
] as const;

/* -------------------------------------------------------------- utilities */

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Total tonnage for a session: sum of sets x reps x weight per exercise. */
export function sessionVolume(log: WorkoutLog): number {
  return (log.exercises ?? []).reduce((sum, ex) => {
    const sets = Number(ex.sets) || 0;
    const reps = Number(ex.reps) || 0;
    const weight = Number(ex.weight) || 0;
    return sum + sets * reps * weight;
  }, 0);
}

const parseDate = (value?: string): Date | null => {
  if (!value) return null;
  const d = value.includes('T') ? parseISO(value) : new Date(value);
  return isValid(d) ? d : null;
};

/* ------------------------------------------------------------- form types */

type ExerciseDraft = {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  duration: string;
  notes: string;
};

const emptyExercise = (): ExerciseDraft => ({
  name: '',
  sets: '',
  reps: '',
  weight: '',
  duration: '',
  notes: '',
});

type FormState = {
  name: string;
  type: string;
  date: string;
  duration: string;
  caloriesBurned: string;
  notes: string;
  exercises: ExerciseDraft[];
};

const formFrom = (log?: WorkoutLog | null): FormState => {
  const d = parseDate(log?.date) ?? new Date();
  return {
    name: log?.name ?? '',
    type: log?.type ?? 'strength',
    date: format(d, "yyyy-MM-dd'T'HH:mm"),
    duration: log?.duration != null ? String(log.duration) : '',
    caloriesBurned: log?.caloriesBurned != null ? String(log.caloriesBurned) : '',
    notes: log?.notes ?? '',
    exercises:
      log?.exercises?.length
        ? log.exercises.map((e) => ({
            name: e.name ?? '',
            sets: e.sets != null ? String(e.sets) : '',
            reps: e.reps != null ? String(e.reps) : '',
            weight: e.weight != null ? String(e.weight) : '',
            duration: e.duration != null ? String(e.duration) : '',
            notes: e.notes ?? '',
          }))
        : [emptyExercise()],
  };
};

/* --------------------------------------------------------------- log modal */

function LogModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: WorkoutLog | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => formFrom(editing));
  const [seedKey, setSeedKey] = useState('');

  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    setForm(formFrom(editing));
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const updateExercise = (i: number, patch: Partial<ExerciseDraft>) =>
    set(
      'exercises',
      form.exercises.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );

  const save = useMutation({
    mutationFn: async () => {
      const exercises: LogExercise[] = form.exercises
        .filter((e) => e.name.trim())
        .map((e) => ({
          name: e.name.trim(),
          sets: num(e.sets),
          reps: num(e.reps),
          weight: num(e.weight),
          duration: num(e.duration),
          notes: e.notes.trim() || undefined,
        }));
      if (!exercises.length) throw new Error('At least one exercise is required');
      const parsed = new Date(form.date);
      if (!isValid(parsed)) throw new Error('Enter a valid date');

      const payload = {
        name: form.name.trim() || 'Workout',
        type: form.type,
        date: parsed.toISOString(),
        duration: num(form.duration) ?? 0,
        caloriesBurned: num(form.caloriesBurned) ?? 0,
        notes: form.notes.trim() || undefined,
        exercises,
        isCompleted: true,
      };

      if (editing) {
        const { data } = await api.patch(`/workouts/logs/${editing._id}`, payload);
        return data;
      }
      const { data } = await api.post('/workouts/logs', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'Session updated' : 'Session logged');
      qc.invalidateQueries({ queryKey: ['workout-logs'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save session')),
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit session' : 'Log a session'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          placeholder="Session name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Type</span>
            <select
              className="input-base"
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Date</span>
            <Input
              type="datetime-local"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </label>
          <Input
            type="number"
            min={0}
            max={1440}
            placeholder="Duration (min)"
            value={form.duration}
            onChange={(e) => set('duration', e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder="Calories burned"
            value={form.caloriesBurned}
            onChange={(e) => set('caloriesBurned', e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold">Exercises</p>
          {form.exercises.map((row, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--color-line)] p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Exercise name"
                  value={row.name}
                  onChange={(e) => updateExercise(i, { name: e.target.value })}
                />
                {form.exercises.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove exercise ${i + 1}`}
                    className="btn btn-ghost px-2"
                    onClick={() =>
                      set(
                        'exercises',
                        form.exercises.filter((_, idx) => idx !== i),
                      )
                    }
                  >
                    <Trash size={16} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  type="number"
                  min={0}
                  placeholder="Sets"
                  value={row.sets}
                  onChange={(e) => updateExercise(i, { sets: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Reps"
                  value={row.reps}
                  onChange={(e) => updateExercise(i, { reps: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder="Weight (kg)"
                  value={row.weight}
                  onChange={(e) => updateExercise(i, { weight: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Minutes"
                  value={row.duration}
                  onChange={(e) => updateExercise(i, { duration: e.target.value })}
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() => set('exercises', [...form.exercises, emptyExercise()])}
          >
            <Plus size={16} /> Add exercise
          </Button>
        </div>

        <Textarea
          rows={3}
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {editing ? 'Save changes' : 'Log session'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------- page */

export default function WorkoutLogs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<WorkoutLog | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkoutLog | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workout-logs'],
    queryFn: async (): Promise<LogsResponse> => {
      const { data } = await api.get<LogsResponse>('/workouts/logs', {
        params: { page: 1, limit: 100 },
      });
      return data;
    },
  });

  const logs = data?.workouts ?? [];

  const remove = useMutation({
    mutationFn: async (log: WorkoutLog) => {
      await api.delete(`/workouts/logs/${log._id}`);
      return log._id;
    },
    onMutate: async (log) => {
      await qc.cancelQueries({ queryKey: ['workout-logs'] });
      const previous = qc.getQueryData<LogsResponse>(['workout-logs']);
      if (previous) {
        qc.setQueryData<LogsResponse>(['workout-logs'], {
          ...previous,
          workouts: previous.workouts.filter((w) => w._id !== log._id),
          total: Math.max(0, previous.total - 1),
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['workout-logs'], ctx.previous);
      toast.error(errMsg(e, 'Could not delete session'));
    },
    onSuccess: () => toast.success('Session deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['workout-logs'] });
    },
  });

  const chartData = useMemo(() => {
    const end = startOfDay(new Date());
    const start = subDays(end, 6);
    const buckets = new Map<string, { volume: number; sessions: number; minutes: number }>();
    for (const day of eachDayOfInterval({ start, end })) {
      buckets.set(format(day, 'yyyy-MM-dd'), { volume: 0, sessions: 0, minutes: 0 });
    }
    for (const log of logs) {
      const d = parseDate(log.date);
      if (!d) continue;
      const key = format(startOfDay(d), 'yyyy-MM-dd');
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.volume += sessionVolume(log);
      bucket.sessions += 1;
      bucket.minutes += Number(log.duration) || 0;
    }
    return [...buckets.entries()].map(([key, value]) => ({
      day: format(parseISO(key), 'EEE'),
      date: key,
      ...value,
      volume: Math.round(value.volume),
    }));
  }, [logs]);

  const weekTotals = useMemo(
    () =>
      chartData.reduce(
        (acc, d) => ({
          volume: acc.volume + d.volume,
          sessions: acc.sessions + d.sessions,
          minutes: acc.minutes + d.minutes,
        }),
        { volume: 0, sessions: 0, minutes: 0 },
      ),
    [chartData],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workout log</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Every session you completed, with volume tracking.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setModal(true);
          }}
        >
          <Plus size={16} /> Log session
        </Button>
      </header>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 font-semibold">
            <TrendingUp size={18} /> Weekly volume
          </h2>
          <div className="flex gap-4 text-xs text-[var(--color-muted)]">
            <span>{weekTotals.sessions} sessions</span>
            <span>{weekTotals.minutes} min</span>
            <span>{weekTotals.volume.toLocaleString()} kg lifted</span>
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262631" vertical={false} />
                <XAxis dataKey="day" stroke="#9aa0ae" fontSize={12} tickLine={false} />
                <YAxis stroke="#9aa0ae" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#17171f',
                    border: '1px solid #262631',
                    borderRadius: 12,
                    color: '#f4f4f6',
                  }}
                  formatter={(value) => [`${Number(value ?? 0).toLocaleString()} kg`, 'Volume']}
                />
                <Bar dataKey="volume" fill="#7c5cff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message={errMsg(error, 'Could not load sessions')} onRetry={() => refetch()} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<Dumbbell size={28} />}
          title="No sessions logged"
          description="Log your first training session to start building your history."
          action={
            <Button variant="primary" onClick={() => setModal(true)}>
              <Plus size={16} /> Log session
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {logs.map((log) => {
            const d = parseDate(log.date);
            return (
              <li key={log._id} className="card space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{log.name || 'Workout'}</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {d ? format(d, 'EEE, d MMM yyyy · HH:mm') : 'Unknown date'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {log.type && <Badge>{log.type}</Badge>}
                    <button
                      type="button"
                      aria-label="Edit session"
                      className="btn btn-ghost px-2"
                      onClick={() => {
                        setEditing(log);
                        setModal(true);
                      }}
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete session"
                      className="btn btn-ghost px-2"
                      onClick={() => setPendingDelete(log)}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
                  {log.duration ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} /> {log.duration} min
                    </span>
                  ) : null}
                  {log.caloriesBurned ? <span>{log.caloriesBurned} cal</span> : null}
                  <span>{sessionVolume(log).toLocaleString()} kg volume</span>
                  <span>{log.exercises?.length ?? 0} exercises</span>
                </div>

                <ul className="grid gap-1 sm:grid-cols-2">
                  {(log.exercises ?? []).map((ex, i) => (
                    <li
                      key={`${log._id}-${i}`}
                      className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{ex.name}</span>{' '}
                      <span className="text-[var(--color-muted)]">
                        {[
                          ex.sets ? `${ex.sets}×${ex.reps ?? 0}` : null,
                          ex.weight ? `${ex.weight} kg` : null,
                          ex.duration ? `${ex.duration} min` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>

                {log.notes && <p className="text-sm text-[var(--color-muted)]">{log.notes}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <LogModal
        open={modal}
        editing={editing}
        onClose={() => {
          setModal(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete session"
        message="This workout log will be permanently removed."
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
