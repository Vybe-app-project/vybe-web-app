import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, uploadImage } from '../lib/hooks';
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
  SegmentedControl,
  Select,
  SkeletonCard,
  SkeletonRow,
  Spinner,
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
  Image as ImageIcon,
  Layers,
  MessageCircle,
  Plus,
  ShareUp,
  Trash,
  X,
} from './icons';
import { useReportModal } from './Report';

/* ------------------------------------------------------------------ types */

export type WorkoutExercise = {
  _id?: string;
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  /** Seconds. The seed data, the API and the mobile app all store seconds. */
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

export type PlanEntry = { workout?: SocialWorkout | null; day: number; week: number; order?: number };

export type WorkoutPlan = {
  _id: string;
  title: string;
  description?: string;
  goal?: string;
  level?: string;
  durationWeeks?: number;
  image?: { uri?: string };
  isPublic?: boolean;
  isPremade?: boolean;
  hashtags?: string[];
  createdBy?: WorkoutAuthor | null;
  workouts?: PlanEntry[];
  totalCaloriesBurned?: number;
  likes?: string[];
  comments?: unknown[];
  createdAt?: string;
};

export type Pagination = { page: number; limit: number; total: number; pages: number };

type ListEnvelope<T> = {
  success?: boolean;
  data?: T[];
  pagination?: Pagination;
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

/** Explore and Premade each hold two catalogues: single workouts and multi-week programs. */
type KindKey = 'workouts' | 'programs';
const isKindKey = (v: string | null): v is KindKey => v === 'workouts' || v === 'programs';

const PAGE_SIZE = 24;

/* -------------------------------------------------------------- fetchers */

type WorkoutPage = { items: SocialWorkout[]; pagination?: Pagination };

const toPage = (data: ListEnvelope<SocialWorkout>): WorkoutPage => ({ items: data.data ?? [], pagination: data.pagination });

// Literal paths on purpose: the contract audit (scripts/audit-api-contracts.cjs)
// pins every request against the backend route snapshot.
async function fetchMyWorkoutsPage(page: number): Promise<WorkoutPage> {
  const { data } = await api.get<ListEnvelope<SocialWorkout>>('/workouts/my', { params: { page, limit: PAGE_SIZE } });
  return toPage(data);
}

async function fetchExplorePage(page: number): Promise<WorkoutPage> {
  const { data } = await api.get<ListEnvelope<SocialWorkout>>('/workouts/filter/all/workouts/feed/filter/feed', {
    params: { page, limit: PAGE_SIZE },
  });
  return toPage(data);
}

export async function fetchMyPlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<ListEnvelope<WorkoutPlan>>('/workouts/plans/my', {
    params: { page: 1, limit: 50 },
  });
  return data.data ?? [];
}

async function fetchCommunityPlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<ListEnvelope<WorkoutPlan>>('/workouts/plans/filter/all/workouts/feed/filter/feed', {
    params: { page: 1, limit: 50 },
  });
  return data.data ?? [];
}

export async function fetchPremade(): Promise<SocialWorkout[]> {
  const { data } = await api.get<{ workouts?: SocialWorkout[] }>('/workouts/commom/workouts/all/premade/fetch');
  return data.workouts ?? [];
}

async function fetchPremadePlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<{ workouts?: WorkoutPlan[] }>('/workouts/commom/workouts/plan/all/premade/fetch');
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

