import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
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
  SkeletonCard,
  StatGrid,
  StatTile,
  Stepper,
  Tabs,
  Textarea,
  cx,
  formatStat,
  humanize,
  usePulse,
  useToast,
  type MenuItem,
  type SelectOption,
} from './ui';
import {
  Activity,
  Clock,
  Copy,
  Dumbbell,
  Edit,
  Flag,
  Flame,
  Globe,
  Heart,
  Layers,
  MessageCircle,
  Plus,
  ShareUp,
  Trash,
} from './icons';
import { useReportModal } from './Report';

/* ------------------------------------------------------------------ types */

export type WorkoutExercise = {
  _id?: string;
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  duration?: number;
  rest?: number;
  distance?: number;
  notes?: string;
};

export type WorkoutAuthor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

export type SocialWorkout = {
  _id: string;
  title: string;
  description?: string;
  category: string;
  level?: string;
  duration?: number;
  caloriesBurned?: number;
  exercises?: WorkoutExercise[];
  image?: { uri?: string };
  hashtags?: string[];
  isPublic?: boolean;
  isPremade?: boolean;
  createdBy?: WorkoutAuthor | null;
  likes?: string[];
  comments?: unknown[];
  createdAt?: string;
};

export type WorkoutPlan = {
  _id: string;
  title: string;
  description?: string;
  goal?: string;
  level?: string;
  durationWeeks?: number;
  image?: { uri?: string };
  isPublic?: boolean;
  hashtags?: string[];
  createdBy?: WorkoutAuthor | null;
  workouts?: { workout?: SocialWorkout | null; day: number; week: number; order?: number }[];
  likes?: string[];
  createdAt?: string;
};

type ListEnvelope<T> = {
  success?: boolean;
  data?: T[];
  pagination?: { page: number; limit: number; total: number; pages: number };
};

export const CATEGORIES = [
  'strength',
  'cardio',
  'yoga',
  'running',
  'hiit',
  'flexibility',
  'sports',
  'other',
] as const;

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** Humanised option lists shared by the workout, plan and log forms. */
export const CATEGORY_OPTIONS: SelectOption[] = CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
export const LEVEL_OPTIONS: SelectOption[] = LEVELS.map((l) => ({ value: l, label: humanize(l) }));

const TABS = [
  { key: 'mine', label: 'Mine' },
  { key: 'plans', label: 'Plans' },
  { key: 'explore', label: 'Explore' },
  { key: 'premade', label: 'Premade' },
] as const;

type TabKey = (typeof TABS)[number]['key'];
const isTabKey = (v: string | null): v is TabKey => TABS.some((t) => t.key === v);

/* -------------------------------------------------------------- fetchers */

async function fetchMyWorkouts(): Promise<SocialWorkout[]> {
  const { data } = await api.get<ListEnvelope<SocialWorkout>>('/workouts/my', {
    params: { page: 1, limit: 50 },
  });
  return data.data ?? [];
}

async function fetchMyPlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<ListEnvelope<WorkoutPlan>>('/workouts/plans/my', {
    params: { page: 1, limit: 50 },
  });
  return data.data ?? [];
}

async function fetchExplore(): Promise<SocialWorkout[]> {
  const { data } = await api.get<ListEnvelope<SocialWorkout>>(
    '/workouts/filter/all/workouts/feed/filter/feed',
    { params: { page: 1, limit: 50 } },
  );
  return data.data ?? [];
}

async function fetchPremade(): Promise<SocialWorkout[]> {
  const { data } = await api.get<{ workouts?: SocialWorkout[] }>(
    '/workouts/commom/workouts/all/premade/fetch',
  );
  return data.workouts ?? [];
}

/* ------------------------------------------------------------ small bits */

