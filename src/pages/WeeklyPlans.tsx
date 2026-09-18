import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardMedia,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  cx,
  formatStat,
  humanize,
  usePulse,
  useToast,
} from './ui';
import type { MenuItem } from './ui';
import { Plus, Trash, Check, CalendarDays, Edit, Globe, Heart, Bookmark, Copy, Utensils, ChevronDown } from './icons';
import { MacroLine, MEAL_TYPE_OPTIONS, MEAL_TYPES, defaultMealType, mealTypeLabel, plural } from './Meals';

/* ------------------------------------------------------------------ types */

type PlanNutrition = { calories?: number; protein?: number; carbs?: number; fat?: number };

type PlanFood = {
  food_name: string;
  brandName?: string;
  servingSize?: string;
  servingsConsumed?: number;
  nutrition?: PlanNutrition;
};

type MealSlot = {
  mealType: string;
  templateId?: { _id: string; name?: string } | string | null;
  foods?: PlanFood[];
  totalNutrition?: PlanNutrition;
};

type DayPlan = {
  dayOfWeek: string;
  meals: MealSlot[];
  dayNutrition?: PlanNutrition;
  notes?: string;
};

type PlanOwner = { _id: string; username?: string; fullName?: string; avatar?: string };

type WeeklyPlan = {
  _id: string;
  user?: PlanOwner | string;
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
  likesCount?: number;
  savesCount?: number;
  timesUsed?: number;
  isLiked?: boolean;
  isSaved?: boolean;
  isOwner?: boolean;
  createdAt?: string;
};

type TemplateSummary = {
  _id: string;
  name: string;
  meal_type?: string;
  totalNutrition?: PlanNutrition;
  foods?: PlanFood[];
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = (typeof DAYS)[number];
const DAY_OPTIONS = DAYS.map((d) => ({ value: d, label: humanize(d) }));

/** Matches the backend WeeklyMealPlan `goalType` enum. */
const GOAL_TYPES = ['weight_loss', 'muscle_gain', 'maintenance', 'bulk', 'cut', 'balanced', 'keto', 'vegan', 'vegetarian', 'other'] as const;
const GOAL_OPTIONS = GOAL_TYPES.map((g) => ({ value: g, label: humanize(g) }));

const TABS = [
  { key: 'mine', label: 'Mine' },
  { key: 'discover', label: 'Discover' },
  { key: 'saved', label: 'Saved' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const todayKey = (): Day => DAYS[(new Date().getDay() + 6) % 7];

const ownerOf = (p: WeeklyPlan): PlanOwner | undefined => (typeof p.user === 'object' && p.user ? p.user : undefined);

const dayOf = (plan: WeeklyPlan, day: string) => (plan.days ?? []).find((d) => d.dayOfWeek === day);

const kcalOfDay = (d?: DayPlan) =>
  Math.round(d?.dayNutrition?.calories ?? (d?.meals ?? []).reduce((s, m) => s + (m.totalNutrition?.calories ?? 0), 0));

const slotLabel = (meal: MealSlot) => {
  const template = typeof meal.templateId === 'object' && meal.templateId ? meal.templateId : undefined;
  return template?.name || (meal.foods ?? []).map((f) => f.food_name).join(', ') || 'Meal';
};

/* --------------------------------------------------------- plan modal */

function PlanModal({ open, editing, onClose }: { open: boolean; editing: WeeklyPlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goalType, setGoalType] = useState<string>('');
  const [targetCalories, setTargetCalories] = useState('');
  const [tags, setTags] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [seedKey, setSeedKey] = useState('');

  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setGoalType(editing?.goalType ?? '');
    setTargetCalories(editing?.targetCalories ? String(editing.targetCalories) : '');
    setTags((editing?.tags ?? []).join(', '));
    setNameError(undefined);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) {
        setNameError('Give the plan a name.');
        throw new Error('validation');
      }
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        goalType: goalType || undefined,
        targetCalories: targetCalories ? Math.max(0, Number(targetCalories) || 0) : undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      };
      if (editing) {
        const { data } = await api.put<WeeklyPlan>(`/weekly-plans/${editing._id}`, body);
        return data;
      }
      const { data } = await api.post<WeeklyPlan>('/weekly-plans', body);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'Plan saved' : 'Plan created. Now add meals to each day.');
      qc.invalidateQueries({ queryKey: ['weekly-plans'] });
      onClose();
    },
    onError: (e) => {
      if ((e as Error)?.message !== 'validation') toast.error(errMsg(e, 'Could not save plan'));
    },
  });

  const formId = 'weekly-plan-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit plan' : 'New weekly plan'}
      description="Set the basics here, then add meals to each day from the plan card."
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create plan'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          label="Plan name"
          placeholder="Lean week"
          value={name}
          error={nameError}
          autoComplete="off"
          onChange={(e) => {
            setNameError(undefined);
            setName(e.target.value);
          }}
        />
        <Textarea
          label="Description"
          hint="Optional"
          rows={2}
          autoGrow
          maxRows={4}
          placeholder="Who is this for, and what does it aim at?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Goal" placeholder="Choose a goal" value={goalType || null} onChange={setGoalType} options={GOAL_OPTIONS} hint="Optional" />
          <Input
            label="Target calories"
            hint="Per day, optional"
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            placeholder="2,200"
            className="tabular"
            value={targetCalories}
            onChange={(e) => setTargetCalories(e.target.value)}
          />
        </div>
        <Input label="Tags" hint="Comma separated, for example: high protein, quick" placeholder="high protein, quick" value={tags} onChange={(e) => setTags(e.target.value)} />
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------- add meal modal */