async function shareUrl(url: string, title: string, noun: string, toast: ReturnType<typeof useToast>, mode: 'share' | 'copy') {
  try {
    if (mode === 'share' && typeof navigator.share === 'function') {
      await navigator.share({ title, text: `${title} on Vybe`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return;
    toast.error(`Could not share this ${noun}`);
  }
}

/** Native share where available, otherwise copy the link. */
export async function shareWorkout(
  workout: Pick<SocialWorkout, '_id' | 'title'>,
  toast: ReturnType<typeof useToast>,
  mode: 'share' | 'copy' = 'share',
) {
  return shareUrl(`${window.location.origin}/workouts/${workout._id}`, workout.title, 'workout', toast, mode);
}

export async function sharePlan(
  plan: Pick<WorkoutPlan, '_id' | 'title'>,
  toast: ReturnType<typeof useToast>,
  mode: 'share' | 'copy' = 'share',
) {
  return shareUrl(`${window.location.origin}/workouts/plans/${plan._id}`, plan.title, 'plan', toast, mode);
}

/* --------------------------------------------------------- exercise editor */

export type ExerciseDraft = {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  /** Seconds, as typed. */
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
 * labelled; the remove control is a 44 px icon button. Duration is entered in
 * seconds, the unit the API, the seed data and the mobile app all use.
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
              label="Seconds"
              type="number"
              inputMode="numeric"
              min={0}
              step={5}
              placeholder="0"
              title="Timed work, in seconds (180 = 3 minutes)"
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

/* --------------------------------------------------------- cover picker */

/**
 * Optional cover photo. Uploads through the same owned-media route post
 * photos use; the API re-verifies ownership when the workout is saved.
 */
function CoverPicker({
  storageKey,
  existingUri,
  onChange,
}: {
  storageKey: string | null;
  existingUri?: string;
  onChange: (key: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview || (!removed && existingUri ? mediaUrl(existingUri) : '');

  async function pick(file?: File) {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError('Use a JPEG, PNG, WebP or HEIC image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is larger than 10 MB. Pick a smaller one.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadImage(file, 'posts');
      onChange(uploaded.key);
      setRemoved(false);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    } catch (e) {
      setError(errMsg(e, 'Upload failed. Check your connection and try again.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      <p className="type-label mb-1.5 text-text-2">Cover photo</p>
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2">
          {shown ? (
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-text-3" aria-hidden="true">
              <ImageIcon size={22} />
            </span>
          )}
          {uploading ? (
            <span className="absolute inset-0 flex items-center justify-center bg-scrim/40">
              <Spinner size={18} />
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" icon={<ImageIcon size={16} />} loading={uploading} onClick={() => fileRef.current?.click()}>
            {shown ? 'Replace photo' : 'Add photo'}
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<X size={16} />}
              disabled={uploading}
              onClick={() => {
                setRemoved(true);
                setPreview((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return null;
                });
                onChange(null);
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-text-3">Optional. Shown on the card. JPEG, PNG, WebP or HEIC up to 10 MB.</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        hidden
        aria-label="Choose a cover photo"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {storageKey ? <span className="sr-only">Photo ready to save</span> : null}
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
  /** `undefined` = untouched, `null` = removed, string = new upload key. */
  imageKey: string | null | undefined;
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
  imageKey: undefined,
});

type SaveEnvelope = { success?: boolean; data?: SocialWorkout; workout?: SocialWorkout; message?: string };

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
      const payload: Record<string, unknown> = {
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
      if (form.imageKey) payload.image = { uri: form.imageKey };
      else if (form.imageKey === null && editing?.image?.uri) payload.image = null;

      // Edits go to the full update route. The PATCH /workouts/:id route
      // was a privacy toggle that answered 200 while dropping every other
      // field, which is how "Workout saved" once meant nothing was saved.
      const { data } = editing
        ? await api.put<SaveEnvelope>(`/workouts/update/${editing._id}`, payload)
        : await api.post<SaveEnvelope>('/workouts/create', payload);
      const saved = data?.data ?? data?.workout;
      // Only celebrate once the server has echoed the saved document back.
      if (!saved?._id || (editing && saved.title !== payload.title)) {
        throw new Error('The server did not confirm the save. Nothing was changed.');
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(editing ? 'Workout saved' : 'Workout created');
      if (editing) qc.setQueryData<SocialWorkout>(['workout', editing._id], (old) => (old ? { ...old, ...saved } : saved));
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
        <CoverPicker storageKey={form.imageKey ?? null} existingUri={editing?.image?.uri} onChange={(key) => set('imageKey', key)} />
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

type PlanEnvelope = { success?: boolean; data?: WorkoutPlan; message?: string };

/** Create a plan, or edit its name, goal, description, level, length and visibility. */
export function PlanModal({
  open,
  editing = null,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: WorkoutPlan | null;
  onClose: () => void;
  onSaved?: (plan: WorkoutPlan) => void;
}) {
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
  const [formKey, setFormKey] = useState('');

  const seed = `${open ? 'open' : 'closed'}:${editing?._id ?? 'new'}`;
  if (seed !== formKey) {
    setFormKey(seed);
    setName(editing?.title ?? '');
    setGoal(editing?.goal ?? '');
    setDescription(editing?.description ?? '');
    setLevel(editing?.level ?? 'beginner');
    setWeeks(editing?.durationWeeks ?? 4);
    setIsPublic(editing?.isPublic ?? true);
    setErrors({});
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const next: typeof errors = {};
      if (!name.trim()) next.name = 'Give the plan a name.';
      if (!goal.trim()) next.goal = 'Say what the plan is for.';
      setErrors(next);
      if (next.name || next.goal) throw Object.assign(new Error('validation'), { silent: true });
      const payload = {
        name: name.trim(),
        goal: goal.trim(),
        description: description.trim() || undefined,
        level,
        duration: Math.max(1, weeks),
        isPublic,
      };
      const { data } = editing
        ? await api.put<PlanEnvelope>(`/workouts/update-plan/${editing._id}`, payload)
        : await api.post<PlanEnvelope>('/workouts/create-plan', { ...payload, workouts: [] });
      if (!data?.data?._id) throw new Error('The server did not confirm the save.');
      return data.data;
    },
    onSuccess: (plan) => {
      toast.success(editing ? 'Plan saved' : 'Plan created');
      if (editing) qc.setQueryData<WorkoutPlan>(['workout-plan', editing._id], (old) => (old ? { ...old, ...plan, workouts: old.workouts } : plan));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      if (editing) qc.invalidateQueries({ queryKey: ['workout-plan', editing._id] });
      onSaved?.(plan);
      onClose();
    },
    onError: (e) => {
      if ((e as { silent?: boolean })?.silent) return;
      toast.error(errMsg(e, editing ? 'Could not save plan' : 'Could not create plan'));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit plan' : 'New plan'}
      description={editing ? undefined : 'Group workouts into a multi-week programme.'}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
            {editing ? 'Save changes' : 'Create plan'}
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

/* ------------------------------------------------------ schedule pickers */

type ScheduleSlot = { week: number; day: number };

function SlotSteppers({
  slot,
  weeks,
  onChange,
}: {
  slot: ScheduleSlot;
  weeks: number;
  onChange: (next: ScheduleSlot) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stepper label="Week" value={slot.week} min={1} max={Math.max(1, weeks)} onChange={(week) => onChange({ ...slot, week })} />
      <Stepper label="Day" value={slot.day} min={1} max={7} onChange={(day) => onChange({ ...slot, day })} />
    </div>
  );
}

async function addWorkoutToPlan(planId: string, workoutId: string, slot: ScheduleSlot): Promise<WorkoutPlan> {
  const { data } = await api.put<PlanEnvelope>(`/workouts/plans/add-workout/${planId}`, {
    workoutId,
    week: slot.week,
    day: slot.day,
  });
  if (!data?.data?._id) throw new Error('The server did not confirm the change.');
  return data.data;
}

/**
 * "Add to plan" from a workout: pick one of your plans, then the week and day.
 * Empty when you have no plans yet, with a way to create one.
 */
export function AddToPlanModal({
  workout,
  onClose,
  onCreatePlan,
}: {
  workout: SocialWorkout | null;
  onClose: () => void;
  onCreatePlan?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [planId, setPlanId] = useState<string | null>(null);
  const [slot, setSlot] = useState<ScheduleSlot>({ week: 1, day: 1 });
  const [search, setSearch] = useState('');
  const open = Boolean(workout);

  useEffect(() => {
    if (!open) {
      setPlanId(null);
      setSlot({ week: 1, day: 1 });
      setSearch('');
    }
  }, [open]);

  const plans = useQuery({ queryKey: ['workouts', 'plans'], queryFn: fetchMyPlans, enabled: open });
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = plans.data ?? [];
    return q ? all.filter((p) => `${p.title} ${p.goal ?? ''}`.toLowerCase().includes(q)) : all;
  }, [plans.data, search]);
  const chosen = list.find((p) => p._id === planId) ?? (plans.data ?? []).find((p) => p._id === planId);
  const alreadyIn = Boolean(chosen && workout && (chosen.workouts ?? []).some((e) => e.workout?._id === workout._id));

  const add = useMutation({
    mutationFn: async () => {
      if (!workout || !planId) throw Object.assign(new Error('Pick a plan first.'), { silent: false });
      return addWorkoutToPlan(planId, workout._id, slot);
    },
    onSuccess: (plan) => {
      qc.setQueryData<WorkoutPlan>(['workout-plan', plan._id], (old) => ({ ...(old ?? {}), ...plan }));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      qc.invalidateQueries({ queryKey: ['workout-plan', plan._id] });
      toast.success(`Added to ${plan.title}, week ${slot.week} day ${slot.day}`, {
        action: { label: 'Open plan', onClick: () => navigate(`/workouts/plans/${plan._id}`, { viewTransition: true }) },
      });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add this workout to the plan')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to plan"
      description={workout ? `Schedule “${workout.title}” into one of your plans.` : undefined}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={add.isPending} disabled={!planId || alreadyIn} onClick={() => add.mutate()} icon={<Plus size={18} />}>
            Add to plan
          </Button>
        </>
      }
    >
      {plans.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading your plans">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} className="rounded-md border border-line px-3" />
          ))}
        </div>
      ) : plans.isError ? (
        <ErrorState error={plans.error} title="Could not load your plans" onRetry={() => plans.refetch()} />
      ) : !(plans.data ?? []).length ? (
        <EmptyState
          size="sm"
          icon={<Layers size={26} />}
          title="No plans yet"
          message="Create a plan first, then schedule this workout into it."
          action={onCreatePlan ? { label: 'New plan', onClick: onCreatePlan, icon: <Plus size={18} /> } : { label: 'New plan', to: '/workouts?tab=plans&new=1', icon: <Plus size={18} /> }}
        />
      ) : (
        <div className="space-y-4">
          {(plans.data ?? []).length > 5 ? (
            <SearchField label="Filter plans" hideLabel placeholder="Filter plans by name or goal" value={search} onChange={(e) => setSearch(e.target.value)} />
          ) : null}
          <ul className="max-h-64 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label="Your plans">
            {list.map((p) => {
              const selected = p._id === planId;
              const sessions = (p.workouts ?? []).filter((e) => e.workout).length;
              return (
                <li key={p._id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setPlanId(p._id);
                      setSlot((s) => ({ ...s, week: Math.min(s.week, Math.max(1, p.durationWeeks ?? 52)) }));
                    }}
                    className={cx(
                      'flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors dur-1',
                      selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2/40 hover:bg-surface-2',
                    )}
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
                      <Layers size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-1">{p.title}</span>
                      <span className="block truncate text-xs text-text-2">
                        {p.durationWeeks ? `${p.durationWeeks} ${p.durationWeeks === 1 ? 'week' : 'weeks'} · ` : ''}
                        {sessions} {sessions === 1 ? 'session' : 'sessions'}
                      </span>
                    </span>
                    {selected ? <Badge tone="brand">Selected</Badge> : null}
                  </button>
                </li>
              );
            })}
            {list.length === 0 ? <li className="px-3 py-2 text-sm text-text-2">No plans match “{search.trim()}”.</li> : null}
          </ul>
          {chosen ? (
            alreadyIn ? (
              <p role="status" className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-2">
                This workout is already in {chosen.title}.
              </p>
            ) : (
              <SlotSteppers slot={slot} weeks={chosen.durationWeeks ?? 52} onChange={setSlot} />
            )
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/**
 * "Add workout" from a plan: search your library and the premade catalogue,
 * pick a session, then the week and day.
 */
export function AddWorkoutPicker({
  plan,
  open,
  onClose,
  onAdded,
}: {
  plan: WorkoutPlan;
  open: boolean;
  onClose: () => void;
  onAdded?: (plan: WorkoutPlan) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [slot, setSlot] = useState<ScheduleSlot>({ week: 1, day: 1 });

  useEffect(() => {
    if (!open) {
      setSearch('');
      setWorkoutId(null);
      setSlot({ week: 1, day: 1 });
    }
  }, [open]);

  const mine = useQuery({
    queryKey: ['workouts', 'mine', 'picker'],
    queryFn: async () => (await fetchMyWorkoutsPage(1)).items,
    enabled: open,
  });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: open });

  const scheduled = new Set((plan.workouts ?? []).map((e) => e.workout?._id).filter(Boolean) as string[]);
  const q = search.trim().toLowerCase();
  const filter = (list: SocialWorkout[]) =>
    list.filter((w) => !q || `${w.title} ${w.category} ${(w.hashtags ?? []).join(' ')}`.toLowerCase().includes(q));
  const groups: Array<{ label: string; items: SocialWorkout[] }> = [
    { label: 'Your workouts', items: filter(mine.data ?? []) },
    { label: 'Premade by Vybe', items: filter(premade.data ?? []) },
  ].filter((g) => g.items.length > 0);
  const chosen = [...(mine.data ?? []), ...(premade.data ?? [])].find((w) => w._id === workoutId);

  const add = useMutation({
    mutationFn: async () => {
      if (!workoutId) throw new Error('Pick a workout first.');
      return addWorkoutToPlan(plan._id, workoutId, slot);
    },
    onSuccess: (saved) => {
      qc.setQueryData<WorkoutPlan>(['workout-plan', plan._id], (old) => ({ ...(old ?? {}), ...saved }));
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      qc.invalidateQueries({ queryKey: ['workout-plan', plan._id] });
      toast.success(`${chosen?.title ?? 'Workout'} added to week ${slot.week}, day ${slot.day}`);
      onAdded?.(saved);
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not add this workout to the plan')),
  });

  const loading = mine.isLoading || premade.isLoading;
  const error = mine.isError ? mine.error : premade.isError ? premade.error : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add workout"
      description={`Schedule a session into ${plan.title}.`}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={add.isPending} disabled={!workoutId} onClick={() => add.mutate()} icon={<Plus size={18} />}>
            Add to plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SearchField
          label="Search workouts"
          hideLabel
          placeholder="Search your workouts and the premade catalogue"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading workouts">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} className="rounded-md border border-line px-3" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            error={error}
            title="Could not load workouts"
            onRetry={() => {
              mine.refetch();
              premade.refetch();
            }}
          />
        ) : groups.length === 0 ? (
          <EmptyState
            size="sm"
            variant={q ? 'no-results' : 'first-run'}
            icon={q ? undefined : <Dumbbell size={26} />}
            title={q ? `No workouts match “${search.trim()}”` : 'No workouts to add yet'}
            message={q ? 'Try another title, category or tag.' : 'Create a workout first, then schedule it here.'}
            action={q ? { label: 'Clear search', onClick: () => setSearch(''), variant: 'secondary' } : { label: 'New workout', to: '/workouts?log=1', icon: <Plus size={18} /> }}
          />
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1" role="radiogroup" aria-label="Workouts">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="type-label mb-1.5 text-text-2">{g.label}</p>
                <ul className="space-y-1.5">
                  {g.items.map((w) => {
                    const selected = w._id === workoutId;
                    const inPlan = scheduled.has(w._id);
                    return (
                      <li key={w._id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={inPlan}
                          onClick={() => setWorkoutId(w._id)}
                          className={cx(
                            'flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors dur-1',
                            selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2/40 hover:bg-surface-2',
                            inPlan && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <span className="h-10 w-14 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                            <CoverArt workout={w} compact />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-text-1">{w.title}</span>
                            <span className="block truncate text-xs text-text-2">
                              {humanize(w.category)}
                              {w.duration ? ` · ${formatStat(w.duration)} min` : ''}
                              {` · ${w.exercises?.length ?? 0} ${(w.exercises?.length ?? 0) === 1 ? 'exercise' : 'exercises'}`}
                            </span>
                          </span>
                          {inPlan ? <Badge>In plan</Badge> : selected ? <Badge tone="brand">Selected</Badge> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {chosen ? <SlotSteppers slot={slot} weeks={plan.durationWeeks ?? 52} onChange={setSlot} /> : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- workout card */

export function CoverArt({ workout, className, compact = false }: { workout: SocialWorkout; className?: string; compact?: boolean }) {
  const cover = workout.image?.uri ? mediaUrl(workout.image.uri) : '';
  if (cover) {
    return <img src={cover} alt="" loading="lazy" decoding="async" className={cx('h-full w-full object-cover', className)} />;
  }
  return (
    <div className={cx('flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-3', className)} aria-hidden="true">
      <Dumbbell size={compact ? 18 : 32} />
      {compact ? null : <span className="type-label text-text-3">{humanize(workout.category)}</span>}
    </div>
  );
}

function WorkoutCard({
  workout,
  ownerView,
  onEdit,
  onDelete,
  onReport,
  onAddToPlan,
}: {
  workout: SocialWorkout;
  ownerView: boolean;
  onEdit?: (w: SocialWorkout) => void;
  onDelete?: (w: SocialWorkout) => void;
  onReport?: (w: SocialWorkout) => void;
  onAddToPlan?: (w: SocialWorkout) => void;
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
      // Optimistic like toggling across every cached workout list (plain and paged).
      await qc.cancelQueries({ queryKey: ['workouts'] });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: ['workouts'] });
      if (user) {
        const patch = (w: SocialWorkout) =>
          w._id === workout._id
            ? { ...w, likes: liked ? (w.likes ?? []).filter((id) => String(id) !== user._id) : [...(w.likes ?? []), user._id] }
            : w;
        for (const [key, cached] of snapshots) {
          if (Array.isArray(cached)) {
            qc.setQueryData(key, (cached as SocialWorkout[]).map(patch));
          } else if (cached && typeof cached === 'object' && Array.isArray((cached as { pages?: unknown }).pages)) {
            const paged = cached as { pages: WorkoutPage[]; pageParams: unknown[] };
            qc.setQueryData(key, { ...paged, pages: paged.pages.map((p) => ({ ...p, items: p.items.map(patch) })) });
          }
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
    ...(onAddToPlan ? [{ label: 'Add to plan', description: 'Schedule it into one of your plans', icon: <Layers size={18} />, onSelect: () => onAddToPlan(workout) }] : []),
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

export function planMenu(
  plan: WorkoutPlan,
  {
    isOwn,
    toast,
    onEdit,
    onAddWorkout,
    onDelete,
  }: {
    isOwn: boolean;
    toast: ReturnType<typeof useToast>;
    onEdit?: (p: WorkoutPlan) => void;
    onAddWorkout?: (p: WorkoutPlan) => void;
    onDelete?: (p: WorkoutPlan) => void;
  },
): MenuItem[] {
  return [
    ...(isOwn && onEdit ? [{ label: 'Edit', icon: <Edit size={18} />, onSelect: () => onEdit(plan) }] : []),
    ...(isOwn && onAddWorkout ? [{ label: 'Add workout', description: 'Schedule a session into a week and day', icon: <Plus size={18} />, onSelect: () => onAddWorkout(plan) }] : []),
    { label: 'Share', icon: <ShareUp size={18} />, onSelect: () => void sharePlan(plan, toast, 'share') },
    { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void sharePlan(plan, toast, 'copy') },
    ...(isOwn && onDelete ? [{ label: 'Delete', icon: <Trash size={18} />, onSelect: () => onDelete(plan), danger: true, divider: true }] : []),
  ];
}

export function PlanCard({
  plan,
  ownerView = false,
  onEdit,
  onAddWorkout,
  onDelete,
}: {
  plan: WorkoutPlan;
  ownerView?: boolean;
  onEdit?: (p: WorkoutPlan) => void;
  onAddWorkout?: (p: WorkoutPlan) => void;
  onDelete?: (p: WorkoutPlan) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const isOwn = ownerView || Boolean(user && plan.createdBy && plan.createdBy._id === user._id);
  const included = (plan.workouts ?? []).filter((w) => w.workout);
  const href = `/workouts/plans/${plan._id}`;
  const menu = planMenu(plan, { isOwn, toast, onEdit, onAddWorkout, onDelete });

  return (
    <Card to={href} linkLabel={`Open ${plan.title}`} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-md font-semibold text-text-1">{plan.title}</h3>
          {plan.goal ? <p className="mt-0.5 text-sm text-text-2">{plan.goal}</p> : null}
          {plan.createdBy ? (
            <Link
              to={`/u/${plan.createdBy._id}`}
              viewTransition
              className="relative z-[2] mt-1 inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-text-2 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:text-text-1"
            >
              <Avatar src={plan.createdBy.avatar} name={plan.createdBy.fullName || plan.createdBy.username} alt="" size="xs" />
              <span className="truncate">{plan.createdBy.fullName || `@${plan.createdBy.username ?? 'unknown'}`}</span>
            </Link>
          ) : plan.isPremade ? (
            <p className="mt-1 text-xs font-medium text-text-2">By Vybe</p>
          ) : null}
        </div>
        <Menu items={menu} label={`More options for ${plan.title}`} className="relative z-[2] -mr-2 -mt-1.5" />
      </div>
      {plan.description ? <p className="line-clamp-2 text-sm text-text-2">{plan.description}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {plan.level ? <Badge>{humanize(plan.level)}</Badge> : null}
        {plan.isPremade ? <Badge tone="accent">Premade</Badge> : null}
        {isOwn && plan.isPublic === false ? <Badge>Private</Badge> : null}
      </div>
      <MetaList
        items={[
          !!plan.durationWeeks && { icon: <Clock size={14} />, label: `${plan.durationWeeks} ${plan.durationWeeks === 1 ? 'week' : 'weeks'}` },
          { icon: <Layers size={14} />, label: `${included.length} ${included.length === 1 ? 'workout' : 'workouts'}` },
          !plan.isPremade && (plan.isPublic === false ? { icon: <Globe size={14} />, label: 'Private' } : { icon: <Globe size={14} />, label: 'Public' }),
        ]}
      />
      {included.length > 0 ? (
        <ol className="relative z-[2] divide-y divide-line rounded-md border border-line bg-surface-2/40">
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
      ) : isOwn && onAddWorkout ? (
        <div className="relative z-[2] flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-4 text-center">
          <p className="text-xs text-text-3">No workouts scheduled yet</p>
          <Button type="button" variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => onAddWorkout(plan)}>
            Add workout
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-3 text-center text-xs text-text-3">
          No workouts scheduled yet
        </p>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- library stats */

function LibraryStats({ workouts, total }: { workouts: SocialWorkout[]; total: number }) {
  const exercises = workouts.reduce((n, w) => n + (w.exercises?.length ?? 0), 0);
  const minutes = workouts.reduce((n, w) => n + (Number(w.duration) || 0), 0);
  const shared = workouts.filter((w) => w.isPublic !== false).length;
  const likes = workouts.reduce((n, w) => n + (w.likes?.length ?? 0), 0);
  const partial = total > workouts.length;
  return (
    <StatGrid columns={4}>
      <StatTile label="Workouts" value={formatStat(total)} icon={<Dumbbell size={18} />} tone="brand" />
      <StatTile label="Exercises" value={formatStat(exercises)} icon={<Activity size={18} />} hint={partial ? `In the ${formatStat(workouts.length)} loaded` : undefined} />
      <StatTile label="Planned time" value={formatStat(minutes)} unit="min" icon={<Clock size={18} />} hint={partial ? `In the ${formatStat(workouts.length)} loaded` : undefined} />
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
  const kindParam = params.get('kind');
  const kind: KindKey = isKindKey(kindParam) ? kindParam : 'workouts';
  const showsPrograms = (tab === 'explore' || tab === 'premade') && kind === 'programs';
  const [workoutModal, setWorkoutModal] = useState(false);
  const [editing, setEditing] = useState<SocialWorkout | null>(null);
  const [planModal, setPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<WorkoutPlan | null>(null);
  const [addingTo, setAddingTo] = useState<WorkoutPlan | null>(null);
  const [addToPlan, setAddToPlan] = useState<SocialWorkout | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SocialWorkout | null>(null);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<WorkoutPlan | null>(null);
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
        n.delete('kind');
        return n;
      },
      { replace: true },
    );
  };

  const setKind = (next: KindKey) => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === 'workouts') n.delete('kind');
        else n.set('kind', next);
        return n;
      },
      { replace: true },
    );
  };

  const openNewWorkout = () => {
    setEditing(null);
    setWorkoutModal(true);
  };

  const openNewPlan = () => {
    setEditingPlan(null);
    setPlanModal(true);
  };

  // Deep links: /workouts?log=1 opens the new-workout form; ?tab=plans&new=1 the new-plan form.
  const wantsLog = params.get('log') === '1';
  const wantsPlan = params.get('new') === '1';
  useEffect(() => {
    if (!wantsLog && !wantsPlan) return;
    if (wantsLog) openNewWorkout();
    if (wantsPlan) openNewPlan();
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('log');
        n.delete('new');
        return n;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLog, wantsPlan]);

  const nextPage = (last: WorkoutPage) =>
    last.pagination && last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined;

  const mine = useInfiniteQuery({
    queryKey: ['workouts', 'mine', 'paged'],
    queryFn: ({ pageParam }) => fetchMyWorkoutsPage(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: tab === 'mine',
  });
  const explore = useInfiniteQuery({
    queryKey: ['workouts', 'explore', 'paged'],
    queryFn: ({ pageParam }) => fetchExplorePage(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: tab === 'explore' && !showsPrograms,
  });
  const plans = useQuery({ queryKey: ['workouts', 'plans'], queryFn: fetchMyPlans, enabled: tab === 'plans' });
  const premade = useQuery({ queryKey: ['workouts', 'premade'], queryFn: fetchPremade, enabled: tab === 'premade' && !showsPrograms });
  const premadePlans = useQuery({ queryKey: ['workouts', 'premade-plans'], queryFn: fetchPremadePlans, enabled: tab === 'premade' && showsPrograms });
  const communityPlans = useQuery({ queryKey: ['workouts', 'community-plans'], queryFn: fetchCommunityPlans, enabled: tab === 'explore' && showsPrograms });

  const mineItems = useMemo(() => mine.data?.pages.flatMap((p) => p.items) ?? [], [mine.data]);
  const exploreItems = useMemo(() => explore.data?.pages.flatMap((p) => p.items) ?? [], [explore.data]);
  const mineTotal = mine.data?.pages[0]?.pagination?.total ?? mineItems.length;
  const exploreTotal = explore.data?.pages[0]?.pagination?.total ?? exploreItems.length;

  const remove = useMutation({
    mutationFn: async (workout: SocialWorkout) => {
      await api.delete(`/workouts/${workout._id}`);
      return workout._id;
    },
    onSuccess: (id) => {
      toast.success('Workout deleted');
      qc.setQueryData<{ pages: WorkoutPage[]; pageParams: unknown[] }>(['workouts', 'mine', 'paged'], (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((w) => w._id !== id) })) } : old,
      );
      qc.invalidateQueries({ queryKey: ['workouts'] });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete workout')),
  });

  const removePlan = useMutation({
    mutationFn: async (plan: WorkoutPlan) => {
      await api.delete(`/workouts/plan/${plan._id}`);
      return plan._id;
    },
    onSuccess: (id) => {
      toast.success('Plan deleted');
      qc.setQueryData<WorkoutPlan[]>(['workouts', 'plans'], (old) => (old ?? []).filter((p) => p._id !== id));
      qc.removeQueries({ queryKey: ['workout-plan', id] });
      qc.invalidateQueries({ queryKey: ['workouts', 'plans'] });
      setPendingPlanDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete plan')),
  });

  type Pane = {
    loading: boolean;
    error: unknown;
    refetch: () => unknown;
    items: (SocialWorkout | WorkoutPlan)[];
    plans: boolean;
    hasMore?: boolean;
    fetchMore?: () => unknown;
    fetchingMore?: boolean;
    total?: number;
  };

  const pane: Pane = (() => {
    if (tab === 'mine') {
      return { loading: mine.isLoading, error: mine.isError ? mine.error : null, refetch: mine.refetch, items: mineItems, plans: false, hasMore: mine.hasNextPage, fetchMore: mine.fetchNextPage, fetchingMore: mine.isFetchingNextPage, total: mineTotal };
    }
    if (tab === 'plans') {
      return { loading: plans.isLoading, error: plans.isError ? plans.error : null, refetch: plans.refetch, items: plans.data ?? [], plans: true };
    }
    if (tab === 'explore') {
      if (showsPrograms) {
        return { loading: communityPlans.isLoading, error: communityPlans.isError ? communityPlans.error : null, refetch: communityPlans.refetch, items: communityPlans.data ?? [], plans: true };
      }
      return { loading: explore.isLoading, error: explore.isError ? explore.error : null, refetch: explore.refetch, items: exploreItems, plans: false, hasMore: explore.hasNextPage, fetchMore: explore.fetchNextPage, fetchingMore: explore.isFetchingNextPage, total: exploreTotal };
    }
    if (showsPrograms) {
      return { loading: premadePlans.isLoading, error: premadePlans.isError ? premadePlans.error : null, refetch: premadePlans.refetch, items: premadePlans.data ?? [], plans: true };
    }
    return { loading: premade.isLoading, error: premade.isError ? premade.error : null, refetch: premade.refetch, items: premade.data ?? [], plans: false };
  })();

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = pane.items;
    if (!query) return list;
    return list.filter((item) => {
      const hay = [item.title, item.description, (item as SocialWorkout).category, (item as WorkoutPlan).goal, item.level, ...(item.hashtags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [pane.items, query]);

  const counts: Partial<Record<TabKey, number>> = {
    mine: mine.data ? mineTotal : undefined,
    plans: plans.data?.length,
    explore: tab === 'explore' && showsPrograms ? communityPlans.data?.length : explore.data ? exploreTotal : undefined,
    premade: tab === 'premade' && showsPrograms ? premadePlans.data?.length : premade.data?.length,
  };

  const newMenu: MenuItem[] = [
    { label: 'New workout', description: 'A session you can log or share', icon: <Dumbbell size={18} />, onSelect: openNewWorkout },
    { label: 'New plan', description: 'A multi-week programme', icon: <Layers size={18} />, onSelect: openNewPlan },
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
      action: { label: 'New plan', onClick: openNewPlan },
    },
    explore: showsPrograms
      ? {
          title: 'No shared programs yet',
          message: 'Public plans from the community show up here. Share one of yours to get things going.',
          action: { label: 'New plan', onClick: openNewPlan },
        }
      : {
          title: 'Nothing shared yet',
          message: 'Public workouts from the community show up here. Share one of yours to get things going.',
          action: { label: 'New workout', onClick: openNewWorkout },
        },
    premade: showsPrograms
      ? {
          title: 'No premade programs yet',
          message: 'Vybe’s curated programs are not published yet. Build your own plan in the meantime.',
          action: { label: 'New plan', onClick: openNewPlan },
        }
      : {
          title: 'No premade workouts yet',
          message: 'Vybe’s ready-made sessions are not published yet. Build your own in the meantime.',
          action: { label: 'New workout', onClick: openNewWorkout },
        },
  };

  const filterLabel = pane.plans ? 'plans' : 'workouts';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workouts"
        subtitle="Build, share and explore training sessions."
        actions={
          <>
            <Button variant="secondary" icon={<Layers size={18} />} onClick={openNewPlan}>
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

      {tab === 'mine' && mineItems.length > 0 ? <LibraryStats workouts={mineItems} total={mineTotal} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        {tab === 'explore' || tab === 'premade' ? (
          <SegmentedControl
            aria-label={tab === 'premade' ? 'Premade catalogue' : 'Community catalogue'}
            tabs={[
              { key: 'workouts', label: 'Workouts', icon: <Dumbbell size={16} /> },
              { key: 'programs', label: 'Programs', icon: <Layers size={16} /> },
            ]}
            value={kind}
            onChange={(k: string) => {
              if (isKindKey(k)) setKind(k);
            }}
          />
        ) : null}
        <SearchField
          label={`Filter ${filterLabel}`}
          hideLabel
          containerClassName="min-w-56 flex-1"
          placeholder={pane.plans ? 'Filter plans by name or goal' : 'Filter by title, category or tag'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {pane.loading ? (
        <GridSkeleton />
      ) : pane.error ? (
        <ErrorState error={pane.error} title={`Could not load ${filterLabel}`} onRetry={() => pane.refetch()} />
      ) : filtered.length === 0 ? (
        query ? (
          <EmptyState
            variant="no-results"
            title={`No matches for “${search.trim()}”`}
            message={pane.plans ? 'Try a different name or goal, or clear the filter.' : 'Try a different title, category or tag, or clear the filter.'}
            action={{ label: 'Clear filter', onClick: () => setSearch(''), variant: 'secondary' }}
          />
        ) : (
          <EmptyState
            title={emptyCopy[tab].title}
            message={emptyCopy[tab].message}
            action={{ ...emptyCopy[tab].action, icon: <Plus size={18} /> }}
          />
        )
      ) : pane.plans ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(filtered as WorkoutPlan[]).map((plan) => (
            <PlanCard
              key={plan._id}
              plan={plan}
              ownerView={tab === 'plans'}
              onEdit={(p) => {
                setEditingPlan(p);
                setPlanModal(true);
              }}
              onAddWorkout={(p) => setAddingTo(p)}
              onDelete={(p) => setPendingPlanDelete(p)}
            />
          ))}
        </div>
      ) : (
        <>
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
                onAddToPlan={(w) => setAddToPlan(w)}
              />
            ))}
          </div>
          {pane.hasMore || (pane.total !== undefined && pane.total > pane.items.length) ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-xs text-text-3">
                Showing {formatStat(pane.items.length)} of {formatStat(pane.total ?? pane.items.length)} {filterLabel}
              </p>
              {pane.hasMore ? (
                <Button variant="secondary" loading={pane.fetchingMore} onClick={() => pane.fetchMore?.()}>
                  Load more
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <WorkoutModal
        open={workoutModal}
        editing={editing}
        onClose={() => {
          setWorkoutModal(false);
          setEditing(null);
        }}
      />
      <PlanModal
        open={planModal}
        editing={editingPlan}
        onClose={() => {
          setPlanModal(false);
          setEditingPlan(null);
        }}
      />
      {addingTo ? <AddWorkoutPicker plan={addingTo} open onClose={() => setAddingTo(null)} /> : null}
      <AddToPlanModal
        workout={addToPlan}
        onClose={() => setAddToPlan(null)}
        onCreatePlan={() => {
          setAddToPlan(null);
          openNewPlan();
        }}
      />
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
      <ConfirmDialog
        open={Boolean(pendingPlanDelete)}
        title="Delete plan?"
        message={`“${pendingPlanDelete?.title ?? ''}” will be removed. The workouts scheduled in it stay in your library.`}
        confirmLabel="Delete"
        destructive
        loading={removePlan.isPending}
        onCancel={() => setPendingPlanDelete(null)}
        onConfirm={() => pendingPlanDelete && removePlan.mutate(pendingPlanDelete)}
      />
      {reportModal}
    </div>
  );
}
