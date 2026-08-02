import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import {
  Dumbbell,
  Heart,
  Plus,
  Trash,
  Edit,
  Clock,
  Activity,
} from './icons';

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

const CATEGORIES = [
  'strength',
  'cardio',
  'yoga',
  'running',
  'hiit',
  'flexibility',
  'sports',
  'other',
] as const;

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

const TABS = [
  { key: 'mine', label: 'My Workouts' },
  { key: 'plans', label: 'Plans' },
  { key: 'explore', label: 'Explore' },
  { key: 'premade', label: 'Premade' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function StatChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
      {icon}
      {label}
    </span>
  );
}

/* --------------------------------------------------------- exercise editor */

type ExerciseDraft = {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  duration: string;
  notes: string;
};

const emptyExercise = (): ExerciseDraft => ({
  name: '',
  sets: '',
  reps: '',
  weight: '',
  duration: '',
  notes: '',
});

function toExercisePayload(d: ExerciseDraft): WorkoutExercise {
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

function ExerciseRows({
  value,
  onChange,
}: {
  value: ExerciseDraft[];
  onChange: (next: ExerciseDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<ExerciseDraft>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3">
      {value.map((row, i) => (
        <div key={i} className="rounded-xl border border-[var(--color-line)] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Exercise name"
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            {value.length > 1 && (
              <button
                type="button"
                aria-label={`Remove exercise ${i + 1}`}
                className="btn btn-ghost px-2"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <Trash size={16} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              type="number"
              min={0}
              placeholder="Sets"
              value={row.sets}
              onChange={(e) => update(i, { sets: e.target.value })}
            />
            <Input
              type="number"
              min={0}
              placeholder="Reps"
              value={row.reps}
              onChange={(e) => update(i, { reps: e.target.value })}
            />
            <Input
              type="number"
              min={0}
              step="0.5"
              placeholder="Weight (kg)"
              value={row.weight}
              onChange={(e) => update(i, { weight: e.target.value })}
            />
            <Input
              type="number"
              min={0}
              placeholder="Duration (min)"
              value={row.duration}
              onChange={(e) => update(i, { duration: e.target.value })}
            />
          </div>
          <Input
            placeholder="Notes (optional)"
            value={row.notes}
            onChange={(e) => update(i, { notes: e.target.value })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange([...value, emptyExercise()])}
      >
        <Plus size={16} /> Add exercise
      </Button>
    </div>
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
  exercises:
    w?.exercises && w.exercises.length
      ? w.exercises.map((e) => ({
          name: e.name ?? '',
          sets: e.sets != null ? String(e.sets) : '',
          reps: e.reps != null ? String(e.reps) : '',
          weight: e.weight != null ? String(e.weight) : '',
          duration: e.duration != null ? String(e.duration) : '',
          notes: e.notes ?? '',
        }))
      : [emptyExercise()],
});

function WorkoutModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: SocialWorkout | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<WorkoutFormState>(() => workoutFormFrom(editing));
  const [formKey, setFormKey] = useState('');

  // Re-seed the form whenever the modal is (re)opened for a different target.
  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== formKey) {
    setFormKey(seed);
    setForm(workoutFormFrom(editing));
  }

  const set = <K extends keyof WorkoutFormState>(k: K, v: WorkoutFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const exercises = form.exercises
        .map(toExercisePayload)
        .filter((e) => e.name.length > 0);
      if (!form.title.trim()) throw new Error('Workout title is required');
      if (!exercises.length) throw new Error('At least one exercise is required');
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
        const { data } = await api.patch(`/workouts/${editing._id}`, payload);
        return data;
      }
      const { data } = await api.post('/workouts/create', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'Workout updated' : 'Workout created');
      qc.invalidateQueries({ queryKey: ['workouts'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save workout')),
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit workout' : 'New workout'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Input
          placeholder="Workout title"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
        <Textarea
          placeholder="Description (optional)"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Category</span>
            <select
              className="input-base"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Level</span>
            <select
              className="input-base"
              value={form.level}
              onChange={(e) => set('level', e.target.value)}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Input
            type="number"
            min={0}
            placeholder="Duration (min)"
            value={form.duration}
            onChange={(e) => set('duration', e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder="Calories burned"
            value={form.caloriesBurned}
            onChange={(e) => set('caloriesBurned', e.target.value)}
          />
        </div>
        <Input
          placeholder="Hashtags, comma separated"
          value={form.hashtags}
          onChange={(e) => set('hashtags', e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(e) => set('isPublic', e.target.checked)}
          />
          Share publicly
        </label>

        <div>
          <p className="mb-2 text-sm font-semibold">Exercises</p>
          <ExerciseRows value={form.exercises} onChange={(v) => set('exercises', v)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {editing ? 'Save changes' : 'Create workout'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- plan modal form */

function PlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<string>('beginner');
  const [duration, setDuration] = useState('4');
  const [isPublic, setIsPublic] = useState(true);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Plan name is required');
      if (!goal.trim()) throw new Error('Plan goal is required');
      const { data } = await api.post('/workouts/create-plan', {
        name: name.trim(),
        goal: goal.trim(),
        description: description.trim() || undefined,
        level,
        duration: Number(duration) || 1,
        isPublic,
        workouts: [],
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Plan created');
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      setName('');
      setGoal('');
      setDescription('');
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create plan')),
  });

  return (
    <Modal open={open} onClose={onClose} title="New workout plan">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Input placeholder="Plan name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder="Goal (e.g. build strength)"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <Textarea
          rows={3}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-[var(--color-muted)]">Level</span>
            <select className="input-base" value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Input
            type="number"
            min={1}
            placeholder="Weeks"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          Share publicly
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create plan
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- comment box */

function CommentBox({ workoutId, onDone }: { workoutId: string; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const value = text.trim();
      if (!value) throw new Error('Comment text is required');
      const { data } = await api.post(`/workouts/interaction/${workoutId}/comment`, {
        text: value,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Comment added');
      setText('');
      qc.invalidateQueries({ queryKey: ['workout', workoutId] });
      qc.invalidateQueries({ queryKey: ['workouts'] });
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add comment')),
  });

  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <Input
        placeholder="Write a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant="primary" loading={mutation.isPending}>
        Post
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------- workout card */

function WorkoutCard({
  workout,
  ownerView,
  onEdit,
  onDelete,
}: {
  workout: SocialWorkout;
  ownerView: boolean;
  onEdit?: (w: SocialWorkout) => void;
  onDelete?: (w: SocialWorkout) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [commenting, setCommenting] = useState(false);

  const liked = Boolean(user && (workout.likes ?? []).some((id) => String(id) === user._id));
  const likeCount = (workout.likes ?? []).length;

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

  const cover = workout.image?.uri ? mediaUrl(workout.image.uri) : '';

  return (
    <Card className="overflow-hidden">
      <Link to={`/workouts/${workout._id}`} className="block">
        {cover ? (
          <img
            src={cover}
            alt={workout.title}
            loading="lazy"
            className="h-32 w-full object-cover"
          />
        ) : (
          <div className="flex h-32 w-full items-center justify-center bg-[var(--color-surface-2)]">
            <Dumbbell size={32} />
          </div>
        )}
      </Link>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/workouts/${workout._id}`} className="font-semibold hover:underline">
            {workout.title}
          </Link>
          {ownerView && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label="Edit workout"
                className="btn btn-ghost px-2"
                onClick={() => onEdit?.(workout)}
              >
                <Edit size={14} />
              </button>
              <button
                type="button"
                aria-label="Delete workout"
                className="btn btn-ghost px-2"
                onClick={() => onDelete?.(workout)}
              >
                <Trash size={14} />
              </button>
            </div>
          )}
        </div>

        {workout.description && (
          <p className="line-clamp-2 text-sm text-[var(--color-muted)]">{workout.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{workout.category}</Badge>
          {workout.level && <Badge>{workout.level}</Badge>}
          {workout.isPremade && <Badge>premade</Badge>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StatChip
            icon={<Activity size={13} />}
            label={`${workout.exercises?.length ?? 0} exercises`}
          />
          {workout.duration ? (
            <StatChip icon={<Clock size={13} />} label={`${workout.duration} min`} />
          ) : null}
          {workout.caloriesBurned ? (
            <StatChip icon={<Dumbbell size={13} />} label={`${workout.caloriesBurned} cal`} />
          ) : null}
        </div>

        {workout.createdBy && (
          <div className="flex items-center gap-2 pt-1">
            <Avatar src={mediaUrl(workout.createdBy.avatar)} alt={workout.createdBy.username ?? ''} size={22} />
            <span className="text-xs text-[var(--color-muted)]">
              @{workout.createdBy.username ?? 'unknown'}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="btn btn-ghost px-3 py-1 text-xs"
            aria-pressed={liked}
            onClick={() => like.mutate()}
            disabled={like.isPending}
          >
            <Heart size={14} /> {likeCount}
          </button>
          <button
            type="button"
            className="btn btn-ghost px-3 py-1 text-xs"
            onClick={() => setCommenting((v) => !v)}
          >
            Comment ({workout.comments?.length ?? 0})
          </button>
        </div>

        {commenting && <CommentBox workoutId={workout._id} onDone={() => setCommenting(false)} />}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ plans */

function PlanCard({ plan }: { plan: WorkoutPlan }) {
  const included = (plan.workouts ?? []).filter((w) => w.workout);
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{plan.title}</p>
        {plan.level && <Badge>{plan.level}</Badge>}
      </div>
      {plan.goal && <p className="text-sm text-[var(--color-muted)]">Goal: {plan.goal}</p>}
      {plan.description && (
        <p className="line-clamp-2 text-sm text-[var(--color-muted)]">{plan.description}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {plan.durationWeeks ? (
          <StatChip icon={<Clock size={13} />} label={`${plan.durationWeeks} weeks`} />
        ) : null}
        <StatChip icon={<Dumbbell size={13} />} label={`${included.length} workouts`} />
      </div>
      {included.length > 0 && (
        <ul className="space-y-1 pt-1">
          {included.slice(0, 5).map((entry, i) => (
            <li key={`${entry.workout?._id ?? i}`} className="text-xs text-[var(--color-muted)]">
              W{entry.week} · D{entry.day} —{' '}
              <Link className="hover:underline" to={`/workouts/${entry.workout?._id}`}>
                {entry.workout?.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function Workouts() {
  const [tab, setTab] = useState<TabKey>('mine');
  const [workoutModal, setWorkoutModal] = useState(false);
  const [editing, setEditing] = useState<SocialWorkout | null>(null);
  const [planModal, setPlanModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SocialWorkout | null>(null);
  const [search, setSearch] = useState('');

  const qc = useQueryClient();
  const toast = useToast();

  const mine = useQuery({
    queryKey: ['workouts', 'mine'],
    queryFn: fetchMyWorkouts,
    enabled: tab === 'mine',
  });
  const plans = useQuery({
    queryKey: ['workouts', 'plans'],
    queryFn: fetchMyPlans,
    enabled: tab === 'plans',
  });
  const explore = useQuery({
    queryKey: ['workouts', 'explore'],
    queryFn: fetchExplore,
    enabled: tab === 'explore',
  });
  const premade = useQuery({
    queryKey: ['workouts', 'premade'],
    queryFn: fetchPremade,
    enabled: tab === 'premade',
  });

  const remove = useMutation({
    mutationFn: async (workout: SocialWorkout) => {
      await api.delete(`/workouts/${workout._id}`);
      return workout._id;
    },
    onSuccess: (id) => {
      toast.success('Workout deleted');
      qc.setQueryData<SocialWorkout[]>(['workouts', 'mine'], (old) =>
        (old ?? []).filter((w) => w._id !== id),
      );
      qc.invalidateQueries({ queryKey: ['workouts'] });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete workout')),
  });

  const active =
    tab === 'mine' ? mine : tab === 'plans' ? plans : tab === 'explore' ? explore : premade;

  const filteredWorkouts = useMemo(() => {
    const list = (active.data ?? []) as (SocialWorkout | WorkoutPlan)[];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => item.title?.toLowerCase().includes(q));
  }, [active.data, search]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workouts</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Build, share and explore training sessions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setPlanModal(true)}>
            <Plus size={16} /> Plan
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setWorkoutModal(true);
            }}
          >
            <Plus size={16} /> Workout
          </Button>
        </div>
      </header>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(k: string) => setTab(k as TabKey)}
      />

      <Input
        placeholder="Filter by title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {active.isLoading ? (
        <GridSkeleton />
      ) : active.isError ? (
        <ErrorState message={errMsg(active.error, 'Could not load workouts')} onRetry={() => active.refetch()} />
      ) : filteredWorkouts.length === 0 ? (
        <EmptyState
          icon={<Dumbbell size={28} />}
          title={tab === 'plans' ? 'No plans yet' : 'No workouts yet'}
          description={
            tab === 'mine'
              ? 'Create your first workout to start tracking your training.'
              : tab === 'plans'
                ? 'Group workouts into a multi-week plan.'
                : 'Nothing to show here right now.'
          }
          action={
            tab === 'mine' || tab === 'plans' ? (
              <Button
                variant="primary"
                onClick={() => (tab === 'plans' ? setPlanModal(true) : setWorkoutModal(true))}
              >
                <Plus size={16} /> {tab === 'plans' ? 'New plan' : 'New workout'}
              </Button>
            ) : undefined
          }
        />
      ) : tab === 'plans' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(filteredWorkouts as WorkoutPlan[]).map((plan) => (
            <PlanCard key={plan._id} plan={plan} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(filteredWorkouts as SocialWorkout[]).map((workout) => (
            <WorkoutCard
              key={workout._id}
              workout={workout}
              ownerView={tab === 'mine'}
              onEdit={(w) => {
                setEditing(w);
                setWorkoutModal(true);
              }}
              onDelete={(w) => setPendingDelete(w)}
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
        title="Delete workout"
        message={`"${pendingDelete?.title ?? ''}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  );
}
