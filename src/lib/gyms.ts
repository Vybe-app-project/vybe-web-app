/**
 * Pure helpers for the Gyms and Communities pages. No React, no network, so
 * tests/gyms-communities.test.mjs can load them straight through the
 * TypeScript loader and pin the rules the UI depends on.
 */

export type MembershipStatus = 'member' | 'pending' | 'none';

export type CommunityLike = {
  _id?: string;
  isMember?: boolean;
  userRole?: string | null;
  founder?: { _id?: string } | string | null;
  settings?: { isPublic?: boolean; requireApproval?: boolean };
  photos?: { photoReference?: string; url?: string }[];
  coverImage?: string;
  stats?: { totalMembers?: number };
  userMembership?: { status?: string; role?: string | null; requestId?: string; isMember?: boolean };
};

export type Membership = {
  status: MembershipStatus;
  isMember: boolean;
  /** Role when a member; null otherwise. */
  role: string | null;
  pending: boolean;
};

export const MOD_ROLES = ['owner', 'admin', 'moderator', 'founder'];

export const isModRole = (role?: string | null) => MOD_ROLES.includes(String(role || '').toLowerCase());

/**
 * The API describes the viewer's relationship in two shapes: explore sends
 * top-level `isMember`/`userRole`, detail and my-communities historically
 * sent only `userMembership`. Read both so every surface agrees.
 */
export function membershipOf(c?: CommunityLike | null): Membership {
  const status = String(c?.userMembership?.status || '').toLowerCase();
  const isMember = c?.isMember === true || c?.userMembership?.isMember === true || status === 'member';
  const role = isMember ? c?.userRole || c?.userMembership?.role || 'member' : null;
  return {
    status: isMember ? 'member' : status === 'pending' ? 'pending' : 'none',
    isMember,
    role,
    pending: !isMember && status === 'pending',
  };
}

export const founderIdOf = (c?: CommunityLike | null): string | null => {
  const f = c?.founder;
  if (!f) return null;
  return typeof f === 'string' ? f : f._id || null;
};

/** Visibility badge vocabulary, identical on cards and in the detail. */
export function visibilityBadge(c?: CommunityLike | null): 'private' | 'approval' | null {
  if (c?.settings?.isPublic === false) return 'private';
  if (c?.settings?.requireApproval) return 'approval';
  return null;
}

/** The primary action a non-member sees for a community. */
export function joinLabel(c?: CommunityLike | null): string {
  const m = membershipOf(c);
  if (m.pending) return 'Cancel request';
  return visibilityBadge(c) ? 'Request to join' : 'Join';
}

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const isObjectId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);

const MANAGED_KEY = /^\/?uploads\/[a-f0-9]{24}\/[a-z0-9-]+\/[A-Za-z0-9-]+\.[a-z0-9]+$/;

export type CoverSource =
  | { kind: 'url'; url: string }
  | { kind: 'media-key'; key: string }
  | { kind: 'place-photo'; reference: string }
  | null;

/**
 * Communities store photos as `photoReference` (the API signs managed keys
 * into /api/media/content URLs on the way out). Google photo tokens are the
 * only references that need the authenticated place-photo proxy.
 */
export function coverSourceOf(c?: CommunityLike | null): CoverSource {
  const first = c?.photos?.[0];
  const candidate = (c?.coverImage || first?.photoReference || first?.url || '').trim();
  if (!candidate) return null;
  if (/^(https?:)?\/\//i.test(candidate) || candidate.startsWith('data:') || candidate.startsWith('blob:')) {
    return { kind: 'url', url: candidate };
  }
  if (MANAGED_KEY.test(candidate)) return { kind: 'media-key', key: candidate.replace(/^\//, '') };
  return { kind: 'place-photo', reference: candidate };
}

export type PlaceLike = {
  place_id?: string;
  placeId?: string;
  name?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  distanceKm?: number;
};

export type DirectoryGymLike = {
  _id: string;
  name?: string;
  placeId?: string;
  location?: { lat?: number; lng?: number };
};

const toRad = (v: number) => (v * Math.PI) / 180;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Map results that are already in the directory are dropped so a gym never
 * shows twice on Nearby: same placeId, or same normalised name within 150 m.
 */
export function dedupeProviderPlaces<P extends PlaceLike>(places: P[], gyms: DirectoryGymLike[]): P[] {
  const ids = new Set(gyms.map((g) => g.placeId).filter(Boolean));
  const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return places.filter((p) => {
    const id = p.place_id || p.placeId;
    if (id && ids.has(id)) return false;
    const lat = p.geometry?.location?.lat;
    const lng = p.geometry?.location?.lng;
    return !gyms.some((g) => {
      if (norm(g.name) !== norm(p.name) || !norm(p.name)) return false;
      if (typeof lat !== 'number' || typeof lng !== 'number' || typeof g.location?.lat !== 'number' || typeof g.location?.lng !== 'number') return true;
      return haversineKm(lat, lng, g.location.lat, g.location.lng) < 0.15;
    });
  });
}

/** Nearby radius is chosen in km; the provider proxy takes metres, capped at 50 km. */
export const providerRadiusMeters = (radiusKm: number | string) =>
  Math.min(50000, Math.max(100, Math.round(Number(radiusKm) * 1000) || 100));

export function distanceLabelKm(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

/** Canonical web address for a community, shared by share links and cards. */
export const communityPath = (id: string) => `/communities?community=${encodeURIComponent(id)}`;

/** State handed to /communities so "Start a community here" pre-fills the form. */
export type CommunityPreset = {
  placeId?: string;
  name?: string;
  vicinity?: string;
  location?: { latitude: number; longitude: number } | null;
};

export function presetFromPlace(p: {
  place_id?: string;
  placeId?: string;
  name?: string;
  formatted_address?: string;
  vicinity?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
}): CommunityPreset {
  const lat = p.geometry?.location?.lat;
  const lng = p.geometry?.location?.lng;
  return {
    placeId: p.place_id || p.placeId || undefined,
    name: p.name || undefined,
    vicinity: p.vicinity || p.formatted_address || undefined,
    location: typeof lat === 'number' && typeof lng === 'number' ? { latitude: lat, longitude: lng } : null,
  };
}

export const COMMUNITY_NAME_MIN = 2;
export const COMMUNITY_NAME_MAX = 120;
export const COMMUNITY_DESCRIPTION_MAX = 2000;
export const COMMUNITY_MEMBERS_MIN = 2;
export const COMMUNITY_MEMBERS_MAX = 10000;

export function communityNameError(value: string): string | null {
  const n = value.trim().length;
  if (n < COMMUNITY_NAME_MIN) return 'Give the community a name of at least 2 characters';
  if (n > COMMUNITY_NAME_MAX) return `Keep the name under ${COMMUNITY_NAME_MAX} characters`;
  return null;
}

export function maxMembersError(value: string): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < COMMUNITY_MEMBERS_MIN || n > COMMUNITY_MEMBERS_MAX) {
    return `Between ${COMMUNITY_MEMBERS_MIN} and ${COMMUNITY_MEMBERS_MAX.toLocaleString()} members`;
  }
  return null;
}
