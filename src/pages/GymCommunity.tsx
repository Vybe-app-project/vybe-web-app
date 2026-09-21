import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, type PublicUser, uploadOwnedMedia, useDebounced } from '../lib/hooks';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_NAME_MAX,
  type CommunityLike,
  type CommunityPreset,
  communityNameError,
  coverSourceOf,
  isModRole,
  isObjectId,
  joinLabel,
  maxMembersError,
  membershipOf,
  pluralize,
  visibilityBadge,
} from '../lib/gyms';
import { memberCountLabel } from '../components/GymBand';
import {
  Badge,
  Button,
  Card,
  CardGrid,
  CardMedia,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
  cx,
  humanize,
  useToast,
} from './ui';
import { Check, ChevronLeft, ChevronRight, Clock, Image as ImageIcon, Lock, MapPin, Plus, Share, Shield, Users, X } from './icons';

/* ------------------------------------------------------------------ types (shared with the detail pages) */

export type CommunityMember = {
  _id?: string;
  role?: string;
  joinedAt?: string;
  isFollowing?: boolean;
  user?: PublicUser;
};

/**
 * `GET /gyms/community/:id` (API.md §2): `totalMembers` is a top-level sibling
 * of `members`, computed from the live array; `vicinity` is street-then-city
 * free text that may be partial or empty; `googleMapsData.rating` is usually
 * absent; `timezone` is set by the first event and is often missing.
 */
export type Community = CommunityLike & {
  _id: string;
  name?: string;
  description?: string;
  vicinity?: string;
  category?: string;
  placeId?: string;
  timezone?: string;
  location?: { latitude?: number; longitude?: number };
  founder?: { _id?: string; username?: string; fullName?: string; avatar?: string } | null;
  foundedAt?: string;
  totalMembers?: number;
  members?: CommunityMember[];
  googleMapsData?: { rating?: number | null } | null;
  stats?: { totalMembers?: number; activeMembers?: number; totalPosts?: number };
  settings?: { isPublic?: boolean; requireApproval?: boolean; maxMembers?: number };
  /** `member` when a member created it from a place they typed in (`user-<24hex>`); such communities carry a `reviewState`. */
  source?: string;
  /** `pending` until an operator reviews a member-created community; pending and rejected ones are members-only in every list. */
  reviewState?: string;
};

/** The public face of a member on the activity routes (`active-this-week`, `trained-today`). */
export type PublicActor = { _id: string; username?: string; fullName?: string; avatar?: string };

/**
 * `GET /gyms/community/:id/active-this-week` — `count` is the exact number of
 * distinct members with a check-in this week (only-me, blocked and
 * undiscoverable included); `members` is the visible subset, at most 12,
 * newest first; `sample` is true when the subset is shorter than the count.
 */
export type ActiveThisWeek = { count: number; members: PublicActor[]; sample?: boolean };

/** `GET /gyms/community/:id/trained-today?timeZone=` — the same shape for the local day, plus which zone drew the day. */
export type TrainedToday = {
  count: number;
  members: PublicActor[];
  localDay?: string;
  timezone?: string;
  /** `default` means the day was computed in UTC: the community has no zone yet. */
  timezoneSource?: 'community' | 'query' | 'viewer' | 'default' | string;
};

/** `GET /gyms/places/:placeId/hours?timeZone=` — `open: null` means the provider has no hours for the place. */
export type PlaceHours = { open: boolean | null; closesAt?: string | null; opensAt?: string | null; openingHours?: unknown };

type Paged<T> = {
  gymCommunities: T[];
  pagination: { currentPage: number; totalPages: number; hasNext: boolean; totalGymCommunities?: number };
};

type ListTab = 'explore' | 'mine';

const PAGE = 18;

/* ------------------------------------------------------------------ helpers (shared) */

export const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

export const nameOf = (u?: { username?: string; fullName?: string } | null) => u?.fullName?.trim() || u?.username || 'Member';

export const unwrapCommunity = (data: any): Community => (data?.data || data?.gymCommunity || data) as Community;

export const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null)?.response?.status;

