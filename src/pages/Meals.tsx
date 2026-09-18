import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isValid, isYesterday, parseISO } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  Ring,
  Section,
  Select,
  Skeleton,
  Spinner,
  StatTile,
  Stepper,
  Tabs,
  VIZ,
  cx,
  formatStat,
  humanize,
  useIsCompact,
  usePulse,
  useToast,
} from './ui';
import { Utensils, Plus, Trash, Heart, Clock, BookOpen, Flame, Target, ChevronRight, Search } from './icons';

/* ------------------------------------------------------------------ types */

export type Nutrition = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
};

export type Meal = {
  _id: string;
  food_name: string;
  image_url?: string;
  serving_size?: string;
  meal_type?: string;
  timestamp: string;
  nutrition?: Nutrition;
  likes?: string[];
  comments?: unknown[];
  isPublic?: boolean;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string } | string;
};

type TodaySummary = {
  totalMeals: number;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
};

type RangeResponse = {
  meals: Meal[];
  summary: { totalCalories: number; totalProtein: number; totalCarbs: number; totalFat: number };
  count: number;
  range: string;
};

type StreakResponse = { streak: number; lastLoggedDate: string | null; message?: string | null };

type MacroGoals = { calories: number; protein: number; carbs: number; fat: number };

type DailySummaryResponse = {
  data: {
    baseGoals: MacroGoals;
    adjustedGoals: MacroGoals;
    consumed: MacroGoals;
    exercise: { caloriesBurned: number; workoutsCount: number };
    remaining: MacroGoals;
    mealsCount: number;
  };
};

type FoodNutrient = {
  nutrientId?: number;
  nutrientName: string;
  unitName?: string;
  value: number;
};

type FoodSearchItem = {
  fdcId?: number;
  description: string;
  brandName?: string;
  brandOwner?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: FoodNutrient[];
};

type FoodSearchResponse = {
  foods: FoodSearchItem[];
  totalHits: number;
  sourceLabel?: string;
};

/* ------------------------------------------------------- shared meal helpers */

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** Humanised options for the meal-type Select, shared by every Fuel page. */
export const MEAL_TYPE_OPTIONS = MEAL_TYPES.map((value) => ({ value, label: humanize(value) }));

export const mealTypeLabel = (value?: string | null) => humanize(value) || 'Meal';

/** Sensible default for a new entry based on the time of day. */
export function defaultMealType(date = new Date()): MealType {
  const h = date.getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  return 'dinner';
}

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const MACRO_ITEMS = [
  { key: 'protein', label: 'Protein', color: VIZ.protein },
  { key: 'carbs', label: 'Carbs', color: VIZ.carbs },
  { key: 'fat', label: 'Fat', color: VIZ.fat },
] as const;

/**
 * One-line macro summary: kcal in condensed numerals, then protein / carbs /
 * fat with the fixed semantic dot colours (identical to the rings and charts).
 */
