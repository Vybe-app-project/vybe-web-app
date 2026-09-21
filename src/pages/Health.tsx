import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO, subDays } from 'date-fns';
import { api, errMsg } from '../lib/api';
import { displayWeight, useUnits, weightUnit } from '../lib/units';
import {
  Button,
  ButtonLink,
  Card,
  CardGrid,
  CardHeader,
  ChartEmpty,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
  StatTile,
  VIZ,
  chartTheme,
  formatStat,
  hasMetric,
  useIsCompact,
  useToast,
} from './ui';
import { Activity, Dumbbell, Edit, Flame, Footprints, Plate, Plus, Scale, Trash, Trophy } from './icons';

// Recharts lives in the charts' own chunk (src/pages/health/HealthCharts.tsx); each
// chart mounts into a fixed 14 rem box that keeps its height while the chunk loads.
const charts = () => import('./health/HealthCharts');
const WeightTrendChart = lazy(() => charts().then((m) => ({ default: m.WeightTrendChart })));
const CaloriesChart = lazy(() => charts().then((m) => ({ default: m.CaloriesChart })));
const MacrosChart = lazy(() => charts().then((m) => ({ default: m.MacrosChart })));
const VolumeChart = lazy(() => charts().then((m) => ({ default: m.VolumeChart })));
const ChartLoading = () => <Skeleton className="h-full w-full rounded-md" />;

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

type NutritionAnalytics = Omit<HealthAnalytics['nutritionStats'], 'mealTypes'> & {
  timeWindow: TimeWindow;
  nutritionBalance: { protein: number; carbs: number; fat: number };
  /** Per meal type: how many and the average kcal of each. */
  mealTypes: Record<string, { count: number; avgCalories: number } | number>;
  topFoods: Record<string, { count: number; totalCalories: number; avgCalories: number }>;
};

type HealthGoalsSummary = { dailyCalorieGoal?: number; macroGoals?: { protein?: number; carbs?: number; fat?: number } };

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const mealTypeStats = (value: { count: number; avgCalories: number } | number | undefined) =>
  typeof value === 'number' ? { count: value, avgCalories: 0 } : value ?? { count: 0, avgCalories: 0 };

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

// Re-exported so existing imports keep working. The previous definition here
// negated the offset under a comment that mis-stated the server's convention;
// see src/lib/timezone.ts for the correct one and why.
import { timezoneOffsetMinutes } from '../lib/timezone';
export { timezoneOffsetMinutes };

const shortDate = (value: string) => {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'd MMM') : value;
};

const dayUnit = (n: number) => (n === 1 ? 'day' : 'days');

const entryDateLabel = (value: string) => {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'EEEE d MMMM') : value;
};

/**
 * Body numbers are neutral (DP-005): the weight line and the "minutes" bars
 * draw in the strong neutral ink, never in the action colour, so nothing on
 * this page reads as blue-good / red-bad. The charts themselves read the same
 * token in HealthCharts.tsx; this copy colours the legend dots beside them.
 */
const INK_STRONG = 'var(--primary-strong, var(--text-1))';

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
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
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

/** A stat tile only once its metric has a datum: no wall of zeros on first run. */
type TileSpec = { key: string; node: ReactNode };

