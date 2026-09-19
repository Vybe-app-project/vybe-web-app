import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  capInLb,
  checkHealthGoalsPayload,
  guardrailFormNote,
  guardrailMessageFor,
  mapHealthGoalsError,
  weeklyRateCap,
  type GuardrailField,
  type GuardrailRefusal,
  type HealthGoalsField,
  type HealthGoalsPayload,
} from '../lib/healthGoalRules';
import { UnitsControl } from '../components/UnitsControl';
import {
  cmToFeetInches,
  displayWeight,
  feetInchesToCm,
  formatWeight,
  goalRanges,
  kgToLb,
  lbToKg,
  paceUnit,
  parseWeight,
  useUnits,
  weightUnit,
  type UnitSystem,
} from '../lib/units';
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
  /** The API never defaults this; `unspecified` is a stored value of its own. */
  gender?: 'male' | 'female' | 'other' | 'unspecified';
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
  { value: 'unspecified', label: 'Prefer not to say' },
];

/** Stable ids so a refusal, ours or the server's, can land focus on the field it names. */
const FIELD_IDS: Partial<Record<HealthGoalsField | 'heightFt' | 'heightIn', string>> = {
  currentWeight: 'hg-current-weight',
  targetWeight: 'hg-target-weight',
  heightCm: 'hg-height-cm',
  heightFt: 'hg-height-ft',
  heightIn: 'hg-height-in',
  age: 'hg-age',
  gender: 'hg-gender',
  activityLevel: 'hg-activity',
  goal: 'hg-goal',
  weeklyGoal: 'hg-weekly-pace',
};

/**
 * Recalculate judges the stored goals, so a refusal there means a value saved
 * earlier is the one over the line. The field below shows the server's
 * sentence; this one says what to do about it.
 */
const RECALC_NOTES: Record<GuardrailField, string> = {
  weeklyGoal: 'Your saved pace is above the limit for these stats. Lower it and save again.',
  targetWeight: 'Your saved target weight is below the limit for your height. Raise it and save again.',
  dailyCalorieGoal: 'Your saved daily target is below the limit. Save your goals again to reset it.',
};

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

/**
 * Form values live in the units the person chose (kg/cm or lb/ft-in); the API
 * is always metric. Conversions happen at the edges: seeding the form from
 * saved goals, switching units, and building the save payload.
 */
type FormState = {
  currentWeight: string;
  targetWeight: string;
  /** Metric: centimetres. */
  heightCm: string;
  /** Imperial: whole feet and inches. */
  heightFt: string;
  heightIn: string;
  age: string;
  /** '' until chosen; the API refuses a missing sex rather than assuming one. */
  gender: string;
  activityLevel: string;
  goal: string;
  weeklyGoal: string;
};

const str = (v: number | undefined | null) => (v == null ? '' : String(v));

const formFrom = (g: HealthGoals | null | undefined, system: UnitSystem): FormState => {
  const feetInches = g?.heightCm != null ? cmToFeetInches(g.heightCm) : null;
  return {
    currentWeight: g?.currentWeight != null ? str(displayWeight(g.currentWeight, system)) : '',
    targetWeight: g?.targetWeight != null ? str(displayWeight(g.targetWeight, system)) : '',
    heightCm: g?.heightCm != null ? str(Math.round(g.heightCm)) : '',
    heightFt: feetInches ? str(feetInches.feet) : '',
    heightIn: feetInches ? str(feetInches.inches) : '',
    age: g?.age != null ? str(g.age) : '',
    gender: g?.gender ?? '',
    activityLevel: g?.activityLevel ?? 'moderately_active',
    goal: g?.goal ?? 'maintain_weight',
    weeklyGoal: g?.weeklyGoal != null ? str(system === 'imperial' ? kgToLb(g.weeklyGoal) : g.weeklyGoal) : '0',
  };
};

