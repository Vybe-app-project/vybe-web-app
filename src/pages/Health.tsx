import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg } from '../lib/api';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Tabs,
  useToast,
} from './ui';
import { Activity, TrendingUp, Plus, Trash, Calendar } from './icons';

/* ------------------------------------------------------------------ types */

type TimeWindow = 'week' | 'month' | 'year';

type DailyNutrition = {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: number;
};

type WeeklyProgress = {
  date: string;
  calories: number;
  duration: number;
  workouts: number;
};

type HealthAnalytics = {
  timeWindow: TimeWindow;
  workoutStats: {
    totalWorkouts: number;
    totalCalories: number;
    totalDuration: number;
    avgCalories: number;
    avgDuration: number;
    workoutTypes: Record<string, number>;
    weeklyProgress: WeeklyProgress[];
  };
  nutritionStats: {
    totalMeals: number;
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    avgCalories: number;
    mealTypes: Record<string, number>;
    dailyNutrition: DailyNutrition[];
  };
  healthMetrics: {
    steps: number;
    averageDailySteps: number;
    weight: number | null;
    height: number | null;
    bmi: number | null;
    manualEntryDays: number;
    dailySteps: { date: string; steps: number }[];
    source: string;
    lastSync: string | null;
  };
  streaks: { workout: number; nutrition: number; activity: number; longestStreak: number };
  fitnessScore: number;
};

type WorkoutAnalytics = HealthAnalytics['workoutStats'] & {
  timeWindow: TimeWindow;
  exercises: Record<string, { count: number; totalDuration: number; totalCalories: number }>;
  weeklyTrends: { startDate: string; endDate: string; workouts: number; calories: number; duration: number }[];
  personalBests: { calories: number; duration: number; frequency: number };
};

type NutritionAnalytics = HealthAnalytics['nutritionStats'] & {
  timeWindow: TimeWindow;
  nutritionBalance: { protein: number; carbs: number; fat: number };
  topFoods: Record<string, { count: number; totalCalories: number; avgCalories: number }>;
};

type DailyEntry = {
  date: string;
  steps?: number;
  weightKg?: number;
  source?: string;
  updatedAt?: string;
};

const WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

/** The API expects a signed offset where positive means east of UTC. */
export const timezoneOffsetMinutes = () => new Date().getTimezoneOffset() * -1;

const chartTooltipStyle = {
  background: '#17171f',
  border: '1px solid #262631',
  borderRadius: 12,
  color: '#f4f4f6',
};

const shortDate = (value: string) => {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'd MMM') : value;
};

/* -------------------------------------------------------------- entry form */

