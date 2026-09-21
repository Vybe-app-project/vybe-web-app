import { api } from '../../lib/api';
import { humanize, type SelectOption, type useToast } from '../../components/ui';

/**
 * The Train hub's data model: the social workout / plan catalogue types,
 * the fetchers every Train page shares, and the share helpers. Literal
 * request paths on purpose: the contract audit (scripts/audit-api-contracts.cjs)
 * pins every request against the backend route snapshot.
 */

/* ------------------------------------------------------------------ types */

export type WorkoutExercise = {
  _id?: string;
  /**
   * The shared library's slug, when the row was chosen from the exercise
   * picker (models/SocialWorkout.js keeps it). The same key the per-set
   * WorkoutLog contract uses, so a session started from this routine logs
   * under the library exercise and shares its records, history and page.
   */
  exerciseId?: string;
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

export type ListEnvelope<T> = {
  success?: boolean;
  data?: T[];
  pagination?: Pagination;
};

export type SaveEnvelope = { success?: boolean; data?: SocialWorkout; workout?: SocialWorkout; message?: string };
export type PlanEnvelope = { success?: boolean; data?: WorkoutPlan; message?: string };

export const CATEGORIES = ['strength', 'cardio', 'yoga', 'running', 'hiit', 'flexibility', 'sports', 'other'] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** Humanised option lists shared by the workout, plan and session forms. */
export const CATEGORY_OPTIONS: SelectOption[] = CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
export const LEVEL_OPTIONS: SelectOption[] = LEVELS.map((l) => ({ value: l, label: humanize(l) }));

/* -------------------------------------------------------------- fetchers */

export const PAGE_SIZE = 24;

export type WorkoutPage = { items: SocialWorkout[]; pagination?: Pagination };

const toPage = (data: ListEnvelope<SocialWorkout>): WorkoutPage => ({ items: data.data ?? [], pagination: data.pagination });

export async function fetchMyWorkoutsPage(page: number): Promise<WorkoutPage> {
  const { data } = await api.get<ListEnvelope<SocialWorkout>>('/workouts/my', { params: { page, limit: PAGE_SIZE } });
  return toPage(data);
}

export async function fetchExplorePage(page: number): Promise<WorkoutPage> {
  const { data } = await api.get<ListEnvelope<SocialWorkout>>('/workouts/filter/all/workouts/feed/filter/feed', {
    params: { page, limit: PAGE_SIZE },
  });
  return toPage(data);
}

export async function fetchMyPlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<ListEnvelope<WorkoutPlan>>('/workouts/plans/my', { params: { page: 1, limit: 50 } });
  return data.data ?? [];
}

export async function fetchCommunityPlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<ListEnvelope<WorkoutPlan>>('/workouts/plans/filter/all/workouts/feed/filter/feed', {
    params: { page: 1, limit: 50 },
  });
  return data.data ?? [];
}

export async function fetchPremade(): Promise<SocialWorkout[]> {
  const { data } = await api.get<{ workouts?: SocialWorkout[] }>('/workouts/commom/workouts/all/premade/fetch');
  return data.workouts ?? [];
}

export async function fetchPremadePlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<{ workouts?: WorkoutPlan[] }>('/workouts/commom/workouts/plan/all/premade/fetch');
  return data.workouts ?? [];
}

export async function fetchWorkout(workoutId: string): Promise<SocialWorkout> {
  const { data } = await api.get<{ success?: boolean; data: SocialWorkout }>(`/workouts/workout/info/single-workout/${workoutId}`);
  return data.data;
}

export async function fetchPlan(planId: string): Promise<WorkoutPlan> {
  const { data } = await api.get<PlanEnvelope>(`/workouts/plan/single-plan/${planId}`);
  if (!data?.data) throw new Error('Plan not found');
  return data.data;
}

/* ------------------------------------------------------------------ share */

type Toast = ReturnType<typeof useToast>;

async function shareUrl(url: string, title: string, noun: string, toast: Toast, mode: 'share' | 'copy') {
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
export async function shareWorkout(workout: Pick<SocialWorkout, '_id' | 'title'>, toast: Toast, mode: 'share' | 'copy' = 'share') {
  return shareUrl(`${window.location.origin}/workouts/${workout._id}`, workout.title, 'workout', toast, mode);
}

export async function sharePlan(plan: Pick<WorkoutPlan, '_id' | 'title'>, toast: Toast, mode: 'share' | 'copy' = 'share') {
  return shareUrl(`${window.location.origin}/workouts/plans/${plan._id}`, plan.title, 'plan', toast, mode);
}
