import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { shareOrCopy, shareUrls } from '../lib/share';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardGrid,
  CardMedia,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  Stepper,
  Tabs,
  Textarea,
  cx,
  formatStat,
  usePulse,
  useToast,
} from './ui';
import type { MenuItem } from './ui';
import { Utensils, Plus, Trash, Edit, Heart, Check, Clock, Bookmark, Copy, Link as LinkIcon, Globe, ShareUp } from './icons';
import { FoodSearch, MacroLine, MEAL_TYPE_OPTIONS, defaultMealType, mealTypeLabel, plural, selectedFoodNutrition, type SelectedFood } from './Meals';

/* ------------------------------------------------------------------ types */

type TemplateNutrition = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
};

type TemplateFood = {
  foodId?: string;
  food_name: string;
  brandName?: string;
  servingSize?: string;
  servingsConsumed?: number;
  nutrition?: TemplateNutrition;
};

type TemplateOwner = { _id: string; username?: string; fullName?: string; avatar?: string };

type MealTemplate = {
  _id: string;
  user?: TemplateOwner | string;
  name: string;
  description?: string;
  meal_type?: string;
  foods: TemplateFood[];
  totalNutrition?: TemplateNutrition;
  timesUsed?: number;
  lastUsed?: string;
  isPublic?: boolean;
  sharedToProfile?: boolean;
  likes?: string[];
  saves?: string[];
  likesCount?: number;
  savesCount?: number;
  copyCount?: number;
  image_url?: string;
  tags?: string[];
  isLiked?: boolean;
  isSaved?: boolean;
  isOwner?: boolean;
  createdAt?: string;
};

