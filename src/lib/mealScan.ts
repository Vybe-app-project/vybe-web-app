import { api } from './api';
import type { Nutrition } from '../pages/Meals';

/**
 * "Photo + label" meal logging. What the API calls a scan is honest about
 * what it does: the photo is stored with the meal and the label the person
 * types is matched against the food catalog and their own history. No vision
 * model identifies the food (`visualIdentificationPerformed: false`), so the
 * copy on the web says "photo" and "matches", never "recognised".
 *
 * Flow: presign (purpose meal-scan) → PUT/POST the file → POST
 * /meals/scan/analyze { imageKey, hint } → the person picks a candidate or
 * types the macros → POST /meals/scan/log with the analysis token.
 */

export type MealScanCandidate = {
  id: string;
  name: string;
  brandName: string | null;
  source: 'curated_catalog' | 'your_foods' | 'meal_history';
  sourceLabel: string;
  servingSize: string;
  nutritionBasis: string;
  nutrition: {
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    sugar: number | null;
    sodium: number | null;
  };
  nutritionComplete: boolean;
  labelMatchConfidence: number | null;
};

export type MealScanAnalysis = {
  analysisToken: string;
  expiresInSeconds: number;
  status: 'needs_label' | 'candidates_found' | 'no_catalog_match';
  method: string;
  visualIdentificationPerformed: false;
  manualReviewRequired: true;
  guidance: string;
  image: { key: string; url: string; size: number; contentType: string };
  query: string | null;
  candidates: MealScanCandidate[];
};

type PresignResponse = {
  uploadUrl: string;
  uploadMethod?: 'PUT' | 'POST';
  uploadFields?: Record<string, string>;
  publicUrl?: string;
  storageReference?: string;
  key: string;
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export const mealPhotoContentType = (file: File): string | null => {
  const type = (file.type || '').toLowerCase();
  if (IMAGE_TYPES.includes(type)) return type;
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
  return byExt[ext] || null;
};

/** Owned, completed upload under the meal-scan purpose; returns its storage key. */
export async function uploadMealScanImage(file: File, contentType: string): Promise<{ key: string }> {
  const { data } = await api.post<PresignResponse>('/upload/presign', { contentType, purpose: 'meal-scan', sizeBytes: file.size });
  let res: Response;
  if (data.uploadMethod === 'POST') {
    const form = new FormData();
    Object.entries(data.uploadFields || {}).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);
    res = await fetch(data.uploadUrl, { method: 'POST', body: form });
  } else {
    res = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status}). Try a smaller photo or check your connection.`);
  return { key: data.storageReference || data.key };
}

export async function analyzeMealScan(input: { imageKey: string; hint?: string }): Promise<MealScanAnalysis> {
  const { data } = await api.post<MealScanAnalysis>('/meals/scan/analyze', input);
  return data;
}

export type ReviewedMealScan = {
  analysisToken: string;
  confirmed: true;
  foodName: string;
  servingSize: string;
  mealType: string;
  nutrition: Nutrition & { calories: number; protein: number; carbs: number; fat: number };
  selectedCandidateId?: string;
};

export async function logReviewedMealScan(input: ReviewedMealScan): Promise<unknown> {
  const { data } = await api.post('/meals/scan/log', input);
  return data;
}

/** Best effort: drop an uploaded photo the person decided not to log. */
export async function discardMealScan(input: { analysisToken?: string; imageKey?: string }): Promise<void> {
  try {
    await api.post('/meals/scan/discard', input);
  } catch {
    // The server also garbage-collects orphaned scan media.
  }
}

/** Candidate nutrition as the meal's totals; missing values become 0 for the person to fill in. */
export const nutritionFromCandidate = (candidate: MealScanCandidate): Nutrition => ({
  calories: candidate.nutrition.calories ?? 0,
  protein: candidate.nutrition.protein ?? 0,
  carbs: candidate.nutrition.carbs ?? 0,
  fat: candidate.nutrition.fat ?? 0,
  fiber: candidate.nutrition.fiber ?? 0,
  sugar: candidate.nutrition.sugar ?? 0,
  sodium: candidate.nutrition.sodium ?? 0,
});
