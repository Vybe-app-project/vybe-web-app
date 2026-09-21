/**
 * Feed modes and feed controls (Wave G, `v2-be-feed-modes-trending`;
 * docs/api-contract.md, "Feed modes, controls, Explore, hidden details").
 *
 * The one thing to know before reading further: **none of the twelve
 * `/api/feed` routes serves a feed.** The modes are a query parameter on the
 * feed route the app already calls:
 *
 *   GET /api/posts/feed?mode=latest    the follow graph — what the app has
 *                                      always shown, and what the pill calls
 *                                      "Following". Never gated.
 *   GET /api/posts/feed?mode=foryou    the ranker. `feedForYou`.
 *   GET /api/posts/feed?mode=crew      the same query over the viewer's Crew.
 *                                      `feedForYou`. Not offered on Home yet.
 *
 * There is no `mode=following`: `latest` IS the following feed, so the pill's
 * two segments map to `latest` and `foryou` and the stored preference keeps
 * the API's words rather than the label's.
 *
 * The two modes page differently and the difference is not cosmetic: Latest
 * is keyset (`?before=<createdAt>_<id>`), For you carries an opaque window
 * token (`?cursor=foryou:<reqId>:<offset>`). Both arrive as `nextCursor`, so
 * `feedPageParams` decides which parameter name it travels under.
 *
 * `/api/feed` proper is the control surface: Not interested, Snooze, What you
 * see, Reset For you, impressions, the composer's partner removal and the
 * author's hidden-details bulk apply. Literal paths on purpose:
 * scripts/audit-api-contracts.cjs and tests/feed-modes-contract.test.mjs pin
 * each one against contracts/backend-routes.json.
 */
import { api } from './api';
import { apiErrorDetails } from './apiError';
import { FEED_PAGE_SIZE, feedPageParams, type FeedPageParam } from './feedLogic';
import type { PagedPosts } from './hooks';

export type { FeedPageParam };

/* ------------------------------------------------------------------ modes */

/** The API's own words (`services/feedRanker.js MODES`). */
export const FEED_MODES = ['latest', 'foryou', 'crew'] as const;
export type FeedMode = (typeof FEED_MODES)[number];

/** Following is the default and stays the default: no infinite For you before there is a graph. */
export const DEFAULT_FEED_MODE: FeedMode = 'latest';

export const FEED_MODE_LABELS: Readonly<Record<FeedMode, string>> = Object.freeze({
  latest: 'Following',
  foryou: 'For you',
  crew: 'Crew',
});

/** The two segments the pill offers. Crew exists on the API and has no home on Home yet. */
export const HOME_FEED_MODES: readonly FeedMode[] = ['latest', 'foryou'];

export const isFeedMode = (value: unknown): value is FeedMode =>
  typeof value === 'string' && (FEED_MODES as readonly string[]).includes(value);

const FEED_MODE_KEY = 'vybe.feedMode';

/**
 * The remembered mode. Unreadable storage (privacy mode) and an unknown
 * value both read as Following, so a bad string can never strand someone in
 * a feed the server will refuse.
 */
export function readFeedMode(): FeedMode {
  try {
    const stored = localStorage.getItem(FEED_MODE_KEY);
    return isFeedMode(stored) ? stored : DEFAULT_FEED_MODE;
  } catch {
    return DEFAULT_FEED_MODE;
  }
}

export function writeFeedMode(mode: FeedMode): void {
  try {
    if (mode === DEFAULT_FEED_MODE) localStorage.removeItem(FEED_MODE_KEY);
    else localStorage.setItem(FEED_MODE_KEY, mode);
  } catch {
    // Nothing to remember on a browser that refuses storage; the session keeps its state in React.
  }
}

/** A gated feed mode answers `404 { code: 'FEATURE_DISABLED' }` while `feedForYou` is off. */
export function isFeatureDisabled(e: unknown): boolean {
  const details = apiErrorDetails(e);
  return details.status === 404 && details.code === 'FEATURE_DISABLED';
}

/**
 * One feed page's query. Page one is a number, later pages carry the token
 * the previous answer gave — and the two modes read that token under
 * different names, which is the whole reason this wrapper exists:
 *
 *   latest / crew   `?before=<createdAt>_<id>`   (feedLogic.feedPageParams)
 *   foryou          `?cursor=foryou:<reqId>:<offset>`
 *
 * Sending a For you token as `before` would answer `400 Invalid feed cursor`;
 * sending a keyset cursor as `cursor` would answer `400 Invalid For you
 * cursor`. `mode` is omitted for Latest so the default path stays byte for
 * byte the request the app has always made.
 */
export function feedModeParams(mode: FeedMode, pageParam: FeedPageParam, limit = FEED_PAGE_SIZE): Record<string, string | number> {
  if (mode === 'foryou') {
    return typeof pageParam === 'string' ? { cursor: pageParam, limit, mode } : { page: pageParam, limit, mode };
  }
  const base = feedPageParams(pageParam, limit);
  return mode === 'latest' ? base : { ...base, mode };
}

/**
 * What the feed route answers, with the additive keys the modes bring:
 * `mode` (always), `reasons` and `reqId` (For you), `modeUnavailable: 'age'`
 * (a known minor asked for For you and was given Latest, D-91) and
 * `cursorReset` (the ranked window expired mid-scroll and page one of a new
 * one came back instead — the client dedupes by id).
 */
export type FeedResponse = PagedPosts & {
  mode?: FeedMode;
  modeUnavailable?: 'age';
  reqId?: string;
  reasons?: Record<string, string[]>;
  cursorReset?: true;
};

/** The reason vocabulary For you attaches to each item. */
export const FEED_REASONS = [
  'followed',
  'gym',
  'trained_together',
  'popular',
  'new_member',
  'audition',
  'crew',
  'recent',
] as const;
export type FeedReason = (typeof FEED_REASONS)[number];

