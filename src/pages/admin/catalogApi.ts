import { adminApi, mediaUrl } from '../../lib/api';

/* ------------------------------------------------------------------ *
 * /api/admin/catalog — the premade workout and plan catalog.
 *
 * Every call goes through adminApi (staff bearer token). Paths are written
 * out as literals in each call so scripts/audit-api-contracts.cjs can pin
 * them to the backend route table; a shared path builder would make them
 * invisible to that audit.
 * ------------------------------------------------------------------ */

export const CATALOG_CATEGORIES = [
  'strength',
  'cardio',
  'yoga',
  'running',
  'hiit',
  'flexibility',
  'sports',
  'other',
] as const;
export const CATALOG_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

export type CatalogImage = { uri: string; width?: number; height?: number };

export type CatalogExercise = {
  _id: string;
  name: string;
  sets: number | null;
  reps: number | null;
  /** Seconds. */
  duration: number | null;
  /** Seconds. */
  rest: number | null;
  notes: string | null;
  caloriesBurned: number | null;
};

type CatalogOwnership = {
  isPremade: true;
  isPublic: boolean;
  createdBy: null;
  adminId: string | null;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CatalogWorkout = CatalogOwnership & {
  _id: string;
  title: string;
  description: string | null;
  category: CatalogCategory;
  level: CatalogLevel;
  /** Minutes. */
  duration: number | null;
  caloriesBurned: number | null;
  hashtags: string[];
  image: CatalogImage | null;
  exercises: CatalogExercise[];
};

/** The populated workout inside a plan entry: a summary, not the full record. */
export type PlanWorkoutRef = {
  _id: string;
  title: string;
  category: CatalogCategory;
  level: CatalogLevel;
  duration: number | null;
  caloriesBurned: number | null;
  image: CatalogImage | null;
  isPremade: boolean;
};

export type CatalogPlanEntry = {
  _id: string;
  day: number;
  week: number;
  order: number;
  workout: PlanWorkoutRef;
};

export type CatalogPlan = CatalogOwnership & {
  _id: string;
  title: string;
  description: string | null;
  goal: string | null;
  durationWeeks: number;
  level: CatalogLevel;
  hashtags: string[];
  image: CatalogImage | null;
  workouts: CatalogPlanEntry[];
  totalCaloriesBurned: number;
};

export type CatalogList<T> = { items: T[]; page: number; limit: number; total: number };

export type CatalogListParams = { search: string; page: number; limit: number };

/** `image` on the wire: an upload key to set, null to clear, absent to keep. */
export type ImageBody = string | null;

export type ExerciseBody = {
  name: string;
  sets?: number;
  reps?: number;
  duration?: number;
  rest?: number;
  caloriesBurned?: number;
  notes?: string;
};

export type WorkoutBody = {
  title?: string;
  description?: string | null;
  category?: CatalogCategory;
  level?: CatalogLevel;
  duration?: number | null;
  caloriesBurned?: number | null;
  hashtags?: string[];
  exercises?: ExerciseBody[];
  image?: ImageBody;
};

export type PlanEntryBody = { workout: string; day: number; week: number; order: number };

export type PlanBody = {
  title?: string;
  description?: string | null;
  goal?: string;
  durationWeeks?: number;
  level?: CatalogLevel;
  hashtags?: string[];
  image?: ImageBody;
  workouts?: PlanEntryBody[];
};

export const catalogKeys = {
  all: ['admin', 'catalog'] as const,
  workouts: ['admin', 'catalog', 'workouts'] as const,
  workoutList: (params: CatalogListParams) => ['admin', 'catalog', 'workouts', 'list', params] as const,
  workout: (id: string) => ['admin', 'catalog', 'workouts', 'item', id] as const,
  plans: ['admin', 'catalog', 'plans'] as const,
  planList: (params: CatalogListParams) => ['admin', 'catalog', 'plans', 'list', params] as const,
  plan: (id: string) => ['admin', 'catalog', 'plans', 'item', id] as const,
};

function listParams({ search, page, limit }: CatalogListParams): Record<string, string | number> {
  const params: Record<string, string | number> = { page, limit };
  if (search) params.search = search;
  return params;
}

function asList<T>(data: unknown, fallback: CatalogListParams): CatalogList<T> {
  const d = (data ?? {}) as Partial<CatalogList<T>>;
  return {
    items: Array.isArray(d.items) ? d.items : [],
    page: typeof d.page === 'number' ? d.page : fallback.page,
    limit: typeof d.limit === 'number' ? d.limit : fallback.limit,
    total: typeof d.total === 'number' ? d.total : 0,
  };
}

/* ---------------------------------------------------------------- workouts */

export async function listCatalogWorkouts(params: CatalogListParams): Promise<CatalogList<CatalogWorkout>> {
  const { data } = await adminApi.get('/admin/catalog/workouts', { params: listParams(params) });
  return asList<CatalogWorkout>(data, params);
}

export async function getCatalogWorkout(id: string): Promise<{ workout: CatalogWorkout; usedByPlans: number }> {
  const { data } = await adminApi.get(`/admin/catalog/workouts/${encodeURIComponent(id)}`);
  return { workout: data.workout as CatalogWorkout, usedByPlans: Number(data.usedByPlans) || 0 };
}

export async function createCatalogWorkout(body: WorkoutBody): Promise<CatalogWorkout> {
  const { data } = await adminApi.post('/admin/catalog/workouts', body);
  return data.workout as CatalogWorkout;
}

export async function updateCatalogWorkout(id: string, body: WorkoutBody): Promise<CatalogWorkout> {
  const { data } = await adminApi.patch(`/admin/catalog/workouts/${encodeURIComponent(id)}`, body);
  return data.workout as CatalogWorkout;
}

export async function deleteCatalogWorkout(id: string): Promise<{ detachedFromPlans: number }> {
  const { data } = await adminApi.delete(`/admin/catalog/workouts/${encodeURIComponent(id)}`);
  return { detachedFromPlans: Number(data?.detachedFromPlans) || 0 };
}

/* ------------------------------------------------------------------- plans */

export async function listCatalogPlans(params: CatalogListParams): Promise<CatalogList<CatalogPlan>> {
  const { data } = await adminApi.get('/admin/catalog/plans', { params: listParams(params) });
  return asList<CatalogPlan>(data, params);
}

export async function getCatalogPlan(id: string): Promise<CatalogPlan> {
  const { data } = await adminApi.get(`/admin/catalog/plans/${encodeURIComponent(id)}`);
  return data.plan as CatalogPlan;
}

export async function createCatalogPlan(body: PlanBody): Promise<CatalogPlan> {
  const { data } = await adminApi.post('/admin/catalog/plans', body);
  return data.plan as CatalogPlan;
}

export async function updateCatalogPlan(id: string, body: PlanBody): Promise<CatalogPlan> {
  const { data } = await adminApi.patch(`/admin/catalog/plans/${encodeURIComponent(id)}`, body);
  return data.plan as CatalogPlan;
}

export async function deleteCatalogPlan(id: string): Promise<void> {
  await adminApi.delete(`/admin/catalog/plans/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------------- image */

export const CATALOG_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const CATALOG_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Content type the upload API will accept for this file, or null when it is not an image we take. */
export function catalogImageContentType(file: File): string | null {
  const declared = (file.type || '').toLowerCase().split(';')[0];
  const alias: Record<string, string> = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/heif': 'image/heic' };
  const type = alias[declared] || declared;
  if (CATALOG_IMAGE_TYPES.includes(type)) return type;
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
  return byExt[ext] || null;
}

type PresignResponse = {
  uploadUrl: string;
  uploadMethod?: 'PUT' | 'POST';
  uploadFields?: Record<string, string>;
  publicUrl?: string;
  storageReference?: string;
  key: string;
};

/**
 * A catalog cover must be a completed upload owned by the acting admin:
 * presign with the staff token (so the key lives under this admin's id),
 * transfer the bytes, then hand the storage key to the catalog API as `image`.
 * Purpose `media` is the one both the presign route and the catalog's media
 * verifier accept for cover images.
 */
export async function uploadCatalogImage(file: File, contentType: string): Promise<{ key: string; url: string }> {
  const { data } = await adminApi.post('/upload/presign', { contentType, purpose: 'media', sizeBytes: file.size });
  const p = data as PresignResponse;
  let res: Response;
  if (p.uploadMethod === 'POST') {
    const form = new FormData();
    Object.entries(p.uploadFields || {}).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);
    res = await fetch(p.uploadUrl, { method: 'POST', body: form });
  } else {
    res = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status}). Try a smaller file or check your connection.`);
  const key = p.storageReference || p.key;
  return { key, url: p.publicUrl || mediaUrl(key) };
}