/** The device's IANA zone: what the activity routes and the event form are told (API.md §11b). */
export const zoneOf = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** The activity routes answer `{ count, members }`, sometimes inside a `data` envelope; anything else is "no figure". */
function unwrapActivity<T extends { count: number; members: PublicActor[] }>(data: unknown): T | null {
  const outer = data as { data?: unknown } | null;
  const inner = outer?.data;
  const body = (inner && typeof inner === 'object' && 'count' in (inner as object) ? inner : data) as Partial<T> | null;
  if (!body || typeof body !== 'object' || typeof body.count !== 'number' || !Number.isFinite(body.count)) return null;
  const members = Array.isArray(body.members) ? body.members.filter((m): m is PublicActor => Boolean(m && typeof m === 'object' && (m as PublicActor)._id)) : [];
  return { ...(body as T), count: Math.max(0, Math.round(body.count)), members };
}

const ACTIVITY_QUERY = { retry: false, staleTime: 60_000 } as const;

/**
 * Who was active this week: the header's third figure and the Today tab's
 * faces. Additive on the API (2026-09-20), so a 404 — an older API, or a
 * community the viewer may not see — is simply "no figure", never an error.
 */
export function useActiveThisWeek(communityId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['community', communityId, 'active-this-week'],
    enabled,
    ...ACTIVITY_QUERY,
    queryFn: async () => {
      try {
        const { data } = await api.get(`/gyms/community/${communityId}/active-this-week`);
        return unwrapActivity<ActiveThisWeek>(data);
      } catch (e) {
        if (statusOf(e) === 404) return null;
        throw e;
      }
    },
  });
}

/** Who trained today, in the device's zone; the same 404 rule. */
export function useTrainedToday(communityId: string, enabled: boolean) {
  const timeZone = zoneOf();
  return useQuery({
    queryKey: ['community', communityId, 'trained-today', timeZone],
    enabled,
    ...ACTIVITY_QUERY,
    queryFn: async () => {
      try {
        const { data } = await api.get(`/gyms/community/${communityId}/trained-today`, { params: { timeZone } });
        return unwrapActivity<TrainedToday>(data);
      } catch (e) {
        if (statusOf(e) === 404) return null;
        throw e;
      }
    },
  });
}

/** Opening hours for a place. Only OpenStreetMap ids resolve, so nothing else is even asked. */
export function usePlaceHours(placeId: string | null | undefined, enabled = true) {
  const timeZone = zoneOf();
  const resolvable = typeof placeId === 'string' && /^osm-/.test(placeId);
  return useQuery({
    queryKey: ['place', placeId, 'hours', timeZone],
    enabled: enabled && resolvable,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const { data } = await api.get(`/gyms/places/${encodeURIComponent(placeId!)}/hours`, { params: { timeZone } });
        const outer = data as { data?: unknown } | null;
        const body = (outer?.data && typeof outer.data === 'object' && 'open' in (outer.data as object) ? outer.data : data) as PlaceHours | null;
        return body && typeof body === 'object' && 'open' in body ? body : null;
      } catch (e) {
        if (statusOf(e) === 404) return null;
        throw e;
      }
    },
  });
}

/** "22:00" as sent, or an instant rendered as a 24-hour clock; anything else is dropped rather than guessed. */
function clockOf(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  const clock = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (clock) return `${clock[1].padStart(2, '0')}:${clock[2]}`;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  } catch {
    return null;
  }
}

/** "Open now · closes 22:00" / "Closed · opens 06:00"; `open: null` (no hours known) says nothing. */
export function hoursLine(hours?: PlaceHours | null): string | null {
  if (!hours || typeof hours.open !== 'boolean') return null;
  if (hours.open) {
    const closes = clockOf(hours.closesAt);
    return closes ? `Open now · closes ${closes}` : 'Open now';
  }
  const opens = clockOf(hours.opensAt);
  return opens ? `Closed · opens ${opens}` : 'Closed now';
}

/** The blue text button of a page header (Instagram's "Edit"/"Next"): the one primary action when it is a verb, not a form. */
export const TEXT_ACTION = 'pressable -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-sm px-2 text-sm font-semibold text-brand';