function EntryModal({
  open,
  entry,
  onClose,
}: {
  open: boolean;
  entry: DailyEntry | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [steps, setSteps] = useState('');
  const [weight, setWeight] = useState('');
  const [seedKey, setSeedKey] = useState('');

  const seed = `${open ? 'open' : 'closed'}:${entry?.date ?? 'new'}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    const parsed = entry?.date ? parseISO(entry.date) : null;
    setDate(parsed && isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
    setSteps(entry?.steps != null ? String(entry.steps) : '');
    setWeight(entry?.weightKg != null ? String(entry.weightKg) : '');
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!steps.trim() && !weight.trim()) {
        throw new Error('Enter steps, weight, or both');
      }
      const body: Record<string, unknown> = {
        date,
        timezoneOffsetMinutes: timezoneOffsetMinutes(),
      };
      if (steps.trim()) body.steps = Number(steps);
      if (weight.trim()) body.weightKg = Number(weight);
      const { data } = await api.put('/health/entries', body);
      return data;
    },
    onSuccess: () => {
      toast.success('Entry saved');
      qc.invalidateQueries({ queryKey: ['health'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save entry')),
  });

  return (
    <Modal open={open} onClose={onClose} title={entry ? 'Edit daily entry' : 'Add daily entry'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="space-y-1">
          <span className="text-xs text-[var(--color-muted)]">Date</span>
          <Input
            type="date"
            value={date}
            disabled={Boolean(entry)}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Steps</span>
            <Input
              type="number"
              min={0}
              max={200000}
              placeholder="e.g. 8500"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Weight (kg)</span>
            <Input
              type="number"
              min={20}
              max={500}
              step="0.1"
              placeholder="e.g. 74.5"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save entry
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- stat card */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {hint && <p className="text-[11px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function Health() {
  const qc = useQueryClient();
  const toast = useToast();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('week');
  const [entryModal, setEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DailyEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DailyEntry | null>(null);

  const params = { timeWindow, timezoneOffsetMinutes: timezoneOffsetMinutes() };

  const overview = useQuery({
    queryKey: ['health', 'analytics', timeWindow],
    queryFn: async (): Promise<HealthAnalytics> => {
      const { data } = await api.get<{ analytics: HealthAnalytics }>('/health/analytics', {
        params,
      });
      return data.analytics;
    },
  });

  const workouts = useQuery({
    queryKey: ['health', 'workout-analytics', timeWindow],
    queryFn: async (): Promise<WorkoutAnalytics> => {
      const { data } = await api.get<{ analytics: WorkoutAnalytics }>(
        '/health/workout-analytics',
        { params },
      );
      return data.analytics;
    },
  });

  const nutrition = useQuery({
    queryKey: ['health', 'nutrition-analytics', timeWindow],
    queryFn: async (): Promise<NutritionAnalytics> => {
      const { data } = await api.get<{ analytics: NutritionAnalytics }>(
        '/health/nutrition-analytics',
        { params },
      );
      return data.analytics;
    },
  });

  const entries = useQuery({
    queryKey: ['health', 'entries'],
    queryFn: async (): Promise<DailyEntry[]> => {
      const { data } = await api.get<{ entries: DailyEntry[] }>('/health/entries', {
        params: { limit: 60 },
      });
      return data.entries;
    },
  });

  const removeEntry = useMutation({
    mutationFn: async (entry: DailyEntry) => {
      const day = parseISO(entry.date);
      const key = isValid(day) ? format(day, 'yyyy-MM-dd') : entry.date;
      await api.delete(`/health/entries/${key}`, {
        params: { timezoneOffsetMinutes: timezoneOffsetMinutes() },
      });
      return entry.date;
    },
    onMutate: async (entry) => {
      await qc.cancelQueries({ queryKey: ['health', 'entries'] });
      const previous = qc.getQueryData<DailyEntry[]>(['health', 'entries']);
      qc.setQueryData<DailyEntry[]>(['health', 'entries'], (old) =>
        (old ?? []).filter((e) => e.date !== entry.date),
      );
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['health', 'entries'], ctx.previous);
      toast.error(errMsg(e, 'Could not delete entry'));
    },
    onSuccess: () => toast.success('Entry deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['health'] });
    },
  });

  const weightSeries = useMemo(() => {
    const rows = (entries.data ?? [])
      .filter((e) => typeof e.weightKg === 'number')
      .map((e) => {
        const d = parseISO(e.date);
        return {
          date: isValid(d) ? format(d, 'yyyy-MM-dd') : e.date,
          label: isValid(d) ? format(d, 'd MMM') : e.date,
          weight: e.weightKg as number,
        };
      });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [entries.data]);

  const calorieSeries = useMemo(
    () =>
      (nutrition.data?.dailyNutrition ?? [])
        .map((d) => ({ ...d, label: shortDate(d.date) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [nutrition.data],
  );

  const volumeSeries = useMemo(
    () =>
      (workouts.data?.weeklyProgress ?? [])
        .map((d) => ({ ...d, label: shortDate(d.date) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [workouts.data],
  );

  const metrics = overview.data?.healthMetrics;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Health analytics</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Training, nutrition and body metrics in one view.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditingEntry(null);
            setEntryModal(true);
          }}
        >
          <Plus size={16} /> Daily entry
        </Button>
      </header>

      <Tabs
        tabs={WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
        value={timeWindow}
        onChange={(k: string) => setTimeWindow(k as TimeWindow)}
      />

      {overview.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : overview.isError ? (
        <ErrorState
          message={errMsg(overview.error, 'Could not load health analytics')}
          onRetry={() => overview.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Fitness score"
              value={String(overview.data?.fitnessScore ?? 0)}
              hint="0–100 composite"
            />
            <Stat
              label="Workouts"
              value={String(overview.data?.workoutStats.totalWorkouts ?? 0)}
              hint={`${overview.data?.workoutStats.totalDuration ?? 0} min total`}
            />
            <Stat
              label="Calories eaten"
              value={`${Math.round(overview.data?.nutritionStats.totalCalories ?? 0)}`}
              hint={`${overview.data?.nutritionStats.totalMeals ?? 0} meals`}
            />
            <Stat
              label="Avg daily steps"
              value={`${Math.round(metrics?.averageDailySteps ?? 0)}`}
              hint={`${metrics?.manualEntryDays ?? 0} logged days`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Weight"
              value={metrics?.weight != null ? `${metrics.weight} kg` : '—'}
              hint={metrics?.bmi != null ? `BMI ${metrics.bmi}` : undefined}
            />
            <Stat label="Workout streak" value={`${overview.data?.streaks.workout ?? 0} d`} />
            <Stat label="Nutrition streak" value={`${overview.data?.streaks.nutrition ?? 0} d`} />
            <Stat label="Longest streak" value={`${overview.data?.streaks.longestStreak ?? 0} d`} />
          </div>
        </>
      )}

      <Card className="p-4">
        <h2 className="mb-3 inline-flex items-center gap-2 font-semibold">
          <TrendingUp size={18} /> Weight trend
        </h2>
        {entries.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : weightSeries.length < 2 ? (
          <EmptyState
            icon={<Calendar size={24} />}
            title="Not enough weight data"
            description="Log your weight on at least two days to see a trend."
            action={
              <Button variant="ghost" onClick={() => setEntryModal(true)}>
                <Plus size={16} /> Add entry
              </Button>
            }
          />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weightSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262631" vertical={false} />
                <XAxis dataKey="label" stroke="#9aa0ae" fontSize={12} tickLine={false} />
                <YAxis
                  stroke="#9aa0ae"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  domain={['dataMin - 2', 'dataMax + 2']}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v) => [`${Number(v ?? 0)} kg`, 'Weight']}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 inline-flex items-center gap-2 font-semibold">
          <Activity size={18} /> Calories consumed
        </h2>
        {nutrition.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : nutrition.isError ? (
          <ErrorState
            message={errMsg(nutrition.error, 'Could not load nutrition analytics')}
            onRetry={() => nutrition.refetch()}
          />
        ) : calorieSeries.length === 0 ? (
          <EmptyState title="No nutrition data" description="Log meals to populate this chart." />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={calorieSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="caloriesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262631" vertical={false} />
                <XAxis dataKey="label" stroke="#9aa0ae" fontSize={12} tickLine={false} />
                <YAxis stroke="#9aa0ae" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v) => [`${Math.round(Number(v ?? 0))} kcal`, 'Calories']}
                />
                <Area
                  type="monotone"
                  dataKey="calories"
                  stroke="#7c5cff"
                  strokeWidth={2}
                  fill="url(#caloriesFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {nutrition.data && (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Macro balance — protein {nutrition.data.nutritionBalance.protein}% · carbs{' '}
            {nutrition.data.nutritionBalance.carbs}% · fat {nutrition.data.nutritionBalance.fat}%
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 inline-flex items-center gap-2 font-semibold">
          <Activity size={18} /> Workout volume
        </h2>
        {workouts.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : workouts.isError ? (
          <ErrorState
            message={errMsg(workouts.error, 'Could not load workout analytics')}
            onRetry={() => workouts.refetch()}
          />
        ) : volumeSeries.length === 0 ? (
          <EmptyState title="No workout data" description="Log sessions to populate this chart." />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262631" vertical={false} />
                <XAxis dataKey="label" stroke="#9aa0ae" fontSize={12} tickLine={false} />
                <YAxis stroke="#9aa0ae" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v, name) => [
                    name === 'duration' ? `${Number(v ?? 0)} min` : `${Number(v ?? 0)} kcal`,
                    name === 'duration' ? 'Duration' : 'Calories',
                  ]}
                />
                <Bar dataKey="duration" fill="#7c5cff" radius={[6, 6, 0, 0]} />
                <Bar dataKey="calories" fill="#22d3ee" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {workouts.data && (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Personal bests — {Math.round(workouts.data.personalBests.calories)} kcal ·{' '}
            {Math.round(workouts.data.personalBests.duration)} min ·{' '}
            {workouts.data.personalBests.frequency} sessions/week
          </p>
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Manual entries</h2>
        {entries.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : entries.isError ? (
          <ErrorState
            message={errMsg(entries.error, 'Could not load entries')}
            onRetry={() => entries.refetch()}
          />
        ) : (entries.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Calendar size={24} />}
            title="No entries yet"
            description="Track steps and weight day by day."
            action={
              <Button variant="primary" onClick={() => setEntryModal(true)}>
                <Plus size={16} /> Add entry
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {(entries.data ?? []).map((entry) => {
              const d = parseISO(entry.date);
              return (
                <li key={entry.date} className="card flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {isValid(d) ? format(d, 'EEE, d MMM yyyy') : entry.date}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {[
                        entry.steps != null ? `${entry.steps.toLocaleString()} steps` : null,
                        entry.weightKg != null ? `${entry.weightKg} kg` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No values'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingEntry(entry);
                        setEntryModal(true);
                      }}
                    >
                      Edit
                    </Button>
                    <button
                      type="button"
                      aria-label="Delete entry"
                      className="btn btn-ghost px-2"
                      onClick={() => setPendingDelete(entry)}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <EntryModal
        open={entryModal}
        entry={editingEntry}
        onClose={() => {
          setEntryModal(false);
          setEditingEntry(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete entry"
        message="This daily health entry will be removed."
        confirmLabel="Delete"
        loading={removeEntry.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removeEntry.mutate(pendingDelete)}
      />
    </div>
  );
}