function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Quiet, non-interactive facts about a workout: exercises, minutes, kcal. */
export function MetaList({
  items,
  className,
}: {
  items: Array<{ icon: ReactNode; label: string; title?: string } | null | false>;
  className?: string;
}) {
  const list = items.filter(Boolean) as Array<{ icon: ReactNode; label: string; title?: string }>;
  if (!list.length) return null;
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-text-2', className)}>
      {list.map((m) => (
        <li key={m.label} className="inline-flex items-center gap-1.5 tabular" title={m.title}>
          <span className="text-text-3" aria-hidden="true">
            {m.icon}
          </span>
          {m.label}
        </li>
      ))}
    </ul>
  );
}

/** Heart with the spring pulse. `count` stays visible so the button reads as a stat too. */
export function LikeButton({
  liked,
  count,
  onToggle,
  disabled,
  className,
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const { className: pulseClass, pulse } = usePulse();
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={`${liked ? 'Unlike' : 'Like'}, ${formatStat(count)} ${count === 1 ? 'like' : 'likes'}`}
      disabled={disabled}
      onClick={() => {
        if (!liked) pulse();
        onToggle();
      }}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold transition-colors dur-1',
        liked ? 'text-brand-text' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
        'disabled:cursor-not-allowed disabled:text-text-3',
        className,
      )}
    >
      <Heart size={20} filled={liked} className={pulseClass} />
      <span className="tabular">{formatStat(count)}</span>
    </button>
  );
}

