import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
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
import { api, errMsg } from '../lib/api';
import { useFeature } from '../lib/capabilities';
import { formatSeconds } from '../lib/duration';
import { STARTER_SEED_KEY, firstWeekStrings, pickStarterTemplate, starterLogSeed } from '../lib/firstWeek';
import {
  Badge,
  Button,
  Callout,
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
import { TrendingUp } from './icons';
import { ButtonLink } from './ui';
import {
  CATEGORY_OPTIONS,
  ExerciseRows,
  MetaList,
  emptyExercise,
  exerciseDraftFrom,
  fetchPremade,
  toExercisePayload,
  type ExerciseDraft,
  type SocialWorkout,
} from './Workouts';

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

/** A session seeded from a workout or a previous log; no `_id` means it will be created. */
type LogSeed = Partial<Omit<WorkoutLog, '_id'>>;

/* -------------------------------------------------------------- utilities */

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Total tonnage for a session: sum of sets x reps x weight per exercise. */
export function sessionVolume(log: Pick<WorkoutLog, 'exercises'>): number {
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
  exercises: ExerciseDraft[];
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
    exercises: log?.exercises?.length ? log.exercises.map(exerciseDraftFrom) : [emptyExercise()],
  };
};

/**
 * Seed a fresh session from a library workout ("Log this workout"). Exercise
 * durations stay in seconds on both sides; the session `duration` is minutes.
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
    duration: e.duration,
    notes: e.notes,
  })),
});

/** Seed a fresh session from a past one ("Log again"): same content, dated now. */
const seedFromLog = (log: WorkoutLog): LogSeed => ({
  name: log.name,
  type: log.type,
  duration: log.duration,
  caloriesBurned: log.caloriesBurned,
  notes: log.notes,
  exercises: log.exercises,
});

/* --------------------------------------------------------------- log modal */