export async function fetchFeed(mode: FeedMode, pageParam: FeedPageParam, limit = FEED_PAGE_SIZE): Promise<FeedResponse> {
  const { data } = await api.get<FeedResponse>('/posts/feed', { params: feedModeParams(mode, pageParam, limit) });
  return data;
}

/**
 * The server answered Latest for a For you request because the account is a
 * known minor (D-91). The pill follows the server rather than arguing.
 */
export const servedMode = (response: FeedResponse | undefined, asked: FeedMode): FeedMode =>
  (response?.mode && isFeedMode(response.mode) ? response.mode : asked);

/* ------------------------------------------------------------------ Explore */

/**
 * `GET /posts/all/trendings` — the `explore` flag's list. Explore is
 * Discover's surface, not Home's: nothing here is called from the feed.
 * A known minor gets an empty list with `unavailable: 'age'`.
 */
export type TrendingPostsResponse = PagedPosts & { unavailable?: 'age' };

export async function fetchTrendingPosts(page = 1, limit = 20): Promise<TrendingPostsResponse> {
  const { data } = await api.get<TrendingPostsResponse>('/posts/all/trendings', { params: { page, limit } });
  return data;
}

/* ------------------------------------------------------------------ controls */

export type FeedPreference = {
  kind: 'not_interested' | 'snooze';
  post?: string;
  author: string;
  expiresAt: string;
};

export type FeedControlActor = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

/** `GET /feed/controls` — What you see. */
export type FeedControls = {
  snoozed: { user: FeedControlActor; expiresAt: string; daysLeft: number }[];
  notInterested: {
    post: { _id: string; content: string; media: string | null; author: FeedControlActor } | null;
    createdAt: string;
  }[];
  mutedCount: number;
  rule: Record<string, unknown>;
};

export const feedControlKeys = {
  controls: () => ['feed', 'controls'] as const,
  hiddenDetailsPreview: (type: HiddenDetailsType, since: string | null) =>
    ['feed', 'hidden-details', 'preview', type, since] as const,
};

/** The two spans a snooze may run for. */
export const SNOOZE_DAYS = [7, 30] as const;
export type SnoozeDays = (typeof SNOOZE_DAYS)[number];

export async function fetchFeedControls(): Promise<FeedControls | null> {
  try {
    const { data } = await api.get<FeedControls>('/feed/controls');
    return data;
  } catch (e) {
    if (isFeatureDisabled(e)) return null;
    throw e;
  }
}

/** `DELETE /feed/controls` — Reset For you. Snoozes stay; sightings and hidden posts go. */
export async function resetFeedControls(): Promise<{ removed: { notInterested: number; impressions: number } }> {
  const { data } = await api.delete<{ removed: { notInterested: number; impressions: number } }>('/feed/controls');
  return data;
}

export async function markNotInterested(postId: string): Promise<FeedPreference> {
  const { data } = await api.post<{ preference: FeedPreference }>(`/feed/posts/${postId}/not-interested`);
  return data.preference;
}

export async function undoNotInterested(postId: string): Promise<boolean> {
  const { data } = await api.delete<{ removed: boolean }>(`/feed/posts/${postId}/not-interested`);
  return data.removed === true;
}

export async function snoozeAuthor(userId: string, days: SnoozeDays): Promise<FeedPreference> {
  const { data } = await api.post<{ preference: FeedPreference }>(`/feed/users/${userId}/snooze`, { days });
  return data.preference;
}

export async function unsnoozeAuthor(userId: string): Promise<boolean> {
  const { data } = await api.delete<{ removed: boolean }>(`/feed/users/${userId}/snooze`);
  return data.removed === true;
}

/** `POST /feed/impressions` — 1 to 50 sightings; items in a mode the flag does not allow are dropped, not refused. */
export const IMPRESSION_BATCH_MAX = 50;

export type FeedImpression = { post: string; mode: 'foryou' | 'explore'; reqId?: string; seenAt?: string };

export async function recordImpressions(items: readonly FeedImpression[]): Promise<number> {
  const { data } = await api.post<{ accepted: number }>('/feed/impressions', { items: items.slice(0, IMPRESSION_BATCH_MAX) });
  return data.accepted ?? 0;
}

/** `POST /feed/posts/:postId/partners/remove-me` — the tagged person untags themself (`composerV2`). */
export async function removeMeFromPartners(postId: string): Promise<void> {
  await api.post(`/feed/posts/${postId}/partners/remove-me`);
}

/* ------------------------------------------------------------------ hidden details */

export const HIDDEN_DETAILS_TYPES = ['post', 'workout'] as const;
export type HiddenDetailsType = (typeof HIDDEN_DETAILS_TYPES)[number];

/** `GET /feed/hidden-details/preview?type=&since=` — how many of the author's own posts a bulk apply would touch. */
export async function previewHiddenDetails(type: HiddenDetailsType, since?: string | null): Promise<number | null> {
  try {
    const { data } = await api.get<{ count: number }>('/feed/hidden-details/preview', {
      params: { type, ...(since ? { since } : {}) },
    });
    return data.count ?? 0;
  } catch (e) {
    if (isFeatureDisabled(e)) return null;
    throw e;
  }
}

/** `POST /feed/hidden-details/apply` — set the same hidden list on every matching own post. */
export async function applyHiddenDetails(
  type: HiddenDetailsType,
  details: readonly string[],
  since?: string | null,
): Promise<number> {
  const { data } = await api.post<{ updated: number }>('/feed/hidden-details/apply', {
    type,
    details: [...details],
    ...(since ? { since } : {}),
  });
  return data.updated ?? 0;
}
