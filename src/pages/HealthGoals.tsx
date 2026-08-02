import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  useToast,
} from './ui';
import { Activity, TrendingUp, Check } from './icons';
import { timezoneOffsetMinutes } from './Health';

/* ------------------------------------------------------------------ types */

type MacroGoals = { protein?: number; carbs?: number; fat?: number };

type HealthGoals = {
  currentWeight?: number;
  targetWeight?: number;
  heightCm?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  activityLevel?: string;
  goal?: string;
  weeklyGoal?: number;
  bmr?: number;
  tdee?: number;
  dailyCalorieGoal?: number;
  macroGoals?: MacroGoals;
  lastUpdated?: string;
};

type DailySummary = {
  baseGoals: { calories: number; protein: number; carbs: number; fat: number };
  adjustedGoals: { calories: number; protein: number; carbs: number; fat: number };
  consumed: { calories: number; protein: number; carbs: number; fat: number };
  exercise: { caloriesBurned: number; workoutsCount: number };
  remaining: { calories: number; protein: number; carbs: number; fat: number };
  mealsCount: number;
};

const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary (little/no exercise)' },
  { value: 'lightly_active', label: 'Lightly active (1–3 days/week)' },
  { value: 'moderately_active', label: 'Moderately active (3–5 days/week)' },
  { value: 'very_active', label: 'Very active (6–7 days/week)' },
  { value: 'extremely_active', label: 'Extremely active (physical job)' },
];

const GOALS = [
  { value: 'lose_weight', label: 'Lose weight' },
  { value: 'maintain_weight', label: 'Maintain weight' },
  { value: 'gain_weight', label: 'Gain weight' },
  { value: 'gain_muscle', label: 'Gain muscle' },
];

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

/* ------------------------------------------------------------- components */

