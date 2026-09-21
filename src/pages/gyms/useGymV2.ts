/**
 * The gym page's v2 queries. One rule holds for all of them: a surface whose
 * flag is off answers `404 FEATURE_DISABLED`, a community the viewer may not
 * see answers `404`, and a role refusal answers `403` — `absentOnRefusal`
 * turns each into `null`, so the caller renders nothing and never an error
 * card. Nothing retries: a flag decision is an answer, not a blip.
 *
 * Every key lives under `['community', id, …]`, so the page's existing
 * `invalidateQueries({ queryKey: ['community', communityId] })` reaches them.
 */
import { useQuery } from '@tanstack/react-query';
import {
  type CommunityPin,
  type GymEquipment,
  type LevelView,
  type ModerationLog,
  type ModerationQueue,
  type MyRegular,
  type OwnershipView,
  type QueueStatus,
  type RolesView,
  absentOnRefusal,
  fetchAnnouncementSeen,
  fetchEquipment,
  fetchModerationLog,
  fetchModerationQueue,
  fetchMyRegular,
  fetchNotificationLevel,
  fetchOwnership,
  fetchPins,
  fetchRegulars,
  fetchRoles,
  gymV2Keys,
} from '../../lib/gymCommunityV2';

/** A flag decision never retries, and holds for a minute. */
const V2_QUERY = { retry: false, staleTime: 60_000 } as const;

/**
 * The pin strip. Not flagged (`routes/gymPins.js`), readable by anyone who may
 * view the community, and the only list that carries the community's own
 * announcement — no route lists announcements.
 */
export function usePins(communityId: string, enabled: boolean) {
  return useQuery<{ pins: CommunityPin[]; limit: number } | null>({
    queryKey: gymV2Keys.pins(communityId),
    enabled,
    ...V2_QUERY,
    queryFn: () => absentOnRefusal(() => fetchPins(communityId)),
  });
}

/** "Seen by N" — the poster's and the moderators' read; `null` below SEEN_COUNT_MIN, and while the flag is off. */
export function useAnnouncementSeen(communityId: string, postId: string | null, enabled: boolean) {
  return useQuery<number | null>({
    queryKey: gymV2Keys.announcementSeen(communityId, postId || 'none'),
    enabled: enabled && Boolean(postId),
    ...V2_QUERY,
    queryFn: () => absentOnRefusal(() => fetchAnnouncementSeen(communityId, postId!)),
  });
}

/** The queue (`gymModerationQueue`, moderators): `null` while the flag is off or the viewer is not one. */
export function useModerationQueue(communityId: string, status: QueueStatus, page: number, enabled: boolean) {
  return useQuery<ModerationQueue | null>({
    queryKey: gymV2Keys.moderationQueue(communityId, status, page),
    enabled,
    ...V2_QUERY,
    staleTime: 15_000,
    queryFn: () => absentOnRefusal(() => fetchModerationQueue(communityId, { status, page, limit: 20 })),
  });
}

export function useModerationLog(communityId: string, page: number, enabled: boolean) {
  return useQuery<ModerationLog | null>({
    queryKey: gymV2Keys.moderationLog(communityId, page),
    enabled,
    ...V2_QUERY,
    queryFn: () => absentOnRefusal(() => fetchModerationLog(communityId, { page, limit: 20 })),
  });
}

/** The viewer's own notification level for this gym (`gymNotificationLevels`, members). */
export function useNotificationLevel(communityId: string, enabled: boolean) {
  return useQuery<LevelView | null>({
    queryKey: gymV2Keys.level(communityId),
    enabled,
    ...V2_QUERY,
    queryFn: () => absentOnRefusal(() => fetchNotificationLevel(communityId)),
  });
}

/** Ownership (`gymOwnership`, members): who owns it, the one open offer, and whether it is for the viewer. */
export function useOwnership(communityId: string, enabled: boolean) {
  return useQuery<OwnershipView | null>({
    queryKey: gymV2Keys.ownership(communityId),
    enabled,
    ...V2_QUERY,
    queryFn: () => absentOnRefusal(() => fetchOwnership(communityId)),
  });
}

/** Roles (`gymOwnership`): the list an ownership offer picks from. */
export function useRoles(communityId: string, enabled: boolean) {
  return useQuery<RolesView | null>({
    queryKey: gymV2Keys.roles(communityId),
    enabled,
    ...V2_QUERY,
    queryFn: () => absentOnRefusal(() => fetchRoles(communityId)),
  });
}

/** The opted-in laurels (`gymRegular`, members). Read only: the laurel is never granted from here. */
export function useRegulars(communityId: string, enabled: boolean) {
  return useQuery<{ userIds: string[]; count: number } | null>({
    queryKey: gymV2Keys.regulars(communityId),
    enabled,
    ...V2_QUERY,
    staleTime: 5 * 60_000,
    queryFn: () => absentOnRefusal(() => fetchRegulars(communityId)),
  });
}

/** The viewer's own Regular standing (`gymRegular`). */
export function useMyRegular(communityId: string, enabled: boolean) {
  return useQuery<MyRegular | null>({
    queryKey: gymV2Keys.myRegular(communityId),
    enabled,
    ...V2_QUERY,
    staleTime: 5 * 60_000,
    queryFn: () => absentOnRefusal(() => fetchMyRegular(communityId)),
  });
}

/** The floor: not flagged, and a gym nobody has described yet reads as the empty inventory. */
export function useEquipment(communityId: string, enabled: boolean) {
  return useQuery<GymEquipment | null>({
    queryKey: gymV2Keys.equipment(communityId),
    enabled,
    ...V2_QUERY,
    staleTime: 5 * 60_000,
    queryFn: () => absentOnRefusal(() => fetchEquipment(communityId)),
  });
}