async function copyLink(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The tonal second control of a gym header: Web Share where the browser has it, otherwise the link goes to the clipboard. */
export function ShareButton({ path, title, className }: { path: string; title: string; className?: string }) {
  const toast = useToast();
  const share = async () => {
    const url = `${window.location.origin}${path}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if ((e as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    if (await copyLink(url)) toast.success('Link copied');
    else toast.error('Could not copy the link');
  };
  return (
    <Button variant="secondary" icon={<Share size={18} />} onClick={() => void share()} className={className}>
      Share
    </Button>
  );
}

/** The community route; `communityPath()` in lib/gyms (the `?community=` share form) redirects here. */
export const communityHref = (id: string) => `/communities/${encodeURIComponent(id)}`;

/** What a card hands the detail through router state so the band paints before the fetch lands. */
export type BandPreview = { id?: string; name: string; city?: string; photoUrl?: string };

export const communityLinkState = (c: Community, photoUrl?: string): { gym: BandPreview } => ({
  gym: { id: c._id, name: c.name || 'Community', city: c.vicinity?.trim() || undefined, photoUrl: photoUrl || undefined },
});

/**
 * Member count for a card or a band: `totalMembers` from the details payload,
 * the stored counter from list payloads. Undefined when neither is a number,
 * so nothing ever prints a zero (every community has at least its creator).
 */
export const memberTotalOf = (c?: Community | null): number | undefined => {
  const n = typeof c?.totalMembers === 'number' ? c.totalMembers : c?.stats?.totalMembers;
  return typeof n === 'number' && n > 0 ? n : undefined;
};

/**
 * Cover image for a community. Signed media URLs and managed keys render
 * directly; a Google photo token has to go through the authenticated
 * place-photo proxy, so it is fetched once with the bearer header and served
 * from an object URL (shared across cards).
 */
const placePhotoCache = new Map<string, Promise<string>>();
export function usePlacePhoto(reference: string | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!reference) {
      setUrl('');
      return;
    }
    let active = true;
    let promise = placePhotoCache.get(reference);
    if (!promise) {
      promise = api
        .get('/gyms/place-photo', { params: { reference, maxwidth: 800 }, responseType: 'blob' })
        .then((r) => URL.createObjectURL(r.data as Blob));
      placePhotoCache.set(reference, promise);
      promise.catch(() => placePhotoCache.delete(reference));
    }
    promise.then((u) => active && setUrl(u)).catch(() => active && setUrl(''));
    return () => {
      active = false;
    };
  }, [reference]);
  return url;
}

export function useCommunityCover(community?: CommunityLike | null): string {
  const source = coverSourceOf(community);
  const placeRef = source?.kind === 'place-photo' ? source.reference : null;
  const fetched = usePlacePhoto(placeRef);
  if (!source) return '';
  if (source.kind === 'url') return source.url;
  if (source.kind === 'media-key') return mediaUrl(source.key);
  return fetched;
}

/** Looks a community up by its provider place id (API.md §10): null when none exists yet. */
export function useCommunityAtPlace(placeId: string | null | undefined) {
  return useQuery({
    queryKey: ['community', 'place', placeId],
    enabled: Boolean(placeId),
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data } = await api.get(`/gyms/community/place/${encodeURIComponent(placeId!)}`);
        const c = unwrapCommunity(data);
        return c && isObjectId(c._id) ? c : null;
      } catch (e) {
        if (statusOf(e) === 404) return null;
        throw e;
      }
    },
  });
}

export function Pager({
  page,
  totalPages,
  hasNext,
  onPrev,
  onNext,
  className,
}: {
  page: number;
  totalPages?: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  if (page <= 1 && !hasNext) return null;
  return (
    <nav aria-label="Pagination" className={cx('flex items-center justify-between gap-3', className)}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev} icon={<ChevronLeft size={16} />}>
        Previous
      </Button>
      <span className="tabular text-xs font-semibold text-text-2">
        Page {page}
        {totalPages ? ` of ${Math.max(totalPages, 1)}` : ''}
      </span>
      <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext} iconRight={<ChevronRight size={16} />}>
        Next
      </Button>
    </nav>
  );
}

export function RoleBadge({ role }: { role?: string | null }) {
  if (!role || role === 'member') return null;
  return (
    <Badge tone={isModRole(role) ? 'brand' : 'neutral'}>
      {isModRole(role) ? <Shield size={12} /> : null}
      {humanize(role)}
    </Badge>
  );
}

export function VisibilityBadge({ community }: { community: Community }) {
  const kind = visibilityBadge(community);
  if (!kind) return null;
  return (
    <Badge tone="warning">
      <Lock size={12} />
      {kind === 'private' ? 'Private' : 'Approval'}
    </Badge>
  );
}

/* ------------------------------------------------------------------ join (shared) */

export type JoinOutcome = 'member' | 'pending' | 'none';

type PagedCommunities = { gymCommunities?: Community[] };
const isPagedCommunities = (v: unknown): v is PagedCommunities => Boolean(v && typeof v === 'object' && Array.isArray((v as PagedCommunities).gymCommunities));

/** What a tap on Join will most likely come back as, so the button can read it before the server does. */
export function optimisticJoin(c: Community): { status: JoinOutcome; community: Community } {
  const current = membershipOf(c);
  const status: JoinOutcome = current.pending ? 'none' : visibilityBadge(c) ? 'pending' : 'member';
  const joined = status === 'member';
  const members = typeof c.totalMembers === 'number' ? c.totalMembers + (joined && !current.isMember ? 1 : 0) : c.totalMembers;
  return {
    status,
    community: {
      ...c,
      isMember: joined,
      userRole: joined ? 'member' : null,
      userMembership: { ...(c.userMembership || {}), status, isMember: joined, role: joined ? 'member' : null },
      ...(members !== undefined ? { totalMembers: members } : {}),
    },
  };
}

/**
 * `POST /gyms/community/join { gymId }` joins, requests, or cancels a pending
 * request (a second tap). The server's membership status is the truth: after
 * a cancel it reports `none` and the button simply reads Join again. The tap
 * shows first, though: the detail and every list holding the community are
 * rewritten to the likely outcome and put back if the server refuses.
 */
export function useJoinMutation(onJoined?: (communityId: string, status: JoinOutcome) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (gymId: string) => {
      const { data } = await api.post('/gyms/community/join', { gymId });
      return { gymId, ...(data as { message?: string; membership?: { status?: string } }) };
    },
    onMutate: async (gymId: string) => {
      await qc.cancelQueries({ queryKey: ['community', gymId], exact: true });
      const detail = qc.getQueryData<Community>(['community', gymId]);
      const lists = qc.getQueriesData<unknown>({ queryKey: ['communities'] });
      if (detail?._id) qc.setQueryData<Community>(['community', gymId], optimisticJoin(detail).community);
      qc.setQueriesData<unknown>({ queryKey: ['communities'] }, (old: unknown) =>
        isPagedCommunities(old) ? { ...old, gymCommunities: old.gymCommunities!.map((c) => (c._id === gymId ? optimisticJoin(c).community : c)) } : old,
      );
      return { detail, lists };
    },
    onError: (e, gymId, ctx) => {
      if (ctx?.detail) qc.setQueryData(['community', gymId], ctx.detail);
      for (const [key, data] of ctx?.lists || []) qc.setQueryData(key, data);
      toast.error(errMsg(e, statusOf(e) === 409 ? 'This community is not taking requests right now' : 'Could not update your membership'));
    },
    onSuccess: (data) => {
      const msg = data?.message || '';
      const status = (data.membership?.status as JoinOutcome | undefined) || (/cancel/i.test(msg) ? 'none' : /request|approval|pending/i.test(msg) ? 'pending' : 'member');
      if (status === 'none') toast.info('Request withdrawn');
      else if (status === 'pending') toast.info('Request sent — an admin will review it');
      else toast.success('You joined the community');
      qc.invalidateQueries({ queryKey: ['communities'] });
      qc.invalidateQueries({ queryKey: ['community', data.gymId] });
      qc.invalidateQueries({ queryKey: ['home-gym'] });
      onJoined?.(data.gymId, status);
    },
  });
}

export function JoinButton({
  community,
  mutation,
  block,
  size,
  variant,
}: {
  community: Community;
  mutation: ReturnType<typeof useJoinMutation>;
  block?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Primary only where the button is the screen's one mint control (the band). */
  variant?: 'primary' | 'secondary';
}) {
  const membership = membershipOf(community);
  const busy = mutation.isPending && mutation.variables === community._id;
  const label = joinLabel(community);
  return (
    <Button
      block={block}
      size={size}
      variant={membership.pending ? 'secondary' : variant ?? 'secondary'}
      loading={busy}
      disabled={mutation.isPending && !busy}
      onClick={() => mutation.mutate(community._id)}
      icon={membership.pending ? <X size={16} /> : <Plus size={16} />}
    >
      {label}
    </Button>
  );
}

/* ------------------------------------------------------------------ card */

function CommunityCardSkeleton() {
  return (
    <Card padded={false} className="p-3" aria-hidden="true">
      <Skeleton className="aspect-video w-full rounded-md" />
      <div className="mt-3 space-y-2 px-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-6 w-24 rounded-xs" />
      </div>
    </Card>
  );
}

function CommunityCard({ community, action }: { community: Community; action?: ReactNode }) {
  const cover = useCommunityCover(community);
  const members = memberTotalOf(community);
  const membership = membershipOf(community);
  const place = community.vicinity?.trim();
  return (
    <Card padded={false} container interactive className="relative flex flex-col p-3">
      <Link
        to={communityHref(community._id)}
        state={communityLinkState(community, cover)}
        viewTransition
        aria-label={`Open ${community.name || 'community'}`}
        className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <CardMedia ratio="16/9">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-text-3">
            <Users size={28} />
          </span>
        )}
      </CardMedia>
      <div className="mt-3 flex-1 space-y-1 px-1">
        <h2 className="truncate text-md font-semibold text-text-1">{community.name || 'Community'}</h2>
        {place ? (
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-text-2">
            <MapPin size={13} className="shrink-0 text-text-3" />
            <span className="truncate">{place}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {members ? (
            <Badge tone="neutral">
              <Users size={12} />
              <span className="tabular">{memberCountLabel(members)}</span>
            </Badge>
          ) : null}
          {community.category && community.category !== 'gym' ? <Badge tone="neutral">{humanize(community.category)}</Badge> : null}
          <VisibilityBadge community={community} />
          {membership.isMember ? <RoleBadge role={membership.role} /> : null}
          {membership.pending ? (
            <Badge tone="info">
              <Clock size={12} />
              Request pending
            </Badge>
          ) : null}
        </div>
      </div>
      {action ? <div className="relative z-[2] mt-3 border-t border-line pt-3">{action}</div> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ create */

type LocationChoice = 'current' | 'place' | 'global';

/**
 * The create form. API.md §10: the place id is echoed verbatim, `vicinity` is
 * passed through unchanged, the creator auto-joins as admin, and a 409 on a
 * create that carried a placeId means someone else got there first — re-query
 * the place and open theirs instead of retrying.
 */
export function CreateCommunityModal({
  open,
  preset,
  onClose,
  onCreated,
}: {
  open: boolean;
  preset?: CommunityPreset | null;
  onClose: () => void;
  onCreated: (community: Community) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [requireApproval, setRequireApproval] = useState(false);
  const [maxMembers, setMaxMembers] = useState('1000');
  const [locationChoice, setLocationChoice] = useState<LocationChoice>('global');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [cover, setCover] = useState<{ key: string; preview: string; width?: number; height?: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(preset?.name || '');
    setDescription('');
    setVisibility('public');
    setRequireApproval(false);
    setMaxMembers('1000');
    setLocationChoice(preset?.placeId || preset?.location ? 'place' : 'global');
    setCoords(null);
    setLocateError(null);
    setCover(null);
    setTouched(false);
  }, [open, preset]);

  const nameError = touched ? communityNameError(name) : null;
  const membersError = maxMembersError(maxMembers);
  const canSubmit = !communityNameError(name) && !membersError && !uploading && !(locationChoice === 'current' && !coords);
  const atPlace = locationChoice === 'place' && Boolean(preset?.placeId || preset?.location);

  const locate = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocateError('Location is not available in this browser. Pick Global or search a place on the Gyms page.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: Number(pos.coords.latitude.toFixed(5)), longitude: Number(pos.coords.longitude.toFixed(5)) });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocateError(err.code === 1 ? 'Location is blocked for this site. Allow it in the browser’s site settings, or choose Global.' : 'Your position could not be determined. Try again or choose Global.');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  };

  useEffect(() => {
    if (open && locationChoice === 'current' && !coords && !locating && !locateError) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locationChoice]);

  async function onCoverChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('Use a JPEG, PNG, WebP or HEIC photo for the cover.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('The cover photo is over 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadOwnedMedia(file);
      const preview = URL.createObjectURL(file);
      const dims = await new Promise<{ width?: number; height?: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({});
        img.src = preview;
      });
      setCover((prev) => {
        if (prev) URL.revokeObjectURL(prev.preview);
        return { key: uploaded.key, preview, ...dims };
      });
    } catch (err) {
      toast.error(errMsg(err, 'Cover upload failed.'));
    } finally {
      setUploading(false);
    }
  }

  const create = useMutation({
    mutationFn: async () => {
      const location =
        locationChoice === 'current' && coords
          ? coords
          : atPlace && preset?.location
            ? preset.location
            : undefined;
      const placeId = atPlace ? preset?.placeId : undefined;
      // vicinity travels verbatim from the place search (API.md §10a): the
      // server stores exactly what it is sent and never derives one.
      const vicinity = atPlace ? preset?.vicinity?.trim() : undefined;
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        settings: {
          isPublic: visibility === 'public',
          requireApproval: visibility === 'private' ? true : requireApproval,
          maxMembers: Number(maxMembers),
        },
        ...(location ? { location } : {}),
        ...(placeId ? { placeId } : {}),
        ...(vicinity ? { vicinity } : {}),
        ...(cover ? { photos: [{ photoReference: cover.key, ...(cover.width ? { width: cover.width } : {}), ...(cover.height ? { height: cover.height } : {}) }] } : {}),
      };
      try {
        const { data } = await api.post('/gyms/community/join', body);
        return { kind: 'created' as const, community: unwrapCommunity(data) };
      } catch (e) {
        // Keyed on the call we made (a create with a placeId), never on the
        // message text: one community per place, first commit wins.
        if (statusOf(e) === 409 && placeId) {
          const { data } = await api.get(`/gyms/community/place/${encodeURIComponent(placeId)}`);
          const existing = unwrapCommunity(data);
          if (existing && isObjectId(existing._id)) return { kind: 'exists' as const, community: existing };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['communities'] });
      if (result.kind === 'exists') {
        qc.setQueryData(['community', 'place', preset?.placeId], result.community);
        toast.info(`${result.community.name || 'A community'} already exists here — you can join it`);
        onClose();
        navigate(communityHref(result.community._id), { viewTransition: true });
        return;
      }
      qc.invalidateQueries({ queryKey: ['community', 'place'] });
      toast.success(`${result.community.name || 'Your community'} is live`);
      onCreated(result.community);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create the community')),
  });

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={preset?.name ? `Start the community at ${preset.name}` : 'Start a community'}
      description="A home for the people you train with. You become its first admin."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={create.isPending} disabled={touched && !canSubmit}>
            Create community
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={(e) => void onCoverChange(e)} />
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={cover ? 'Change cover photo' : 'Add a cover photo'}
            className="relative flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-line-strong bg-surface-2 text-text-2 transition-colors dur-1 hover:border-text-3 hover:text-text-1"
          >
            {cover ? <img src={cover.preview} alt="" className="h-full w-full object-cover" /> : uploading ? <Spinner size={22} /> : <ImageIcon size={24} />}
          </button>
          <div className="min-w-0 flex-1 text-sm text-text-2">
            <p className="font-semibold text-text-1">Cover photo</p>
            <p className="mt-0.5 text-xs">Optional. A wide photo of the gym or the crew works best (JPEG, PNG, WebP or HEIC, up to 10 MB).</p>
            {cover ? (
              <button type="button" onClick={() => setCover((c) => (c && URL.revokeObjectURL(c.preview), null))} className="btn btn-link mt-1 text-xs text-danger">
                Remove photo
              </button>
            ) : null}
          </div>
        </div>

        <Input
          label="Community name"
          value={name}
          maxLength={COMMUNITY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          error={nameError || undefined}
          hint={nameError ? undefined : 'Usually the gym’s name, e.g. “Iron Works Bethlehem”.'}
          autoComplete="off"
          required
        />
        <Textarea
          label="Description"
          hint={`Optional. What the crew is about, when you train, house rules. ${description.length}/${COMMUNITY_DESCRIPTION_MAX}`}
          rows={3}
          autoGrow
          maxLength={COMMUNITY_DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <RadioGroup
          label="Who can join"
          value={visibility}
          onChange={(v) => setVisibility(v as 'public' | 'private')}
          options={[
            { value: 'public', label: 'Public', description: 'Anyone on Vybe can find it and see posts.' },
            { value: 'private', label: 'Private', description: 'Hidden from Explore; people request to join and admins approve.' },
          ]}
        />
        {visibility === 'public' ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-text-1">Approve new members</p>
              <p className="text-xs text-text-2">Requests wait for an admin instead of joining instantly.</p>
            </div>
            <Switch checked={requireApproval} onChange={setRequireApproval} label="Approve new members" />
          </div>
        ) : null}

        <Input
          label="Maximum members"
          type="number"
          inputMode="numeric"
          min={2}
          max={10000}
          value={maxMembers}
          onChange={(e) => setMaxMembers(e.target.value)}
          error={touched && membersError ? membersError : undefined}
          hint={touched && membersError ? undefined : 'Between 2 and 10,000. You can raise it later.'}
          containerClassName="max-w-48"
        />

        <RadioGroup
          label="Location"
          value={locationChoice}
          onChange={(v) => setLocationChoice(v as LocationChoice)}
          options={[
            ...(preset?.placeId || preset?.location
              ? [{ value: 'place', label: preset.name ? `At ${preset.name}` : 'At the selected place', description: preset.vicinity || 'The place you picked on the Gyms page — people searching for it find this community.' }]
              : []),
            { value: 'current', label: 'My current position', description: 'Puts the community on the map for people training nearby.' },
            { value: 'global', label: 'Global', description: 'No fixed place; anyone anywhere can join.' },
          ]}
        />
        {locationChoice === 'current' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {coords ? (
              <span className="inline-flex items-center gap-1.5 text-text-2">
                <MapPin size={16} className="text-brand" />
                Position captured ({coords.latitude.toFixed(3)}, {coords.longitude.toFixed(3)})
              </span>
            ) : (
              <Button variant="secondary" size="sm" loading={locating} onClick={locate} icon={<MapPin size={16} />}>
                Use my location
              </Button>
            )}
            {locateError ? <p role="alert" className="w-full text-xs text-danger">{locateError}</p> : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ page */

export default function GymCommunity() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: ListTab = tabParam === 'mine' ? 'mine' : 'explore';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 400);
  const location = useLocation();
  const navigate = useNavigate();

  // "Start a community here" from the Gyms page arrives with a preset in
  // router state; the form opens with it and the state is cleared so a reload
  // does not reopen the form.
  const preset = (location.state as { startCommunity?: CommunityPreset } | null)?.startCommunity || null;
  const [creating, setCreating] = useState<boolean>(() => Boolean(preset));
  const [presetForForm, setPresetForForm] = useState<CommunityPreset | null>(preset);
  useEffect(() => {
    if (preset) {
      setPresetForForm(preset);
      setCreating(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const changeTab = (next: string) => {
    setPage(1);
    setParams(
      (prev) => {
        if (next === 'mine') prev.set('tab', 'mine');
        else prev.delete('tab');
        return prev;
      },
      { replace: true },
    );
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const startCommunity = (withPreset: CommunityPreset | null = null) => {
    setPresetForForm(withPreset);
    setCreating(true);
  };

  const explore = useQuery({
    queryKey: ['communities', 'explore', page, debounced],
    enabled: tab === 'explore',
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/explore', {
        params: { page, limit: PAGE, search: debounced || undefined },
      });
      return data.data as Paged<Community>;
    },
  });

  const mine = useQuery({
    queryKey: ['communities', 'mine', page, debounced],
    enabled: tab === 'mine',
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/my-communities', {
        params: { page, limit: PAGE, search: debounced || undefined },
      });
      return data.data as Paged<Community>;
    },
  });

  const exploreEmpty = tab === 'explore' && explore.isSuccess && (explore.data?.gymCommunities?.length || 0) === 0 && !debounced;
  // Tells apart "nothing exists" from "you joined everything": the empty
  // Explore copy must not claim the app is empty to someone in three crews.
  const mineCount = useQuery({
    queryKey: ['communities', 'mine', 'count'],
    enabled: exploreEmpty,
    queryFn: async () => {
      const { data } = await api.get('/gyms/community/my-communities', { params: { page: 1, limit: 1 } });
      return Number(data.data?.pagination?.totalGymCommunities ?? data.data?.gymCommunities?.length ?? 0);
    },
  });

  const join = useJoinMutation();

  const active = tab === 'explore' ? explore : mine;
  const communities = useMemo(() => active.data?.gymCommunities || [], [active.data]);
  const pagination = active.data?.pagination;

  // Share links from the app land as /communities?community=<id>; the detail is a route now.
  const shared = params.get('community');
  if (shared && isObjectId(shared)) return <Navigate to={communityHref(shared)} replace />;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Communities"
        subtitle="The crews built around a gym. Join one, or start the first."
        actions={
          <button type="button" className={TEXT_ACTION} onClick={() => startCommunity()}>
            Start a community
          </button>
        }
        mobileActions={
          <IconButton label="Start a community" onClick={() => startCommunity()}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <div className="@container">
        <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
        <SegmentedControl
          aria-label="Community lists"
          tabs={[
            { value: 'explore', label: 'Explore' },
            { value: 'mine', label: 'My communities' },
          ]}
          value={tab}
          onChange={changeTab}
          className="@md:w-72"
        />
        <SearchField
          label={tab === 'mine' ? 'Search my communities' : 'Search communities'}
          hideLabel
          placeholder={tab === 'mine' ? 'Search your communities' : 'Search by gym or community name'}
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
          containerClassName="flex-1"
        />
        </div>
      </div>

      {active.isLoading ? (
        <CardGrid min="18rem" aria-busy="true" aria-label="Loading communities">
          {Array.from({ length: 6 }).map((_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </CardGrid>
      ) : null}

      {active.isError ? <ErrorState error={active.error} onRetry={() => active.refetch()} /> : null}

      {active.isSuccess && communities.length === 0 ? (
        tab === 'mine' ? (
          debounced ? (
            <EmptyState
              variant="no-results"
              title={`None of your communities match “${debounced}”`}
              message="Try another name, or clear the search to see them all."
              action={{ label: 'Clear search', onClick: () => changeSearch(''), variant: 'secondary' }}
            />
          ) : (
            <EmptyState
              family="community"
              title="Join the crew at your gym"
              message="Communities are built around gyms. Find yours on the Gyms page and join its community, or start the first one there."
              action={{ label: 'Find your gym', to: '/gyms', variant: 'secondary', icon: <MapPin size={18} /> }}
              secondaryAction={{ label: 'Explore communities', onClick: () => changeTab('explore') }}
            />
          )
        ) : debounced ? (
          <EmptyState
            variant="no-results"
            title={`No communities match “${debounced}”`}
            message="Check the spelling, or start a community with that name — you become its first admin."
            action={{ label: `Start “${debounced}”`, onClick: () => startCommunity({ name: debounced }), variant: 'secondary', icon: <Plus size={16} /> }}
            secondaryAction={{ label: 'Clear search', onClick: () => changeSearch('') }}
          />
        ) : mineCount.isSuccess && mineCount.data > 0 ? (
          <EmptyState
            icon={<Check size={26} />}
            title="You have joined every community we could find"
            message={`You are in ${pluralize(mineCount.data, 'community', 'communities')}. Start one for a gym that has none yet, or invite friends to yours.`}
            action={{ label: 'Go to My communities', onClick: () => changeTab('mine'), variant: 'secondary' }}
            secondaryAction={{ label: 'Find a gym', to: '/gyms' }}
          />
        ) : mineCount.isLoading ? (
          <CardGrid min="18rem" aria-busy="true" aria-label="Loading communities">
            {Array.from({ length: 3 }).map((_, i) => (
              <CommunityCardSkeleton key={i} />
            ))}
          </CardGrid>
        ) : (
          <EmptyState
            family="community"
            title="Start the first community at your gym"
            message="Search for the place you train at, pick it from the map, and its community is live in a minute — you are its first admin."
            action={{ label: 'Search for your gym', to: '/gyms', variant: 'secondary', icon: <MapPin size={18} /> }}
          />
        )
      ) : null}

      {communities.length > 0 ? (
        <>
          <CardGrid min="18rem">
            {communities.map((c) => {
              const membership = membershipOf(c);
              return <CommunityCard key={c._id} community={c} action={!membership.isMember ? <JoinButton community={c} mutation={join} block /> : null} />;
            })}
          </CardGrid>
          <Pager
            page={pagination?.currentPage ?? page}
            totalPages={pagination?.totalPages}
            hasNext={Boolean(pagination?.hasNext)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </>
      ) : null}

      <CreateCommunityModal
        open={creating}
        preset={presetForForm}
        onClose={() => setCreating(false)}
        onCreated={(community) => {
          setCreating(false);
          if (community?._id) navigate(communityHref(community._id), { viewTransition: true });
        }}
      />
    </div>
  );
}