const TABS = [
  { key: 'mine', label: 'Mine' },
  { key: 'discover', label: 'Discover' },
  { key: 'saved', label: 'Saved' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/* ---------------------------------------------------------------- helpers */

const totalsOf = (t: MealTemplate): TemplateNutrition => {
  if (t.totalNutrition) return t.totalNutrition;
  return (t.foods ?? []).reduce<TemplateNutrition>(
    (acc, f) => {
      const k = f.servingsConsumed ?? 1;
      return {
        calories: (acc.calories ?? 0) + (f.nutrition?.calories ?? 0) * k,
        protein: (acc.protein ?? 0) + (f.nutrition?.protein ?? 0) * k,
        carbs: (acc.carbs ?? 0) + (f.nutrition?.carbs ?? 0) * k,
        fat: (acc.fat ?? 0) + (f.nutrition?.fat ?? 0) * k,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
};

const ownerOf = (t: MealTemplate): TemplateOwner | undefined => (typeof t.user === 'object' && t.user ? t.user : undefined);

const shareUrlFor = shareUrls.template;

const FOOD_LIMIT = 4;

function FoodList({ foods, id }: { foods: TemplateFood[]; id: string }) {
  if (!foods.length) return <p className="text-xs text-text-3">No foods added yet.</p>;
  return (
    <ul className="space-y-0.5 text-xs text-text-2" aria-label="Foods">
      {foods.slice(0, FOOD_LIMIT).map((f, i) => (
        <li key={`${id}-${i}`} className="flex items-baseline gap-2">
          <span className="truncate">{f.food_name}</span>
          {f.servingsConsumed && f.servingsConsumed !== 1 ? <span className="tabular shrink-0 text-text-3">{f.servingsConsumed}×</span> : null}
        </li>
      ))}
      {foods.length > FOOD_LIMIT ? <li className="text-text-3">and {foods.length - FOOD_LIMIT} more</li> : null}
    </ul>
  );
}

/* ---------------------------------------------------------- template modal */

type FoodDraft = {
  food_name: string;
  brandName: string;
  servingSize: string;
  servings: number;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

const emptyFood = (): FoodDraft => ({
  food_name: '',
  brandName: '',
  servingSize: '',
  servings: 1,
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
        servings: f.servingsConsumed ?? 1,
        calories: f.nutrition?.calories != null ? String(f.nutrition.calories) : '',
        protein: f.nutrition?.protein != null ? String(f.nutrition.protein) : '',
        carbs: f.nutrition?.carbs != null ? String(f.nutrition.carbs) : '',
        fat: f.nutrition?.fat != null ? String(f.nutrition.fat) : '',
      }))
    : [emptyFood()];

const MACRO_FIELDS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;

function TemplateModal({ open, editing, onClose }: { open: boolean; editing: MealTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [mealType, setMealType] = useState(editing?.meal_type ?? defaultMealType());
  const [foods, setFoods] = useState<FoodDraft[]>(() => foodDraftsFrom(editing));
  const [errors, setErrors] = useState<{ name?: string; foods?: string }>({});
  const [seedKey, setSeedKey] = useState('');

  // Re-seed the form whenever the modal opens for a different template.
  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setMealType(editing?.meal_type ?? defaultMealType());
    setFoods(foodDraftsFrom(editing));
    setErrors({});
  }

  const update = (i: number, patch: Partial<FoodDraft>) => setFoods((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const isBlank = (f: FoodDraft) => !f.food_name.trim() && !f.calories && !f.protein && !f.carbs && !f.fat;
  const fmt = (v?: number) => (v == null ? '' : String(Math.round(v * 10) / 10));

  /**
   * A catalog pick fills a food row (the last blank one, or a new one) with
   * its name, brand, serving and per-serving macros. Every field stays
   * editable, so the manual path is still there for foods not in the catalog.
   */
  const addFromCatalog = (picked: SelectedFood) => {
    const perServing = selectedFoodNutrition({ ...picked, servings: 1 });
    const draft: FoodDraft = {
      food_name: picked.name,
      brandName: picked.brand ?? '',
      servingSize: picked.servingLabel,
      servings: 1,
      calories: fmt(perServing.calories),
      protein: fmt(perServing.protein),
      carbs: fmt(perServing.carbs),
      fat: fmt(perServing.fat),
    };
    setErrors((er) => ({ ...er, foods: undefined }));
    setFoods((prev) => {
      const last = prev[prev.length - 1];
      return last && isBlank(last) ? [...prev.slice(0, -1), draft] : [...prev, draft];
    });
  };

  const totals = useMemo(
    () =>
      foods.reduce(
        (acc, f) => ({
          calories: acc.calories + (Number(f.calories) || 0) * f.servings,
          protein: acc.protein + (Number(f.protein) || 0) * f.servings,
          carbs: acc.carbs + (Number(f.carbs) || 0) * f.servings,
          fat: acc.fat + (Number(f.fat) || 0) * f.servings,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [foods],
  );

  const save = useMutation({
    mutationFn: async () => {
      const next: typeof errors = {};
      if (!name.trim()) next.name = 'Give the template a name.';
      const payloadFoods: TemplateFood[] = foods
        .filter((f) => f.food_name.trim())
        .map((f) => ({
          food_name: f.food_name.trim(),
          brandName: f.brandName.trim() || undefined,
          servingSize: f.servingSize.trim() || undefined,
          servingsConsumed: f.servings || 1,
          nutrition: {
            calories: Number(f.calories) || 0,
            protein: Number(f.protein) || 0,
            carbs: Number(f.carbs) || 0,
            fat: Number(f.fat) || 0,
          },
        }));
      if (!payloadFoods.length) next.foods = 'Add at least one food with a name.';
      if (next.name || next.foods) {
        setErrors(next);
        throw new Error('validation');
      }
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
      toast.success(editing ? 'Template saved' : 'Template created');
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
      onClose();
    },
    onError: (e) => {
      if ((e as Error)?.message !== 'validation') toast.error(errMsg(e, 'Could not save template'));
    },
  });

  const formId = 'meal-template-form';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit template' : 'New meal template'}
      description="A template is a meal you eat often. Log it in one tap from the Templates tab."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Input
            label="Template name"
            placeholder="Overnight oats"
            value={name}
            error={errors.name}
            autoComplete="off"
            onChange={(e) => {
              setErrors((er) => ({ ...er, name: undefined }));
              setName(e.target.value);
            }}
          />
          <Select label="Meal type" value={mealType} onChange={setMealType} options={MEAL_TYPE_OPTIONS} />
        </div>
        <Textarea
          label="Description"
          hint="Optional"
          rows={2}
          autoGrow
          maxRows={4}
          placeholder="What makes this one work for you?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <fieldset className="space-y-3">
          <legend className="type-label mb-2 text-text-2">Foods</legend>
          <FoodSearch onAdd={addFromCatalog} label="Search foods to add" placeholder="Greek yogurt, rolled oats, chicken breast…" />
          {foods.map((food, i) => (
            <div key={i} className="space-y-3 rounded-md border border-line bg-surface-1 p-3">
              <div className="flex items-end gap-2">
                <Input
                  label={`Food ${i + 1}`}
                  placeholder="Rolled oats"
                  value={food.food_name}
                  containerClassName="flex-1"
                  onChange={(e) => {
                    setErrors((er) => ({ ...er, foods: undefined }));
                    update(i, { food_name: e.target.value });
                  }}
                />
                <IconButton
                  label={`Remove food ${i + 1}`}
                  variant="ghost"
                  disabled={foods.length === 1}
                  onClick={() => setFoods((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash size={18} />
                </IconButton>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input label="Brand" hint="Optional" placeholder="Quaker" value={food.brandName} onChange={(e) => update(i, { brandName: e.target.value })} />
                <Input label="Serving size" placeholder="80 g" value={food.servingSize} onChange={(e) => update(i, { servingSize: e.target.value })} />
                <Stepper
                  label="Servings"
                  value={food.servings}
                  min={0.5}
                  max={20}
                  step={0.5}
                  format={(v) => `${v}×`}
                  onChange={(next) => update(i, { servings: next })}
                  containerClassName="col-span-2 sm:col-span-1"
                />
              </div>
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
                    value={food[m.key]}
                    onChange={(e) => update(i, { [m.key]: e.target.value })}
                  />
                ))}
              </div>
            </div>
          ))}
          {errors.foods ? (
            <p role="alert" className="text-xs text-danger">
              {errors.foods}
            </p>
          ) : null}
          <Button type="button" variant="secondary" icon={<Plus size={18} />} onClick={() => setFoods((prev) => [...prev, emptyFood()])}>
            Add another food
          </Button>
        </fieldset>

        <div className="rounded-md bg-surface-2 p-3" aria-live="polite">
          <p className="type-label text-text-2">Whole template</p>
          <MacroLine nutrition={totals} className="mt-1 text-sm" />
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- shared modal */

function SharedTemplateModal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const shared = useQuery({
    queryKey: ['meal-templates', 'shared-link', token],
    queryFn: async (): Promise<MealTemplate> => {
      const { data } = await api.get<MealTemplate>(`/meal-templates/shared/${encodeURIComponent(token ?? '')}`);
      return data;
    },
    enabled: Boolean(token),
    retry: false,
  });

  const copy = useMutation({
    mutationFn: async () => {
      if (!shared.data) throw new Error('Nothing to copy');
      const { data } = await api.post(`/meal-templates/${shared.data._id}/copy`, { shareToken: token });
      return data;
    },
    onSuccess: () => {
      toast.success('Added to your templates');
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not copy this template')),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!shared.data) throw new Error('Nothing to save');
      const { data } = await api.post(`/meal-templates/${shared.data._id}/save`, { shareToken: token });
      return data as { isSaved: boolean };
    },
    onSuccess: (data) => {
      toast.success(data.isSaved ? 'Saved' : 'Removed from saved');
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save this template')),
  });

  const t = shared.data;
  const owner = t ? ownerOf(t) : undefined;

  return (
    <Modal
      open={Boolean(token)}
      onClose={onClose}
      title="Shared template"
      description={owner ? `Shared by ${owner.fullName || `@${owner.username ?? 'a Vybe member'}`}` : undefined}
      size="sm"
      footer={
        t && !t.isOwner ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" icon={<Bookmark size={18} filled={Boolean(t.isSaved)} />} loading={save.isPending} onClick={() => save.mutate()}>
              {t.isSaved ? 'Saved' : 'Save'}
            </Button>
            <Button variant="primary" icon={<Copy size={18} />} loading={copy.isPending} onClick={() => copy.mutate()}>
              Add to my templates
            </Button>
          </div>
        ) : undefined
      }
    >
      {shared.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : shared.isError || !t ? (
        <ErrorState
          title="This link has expired"
          message="Share links stop working after a while. Ask for a fresh one."
          action={
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-md font-semibold text-text-1">{t.name}</p>
              {t.description ? <p className="mt-0.5 text-sm text-text-2">{t.description}</p> : null}
            </div>
            <Badge tone="brand">{mealTypeLabel(t.meal_type)}</Badge>
          </div>
          {t.image_url ? (
            <CardMedia ratio="16/9">
              <img src={mediaUrl(t.image_url)} alt="" className="h-full w-full object-cover" />
            </CardMedia>
          ) : null}
          <MacroLine nutrition={totalsOf(t)} />
          <FoodList foods={t.foods ?? []} id={t._id} />
          {t.isOwner ? <p className="text-xs text-text-2">This is one of your own templates.</p> : null}
        </div>
      )}
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const pulse = usePulse();

  const owner = ownerOf(template);
  const isMine = template.isOwner ?? (tab === 'mine' || Boolean(user && owner?._id === user._id));
  const totals = totalsOf(template);
  const liked = template.isLiked ?? Boolean(user && (template.likes ?? []).some((v) => String(v) === user._id));
  const saved = template.isSaved ?? Boolean(user && (template.saves ?? []).some((v) => String(v) === user._id));
  const likeCount = template.likesCount ?? (template.likes ?? []).length;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['meal-templates'] });

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/like`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onError: (e) => toast.error(errMsg(e, 'Could not like template')),
    onSettled: () => invalidate(),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/save`);
      return data as { isSaved: boolean };
    },
    onSuccess: (data) => {
      toast.success(data.isSaved ? 'Saved' : 'Removed from saved');
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
      toast.success('Added to your templates');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not copy template')),
  });

  const logTemplate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/log`, { timezoneOffsetMinutes: new Date().getTimezoneOffset() });
      return data as { message?: string };
    },
    onSuccess: () => {
      const n = template.foods?.length ?? 0;
      toast.success(`Logged ${template.name} as one ${mealTypeLabel(template.meal_type).toLowerCase()}${n > 1 ? ` (${n} foods)` : ''}`, {
        action: { label: 'View meals', onClick: () => navigate('/meals', { viewTransition: true }) },
      });
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['nutrition-summary'] });
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not log template')),
  });

  const share = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/meal-templates/${template._id}/share-token`);
      return data as { token: string; expiresAt: string };
    },
    onSuccess: (data) => void shareOrCopy(shareUrlFor(data.token), `${template.name} on Vybe`, toast),
    onError: (e) => toast.error(errMsg(e, 'Could not create a share link')),
  });

  const profileShare = useMutation({
    mutationFn: async () => {
      const { data } = template.sharedToProfile
        ? await api.post(`/meal-templates/${template._id}/unshare-profile`)
        : await api.post(`/meal-templates/${template._id}/share-profile`);
      return data;
    },
    onSuccess: () => {
      toast.success(template.sharedToProfile ? 'Removed from your profile' : 'Shared to your profile');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update sharing')),
  });

  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const revoke = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete(`/meal-templates/${template._id}/share-token`);
      return data;
    },
    onSuccess: () => toast.success('Share links revoked'),
    onError: (e) => toast.error(errMsg(e, 'Could not revoke share links')),
    onSettled: () => setConfirmRevoke(false),
  });

  const ownerMenu: MenuItem[] = [
    { label: 'Edit template', icon: <Edit size={18} />, onSelect: () => onEdit(template) },
    { label: 'Copy share link', description: 'Anyone with the link can view and copy it', icon: <LinkIcon size={18} />, onSelect: () => share.mutate() },
    {
      label: template.sharedToProfile ? 'Remove from profile' : 'Share to profile',
      description: template.sharedToProfile ? 'Hide it from Discover' : 'Show it in Discover and on your profile',
      icon: <Globe size={18} />,
      onSelect: () => profileShare.mutate(),
    },
    { label: 'Revoke share links', description: 'Every link you sent stops working', icon: <ShareUp size={18} />, onSelect: () => setConfirmRevoke(true) },
    { label: 'Delete template', icon: <Trash size={18} />, danger: true, divider: true, onSelect: () => onDelete(template) },
  ];

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold text-text-1">{template.name}</h3>
          {template.description ? <p className="mt-0.5 line-clamp-2 text-sm text-text-2">{template.description}</p> : null}
        </div>
        <Badge tone="brand" className="shrink-0">
          {mealTypeLabel(template.meal_type)}
        </Badge>
      </div>

      {template.image_url ? (
        <CardMedia ratio="16/9">
          <img src={mediaUrl(template.image_url)} alt="" loading="lazy" className="h-full w-full object-cover" />
        </CardMedia>
      ) : null}

      <MacroLine nutrition={totals} />
      <FoodList foods={template.foods ?? []} id={template._id} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
        {owner && !isMine ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar src={owner.avatar} name={owner.fullName || owner.username} alt="" size="xs" />
            <span className="truncate">{owner.fullName || `@${owner.username ?? 'member'}`}</span>
          </span>
        ) : null}
        {template.timesUsed ? (
          <span className="inline-flex items-center gap-1">
            <Clock size={13} /> Logged {formatStat(template.timesUsed)} {plural(template.timesUsed, 'time')}
          </span>
        ) : null}
        {isMine && template.sharedToProfile ? (
          <Badge tone="neutral">
            <Globe size={12} /> On profile
          </Badge>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1">
        {isMine ? (
          <>
            <Button variant="primary" icon={<Check size={18} />} onClick={() => logTemplate.mutate()} loading={logTemplate.isPending} className="flex-1 sm:flex-none">
              Log now
            </Button>
            <Button variant="secondary" icon={<Edit size={18} />} onClick={() => onEdit(template)} className="hidden sm:inline-flex">
              Edit
            </Button>
            <span className="ml-auto">
              <Menu label={`Options for ${template.name}`} items={ownerMenu} />
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
              <IconButton label={saved ? 'Remove from saved' : 'Save template'} active={saved} onClick={() => save.mutate()} disabled={save.isPending}>
                <Bookmark size={20} filled={saved} />
              </IconButton>
            </span>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmRevoke}
        title="Revoke every share link?"
        message={`Anyone you sent a link to “${template.name}” will see that it expired. You can create a fresh link afterwards.`}
        confirmLabel="Revoke links"
        destructive
        loading={revoke.isPending}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => revoke.mutate()}
      />
    </Card>
  );
}

function CardSkeletons({ count = 6 }: { count?: number }) {
  return (
    <CardGrid min="20rem" aria-busy="true" aria-label="Loading templates">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-3 p-4 sm:p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-11 w-28" />
            <Skeleton className="h-11 w-11" />
          </div>
        </div>
      ))}
    </CardGrid>
  );
}

