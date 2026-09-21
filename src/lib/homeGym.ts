import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from './api';
import { mergeAccount, useAuth } from './auth';
import type { User } from './auth';
import type { HomeGymRef, SettingsPatch } from './accountTypes';
import { coverSourceOf, isObjectId, membershipOf } from './gyms';
import type { CommunityLike } from './gyms';
import type { GymBandGym } from '../components/GymBand';

/**
 * The viewer's home gym: one shared query (`HOME_GYM_KEY`) whatever page asks
 * — Home's compact <GymHeader>, the Settings row, a post's gym line — so the
 * community is fetched once per session and every consumer paints the same
 * answer.
 *
 * Resolution order (API.md §1, §2, §7):
 *  1. `me.homeGym.community` (a bare id) → GET /gyms/community/:id: name,
 *     vicinity, member count, membership. The answer is also written into
 *     the gym page's own key (`['community', id]`), so CommunityDetail and
 *     PostCard's viewer-gym lookup never ask for the same gym again.
 *  2. No home gym → GET /gyms/community/my-communities?limit=5: the first
 *     membership is a *provisional* gym and the UI offers "Make this my home gym".
 *  3. Nothing at all → `gym: null`, the find-your-gym row. This is the
 *     production default today (the gym tables are empty), so it must render at
 *     once and never through a skeleton.
 *
 * The model returns as soon as the community does. The cover photo is its own
 * query that fills the crest in afterwards (GymHeader reserves the box), and
 * "N training today" is the leaderboard's string (never a number we compute),
 * fetched only for members and hidden whenever the call fails. Neither delays
 * the name — before this split the query awaited an 800 px photo blob before
 * resolving, and Home's top quarter was a skeleton for seconds on a cold load.
 */

export const HOME_GYM_KEY = ['home-gym'] as const;
const STALE_MS = 5 * 60_000;

/** The gym page's key for GET /gyms/community/:id (CommunityDetail, PostCard's useViewerGym). Filled here so they never refetch what the shell already has. */
export const communityKey = (id: string) => ['community', id] as const;

/** GET /gyms/community/:id `data`: the fields the gym header reads (API.md §2). */
export type HomeCommunity = CommunityLike & {
  _id: string;
  name?: string;
  /** Free text, street then city ("120 Market Street, Philadelphia"); either part may be missing. */
  vicinity?: string;
  location?: { latitude?: number; longitude?: number };
  /** Live size of the members array, a sibling of `members`; authoritative. */
  totalMembers?: number;
  members?: Array<{ user?: { _id: string; username?: string; fullName?: string; avatar?: string } | null }>;
  googleMapsData?: { rating?: number | null } | null;
};

export type HomeGym = {
  /** What the gym header draws; null = find-your-gym state. */
  gym: GymBandGym | null;
  /** The community behind it when there is one (bare place gyms have none). */
  community: HomeCommunity | null;
  /** True when this is the first of the viewer's communities, not a chosen home gym. */
  provisional: boolean;
  source: 'home' | 'place' | 'provisional' | 'none';
};

export const NO_HOME_GYM: HomeGym = { gym: null, community: null, provisional: false, source: 'none' };

