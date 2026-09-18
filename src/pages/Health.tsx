import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { format, isValid, parseISO, subDays } from 'date-fns';
import { api, errMsg } from '../lib/api';
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Section,
  Skeleton,
  StatGrid,
  StatTile,
  Tabs,
  VIZ,
  chartTheme,
  formatStat,
  useIsCompact,
  useToast,
} from './ui';
import { Activity, Dumbbell, Edit, Flame, Footprints, Plate, Plus, Scale, Trash, Trophy } from './icons';

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

// How much manual daily-entry history the Health page requests. The API
// caps a range at 365 days; 60 covers the charts without a large payload.
const ENTRY_HISTORY_DAYS = 60;

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

const WINDOW_NOUN: Record<TimeWindow, string> = { week: 'this week', month: 'this month', year: 'this year' };

/** The API expects a signed offset where positive means east of UTC. */
export const timezoneOffsetMinutes = () => new Date().getTimezoneOffset() * -1;

const shortDate = (value: string) => {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'd MMM') : value;
};

const dayUnit = (n: number) => (n === 1 ? 'day' : 'days');

const entryDateLabel = (value: string) => {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'EEEE d MMMM') : value;
};

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -12 };

/* -------------------------------------------------------------- entry form */

function EntryModal({ open, entry, onClose }: { open: boolean; entry: DailyEntry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [steps, setSteps] = useState('');
  const [weight, setWeight] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [seedKey, setSeedKey] = useState('');

  const seed = `${open ? 'open' : 'closed'}:${entry?.date ?? 'new'}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    const parsed = entry?.date ? parseISO(entry.date) : null;
    setDate(parsed && isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
    setSteps(entry?.steps != null ? String(entry.steps) : '');
    setWeight(entry?.weightKg != null ? String(entry.weightKg) : '');
    setFormError(null);
  }

  const save = useMutation({
    mutationFn: async () => {
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
      toast.success(entry ? 'Entry updated' : 'Entry saved');
      qc.invalidateQueries({ queryKey: ['health'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save entry')),
  });

  const submit = () => {
    if (!steps.trim() && !weight.trim()) {
      setFormError('Enter steps, weight, or both.');
      return;
    }
    if (steps.trim() && (Number(steps) < 0 || Number(steps) > 200000)) {
      setFormError('Steps must be between 0 and 200,000.');
      return;
    }
    if (weight.trim() && (Number(weight) < 20 || Number(weight) > 500)) {
      setFormError('Weight must be between 20 and 500 kg.');
      return;
    }
    setFormError(null);
    save.mutate();
  };

  const formId = 'health-entry-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Edit daily entry' : 'Log weight or steps'}
      description="One entry per day. Saving again for the same date replaces it."
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {entry ? 'Save changes' : 'Save entry'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <DateField
          label="Date"
          value={date}
          max={format(new Date(), 'yyyy-MM-dd')}
          disabled={Boolean(entry)}
          hint={entry ? 'The date of an existing entry can’t be changed.' : undefined}
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Steps"
            type="number"
            inputMode="numeric"
            min={0}
            max={200000}
            placeholder="8,500"
            value={steps}
            onChange={(e) => {
              setSteps(e.target.value);
              setFormError(null);
            }}
          />
          <Input
            label="Weight"
            type="number"
            inputMode="decimal"
            min={20}
            max={500}
            step="0.1"
            placeholder="74.5"
            trailing={<span className="text-xs font-semibold">kg</span>}
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value);
              setFormError(null);
            }}
          />
        </div>
        {formError ? (
          <Callout tone="danger" className="py-2.5">
            {formError}
          </Callout>
        ) : (
          <p className="text-xs text-text-3">Entries are manual. Vybe doesn’t read from Apple Health or Health Connect.</p>
        )}
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- macro bar */

function MacroBalance({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const parts = [
    { key: 'protein', label: 'Protein', pct: protein, color: chartTheme.macro.protein },
    { key: 'carbs', label: 'Carbs', pct: carbs, color: chartTheme.macro.carbs },
    { key: 'fat', label: 'Fat', pct: fat, color: chartTheme.macro.fat },
  ];
  const total = parts.reduce((s, p) => s + (Number.isFinite(p.pct) ? p.pct : 0), 0);
  if (total <= 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Macro balance: protein ${protein}%, carbs ${carbs}%, fat ${fat}%`}>
        {parts.map((p) => (
          <span key={p.key} className="h-full [transition:width_var(--duration-4)_var(--ease-out)]" style={{ width: `${(p.pct / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {parts.map((p) => (
          <div key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <dt className="text-text-2">{p.label}</dt>
            <dd className="tabular font-semibold text-text-1">{Math.round(p.pct)}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function Health() {
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // Sparklines need ~72px; on 2-up phone tiles they would crowd the numeral.
  const compact = useIsCompact();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('week');
  const [entryModal, setEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DailyEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DailyEntry | null>(null);

  const openNewEntry = () => {
    setEditingEntry(null);
    setEntryModal(true);
  };

  // Deep link from the Log sheet and the PWA shortcut: /health?log=1
  const wantsLog = searchParams.get('log') === '1';
  useEffect(() => {
    if (!wantsLog) return;
    setEditingEntry(null);
    setEntryModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete('log');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog]);

  const params = { timeWindow, timezoneOffsetMinutes: timezoneOffsetMinutes() };

  const overview = useQuery({
    queryKey: ['health', 'analytics', timeWindow],
    queryFn: async (): Promise<HealthAnalytics> => {
      const { data } = await api.get<{ analytics: HealthAnalytics }>('/health/analytics', { params });
      return data.analytics;
    },
  });

  const workouts = useQuery({
    queryKey: ['health', 'workout-analytics', timeWindow],
    queryFn: async (): Promise<WorkoutAnalytics> => {
      const { data } = await api.get<{ analytics: WorkoutAnalytics }>('/health/workout-analytics', { params });
      return data.analytics;
    },
  });

  const nutrition = useQuery({
    queryKey: ['health', 'nutrition-analytics', timeWindow],
    queryFn: async (): Promise<NutritionAnalytics> => {
      const { data } = await api.get<{ analytics: NutritionAnalytics }>('/health/nutrition-analytics', { params });
      return data.analytics;
    },
  });

  const entries = useQuery({
    queryKey: ['health', 'entries', ENTRY_HISTORY_DAYS],
    queryFn: async (): Promise<DailyEntry[]> => {
      // GET /health/entries takes an explicit startDate/endDate range and has
      // no `limit` parameter. Sending `limit` produced a 400 on every load, so
      // the daily-entry history never appeared. The server caps the span at
      // 365 days and rejects a reversed range.
      const today = new Date();
      const { data } = await api.get<{ entries: DailyEntry[] }>('/health/entries', {
        params: {
          startDate: format(subDays(today, ENTRY_HISTORY_DAYS - 1), 'yyyy-MM-dd'),
          endDate: format(today, 'yyyy-MM-dd'),
        },
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
      const previous = qc.getQueryData<DailyEntry[]>(['health', 'entries', ENTRY_HISTORY_DAYS]);
      qc.setQueryData<DailyEntry[]>(['health', 'entries', ENTRY_HISTORY_DAYS], (old) => (old ?? []).filter((e) => e.date !== entry.date));
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['health', 'entries', ENTRY_HISTORY_DAYS], ctx.previous);
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

  const sortedEntries = useMemo(() => [...(entries.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [entries.data]);

  const data = overview.data;
  const metrics = data?.healthMetrics;
  const stepsSpark = useMemo(
    () => [...(metrics?.dailySteps ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((d) => d.steps),
    [metrics?.dailySteps],
  );
  const weightSpark = weightSeries.map((w) => w.weight);
  const weightDelta = weightSeries.length >= 2 ? Math.round((weightSeries[weightSeries.length - 1].weight - weightSeries[0].weight) * 10) / 10 : null;

  const animation = chartTheme.animationDuration;
  const chartAnim = { isAnimationActive: animation > 0, animationDuration: animation };

  const logButton = (
    <Button variant="primary" icon={<Plus size={18} />} onClick={openNewEntry}>
      Log weight or steps
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health"
        subtitle="Training, nutrition and body stats, built from what you log."
        actions={logButton}
        mobileActions={<IconButton label="Log weight or steps" variant="primary" onClick={openNewEntry}><Plus size={22} /></IconButton>}
      />

      <Tabs
        variant="segmented"
        aria-label="Time window"
        tabs={WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
        value={timeWindow}
        onChange={(k: string) => setTimeWindow(k as TimeWindow)}
        className="max-w-sm"
      />

      {overview.isError ? (
        <ErrorState error={overview.error} title="Could not load your health summary" retry={() => overview.refetch()} />
      ) : (
        <>
          <StatGrid columns={4}>
            <StatTile
              loading={overview.isLoading}
              label="Fitness score"
              value={formatStat(data?.fitnessScore ?? 0)}
              unit="/ 100"
              tone="brand"
              icon={<Activity size={18} />}
              hint="Logging consistency, not a medical score"
            />
            <StatTile
              loading={overview.isLoading}
              label={`Workouts ${WINDOW_NOUN[timeWindow]}`}
              value={formatStat(data?.workoutStats.totalWorkouts ?? 0)}
              icon={<Dumbbell size={18} />}
              spark={compact ? undefined : volumeSeries.map((v) => v.workouts)}
              hint={`${formatStat(data?.workoutStats.totalDuration ?? 0)} min in total`}
            />
            <StatTile
              loading={overview.isLoading}
              label="Calories eaten"
              value={formatStat(Math.round(data?.nutritionStats.totalCalories ?? 0))}
              unit="kcal"
              icon={<Plate size={18} />}
              spark={compact ? undefined : calorieSeries.map((c) => c.calories)}
              hint={`${formatStat(data?.nutritionStats.totalMeals ?? 0)} ${data?.nutritionStats.totalMeals === 1 ? 'meal' : 'meals'} logged`}
            />
            <StatTile
              loading={overview.isLoading}
              label="Average daily steps"
              value={formatStat(Math.round(metrics?.averageDailySteps ?? 0))}
              icon={<Footprints size={18} />}
              spark={compact ? undefined : stepsSpark}
              hint={`${formatStat(metrics?.manualEntryDays ?? 0)} ${dayUnit(metrics?.manualEntryDays ?? 0)} logged`}
            />
          </StatGrid>

          <StatGrid columns={4}>
            <StatTile
              loading={overview.isLoading}
              label="Weight"
              value={metrics?.weight != null ? formatStat(metrics.weight) : '—'}
              unit={metrics?.weight != null ? 'kg' : undefined}
              icon={<Scale size={18} />}
              spark={compact ? undefined : weightSpark}
              delta={weightDelta != null ? { value: `${weightDelta > 0 ? '+' : ''}${formatStat(weightDelta)} kg`, direction: 'flat', label: 'since first entry' } : undefined}
              hint={metrics?.bmi != null ? `BMI ${formatStat(metrics.bmi)}` : 'Log a weight to track it'}
            />
            <StatTile
              loading={overview.isLoading}
              label="Workout streak"
              value={formatStat(data?.streaks.workout ?? 0)}
              unit={dayUnit(data?.streaks.workout ?? 0)}
              tone="accent"
              icon={<Flame size={18} />}
              hint="Consecutive days with a session"
            />
            <StatTile
              loading={overview.isLoading}
              label="Nutrition streak"
              value={formatStat(data?.streaks.nutrition ?? 0)}
              unit={dayUnit(data?.streaks.nutrition ?? 0)}
              tone="accent"
              icon={<Flame size={18} />}
              hint="Consecutive days with a meal logged"
            />
            <StatTile
              loading={overview.isLoading}
              label="Longest streak"
              value={formatStat(data?.streaks.longestStreak ?? 0)}
              unit={dayUnit(data?.streaks.longestStreak ?? 0)}
              icon={<Trophy size={18} />}
              hint="Your best run so far"
            />
          </StatGrid>

          <Callout tone="brand" title="Manual tracking">
            Steps and weight are the numbers you enter here; nothing syncs from Apple Health or Health Connect. The fitness score
            measures how consistently you log workouts, meals and daily stats over the selected period. It is not a medical assessment.
          </Callout>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Weight trend" subtitle={`Last ${ENTRY_HISTORY_DAYS} days of logged weight`} />
          {entries.isLoading ? (
            <Skeleton className="h-56 w-full rounded-md" />
          ) : entries.isError ? (
            <ErrorState error={entries.error} title="Could not load your weight history" retry={() => entries.refetch()} />
          ) : weightSeries.length < 2 ? (
            <EmptyState
              size="sm"
              icon={<Scale size={24} />}
              title="Log weight on two days to see a trend"
              message="Each entry is a point on this line."
              action={{ label: 'Log weight', onClick: openNewEntry, variant: 'secondary' }}
            />
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightSeries} margin={CHART_MARGIN}>
                  <CartesianGrid {...chartTheme.cartesianGrid} />
                  <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
                  <YAxis {...chartTheme.axisProps} width={44} domain={['dataMin - 2', 'dataMax + 2']} />
                  <Tooltip {...chartTheme.tooltip} formatter={(v) => [`${formatStat(Number(v ?? 0))} kg`, 'Weight']} />
                  <Line type="monotone" dataKey="weight" stroke={VIZ.brand} strokeWidth={2} dot={{ r: 3, fill: VIZ.brand, strokeWidth: 0 }} activeDot={{ r: 5 }} {...chartAnim} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Calories eaten" subtitle="From the meals you log" />
          {nutrition.isLoading ? (
            <Skeleton className="h-56 w-full rounded-md" />
          ) : nutrition.isError ? (
            <ErrorState error={nutrition.error} title="Could not load nutrition analytics" retry={() => nutrition.refetch()} />
          ) : calorieSeries.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Plate size={24} />}
              title="No meals logged yet"
              message="Log a meal and your daily calories chart here."
              action={{ label: 'Log meal', to: '/meals?log=1', variant: 'secondary' }}
            />
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={calorieSeries} margin={CHART_MARGIN}>
                    <defs>
                      <linearGradient id="healthCaloriesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={VIZ.kcal} stopOpacity={chartTheme.areaFill.start} />
                        <stop offset="100%" stopColor={VIZ.kcal} stopOpacity={chartTheme.areaFill.end} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...chartTheme.cartesianGrid} />
                    <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
                    <YAxis {...chartTheme.axisProps} width={44} />
                    <Tooltip {...chartTheme.tooltip} formatter={(v) => [`${formatStat(Math.round(Number(v ?? 0)))} kcal`, 'Calories']} />
                    <Area type="monotone" dataKey="calories" stroke={VIZ.kcal} strokeWidth={2} fill="url(#healthCaloriesFill)" {...chartAnim} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {nutrition.data ? <MacroBalance {...nutrition.data.nutritionBalance} /> : null}
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Workout volume" subtitle="Minutes trained and calories burned per session day" />
        {workouts.isLoading ? (
          <Skeleton className="h-56 w-full rounded-md" />
        ) : workouts.isError ? (
          <ErrorState error={workouts.error} title="Could not load workout analytics" retry={() => workouts.refetch()} />
        ) : volumeSeries.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Dumbbell size={24} />}
            title="No sessions logged yet"
            message="Log a workout and your volume shows up here."
            action={{ label: 'Log workout', to: '/workouts?log=1', variant: 'secondary' }}
          />
        ) : (
          <>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeSeries} margin={CHART_MARGIN} barGap={2}>
                  <CartesianGrid {...chartTheme.cartesianGrid} />
                  <XAxis dataKey="label" {...chartTheme.axisProps} minTickGap={24} />
                  <YAxis {...chartTheme.axisProps} width={44} />
                  <Tooltip
                    {...chartTheme.tooltip}
                    formatter={(v, name) => [
                      name === 'duration' ? `${formatStat(Number(v ?? 0))} min` : `${formatStat(Number(v ?? 0))} kcal`,
                      name === 'duration' ? 'Duration' : 'Calories burned',
                    ]}
                  />
                  <Bar dataKey="duration" fill={VIZ.brand} radius={[6, 6, 0, 0]} maxBarSize={28} {...chartAnim} />
                  <Bar dataKey="calories" fill={VIZ.accent} radius={[6, 6, 0, 0]} maxBarSize={28} {...chartAnim} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: VIZ.brand }} /> Minutes
              </span>
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: VIZ.accent }} /> Calories burned
              </span>
            </div>
            {workouts.data ? (
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
                <div>
                  <dt className="type-label text-text-2">Best burn</dt>
                  <dd className="type-stat mt-1 text-xl text-text-1">
                    {formatStat(Math.round(workouts.data.personalBests.calories))}
                    <span className="ml-1 text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">kcal</span>
                  </dd>
                </div>
                <div>
                  <dt className="type-label text-text-2">Longest session</dt>
                  <dd className="type-stat mt-1 text-xl text-text-1">
                    {formatStat(Math.round(workouts.data.personalBests.duration))}
                    <span className="ml-1 text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">min</span>
                  </dd>
                </div>
                <div>
                  <dt className="type-label text-text-2">Busiest week</dt>
                  <dd className="type-stat mt-1 text-xl text-text-1">
                    {formatStat(workouts.data.personalBests.frequency)}
                    <span className="ml-1 text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">
                      {workouts.data.personalBests.frequency === 1 ? 'session' : 'sessions'}
                    </span>
                  </dd>
                </div>
              </dl>
            ) : null}
          </>
        )}
      </Card>

      <Section
        title="Daily entries"
        description={`Steps and weight you logged in the last ${ENTRY_HISTORY_DAYS} days.`}
        action={
          sortedEntries.length > 0 ? (
            <Button variant="secondary" icon={<Plus size={16} />} onClick={openNewEntry}>
              Add
            </Button>
          ) : undefined
        }
      >
        {entries.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : entries.isError ? (
          <ErrorState error={entries.error} title="Could not load your entries" retry={() => entries.refetch()} />
        ) : sortedEntries.length === 0 ? (
          <EmptyState
            title="No entries yet"
            message="Log today’s steps or weight and it appears here, one line per day."
            action={{ label: 'Log weight or steps', onClick: openNewEntry, icon: <Plus size={18} /> }}
          />
        ) : (
          <ul className="space-y-2">
            {sortedEntries.map((entry) => {
              const dateLabel = entryDateLabel(entry.date);
              return (
                <li key={entry.date} className="card flex items-center gap-3 p-3 pl-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-1">{dateLabel}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-2">
                      {entry.steps != null ? (
                        <span className="inline-flex items-center gap-1">
                          <Footprints size={13} className="text-text-3" />
                          <span className="tabular font-semibold text-text-1">{formatStat(entry.steps)}</span> steps
                        </span>
                      ) : null}
                      {entry.weightKg != null ? (
                        <span className="inline-flex items-center gap-1">
                          <Scale size={13} className="text-text-3" />
                          <span className="tabular font-semibold text-text-1">{formatStat(entry.weightKg)}</span> kg
                        </span>
                      ) : null}
                      {entry.steps == null && entry.weightKg == null ? <span>No values recorded</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <IconButton
                      label={`Edit entry for ${dateLabel}`}
                      onClick={() => {
                        setEditingEntry(entry);
                        setEntryModal(true);
                      }}
                    >
                      <Edit size={18} />
                    </IconButton>
                    <IconButton label={`Delete entry for ${dateLabel}`} variant="danger" onClick={() => setPendingDelete(entry)}>
                      <Trash size={18} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

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
        destructive
        title="Delete this entry?"
        message={pendingDelete ? `The steps and weight logged for ${entryDateLabel(pendingDelete.date)} will be removed.` : undefined}
        confirmLabel="Delete entry"
        loading={removeEntry.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removeEntry.mutate(pendingDelete)}
      />
    </div>
  );
}
