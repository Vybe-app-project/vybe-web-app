import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  Spinner,
  Tabs,
  useToast,
} from './ui';
import { Utensils, Plus, Trash, Heart, Clock } from './icons';

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

type DailySummaryResponse = {
  data: {
    baseGoals: { calories: number; protein: number; carbs: number; fat: number };
    adjustedGoals: { calories: number; protein: number; carbs: number; fat: number };
    consumed: { calories: number; protein: number; carbs: number; fat: number };
    exercise: { caloriesBurned: number; workoutsCount: number };
    remaining: { calories: number; protein: number; carbs: number; fat: number };
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

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

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

/* ------------------------------------------------------------- macro ring */

function MacroRing({
  label,
  value,
  goal,
  unit,
  color,
}: {
  label: string;
  value: number;
  goal: number;
  unit: string;
  color: string;
}) {
  const size = 96;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
  const offset = circumference * (1 - ratio);
  const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${label}: ${pct}% of goal`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#262631"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset .6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold">{Math.round(value)}</span>
          <span className="text-[10px] text-[var(--color-muted)]">
            / {goal > 0 ? Math.round(goal) : '—'}
            {unit}
          </span>
        </div>
      </div>
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
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

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['food-search', debounced],
    queryFn: async (): Promise<FoodSearchResponse> => {
      const { data } = await api.get<FoodSearchResponse>('/food/search', {
        params: { q: debounced, pageSize: 15 },
      });
      return data;
    },
    enabled: debounced.trim().length >= 2,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          placeholder="Search foods (e.g. greek yogurt)…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {isFetching && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            <Spinner size={16} />
          </span>
        )}
      </div>

      {isError && (
        <p className="text-xs text-red-400">{errMsg(error, 'Food search unavailable')}</p>
      )}

      {debounced.trim().length >= 2 && !isFetching && (data?.foods?.length ?? 0) === 0 && (
        <p className="text-xs text-[var(--color-muted)]">No foods matched “{debounced}”.</p>
      )}

      {(data?.foods?.length ?? 0) > 0 && (
        <>
          {data?.sourceLabel && (
            <p className="text-[10px] text-[var(--color-muted)]">Source: {data.sourceLabel}</p>
          )}
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {(data?.foods ?? []).map((food, i) => {
              const nutrition = nutritionFromFood(food);
              const servingLabel =
                food.servingSize && food.servingSizeUnit
                  ? `${food.servingSize}${food.servingSizeUnit}`
                  : '1 serving';
              return (
                <li key={`${food.fdcId ?? 'local'}-${i}`}>
                  <button
                    type="button"
                    className="w-full rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-left transition hover:brightness-125"
                    onClick={() =>
                      onAdd({
                        key: `${food.fdcId ?? food.description}-${i}-${Date.now()}`,
                        name: food.description,
                        brand: food.brandName || food.brandOwner,
                        servings: 1,
                        baseNutrition: nutrition,
                        servingLabel,
                      })
                    }
                  >
                    <p className="truncate text-sm">{food.description}</p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      {[food.brandName || food.brandOwner, servingLabel].filter(Boolean).join(' · ')}{' '}
                      — {nutrition.calories} kcal · P{nutrition.protein} C{nutrition.carbs} F
                      {nutrition.fat}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- log modal */

function LogMealModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [mealType, setMealType] = useState<string>('breakfast');
  const [servingSize, setServingSize] = useState('');
  const [foods, setFoods] = useState<SelectedFood[]>([]);
  const [manual, setManual] = useState<Nutrition>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
  const nameTouched = useRef(false);

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
    setServingSize('');
    setFoods([]);
    setManual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    nameTouched.current = false;
  };

  const log = useMutation({
    mutationFn: async () => {
      const foodName = name.trim() || foods[0]?.name?.trim();
      if (!foodName) throw new Error('Give the meal a name');
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
    onError: (e) => toast.error(errMsg(e, 'Could not log meal')),
  });

  return (
    <Modal open={open} onClose={onClose} title="Log a meal">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          log.mutate();
        }}
      >
        <Input
          placeholder="Meal name"
          value={name}
          onChange={(e) => {
            nameTouched.current = true;
            setName(e.target.value);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Meal type</span>
            <select
              className="input-base"
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
            >
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Input
            placeholder="Serving size (e.g. 1 bowl)"
            value={servingSize}
            onChange={(e) => setServingSize(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Add foods</p>
          <FoodSearch
            onAdd={(food) => {
              setFoods((prev) => [...prev, food]);
              if (!nameTouched.current && !name) setName(food.name);
            }}
          />
        </div>

        {foods.length > 0 && (
          <ul className="space-y-2">
            {foods.map((food, i) => {
              const scaled = scaleNutrition(food.baseNutrition, food.servings);
              return (
                <li
                  key={food.key}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{food.name}</p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      {scaled.calories} kcal · P{scaled.protein} C{scaled.carbs} F{scaled.fat} ·{' '}
                      {food.servingLabel}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0.25}
                    step={0.25}
                    className="w-20"
                    value={String(food.servings)}
                    onChange={(e) =>
                      setFoods((prev) =>
                        prev.map((f, idx) =>
                          idx === i
                            ? { ...f, servings: Math.max(0, Number(e.target.value) || 0) }
                            : f,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${food.name}`}
                    className="btn btn-ghost px-2"
                    onClick={() => setFoods((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {foods.length === 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => (
              <label key={key} className="space-y-1">
                <span className="text-xs text-[var(--color-muted)] capitalize">{key}</span>
                <Input
                  type="number"
                  min={0}
                  value={String(manual[key] ?? 0)}
                  onChange={(e) =>
                    setManual((m) => ({ ...m, [key]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
              </label>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-sm">
          <strong>{Math.round(totals.calories ?? 0)}</strong> kcal · P
          {Math.round(totals.protein ?? 0)}g · C{Math.round(totals.carbs ?? 0)}g · F
          {Math.round(totals.fat ?? 0)}g
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={log.isPending}>
            Log meal
          </Button>
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
  const liked = Boolean(user && (meal.likes ?? []).some((id) => String(id) === user._id));
  const ts = meal.timestamp ? parseISO(meal.timestamp) : null;

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
                  likes: liked
                    ? (m.likes ?? []).filter((id) => String(id) !== user._id)
                    : [...(m.likes ?? []), user._id],
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
    <Card className="flex gap-3 p-3">
      {meal.image_url ? (
        <img
          src={mediaUrl(meal.image_url)}
          alt={meal.food_name}
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)]">
          <Utensils size={22} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/meals/${meal._id}`} className="font-medium hover:underline">
            {meal.food_name}
          </Link>
          <button
            type="button"
            aria-label="Delete meal"
            className="btn btn-ghost px-2"
            onClick={() => onDelete(meal)}
          >
            <Trash size={14} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          {meal.meal_type && <Badge>{meal.meal_type}</Badge>}
          {ts && isValid(ts) && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {format(ts, 'HH:mm')}
            </span>
          )}
          {meal.serving_size && <span>{meal.serving_size}</span>}
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          {Math.round(meal.nutrition?.calories ?? 0)} kcal · P
          {Math.round(meal.nutrition?.protein ?? 0)}g · C{Math.round(meal.nutrition?.carbs ?? 0)}g ·
          F{Math.round(meal.nutrition?.fat ?? 0)}g
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost px-3 py-1 text-xs"
            aria-pressed={liked}
            onClick={() => like.mutate()}
            disabled={like.isPending}
          >
            <Heart size={13} /> {(meal.likes ?? []).length}
          </button>
          <Link to={`/meals/${meal._id}`} className="btn btn-ghost px-3 py-1 text-xs">
            Details
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function Meals() {
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<'today' | 'week'>('today');
  const [modal, setModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Meal | null>(null);

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
          params: { timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1 },
        });
        return data.data;
      } catch (e: unknown) {
        // 404 simply means the user has not set health goals yet.
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

  const goals = goalsQuery.data?.baseGoals;
  const consumed = {
    calories: todayQuery.data?.totalCalories ?? 0,
    protein: todayQuery.data?.totalProtein ?? 0,
    carbs: todayQuery.data?.totalCarbs ?? 0,
    fat: todayQuery.data?.totalFat ?? 0,
  };

  const meals = rangeQuery.data?.meals ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Nutrition</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {streakQuery.data
              ? `${streakQuery.data.streak}-day logging streak`
              : 'Track what you eat, every day.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/meal-templates" className="btn btn-ghost">
            Templates
          </Link>
          <Button variant="primary" onClick={() => setModal(true)}>
            <Plus size={16} /> Log meal
          </Button>
        </div>
      </header>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Today</h2>
          {!goals && !goalsQuery.isLoading && (
            <Link to="/health-goals" className="text-xs text-[var(--color-brand)] hover:underline">
              Set goals →
            </Link>
          )}
        </div>
        {todayQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="mx-auto h-24 w-24 rounded-full" />
            ))}
          </div>
        ) : todayQuery.isError ? (
          <ErrorState
            message={errMsg(todayQuery.error, 'Could not load today’s nutrition')}
            onRetry={() => todayQuery.refetch()}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MacroRing
              label="Calories"
              value={consumed.calories}
              goal={goals?.calories ?? 0}
              unit=""
              color="#7c5cff"
            />
            <MacroRing
              label="Protein"
              value={consumed.protein}
              goal={goals?.protein ?? 0}
              unit="g"
              color="#22d3ee"
            />
            <MacroRing
              label="Carbs"
              value={consumed.carbs}
              goal={goals?.carbs ?? 0}
              unit="g"
              color="#f472b6"
            />
            <MacroRing
              label="Fat"
              value={consumed.fat}
              goal={goals?.fat ?? 0}
              unit="g"
              color="#facc15"
            />
          </div>
        )}
        {goalsQuery.data?.exercise?.caloriesBurned ? (
          <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
            +{Math.round(goalsQuery.data.exercise.caloriesBurned)} kcal earned from{' '}
            {goalsQuery.data.exercise.workoutsCount} workout(s)
          </p>
        ) : null}
      </Card>

      <Tabs
        tabs={[
          { key: 'today', label: 'Today' },
          { key: 'week', label: 'This week' },
        ]}
        value={range}
        onChange={(k: string) => setRange(k as 'today' | 'week')}
      />

      {rangeQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : rangeQuery.isError ? (
        <ErrorState
          message={errMsg(rangeQuery.error, 'Could not load meals')}
          onRetry={() => rangeQuery.refetch()}
        />
      ) : meals.length === 0 ? (
        <EmptyState
          icon={<Utensils size={28} />}
          title="No meals logged"
          description={
            range === 'today'
              ? 'Log your first meal of the day to see your macros fill up.'
              : 'Nothing logged this week yet.'
          }
          action={
            <Button variant="primary" onClick={() => setModal(true)}>
              <Plus size={16} /> Log meal
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-muted)]">
            {rangeQuery.data?.count ?? meals.length} meals ·{' '}
            {Math.round(rangeQuery.data?.summary.totalCalories ?? 0)} kcal
          </p>
          {meals.map((meal) => (
            <MealCard
              key={meal._id}
              meal={meal}
              rangeKey={range}
              onDelete={(m) => setPendingDelete(m)}
            />
          ))}
        </div>
      )}

      <LogMealModal open={modal} onClose={() => setModal(false)} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete meal"
        message={`"${pendingDelete?.food_name ?? ''}" will be removed from your log.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