function ProgressBar({
  label,
  consumed,
  goal,
  unit,
  color,
}: {
  label: string;
  consumed: number;
  goal: number;
  unit: string;
  color: string;
}) {
  const pct = goal > 0 ? Math.min(100, Math.round((consumed / goal) * 100)) : 0;
  const remaining = Math.max(0, goal - consumed);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-xs text-[var(--color-muted)]">
          {Math.round(consumed)} / {Math.round(goal)}
          {unit} · {Math.round(remaining)}
          {unit} left
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} progress`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

type FormState = {
  currentWeight: string;
  targetWeight: string;
  heightCm: string;
  age: string;
  gender: string;
  activityLevel: string;
  goal: string;
  weeklyGoal: string;
};

const formFrom = (g?: HealthGoals | null): FormState => ({
  currentWeight: g?.currentWeight != null ? String(g.currentWeight) : '',
  targetWeight: g?.targetWeight != null ? String(g.targetWeight) : '',
  heightCm: g?.heightCm != null ? String(g.heightCm) : '',
  age: g?.age != null ? String(g.age) : '',
  gender: g?.gender ?? 'male',
  activityLevel: g?.activityLevel ?? 'moderately_active',
  goal: g?.goal ?? 'maintain_weight',
  weeklyGoal: g?.weeklyGoal != null ? String(g.weeklyGoal) : '0',
});

export default function HealthGoals() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(formFrom(null));
  const [seeded, setSeeded] = useState(false);

  const goalsQuery = useQuery({
    queryKey: ['health-goals'],
    queryFn: async (): Promise<HealthGoals> => {
      const { data } = await api.get<{ data: HealthGoals }>('/health-goals');
      return data.data ?? {};
    },
  });

  if (goalsQuery.data && !seeded) {
    setSeeded(true);
    setForm(formFrom(goalsQuery.data));
  }

  const summaryQuery = useQuery({
    queryKey: ['health-goals', 'daily-summary'],
    queryFn: async (): Promise<DailySummary | null> => {
      try {
        const { data } = await api.get<{ data: DailySummary }>('/health-goals/daily-summary', {
          params: { timezoneOffsetMinutes: timezoneOffsetMinutes() },
        });
        return data.data;
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) return null;
        throw e;
      }
    },
    retry: false,
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const currentWeight = Number(form.currentWeight);
      const heightCm = Number(form.heightCm);
      const age = Number(form.age);
      if (!currentWeight || !heightCm || !age) {
        throw new Error('Current weight, height and age are required');
      }
      const { data } = await api.put<{ data: HealthGoals }>('/health-goals', {
        currentWeight,
        targetWeight: form.targetWeight ? Number(form.targetWeight) : undefined,
        heightCm,
        age,
        gender: form.gender,
        activityLevel: form.activityLevel,
        goal: form.goal,
        weeklyGoal: Number(form.weeklyGoal) || 0,
      });
      return data.data;
    },
    onSuccess: (data) => {
      toast.success('Goals updated');
      qc.setQueryData(['health-goals'], data);
      qc.invalidateQueries({ queryKey: ['health-goals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update goals')),
  });

  const recalculate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/health-goals/recalculate');
      return data;
    },
    onSuccess: () => {
      toast.success('Metrics recalculated');
      qc.invalidateQueries({ queryKey: ['health-goals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not recalculate metrics')),
  });

  const goals = goalsQuery.data;
  const summary = summaryQuery.data;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Health goals</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Your calorie and macro targets, calculated from your body metrics.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => recalculate.mutate()}
          loading={recalculate.isPending}
          disabled={!goals?.dailyCalorieGoal}
        >
          <TrendingUp size={16} /> Recalculate
        </Button>
      </header>

      {goalsQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : goalsQuery.isError ? (
        <ErrorState
          message={errMsg(goalsQuery.error, 'Could not load goals')}
          onRetry={() => goalsQuery.refetch()}
        />
      ) : goals?.dailyCalorieGoal ? (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Calculated targets</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="BMR" value={`${Math.round(goals.bmr ?? 0)} kcal`} />
            <Metric label="TDEE" value={`${Math.round(goals.tdee ?? 0)} kcal`} />
            <Metric label="Daily goal" value={`${Math.round(goals.dailyCalorieGoal)} kcal`} />
            <Metric
              label="Target weight"
              value={goals.targetWeight ? `${goals.targetWeight} kg` : '—'}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Protein" value={`${Math.round(goals.macroGoals?.protein ?? 0)} g`} />
            <Metric label="Carbs" value={`${Math.round(goals.macroGoals?.carbs ?? 0)} g`} />
            <Metric label="Fat" value={`${Math.round(goals.macroGoals?.fat ?? 0)} g`} />
          </div>
        </Card>
      ) : (
        <EmptyState
          icon={<Activity size={28} />}
          title="No goals set"
          description="Fill in your metrics below to calculate your calorie and macro targets."
        />
      )}

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Today’s progress</h2>
        {summaryQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : summaryQuery.isError ? (
          <ErrorState
            message={errMsg(summaryQuery.error, 'Could not load summary')}
            onRetry={() => summaryQuery.refetch()}
          />
        ) : !summary ? (
          <p className="text-sm text-[var(--color-muted)]">
            Set your goals below to start tracking daily progress.
          </p>
        ) : (
          <div className="space-y-3">
            <ProgressBar
              label="Calories"
              consumed={summary.consumed.calories}
              goal={summary.adjustedGoals.calories}
              unit=""
              color="linear-gradient(90deg,#7c5cff,#22d3ee)"
            />
            <ProgressBar
              label="Protein"
              consumed={summary.consumed.protein}
              goal={summary.baseGoals.protein}
              unit="g"
              color="#22d3ee"
            />
            <ProgressBar
              label="Carbs"
              consumed={summary.consumed.carbs}
              goal={summary.baseGoals.carbs}
              unit="g"
              color="#f472b6"
            />
            <ProgressBar
              label="Fat"
              consumed={summary.consumed.fat}
              goal={summary.baseGoals.fat}
              unit="g"
              color="#facc15"
            />
            <p className="text-xs text-[var(--color-muted)]">
              {summary.mealsCount} meals logged · {Math.round(summary.exercise.caloriesBurned)} kcal
              burned across {summary.exercise.workoutsCount} workouts
            </p>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Your metrics</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Current weight (kg)</span>
              <Input
                type="number"
                min={20}
                max={500}
                step="0.1"
                value={form.currentWeight}
                onChange={(e) => set('currentWeight', e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Target weight (kg)</span>
              <Input
                type="number"
                min={20}
                max={500}
                step="0.1"
                value={form.targetWeight}
                onChange={(e) => set('targetWeight', e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Height (cm)</span>
              <Input
                type="number"
                min={80}
                max={260}
                value={form.heightCm}
                onChange={(e) => set('heightCm', e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Age</span>
              <Input
                type="number"
                min={13}
                max={120}
                value={form.age}
                onChange={(e) => set('age', e.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Gender</span>
              <select
                className="input-base"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value)}
              >
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Activity level</span>
              <select
                className="input-base"
                value={form.activityLevel}
                onChange={(e) => set('activityLevel', e.target.value)}
              >
                {ACTIVITY_LEVELS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">Goal</span>
              <select
                className="input-base"
                value={form.goal}
                onChange={(e) => set('goal', e.target.value)}
              >
                {GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--color-muted)]">
                Weekly goal (kg per week)
              </span>
              <Input
                type="number"
                step="0.1"
                value={form.weeklyGoal}
                onChange={(e) => set('weeklyGoal', e.target.value)}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.isPending}>
              <Check size={16} /> Save goals
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
