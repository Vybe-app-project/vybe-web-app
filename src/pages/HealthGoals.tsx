import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  StatGrid,
  StatTile,
  chartTheme,
  formatStat,
  prefersReducedMotion,
  useToast,
} from './ui';
import { Check, Flame, Plate, Refresh, Target, Zap } from './icons';
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
  { value: 'sedentary', label: 'Sedentary', description: 'Little or no exercise' },
  { value: 'lightly_active', label: 'Lightly active', description: '1–3 sessions a week' },
  { value: 'moderately_active', label: 'Moderately active', description: '3–5 sessions a week' },
  { value: 'very_active', label: 'Very active', description: '6–7 sessions a week' },
  { value: 'extremely_active', label: 'Extremely active', description: 'Hard training or a physical job' },
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

type MacroKey = 'kcal' | 'protein' | 'carbs' | 'fat';

function MacroProgress({
  label,
  consumed,
  goal,
  unit,
  tone,
}: {
  label: string;
  consumed: number;
  goal: number;
  unit: string;
  tone: MacroKey;
}) {
  const remaining = Math.max(0, goal - consumed);
  const over = consumed > goal && goal > 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-text-1">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: chartTheme.macro[tone] }} />
          {label}
        </span>
        <span className="tabular text-xs text-text-2">
          <span className="font-semibold text-text-1">{formatStat(Math.round(consumed))}</span>
          {' / '}
          {formatStat(Math.round(goal))} {unit}
          <span className="ml-2 text-text-3">{over ? `${formatStat(Math.round(consumed - goal))} ${unit} over` : `${formatStat(Math.round(remaining))} ${unit} left`}</span>
        </span>
      </div>
      <Progress value={consumed} max={goal} tone={tone} label={`${label}: ${Math.round(consumed)} of ${Math.round(goal)} ${unit}`} />
    </div>
  );
}

function MacroTarget({ label, grams, tone }: { label: string; grams: number; tone: Exclude<MacroKey, 'kcal'> }) {
  return (
    <div className="rounded-md bg-surface-2 p-3">
      <p className="type-label inline-flex items-center gap-1.5 text-text-2">
        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: chartTheme.macro[tone] }} />
        {label}
      </p>
      <p className="type-stat mt-1 text-xl text-text-1">
        {formatStat(Math.round(grams))}
        <span className="ml-1 text-xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">g</span>
      </p>
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

const inRange = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max;
};