export default function Health() {
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // Sparklines need ~72px; on 2-up phone tiles they would crowd the numeral.
  const compact = useIsCompact();
  const system = useUnits((s) => s.system);
  const wUnit = weightUnit(system);
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

  // The calorie goal draws the target line on the chart and anchors the
  // "average vs goal" comparison. No goals yet is a normal state.
  const goals = useQuery({
    queryKey: ['health-goals'],
    queryFn: async (): Promise<HealthGoalsSummary> => {
      const { data } = await api.get<{ data: HealthGoalsSummary }>('/health-goals');
      return data.data ?? {};
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
          weight: displayWeight(e.weightKg as number, system),
        };
      });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [entries.data, system]);

  const calorieGoal = goals.data?.dailyCalorieGoal ?? 0;
  const nutritionInsights = useMemo(() => {
    const n = nutrition.data;
    if (!n) return null;
    const days = n.dailyNutrition ?? [];
    const loggedDays = days.filter((d) => d.meals > 0);
    const avgPerLoggedDay = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.calories, 0) / loggedDays.length) : 0;
    const topFoods = Object.entries(n.topFoods ?? {})
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count || b.totalCalories - a.totalCalories)
      .slice(0, 5);
    const mealTypes = MEAL_TYPE_ORDER.map((type) => ({ type, ...mealTypeStats(n.mealTypes?.[type]) })).filter((m) => m.count > 0);
    return { avgPerLoggedDay, loggedDays: loggedDays.length, topFoods, mealTypes };
  }, [nutrition.data]);

  const calorieSeries = useMemo(
    () =>
      (nutrition.data?.dailyNutrition ?? [])
        .map((d) => ({ ...d, label: shortDate(d.date) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [nutrition.data],
  );
  // The API answers a row for every day in the window, zeros included, so
  // "nothing logged" arrives as a full series of zeros. A chart of a flat
  // zero line reads as a bug; the empty state below reads as an instruction.
  const hasCalories = useMemo(() => calorieSeries.some((d) => (Number(d.calories) || 0) > 0), [calorieSeries]);

  const volumeSeries = useMemo(
    () =>
      (workouts.data?.weeklyProgress ?? [])
        .map((d) => ({ ...d, label: shortDate(d.date) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [workouts.data],
  );
  const hasVolume = useMemo(
    () => volumeSeries.some((d) => (Number(d.duration) || 0) > 0 || (Number(d.calories) || 0) > 0),
    [volumeSeries],
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
  const macroGoal = goals.data?.macroGoals;

  // Body and nutrition numbers are neutral throughout (DP-005): no tile tone,
  // no red or green, and a weight delta is a fact, not a verdict.
  const latestWeight = metrics?.weight != null ? displayWeight(metrics.weight, system) : null;
  const avgSteps = Math.round(metrics?.averageDailySteps ?? 0);

  // A tile appears only with a datum behind it (hasMetric), so first run is
  // never a wall of zeros, and a hint that would read "0 min" is left off.
  // Weight and steps — the two numbers this page's own action logs — lead the
  // grid once anything at all is logged, the missing one carrying the next
  // step in its number's place.
  const others: TileSpec[] = [];
  if (data) {
    if (hasMetric(data.fitnessScore)) {
      others.push({ key: 'score', node: <StatTile label="Fitness score" value={formatStat(data.fitnessScore)} unit="/ 100" icon={<Activity size={18} />} hint="Logging consistency, not a medical score" /> });
    }
    if (hasMetric(data.workoutStats.totalWorkouts)) {
      others.push({
        key: 'workouts',
        node: (
          <StatTile
            label={`Workouts ${WINDOW_NOUN[timeWindow]}`}
            value={formatStat(data.workoutStats.totalWorkouts)}
            icon={<Dumbbell size={18} />}
            spark={compact ? undefined : volumeSeries.map((v) => v.workouts)}
            hint={hasMetric(data.workoutStats.totalDuration) ? `${formatStat(data.workoutStats.totalDuration)} min in total` : undefined}
          />
        ),
      });
    }
    if (hasMetric(data.nutritionStats.totalCalories)) {
      others.push({
        key: 'kcal',
        node: (
          <StatTile
            label="Calories eaten"
            value={formatStat(Math.round(data.nutritionStats.totalCalories))}
            unit="kcal"
            icon={<Plate size={18} />}
            spark={compact ? undefined : calorieSeries.map((c) => c.calories)}
            hint={hasMetric(data.nutritionStats.totalMeals) ? `${formatStat(data.nutritionStats.totalMeals)} ${data.nutritionStats.totalMeals === 1 ? 'meal' : 'meals'} logged` : undefined}
          />
        ),
      });
    }
    for (const [key, label, n, hint] of [
      ['streak-w', 'Workout streak', data.streaks.workout, 'Consecutive days with a session'],
      ['streak-n', 'Nutrition streak', data.streaks.nutrition, 'Consecutive days with a meal logged'],
      ['streak-best', 'Longest streak', data.streaks.longestStreak, 'Your best run so far'],
    ] as const) {
      if (hasMetric(n)) {
        others.push({ key, node: <StatTile label={label} value={formatStat(n)} unit={dayUnit(n)} icon={key === 'streak-best' ? <Trophy size={18} /> : <Flame size={18} />} hint={hint} /> });
      }
    }
  }
  const anyData = others.length > 0 || latestWeight != null || avgSteps > 0 || sortedEntries.length > 0;
  const tiles: TileSpec[] =
    data && anyData
      ? [
          {
            key: 'weight',
            node: (
              <StatTile
                label="Weight"
                value={latestWeight != null ? formatStat(latestWeight) : null}
                unit={latestWeight != null ? wUnit : undefined}
                icon={<Scale size={18} />}
                spark={compact || latestWeight == null ? undefined : weightSpark}
                delta={weightDelta != null ? { value: `${weightDelta > 0 ? '+' : ''}${formatStat(weightDelta)} ${wUnit}`, direction: 'flat', label: 'since first entry' } : undefined}
                hint={metrics?.bmi != null ? `BMI ${formatStat(metrics.bmi)}` : undefined}
                fallback="Log one"
                onClick={latestWeight == null ? openNewEntry : undefined}
              />
            ),
          },
          {
            key: 'steps',
            node: (
              <StatTile
                label="Average daily steps"
                value={avgSteps > 0 ? formatStat(avgSteps) : null}
                icon={<Footprints size={18} />}
                spark={compact || avgSteps === 0 ? undefined : stepsSpark}
                hint={avgSteps > 0 && hasMetric(metrics?.manualEntryDays) ? `${formatStat(metrics?.manualEntryDays)} ${dayUnit(metrics?.manualEntryDays ?? 0)} logged` : undefined}
                fallback="Log today’s"
                onClick={avgSteps > 0 ? undefined : openNewEntry}
              />
            ),
          },
          ...others,
        ]
      : others;

  // The "log to start" line is the page subtitle only when there is nothing at
  // all to show — never above populated tiles, and never before every query
  // has answered (an empty state must not render ahead of its data).
  const settled = overview.isSuccess && entries.isSuccess && nutrition.isSuccess && workouts.isSuccess;
  const noDataYet = settled && tiles.length === 0 && sortedEntries.length === 0 && !hasCalories && !hasVolume;

  // Week · Month · Year drives the tiles and every chart but the weight trend.
  // It lives in the Calories card's header, so the page has one control row.
  const windowControl = (
    <SegmentedControl
      size="sm"
      fill={false}
      aria-label="Time window"
      tabs={WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
      value={timeWindow}
      onChange={(k: string) => setTimeWindow(k as TimeWindow)}
    />
  );

  return (
    <div className="space-y-section">
      <PageHeader
        title="Health"
        subtitle={noDataYet ? 'Log a weight or your steps to start. One entry a day is enough; the trend builds from there.' : undefined}
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={openNewEntry}>
            Log weight or steps
          </Button>
        }
        mobileActions={
          <IconButton label="Log weight or steps" onClick={openNewEntry}>
            <Plus size={22} />
          </IconButton>
        }
      />

      {overview.isError ? (
        <ErrorState error={overview.error} title="Could not load your health summary" retry={() => overview.refetch()} />
      ) : tiles.length > 0 ? (
        <CardGrid min="clamp(8.5rem, 22%, 15rem)" aria-label="Health summary">
          {tiles.map((t) => (
            <div key={t.key} className="min-w-0">
              {t.node}
            </div>
          ))}
        </CardGrid>
      ) : null}

      <CardGrid min="22rem">
        <Card>
          <CardHeader title="Weight trend" subtitle={`Last ${ENTRY_HISTORY_DAYS} days of logged weight`} />
          {entries.isLoading ? (
            <Skeleton className="h-56 w-full rounded-md" />
          ) : entries.isError ? (
            <ErrorState error={entries.error} title="Could not load your weight history" retry={() => entries.refetch()} />
          ) : weightSeries.length < 2 ? (
            <>
              <ChartEmpty height={168} label="Log weight on two days to see a trend" />
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={openNewEntry}>
                  Log weight
                </Button>
              </div>
            </>
          ) : (
            <div className="h-56 w-full">
              <Suspense fallback={<ChartLoading />}>
                <WeightTrendChart data={weightSeries} unit={wUnit} />
              </Suspense>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Calories eaten" subtitle={`From the meals you log ${WINDOW_NOUN[timeWindow]}`} action={windowControl} />
          {nutrition.isLoading ? (
            <Skeleton className="h-56 w-full rounded-md" />
          ) : nutrition.isError ? (
            <ErrorState error={nutrition.error} title="Could not load nutrition analytics" retry={() => nutrition.refetch()} />
          ) : !hasCalories ? (
            <>
              <ChartEmpty height={168} label="Log a meal and your daily calories chart here" />
              <div className="mt-3 flex justify-center">
                <ButtonLink to="/meals/log" variant="secondary" size="sm">
                  Log meal
                </ButtonLink>
              </div>
            </>
          ) : (
            <>
              <div className="h-56 w-full">
                <Suspense fallback={<ChartLoading />}>
                  <CaloriesChart data={calorieSeries} goal={calorieGoal} />
                </Suspense>
              </div>
              {nutritionInsights ? (
                <p className="mt-3 text-xs text-text-2">
                  Average <span className="tabular font-semibold text-text-1">{formatStat(nutritionInsights.avgPerLoggedDay)} kcal</span> on the{' '}
                  <span className="tabular font-semibold text-text-1">{nutritionInsights.loggedDays}</span> {dayUnit(nutritionInsights.loggedDays)} you logged
                  {calorieGoal > 0 ? (
                    <>
                      , <span className="tabular font-semibold text-text-1">{formatStat(Math.abs(calorieGoal - nutritionInsights.avgPerLoggedDay))} kcal</span>{' '}
                      {nutritionInsights.avgPerLoggedDay <= calorieGoal ? 'under' : 'over'} your {formatStat(calorieGoal)} kcal goal.
                    </>
                  ) : (
                    <>
                      . <Link to="/health/goals" viewTransition className="underline-offset-2 hover:underline">Set a calorie goal</Link> to see the target line.
                    </>
                  )}
                </p>
              ) : null}
              {nutrition.data ? <MacroBalance {...nutrition.data.nutritionBalance} /> : null}
            </>
          )}
        </Card>
      </CardGrid>

      {nutrition.data && nutritionInsights && hasCalories ? (
        <Section title="Nutrition" description={`Macros per day, meal types and the foods you log most ${WINDOW_NOUN[timeWindow]}.`}>
          <CardGrid min="20rem">
            <Card container>
              <CardHeader title="Macros per day" subtitle="Grams of protein, carbs and fat, stacked" level={3} />
              <div className="h-56 w-full">
                <Suspense fallback={<ChartLoading />}>
                  <MacrosChart data={calorieSeries} />
                </Suspense>
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                {(
                  [
                    ['protein', 'Protein', chartTheme.macro.protein, macroGoal?.protein],
                    ['carbs', 'Carbs', chartTheme.macro.carbs, macroGoal?.carbs],
                    ['fat', 'Fat', chartTheme.macro.fat, macroGoal?.fat],
                  ] as const
                ).map(([key, label, color, goal]) => {
                  const perDay = nutritionInsights.loggedDays
                    ? Math.round(calorieSeries.filter((d) => d.meals > 0).reduce((s, d) => s + d[key], 0) / nutritionInsights.loggedDays)
                    : 0;
                  return (
                    <div key={key} className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />
                      <dt className="text-text-2">{label}</dt>
                      <dd className="tabular font-semibold text-text-1">
                        {formatStat(perDay)} g<span className="font-normal text-text-3">/day{goal ? ` of ${formatStat(goal)}` : ''}</span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Card>

            <Card>
              <CardHeader title="Meals by type" subtitle="How many, and the average size of each" level={3} />
              {nutritionInsights.mealTypes.length === 0 ? (
                <p className="text-sm text-text-2">No meals in this window.</p>
              ) : (
                <ul className="flex flex-wrap gap-2" aria-label="Meals by type">
                  {nutritionInsights.mealTypes.map((m) => (
                    <li key={m.type} className="rounded-md bg-surface-2 px-3 py-2">
                      <p className="text-sm font-semibold text-text-1">
                        {m.type.charAt(0).toUpperCase() + m.type.slice(1)} <span className="tabular text-text-2">× {formatStat(m.count)}</span>
                      </p>
                      <p className="tabular text-xs text-text-2">{formatStat(Math.round(m.avgCalories))} kcal each</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Top foods" subtitle="What you logged most often" level={3} />
              {nutritionInsights.topFoods.length === 0 ? (
                <p className="text-sm text-text-2">Log a few meals and your regulars show up here.</p>
              ) : (
                <ol className="divide-y divide-line" aria-label="Top foods">
                  {nutritionInsights.topFoods.map((food, i) => (
                    <li key={food.name} className="flex items-center gap-3 py-2">
                      <span className="type-stat w-5 text-sm text-text-3">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-1">{food.name}</span>
                      <span className="tabular shrink-0 text-xs text-text-2">
                        {formatStat(food.count)}× · {formatStat(Math.round(food.avgCalories))} kcal
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </CardGrid>
        </Section>
      ) : null}

      <Card container>
        <CardHeader title="Workout volume" subtitle="Minutes trained and calories burned per session day" />
        {workouts.isLoading ? (
          <Skeleton className="h-56 w-full rounded-md" />
        ) : workouts.isError ? (
          <ErrorState error={workouts.error} title="Could not load workout analytics" retry={() => workouts.refetch()} />
        ) : !hasVolume ? (
          <>
            <ChartEmpty height={168} label="Log a workout and your volume shows up here" />
            <div className="mt-3 flex justify-center">
              <ButtonLink to="/workouts?log=1" variant="secondary" size="sm">
                Log workout
              </ButtonLink>
            </div>
          </>
        ) : (
          <>
            <div className="h-56 w-full">
              <Suspense fallback={<ChartLoading />}>
                <VolumeChart data={volumeSeries} />
              </Suspense>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: INK_STRONG }} /> Minutes
              </span>
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: VIZ.alt }} /> Calories burned
              </span>
            </div>
            {workouts.data ? (
              <dl className="mt-4 grid gap-3 border-t border-line pt-4 @sm:grid-cols-3">
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
          <Card padded={false}>
            <EmptyState
              family="body"
              title="No entries yet"
              message="Log today’s steps or weight and it appears here, one line per day."
              action={{ label: 'Log weight or steps', onClick: openNewEntry, icon: <Plus size={18} />, variant: 'secondary' }}
            />
          </Card>
        ) : (
          <Card padded={false}>
          <ul className="divide-y divide-line">
            {sortedEntries.map((entry) => {
              const dateLabel = entryDateLabel(entry.date);
              return (
                <li key={entry.date} className="flex items-center gap-3 p-3 pl-4">
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
                          <span className="tabular font-semibold text-text-1">{formatStat(displayWeight(entry.weightKg, system))}</span> {wUnit}
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
          </Card>
        )}
      </Section>

      <p className="text-xs leading-relaxed text-text-3">
        Steps and weight are the numbers you enter here; nothing syncs from Apple Health or Health Connect. The fitness score measures how
        consistently you log over the selected period, not your health.
      </p>

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