/** The city part of an OSM vicinity ("120 Market Street, Philadelphia" → "Philadelphia"); a bare street or city passes through. */
export function cityOf(vicinity?: string | null): string | undefined {
  const parts = (vicinity ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

const displayName = (u?: { username?: string; fullName?: string } | null) => u?.fullName?.trim() || u?.username || 'Member';

/** Header model for a community payload. Missing data is omitted — never a zero, never a placeholder rating. */
export function gymFromCommunity(c: HomeCommunity, photoUrl?: string, sessionsTodayLabel?: string): GymBandGym {
  const lat = c.location?.latitude;
  const lng = c.location?.longitude;
  const rating = c.googleMapsData?.rating;
  const people = (c.members ?? [])
    .map((m) => m?.user)
    .filter((u): u is NonNullable<typeof u> => !!u && !!u._id)
    .slice(0, 5)
    .map((u) => ({ id: String(u._id), name: displayName(u), avatar: u.avatar }));
  return {
    id: String(c._id),
    name: c.name?.trim() || 'Your gym',
    city: cityOf(c.vicinity),
    photoUrl: photoUrl || undefined,
    memberCount: typeof c.totalMembers === 'number' && c.totalMembers > 0 ? c.totalMembers : undefined,
    rating: typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? rating : undefined,
    coords: typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    people: people.length ? people : undefined,
    sessionsTodayLabel,
  };
}

/** A gym pinned to a provider place with no community yet: name only, painted immediately. */
export const gymFromPlace = (place: { osmId: string; name: string }): GymBandGym => ({ id: place.osmId, name: place.name });

/**
 * `homeGym.community` as GET /users/me sends it: a bare id (API.md §1,
 * services/homeGym.js `homeGymView`). A populated `{ _id, name }` is accepted
 * too — PostCard already tolerates one, and a serialiser change must not turn
 * the row into a skeleton. Anything that is not a 24-hex id is no community.
 */
type CommunityRefWire = string | { _id?: unknown; name?: unknown } | null | undefined;
export function communityRefOf(ref: HomeGymRef | null | undefined): { id: string; name?: string } | null {
  const c = (ref as { community?: CommunityRefWire } | null | undefined)?.community;
  if (typeof c === 'string') return isObjectId(c) ? { id: c } : null;
  if (c && typeof c === 'object') {
    const id = c._id != null ? String(c._id) : '';
    const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : undefined;
    return isObjectId(id) ? { id, name } : null;
  }
  return null;
}

const unwrap = <T,>(data: any): T => (data?.data || data?.gymCommunity || data) as T;

/**
 * The cover photo. A URL or a managed media key resolves without a request;
 * a provider photo reference goes through the same proxy the community pages
 * use and comes back as a blob URL, cached per reference for the tab.
 */
const placePhotoCache = new Map<string, Promise<string>>();
async function resolveCover(c: HomeCommunity): Promise<string> {
  const source = coverSourceOf(c);
  if (!source) return '';
  if (source.kind === 'url') return source.url;
  if (source.kind === 'media-key') return mediaUrl(source.key);
  let pending = placePhotoCache.get(source.reference);
  if (!pending) {
    pending = api
      .get('/gyms/place-photo', { params: { reference: source.reference, maxwidth: 800 }, responseType: 'blob' })
      .then((r) => URL.createObjectURL(r.data as Blob));
    placePhotoCache.set(source.reference, pending);
    pending.catch(() => placePhotoCache.delete(source.reference));
  }
  return pending.catch(() => '');
}

/** The cover when it needs no request (a URL, a media key); undefined when it needs the photo proxy or there is none. */
function immediateCover(c: HomeCommunity | null): string | undefined {
  const source = coverSourceOf(c);
  if (!source) return undefined;
  if (source.kind === 'url') return source.url;
  if (source.kind === 'media-key') return mediaUrl(source.key);
  return undefined;
}

async function fetchCommunity(id: string, qc: QueryClient): Promise<HomeCommunity> {
  const { data } = await api.get(`/gyms/community/${id}`);
  const community = unwrap<HomeCommunity>(data);
  // The gym page and the post card read this key: one fetch serves all three.
  qc.setQueryData(communityKey(id), community);
  return community;
}

async function fetchFirstMembership(qc: QueryClient): Promise<HomeCommunity | null> {
  const { data } = await api.get('/gyms/community/my-communities', { params: { page: 1, limit: 5 } });
  const rows = (data?.data?.gymCommunities ?? data?.gymCommunities ?? []) as HomeCommunity[];
  const first = rows.find((r) => r && r._id);
  if (!first) return null;
  // List rows carry no members array (API.md §7); the detail call fills the stack.
  try {
    return await fetchCommunity(String(first._id), qc);
  } catch {
    return first;
  }
}

async function resolveHomeGym(ref: HomeGymRef | null | undefined, qc: QueryClient): Promise<HomeGym> {
  const communityRef = communityRefOf(ref);
  if (communityRef) {
    const community = await fetchCommunity(communityRef.id, qc);
    return { gym: gymFromCommunity(community), community, provisional: false, source: 'home' };
  }
  if (ref?.place?.osmId && ref.place.name) {
    return { gym: gymFromPlace(ref.place), community: null, provisional: false, source: 'place' };
  }
  const first = await fetchFirstMembership(qc);
  if (!first) return NO_HOME_GYM;
  return { gym: gymFromCommunity(first), community: first, provisional: true, source: 'provisional' };
}

const refSignature = (ref?: HomeGymRef | null) => (ref ? `${communityRefOf(ref)?.id ?? ''}|${ref.place?.osmId ?? ''}|${ref.place?.name ?? ''}` : '');

export type HomeGymState = HomeGym & {
  /** A gym is known to exist (the account points at one) and its details are still loading. Never true with no home gym. */
  loading: boolean;
  /** The lookup failed; the header shows the find-your-gym state (or the seeded name when known). */
  error: boolean;
  /** The viewer belongs to the community behind the gym (Open rather than Join). False for a bare place and while loading. */
  member: boolean;
};

const coverSignature = (c: HomeCommunity | null): string => {
  const source = coverSourceOf(c);
  if (!source) return '';
  return source.kind === 'url' ? `url:${source.url}` : source.kind === 'media-key' ? `key:${source.key}` : `ref:${source.reference}`;
};

export function useHomeGym(): HomeGymState {
  const user = useAuth((s) => s.user);
  const ref = user?.homeGym ?? null;
  const signature = refSignature(ref);
  const qc = useQueryClient();

  const query = useQuery<HomeGym>({
    queryKey: HOME_GYM_KEY,
    queryFn: () => resolveHomeGym(useAuth.getState().user?.homeGym ?? null, qc),
    enabled: !!user,
    staleTime: STALE_MS,
    retry: 1,
  });

  // The account's pointer changed (set from a gym page, or a fresh /users/me):
  // refetch, but not on the first render, where the query is already fetching.
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    void qc.invalidateQueries({ queryKey: HOME_GYM_KEY });
  }, [signature, qc]);

  const community = query.data?.community ?? null;
  const communityId = community?._id ? String(community._id) : null;
  const member = community ? membershipOf(community).isMember : false;

  // The cover: nothing to wait for when it is a URL or a media key; a provider
  // reference is fetched here, after the model has already painted.
  const coverSig = coverSignature(community);
  const cover = useQuery<string>({
    queryKey: [...HOME_GYM_KEY, 'cover', communityId, coverSig],
    queryFn: () => resolveCover(community as HomeCommunity),
    enabled: !!community && coverSig.startsWith('ref:'),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });

  const today = useQuery<string | null>({
    queryKey: [...HOME_GYM_KEY, 'today', communityId],
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/leaderboard`, { params: { week: 'this' } });
      const label = (data?.data ?? data)?.today?.activeMembersLabel;
      return typeof label === 'string' && label.trim() ? label.trim() : null;
    },
    enabled: !!communityId && member,
    staleTime: STALE_MS,
    retry: false,
  });

  const photoUrl = immediateCover(community) ?? (cover.data || undefined);
  const todayLabel = today.data ?? undefined;

  return useMemo<HomeGymState>(() => {
    const resolved = query.data;
    if (resolved) {
      const gym = resolved.gym ? { ...resolved.gym, photoUrl: resolved.gym.photoUrl ?? photoUrl, sessionsTodayLabel: todayLabel ?? resolved.gym.sessionsTodayLabel } : null;
      return { ...resolved, gym, member, loading: false, error: false };
    }
    // Pending or failed: paint what the account already tells us. The API
    // copies the community's name into `place.name` on write, so a community
    // ref carries a name from the first frame: the row is a skeleton of the
    // final geometry while the details load (Join/Open is not known yet) and
    // keeps the name and the right link if the lookup fails.
    const communityRef = communityRefOf(ref);
    const place = ref?.place;
    const seededName = communityRef?.name || place?.name?.trim() || undefined;
    if (communityRef) {
      const gym: GymBandGym = { id: communityRef.id, name: seededName || 'Your gym' };
      return { gym, community: null, provisional: false, source: 'home', member: false, loading: query.isPending, error: query.isError };
    }
    if (place?.osmId && place.name) {
      return { gym: gymFromPlace(place), community: null, provisional: false, source: 'place', member: false, loading: false, error: query.isError };
    }
    return { ...NO_HOME_GYM, member: false, loading: false, error: query.isError };
  }, [query.data, query.isPending, query.isError, ref, member, photoUrl, todayLabel]);
}

/**
 * PUT /users/settings { homeGym } — set from a community (`{ community: id }`),
 * a provider place, or `null` to clear. The account in the answer is stored
 * (keeping hasPassword) and the shared query refetches.
 */
export function useSetHomeGym() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (homeGym: SettingsPatch['homeGym']) => {
      const patch: SettingsPatch = { homeGym };
      const { data } = await api.put('/users/settings', patch);
      return (data.user || data) as User;
    },
    onSuccess: (account) => {
      const merged = mergeAccount(useAuth.getState().user, account);
      useAuth.getState().setUser(merged);
      if (qc.getQueryData(['me'])) qc.setQueryData(['me'], merged);
      void qc.invalidateQueries({ queryKey: HOME_GYM_KEY });
    },
  });
}
