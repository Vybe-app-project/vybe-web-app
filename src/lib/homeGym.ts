import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from './api';
import { mergeAccount, useAuth } from './auth';
import type { User } from './auth';
import type { HomeGymRef, SettingsPatch } from './accountTypes';
import { coverSourceOf, isObjectId, membershipOf } from './gyms';
import type { CommunityLike } from './gyms';
import type { GymBandGym } from '../components/GymBand';

/**
 * The viewer's home gym, fetched ONCE for the whole shell (the band, the
 * sidebar identity card, and any page that wants the same answer). Pages never
 * fetch it themselves.
 *
 * Resolution order (API.md §1, §2, §7):
 *  1. `me.homeGym.community` (a bare id) → GET /gyms/community/:id, one call
 *     with everything the band draws; `me.homeGym.place.name` is painted at once
 *     while that call is in flight.
 *  2. No home gym → GET /gyms/community/my-communities?limit=5: the first
 *     membership is a *provisional* gym and the UI offers "Make this my home gym".
 *  3. Nothing at all → `gym: null`, the band's find-your-gym state. This is the
 *     production default today (the gym tables are empty), so it must render at
 *     once and never through a skeleton.
 *
 * "N training today" is the leaderboard's string (never a number we compute),
 * fetched only for members and hidden whenever the call fails.
 */

export const HOME_GYM_KEY = ['home-gym'] as const;
const STALE_MS = 5 * 60_000;

/** GET /gyms/community/:id `data`: the fields the band reads (API.md §2). */
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
  /** What the band draws; null = find-your-gym state. */
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

/** Band model for a community payload. Missing data is omitted — never a zero, never a placeholder rating. */
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

const unwrap = <T,>(data: any): T => (data?.data || data?.gymCommunity || data) as T;

/** Same proxy the community pages use for Google photo tokens; other references resolve without a request. */
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

async function fetchCommunity(id: string): Promise<HomeCommunity> {
  const { data } = await api.get(`/gyms/community/${id}`);
  return unwrap<HomeCommunity>(data);
}

async function fetchFirstMembership(): Promise<HomeCommunity | null> {
  const { data } = await api.get('/gyms/community/my-communities', { params: { page: 1, limit: 5 } });
  const rows = (data?.data?.gymCommunities ?? data?.gymCommunities ?? []) as HomeCommunity[];
  const first = rows.find((r) => r && r._id);
  if (!first) return null;
  // List rows carry no members array (API.md §7); the detail call fills the stack.
  try {
    return await fetchCommunity(String(first._id));
  } catch {
    return first;
  }
}

async function resolveHomeGym(ref: HomeGymRef | null | undefined): Promise<HomeGym> {
  const communityId = ref?.community && isObjectId(String(ref.community)) ? String(ref.community) : null;
  if (communityId) {
    const community = await fetchCommunity(communityId);
    const photoUrl = await resolveCover(community);
    return { gym: gymFromCommunity(community, photoUrl), community, provisional: false, source: 'home' };
  }
  if (ref?.place?.osmId && ref.place.name) {
    return { gym: gymFromPlace(ref.place), community: null, provisional: false, source: 'place' };
  }
  const first = await fetchFirstMembership();
  if (!first) return NO_HOME_GYM;
  const photoUrl = await resolveCover(first);
  return { gym: gymFromCommunity(first, photoUrl), community: first, provisional: true, source: 'provisional' };
}

const refSignature = (ref?: HomeGymRef | null) => (ref ? `${ref.community ?? ''}|${ref.place?.osmId ?? ''}|${ref.place?.name ?? ''}` : '');

export type HomeGymState = HomeGym & {
  /** A gym is known to exist (the account points at one) and its details are still loading. Never true with no home gym. */
  loading: boolean;
  /** The lookup failed; the band shows the find-your-gym state (or the place name when known). */
  error: boolean;
};

export function useHomeGym(): HomeGymState {
  const user = useAuth((s) => s.user);
  const ref = user?.homeGym ?? null;
  const signature = refSignature(ref);
  const qc = useQueryClient();

  const query = useQuery<HomeGym>({
    queryKey: HOME_GYM_KEY,
    queryFn: () => resolveHomeGym(useAuth.getState().user?.homeGym ?? null),
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

  return useMemo(() => {
    const resolved = query.data;
    if (resolved) {
      const gym = resolved.gym && today.data ? { ...resolved.gym, sessionsTodayLabel: today.data } : resolved.gym;
      return { ...resolved, gym, loading: false, error: false };
    }
    // Pending or failed: paint what the account already tells us.
    const place = ref?.place;
    const knownGym = !!(ref?.community || place);
    if (place?.osmId && place.name) {
      return { gym: gymFromPlace(place), community: null, provisional: false, source: 'place', loading: false, error: query.isError };
    }
    return { ...NO_HOME_GYM, loading: knownGym && query.isPending, error: query.isError };
  }, [query.data, query.isPending, query.isError, ref, today.data]);
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