function LogModal({
  open,
  editing,
  seed,
  seedKey,
  onClose,
}: {
  open: boolean;
  /** Existing log → PATCH. */
  editing: WorkoutLog | null;
  /** Prefill for a new log → POST. */
  seed?: LogSeed | null;
  /** Changes whenever `seed` changes so the form re-seeds. */
  seedKey?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => formFrom(editing ?? seed));
  const [formKey, setFormKey] = useState('');
  const [errors, setErrors] = useState<{ date?: string; exercises?: string }>({});

  const key = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}:${seedKey ?? ''}`;
  if (key !== formKey) {
    setFormKey(key);
    setForm(formFrom(editing ?? seed));
    setErrors({});
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const exercises: LogExercise[] = form.exercises.map(toExercisePayload).filter((e) => e.name.length > 0);
      const parsed = new Date(form.date);
      const next: typeof errors = {};
      if (!exercises.length) next.exercises = 'Add at least one exercise with a name.';
      if (!isValid(parsed)) next.date = 'Enter a valid date and time.';
      setErrors(next);
      if (next.exercises || next.date) throw Object.assign(new Error('validation'), { silent: true });

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
      toast.success(editing ? 'Session saved' : 'Session logged');
      qc.invalidateQueries({ queryKey: ['workout-logs'] });
      qc.invalidateQueries({ queryKey: ['workout-progress'] });
      onClose();
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      toast.error(errMsg(e, 'Could not save session'));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit session' : 'Log a session'}
      description={
        editing
          ? undefined
          : seedKey === STARTER_SEED_KEY
            ? firstWeekStrings.starter.logDescription
            : seed?.name
              ? `Based on ${seed.name}. Adjust what you actually did.`
              : 'What you did, when, and how much you moved.'
      }
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {editing ? 'Save changes' : 'Log session'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
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
            onChange={(e) => set('duration', e.target.value)}
          />
          <Input
            label="Calories (kcal)"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="350"
            value={form.caloriesBurned}
            onChange={(e) => set('caloriesBurned', e.target.value)}
          />
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

        <Textarea
          label="Notes"
          hint="Optional. Energy, sleep, anything worth remembering."
          rows={2}
          autoGrow
          maxRows={6}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </form>
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
              ex.weight ? `${formatStat(ex.weight)} kg` : null,
              ex.duration ? formatSeconds(ex.duration) : null,
              ex.distance ? `${formatStat(ex.distance)} km` : null,
            ].filter(Boolean) as string[];
            return (
              <li key={`${log._id}-${i}`} className="flex min-h-10 items-center justify-between gap-3 rounded-sm bg-surface-2 px-3 py-1.5 text-sm">
                <span className="truncate font-medium text-text-1">{ex.name}</span>
                {facts.length ? (
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
          <p className="text-xs text-text-2">{meta.key === 'volume' ? 'Sets × reps × weight, per day' : meta.key === 'minutes' ? 'Time trained per day' : 'Sessions per day'}</p>
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
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<WorkoutLog | null>(null);
  const [seed, setSeed] = useState<{ key: string; value: LogSeed } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkoutLog | null>(null);
  const [metric, setMetric] = useState<Metric>('volume');
  const compact = useIsCompact();
  const { hash } = useLocation();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workout-logs'],
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

  const openNew = (next?: { key: string; value: LogSeed } | null) => {
    setEditing(null);
    setSeed(next ?? null);
    setModal(true);
  };

  // Deep links: ?log=1 opens the form; ?from=<workoutId> prefills it from a library workout;
  // ?starter=1 (the first-week card's "Start here") prefills it with the starter session from
  // the premade catalogue, or with the built-in four-move fallback when the catalogue lacks it.
  const wantsLog = params.get('log') === '1';
  const fromId = params.get('from');
  const wantsStarter = wantsLog && params.get('starter') === '1';
  const fromWorkout = useQuery({
    queryKey: ['workout', fromId],
    queryFn: async (): Promise<SocialWorkout> => {
      const { data } = await api.get<{ data: SocialWorkout }>(`/workouts/workout/info/single-workout/${fromId}`);
      return data.data;
    },
    enabled: Boolean(fromId),
  });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: wantsStarter, retry: false });

  useEffect(() => {
    if (!wantsLog) return;
    if (fromId && fromWorkout.isPending) return; // wait for the prefill
    if (wantsStarter && premade.isPending) return; // wait for the catalogue; a failure falls back to the constant
    if (fromId && fromWorkout.isError) toast.error('Could not load that workout; starting an empty session.');
    if (wantsStarter) openNew({ key: STARTER_SEED_KEY, value: starterLogSeed(premade.isSuccess ? pickStarterTemplate(premade.data) : null) });
    else openNew(fromId && fromWorkout.data ? { key: fromWorkout.data._id, value: seedFromWorkout(fromWorkout.data) } : null);
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('log');
        n.delete('from');
        n.delete('starter');
        return n;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog, fromId, fromWorkout.isPending, fromWorkout.isError, fromWorkout.data, wantsStarter, premade.isPending, premade.isSuccess, premade.data]);

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
      // The progress hub's tiles, calendar, movements and records count this session too.
      qc.invalidateQueries({ queryKey: ['workout-progress'] });
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

  // A calendar cell on the progress hub links to /workouts/logs#day-<yyyy-MM-dd>. This list holds the
  // latest 100 sessions only, so a day past that window (or one emptied since) has no heading to land on;
  // say so instead of leaving the member at the top of the log wondering.
  const missingDay = useMemo(() => {
    const match = /^#day-(\d{4}-\d{2}-\d{2})$/.exec(hash);
    if (!match || !data || !logs.length || groups.some((g) => g.key === match[1])) return null;
    const day = parseISO(match[1]);
    if (!isValid(day)) return null;
    const oldest = parseDate(logs[logs.length - 1].date);
    const beyondWindow = Boolean(data.hasNextPage) && !!oldest && day < startOfDay(oldest);
    return { label: format(day, 'EEEE d MMMM yyyy'), beyondWindow };
  }, [hash, data, logs, groups]);

  // Land on that day once the list has rendered.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!/^day-\d{4}-\d{2}-\d{2}$/.test(id) || !groups.length) return;
    const t = window.setTimeout(() => {
      const heading = document.getElementById(id);
      const section = heading?.closest('section') as HTMLElement | null;
      if (!section) return;
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
      section.setAttribute('tabindex', '-1');
      section.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [hash, groups]);

  const delta = (now: number, before: number) => (before === 0 && now === 0 ? undefined : { value: now - before, label: 'vs last week' });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workout log"
        subtitle="Every session you have completed, with weekly volume."
        actions={
          <>
            <ButtonLink to="/workouts/progress" variant="secondary" icon={<TrendingUp size={18} />}>
                View progress
              </ButtonLink>
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => openNew()}>
              Log session
            </Button>
          </>
        }
        mobileActions={
          <IconButton label="Log session" onClick={() => openNew()}>
            <Plus size={24} />
          </IconButton>
        }
      />

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
          {missingDay ? (
            <Callout tone="info">
              <p role="status" data-testid="log-day-missing">
                {missingDay.beyondWindow
                  ? `${missingDay.label} is further back than the latest ${formatStat(logs.length)} sessions shown here.`
                  : `No sessions on ${missingDay.label} in this log.`}
              </p>
            </Callout>
          ) : null}
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
                    onEdit={(l) => {
                      setSeed(null);
                      setEditing(l);
                      setModal(true);
                    }}
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

      <LogModal
        open={modal}
        editing={editing}
        seed={seed?.value}
        seedKey={seed?.key}
        onClose={() => {
          setModal(false);
          setEditing(null);
          setSeed(null);
        }}
      />
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
