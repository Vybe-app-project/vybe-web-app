import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { type User, useAuth } from '../lib/auth';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  type Post,
  type PublicUser,
  type UploadedMedia,
  displayName,
  extractHashtags,
  uploadImage,
  useDebounced,
} from '../lib/hooks';
import { communityPath, coverSourceOf, founderIdOf, isModRole, isObjectId, membershipOf } from '../lib/gyms';
import { type GymBandGym, memberCountLabel, trainingTodayLine } from '../components/GymBand';
import { GymHeader } from '../components/GymHeader';
import { MapTile, osmHref } from '../components/MapTile';
import PostCard, { PostCardSkeleton } from './PostCard';
import UserRow, { FollowButton, UserRowSkeleton } from './UserRow';
import { ContextualInviteButton } from './InviteLinkSheet';
import {
  type ActiveThisWeek,
  type BandPreview,
  type Community,
  type CommunityMember,
  JoinButton,
  Pager,
  type PublicActor,
  RoleBadge,
  ShareButton,
  type TrainedToday,
  VisibilityBadge,
  ago,
  hoursLine,
  memberTotalOf,
  nameOf,
  statusOf,
  unwrapCommunity,
  useActiveThisWeek,
  useCommunityCover,
  useJoinMutation,
  usePlaceHours,
  useTrainedToday,
  zoneOf,
} from './GymCommunity';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardGrid,
  CardMedia,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Menu,
  PageHeader,
  SearchField,
  Skeleton,
  SkeletonRow,
  Spinner,
  Tabs,
  Textarea,
  cx,
  formatStat,
  humanize,
  useToast,
  type MenuItem,
} from './ui';
import { Activity, Calendar, Check, Clock, Dashboard, ExternalLink, Image as ImageIcon, Info, Lock, MapPin, MessageCircle, Plus, Shield, Trash, Users, X } from './icons';

/* ------------------------------------------------------------------ the tab strip under the header */

export type GymTab = 'feed' | 'today' | 'members' | 'about';
const GYM_TABS: { key: GymTab; label: string; Icon: typeof Dashboard }[] = [
  { key: 'feed', label: 'Feed', Icon: Dashboard },
  { key: 'today', label: 'Today', Icon: Activity },
  { key: 'members', label: 'Members', Icon: Users },
  { key: 'about', label: 'About', Icon: Info },
];
export const isGymTab = (v: string | null): v is GymTab => !!v && GYM_TABS.some((t) => t.key === v);
export const gymTabHref = (pathname: string, tab: GymTab) => (tab === 'feed' ? pathname : `${pathname}?tab=${tab}`);

/**
 * Feed · Today · Members · About: the gym page's one tab row, Instagram's
 * profile strip. Each tab is a real link (`?tab=`) so a tab can be shared and
 * stepped back through; the underline slides between them on `transform`.
 * Icons join the labels from `sm`, where four of each fit on one line. A
 * count rides on a tab only when it is a real integer above zero.
 */
export function GymTabs({ pathname, active, counts }: { pathname: string; active: GymTab; counts?: Partial<Record<GymTab, number>> }) {
  return (
    <Tabs
      aria-label="Gym sections"
      fill
      active={active}
      tabs={GYM_TABS.map((t) => {
        const count = counts?.[t.key];
        return {
          key: t.key,
          label: t.label,
          icon: <t.Icon size={18} className="hidden sm:inline" aria-hidden="true" />,
          to: gymTabHref(pathname, t.key),
          ...(typeof count === 'number' && Number.isFinite(count) && count > 0 ? { count } : {}),
        };
      })}
    />
  );
}

/* ------------------------------------------------------------------ types */

type Leaderboard = {
  range?: { key?: string; weekKey?: string; start?: string; end?: string; timezone?: string; timezoneSource?: 'community' | 'default' | string; resetsOn?: string };
  today?: { localDay?: string; activeMembers?: number; activeMembersLabel?: string };
  me?: { sessions?: number; rank?: number | null; optedIn?: boolean };
  entries?: { user?: PublicUser; sessions?: number; rank?: number }[];
};

type CommunityEvent = {
  _id: string;
  title?: string;
  startsAt?: string;
  startsAtLocal?: string;
  timezone?: string;
  goingCount?: number;
  spotsLeft?: number | null;
  isFull?: boolean;
  myRsvp?: string | boolean | null;
  locationNote?: string;
};

type MembershipRequest = {
  _id: string;
  requestedAt?: string;
  user?: PublicUser;
};

const POST_MAX_CHARS = 2200;
const POST_MAX_IMAGES = 4;

/* ------------------------------------------------------------------ mapping (API.md §2) */

const coordsOf = (c?: Community | null): { lat: number; lng: number } | undefined => {
  const lat = c?.location?.latitude;
  const lng = c?.location?.longitude;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
};

/** The band's gym from the details payload. Absent data stays absent; the band omits it. */
export function bandGymOf(c: Community, photoUrl: string, sessionsTodayLabel?: string): GymBandGym {
  const rating = c.googleMapsData?.rating;
  const people = (c.members || [])
    .map((m) => m.user)
    .filter((u): u is PublicUser => Boolean(u && u._id))
    .slice(0, 4)
    .map((u) => ({ id: String(u._id), name: displayName(u), avatar: u.avatar }));
  return {
    id: c._id,
    name: c.name || 'Community',
    city: c.vicinity?.trim() || undefined,
    photoUrl: photoUrl || undefined,
    memberCount: memberTotalOf(c),
    rating: typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? rating : null,
    coords: coordsOf(c),
    people: people.length ? people : undefined,
    sessionsTodayLabel,
  };
}

const homeCommunityIdOf = (me: User | null | undefined): string | null => {
  const h = (me as { homeGym?: { community?: string | { _id?: string } | null } | null } | null)?.homeGym?.community;
  if (!h) return null;
  return typeof h === 'string' ? h : h._id || null;
};

/** Event times are rendered in the event's own zone, never the viewer's (API.md §11b). */
function eventWhen(e: CommunityEvent): string {
  const d = e.startsAt ? new Date(e.startsAt) : null;
  if (d && !Number.isNaN(d.getTime())) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        ...(e.timezone ? { timeZone: e.timezone, timeZoneName: 'short' } : {}),
      }).format(d);
    } catch {
      /* unknown zone id: fall through to the server's local string */
    }
  }
  return e.startsAtLocal || '';
}