export function MacroLine({
  nutrition,
  className,
  emphasis = 'md',
}: {
  nutrition?: Nutrition | null;
  className?: string;
  emphasis?: 'sm' | 'md';
}) {
  const kcal = Math.round(nutrition?.calories ?? 0);
  return (
    <ul className={cx('tabular flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-text-2', className)} aria-label="Nutrition">
      <li aria-label={`${formatStat(kcal)} calories`}>
        <span className={cx('type-stat text-text-1', emphasis === 'md' ? 'text-md' : 'text-sm')}>{formatStat(kcal)}</span>
        <span className="ml-1">kcal</span>
      </li>
      {MACRO_ITEMS.map((m) => {
        const v = Math.round(nutrition?.[m.key] ?? 0);
        return (
          <li key={m.key} className="inline-flex items-center gap-1.5" aria-label={`${m.label} ${v} grams`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: m.color }} />
            <span>
              <span className="font-semibold text-text-1">{v}</span>g
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- utilities */

const NUTRIENT_IDS = {
  calories: 1008,
  protein: 1003,
  carbs: 1005,
  fat: 1004,
  fiber: 1079,
  sugar: 2000,
  sodium: 1093,
} as const;

/** Map a USDA-style nutrient list onto Vybe's nutrition shape (per 100g/serving). */
export function nutritionFromFood(food: FoodSearchItem): Nutrition {
  const byId = new Map<number, number>();
  for (const n of food.foodNutrients ?? []) {
    if (typeof n.nutrientId === 'number') byId.set(n.nutrientId, n.value);
  }
  const pick = (id: number) => Math.round((byId.get(id) ?? 0) * 10) / 10;
  return {
    calories: pick(NUTRIENT_IDS.calories),
    protein: pick(NUTRIENT_IDS.protein),
    carbs: pick(NUTRIENT_IDS.carbs),
    fat: pick(NUTRIENT_IDS.fat),
    fiber: pick(NUTRIENT_IDS.fiber),
    sugar: pick(NUTRIENT_IDS.sugar),
    sodium: pick(NUTRIENT_IDS.sodium),
  };
}

const scaleNutrition = (n: Nutrition, factor: number): Nutrition =>
  Object.fromEntries(
    Object.entries(n).map(([k, v]) => [k, Math.round((Number(v) || 0) * factor * 10) / 10]),
  ) as Nutrition;

const round = (v: number) => Math.round(v * 10) / 10;

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const timeOf = (iso?: string) => {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? d : null;
};

const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMM'));

/* ------------------------------------------------------------- macro rings */

const RINGS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g', color: 'protein' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: 'carbs' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'fat' },
] as const;

function MacroRing({
  label,
  value,
  goal,
  unit,
  color,
  size,
}: {
  label: string;
  value: number;
  goal: number;
  unit: string;
  color: (typeof RINGS)[number]['color'];
  size: number;
}) {
  const hasGoal = goal > 0;
  const over = hasGoal && value > goal;
  return (
    <div className="flex flex-col items-center gap-2">
      <Ring
        value={value}
        max={hasGoal ? goal : 0}
        size={size}
        stroke={size >= 96 ? 10 : 8}
        color={over ? 'accent' : color}
        label={hasGoal ? `${label} ${Math.round(value)} of ${Math.round(goal)} ${unit}` : `${label} ${Math.round(value)} ${unit}`}
      >
        <span className={cx('leading-none', size >= 96 ? 'text-xl' : 'text-lg', over && 'text-accent-text')}>{formatStat(Math.round(value))}</span>
        {hasGoal ? <span className="mt-0.5 text-2xs font-semibold tracking-normal text-text-3 [font-variation-settings:'wdth'_100]">of {formatStat(Math.round(goal))}</span> : null}
      </Ring>
      <span className="type-label text-text-2">
        {label}
        {!hasGoal ? <span className="text-text-3"> {unit}</span> : null}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------- food search UI */

type SelectedFood = {
  key: string;
  name: string;
  brand?: string;
  servings: number;
  baseNutrition: Nutrition;
  servingLabel: string;
};

function FoodSearch({ onAdd }: { onAdd: (food: SelectedFood) => void }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 400);
  const ready = debounced.trim().length >= 2;

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['food-search', debounced],
    queryFn: async (): Promise<FoodSearchResponse> => {
      const { data } = await api.get<FoodSearchResponse>('/food/search', {
        params: { q: debounced, pageSize: 15 },
      });
      return data;
    },
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  const foods = data?.foods ?? [];

  return (
    <div className="space-y-2">
      <Input
        type="search"
        inputMode="search"
        autoComplete="off"
        label="Search foods"
        placeholder="Greek yogurt, banana, chicken breast…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        leading={<Search size={18} />}
        trailing={isFetching ? <Spinner size={16} className="mr-1 text-text-2" /> : undefined}
        hint={!ready ? 'Type at least two letters to search the food database.' : undefined}
      />

      {isError ? (
        <Callout tone="warning" title="Food search is unavailable" action={<Button size="sm" variant="secondary" onClick={() => void refetch()}>Retry</Button>}>
          {errMsg(error, 'Try again in a moment, or enter the macros yourself below.')}
        </Callout>
      ) : null}

      {ready && !isFetching && !isError && foods.length === 0 ? (
        <p className="text-xs text-text-2">No foods matched “{debounced.trim()}”. Try a simpler name, or enter the macros yourself below.</p>
      ) : null}

      {foods.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-line bg-surface-1">
          <ul className="max-h-64 divide-y divide-line overflow-y-auto" aria-label="Search results">
            {foods.map((food, i) => {
              const nutrition = nutritionFromFood(food);
              const servingLabel =
                food.servingSize && food.servingSizeUnit ? `${food.servingSize}${food.servingSizeUnit}` : '1 serving';
              const brand = food.brandName || food.brandOwner;
              return (
                <li key={`${food.fdcId ?? 'local'}-${i}`}>
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors dur-1 hover:bg-surface-2"
                    onClick={() =>
                      onAdd({
                        key: `${food.fdcId ?? food.description}-${i}-${Date.now()}`,
                        name: food.description,
                        brand,
                        servings: 1,
                        baseNutrition: nutrition,
                        servingLabel,
                      })
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-1">{food.description}</span>
                      <span className="block truncate text-xs text-text-2">
                        {[brand, servingLabel].filter(Boolean).join(', ')}
                      </span>
                      <MacroLine nutrition={nutrition} emphasis="sm" className="mt-0.5" />
                    </span>
                    <Plus size={18} className="shrink-0 text-brand" />
                  </button>
                </li>
              );
            })}
          </ul>
          {data?.sourceLabel ? <p className="border-t border-line px-3 py-1.5 text-2xs text-text-3">Nutrition data from {data.sourceLabel}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- log modal */

const EMPTY_MANUAL: Nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };

const MANUAL_FIELDS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;

export function LogMealModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [mealType, setMealType] = useState<string>(() => defaultMealType());
  const [servingSize, setServingSize] = useState('');
  const [foods, setFoods] = useState<SelectedFood[]>([]);
  const [manual, setManual] = useState<Nutrition>(EMPTY_MANUAL);
  const [nameError, setNameError] = useState<string | undefined>();
  const nameTouched = useRef(false);
  const nameId = 'log-meal-name';

  const totals = useMemo<Nutrition>(() => {
    if (foods.length === 0) return manual;
    return foods.reduce<Nutrition>(
      (acc, f) => {
        const scaled = scaleNutrition(f.baseNutrition, f.servings);
        return {
          calories: round((acc.calories ?? 0) + (scaled.calories ?? 0)),
          protein: round((acc.protein ?? 0) + (scaled.protein ?? 0)),
          carbs: round((acc.carbs ?? 0) + (scaled.carbs ?? 0)),
          fat: round((acc.fat ?? 0) + (scaled.fat ?? 0)),
          fiber: round((acc.fiber ?? 0) + (scaled.fiber ?? 0)),
          sugar: round((acc.sugar ?? 0) + (scaled.sugar ?? 0)),
          sodium: round((acc.sodium ?? 0) + (scaled.sodium ?? 0)),
        };
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
    );
  }, [foods, manual]);

  const reset = () => {
    setName('');
    setMealType(defaultMealType());
    setServingSize('');
    setFoods([]);
    setManual(EMPTY_MANUAL);
    setNameError(undefined);
    nameTouched.current = false;
  };

  const log = useMutation({
    mutationFn: async () => {
      const foodName = name.trim() || foods[0]?.name?.trim();
      if (!foodName) {
        setNameError('Give the meal a name so you can find it later.');
        document.getElementById(nameId)?.focus();
        throw new Error('Give the meal a name');
      }
      const { data } = await api.post('/meals/log', {
        food_name: foodName,
        meal_type: mealType,
        serving_size: servingSize.trim() || undefined,
        nutrition: totals,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Meal logged');
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
      reset();
      onClose();
    },
    onError: (e) => {
      if (!nameError) toast.error(errMsg(e, 'Could not log meal'));
    },
  });

  const formId = 'log-meal-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a meal"
      description="Search the food database or enter the macros yourself."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={log.isPending}>
            Log meal
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          log.mutate();
        }}
      >
        <Input
          id={nameId}
          label="Meal name"
          placeholder="Post-workout bowl"
          value={name}
          error={nameError}
          autoComplete="off"
          onChange={(e) => {
            nameTouched.current = true;
            setNameError(undefined);
            setName(e.target.value);
          }}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Meal type" value={mealType} onChange={setMealType} options={MEAL_TYPE_OPTIONS} />
          <Input
            label="Serving size"
            placeholder="1 bowl, 200 g"
            hint="Optional"
            value={servingSize}
            onChange={(e) => setServingSize(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <FoodSearch
            onAdd={(food) => {
              setFoods((prev) => [...prev, food]);
              if (!nameTouched.current && !name) setName(food.name);
            }}
          />

          {foods.length > 0 ? (
            <ul className="space-y-2" aria-label="Foods in this meal">
              {foods.map((food, i) => {
                const scaled = scaleNutrition(food.baseNutrition, food.servings);
                return (
                  <li key={food.key} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-1 p-3">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-sm font-medium text-text-1">{food.name}</p>
                      <p className="truncate text-xs text-text-2">{[food.brand, food.servingLabel].filter(Boolean).join(', ')}</p>
                      <MacroLine nutrition={scaled} emphasis="sm" className="mt-1" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Stepper
                        label={`Servings of ${food.name}`}
                        hideLabel
                        value={food.servings}
                        min={0.5}
                        max={20}
                        step={0.5}
                        format={(v) => `${v}×`}
                        onChange={(next) => setFoods((prev) => prev.map((f, idx) => (idx === i ? { ...f, servings: next } : f)))}
                      />
                      <IconButton
                        label={`Remove ${food.name}`}
                        size={44}
                        variant="ghost"
                        onClick={() => setFoods((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash size={18} />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <fieldset className="space-y-2">
              <legend className="type-label text-text-2">Or enter the macros yourself</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MANUAL_FIELDS.map((f) => (
                  <Input
                    key={f.key}
                    label={`${f.label} (${f.unit})`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    className="tabular"
                    value={String(manual[f.key] ?? 0)}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setManual((m) => ({ ...m, [f.key]: Math.max(0, Number(e.target.value) || 0) }))}
                  />
                ))}
              </div>
            </fieldset>
          )}
        </div>

        <div className="rounded-md bg-surface-2 p-3" aria-live="polite">
          <p className="type-label text-text-2">This meal</p>
          <MacroLine nutrition={totals} className="mt-1 text-sm" />
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- meal card */

function MealCard({
  meal,
  rangeKey,
  onDelete,
}: {
  meal: Meal;
  rangeKey: string;
  onDelete: (meal: Meal) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const pulse = usePulse();
  const liked = Boolean(user && (meal.likes ?? []).some((id) => String(id) === user._id));
  const ts = timeOf(meal.timestamp);
  const href = `/meals/${meal._id}`;

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.put(`/meals/like/${meal._id}`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onMutate: async () => {
      const key = ['meals', 'range', rangeKey];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RangeResponse>(key);
      if (previous && user) {
        qc.setQueryData<RangeResponse>(key, {
          ...previous,
          meals: previous.meals.map((m) =>
            m._id === meal._id
              ? {
                  ...m,
                  likes: liked ? (m.likes ?? []).filter((id) => String(id) !== user._id) : [...(m.likes ?? []), user._id],
                }
              : m,
          ),
        });
      }
      return { previous, key };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      toast.error(errMsg(e, 'Could not update like'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['meals'] }),
  });

  return (
    <Card padded={false} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
      <Link to={href} viewTransition tabIndex={-1} aria-hidden="true" className="shrink-0">
        {meal.image_url ? (
          <img src={mediaUrl(meal.image_url)} alt="" loading="lazy" className="h-[72px] w-[72px] rounded-md bg-surface-2 object-cover" />
        ) : (
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-md bg-surface-2 text-text-3">
            <Utensils size={24} />
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={href} viewTransition className="-my-2.5 block truncate rounded-xs py-2.5 text-md font-semibold text-text-1 hover:underline">
              {meal.food_name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
              <Badge tone="neutral">{mealTypeLabel(meal.meal_type)}</Badge>
              {ts ? (
                <span className="inline-flex items-center gap-1">
                  <Clock size={13} />
                  <time dateTime={meal.timestamp}>{format(ts, 'p')}</time>
                </span>
              ) : null}
              {meal.serving_size ? <span className="truncate">{meal.serving_size}</span> : null}
            </div>
          </div>
          <Menu
            label={`Options for ${meal.food_name}`}
            size={40}
            items={[
              { label: 'View details', icon: <ChevronRight size={18} />, to: href },
              { label: 'Delete meal', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => onDelete(meal) },
            ]}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <MacroLine nutrition={meal.nutrition} />
          <button
            type="button"
            className={cx(
              'inline-flex h-10 min-w-10 items-center gap-1.5 rounded-sm px-2.5 text-xs font-semibold transition-colors dur-1',
              liked ? 'text-accent-text' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
            )}
            aria-pressed={liked}
            aria-label={liked ? 'Unlike' : 'Like'}
            onClick={() => {
              pulse.pulse();
              like.mutate();
            }}
            disabled={like.isPending}
          >
            <Heart size={18} filled={liked} className={cx(pulse.className, liked && 'text-accent')} />
            <span className="tabular">{(meal.likes ?? []).length}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}

function MealListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading meals">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex gap-3 p-3 sm:p-4">
          <Skeleton className="h-[72px] w-[72px] rounded-md" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

type Range = 'today' | 'week';

export default function Meals() {
  const qc = useQueryClient();
  const toast = useToast();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>('today');
  const [modal, setModal] = useState(() => params.get('log') === '1');
  const [pendingDelete, setPendingDelete] = useState<Meal | null>(null);

  // Deep-link contract: /meals?log=1 (Log sheet, manifest shortcut) opens the entry modal.
  useEffect(() => {
    if (params.get('log') === '1') setModal(true);
  }, [params]);

  const openLog = () => setModal(true);
  const closeLog = () => {
    setModal(false);
    if (params.has('log')) {
      const next = new URLSearchParams(params);
      next.delete('log');
      setParams(next, { replace: true });
    }
  };

  const rangeQuery = useQuery({
    queryKey: ['meals', 'range', range],
    queryFn: async (): Promise<RangeResponse> => {
      const { data } = await api.get<RangeResponse>('/meals/by-range', { params: { range } });
      return data;
    },
  });

  const todayQuery = useQuery({
    queryKey: ['meals', 'today'],
    queryFn: async (): Promise<TodaySummary> => {
      const { data } = await api.get<TodaySummary>('/meals/today');
      return data;
    },
  });

  const streakQuery = useQuery({
    queryKey: ['meals', 'streak'],
    queryFn: async (): Promise<StreakResponse> => {
      const { data } = await api.get<StreakResponse>('/meals/streak');
      return data;
    },
  });

  const goalsQuery = useQuery({
    queryKey: ['nutrition-summary'],
    queryFn: async (): Promise<DailySummaryResponse['data'] | null> => {
      try {
        const { data } = await api.get<DailySummaryResponse>('/health-goals/daily-summary', {
          params: { timezoneOffsetMinutes: new Date().getTimezoneOffset() },
        });
        return data.data;
      } catch (e: unknown) {
        // 404 simply means the user has not set health goals yet — that is a
        // first-run state, not an error.
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) return null;
        throw e;
      }
    },
    retry: false,
  });

  const remove = useMutation({
    mutationFn: async (meal: Meal) => {
      await api.delete(`/meals/${meal._id}`);
      return meal._id;
    },
    onMutate: async (meal) => {
      const key = ['meals', 'range', range];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RangeResponse>(key);
      if (previous) {
        qc.setQueryData<RangeResponse>(key, {
          ...previous,
          meals: previous.meals.filter((m) => m._id !== meal._id),
          count: Math.max(0, previous.count - 1),
        });
      }
      return { previous, key };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      toast.error(errMsg(e, 'Could not delete meal'));
    },
    onSuccess: () => toast.success('Meal deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
    },
  });

  const summary = goalsQuery.data ?? null;
  const goals = summary?.adjustedGoals ?? summary?.baseGoals ?? null;
  const hasGoals = Boolean(goals && goals.calories > 0);
  const consumed = {
    calories: todayQuery.data?.totalCalories ?? 0,
    protein: todayQuery.data?.totalProtein ?? 0,
    carbs: todayQuery.data?.totalCarbs ?? 0,
    fat: todayQuery.data?.totalFat ?? 0,
  };
  const remainingKcal = hasGoals && goals ? Math.round(goals.calories - consumed.calories) : null;
  const burned = Math.round(summary?.exercise?.caloriesBurned ?? 0);
  const workouts = summary?.exercise?.workoutsCount ?? 0;
  const streak = streakQuery.data?.streak ?? 0;
  const mealsToday = todayQuery.data?.totalMeals ?? 0;

  const meals = rangeQuery.data?.meals ?? [];
  const groups = useMemo(() => {
    if (range === 'today') return [{ key: 'today', label: null as string | null, meals }];
    const byDay = new Map<string, { key: string; label: string | null; date: number; meals: Meal[] }>();
    for (const m of meals) {
      const d = timeOf(m.timestamp);
      const key = d ? format(d, 'yyyy-MM-dd') : 'undated';
      const entry = byDay.get(key) ?? { key, label: d ? dayLabel(d) : 'Undated', date: d ? d.getTime() : 0, meals: [] };
      entry.meals.push(m);
      byDay.set(key, entry);
    }
    return [...byDay.values()].sort((a, b) => b.date - a.date);
  }, [meals, range]);

  const subtitle = streakQuery.data
    ? streak > 0
      ? `${streak}-day logging streak. Keep it going.`
      : 'Log a meal today to start a streak.'
    : 'Track what you eat, every day.';

  const ringSize = compact ? 72 : 96;
  const ringsLoading = todayQuery.isLoading || goalsQuery.isLoading;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Meals"
        subtitle={subtitle}
        actions={
          <>
            <ButtonLink to="/meals/templates" variant="secondary" icon={<BookOpen size={18} />}>
              Templates
            </ButtonLink>
            <Button variant="primary" icon={<Plus size={18} />} onClick={openLog}>
              Log meal
            </Button>
          </>
        }
        mobileActions={
          <IconButton label="Log meal" onClick={openLog}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <Section title="Today" description={format(new Date(), 'EEEE, d MMMM')}>
        <Card className="space-y-5">
          {ringsLoading ? (
            <div className="grid grid-cols-4 justify-items-center gap-3" aria-busy="true" aria-label="Loading today’s nutrition">
              {RINGS.map((r) => (
                <div key={r.key} className="flex flex-col items-center gap-2">
                  <Skeleton className="rounded-full" style={{ width: ringSize, height: ringSize }} />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : todayQuery.isError ? (
            <ErrorState
              title="Couldn’t load today’s nutrition"
              error={todayQuery.error}
              onRetry={() => todayQuery.refetch()}
              className="py-6"
            />
          ) : (
            <div className="grid grid-cols-4 justify-items-center gap-2 sm:gap-4">
              {RINGS.map((r) => (
                <MacroRing
                  key={r.key}
                  label={r.label}
                  unit={r.unit}
                  color={r.color}
                  size={ringSize}
                  value={consumed[r.key]}
                  goal={hasGoals && goals ? goals[r.key] : 0}
                />
              ))}
            </div>
          )}

          {!ringsLoading && !todayQuery.isError ? (
            goalsQuery.isError ? (
              <Callout
                tone="warning"
                title="Couldn’t load your goals"
                action={
                  <Button size="sm" variant="secondary" onClick={() => void goalsQuery.refetch()}>
                    Retry
                  </Button>
                }
              >
                Today’s totals are shown without targets. {errMsg(goalsQuery.error, '')}
              </Callout>
            ) : !hasGoals ? (
              <Callout
                tone="brand"
                icon={<Target size={20} className="text-brand" />}
                title="Set your daily targets"
                action={
                  <ButtonLink to="/health/goals" size="sm" variant="primary">
                    Set goals
                  </ButtonLink>
                }
              >
                Add calorie and macro goals and these rings fill as you log.
              </Callout>
            ) : null
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {remainingKcal !== null ? (
              <StatTile
                label={remainingKcal >= 0 ? 'Remaining today' : 'Over target'}
                value={formatStat(Math.abs(remainingKcal))}
                unit="kcal"
                tone={remainingKcal >= 0 ? 'brand' : 'accent'}
                hint={burned > 0 ? `+${formatStat(burned)} kcal from ${workouts} ${plural(workouts, 'workout')}` : 'No workouts yet today'}
                className="col-span-2 sm:col-span-1"
              />
            ) : (
              <StatTile
                label="Eaten today"
                value={formatStat(Math.round(consumed.calories))}
                unit="kcal"
                loading={todayQuery.isLoading}
                hint={burned > 0 ? `+${formatStat(burned)} kcal from ${workouts} ${plural(workouts, 'workout')}` : 'Set goals to see what is left'}
                className="col-span-2 sm:col-span-1"
              />
            )}
            <StatTile
              label="Streak"
              value={formatStat(streak)}
              unit={plural(streak, 'day')}
              icon={<Flame size={18} />}
              tone={streak > 0 ? 'accent' : 'neutral'}
              loading={streakQuery.isLoading}
              hint={streak > 0 ? 'Logged daily' : 'Starts today'}
            />
            <StatTile
              label="Logged"
              value={formatStat(mealsToday)}
              unit={plural(mealsToday, 'meal')}
              icon={<Utensils size={18} />}
              loading={todayQuery.isLoading}
              hint="So far today"
            />
          </div>
        </Card>
      </Section>

      <Section
        title="Log"
        action={
          <Tabs
            variant="segmented"
            size="sm"
            aria-label="Range"
            tabs={[
              { key: 'today', label: 'Today' },
              { key: 'week', label: 'This week' },
            ]}
            value={range}
            onChange={(k: string) => setRange(k as Range)}
          />
        }
      >
        {rangeQuery.isLoading ? (
          <MealListSkeleton />
        ) : rangeQuery.isError ? (
          <ErrorState title="Couldn’t load your meals" error={rangeQuery.error} onRetry={() => rangeQuery.refetch()} />
        ) : meals.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title={range === 'today' ? 'Nothing logged today' : 'Nothing logged this week'}
              message={
                range === 'today'
                  ? 'Log your first meal and the rings above start to fill.'
                  : 'Meals you log over the next seven days show up here, grouped by day.'
              }
              action={{ label: 'Log meal', onClick: openLog, icon: <Plus size={18} />, variant: 'primary' }}
              secondaryAction={{ label: 'Use a template', to: '/meals/templates', icon: <BookOpen size={18} /> }}
            />
          </Card>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-text-2">
              <span className="tabular font-semibold text-text-1">{formatStat(rangeQuery.data?.count ?? meals.length)}</span>{' '}
              {plural(rangeQuery.data?.count ?? meals.length, 'meal')} totalling{' '}
              <span className="tabular font-semibold text-text-1">{formatStat(Math.round(rangeQuery.data?.summary.totalCalories ?? 0))}</span> kcal
              {range === 'today' ? ' today' : ' this week'}.
            </p>
            {groups.map((g) => (
              <div key={g.key} className="space-y-3">
                {g.label ? (
                  <h3 className="type-label flex items-baseline justify-between text-text-2">
                    <span>{g.label}</span>
                    <span className="tabular text-text-3">
                      {formatStat(Math.round(g.meals.reduce((s, m) => s + (m.nutrition?.calories ?? 0), 0)))} kcal
                    </span>
                  </h3>
                ) : null}
                {g.meals.map((meal) => (
                  <MealCard key={meal._id} meal={meal} rangeKey={range} onDelete={(m) => setPendingDelete(m)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      <LogMealModal open={modal} onClose={closeLog} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this meal?"
        message={`“${pendingDelete?.food_name ?? ''}” will be removed from your log and today’s totals.`}
        confirmLabel="Delete meal"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