export default function HealthGoals() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(formFrom(null));
  const [seeded, setSeeded] = useState(false);
  const [attempted, setAttempted] = useState(false);

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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const errors = {
    currentWeight: attempted && !inRange(form.currentWeight, 20, 500) ? 'Enter a weight between 20 and 500 kg.' : undefined,
    heightCm: attempted && !inRange(form.heightCm, 80, 260) ? 'Enter a height between 80 and 260 cm.' : undefined,
    age: attempted && !inRange(form.age, 13, 120) ? 'Enter an age between 13 and 120.' : undefined,
    targetWeight: attempted && form.targetWeight.trim() !== '' && !inRange(form.targetWeight, 20, 500) ? 'Enter a weight between 20 and 500 kg.' : undefined,
    weeklyGoal: attempted && form.weeklyGoal.trim() !== '' && !inRange(form.weeklyGoal, 0, 2) ? 'Enter a pace between 0 and 2 kg per week.' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.put<{ data: HealthGoals }>('/health-goals', {
        currentWeight: Number(form.currentWeight),
        targetWeight: form.targetWeight ? Number(form.targetWeight) : undefined,
        heightCm: Number(form.heightCm),
        age: Number(form.age),
        gender: form.gender,
        activityLevel: form.activityLevel,
        goal: form.goal,
        weeklyGoal: Number(form.weeklyGoal) || 0,
      });
      return data.data;
    },
    onSuccess: (data) => {
      toast.success('Goals saved');
      setAttempted(false);
      qc.setQueryData(['health-goals'], data);
      qc.invalidateQueries({ queryKey: ['health-goals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save goals')),
  });

  const recalculate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/health-goals/recalculate');
      return data;
    },
    onSuccess: () => {
      toast.success('Targets recalculated');
      qc.invalidateQueries({ queryKey: ['health-goals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not recalculate targets')),
  });

  const submit = () => {
    setAttempted(true);
    if (
      !inRange(form.currentWeight, 20, 500) ||
      !inRange(form.heightCm, 80, 260) ||
      !inRange(form.age, 13, 120) ||
      (form.targetWeight.trim() !== '' && !inRange(form.targetWeight, 20, 500)) ||
      (form.weeklyGoal.trim() !== '' && !inRange(form.weeklyGoal, 0, 2))
    ) {
      return;
    }
    save.mutate();
  };

  const goals = goalsQuery.data;
  const summary = summaryQuery.data;
  const hasTargets = Boolean(goals?.dailyCalorieGoal);

  const recalcDisabled = !hasTargets || recalculate.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals"
        subtitle="Calorie and macro targets estimated from the body stats you enter."
        actions={
          <Button variant="secondary" icon={<Refresh size={18} />} onClick={() => recalculate.mutate()} loading={recalculate.isPending} disabled={recalcDisabled}>
            Recalculate
          </Button>
        }
        mobileActions={
          <IconButton label="Recalculate targets" onClick={() => recalculate.mutate()} disabled={recalcDisabled}>
            <Refresh size={20} />
          </IconButton>
        }
      />

      {goalsQuery.isLoading ? (
        <StatGrid columns={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <StatTile key={i} loading label="" value="" />
          ))}
        </StatGrid>
      ) : goalsQuery.isError ? (
        <ErrorState error={goalsQuery.error} title="Could not load your goals" retry={() => goalsQuery.refetch()} />
      ) : hasTargets && goals ? (
        <div className="space-y-4">
          <StatGrid columns={4}>
            <StatTile label="Daily calorie goal" value={formatStat(Math.round(goals.dailyCalorieGoal ?? 0))} unit="kcal" tone="brand" icon={<Target size={18} />} hint={GOALS.find((g) => g.value === goals.goal)?.label ?? 'Your target'} />
            <StatTile label="Maintenance (TDEE)" value={formatStat(Math.round(goals.tdee ?? 0))} unit="kcal" icon={<Zap size={18} />} hint="Estimated daily burn" />
            <StatTile label="Resting (BMR)" value={formatStat(Math.round(goals.bmr ?? 0))} unit="kcal" icon={<Flame size={18} />} hint="Estimated burn at rest" />
            <StatTile
              label="Target weight"
              value={goals.targetWeight ? formatStat(goals.targetWeight) : '—'}
              unit={goals.targetWeight ? 'kg' : undefined}
              hint={
                goals.targetWeight && goals.currentWeight
                  ? `${formatStat(Math.abs(Math.round((goals.targetWeight - goals.currentWeight) * 10) / 10))} kg ${goals.targetWeight < goals.currentWeight ? 'to lose' : goals.targetWeight > goals.currentWeight ? 'to gain' : 'to hold'}`
                  : 'Add one below'
              }
            />
          </StatGrid>
          <Card>
            <CardHeader title="Macro targets" subtitle="Daily grams that make up your calorie goal" />
            <div className="grid grid-cols-3 gap-3">
              <MacroTarget label="Protein" grams={goals.macroGoals?.protein ?? 0} tone="protein" />
              <MacroTarget label="Carbs" grams={goals.macroGoals?.carbs ?? 0} tone="carbs" />
              <MacroTarget label="Fat" grams={goals.macroGoals?.fat ?? 0} tone="fat" />
            </div>
          </Card>
        </div>
      ) : (
        <Card padded={false}>
          <EmptyState
            title="No targets yet"
            message="Enter your weight, height, age and activity level below and Vybe estimates your daily calories and macros."
            action={
              <Button variant="primary" onClick={() => document.getElementById('goals-form')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })}>
                Enter your stats
              </Button>
            }
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title="Today’s progress"
          subtitle="What you’ve logged against today’s targets"
          action={
            summary ? (
              <ButtonLink to="/meals?log=1" variant="secondary" icon={<Plate size={16} />}>
                Log meal
              </ButtonLink>
            ) : undefined
          }
        />
        {summaryQuery.isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : summaryQuery.isError ? (
          <ErrorState error={summaryQuery.error} title="Could not load today’s progress" retry={() => summaryQuery.refetch()} />
        ) : !summary ? (
          <EmptyState size="sm" icon={<Target size={24} />} title="Save your targets to start tracking" message="Once your goals are set, every logged meal fills these bars." />
        ) : (
          <div className="space-y-4">
            <MacroProgress label="Calories" consumed={summary.consumed.calories} goal={summary.adjustedGoals.calories} unit="kcal" tone="kcal" />
            <MacroProgress label="Protein" consumed={summary.consumed.protein} goal={summary.baseGoals.protein} unit="g" tone="protein" />
            <MacroProgress label="Carbs" consumed={summary.consumed.carbs} goal={summary.baseGoals.carbs} unit="g" tone="carbs" />
            <MacroProgress label="Fat" consumed={summary.consumed.fat} goal={summary.baseGoals.fat} unit="g" tone="fat" />
            <p className="border-t border-line pt-3 text-xs text-text-2">
              <span className="tabular font-semibold text-text-1">{formatStat(summary.mealsCount)}</span> {summary.mealsCount === 1 ? 'meal' : 'meals'} logged today.
              {summary.exercise.workoutsCount > 0 ? (
                <>
                  {' '}
                  Your calorie target is raised by <span className="tabular font-semibold text-text-1">{formatStat(Math.round(summary.exercise.caloriesBurned))} kcal</span> for{' '}
                  {formatStat(summary.exercise.workoutsCount)} logged {summary.exercise.workoutsCount === 1 ? 'workout' : 'workouts'}.
                </>
              ) : (
                ' Log a workout and your calorie target rises to cover it.'
              )}
            </p>
          </div>
        )}
      </Card>

      <Card id="goals-form">
        <CardHeader title="Your stats" subtitle="Targets are recalculated every time you save" />
        <form
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Input
              label="Current weight"
              type="number"
              inputMode="decimal"
              min={20}
              max={500}
              step="0.1"
              required
              placeholder="74.5"
              trailing={<span className="text-xs font-semibold">kg</span>}
              value={form.currentWeight}
              error={errors.currentWeight}
              onChange={(e) => set('currentWeight', e.target.value)}
            />
            <Input
              label="Target weight"
              type="number"
              inputMode="decimal"
              min={20}
              max={500}
              step="0.1"
              placeholder="Optional"
              trailing={<span className="text-xs font-semibold">kg</span>}
              value={form.targetWeight}
              error={errors.targetWeight}
              onChange={(e) => set('targetWeight', e.target.value)}
            />
            <Input
              label="Height"
              type="number"
              inputMode="numeric"
              min={80}
              max={260}
              required
              placeholder="178"
              trailing={<span className="text-xs font-semibold">cm</span>}
              value={form.heightCm}
              error={errors.heightCm}
              onChange={(e) => set('heightCm', e.target.value)}
            />
            <Input
              label="Age"
              type="number"
              inputMode="numeric"
              min={13}
              max={120}
              required
              placeholder="29"
              value={form.age}
              error={errors.age}
              onChange={(e) => set('age', e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Sex" name="gender" options={GENDERS} value={form.gender} onChange={(v) => set('gender', v)} hint="Used only for the calorie estimate" />
            <Select label="Activity level" name="activityLevel" options={ACTIVITY_LEVELS} value={form.activityLevel} onChange={(v) => set('activityLevel', v)} />
            <Select label="Goal" name="goal" options={GOALS} value={form.goal} onChange={(v) => set('goal', v)} />
            <Input
              label="Weekly pace"
              type="number"
              inputMode="decimal"
              min={0}
              max={2}
              step="0.1"
              trailing={<span className="text-xs font-semibold">kg / week</span>}
              className="pr-20"
              value={form.weeklyGoal}
              error={errors.weeklyGoal}
              hint={form.goal === 'maintain_weight' ? 'Not used while your goal is to maintain' : 'How much to change each week; 0.25–1 kg is typical. Your goal sets the direction.'}
              onChange={(e) => set('weeklyGoal', e.target.value)}
            />
          </div>

          <Callout tone="info" title="Estimates, not medical advice">
            Resting calories use the Mifflin-St Jeor equation from your weight, height, age and sex; maintenance scales that by activity level, and deficits or surpluses are capped at safe daily amounts. Treat the numbers as a starting point and adjust from what you see in your logs.
          </Callout>

          {attempted && hasErrors ? (
            <p role="alert" className="text-sm text-danger">
              Fix the highlighted fields to save your goals.
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" variant="primary" icon={<Check size={18} />} loading={save.isPending}>
              Save goals
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