/** Re-express what is typed when the unit switch flips, so nothing is lost. */
const convertForm = (f: FormState, from: UnitSystem, to: UnitSystem): FormState => {
  if (from === to) return f;
  const w = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return raw;
    return str(to === 'imperial' ? kgToLb(n) : lbToKg(n));
  };
  let heightCm = f.heightCm;
  let heightFt = f.heightFt;
  let heightIn = f.heightIn;
  if (to === 'imperial' && f.heightCm.trim() !== '') {
    const fi = cmToFeetInches(Number(f.heightCm));
    heightFt = str(fi.feet);
    heightIn = str(fi.inches);
  } else if (to === 'metric' && (f.heightFt.trim() !== '' || f.heightIn.trim() !== '')) {
    heightCm = str(Math.round(feetInchesToCm(Number(f.heightFt) || 0, Number(f.heightIn) || 0)));
  }
  return { ...f, currentWeight: w(f.currentWeight), targetWeight: w(f.targetWeight), weeklyGoal: w(f.weeklyGoal), heightCm, heightFt, heightIn };
};

/** Height in cm from whatever the form holds for the active unit system. */
const heightCmOf = (f: FormState, system: UnitSystem): number =>
  system === 'imperial' ? feetInchesToCm(Number(f.heightFt) || 0, Number(f.heightIn) || 0) : Number(f.heightCm);

/**
 * The metric body PUT /health-goals receives. The guardrail pre-check runs
 * on exactly this object, never on the form strings, so lb→kg rounding
 * cannot make the client and the server disagree at a boundary.
 */
const buildPayload = (form: FormState, system: UnitSystem): HealthGoalsPayload => ({
  currentWeight: parseWeight(Number(form.currentWeight), system),
  targetWeight: form.targetWeight ? parseWeight(Number(form.targetWeight), system) : undefined,
  heightCm: Math.round(heightCmOf(form, system) * 10) / 10,
  age: Number(form.age),
  gender: form.gender,
  activityLevel: form.activityLevel,
  goal: form.goal,
  weeklyGoal: form.weeklyGoal ? parseWeight(Number(form.weeklyGoal), system) : 0,
});

const inRange = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max;
};

const responseData = (e: unknown): unknown => (e as { response?: { data?: unknown } } | undefined)?.response?.data;

type ServerErrorKey = HealthGoalsField | 'form';
type ServerErrors = Partial<Record<ServerErrorKey, string>>;

