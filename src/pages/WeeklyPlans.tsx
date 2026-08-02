import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { Utensils, Plus, Trash, Check, Calendar } from './icons';

/* ------------------------------------------------------------------ types */

type PlanFood = {
  food_name: string;
  brandName?: string;
  servingSize?: string;
  servingsConsumed?: number;
  nutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
};

type MealSlot = {
  mealType: string;
  templateId?: { _id: string; name?: string } | string | null;
  foods?: PlanFood[];
  totalNutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
};

type DayPlan = {
  dayOfWeek: string;
  meals: MealSlot[];
  dayNutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  notes?: string;
};

type WeeklyPlan = {
  _id: string;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string } | string;
  name: string;
  description?: string;
  goalType?: string;
  targetCalories?: number;
  tags?: string[];
  image_url?: string;
  days: DayPlan[];
  isActive?: boolean;
  isPublic?: boolean;
  sharedToProfile?: boolean;
  likes?: string[];
  saves?: string[];
  timesUsed?: number;
  isLiked?: boolean;
  isSaved?: boolean;
  createdAt?: string;
};

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

const TABS = [
  { key: 'mine', label: 'My plans' },
  { key: 'discover', label: 'Discover' },
  { key: 'saved', label: 'Saved' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const titleCase = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/* ------------------------------------------------------------ create modal */

function CreatePlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goalType, setGoalType] = useState('');
  const [targetCalories, setTargetCalories] = useState('');
  const [tags, setTags] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Plan name is required');
      const { data } = await api.post<WeeklyPlan>('/weekly-plans', {
        name: name.trim(),
        description: description.trim() || undefined,
        goalType: goalType.trim() || undefined,
        targetCalories: targetCalories ? Number(targetCalories) : undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Plan created');
      qc.invalidateQueries({ queryKey: ['weekly-plans'] });
      setName('');
      setDescription('');
      setGoalType('');
      setTargetCalories('');
      setTags('');
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create plan')),
  });

  return (
    <Modal open={open} onClose={onClose} title="New weekly meal plan">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input placeholder="Plan name" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          rows={2}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            placeholder="Goal (e.g. cutting)"
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder="Target calories"
            value={targetCalories}
            onChange={(e) => setTargetCalories(e.target.value)}
          />
        </div>
        <Input
          placeholder="Tags, comma separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create plan
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------- add meal modal */

function AddMealModal({
  plan,
  onClose,
}: {
  plan: WeeklyPlan | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dayOfWeek, setDayOfWeek] = useState<string>('monday');
  const [mealType, setMealType] = useState<string>('breakfast');
  const [templateId, setTemplateId] = useState('');
  const [foodName, setFoodName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const templates = useQuery({
    queryKey: ['meal-templates', 'mine'],
    queryFn: async () => {
      const { data } = await api.get<{ _id: string; name: string }[]>('/meal-templates');
      return data;
    },
    enabled: Boolean(plan),
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error('No plan selected');
      const body: Record<string, unknown> = { dayOfWeek, mealType };
      if (templateId) {
        body.templateId = templateId;
      } else {
        if (!foodName.trim()) throw new Error('Pick a template or enter a food');
        body.foods = [
          {
            food_name: foodName.trim(),
            servingsConsumed: 1,
            nutrition: {
              calories: Number(calories) || 0,
              protein: Number(protein) || 0,
              carbs: Number(carbs) || 0,
              fat: Number(fat) || 0,
            },
          },
        ];
      }
      const { data } = await api.post(`/weekly-plans/${plan._id}/meal`, body);
      return data;
    },
    onSuccess: () => {
      toast.success('Meal added to plan');
      qc.invalidateQueries({ queryKey: ['weekly-plans'] });
      setFoodName('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add meal')),
  });

  return (
    <Modal open={Boolean(plan)} onClose={onClose} title={`Add meal to ${plan?.name ?? ''}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Day</span>
            <select
              className="input-base"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(e.target.value)}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {titleCase(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Meal</span>
            <select
              className="input-base"
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
            >
              {MEAL_TYPES.map((m) => (
                <option key={m} value={m}>
                  {titleCase(m)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="space-y-1">
          <span className="text-xs text-[var(--color-muted)]">Use a template (optional)</span>
          <select
            className="input-base"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">— Enter a food manually —</option>
            {(templates.data ?? []).map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        {!templateId && (
          <>
            <Input
              placeholder="Food name"
              value={foodName}
              onChange={(e) => setFoodName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Input
                type="number"
                min={0}
                placeholder="Calories"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                placeholder="Protein"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                placeholder="Carbs"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                placeholder="Fat"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add meal
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- plan card */

function PlanCard({
  plan,
  isMine,
  onAddMeal,
  onDelete,
}: {
  plan: WeeklyPlan;
  isMine: boolean;
  onAddMeal: (p: WeeklyPlan) => void;
  onDelete: (p: WeeklyPlan) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);

  const owner = typeof plan.user === 'object' && plan.user ? plan.user : undefined;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['weekly-plans'] });

  const totalMeals = (plan.days ?? []).reduce((sum, d) => sum + (d.meals?.length ?? 0), 0);

  const activate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/weekly-plans/${plan._id}/activate`);
      return data as { message: string };
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Plan activated');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not activate plan')),
  });

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/weekly-plans/${plan._id}/like`);
      return data;
    },
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errMsg(e, 'Could not like plan')),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/weekly-plans/${plan._id}/save`);
      return data as { isSaved: boolean };
    },
    onSuccess: (data) => {
      toast.success(data.isSaved ? 'Plan saved' : 'Removed from saved');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save plan')),
  });

  const copy = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/weekly-plans/${plan._id}/copy`);
      return data;
    },
    onSuccess: () => {
      toast.success('Copied to your plans');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not copy plan')),
  });

  const removeMeal = useMutation({
    mutationFn: async ({ day, index }: { day: string; index: number }) => {
      const { data } = await api.delete(`/weekly-plans/${plan._id}/meal`, {
        data: { dayOfWeek: day, mealIndex: index },
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Meal removed');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not remove meal')),
  });

  const saved =
    plan.isSaved ?? Boolean(user && (plan.saves ?? []).some((v) => String(v) === user._id));

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{plan.name}</p>
          {plan.description && (
            <p className="line-clamp-2 text-sm text-[var(--color-muted)]">{plan.description}</p>
          )}
        </div>
        {plan.isActive && <Badge>active</Badge>}
      </div>

      {plan.image_url && (
        <img
          src={mediaUrl(plan.image_url)}
          alt={plan.name}
          loading="lazy"
          className="h-28 w-full rounded-xl object-cover"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {plan.goalType && <Badge>{plan.goalType}</Badge>}
        {plan.targetCalories ? <Badge>{plan.targetCalories} kcal/day</Badge> : null}
        {(plan.tags ?? []).slice(0, 3).map((t) => (
          <Badge key={t}>#{t}</Badge>
        ))}
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        {totalMeals} meals planned across {plan.days?.length ?? 0} days
      </p>

      {owner && !isMine && (
        <div className="flex items-center gap-2">
          <Avatar src={mediaUrl(owner.avatar)} alt={owner.username ?? ''} size={22} />
          <span className="text-xs text-[var(--color-muted)]">@{owner.username ?? 'unknown'}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-ghost w-full"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide week' : 'View week'}
      </button>

      {expanded && (
        <div className="space-y-2">
          {DAYS.map((day) => {
            const dayPlan = (plan.days ?? []).find((d) => d.dayOfWeek === day);
            const meals = dayPlan?.meals ?? [];
            return (
              <div key={day} className="rounded-xl bg-[var(--color-surface-2)] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-medium">{titleCase(day)}</p>
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {Math.round(dayPlan?.dayNutrition?.calories ?? 0)} kcal
                  </span>
                </div>
                {meals.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)]">Nothing planned.</p>
                ) : (
                  <ul className="space-y-1">
                    {meals.map((meal, i) => {
                      const template =
                        typeof meal.templateId === 'object' && meal.templateId
                          ? meal.templateId
                          : undefined;
                      const label =
                        template?.name ||
                        (meal.foods ?? []).map((f) => f.food_name).join(', ') ||
                        'Meal';
                      return (
                        <li
                          key={`${day}-${i}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-[var(--color-muted)]">
                              {titleCase(meal.mealType)}:
                            </span>{' '}
                            {label} ({Math.round(meal.totalNutrition?.calories ?? 0)} kcal)
                          </span>
                          {isMine && (
                            <button
                              type="button"
                              aria-label="Remove meal"
                              className="btn btn-ghost px-1 py-0.5"
                              onClick={() => removeMeal.mutate({ day, index: i })}
                              disabled={removeMeal.isPending}
                            >
                              <Trash size={12} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {isMine ? (
          <>
            <Button variant="ghost" onClick={() => onAddMeal(plan)}>
              <Plus size={14} /> Add meal
            </Button>
            <Button
              variant={plan.isActive ? 'ghost' : 'primary'}
              onClick={() => activate.mutate()}
              loading={activate.isPending}
              disabled={plan.isActive}
            >
              <Check size={14} /> {plan.isActive ? 'Active' : 'Activate'}
            </Button>
            <button
              type="button"
              aria-label="Delete plan"
              className="btn btn-ghost px-2"
              onClick={() => onDelete(plan)}
            >
              <Trash size={14} />
            </button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => copy.mutate()} loading={copy.isPending}>
              Copy
            </Button>
            <Button variant="ghost" onClick={() => like.mutate()} loading={like.isPending}>
              Like ({(plan.likes ?? []).length})
            </Button>
            <Button variant="ghost" onClick={() => save.mutate()} loading={save.isPending}>
              {saved ? 'Saved' : 'Save'}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function WeeklyPlans() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('mine');
  const [createOpen, setCreateOpen] = useState(false);
  const [addMealFor, setAddMealFor] = useState<WeeklyPlan | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WeeklyPlan | null>(null);

  const mine = useQuery({
    queryKey: ['weekly-plans', 'mine'],
    queryFn: async (): Promise<WeeklyPlan[]> => {
      const { data } = await api.get<WeeklyPlan[]>('/weekly-plans');
      return data;
    },
    enabled: tab === 'mine',
  });

  const discover = useQuery({
    queryKey: ['weekly-plans', 'discover'],
    queryFn: async (): Promise<WeeklyPlan[]> => {
      const { data } = await api.get<WeeklyPlan[]>('/weekly-plans/feed/discover', {
        params: { page: 1, limit: 50 },
      });
      return data;
    },
    enabled: tab === 'discover',
  });

  const saved = useQuery({
    queryKey: ['weekly-plans', 'saved'],
    queryFn: async (): Promise<WeeklyPlan[]> => {
      const { data } = await api.get<WeeklyPlan[]>('/weekly-plans/feed/saved');
      return data;
    },
    enabled: tab === 'saved',
  });

  const activePlan = useQuery({
    queryKey: ['weekly-plans', 'active'],
    queryFn: async (): Promise<{ active: boolean; plan: WeeklyPlan | null }> => {
      const { data } = await api.get<{ active: boolean; plan: WeeklyPlan | null }>(
        '/weekly-plans/active',
      );
      return data;
    },
  });

  const logToday = useMutation({
    mutationFn: async (mealType?: string) => {
      const { data } = await api.post('/weekly-plans/log-today', mealType ? { mealType } : {});
      return data as { message: string };
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Logged today’s plan');
      qc.invalidateQueries({ queryKey: ['meals'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not log today’s meals')),
  });

  const remove = useMutation({
    mutationFn: async (plan: WeeklyPlan) => {
      await api.delete(`/weekly-plans/${plan._id}`);
      return plan._id;
    },
    onMutate: async (plan) => {
      const key = ['weekly-plans', 'mine'];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<WeeklyPlan[]>(key);
      qc.setQueryData<WeeklyPlan[]>(key, (old) => (old ?? []).filter((p) => p._id !== plan._id));
      return { previous, key };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      toast.error(errMsg(e, 'Could not delete plan'));
    },
    onSuccess: () => toast.success('Plan deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['weekly-plans'] });
    },
  });

  const active = tab === 'mine' ? mine : tab === 'discover' ? discover : saved;
  const list = useMemo(() => active.data ?? [], [active.data]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Weekly meal plans</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Plan your whole week, then log it in one tap.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> New plan
        </Button>
      </header>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <Calendar size={20} />
          <div>
            <p className="text-sm font-semibold">
              {activePlan.isLoading
                ? 'Checking active plan…'
                : activePlan.data?.plan
                  ? activePlan.data.plan.name
                  : 'No active plan'}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              {activePlan.data?.plan
                ? 'Log today’s planned meals with one tap.'
                : 'Activate a plan to enable one-tap logging.'}
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          disabled={!activePlan.data?.plan}
          loading={logToday.isPending}
          onClick={() => logToday.mutate(undefined)}
        >
          <Check size={16} /> Log today
        </Button>
      </Card>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(k: string) => setTab(k as TabKey)}
      />

      {active.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : active.isError ? (
        <ErrorState
          message={errMsg(active.error, 'Could not load plans')}
          onRetry={() => active.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Utensils size={28} />}
          title={tab === 'mine' ? 'No plans yet' : 'Nothing here yet'}
          description={
            tab === 'mine'
              ? 'Create a weekly plan and fill in your meals day by day.'
              : tab === 'saved'
                ? 'Save plans from Discover to find them here.'
                : 'No shared plans available right now.'
          }
          action={
            tab === 'mine' ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> New plan
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((plan) => (
            <PlanCard
              key={plan._id}
              plan={plan}
              isMine={tab === 'mine'}
              onAddMeal={(p) => setAddMealFor(p)}
              onDelete={(p) => setPendingDelete(p)}
            />
          ))}
        </div>
      )}

      <CreatePlanModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <AddMealModal plan={addMealFor} onClose={() => setAddMealFor(null)} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete plan"
        message={`"${pendingDelete?.name ?? ''}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