function rangeLabel(range?: Leaderboard['range']): string | null {
  if (!range?.start || !range?.end || range.timezoneSource !== 'community' || !range.timezone) return null;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: range.timezone }).format(d);
    } catch {
      return '';
    }
  };
  const a = fmt(range.start);
  const b = fmt(range.end);
  return a && b ? `Week of ${a} – ${b}, in the gym’s time` : null;
}

/* ------------------------------------------------------------------ composer */

function CommunityComposer({
  communityId,
  communityName,
  onPosted,
  onCancel,
}: {
  communityId: string;
  communityName: string;
  onPosted: () => void;
  onCancel: () => void;
}) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [content, setContent] = useState('');
  const [medias, setMedias] = useState<UploadedMedia[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const dirty = content.trim().length > 0 || medias.length > 0;

  const create = useMutation({
    mutationFn: async () => {
      const text = content.trim();
      const { data } = await api.post('/posts/create', {
        content: text,
        medias: medias.map((m) => ({ type: m.type, key: m.key, url: m.url })),
        hashtags: extractHashtags(text),
        community: communityId,
      });
      return data;
    },
    onSuccess: () => {
      previews.forEach((u) => URL.revokeObjectURL(u));
      toast.success(`Posted to ${communityName}`);
      qc.invalidateQueries({ queryKey: ['community', communityId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      onPosted();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not post to this community')),
  });

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = POST_MAX_IMAGES - medias.length;
    if (room <= 0) {
      toast.error(`Up to ${POST_MAX_IMAGES} photos per post.`);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`${file.name}: use a JPEG, PNG, WebP or HEIC photo.`);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`${file.name} is over 10 MB.`);
          continue;
        }
        const uploaded = await uploadImage(file, 'posts');
        setMedias((prev) => [...prev, uploaded]);
        setPreviews((prev) => [...prev, URL.createObjectURL(file)]);
      }
    } catch (e) {
      toast.error(errMsg(e, 'Photo upload failed.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const remaining = POST_MAX_CHARS - content.length;
  return (
    <Card role="form" aria-label={`New post in ${communityName}`}>
      <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => void addFiles(e.target.files)} />
      <div className="flex gap-3">
        <Avatar src={me?.avatar} name={me?.fullName || me?.username || 'You'} size="sm" className="mt-1 hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <Textarea
            label={`What’s happening at ${communityName}?`}
            hideLabel
            autoFocus
            autoGrow
            rows={3}
            maxRows={10}
            maxLength={POST_MAX_CHARS}
            placeholder={`Share a session, a PR or a meetup with ${communityName}…`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={create.isPending}
          />
          {previews.length > 0 || uploading ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attached photos">
              {previews.map((src, i) => (
                <li key={src} className="relative h-20 w-20 overflow-hidden rounded-md bg-surface-2">
                  <img src={src} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => {
                      setMedias((prev) => prev.filter((_, j) => j !== i));
                      setPreviews((prev) => {
                        URL.revokeObjectURL(prev[i]);
                        return prev.filter((_, j) => j !== i);
                      });
                    }}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-scrim text-[var(--navy-50)] hover:bg-danger"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
              {uploading ? (
                <li className="grid h-20 w-20 place-items-center rounded-md bg-surface-2 text-text-2" aria-label="Uploading">
                  <Spinner size={20} />
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" icon={<ImageIcon size={18} />} onClick={() => fileRef.current?.click()} disabled={uploading || medias.length >= POST_MAX_IMAGES || create.isPending}>
              Photo
            </Button>
            {content.length > 0 ? (
              <span className={cx('tabular text-xs', remaining < 100 ? 'text-warning-text' : 'text-text-3')} aria-live="polite">
                {remaining} left
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={create.isPending}>
                Cancel
              </Button>
              <Button variant="secondary" size="sm" onClick={() => create.mutate()} disabled={!dirty || uploading || create.isPending} loading={create.isPending}>
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ members */

function MemberRow({
  member,
  community,
  viewerId,
  viewerRole,
  onChanged,
}: {
  member: CommunityMember;
  community: Community;
  viewerId?: string;
  viewerRole: string | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | 'remove' | 'transfer'>(null);
  const user = member.user;
  const userId = user?._id ? String(user._id) : undefined;
  const name = nameOf(user);
  const founderId = founderIdOf(community);
  const isFounderRow = Boolean(userId && founderId && userId === founderId);
  const viewerIsFounder = Boolean(viewerId && founderId && viewerId === founderId);
  const viewerIsAdmin = viewerRole === 'admin';
  const isSelf = Boolean(userId && viewerId && userId === viewerId);
  const role = String(member.role || 'member');

  const setRole = useMutation({
    mutationFn: async (body: { role: string; transferOwnership?: boolean }) => {
      const { data } = await api.patch(`/gyms/community/${community._id}/members/${userId}/role`, body);
      return data as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Member role updated');
      setConfirm(null);
      onChanged();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not change this role'));
      setConfirm(null);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/gyms/community/${community._id}/members/${userId}`);
    },
    onSuccess: () => {
      toast.success(`${name} was removed`);
      setConfirm(null);
      onChanged();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not remove this member'));
      setConfirm(null);
    },
  });

  if (!user || !userId) return null;

  const items: MenuItem[] = [];
  if (!isSelf && !isFounderRow && viewerRole && isModRole(viewerRole)) {
    if (viewerIsAdmin && role === 'member') items.push({ label: 'Make moderator', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'moderator' }) });
    if (viewerIsAdmin && role === 'moderator') items.push({ label: 'Remove moderator', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'member' }) });
    if (viewerIsFounder && role !== 'admin') items.push({ label: 'Make admin', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'admin' }) });
    if (viewerIsFounder && role === 'admin') items.push({ label: 'Remove admin', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'member' }) });
    if (viewerIsFounder) items.push({ label: 'Transfer ownership', description: 'They become the founder; you stay an admin.', icon: <Users size={18} />, onSelect: () => setConfirm('transfer'), divider: true });
    const canRemove = role === 'member' || (role === 'moderator' && viewerIsAdmin) || (role === 'admin' && viewerIsFounder);
    if (canRemove) items.push({ label: 'Remove from community', icon: <Trash size={18} />, danger: true, onSelect: () => setConfirm('remove'), divider: items.length > 0 });
  }

  const rowUser: PublicUser = { ...user, _id: userId, isFollowing: member.isFollowing ?? user.isFollowing };
  return (
    <li>
      <UserRow
        user={rowUser}
        below={
          member.joinedAt || isFounderRow || role !== 'member' ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-3">
              {isFounderRow ? (
                <Badge tone="brand">
                  <Shield size={12} />
                  Founder
                </Badge>
              ) : (
                <RoleBadge role={role} />
              )}
              {member.joinedAt ? <span>Joined {ago(member.joinedAt)}</span> : null}
            </div>
          ) : null
        }
        trailing={
          <span className="flex items-center gap-1">
            <FollowButton user={rowUser} size="sm" />
            {items.length ? <Menu items={items} label={`Manage ${name}`} /> : null}
          </span>
        }
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        title={`Remove ${name}?`}
        message="They leave the community immediately and can ask to join again later."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'transfer'}
        title={`Make ${name} the founder?`}
        message="They take over the community. You keep admin rights and can leave whenever you like."
        confirmLabel="Transfer ownership"
        loading={setRole.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => setRole.mutate({ role: 'admin', transferOwnership: true })}
      />
    </li>
  );
}

/* ------------------------------------------------------------------ events */

function EventRow({ event }: { event: CommunityEvent }) {
  const when = eventWhen(event);
  const going = typeof event.goingCount === 'number' && event.goingCount > 0 ? event.goingCount : null;
  const spots = typeof event.spotsLeft === 'number' && event.spotsLeft > 0 ? event.spotsLeft : null;
  const mine = event.myRsvp === true || event.myRsvp === 'going' || event.myRsvp === 'yes';
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
        <Calendar size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-1">{event.title || 'Session'}</p>
        {when ? <p className="text-xs text-text-2">{when}</p> : null}
        {event.locationNote ? <p className="truncate text-xs text-text-3">{event.locationNote}</p> : null}
        {going || spots || event.isFull || mine ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {mine ? (
              <Badge tone="brand">
                <Check size={12} />
                You’re going
              </Badge>
            ) : null}
            {going ? <Badge tone="neutral">{going === 1 ? '1 going' : `${formatStat(going)} going`}</Badge> : null}
            {event.isFull ? <Badge tone="warning">Full</Badge> : spots ? <Badge tone="neutral">{spots === 1 ? '1 spot left' : `${spots} spots left`}</Badge> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Organisers plan a session; the device zone travels with it (API.md §11b) so the community gets a zone. */
function PlanSessionForm({ communityId, onPlanned }: { communityId: string; onPlanned: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [note, setNote] = useState('');
  const plan = useMutation({
    mutationFn: async () => {
      const when = new Date(startsAt);
      const { data } = await api.post(`/gyms/community/${communityId}/events`, {
        title: title.trim(),
        startsAt: when.toISOString(),
        timezone: zoneOf(),
        ...(note.trim() ? { locationNote: note.trim() } : {}),
      });
      return data as { message?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Session planned');
      setTitle('');
      setStartsAt('');
      setNote('');
      setOpen(false);
      onPlanned();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not plan the session')),
  });
  const valid = title.trim().length >= 2 && startsAt && !Number.isNaN(new Date(startsAt).getTime());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) plan.mutate();
  };
  if (!open) {
    return (
      <Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
        Plan a session
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-md bg-surface-2 p-3" aria-label="Plan a session">
      <Input label="What" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saturday squad, deadlift day…" maxLength={120} required autoFocus />
      <div className="grid gap-3 @sm:grid-cols-2">
        <Input label="When" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required hint={`Times are saved in ${zoneOf().replace(/_/g, ' ')}.`} />
        <Input label="Where in the gym" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — the racks, studio 2…" maxLength={200} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={plan.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" size="sm" loading={plan.isPending} disabled={!valid}>
          Plan it
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ the surface (shared by /communities/:id and a linked /gyms/:id) */

export function CommunitySurface({
  communityId,
  preview,
  aboutExtra,
  back = '/communities',
}: {
  communityId: string;
  /** Band data from the card that linked here, painted while the fetch is in flight. */
  preview?: BandPreview | null;
  /** Extra About content (the directory gym's ratings and reviews on /gyms/:id). */
  aboutExtra?: ReactNode;
  back?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const tab: GymTab = isGymTab(params.get('tab')) ? (params.get('tab') as GymTab) : 'feed';
  const me = useAuth((s) => s.user);
  const [memberPage, setMemberPage] = useState(1);
  const [memberSearch, setMemberSearch] = useState('');
  const debouncedMemberSearch = useDebounced(memberSearch.trim(), 350);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    setMemberPage(1);
    setComposing(false);
  }, [communityId]);

  const detail = useQuery({
    queryKey: ['community', communityId],
    retry: (count, error) => statusOf(error) !== 404 && count < 2,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}`);
      return unwrapCommunity(data);
    },
  });
  const community = detail.data;
  const name = community?.name || preview?.name || 'Community';
  const membership = membershipOf(community);
  const canModerate = membership.isMember && isModRole(membership.role);
  const notFound = detail.isError && statusOf(detail.error) === 404;
  const isPrivateToViewer = community?.settings?.isPublic === false && !membership.isMember;
  const founderId = founderIdOf(community);
  const viewerIsFounder = Boolean(me?._id && founderId && String(me._id) === founderId);
  const isHome = homeCommunityIdOf(me) === communityId;

  // Members only (403 MEMBERSHIP_REQUIRED otherwise); the "training today"
  // figure is the server's string and is hidden on any failure.
  const leaderboard = useQuery({
    queryKey: ['community', communityId, 'leaderboard', 'this'],
    enabled: detail.isSuccess && membership.isMember,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/leaderboard`, { params: { week: 'this' } });
      return (data.data || data) as Leaderboard;
    },
  });
  const todayLabel = leaderboard.data?.today?.activeMembersLabel;

  // The exact figures (additive routes, 2026-09-20): who trained today and who
  // was active this week, for anyone who may see the community. A 404 is "no
  // figure" — the leaderboard's string then stands in for members — and a
  // count of 0 draws nothing.
  const activityEnabled = detail.isSuccess && !isPrivateToViewer;
  const activeThisWeek = useActiveThisWeek(communityId, activityEnabled);
  const trainedToday = useTrainedToday(communityId, activityEnabled);
  const hours = usePlaceHours(community?.placeId, tab === 'about');

  const events = useQuery({
    queryKey: ['community', communityId, 'events', 'upcoming'],
    enabled: detail.isSuccess && tab === 'today' && !isPrivateToViewer,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/events`, { params: { range: 'upcoming', limit: 5 } });
      return (data.events || data.data?.events || []) as CommunityEvent[];
    },
  });

  const members = useQuery({
    queryKey: ['community', communityId, 'members', memberPage, debouncedMemberSearch],
    enabled: detail.isSuccess && tab === 'members' && !isPrivateToViewer,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/members`, {
        params: { page: memberPage, limit: 20, search: debouncedMemberSearch || undefined },
      });
      return (data.data || data) as {
        members: CommunityMember[];
        pagination?: { currentPage: number; totalPages: number; hasNext: boolean; totalMembers?: number };
      };
    },
  });

  const requests = useQuery({
    queryKey: ['community', communityId, 'requests'],
    enabled: canModerate,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/membership-requests`, { params: { limit: 50 } });
      return (data.requests || data.data?.requests || []) as MembershipRequest[];
    },
  });

  const posts = useQuery({
    queryKey: ['community', communityId, 'posts'],
    enabled: detail.isSuccess && tab === 'feed' && !isPrivateToViewer,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/posts/gym/community/posts/all/${communityId}`, { params: { page: 1, limit: 20 } });
      return (data.posts || []) as Post[];
    },
  });

  const invalidateCommunity = () => {
    qc.invalidateQueries({ queryKey: ['community', communityId] });
    qc.invalidateQueries({ queryKey: ['communities'] });
  };

  const approve = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/gyms/community/${communityId}/membership-requests/${requestId}/approve`);
    },
    onSuccess: () => {
      toast.success('Member approved');
      invalidateCommunity();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not approve the request')),
  });

  const deny = useMutation({
    mutationFn: async (requestId: string) => {
      await api.delete(`/gyms/community/${communityId}/membership-requests/${requestId}`);
    },
    onSuccess: () => {
      toast.success('Request declined');
      qc.invalidateQueries({ queryKey: ['community', communityId, 'requests'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not decline the request')),
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete(`/gyms/community/${communityId}/membership`);
      return data as { message?: string; newFounder?: string };
    },
    onSuccess: (data) => {
      toast.success(data?.newFounder ? 'You left and handed the community to the next admin' : 'You left the community');
      setConfirmLeave(false);
      invalidateCommunity();
      qc.invalidateQueries({ queryKey: ['home-gym'] });
      navigate('/communities', { viewTransition: true });
    },
    onError: (e) => {
      // The founder case comes back with the step that unblocks it; keep the
      // page where the Members tab is one tap away.
      toast.error(errMsg(e, 'Could not leave the community'));
      setConfirmLeave(false);
    },
  });

  // Home gym: PUT /users/settings { homeGym: { community } } (API.md §1). The
  // account in the auth store is the shell's source of truth, so it is updated
  // first and rolled back if the server refuses.
  const setHome = useMutation({
    mutationFn: async () => {
      const { data } = await api.put('/users/settings', { homeGym: { community: communityId } });
      return (data.user || data) as User;
    },
    onMutate: () => {
      const prev = useAuth.getState().user;
      if (prev) useAuth.getState().setUser({ ...prev, homeGym: { community: communityId, place: null, setAt: new Date().toISOString() } });
      return { prev };
    },
    onSuccess: (user) => {
      useAuth.getState().setUser(user);
      if (qc.getQueryData(['me'])) qc.setQueryData(['me'], useAuth.getState().user);
      qc.invalidateQueries({ queryKey: ['home-gym'] });
      toast.success(`${name} is your gym now`);
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) useAuth.getState().setUser(ctx.prev);
      toast.error(errMsg(e, statusOf(e) === 403 ? 'Join the community first, then make it your gym' : 'Could not set your gym'));
    },
  });

  // Check in: the figures move the moment the button is tapped — today's and
  // the week's each gain the viewer once — and are put back if the server
  // refuses. The leaderboard and both routes are re-read either way.
  const activityKeys = [
    ['community', communityId, 'trained-today'],
    ['community', communityId, 'active-this-week'],
  ] as const;
  const checkIn = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/gyms/community/${communityId}/check-ins`, {});
      return data as { message?: string };
    },
    onMutate: async () => {
      const prev = activityKeys.flatMap((key) => qc.getQueriesData<ActiveThisWeek | TrainedToday | null>({ queryKey: key }));
      const actor: PublicActor | null = me?._id ? { _id: String(me._id), username: me.username, fullName: me.fullName, avatar: me.avatar } : null;
      for (const key of activityKeys) qc.setQueriesData<ActiveThisWeek | TrainedToday | null>({ queryKey: key }, (old) => (old ? withCheckIn(old, actor) : old));
      return { prev };
    },
    onSuccess: (data) => {
      toast.success(data?.message || `Checked in at ${name}`);
    },
    onError: (e, _v, ctx) => {
      for (const [key, data] of ctx?.prev || []) qc.setQueryData(key, data);
      toast.error(errMsg(e, 'Could not check you in'));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['community', communityId, 'leaderboard'] });
      for (const key of activityKeys) qc.invalidateQueries({ queryKey: key });
    },
  });

  const join = useJoinMutation();
  const cover = useCommunityCover(community);
  const gallery = (community?.photos || []).slice(1, 8);
  const pendingCount = requests.data?.length ?? 0;
  const totalMembers = memberTotalOf(community);

  // The header's gym: the details payload once it lands, the card's preview
  // meanwhile, a skeleton of the same geometry before either.
  const headerGym: GymBandGym | null = community
    ? bandGymOf(community, cover, membership.isMember ? todayLabel : undefined)
    : preview
      ? { id: preview.id ?? communityId, name: preview.name, city: preview.city, photoUrl: preview.photoUrl }
      : null;
  const headerLoading = !headerGym && detail.isPending;
  // The banner is decided from the cover's source, not its resolved URL, so a
  // place photo still fetching does not push the page down when it arrives.
  const banner = community ? Boolean(coverSourceOf(community)) : Boolean(preview?.photoUrl);

  // One blue control per screen: the header's action. Join for strangers,
  // "Set as my gym" for members, "Check in" once this is their gym.
  const primaryAction = community ? (
    !membership.isMember ? (
      <JoinButton community={community} mutation={join} variant="primary" />
    ) : isHome ? (
      <Button variant="primary" icon={<Check size={18} />} loading={checkIn.isPending} onClick={() => checkIn.mutate()}>
        Check in
      </Button>
    ) : (
      <Button variant="primary" icon={<MapPin size={18} />} loading={setHome.isPending} onClick={() => setHome.mutate()}>
        Set as my gym
      </Button>
    )
  ) : null;

  // The Today tab previews its figure on the strip; members and posts already sit in the header.
  const counts: Partial<Record<GymTab, number>> = {};
  if ((trainedToday.data?.count ?? 0) > 0) counts.today = trainedToday.data!.count;

  if (notFound) {
    return (
      <div className="space-y-section">
        <PageHeader title="Community" back={back} hideSectionTabs />
        <EmptyState
          variant="no-results"
          title="This community is no longer available"
          message="It may have been archived by its founder, or the link was cut short. The communities that are open right now are one tap away."
          action={{ label: 'Explore communities', to: '/communities' }}
          secondaryAction={{ label: 'Find gyms', to: '/gyms' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader title={name} back={back} hideSectionTabs />

      {/* The gym as Instagram draws an account: bled to the viewport edge (the shell centres content by
          max-width, so the header's own gutter lines its text up with the page) and, with a photo, pulled
          up under the top bar so the banner starts where the chrome ends. */}
      <GymHeader
        variant="profile"
        gym={headerGym}
        member={membership.isMember}
        loading={headerLoading}
        banner={banner}
        stats={community ? { posts: community.stats?.totalPosts, members: totalMembers, thisWeek: activeThisWeek.data?.count } : undefined}
        action={primaryAction}
        secondary={community ? <ShareButton path={communityPath(communityId)} title={name} /> : null}
        className={cx('-mx-gutter', banner && '-mt-4 lg:-mt-6')}
      >
        {community?.reviewState === 'pending' ? <p className="t-meta px-4 pb-2 lg:px-6">Pending review</p> : null}
        <GymTabs pathname={pathname} active={tab} counts={counts} />
      </GymHeader>

      {headerLoading ? (
        <>
          <div className="-mx-gutter -mt-section flex h-11 items-center gap-1 border-b border-line px-4 lg:px-6" aria-hidden="true">
            {GYM_TABS.map((t) => (
              <span key={t.key} className="flex flex-1 justify-center">
                <Skeleton className="h-3 w-14" />
              </span>
            ))}
          </div>
          <div className="space-y-4" aria-busy="true" aria-label={`Loading ${name}`}>
            <PostCardSkeleton />
            <PostCardSkeleton media={false} />
          </div>
        </>
      ) : null}
      {detail.isError && !notFound ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : null}

      {community ? (
        <>
          {membership.pending ? (
            <Callout tone="info" title="Your request is pending" icon={<Clock size={18} />}>
              An admin reviews new members. You will get a notification either way; tap Cancel request above if you change your mind.
            </Callout>
          ) : null}

          {/* ---------------------------------------------------------------- feed */}
          {tab === 'feed' ? (
            isPrivateToViewer ? (
              <PrivateNotice name={name} />
            ) : (
              <section className="space-y-4" aria-label={`Posts at ${name}`}>
                {membership.isMember ? (
                  composing ? (
                    <CommunityComposer communityId={community._id} communityName={name} onPosted={() => setComposing(false)} onCancel={() => setComposing(false)} />
                  ) : (
                    <Button variant="secondary" block icon={<Plus size={18} />} onClick={() => setComposing(true)}>
                      Post to this community
                    </Button>
                  )
                ) : null}
                {posts.isLoading ? (
                  <div className="space-y-4" aria-busy="true">
                    <PostCardSkeleton />
                    <PostCardSkeleton media={false} />
                  </div>
                ) : null}
                {posts.isError ? <ErrorState error={posts.error} onRetry={() => posts.refetch()} /> : null}
                {posts.isSuccess && (posts.data?.length || 0) === 0 && !composing ? (
                  membership.isMember ? (
                    <EmptyState
                      family="community"
                      title={`Start the feed at ${name}`}
                      message="Share a session, a PR or a meetup. It shows up here and on the feeds of everyone who follows you."
                      action={{ label: 'Write the first post', onClick: () => setComposing(true), variant: 'secondary', icon: <Plus size={16} /> }}
                    />
                  ) : (
                    <EmptyState
                      family="community"
                      title="Join to post here"
                      message={`Nothing has been shared at ${name} yet. Members post sessions, PRs and meetups; join above to be the first.`}
                    />
                  )
                ) : null}
                {(posts.data?.length || 0) > 0 ? (
                  <div>
                    {(posts.data || []).map((p) => (
                      <PostCard key={p._id} post={p} invalidate={[['community', communityId, 'posts'], ['feed']]} />
                    ))}
                  </div>
                ) : null}
              </section>
            )
          ) : null}

          {/* ---------------------------------------------------------------- today */}
          {tab === 'today' ? (
            isPrivateToViewer ? (
              <PrivateNotice name={name} />
            ) : (
              <CardGrid min="20rem" aria-label={`Today at ${name}`}>
                <TodayCard
                  name={name}
                  today={trainedToday}
                  fallbackLine={membership.isMember ? trainingTodayLine(todayLabel) : null}
                  member={membership.isMember}
                  checkIn={membership.isMember && !isHome ? { pending: checkIn.isPending, run: () => checkIn.mutate() } : undefined}
                />
                <WeekCard name={name} week={activeThisWeek} board={membership.isMember ? leaderboard : null} />

                <Card container>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="t-section text-text-1">Upcoming sessions</h2>
                    {canModerate ? <PlanSessionForm communityId={communityId} onPlanned={() => events.refetch()} /> : null}
                  </div>
                  {events.isLoading ? (
                    <div className="mt-3 space-y-2" aria-busy="true">
                      <SkeletonRow />
                      <SkeletonRow />
                    </div>
                  ) : null}
                  {events.isError ? (
                    statusOf(events.error) === 403 ? (
                      <p className="mt-3 text-sm text-text-2">Sessions are for members. Join above to see what is planned.</p>
                    ) : (
                      <ErrorState error={events.error} onRetry={() => events.refetch()} className="py-6" />
                    )
                  ) : null}
                  {events.isSuccess && (events.data?.length || 0) === 0 ? (
                    <EmptyState
                      size="sm"
                      icon={<Calendar size={24} />}
                      title="Nothing planned yet"
                      message={canModerate ? 'Plan the first session and members can turn up together.' : 'When an organiser plans a session it shows here with the time in the gym’s zone.'}
                    />
                  ) : null}
                  {(events.data?.length || 0) > 0 ? (
                    <ul className="mt-2 divide-y divide-line">
                      {(events.data || []).map((e) => (
                        <EventRow key={e._id} event={e} />
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </CardGrid>
            )
          ) : null}

          {/* ---------------------------------------------------------------- members */}
          {tab === 'members' ? (
            isPrivateToViewer ? (
              <PrivateNotice name={name} />
            ) : (
              <section className="space-y-4" aria-label={`Members of ${name}`}>
                {canModerate ? (
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="t-section text-text-1">Requests</h2>
                      {pendingCount ? <Badge tone="info">{pendingCount}</Badge> : null}
                    </div>
                    {requests.isLoading ? (
                      <div className="mt-2" aria-busy="true">
                        <SkeletonRow />
                      </div>
                    ) : null}
                    {requests.isError ? <ErrorState error={requests.error} title="Requests are unavailable" onRetry={() => requests.refetch()} className="py-6" /> : null}
                    {requests.isSuccess && pendingCount === 0 ? <p className="mt-1 text-sm text-text-2">Nobody is waiting. New requests to join appear here for you to approve or decline.</p> : null}
                    {pendingCount > 0 ? (
                      <ul className="mt-2 divide-y divide-line">
                        {(requests.data || []).map((r) => {
                          const who = nameOf(r.user);
                          return (
                            <li key={r._id} className="flex flex-wrap items-center gap-3 py-2">
                              <Avatar src={r.user?.avatar} name={who} size="md" />
                              <div className="min-w-0 flex-1">
                                {r.user?._id ? (
                                  <Link to={`/u/${r.user._id}`} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
                                    {who}
                                  </Link>
                                ) : (
                                  <p className="truncate text-sm font-semibold text-text-1">{who}</p>
                                )}
                                {r.requestedAt ? <p className="text-xs text-text-3">Requested {ago(r.requestedAt)}</p> : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="secondary" size="sm" icon={<Check size={16} />} loading={approve.isPending && approve.variables === r._id} disabled={approve.isPending || deny.isPending} onClick={() => approve.mutate(r._id)}>
                                  Approve
                                </Button>
                                <Button variant="ghost" size="sm" icon={<X size={16} />} loading={deny.isPending && deny.variables === r._id} disabled={approve.isPending || deny.isPending} onClick={() => deny.mutate(r._id)}>
                                  Decline
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </Card>
                ) : null}

                {(totalMembers || 0) > 8 ? (
                  <SearchField
                    label="Find a member"
                    hideLabel
                    placeholder="Find a member"
                    value={memberSearch}
                    onChange={(e) => {
                      setMemberSearch(e.target.value);
                      setMemberPage(1);
                    }}
                  />
                ) : null}
                {members.isLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <UserRowSkeleton key={i} />
                    ))}
                  </div>
                ) : null}
                {members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} /> : null}
                {members.isSuccess && (members.data?.members?.length || 0) === 0 ? (
                  debouncedMemberSearch ? (
                    <EmptyState variant="no-results" size="sm" title={`Nobody here matches “${debouncedMemberSearch}”`} message="Try another name." />
                  ) : (
                    <EmptyState family="community" size="sm" title="Nobody to show yet" message="Members appear here as they join." />
                  )
                ) : null}
                {(members.data?.members?.length || 0) > 0 ? (
                  <ul>
                    {(members.data?.members || []).map((m, i) => (
                      <MemberRow key={m._id || m.user?._id || i} member={m} community={community} viewerId={me?._id ? String(me._id) : undefined} viewerRole={membership.role} onChanged={invalidateCommunity} />
                    ))}
                  </ul>
                ) : null}
                <Pager
                  page={members.data?.pagination?.currentPage ?? memberPage}
                  totalPages={members.data?.pagination?.totalPages}
                  hasNext={Boolean(members.data?.pagination?.hasNext)}
                  onPrev={() => setMemberPage((p) => Math.max(1, p - 1))}
                  onNext={() => setMemberPage((p) => p + 1)}
                />
              </section>
            )
          ) : null}

          {/* ---------------------------------------------------------------- about */}
          {tab === 'about' ? (
            <CardGrid min="20rem" aria-label={`About ${name}`}>
              <AboutCard community={community} totalMembers={totalMembers} />
              <WhereCard community={community} hours={hoursLine(hours.data)} />
              {gallery.length ? (
                <Card>
                  <h2 className="t-section text-text-1">Photos</h2>
                  <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Community photos">
                    {gallery.map((photo, i) => (
                      <GalleryThumb key={photo.photoReference || photo.url || i} photo={photo} index={i + 2} />
                    ))}
                  </ul>
                </Card>
              ) : null}
              {aboutExtra}
              {membership.isMember ? (
                <Card>
                  <h2 className="t-section text-text-1">Your membership</h2>
                  <p className="mt-1 text-sm text-text-2">
                    {isHome ? `${name} is your gym: the app opens on it and your week is counted here.` : `Make ${name} your gym and the app opens on it.`}
                    {membership.role && membership.role !== 'member' ? ` You are ${/^[aeiou]/i.test(membership.role) ? 'an' : 'a'} ${humanize(membership.role).toLowerCase()} here.` : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {isHome ? (
                      <Badge tone="brand">
                        <Check size={12} />
                        Your gym
                      </Badge>
                    ) : (
                      <Button variant="secondary" size="sm" icon={<MapPin size={16} />} loading={setHome.isPending} onClick={() => setHome.mutate()}>
                        Set as my gym
                      </Button>
                    )}
                    <ContextualInviteButton kind="gym" targetId={communityId} targetName={name} size="sm" />
                    <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)}>
                      Leave
                    </Button>
                  </div>
                </Card>
              ) : null}
            </CardGrid>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmLeave}
        title="Leave this community?"
        description={
          viewerIsFounder
            ? 'You founded this community. Ownership passes to the longest-serving other admin; if there is none, make someone an admin in the Members tab first.'
            : 'You will stop seeing its posts and members. You can ask to join again later.'
        }
        confirmLabel="Leave community"
        destructive
        loading={leave.isPending}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => leave.mutate()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function PrivateNotice({ name }: { name: string }) {
  return (
    <Callout tone="brand" title="This community is private" icon={<Lock size={18} />}>
      Posts, sessions and the member list at {name} open up once an admin approves your request.
    </Callout>
  );
}

/** One more check-in from the viewer on a `{ count, members }` figure — unless they are already in it. */
function withCheckIn<T extends { count: number; members: PublicActor[] }>(figure: T, actor: PublicActor | null): T {
  if (actor && figure.members.some((m) => String(m._id) === actor._id)) return figure;
  return { ...figure, count: figure.count + 1, members: actor ? [actor, ...figure.members].slice(0, 12) : figure.members };
}

/**
 * "maya, alex and 4 others trained today": the visible faces by name, the
 * exact count for the rest. `count` is the server's integer (every member
 * with a check-in, discoverable or not); `members` is the subset it may show,
 * so the tail is never invented and never a masked "a few".
 */
function FacesLine({ count, members, suffix }: { count: number; members: PublicActor[]; suffix: string }) {
  const named = members.slice(0, 2);
  const rest = count - named.length;
  if (!named.length) {
    return (
      <>
        <span className="tabular font-semibold text-text-1">{formatStat(count)}</span> {suffix}
      </>
    );
  }
  return (
    <>
      {named.map((m, i) => (
        <span key={m._id}>
          {i > 0 ? (rest > 0 ? ', ' : ' and ') : ''}
          <Link to={`/u/${m._id}`} viewTransition className="font-semibold text-text-1 hover:underline">
            {nameOf(m)}
          </Link>
        </span>
      ))}
      {rest > 0 ? (
        <>
          {' and '}
          <span className="tabular font-semibold text-text-1">{rest === 1 ? '1 other' : `${formatStat(rest)} others`}</span>
        </>
      ) : null}{' '}
      {suffix}
    </>
  );
}

/** The faces themselves, each a link to the person: the twelve at most that the server sends. */
function Faces({ members, label }: { members: PublicActor[]; label: string }) {
  if (!members.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {members.slice(0, 12).map((m) => (
        <li key={m._id}>
          <Link to={`/u/${m._id}`} viewTransition aria-label={nameOf(m)} title={nameOf(m)} className="pressable block rounded-full">
            <Avatar src={m.avatar} name={nameOf(m)} size={40} seed={m._id} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The figure's geometry while it loads: one sentence, one row of faces. */
function FigureSkeleton() {
  return (
    <div className="mt-2 space-y-3" aria-busy="true">
      <Skeleton className="h-4 w-56 max-w-full" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-10 rounded-full" />
        ))}
      </div>
    </div>
  );
}

/** A query that is switched off is not loading; TanStack still calls it pending. */
const isFetchingFigure = (q: UseQueryResult<unknown>) => q.isPending && q.fetchStatus !== 'idle';

/**
 * Who trained today. The figure is the exact route (`trained-today`, drawn in
 * the device's zone); when the route is not there — an older API, a 404 — a
 * member still reads the leaderboard's string as before. Nobody yet is the
 * next action, never a zero.
 */
function TodayCard({
  name,
  today,
  fallbackLine,
  member,
  checkIn,
}: {
  name: string;
  today: UseQueryResult<TrainedToday | null>;
  fallbackLine: string | null;
  member: boolean;
  checkIn?: { pending: boolean; run: () => void };
}) {
  const figure = today.data ?? null;
  const count = figure?.count ?? 0;
  return (
    <Card container>
      <h2 className="t-section text-text-1">Today</h2>
      {isFetchingFigure(today) ? (
        <FigureSkeleton />
      ) : (
        <div className="mt-2 space-y-3">
          {count > 0 && figure ? (
            <p className="t-body text-text-2">
              <FacesLine count={count} members={figure.members} suffix="trained today" />
            </p>
          ) : !figure && fallbackLine ? (
            <p className="t-body text-text-1">{fallbackLine}</p>
          ) : (
            <p className="t-body text-text-2">
              {member ? `Nobody has checked in yet. Check in when you train at ${name} and the people here see you are in.` : `Nobody has checked in at ${name} yet today.`}
            </p>
          )}
          {count > 0 && figure ? <Faces members={figure.members} label="Trained today" /> : null}
          {figure?.timezoneSource === 'default' ? <p className="t-meta">Counted in UTC until {name} has a time zone; the first planned session sets it.</p> : null}
          {checkIn ? (
            <Button variant="secondary" icon={<Check size={18} />} loading={checkIn.pending} onClick={checkIn.run}>
              Check in
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/**
 * This week: the exact figure (`active-this-week`) for every viewer; members
 * also read their own tally and the check-in board's regulars with session
 * counts. The week's boundary is the community's (API.md §11c) and is named
 * only when the community has a zone.
 */
function WeekCard({ name, week, board }: { name: string; week: UseQueryResult<ActiveThisWeek | null>; board: UseQueryResult<Leaderboard> | null }) {
  const figure = week.data ?? null;
  const count = figure?.count ?? 0;
  const data = board?.data;
  const mySessions = typeof data?.me?.sessions === 'number' && data.me.sessions > 0 ? data.me.sessions : 0;
  const entries = (data?.entries || []).filter((e) => e.user?._id).slice(0, 8);
  const range = rangeLabel(data?.range);
  return (
    <Card container>
      <h2 className="t-section text-text-1">This week</h2>
      {isFetchingFigure(week) ? (
        <FigureSkeleton />
      ) : (
        <div className="mt-2 space-y-3">
          {count > 0 && figure ? (
            <p className="t-body text-text-2">
              <FacesLine count={count} members={figure.members} suffix="active this week" />
            </p>
          ) : (
            <p className="t-body text-text-2">
              Nobody has checked in at {name} this week yet.{board ? ' The first check-in starts the board.' : ''}
            </p>
          )}
          {count > 0 && figure ? <Faces members={figure.members} label="Active this week" /> : null}
          {board ? (
            board.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : board.isError ? (
              <ErrorState error={board.error} onRetry={() => board.refetch()} className="py-4" />
            ) : (
              <>
                {mySessions ? (
                  <p className="t-meta">
                    You have checked in {mySessions === 1 ? 'once' : `${mySessions} times`} this week{typeof data?.me?.rank === 'number' ? `, #${data.me.rank} on the board` : ''}.
                  </p>
                ) : count > 0 ? (
                  <p className="t-meta">Check in when you train here and you join the board.</p>
                ) : null}
                {entries.length ? (
                  <div>
                    <h3 className="text-sm font-semibold text-text-1">Regulars</h3>
                    <ul className="mt-1">
                      {entries.map((e) => {
                        const u = e.user!;
                        const sessions = typeof e.sessions === 'number' ? e.sessions : 0;
                        return (
                          <li key={String(u._id)} className="flex items-center gap-3 py-2">
                            <Link to={`/u/${u._id}`} viewTransition className="shrink-0 rounded-full">
                              <Avatar src={u.avatar} name={displayName(u)} size={36} />
                            </Link>
                            <Link to={`/u/${u._id}`} viewTransition className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1 hover:underline">
                              {displayName(u)}
                            </Link>
                            {sessions ? <span className="tabular text-xs text-text-2">{sessions === 1 ? '1 session' : `${sessions} sessions`}</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {range ? (
                  <p className="t-meta">{range}</p>
                ) : data?.range?.timezoneSource === 'default' ? (
                  <p className="t-meta">The week is not pinned to {name}’s time zone yet; it will be once the first session is planned.</p>
                ) : null}
              </>
            )
          ) : null}
        </div>
      )}
    </Card>
  );
}

function AboutCard({ community, totalMembers }: { community: Community; totalMembers?: number }) {
  const description = community.description?.trim();
  return (
    <Card container>
      <h2 className="t-section text-text-1">About</h2>
      {description ? <p className="prose-measure mt-2 whitespace-pre-wrap text-base text-text-1">{description}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {totalMembers ? (
          <Badge tone="neutral">
            <Users size={12} />
            <span className="tabular">{memberCountLabel(totalMembers)}</span>
          </Badge>
        ) : null}
        {typeof community.stats?.totalPosts === 'number' && community.stats.totalPosts > 0 ? (
          <Badge tone="neutral">
            <MessageCircle size={12} />
            <span className="tabular">{community.stats.totalPosts}</span> {community.stats.totalPosts === 1 ? 'post' : 'posts'}
          </Badge>
        ) : null}
        {community.category && community.category !== 'gym' ? <Badge tone="neutral">{humanize(community.category)}</Badge> : null}
        <VisibilityBadge community={community} />
      </div>
      {community.founder?._id ? (
        <p className="mt-3 text-xs text-text-3">
          Founded {ago(community.foundedAt) || 'a while ago'} by{' '}
          <Link to={`/u/${community.founder._id}`} viewTransition className="font-semibold text-text-2 underline-offset-2 hover:underline">
            {nameOf(community.founder)}
          </Link>
        </p>
      ) : null}
    </Card>
  );
}

/** Where the gym is: the map tile and address, and — for a place the map provider knows — whether it is open right now. */
function WhereCard({ community, hours }: { community: Community; hours: string | null }) {
  const coords = coordsOf(community);
  const place = community.vicinity?.trim();
  if (!coords && !place && !hours) return null;
  return (
    <Card container>
      <h2 className="t-section text-text-1">Where</h2>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {coords ? (
          <a
            href={osmHref(coords.lat, coords.lng)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${community.name || 'the gym'} on OpenStreetMap`}
            className="block shrink-0 overflow-hidden rounded-md shadow-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <MapTile lat={coords.lat} lng={coords.lng} size={160} />
          </a>
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          {place ? (
            <p className="flex items-start gap-1.5 text-sm text-text-1">
              <MapPin size={16} className="mt-0.5 shrink-0 text-text-3" />
              <span>{place}</span>
            </p>
          ) : null}
          {hours ? (
            <p className="flex items-center gap-1.5 text-sm text-text-1">
              <Clock size={16} className="shrink-0 text-text-3" />
              <span>{hours}</span>
            </p>
          ) : null}
          {coords ? (
            <a href={osmHref(coords.lat, coords.lng)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text underline-offset-2 hover:underline">
              Open in OpenStreetMap
              <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function GalleryThumb({ photo, index }: { photo: { photoReference?: string; url?: string }; index: number }) {
  const src = useCommunityCover({ photos: [photo] });
  if (!src) return null;
  return (
    <li className="h-24 w-32 shrink-0">
      <CardMedia className="h-full w-full">
        <img src={src} alt={`Community photo ${index}`} loading="lazy" className="h-full w-full object-cover" />
      </CardMedia>
    </li>
  );
}

/* ------------------------------------------------------------------ route: /communities/:communityId */

export default function CommunityDetail() {
  const { communityId = '' } = useParams();
  const location = useLocation();
  const preview = (location.state as { gym?: BandPreview } | null)?.gym || null;
  if (!isObjectId(communityId)) {
    return (
      <div className="space-y-section">
        <PageHeader title="Community" back="/communities" hideSectionTabs />
        <EmptyState
          variant="no-results"
          title="That is not a community link"
          message="The address is missing its id or has a typo. Explore the communities that are open, or find your gym and start one."
          action={{ label: 'Explore communities', to: '/communities' }}
          secondaryAction={{ label: 'Find gyms', to: '/gyms' }}
        />
      </div>
    );
  }
  return <CommunitySurface key={communityId} communityId={communityId} preview={preview} />;
}
