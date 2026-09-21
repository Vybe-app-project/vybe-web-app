/**
 * Saved things: the bookmark on a post, and the five `/api/favorites`
 * routes (docs/api-contract.md, "Saved posts" and "Food favourites").
 *
 * The premise correction that shapes this module: **`/api/favorites` has
 * nothing to do with posts.** Its five routes favourite *foods* and *meals*
 * and list recently logged foods. Saving a post is three older routes under
 * `/api/posts` — `bookmark`, `unbookmark`, `bookmarks` — and the flag a post
 * row carries is `isBookmarked`. There is no `saved`, `favorited` or
 * `bookmarked` key anywhere on a post, and `Post.saves` is a stored array
 * with no writer, so nothing here reads it.
 *
 * Both live in one module because "Saved" is one idea to the person using
 * it, and because keeping the literal paths in one place is what lets
 * scripts/audit-api-contracts.cjs and tests/favorites-contract.test.mjs pin
 * them against contracts/backend-routes.json.
 *
 * None of these routes is behind a feature flag.
 */
import { api } from './api';
import type { Post } from './hooks';

/* ------------------------------------------------------------------ query keys */

/**
 * `['bookmarks']` is the key PostCard has always invalidated after a save,
 * so the saved list has to read that exact root or a card saved in the feed
 * would never reach the Saved tab. The paged variant nests under it.
 */
export const favoriteKeys = {
  bookmarks: () => ['bookmarks'] as const,
  bookmarksPage: (limit: number) => ['bookmarks', 'page', limit] as const,
  foods: () => ['favorites', 'foods'] as const,
  meals: () => ['favorites', 'meals'] as const,
  recentFoods: () => ['favorites', 'recent'] as const,
};

/* ------------------------------------------------------------------ post bookmarks */

export const SAVED_POSTS_PAGE_SIZE = 20;

/** `POST /posts/bookmark { postId }`. */
export async function bookmarkPost(postId: string): Promise<void> {
  await api.post('/posts/bookmark', { postId });
}

/** `POST /posts/unbookmark { postId }`. Idempotent: no existence check on the server. */
export async function unbookmarkPost(postId: string): Promise<void> {
  await api.post('/posts/unbookmark', { postId });
}

/** One save, either way, so a caller never has to remember which path is which. */
export async function setPostBookmark(postId: string, saved: boolean): Promise<void> {
  if (saved) await bookmarkPost(postId);
  else await unbookmarkPost(postId);
}

export type SavedPostsPage = {
  posts: Post[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

/**
 * `GET /posts/bookmarks`. The route has two shapes and the difference is the
 * query string: **without** `page` or `limit` it answers the legacy
 * `{ bookmarks, total, page: 1, hasNextPage: false }` — every saved post in
 * one response — and **with** either of them it answers
 * `{ posts, total, page, hasNextPage }`. Asking for a page is the only way
 * to bound the response, so this always asks, and reads both keys anyway so
 * an older deployment still fills the list.
 */
export async function fetchSavedPosts(page = 1, limit = SAVED_POSTS_PAGE_SIZE): Promise<SavedPostsPage> {
  const { data } = await api.get<{ posts?: Post[]; bookmarks?: Post[]; total?: number; page?: number; hasNextPage?: boolean }>(
    '/posts/bookmarks',
    { params: { page, limit } },
  );
  const posts = data.posts ?? data.bookmarks ?? [];
  return {
    posts,
    total: typeof data.total === 'number' ? data.total : posts.length,
    page: typeof data.page === 'number' ? data.page : page,
    hasNextPage: data.hasNextPage === true,
  };
}

/* ------------------------------------------------------------------ food and meal favourites */

export type FavoriteFood = {
  _id: string;
  description?: string;
  brandName?: string;
  servingSize?: string;
  serving?: { amount?: number; unit?: string; text?: string };
  nutritionFacts?: Record<string, number | undefined>;
  ownership?: 'system' | 'user';
  category?: string;
  isFavorite?: boolean;
  image?: { source: string; url?: string; category?: string; attribution?: string };
};

export type FavoriteMeal = {
  _id: string;
  food_name?: string;
  brandName?: string;
  serving_size?: string;
  servingSize?: string;
  servingsConsumed?: number;
  foodId?: string;
  meal_type?: string;
  nutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; sugar?: number; sodium?: number };
  timestamp?: string;
  isFavorite?: boolean;
};

export type RecentFood = FavoriteMeal & { image_url?: string; foods?: unknown[] };

/** Every favourites read answers a **bare array**, not an envelope. */
const listOf = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/** `POST /favorites/foods/:foodId` — a toggle; the answer says which way it went. */
export async function toggleFavoriteFood(foodId: string): Promise<boolean> {
  const { data } = await api.post<{ message: string; isFavorite: boolean }>(`/favorites/foods/${foodId}`);
  return data.isFavorite === true;
}

export async function fetchFavoriteFoods(): Promise<FavoriteFood[]> {
  const { data } = await api.get('/favorites/foods');
  return listOf<FavoriteFood>(data);
}

/** `POST /favorites/meals/:mealId` — a toggle, on one of the caller's own meals. */
export async function toggleFavoriteMeal(mealId: string): Promise<boolean> {
  const { data } = await api.post<{ message: string; isFavorite: boolean }>(`/favorites/meals/${mealId}`);
  return data.isFavorite === true;
}

export async function fetchFavoriteMeals(): Promise<FavoriteMeal[]> {
  const { data } = await api.get('/favorites/meals');
  return listOf<FavoriteMeal>(data);
}

/** `GET /favorites/recent` — up to ten distinct foods logged in the last week. */
export async function fetchRecentFoods(): Promise<RecentFood[]> {
  const { data } = await api.get('/favorites/recent');
  return listOf<RecentFood>(data);
}