/* ------------------------------------------------------------------- page */

export default function MealTemplates() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('mine');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<MealTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MealTemplate | null>(null);
  const [search, setSearch] = useState('');

  const sharedToken = params.get('shared');
  const closeShared = () => {
    const next = new URLSearchParams(params);
    next.delete('shared');
    setParams(next, { replace: true });
  };

  const mine = useQuery({
    queryKey: ['meal-templates', 'mine'],
    queryFn: async (): Promise<MealTemplate[]> => {
      const { data } = await api.get<MealTemplate[]>('/meal-templates');
      return data;
    },
  });

  const discover = useQuery({
    queryKey: ['meal-templates', 'discover'],
    queryFn: async (): Promise<MealTemplate[]> => {
      const { data } = await api.get<MealTemplate[]>('/meal-templates/feed/shared', { params: { page: 1, limit: 50 } });
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
      qc.setQueryData<MealTemplate[]>(key, (old) => (old ?? []).filter((t) => t._id !== template._id));
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
    if (!q) return data;
    return data.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.foods ?? []).some((f) => f.food_name?.toLowerCase().includes(q)) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [active.data, search]);

  const openNew = () => {
    setEditing(null);
    setModal(true);
  };

  const emptyCopy: Record<TabKey, { title: string; message: string; action: { label: string; onClick: () => void; icon?: React.ReactNode } }> = {
    mine: {
      title: 'No templates yet',
      message: 'Save a meal you eat often and log it in one tap next time.',
      action: { label: 'New template', onClick: openNew, icon: <Plus size={18} /> },
    },
    discover: {
      title: 'Nothing shared yet',
      message: 'Templates people share to their profile show up here. Share one of yours from its menu to get things going.',
      action: { label: 'See my templates', onClick: () => setTab('mine') },
    },
    saved: {
      title: 'Nothing saved yet',
      message: 'Tap the bookmark on a template in Discover to keep it here.',
      action: { label: 'Browse Discover', onClick: () => setTab('discover') },
    },
  };

  return (
    <div className="space-y-section">
      <PageHeader
        title="Meal templates"
        subtitle="Save the meals you eat often and log them in one tap."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>
            New template
          </Button>
        }
        mobileActions={
          <IconButton label="New template" onClick={openNew}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          variant="segmented"
          aria-label="Template collections"
          tabs={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            count: t.key === 'mine' ? mine.data?.length : t.key === 'discover' ? discover.data?.length : saved.data?.length,
          }))}
          value={tab}
          onChange={(k: string) => setTab(k as TabKey)}
        />
        <SearchField
          label="Filter templates"
          hideLabel
          placeholder="Filter by name, food or tag"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="sm:max-w-xs"
        />
      </div>

      {active.isLoading ? (
        <CardSkeletons />
      ) : active.isError ? (
        <ErrorState title="Couldn’t load templates" error={active.error} onRetry={() => active.refetch()} />
      ) : list.length === 0 ? (
        <Card padded={false}>
          {search.trim() && (active.data?.length ?? 0) > 0 ? (
            <EmptyState
              variant="no-results"
              title={`No templates match “${search.trim()}”`}
              message="Try a shorter word, or clear the filter."
              action={{ label: 'Clear filter', onClick: () => setSearch(''), variant: 'secondary' }}
            />
          ) : (
            <EmptyState
              family="fuel"
              title={emptyCopy[tab].title}
              message={emptyCopy[tab].message}
              action={{ ...emptyCopy[tab].action, variant: 'primary' }}
              secondaryAction={tab !== 'mine' ? { label: 'New template', onClick: openNew, icon: <Plus size={18} /> } : undefined}
            />
          )}
        </Card>
      ) : (
        <CardGrid min="20rem">
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
        </CardGrid>
      )}

      <TemplateModal
        open={modal}
        editing={editing}
        onClose={() => {
          setModal(false);
          setEditing(null);
        }}
      />
      <SharedTemplateModal token={sharedToken} onClose={closeShared} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this template?"
        message={`“${pendingDelete?.name ?? ''}” will be removed for good. Meals you already logged from it stay in your log.`}
        confirmLabel="Delete template"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