const MANUAL = 'manual';

const MACRO_FIELDS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;

function AddMealModal({ target, onClose }: { target: { plan: WeeklyPlan; day: Day } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dayOfWeek, setDayOfWeek] = useState<string>(todayKey());
  const [mealType, setMealType] = useState<string>(defaultMealType());
  const [source, setSource] = useState<string>(MANUAL);
  const [foodName, setFoodName] = useState('');
  const [macros, setMacros] = useState<Record<(typeof MACRO_FIELDS)[number]['key'], string>>({ calories: '', protein: '', carbs: '', fat: '' });
  const [foodError, setFoodError] = useState<string | undefined>();
  const [seedKey, setSeedKey] = useState('');

  const seed = target ? `${target.plan._id}:${target.day}` : 'closed';
  if (seed !== seedKey) {
    setSeedKey(seed);
    if (target) {
      setDayOfWeek(target.day);
      setMealType(defaultMealType());
      setSource(MANUAL);
      setFoodName('');
      setMacros({ calories: '', protein: '', carbs: '', fat: '' });
      setFoodError(undefined);
    }
  }

  const templates = useQuery({
    queryKey: ['meal-templates', 'mine'],
    queryFn: async () => {
      const { data } = await api.get<TemplateSummary[]>('/meal-templates');
      return data;
    },
    enabled: Boolean(target),
  });

  const chosenTemplate = source !== MANUAL ? (templates.data ?? []).find((t) => t._id === source) : undefined;

  const add = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('No plan selected');
      const body: Record<string, unknown> = { dayOfWeek, mealType };
      if (source !== MANUAL) {
        body.templateId = source;
      } else {
        if (!foodName.trim()) {
          setFoodError('Name the food, or pick a template above.');
          throw new Error('validation');
        }
        body.foods = [
          {
            food_name: foodName.trim(),
            servingsConsumed: 1,
            nutrition: {
              calories: Number(macros.calories) || 0,
              protein: Number(macros.protein) || 0,
              carbs: Number(macros.carbs) || 0,
              fat: Number(macros.fat) || 0,
            },
          },
        ];
      }
      const { data } = await api.post(`/weekly-plans/${target.plan._id}/meal`, body);
      return data;
    },
    onSuccess: () => {
      toast.success(`${mealTypeLabel(mealType)} added to ${humanize(dayOfWeek)}`);
      qc.invalidateQueries({ queryKey: ['weekly-plans'] });
      onClose();
    },
    onError: (e) => {
      if ((e as Error)?.message !== 'validation') toast.error(errMsg(e, 'Could not add meal'));
    },
  });

  const templateOptions = [
    { value: MANUAL, label: 'Enter a food manually' },
    ...(templates.data ?? []).map((t) => ({ value: t._id, label: t.name, description: t.meal_type ? mealTypeLabel(t.meal_type) : undefined })),
  ];

  const formId = 'plan-add-meal-form';

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title="Add a meal"
      description={target ? `To ${target.plan.name}` : undefined}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={add.isPending}>
            Add meal
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Select label="Day" value={dayOfWeek} onChange={setDayOfWeek} options={DAY_OPTIONS} />
          <Select label="Meal" value={mealType} onChange={setMealType} options={MEAL_TYPE_OPTIONS} />
        </div>

        <Select
          label="From a template"
          value={source}
          onChange={(v) => {
            setSource(v);
            setFoodError(undefined);
          }}
          options={templateOptions}
          hint={templates.isLoading ? 'Loading your templates…' : (templates.data?.length ?? 0) === 0 ? 'You have no templates yet, so enter the food below.' : undefined}
        />

        {chosenTemplate ? (
          <div className="rounded-md bg-surface-2 p-3">
            <p className="text-sm font-semibold text-text-1">{chosenTemplate.name}</p>
            <MacroLine nutrition={chosenTemplate.totalNutrition} emphasis="sm" className="mt-1" />
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              label="Food"
              placeholder="Chicken and rice"
              value={foodName}
              error={foodError}
              autoComplete="off"
              onChange={(e) => {
                setFoodError(undefined);
                setFoodName(e.target.value);
              }}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MACRO_FIELDS.map((m) => (
                <Input
                  key={m.key}
                  label={`${m.label} (${m.unit})`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="0"
                  className="tabular"
                  value={macros[m.key]}
                  onChange={(e) => setMacros((prev) => ({ ...prev, [m.key]: e.target.value }))}
                />
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- week strip */

function WeekStrip({
  plan,
  selected,
  onSelect,
}: {
  plan: WeeklyPlan;
  selected: Day | null;
  onSelect: (day: Day) => void;
}) {
  const today = todayKey();
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="Meals planned per day">
      {DAYS.map((day) => {
        const d = dayOf(plan, day);
        const count = d?.meals?.length ?? 0;
        const isToday = day === today;
        const isSelected = selected === day;
        return (
          <li key={day}>
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={`${humanize(day)}${isToday ? ' (today)' : ''}: ${count} ${plural(count, 'meal')}`}
              onClick={() => onSelect(day)}
              className={cx(
                'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-sm border text-center transition-colors dur-1',
                isSelected ? 'border-brand bg-brand-soft text-brand-text' : 'border-line bg-surface-2 text-text-2 hover:bg-surface-3',
              )}
            >
              <span className={cx('text-2xs font-semibold', isToday && !isSelected && 'text-brand-text')}>{humanize(day).slice(0, 3)}</span>
              <span className={cx('type-stat text-lg leading-none', count === 0 && !isSelected && 'text-text-3')}>{count}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- plan card */

function PlanCard({
  plan,
  tab,
  onAddMeal,
  onEdit,
  onDelete,
}: {
  plan: WeeklyPlan;
  tab: TabKey;
  onAddMeal: (p: WeeklyPlan, day: Day) => void;
  onEdit: (p: WeeklyPlan) => void;
  onDelete: (p: WeeklyPlan) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const pulse = usePulse();
  const [selectedDay, setSelectedDay] = useState<Day | null>(null);

  const owner = ownerOf(plan);
  const isMine = plan.isOwner ?? (tab === 'mine' || Boolean(user && owner?._id === user._id));
  const invalidate = () => qc.invalidateQueries({ queryKey: ['weekly-plans'] });

  const totalMeals = (plan.days ?? []).reduce((sum, d) => sum + (d.meals?.length ?? 0), 0);
  const plannedDays = (plan.days ?? []).filter((d) => (d.meals?.length ?? 0) > 0);
  const avgKcal = plannedDays.length ? Math.round(plannedDays.reduce((s, d) => s + kcalOfDay(d), 0) / plannedDays.length) : 0;

  const activate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/weekly-plans/${plan._id}/activate`);
      return data as { message?: string };
    },
    onSuccess: () => {
      toast.success(`${plan.name} is now your active plan`);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not activate plan')),
  });

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/weekly-plans/${plan._id}/like`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onSettled: () => invalidate(),
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
      toast.success('Added to your plans');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not copy plan')),
  });

  const profileShare = useMutation({
    mutationFn: async () => {
      const { data } = plan.sharedToProfile
        ? await api.post(`/weekly-plans/${plan._id}/unshare-profile`)
        : await api.post(`/weekly-plans/${plan._id}/share-profile`);
      return data;
    },
    onSuccess: () => {
      toast.success(plan.sharedToProfile ? 'Removed from your profile' : 'Shared to your profile');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update sharing')),
  });

  const removeMeal = useMutation({
    mutationFn: async ({ day, index }: { day: string; index: number }) => {
      const { data } = await api.delete(`/weekly-plans/${plan._id}/meal`, { data: { dayOfWeek: day, mealIndex: index } });
      return data;
    },
    onSuccess: () => {
      toast.success('Meal removed');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not remove meal')),
  });

  const liked = plan.isLiked ?? Boolean(user && (plan.likes ?? []).some((v) => String(v) === user._id));
  const saved = plan.isSaved ?? Boolean(user && (plan.saves ?? []).some((v) => String(v) === user._id));
  const likeCount = plan.likesCount ?? (plan.likes ?? []).length;

  const ownerMenu: MenuItem[] = [
    { label: 'Edit details', icon: <Edit size={18} />, onSelect: () => onEdit(plan) },
    {
      label: plan.sharedToProfile ? 'Remove from profile' : 'Share to profile',
      description: plan.sharedToProfile ? 'Hide it from Discover' : 'Show it in Discover and on your profile',
      icon: <Globe size={18} />,
      onSelect: () => profileShare.mutate(),
    },
    { label: 'Delete plan', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => onDelete(plan) },
  ];

  const selectedPlan = selectedDay ? dayOf(plan, selectedDay) : undefined;
  const selectedMeals = selectedPlan?.meals ?? [];

  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold text-text-1">{plan.name}</h3>
          {plan.description ? <p className="mt-0.5 line-clamp-2 text-sm text-text-2">{plan.description}</p> : null}
        </div>
        {plan.isActive ? (
          <Badge tone="brand" dot className="shrink-0">
            Active
          </Badge>
        ) : null}
      </div>

      {plan.image_url ? (
        <CardMedia ratio="16/9">
          <img src={mediaUrl(plan.image_url)} alt="" loading="lazy" className="h-full w-full object-cover" />
        </CardMedia>
      ) : null}

      {plan.goalType || plan.targetCalories || (plan.tags ?? []).length ? (
        <div className="flex flex-wrap gap-1.5">
          {plan.goalType ? <Badge tone="neutral">{humanize(plan.goalType)}</Badge> : null}
          {plan.targetCalories ? (
            <Badge tone="neutral">
              <span className="tabular">{formatStat(plan.targetCalories)}</span> kcal a day
            </Badge>
          ) : null}
          {(plan.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t} tone="neutral">
              #{t}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <WeekStrip plan={plan} selected={selectedDay} onSelect={(d) => setSelectedDay((cur) => (cur === d ? null : d))} />
        <p className="text-xs text-text-2">
          {totalMeals === 0 ? (
            isMine ? 'No meals yet. Tap a day to start filling the week.' : 'No meals planned yet.'
          ) : (
            <>
              <span className="tabular font-semibold text-text-1">{formatStat(totalMeals)}</span> {plural(totalMeals, 'meal')} across{' '}
              <span className="tabular font-semibold text-text-1">{plannedDays.length}</span> {plural(plannedDays.length, 'day')}
              {avgKcal > 0 ? (
                <>
                  , about <span className="tabular font-semibold text-text-1">{formatStat(avgKcal)}</span> kcal a day
                </>
              ) : null}
              .
            </>
          )}
        </p>
      </div>

      {selectedDay ? (
        <div className="anim-fade-in rounded-md border border-line bg-surface-2 p-3" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <p className="type-label text-text-2">
              {humanize(selectedDay)}
              {selectedDay === todayKey() ? ' (today)' : ''}
            </p>
            <span className="tabular text-xs text-text-2">{formatStat(kcalOfDay(selectedPlan))} kcal</span>
          </div>
          {selectedMeals.length === 0 ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-text-2">Nothing planned for {humanize(selectedDay)}.</p>
              {isMine ? (
                <Button size="sm" variant="secondary" icon={<Plus size={16} />} onClick={() => onAddMeal(plan, selectedDay)}>
                  Add meal
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {selectedMeals.map((meal, i) => (
                <li key={`${selectedDay}-${i}`} className="flex items-center gap-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-1">{slotLabel(meal)}</p>
                    <p className="text-xs text-text-2">
                      {mealTypeLabel(meal.mealType)}, <span className="tabular">{formatStat(Math.round(meal.totalNutrition?.calories ?? 0))}</span> kcal
                    </p>
                  </div>
                  {isMine ? (
                    <IconButton
                      label={`Remove ${slotLabel(meal)} from ${humanize(selectedDay)}`}
                      size={40}
                      onClick={() => removeMeal.mutate({ day: selectedDay, index: i })}
                      disabled={removeMeal.isPending}
                    >
                      <Trash size={16} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
              {isMine ? (
                <li className="pt-2">
                  <Button size="sm" variant="secondary" icon={<Plus size={16} />} onClick={() => onAddMeal(plan, selectedDay)}>
                    Add another
                  </Button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}

      {owner && !isMine ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
          <Avatar src={owner.avatar} name={owner.fullName || owner.username} alt="" size="xs" />
          <span className="truncate">{owner.fullName || `@${owner.username ?? 'member'}`}</span>
        </span>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {isMine ? (
          <>
            {plan.isActive ? (
              <Button variant="secondary" icon={<Check size={18} />} disabled className="flex-1 sm:flex-none">
                Active
              </Button>
            ) : (
              <Button variant="primary" icon={<Check size={18} />} onClick={() => activate.mutate()} loading={activate.isPending} className="flex-1 sm:flex-none">
                Activate
              </Button>
            )}
            <Button variant="secondary" icon={<Plus size={18} />} onClick={() => onAddMeal(plan, selectedDay ?? todayKey())} className="hidden sm:inline-flex">
              Add meal
            </Button>
            <span className="ml-auto">
              <Menu label={`Options for ${plan.name}`} items={ownerMenu} />
            </span>
          </>
        ) : (
          <>
            <Button variant="primary" icon={<Copy size={18} />} onClick={() => copy.mutate()} loading={copy.isPending} className="flex-1 sm:flex-none">
              Copy
            </Button>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={cx(
                  'inline-flex h-11 min-w-11 items-center gap-1.5 rounded-sm px-2.5 text-xs font-semibold transition-colors dur-1',
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
                <span className="tabular">{formatStat(likeCount)}</span>
              </button>
              <IconButton label={saved ? 'Remove from saved' : 'Save plan'} active={saved} onClick={() => save.mutate()} disabled={save.isPending}>
                <Bookmark size={20} filled={saved} />
              </IconButton>
            </span>
          </>
        )}
      </div>
    </Card>
  );
}

function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading plans">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-4 p-4 sm:p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }).map((_, j) => (
              <Skeleton key={j} className="h-14 w-full" />
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-11 w-28" />
            <Skeleton className="h-11 w-11" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function WeeklyPlans() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('mine');
  const [planModal, setPlanModal] = useState<{ open: boolean; editing: WeeklyPlan | null }>({ open: false, editing: null });
  const [addMealTarget, setAddMealTarget] = useState<{ plan: WeeklyPlan; day: Day } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WeeklyPlan | null>(null);

  const mine = useQuery({
    queryKey: ['weekly-plans', 'mine'],
    queryFn: async (): Promise<WeeklyPlan[]> => {
      const { data } = await api.get<WeeklyPlan[]>('/weekly-plans');
      return data;
    },
  });

  const discover = useQuery({
    queryKey: ['weekly-plans', 'discover'],
    queryFn: async (): Promise<WeeklyPlan[]> => {
      const { data } = await api.get<WeeklyPlan[]>('/weekly-plans/feed/discover', { params: { page: 1, limit: 50 } });
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
      const { data } = await api.get<{ active: boolean; plan: WeeklyPlan | null }>('/weekly-plans/active');
      return data;
    },
  });

  const logToday = useMutation({
    mutationFn: async (mealType?: string) => {
      const { data } = await api.post('/weekly-plans/log-today', mealType ? { mealType } : {});
      return data as { message?: string };
    },
    onSuccess: (_data, mealType) => {
      toast.success(mealType ? `${mealTypeLabel(mealType)} logged from your plan` : 'Today’s meals logged', {
        action: { label: 'View meals', onClick: () => navigate('/meals', { viewTransition: true }) },
      });
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
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

  const current = activePlan.data?.plan ?? null;
  const today = todayKey();
  const todayPlan = current ? dayOf(current, today) : undefined;
  const todayMeals = todayPlan?.meals ?? [];
  const todayTypes = MEAL_TYPES.filter((t) => todayMeals.some((m) => m.mealType === t));
  const openNew = () => setPlanModal({ open: true, editing: null });

  const emptyCopy: Record<TabKey, { title: string; message: string; action: { label: string; onClick: () => void; icon?: React.ReactNode } }> = {
    mine: {
      title: 'No plans yet',
      message: 'Map out a week of meals once, then log any day of it in one tap.',
      action: { label: 'New plan', onClick: openNew, icon: <Plus size={18} /> },
    },
    discover: {
      title: 'Nothing shared yet',
      message: 'Plans people share to their profile show up here. Share one of yours from its menu to get things going.',
      action: { label: 'See my plans', onClick: () => setTab('mine') },
    },
    saved: {
      title: 'Nothing saved yet',
      message: 'Tap the bookmark on a plan in Discover to keep it here.',
      action: { label: 'Browse Discover', onClick: () => setTab('discover') },
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly plans"
        subtitle="Plan the week once, then log any day in one tap."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>
            New plan
          </Button>
        }
        mobileActions={
          <IconButton label="New plan" onClick={openNew}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', current ? 'bg-brand-soft text-brand-text' : 'bg-surface-2 text-text-3')}>
            <CalendarDays size={22} />
          </span>
          <div className="min-w-0">
            {activePlan.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            ) : activePlan.isError ? (
              <>
                <p className="text-sm font-semibold text-text-1">Couldn’t check your active plan</p>
                <p className="text-xs text-text-2">{errMsg(activePlan.error, 'Try again in a moment.')}</p>
              </>
            ) : current ? (
              <>
                <p className="truncate text-sm font-semibold text-text-1">{current.name}</p>
                <p className="text-xs text-text-2">
                  {todayMeals.length === 0 ? (
                    `Nothing planned for ${format(new Date(), 'EEEE')}. Add meals from the plan card.`
                  ) : (
                    <>
                      <span className="tabular font-semibold text-text-1">{todayMeals.length}</span> {plural(todayMeals.length, 'meal')} planned for today,{' '}
                      <span className="tabular font-semibold text-text-1">{formatStat(kcalOfDay(todayPlan))}</span> kcal
                    </>
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-1">No active plan</p>
                <p className="text-xs text-text-2">Activate one of your plans and log the whole day in one tap.</p>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activePlan.isError ? (
            <Button variant="secondary" onClick={() => void activePlan.refetch()}>
              Retry
            </Button>
          ) : current ? (
            <>
              <Button variant="primary" icon={<Check size={18} />} disabled={todayMeals.length === 0} loading={logToday.isPending && !logToday.variables} onClick={() => logToday.mutate(undefined)}>
                Log today
              </Button>
              {todayTypes.length > 1 ? (
                <Menu
                  label="Log a single meal"
                  items={todayTypes.map((t) => ({ label: `Log ${mealTypeLabel(t).toLowerCase()} only`, icon: <Utensils size={18} />, onSelect: () => logToday.mutate(t) }))}
                  trigger={({ open }) => (
                    <span className={cx('btn btn-secondary [--btn-h:44px] px-3', open && 'bg-surface-3')} aria-hidden="true">
                      <ChevronDown size={18} />
                    </span>
                  )}
                />
              ) : null}
            </>
          ) : !activePlan.isLoading && (mine.data?.length ?? 0) === 0 ? (
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>
              New plan
            </Button>
          ) : null}
        </div>
      </Card>

      <Tabs
        variant="segmented"
        aria-label="Plan collections"
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: t.key === 'mine' ? mine.data?.length : t.key === 'discover' ? discover.data?.length : saved.data?.length,
        }))}
        value={tab}
        onChange={(k: string) => setTab(k as TabKey)}
      />

      {active.isLoading ? (
        <CardSkeletons />
      ) : active.isError ? (
        <ErrorState title="Couldn’t load plans" error={active.error} onRetry={() => active.refetch()} />
      ) : list.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={emptyCopy[tab].title}
            message={emptyCopy[tab].message}
            action={{ ...emptyCopy[tab].action, variant: 'primary' }}
            secondaryAction={tab !== 'mine' ? { label: 'New plan', onClick: openNew, icon: <Plus size={18} /> } : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((plan) => (
            <PlanCard
              key={plan._id}
              plan={plan}
              tab={tab}
              onAddMeal={(p, day) => setAddMealTarget({ plan: p, day })}
              onEdit={(p) => setPlanModal({ open: true, editing: p })}
              onDelete={(p) => setPendingDelete(p)}
            />
          ))}
        </div>
      )}

      <PlanModal open={planModal.open} editing={planModal.editing} onClose={() => setPlanModal({ open: false, editing: null })} />
      <AddMealModal target={addMealTarget} onClose={() => setAddMealTarget(null)} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this plan?"
        message={`“${pendingDelete?.name ?? ''}” and its planned meals will be removed for good. Meals you already logged stay in your log.`}
        confirmLabel="Delete plan"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