export default function HealthGoals() {
  const qc = useQueryClient();
  const toast = useToast();
  const system = useUnits((s) => s.system);
  const [form, setForm] = useState<FormState>(formFrom(null, system));
  const [formSystem, setFormSystem] = useState<UnitSystem>(system);
  const [seeded, setSeeded] = useState(false);
  const [attempted, setAttempted] = useState(false);
  /** What the guardrail pre-check or the API refused last, keyed by field; `form` is the sentence above Save. */
  const [serverErrors, setServerErrors] = useState<ServerErrors>({});

  // The Units switch (here or in Settings) re-expresses what is typed.
  if (formSystem !== system) {
    setForm((f) => convertForm(f, formSystem, system));
    setFormSystem(system);
  }
  const wUnit = weightUnit(system);
  const ranges = goalRanges(system);
  const heightOk = () => {
    if (system === 'imperial') {
      const totalIn = (Number(form.heightFt) || 0) * 12 + (Number(form.heightIn) || 0);
      return form.heightFt.trim() !== '' && inRange(String(totalIn), ranges.heightIn.min, ranges.heightIn.max) && inRange(form.heightIn || '0', 0, 11.99);
    }
    return inRange(form.heightCm, ranges.heightIn.min, ranges.heightIn.max);
  };

  const goalsQuery = useQuery({
    queryKey: ['health-goals'],
    queryFn: async (): Promise<HealthGoals> => {
      const { data } = await api.get<{ data: HealthGoals }>('/health-goals');
      return data.data ?? {};
    },
  });

  if (goalsQuery.data && !seeded) {
    setSeeded(true);
    setForm(formFrom(goalsQuery.data, system));
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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    // A corrected field stops being flagged at once, and the form-level sentence goes with it.
    const key = (k === 'heightFt' || k === 'heightIn' ? 'heightCm' : k) as ServerErrorKey;
    setServerErrors((e) => (e[key] || e.form ? { ...e, [key]: undefined, form: undefined } : e));
  };

  const weightMessage = `Enter a weight between ${ranges.weight.min} and ${ranges.weight.max.toLocaleString()} ${wUnit}.`;
  const heightMessage = system === 'imperial' ? 'Enter a height between 2 ft 7 in and 8 ft 6 in.' : 'Enter a height between 80 and 260 cm.';
  const paceMessage = `Enter a pace between 0 and ${ranges.pace.max} ${wUnit} per week.`;
  const errors = {
    currentWeight: attempted && !inRange(form.currentWeight, ranges.weight.min, ranges.weight.max) ? weightMessage : undefined,
    heightCm: attempted && !heightOk() ? heightMessage : undefined,
    age: attempted && !inRange(form.age, 13, 120) ? 'Enter an age between 13 and 120.' : undefined,
    gender: attempted && !form.gender ? 'Choose an option.' : undefined,
    targetWeight: attempted && form.targetWeight.trim() !== '' && !inRange(form.targetWeight, ranges.weight.min, ranges.weight.max) ? weightMessage : undefined,
    weeklyGoal: attempted && form.weeklyGoal.trim() !== '' && !inRange(form.weeklyGoal, ranges.pace.min, ranges.pace.max) ? paceMessage : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const fieldError = (k: keyof typeof errors) => errors[k] ?? serverErrors[k];
  const serverFieldFlagged = (Object.keys(serverErrors) as ServerErrorKey[]).some((k) => k !== 'form' && serverErrors[k]);
  const formAlert = serverErrors.form ?? ((attempted && hasErrors) || serverFieldFlagged ? 'Fix the highlighted fields to save your goals.' : undefined);

  /** The API's range copy is metric; the form says it in the units on screen. */
  const unitMessageFor = (field: HealthGoalsField, fallback: string) => {
    if (field === 'currentWeight' || field === 'targetWeight') return weightMessage;
    if (field === 'heightCm') return heightMessage;
    if (field === 'weeklyGoal') return paceMessage;
    return fallback;
  };

  const focusField = (field: HealthGoalsField): boolean => {
    const id = field === 'heightCm' && system === 'imperial' ? FIELD_IDS.heightFt : FIELD_IDS[field];
    const el = id ? document.getElementById(id) : null;
    el?.focus();
    return !!el;
  };

  /**
   * Place a guardrail refusal: the server's sentence (in the units on
   * screen) under the field it names, focus there, and a second sentence
   * above Save when the field copy alone cannot explain what to do. A
   * refusal on the daily target has no input on this form yet, so it goes
   * above Save on its own.
   */
  const showRefusal = (refusal: GuardrailRefusal, payload: HealthGoalsPayload | null, note?: string): boolean => {
    const message = guardrailMessageFor(refusal, system);
    if (refusal.field === 'dailyCalorieGoal') {
      setServerErrors({ form: note ? `${message} ${note}` : message });
      return false;
    }
    setServerErrors({ [refusal.field]: message, form: note ?? (payload ? guardrailFormNote(refusal, payload) : undefined) });
    return focusField(refusal.field);
  };

  const showFieldError = (field: HealthGoalsField, message: string): boolean => {
    setServerErrors({ [field]: unitMessageFor(field, message) });
    return focusField(field);
  };

  const save = useMutation({
    mutationFn: async (payload: HealthGoalsPayload) => {
      // The API stays metric; only the form speaks the chosen units.
      const { data } = await api.put<{ data: HealthGoals }>('/health-goals', payload);
      return data.data;
    },
    onSuccess: (data) => {
      toast.success('Goals saved');
      setAttempted(false);
      setServerErrors({});
      qc.setQueryData(['health-goals'], data);
      setForm(formFrom(data, system));
      qc.invalidateQueries({ queryKey: ['health-goals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
      qc.invalidateQueries({ queryKey: ['water'] });
    },
    onError: (e, payload) => {
      const m = mapHealthGoalsError(responseData(e), 'Could not save goals');
      if (m.kind === 'guardrail') {
        showRefusal(m.refusal, payload);
        return;
      }
      if (m.kind === 'field') {
        showFieldError(m.field, m.message);
        return;
      }
      setServerErrors({ form: m.message });
    },
  });

  const recalculate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/health-goals/recalculate');
      return data;
    },
    onSuccess: () => {
      toast.success('Targets recalculated');
      setServerErrors({});
      qc.invalidateQueries({ queryKey: ['health-goals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
    },
    onError: (e) => {
      const m = mapHealthGoalsError(responseData(e), 'Could not recalculate targets');
      // The button lives in the header, so anything that cannot land on a field is said out loud.
      if (m.kind === 'guardrail') {
        if (!showRefusal(m.refusal, null, RECALC_NOTES[m.refusal.field])) toast.error(RECALC_NOTES[m.refusal.field]);
        return;
      }
      if (m.kind === 'field') {
        if (!showFieldError(m.field, m.message)) toast.error(m.message);
        return;
      }
      toast.error(m.message);
    },
  });

  const submit = () => {
    setAttempted(true);
    setServerErrors({});
    if (
      !inRange(form.currentWeight, ranges.weight.min, ranges.weight.max) ||
      !heightOk() ||
      !inRange(form.age, 13, 120) ||
      !form.gender ||
      (form.targetWeight.trim() !== '' && !inRange(form.targetWeight, ranges.weight.min, ranges.weight.max)) ||
      (form.weeklyGoal.trim() !== '' && !inRange(form.weeklyGoal, ranges.pace.min, ranges.pace.max))
    ) {
      return;
    }
    // Same numbers, same rules, same words as the server; a refusal here saves the round-trip.
    const payload = buildPayload(form, system);
    const refusal = checkHealthGoalsPayload(payload);
    if (refusal) {
      showRefusal(refusal, payload);
      return;
    }
    save.mutate(payload);
  };

  const goals = goalsQuery.data;
  const summary = summaryQuery.data;
  const hasTargets = Boolean(goals?.dailyCalorieGoal);

  const recalcDisabled = !hasTargets || recalculate.isPending;

  // The pace cap at the typed weight, in the units on screen (1 % of body weight a week by default).
  // In lb it is the largest tenth the form accepts, so the hint never names a value Save refuses.
  const capKg = inRange(form.currentWeight, ranges.weight.min, ranges.weight.max) ? weeklyRateCap(parseWeight(Number(form.currentWeight), system)) : null;
  const capShown = capKg == null ? null : system === 'imperial' ? capInLb(capKg) : capKg;
  const paceHint = [
    form.goal === 'maintain_weight'
      ? 'Kept for when you change your goal.'
      : `How much to change each week; ${system === 'imperial' ? '0.5–2 lb' : '0.25–1 kg'} is typical. Your goal sets the direction.`,
    capShown != null ? `Up to ${capShown} ${wUnit} a week at your weight.` : null,
  ]
    .filter(Boolean)
    .join(' ');

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
              value={goals.targetWeight ? formatStat(displayWeight(goals.targetWeight, system)) : '—'}
              unit={goals.targetWeight ? wUnit : undefined}
              hint={
                goals.targetWeight && goals.currentWeight
                  ? `${formatWeight(Math.abs(goals.targetWeight - goals.currentWeight), system)} ${goals.targetWeight < goals.currentWeight ? 'to lose' : goals.targetWeight > goals.currentWeight ? 'to gain' : 'to hold'}`
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
        <CardHeader title="Your stats" subtitle="Targets are recalculated every time you save" action={<UnitsControl size="sm" />} />
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
              id={FIELD_IDS.currentWeight}
              label="Current weight"
              type="number"
              inputMode="decimal"
              min={ranges.weight.min}
              max={ranges.weight.max}
              step="0.1"
              required
              placeholder={system === 'imperial' ? '164' : '74.5'}
              trailing={<span className="text-xs font-semibold">{wUnit}</span>}
              value={form.currentWeight}
              error={fieldError('currentWeight')}
              onChange={(e) => set('currentWeight', e.target.value)}
            />
            <Input
              id={FIELD_IDS.targetWeight}
              label="Target weight"
              type="number"
              inputMode="decimal"
              min={ranges.weight.min}
              max={ranges.weight.max}
              step="0.1"
              placeholder="Optional"
              trailing={<span className="text-xs font-semibold">{wUnit}</span>}
              value={form.targetWeight}
              error={fieldError('targetWeight')}
              onChange={(e) => set('targetWeight', e.target.value)}
            />
            {system === 'imperial' ? (
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="type-label mb-1.5 col-span-2 block text-text-2">Height</legend>
                <Input
                  id={FIELD_IDS.heightFt}
                  label="Height, feet"
                  hideLabel
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={8}
                  required
                  placeholder="5"
                  trailing={<span className="text-xs font-semibold">ft</span>}
                  value={form.heightFt}
                  error={fieldError('heightCm')}
                  onChange={(e) => set('heightFt', e.target.value)}
                />
                <Input
                  id={FIELD_IDS.heightIn}
                  label="Height, inches"
                  hideLabel
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={11}
                  placeholder="11"
                  trailing={<span className="text-xs font-semibold">in</span>}
                  value={form.heightIn}
                  onChange={(e) => set('heightIn', e.target.value)}
                />
              </fieldset>
            ) : (
              <Input
                id={FIELD_IDS.heightCm}
                label="Height"
                type="number"
                inputMode="numeric"
                min={80}
                max={260}
                required
                placeholder="178"
                trailing={<span className="text-xs font-semibold">cm</span>}
                value={form.heightCm}
                error={fieldError('heightCm')}
                onChange={(e) => set('heightCm', e.target.value)}
              />
            )}
            <Input
              id={FIELD_IDS.age}
              label="Age"
              type="number"
              inputMode="numeric"
              min={13}
              max={120}
              required
              placeholder="29"
              value={form.age}
              error={fieldError('age')}
              onChange={(e) => set('age', e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              id={FIELD_IDS.gender}
              label="Sex"
              name="gender"
              options={GENDERS}
              placeholder="Select…"
              value={form.gender || null}
              error={fieldError('gender')}
              onChange={(v) => set('gender', v)}
              hint="Used only for the calorie estimate. Prefer not to say uses the average of the two estimates."
            />
            <Select id={FIELD_IDS.activityLevel} label="Activity level" name="activityLevel" options={ACTIVITY_LEVELS} value={form.activityLevel} error={serverErrors.activityLevel} onChange={(v) => set('activityLevel', v)} />
            <Select id={FIELD_IDS.goal} label="Goal" name="goal" options={GOALS} value={form.goal} error={serverErrors.goal} onChange={(v) => set('goal', v)} />
            <Input
              id={FIELD_IDS.weeklyGoal}
              label="Weekly pace"
              type="number"
              inputMode="decimal"
              min={0}
              max={ranges.pace.max}
              step="0.1"
              trailing={<span className="text-xs font-semibold">{paceUnit(system)}</span>}
              className="pr-20"
              value={form.weeklyGoal}
              error={fieldError('weeklyGoal')}
              hint={paceHint}
              onChange={(e) => set('weeklyGoal', e.target.value)}
            />
          </div>

          <Callout tone="info" title="Estimates, not medical advice">
            Resting calories use the Mifflin-St Jeor equation from your weight, height, age and sex; maintenance scales that by activity level, and deficits or surpluses are capped at safe daily amounts. Treat the numbers as a starting point and adjust from what you see in your logs.
          </Callout>

          {formAlert ? (
            <p role="alert" className="text-sm text-danger">
              {formAlert}
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
