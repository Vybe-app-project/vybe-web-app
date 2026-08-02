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
import { Utensils, Plus, Trash, Edit, Heart, Check, Clock } from './icons';

/* ------------------------------------------------------------------ types */

type TemplateFood = {
  foodId?: string;
  food_name: string;
  brandName?: string;
  servingSize?: string;
  servingsConsumed?: number;
  nutrition?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    sugar?: number;
    sodium?: number;
  };
};

type MealTemplate = {
  _id: string;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string } | string;
  name: string;
  description?: string;
  meal_type?: string;
  foods: TemplateFood[];
  totalNutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  timesUsed?: number;
  lastUsed?: string;
  isPublic?: boolean;
  sharedToProfile?: boolean;
  likes?: string[];
  saves?: string[];
  copyCount?: number;
  image_url?: string;
  tags?: string[];
  isLiked?: boolean;
  isSaved?: boolean;
  createdAt?: string;
};

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

const TABS = [
  { key: 'mine', label: 'My templates' },
  { key: 'discover', label: 'Discover' },
  { key: 'saved', label: 'Saved' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/* ---------------------------------------------------------------- helpers */

const totalsOf = (t: MealTemplate) => {
  if (t.totalNutrition) return t.totalNutrition;
  return (t.foods ?? []).reduce(
    (acc, f) => ({
      calories: (acc.calories ?? 0) + (f.nutrition?.calories ?? 0),
      protein: (acc.protein ?? 0) + (f.nutrition?.protein ?? 0),
      carbs: (acc.carbs ?? 0) + (f.nutrition?.carbs ?? 0),
      fat: (acc.fat ?? 0) + (f.nutrition?.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
};

/* ---------------------------------------------------------- template modal */

type FoodDraft = {
  food_name: string;
  brandName: string;
  servingSize: string;
  servings: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

const emptyFood = (): FoodDraft => ({
  food_name: '',
  brandName: '',
  servingSize: '',
  servings: '1',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
});

const foodDraftsFrom = (t?: MealTemplate | null): FoodDraft[] =>
  t?.foods?.length
    ? t.foods.map((f) => ({
        food_name: f.food_name ?? '',
        brandName: f.brandName ?? '',
        servingSize: f.servingSize ?? '',
        servings: String(f.servingsConsumed ?? 1),
        calories: String(f.nutrition?.calories ?? ''),
        protein: String(f.nutrition?.protein ?? ''),
        carbs: String(f.nutrition?.carbs ?? ''),
        fat: String(f.nutrition?.fat ?? ''),
      }))
    : [emptyFood()];

function TemplateModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: MealTemplate | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [mealType, setMealType] = useState(editing?.meal_type ?? 'breakfast');
  const [foods, setFoods] = useState<FoodDraft[]>(() => foodDraftsFrom(editing));
  const [seedKey, setSeedKey] = useState('');

  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setMealType(editing?.meal_type ?? 'breakfast');
    setFoods(foodDraftsFrom(editing));
  }

  const update = (i: number, patch: Partial<FoodDraft>) =>
    setFoods((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Template name is required');
      const payloadFoods: TemplateFood[] = foods
        .filter((f) => f.food_name.trim())
        .map((f) => ({
          food_name: f.food_name.trim(),
          brandName: f.brandName.trim() || undefined,
          servingSize: f.servingSize.trim() || undefined,
          servingsConsumed: Number(f.servings) || 1,
          nutrition: {
            calories: Number(f.calories) || 0,
            protein: Number(f.protein) || 0,
            carbs: Number(f.carbs) || 0,
            fat: Number(f.fat) || 0,
          },
        }));
      if (!payloadFoods.length) throw new Error('Add at least one food');

      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        meal_type: mealType,
        foods: payloadFoods,
      };
      if (editing) {
        const { data } = await api.put(`/meal-templates/${editing._id}`, body);
        return data;
      }
      const { data } = await api.post('/meal-templates', body);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'Template updated' : 'Template created');
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save template')),
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit template' : 'New meal template'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          placeholder="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          rows={2}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
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

        <div className="space-y-3">
          <p className="text-sm font-semibold">Foods</p>
          {foods.map((food, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--color-line)] p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Food name"
                  value={food.food_name}
                  onChange={(e) => update(i, { food_name: e.target.value })}
                />
                {foods.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove food ${i + 1}`}
                    className="btn btn-ghost px-2"
                    onClick={() => setFoods((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash size={16} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Input
                  placeholder="Brand"
                  value={food.brandName}
                  onChange={(e) => update(i, { brandName: e.target.value })}
                />
                <Input
                  placeholder="Serving size"
                  value={food.servingSize}
                  onChange={(e) => update(i, { servingSize: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  placeholder="Servings"
                  value={food.servings}
                  onChange={(e) => update(i, { servings: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  type="number"
                  min={0}
                  placeholder="Calories"
                  value={food.calories}
                  onChange={(e) => update(i, { calories: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Protein"
                  value={food.protein}
                  onChange={(e) => update(i, { protein: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Carbs"
                  value={food.carbs}
                  onChange={(e) => update(i, { carbs: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Fat"
                  value={food.fat}
                  onChange={(e) => update(i, { fat: e.target.value })}
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setFoods((prev) => [...prev, emptyFood()])}
          >
            <Plus size={16} /> Add food
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- template card */

function TemplateCard({
  template,
  tab,
  onEdit,
  onDelete,
}: {
  template: MealTemplate;
  tab: TabKey;
  onEdit: (t: MealTemplate) => void;
  onDelete: (t: MealTemplate) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const owner = typeof template.user === 'object' && template.user ? template.user : undefined;
  const isMine = tab === 'mine' || (user && owner?._id === user._id);
  const totals = totalsOf(template);

  const liked =
    template.isLiked ?? Boolean(user && (template.likes ?? []).some((v) => String(v) === user._id));
  const saved =
    template.isSaved ?? Boolean(user && (template.saves ?? []).some((v) => String(v) === user._id));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['meal-templates'] });

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/like`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onError: (e) => toast.error(errMsg(e, 'Could not like template')),
    onSuccess: () => invalidate(),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/save`);
      return data as { isSaved: boolean };
    },
    onSuccess: (data) => {
      toast.success(data.isSaved ? 'Saved to collection' : 'Removed from saved');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save template')),
  });

  const copy = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/copy`);
      return data;
    },
    onSuccess: () => {
      toast.success('Copied to your templates');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not copy template')),
  });

  const logTemplate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/log`);
      return data as { message: string };
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Template logged');
      qc.invalidateQueries({ queryKey: ['meals'] });
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not log template')),
  });

  const share = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/share-token`);
      return data as { token: string; expiresAt: string };
    },
    onSuccess: async (data) => {
      const url = `${location.origin}/meal-templates/shared/${data.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Share link copied');
      } catch {
        toast.success(`Share link: ${url}`);
      }
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create share link')),
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{template.name}</p>
          {template.description && (
            <p className="line-clamp-2 text-sm text-[var(--color-muted)]">
              {template.description}
            </p>
          )}
        </div>
        {template.meal_type && <Badge>{template.meal_type}</Badge>}
      </div>

      {template.image_url && (
        <img
          src={mediaUrl(template.image_url)}
          alt={template.name}
          loading="lazy"
          className="h-28 w-full rounded-xl object-cover"
        />
      )}

      <p className="text-xs text-[var(--color-muted)]">
        {Math.round(totals.calories ?? 0)} kcal · P{Math.round(totals.protein ?? 0)}g · C
        {Math.round(totals.carbs ?? 0)}g · F{Math.round(totals.fat ?? 0)}g
      </p>

      <ul className="space-y-1">
        {(template.foods ?? []).slice(0, 4).map((f, i) => (
          <li key={`${template._id}-${i}`} className="truncate text-xs text-[var(--color-muted)]">
            • {f.food_name}
            {f.servingsConsumed && f.servingsConsumed !== 1 ? ` ×${f.servingsConsumed}` : ''}
          </li>
        ))}
        {(template.foods?.length ?? 0) > 4 && (
          <li className="text-xs text-[var(--color-muted)]">
            +{(template.foods?.length ?? 0) - 4} more
          </li>
        )}
      </ul>

      {owner && !isMine && (
        <div className="flex items-center gap-2">
          <Avatar src={mediaUrl(owner.avatar)} alt={owner.username ?? ''} size={22} />
          <span className="text-xs text-[var(--color-muted)]">
            @{owner.username ?? 'unknown'}
          </span>
        </div>
      )}

      {template.timesUsed ? (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
          <Clock size={12} /> used {template.timesUsed}×
        </span>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {isMine ? (
          <>
            <Button variant="primary" onClick={() => logTemplate.mutate()} loading={logTemplate.isPending}>
              <Check size={14} /> Log
            </Button>
            <Button variant="ghost" onClick={() => onEdit(template)}>
              <Edit size={14} /> Edit
            </Button>
            <Button variant="ghost" onClick={() => share.mutate()} loading={share.isPending}>
              Share
            </Button>
            <button
              type="button"
              aria-label="Delete template"
              className="btn btn-ghost px-2"
              onClick={() => onDelete(template)}
            >
              <Trash size={14} />
            </button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => copy.mutate()} loading={copy.isPending}>
              Copy
            </Button>
            <button
              type="button"
              className="btn btn-ghost px-3 py-1 text-xs"
              aria-pressed={liked}
              onClick={() => like.mutate()}
              disabled={like.isPending}
            >
              <Heart size={13} /> {(template.likes ?? []).length}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-3 py-1 text-xs"
              aria-pressed={saved}
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function MealTemplates() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('mine');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<MealTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MealTemplate | null>(null);
  const [search, setSearch] = useState('');

  const mine = useQuery({
    queryKey: ['meal-templates', 'mine'],
    queryFn: async (): Promise<MealTemplate[]> => {
      const { data } = await api.get<MealTemplate[]>('/meal-templates');
      return data;
    },
    enabled: tab === 'mine',
  });

  const discover = useQuery({
    queryKey: ['meal-templates', 'discover'],
    queryFn: async (): Promise<MealTemplate[]> => {
      const { data } = await api.get<MealTemplate[]>('/meal-templates/feed/shared', {
        params: { page: 1, limit: 50 },
      });
      return data;
    },
    enabled: tab === 'discover',
  });

  const saved = useQuery({
    queryKey: ['meal-templates', 'saved'],
    queryFn: async (): Promise<MealTemplate[]> => {
      const { data } = await api.get<MealTemplate[]>('/meal-templates/feed/saved');
      return data;
    },
    enabled: tab === 'saved',
  });

  const active = tab === 'mine' ? mine : tab === 'discover' ? discover : saved;

  const remove = useMutation({
    mutationFn: async (template: MealTemplate) => {
      await api.delete(`/meal-templates/${template._id}`);
      return template._id;
    },
    onMutate: async (template) => {
      const key = ['meal-templates', 'mine'];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MealTemplate[]>(key);
      qc.setQueryData<MealTemplate[]>(key, (old) =>
        (old ?? []).filter((t) => t._id !== template._id),
      );
      return { previous, key };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      toast.error(errMsg(e, 'Could not delete template'));
    },
    onSuccess: () => toast.success('Template deleted'),
    onSettled: () => {
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
    },
  });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = active.data ?? [];
    return q ? data.filter((t) => t.name.toLowerCase().includes(q)) : data;
  }, [active.data, search]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Meal templates</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Save meals you eat often and log them in one tap.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setModal(true);
          }}
        >
          <Plus size={16} /> New template
        </Button>
      </header>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(k: string) => setTab(k as TabKey)}
      />

      <Input
        placeholder="Filter templates…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {active.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : active.isError ? (
        <ErrorState
          message={errMsg(active.error, 'Could not load templates')}
          onRetry={() => active.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Utensils size={28} />}
          title={
            tab === 'mine'
              ? 'No templates yet'
              : tab === 'saved'
                ? 'Nothing saved yet'
                : 'Nothing shared yet'
          }
          description={
            tab === 'mine'
              ? 'Create a template for your go-to meals.'
              : tab === 'saved'
                ? 'Save templates from Discover to find them here.'
                : 'Check back later for meals shared by the community.'
          }
          action={
            tab === 'mine' ? (
              <Button variant="primary" onClick={() => setModal(true)}>
                <Plus size={16} /> New template
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((template) => (
            <TemplateCard
              key={template._id}
              template={template}
              tab={tab}
              onEdit={(t) => {
                setEditing(t);
                setModal(true);
              }}
              onDelete={(t) => setPendingDelete(t)}
            />
          ))}
        </div>
      )}

      <TemplateModal
        open={modal}
        editing={editing}
        onClose={() => {
          setModal(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete template"
        message={`"${pendingDelete?.name ?? ''}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