/** Native share where available, otherwise copy the link. */
export async function shareWorkout(
  workout: Pick<SocialWorkout, '_id' | 'title'>,
  toast: ReturnType<typeof useToast>,
  mode: 'share' | 'copy' = 'share',
) {
  const url = `${window.location.origin}/workouts/${workout._id}`;
  try {
    if (mode === 'share' && typeof navigator.share === 'function') {
      await navigator.share({ title: workout.title, text: `${workout.title} on Vybe`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return;
    toast.error('Could not share this workout');
  }
}

/* --------------------------------------------------------- exercise editor */

export type ExerciseDraft = {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  duration: string;
  notes: string;
};

export const emptyExercise = (): ExerciseDraft => ({
  name: '',
  sets: '',
  reps: '',
  weight: '',
  duration: '',
  notes: '',
});

export const exerciseDraftFrom = (e: Partial<WorkoutExercise>): ExerciseDraft => ({
  name: e.name ?? '',
  sets: e.sets != null ? String(e.sets) : '',
  reps: e.reps != null ? String(e.reps) : '',
  weight: e.weight != null ? String(e.weight) : '',
  duration: e.duration != null ? String(e.duration) : '',
  notes: e.notes ?? '',
});

export function toExercisePayload(d: ExerciseDraft): WorkoutExercise {
  const num = (v: string) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  return {
    name: d.name.trim(),
    sets: num(d.sets),
    reps: num(d.reps),
    weight: num(d.weight),
    duration: num(d.duration),
    notes: d.notes.trim() || undefined,
  };
}

/**
 * Repeating exercise rows for the workout and session forms. Every field is
 * labelled; the remove control is a 44 px icon button.
 */
export function ExerciseRows({
  value,
  onChange,
  showNotes = true,
  error,
}: {
  value: ExerciseDraft[];
  onChange: (next: ExerciseDraft[]) => void;
  showNotes?: boolean;
  error?: string;
}) {
  const update = (i: number, patch: Partial<ExerciseDraft>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const headingId = useId();

  return (
    <fieldset className="space-y-3" aria-describedby={error ? `${headingId}-error` : undefined}>
      <legend id={headingId} className="type-label mb-2 text-text-2">
        Exercises
      </legend>
      {value.map((row, i) => (
        <div key={i} className="space-y-3 rounded-md border border-line bg-surface-2/40 p-3">
          <div className="flex items-end gap-2">
            <Input
              label={`Exercise ${i + 1}`}
              placeholder="e.g. Back squat"
              autoComplete="off"
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            {value.length > 1 ? (
              <IconButton
                label={`Remove exercise ${i + 1}`}
                variant="ghost"
                className="mb-0.5 text-text-2 hover:text-danger"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <Trash size={20} />
              </IconButton>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              label="Sets"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.sets}
              onChange={(e) => update(i, { sets: e.target.value })}
            />
            <Input
              label="Reps"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.reps}
              onChange={(e) => update(i, { reps: e.target.value })}
            />
            <Input
              label="Weight (kg)"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              placeholder="0"
              value={row.weight}
              onChange={(e) => update(i, { weight: e.target.value })}
            />
            <Input
              label="Minutes"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.duration}
              onChange={(e) => update(i, { duration: e.target.value })}
            />
          </div>
          {showNotes ? (
            <Input
              label="Notes"
              hint="Optional. Tempo, cues, how it felt."
              value={row.notes}
              onChange={(e) => update(i, { notes: e.target.value })}
            />
          ) : null}
        </div>
      ))}
      {error ? (
        <p id={`${headingId}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="secondary" icon={<Plus size={18} />} onClick={() => onChange([...value, emptyExercise()])}>
        Add exercise
      </Button>
    </fieldset>
  );
}

/* ------------------------------------------------------- workout modal form */

type WorkoutFormState = {
  title: string;
  description: string;
  category: string;
  level: string;
  duration: string;
  caloriesBurned: string;
  hashtags: string;
  isPublic: boolean;
  exercises: ExerciseDraft[];
};

const workoutFormFrom = (w?: SocialWorkout | null): WorkoutFormState => ({
  title: w?.title ?? '',
  description: w?.description ?? '',
  category: w?.category ?? 'strength',
  level: w?.level ?? 'beginner',
  duration: w?.duration != null ? String(w.duration) : '',
  caloriesBurned: w?.caloriesBurned != null ? String(w.caloriesBurned) : '',
  hashtags: (w?.hashtags ?? []).join(', '),
  isPublic: w?.isPublic ?? true,
  exercises: w?.exercises && w.exercises.length ? w.exercises.map(exerciseDraftFrom) : [emptyExercise()],
});

export function WorkoutModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: SocialWorkout | null;
  onClose: () => void;
  onSaved?: (workout: SocialWorkout | undefined) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const [form, setForm] = useState<WorkoutFormState>(() => workoutFormFrom(editing));
  const [formKey, setFormKey] = useState('');
  const [errors, setErrors] = useState<{ title?: string; exercises?: string }>({});

  // Re-seed the form whenever the modal is (re)opened for a different target.
  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== formKey) {
    setFormKey(seed);
    setForm(workoutFormFrom(editing));
    setErrors({});
  }

  const set = <K extends keyof WorkoutFormState>(k: K, v: WorkoutFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const exercises = form.exercises.map(toExercisePayload).filter((e) => e.name.length > 0);
      const next: typeof errors = {};
      if (!form.title.trim()) next.title = 'Give the workout a title.';
      if (!exercises.length) next.exercises = 'Add at least one exercise with a name.';
      setErrors(next);
      if (next.title || next.exercises) throw Object.assign(new Error('validation'), { silent: true });
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        level: form.level,
        duration: form.duration ? Number(form.duration) : undefined,
        caloriesBurned: form.caloriesBurned ? Number(form.caloriesBurned) : undefined,
        hashtags: form.hashtags
          .split(',')
          .map((t) => t.trim().replace(/^#/, '').toLowerCase())
          .filter(Boolean),
        isPublic: form.isPublic,
        exercises,
      };
      if (editing) {
        // PATCH /workouts/:id only flips visibility; the full edit is PUT /workouts/update/:id.
        const { data } = await api.put<{ data?: SocialWorkout; workout?: SocialWorkout }>(`/workouts/update/${editing._id}`, payload);
        return data?.data ?? data?.workout;
      }
      const { data } = await api.post<{ data?: SocialWorkout; workout?: SocialWorkout }>('/workouts/create', payload);
      return data?.data ?? data?.workout;
    },
    onSuccess: (saved) => {
      toast.success(editing ? 'Workout saved' : 'Workout created');
      qc.invalidateQueries({ queryKey: ['workouts'] });
      if (editing) qc.invalidateQueries({ queryKey: ['workout', editing._id] });
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      toast.error(errMsg(e, 'Could not save workout'));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit workout' : 'New workout'}
      description={editing ? undefined : 'A reusable session you can log, share or add to a plan.'}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
            {editing ? 'Save changes' : 'Create workout'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Input
          label="Title"
          placeholder="e.g. Push day A"
          autoComplete="off"
          required
          value={form.title}
          error={errors.title}
          onChange={(e) => {
            set('title', e.target.value);
            if (errors.title) setErrors((er) => ({ ...er, title: undefined }));
          }}
        />
        <Textarea
          label="Description"
          hint="Optional. What the session is for and how to run it."
          rows={2}
          autoGrow
          maxRows={6}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" options={CATEGORY_OPTIONS} value={form.category} onChange={(v) => set('category', v)} />
          <Select label="Level" options={LEVEL_OPTIONS} value={form.level} onChange={(v) => set('level', v)} />
          <Input
            label="Duration (min)"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            placeholder="45"
            value={form.duration}
            onChange={(e) => set('duration', e.target.value)}
          />
          <Input
            label="Calories (kcal)"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="350"
            value={form.caloriesBurned}
            onChange={(e) => set('caloriesBurned', e.target.value)}
          />
        </div>
        <Input
          label="Hashtags"
          hint="Comma separated. The # is optional."
          placeholder="legday, strength"
          autoComplete="off"
          value={form.hashtags}
          onChange={(e) => set('hashtags', e.target.value)}
        />
        <Checkbox
          checked={form.isPublic}
          onChange={(v) => set('isPublic', v)}
          label="Share publicly"
          description="Anyone on Vybe can find, like and save this workout."
        />

        <ExerciseRows
          value={form.exercises}
          error={errors.exercises}
          onChange={(v) => {
            set('exercises', v);
            if (errors.exercises) setErrors((er) => ({ ...er, exercises: undefined }));
          }}
        />
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- plan modal form */

function PlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<string>('beginner');
  const [weeks, setWeeks] = useState(4);
  const [isPublic, setIsPublic] = useState(true);
  const [errors, setErrors] = useState<{ name?: string; goal?: string }>({});

  const reset = () => {
    setName('');
    setGoal('');
    setDescription('');
    setLevel('beginner');
    setWeeks(4);
    setIsPublic(true);
    setErrors({});
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const next: typeof errors = {};
      if (!name.trim()) next.name = 'Give the plan a name.';
      if (!goal.trim()) next.goal = 'Say what the plan is for.';
      setErrors(next);
      if (next.name || next.goal) throw Object.assign(new Error('validation'), { silent: true });
      const { data } = await api.post('/workouts/create-plan', {
        name: name.trim(),
        goal: goal.trim(),
        description: description.trim() || undefined,
        level,
        duration: Math.max(1, weeks),
        isPublic,
        workouts: [],
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Plan created');
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      reset();
      onClose();
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      toast.error(errMsg(e, 'Could not create plan'));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New plan"
      description="Group workouts into a multi-week programme."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
            Create plan
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Input
          label="Name"
          placeholder="e.g. 8-week strength block"
          autoComplete="off"
          required
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors((er) => ({ ...er, name: undefined }));
          }}
        />
        <Input
          label="Goal"
          placeholder="e.g. Build a bigger squat"
          autoComplete="off"
          required
          value={goal}
          error={errors.goal}
          onChange={(e) => {
            setGoal(e.target.value);
            if (errors.goal) setErrors((er) => ({ ...er, goal: undefined }));
          }}
        />
        <Textarea
          label="Description"
          hint="Optional."
          rows={2}
          autoGrow
          maxRows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Level" options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
          <Stepper label="Length" value={weeks} min={1} max={52} unit={weeks === 1 ? 'week' : 'weeks'} onChange={setWeeks} />
        </div>
        <Checkbox
          checked={isPublic}
          onChange={setIsPublic}
          label="Share publicly"
          description="Anyone on Vybe can follow this plan."
        />
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- workout card */

function CoverArt({ workout, className }: { workout: SocialWorkout; className?: string }) {
  const cover = workout.image?.uri ? mediaUrl(workout.image.uri) : '';
  if (cover) {
    return <img src={cover} alt="" loading="lazy" decoding="async" className={cx('h-full w-full object-cover', className)} />;
  }
  return (
    <div className={cx('flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-3', className)} aria-hidden="true">
      <Dumbbell size={32} />
      <span className="type-label text-text-3">{humanize(workout.category)}</span>
    </div>
  );
}

function WorkoutCard({
  workout,
  ownerView,
  onEdit,
  onDelete,
  onReport,
}: {
  workout: SocialWorkout;
  ownerView: boolean;
  onEdit?: (w: SocialWorkout) => void;
  onDelete?: (w: SocialWorkout) => void;
  onReport?: (w: SocialWorkout) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const liked = Boolean(user && (workout.likes ?? []).some((id) => String(id) === user._id));
  const likeCount = (workout.likes ?? []).length;
  const commentCount = workout.comments?.length ?? 0;
  const href = `/workouts/${workout._id}`;
  const isOwn = ownerView || Boolean(user && workout.createdBy && workout.createdBy._id === user._id);

  const like = useMutation({
    mutationFn: async () => {
      const { data } = await api.put(`/workouts/interaction/${workout._id}/like`);
      return data as { isLiked: boolean; likesCount: number };
    },
    onMutate: async () => {
      // Optimistic like toggling across every cached workout list.
      await qc.cancelQueries({ queryKey: ['workouts'] });
      const snapshots = qc.getQueriesData<SocialWorkout[]>({ queryKey: ['workouts'] });
      if (user) {
        for (const [key, list] of snapshots) {
          if (!Array.isArray(list)) continue;
          qc.setQueryData<SocialWorkout[]>(
            key,
            list.map((w) =>
              w._id === workout._id
                ? {
                    ...w,
                    likes: liked
                      ? (w.likes ?? []).filter((id) => String(id) !== user._id)
                      : [...(w.likes ?? []), user._id],
                  }
                : w,
            ),
          );
        }
      }
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(errMsg(e, 'Could not update like'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });

  const menu: MenuItem[] = [
    ...(isOwn && onEdit ? [{ label: 'Edit', icon: <Edit size={18} />, onSelect: () => onEdit(workout) }] : []),
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void shareWorkout(workout, toast, 'share') },
    { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void shareWorkout(workout, toast, 'copy') },
    ...(!isOwn && onReport
      ? [{ label: 'Report', icon: <Flag size={18} />, onSelect: () => onReport(workout), divider: true }]
      : []),
    ...(isOwn && onDelete
      ? [{ label: 'Delete', icon: <Trash size={18} />, onSelect: () => onDelete(workout), danger: true, divider: true }]
      : []),
  ];

  return (
    <Card padded={false} to={href} linkLabel={`Open ${workout.title}`} className="flex flex-col overflow-hidden">
      <div className="aspect-[16/9] overflow-hidden bg-surface-2">
        <CoverArt workout={workout} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-md font-semibold text-text-1">{workout.title}</h3>
            {workout.createdBy ? (
              <Link
                to={`/u/${workout.createdBy._id}`}
                viewTransition
                className="relative z-[2] mt-1 inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-text-2 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:text-text-1"
              >
                <Avatar src={workout.createdBy.avatar} name={workout.createdBy.fullName || workout.createdBy.username} alt="" size="xs" />
                <span className="truncate">{workout.createdBy.fullName || `@${workout.createdBy.username ?? 'unknown'}`}</span>
              </Link>
            ) : workout.isPremade ? (
              <p className="mt-1 text-xs font-medium text-text-2">By Vybe</p>
            ) : null}
          </div>
          <Menu items={menu} label={`More options for ${workout.title}`} className="relative z-[2] -mr-2 -mt-1.5" />
        </div>

        {workout.description ? <p className="line-clamp-2 text-sm text-text-2">{workout.description}</p> : null}

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{humanize(workout.category)}</Badge>
          {workout.level ? <Badge>{humanize(workout.level)}</Badge> : null}
          {workout.isPremade ? <Badge tone="accent">Premade</Badge> : null}
          {isOwn && workout.isPublic === false ? <Badge>Private</Badge> : null}
        </div>

        <MetaList
          items={[
            { icon: <Activity size={14} />, label: `${workout.exercises?.length ?? 0} ${(workout.exercises?.length ?? 0) === 1 ? 'exercise' : 'exercises'}` },
            !!workout.duration && { icon: <Clock size={14} />, label: `${formatStat(workout.duration)} min` },
            !!workout.caloriesBurned && { icon: <Flame size={14} />, label: `${formatStat(workout.caloriesBurned)} kcal` },
          ]}
        />

        <div className="relative z-[2] -mb-1 -ml-2 mt-auto flex items-center gap-1 self-start pt-1">
          <LikeButton liked={liked} count={likeCount} disabled={like.isPending} onToggle={() => like.mutate()} />
          <Link
            to={`${href}#comments`}
            viewTransition
            aria-label={`${formatStat(commentCount)} ${commentCount === 1 ? 'comment' : 'comments'}`}
            className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold text-text-2 transition-colors dur-1 hover:bg-surface-2 hover:text-text-1"
          >
            <MessageCircle size={20} />
            <span className="tabular">{formatStat(commentCount)}</span>
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ plans */

function PlanCard({ plan }: { plan: WorkoutPlan }) {
  const included = (plan.workouts ?? []).filter((w) => w.workout);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold text-text-1">{plan.title}</h3>
          {plan.goal ? <p className="mt-0.5 text-sm text-text-2">{plan.goal}</p> : null}
        </div>
        {plan.level ? <Badge className="shrink-0">{humanize(plan.level)}</Badge> : null}
      </div>
      {plan.description ? <p className="line-clamp-2 text-sm text-text-2">{plan.description}</p> : null}
      <MetaList
        items={[
          !!plan.durationWeeks && { icon: <Clock size={14} />, label: `${plan.durationWeeks} ${plan.durationWeeks === 1 ? 'week' : 'weeks'}` },
          { icon: <Layers size={14} />, label: `${included.length} ${included.length === 1 ? 'workout' : 'workouts'}` },
          plan.isPublic === false ? { icon: <Globe size={14} />, label: 'Private' } : { icon: <Globe size={14} />, label: 'Public' },
        ]}
      />
      {included.length > 0 ? (
        <ol className="divide-y divide-line rounded-md border border-line bg-surface-2/40">
          {included.slice(0, 5).map((entry, i) => (
            <li key={`${entry.week}-${entry.day}-${entry.workout?._id ?? i}`}>
              <Link
                to={`/workouts/${entry.workout?._id}`}
                viewTransition
                className="flex min-h-11 items-center gap-3 px-3 py-1.5 text-sm text-text-1 transition-colors dur-1 hover:bg-surface-2"
              >
                <span className="type-label w-20 shrink-0 tabular text-text-3">
                  Week {entry.week}, day {entry.day}
                </span>
                <span className="truncate">{entry.workout?.title}</span>
              </Link>
            </li>
          ))}
          {included.length > 5 ? (
            <li className="px-3 py-2 text-xs text-text-3">and {included.length - 5} more</li>
          ) : null}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-3 text-center text-xs text-text-3">
          No workouts scheduled yet
        </p>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- library stats */

function LibraryStats({ workouts }: { workouts: SocialWorkout[] }) {
  const exercises = workouts.reduce((n, w) => n + (w.exercises?.length ?? 0), 0);
  const minutes = workouts.reduce((n, w) => n + (Number(w.duration) || 0), 0);
  const shared = workouts.filter((w) => w.isPublic !== false).length;
  const likes = workouts.reduce((n, w) => n + (w.likes?.length ?? 0), 0);
  return (
    <StatGrid columns={4}>
      <StatTile label="Workouts" value={formatStat(workouts.length)} icon={<Dumbbell size={18} />} tone="brand" />
      <StatTile label="Exercises" value={formatStat(exercises)} icon={<Activity size={18} />} />
      <StatTile label="Planned time" value={formatStat(minutes)} unit="min" icon={<Clock size={18} />} />
      <StatTile
        label="Shared"
        value={formatStat(shared)}
        unit={`of ${formatStat(workouts.length)}`}
        icon={<Heart size={18} />}
        hint={likes ? `${formatStat(likes)} ${likes === 1 ? 'like' : 'likes'} received` : 'Public workouts appear in Explore'}
      />
    </StatGrid>
  );
}

/* ------------------------------------------------------------------- page */

export default function Workouts() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'mine';
  const [workoutModal, setWorkoutModal] = useState(false);
  const [editing, setEditing] = useState<SocialWorkout | null>(null);
  const [planModal, setPlanModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SocialWorkout | null>(null);
  const [search, setSearch] = useState('');
  const { report, reportModal } = useReportModal();

  const qc = useQueryClient();
  const toast = useToast();

  const setTab = (next: TabKey) => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === 'mine') n.delete('tab');
        else n.set('tab', next);
        return n;
      },
      { replace: true },
    );
  };

  const openNewWorkout = () => {
    setEditing(null);
    setWorkoutModal(true);
  };

  // Deep link: /workouts?log=1 (Log sheet, manifest shortcut) opens the new-workout form.
  const wantsLog = params.get('log') === '1';
  useEffect(() => {
    if (!wantsLog) return;
    openNewWorkout();
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('log');
        return n;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog]);

  const mine = useQuery({ queryKey: ['workouts', 'mine'], queryFn: fetchMyWorkouts, enabled: tab === 'mine' });
  const plans = useQuery({ queryKey: ['workouts', 'plans'], queryFn: fetchMyPlans, enabled: tab === 'plans' });
  const explore = useQuery({ queryKey: ['workouts', 'explore'], queryFn: fetchExplore, enabled: tab === 'explore' });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: tab === 'premade' });

  const remove = useMutation({
    mutationFn: async (workout: SocialWorkout) => {
      await api.delete(`/workouts/${workout._id}`);
      return workout._id;
    },
    onSuccess: (id) => {
      toast.success('Workout deleted');
      qc.setQueryData<SocialWorkout[]>(['workouts', 'mine'], (old) => (old ?? []).filter((w) => w._id !== id));
      qc.invalidateQueries({ queryKey: ['workouts'] });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete workout')),
  });

  const active = tab === 'mine' ? mine : tab === 'plans' ? plans : tab === 'explore' ? explore : premade;

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = (active.data ?? []) as (SocialWorkout | WorkoutPlan)[];
    if (!query) return list;
    return list.filter((item) => {
      const hay = [item.title, item.description, (item as SocialWorkout).category, item.level, ...(item.hashtags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [active.data, query]);

  const counts: Partial<Record<TabKey, number>> = {
    mine: mine.data?.length,
    plans: plans.data?.length,
    explore: explore.data?.length,
    premade: premade.data?.length,
  };

  const newMenu: MenuItem[] = [
    { label: 'New workout', description: 'A session you can log or share', icon: <Dumbbell size={18} />, onSelect: openNewWorkout },
    { label: 'New plan', description: 'A multi-week programme', icon: <Layers size={18} />, onSelect: () => setPlanModal(true) },
  ];

  const emptyCopy: Record<TabKey, { title: string; message: string; action: { label: string; onClick: () => void } }> = {
    mine: {
      title: 'No workouts yet',
      message: 'Build your first one and it will live here, ready to log, share or add to a plan.',
      action: { label: 'New workout', onClick: openNewWorkout },
    },
    plans: {
      title: 'No plans yet',
      message: 'Group your workouts into a multi-week programme and follow it week by week.',
      action: { label: 'New plan', onClick: () => setPlanModal(true) },
    },
    explore: {
      title: 'Nothing shared yet',
      message: 'Public workouts from the community show up here. Share one of yours to get things going.',
      action: { label: 'New workout', onClick: openNewWorkout },
    },
    premade: {
      title: 'No premade workouts yet',
      message: 'Vybe’s ready-made sessions are not published yet. Build your own in the meantime.',
      action: { label: 'New workout', onClick: openNewWorkout },
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workouts"
        subtitle="Build, share and explore training sessions."
        actions={
          <>
            <Button variant="secondary" icon={<Layers size={18} />} onClick={() => setPlanModal(true)}>
              New plan
            </Button>
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNewWorkout}>
              New workout
            </Button>
          </>
        }
        mobileActions={
          <Menu
            items={newMenu}
            label="Create"
            trigger={() => (
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-text-1">
                <Plus size={24} />
              </span>
            )}
          />
        }
      />

      <Tabs
        aria-label="Workout library"
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))}
        value={tab}
        onChange={(k: string) => {
          if (isTabKey(k)) setTab(k);
        }}
      />

      {tab === 'mine' && mine.data && mine.data.length > 0 ? <LibraryStats workouts={mine.data} /> : null}

      <SearchField
        label={`Filter ${tab === 'plans' ? 'plans' : 'workouts'}`}
        hideLabel
        placeholder={tab === 'plans' ? 'Filter plans by name or goal' : 'Filter by title, category or tag'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {active.isLoading ? (
        <GridSkeleton />
      ) : active.isError ? (
        <ErrorState error={active.error} title="Could not load workouts" onRetry={() => active.refetch()} />
      ) : filtered.length === 0 ? (
        query ? (
          <EmptyState
            variant="no-results"
            title={`No matches for “${search.trim()}”`}
            message="Try a different title, category or tag, or clear the filter."
            action={{ label: 'Clear filter', onClick: () => setSearch(''), variant: 'secondary' }}
          />
        ) : (
          <EmptyState
            title={emptyCopy[tab].title}
            message={emptyCopy[tab].message}
            action={{ ...emptyCopy[tab].action, icon: <Plus size={18} /> }}
          />
        )
      ) : tab === 'plans' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(filtered as WorkoutPlan[]).map((plan) => (
            <PlanCard key={plan._id} plan={plan} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(filtered as SocialWorkout[]).map((workout) => (
            <WorkoutCard
              key={workout._id}
              workout={workout}
              ownerView={tab === 'mine'}
              onEdit={(w) => {
                setEditing(w);
                setWorkoutModal(true);
              }}
              onDelete={(w) => setPendingDelete(w)}
              onReport={(w) => report({ targetType: 'workout', targetId: w._id, targetLabel: 'workout' })}
            />
          ))}
        </div>
      )}

      <WorkoutModal
        open={workoutModal}
        editing={editing}
        onClose={() => {
          setWorkoutModal(false);
          setEditing(null);
        }}
      />
      <PlanModal open={planModal} onClose={() => setPlanModal(false)} />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete workout?"
        message={`“${pendingDelete?.title ?? ''}” will be removed from your library. Sessions you have already logged are kept.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
      {reportModal}
    </div>
  );
}
