import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  extractHashtags,
  uploadImage,
  uploadOwnedMedia,
  useDebounced,
  type UploadedMedia,
} from '../lib/hooks';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_NAME_MAX,
  type CommunityLike,
  type CommunityPreset,
  communityNameError,
  communityPath,
  coverSourceOf,
  founderIdOf,
  isModRole,
  isObjectId,
  joinLabel,
  maxMembersError,
  membershipOf,
  pluralize,
  visibilityBadge,
} from '../lib/gyms';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  CardMedia,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  RadioGroup,
  SearchField,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  Spinner,
  Switch,
  Tabs,
  Textarea,
  cx,
  humanize,
  useToast,
  type MenuItem,
} from './ui';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Heart,
  Image as ImageIcon,
  Lock,
  MapPin,
  MessageCircle,
  Plus,
  Shield,
  Trash,
  Users,
  X,
} from './icons';

/* ------------------------------------------------------------------ types */

type Community = CommunityLike & {
  _id: string;
  name?: string;
  description?: string;
  vicinity?: string;
  category?: string;
  location?: { latitude?: number; longitude?: number };
  founder?: { _id?: string; username?: string; fullName?: string; avatar?: string } | null;
  foundedAt?: string;
  stats?: { totalMembers?: number; activeMembers?: number; totalPosts?: number };
  settings?: { isPublic?: boolean; requireApproval?: boolean; maxMembers?: number };
};

type Member = {
  _id?: string;
  role?: string;
  joinedAt?: string;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string };
};

type MembershipRequest = {
  _id: string;
  requestedAt?: string;
  user?: { _id: string; username?: string; fullName?: string; avatar?: string };
};

type CommunityPost = {
  _id: string;
  content?: string;
  createdAt?: string;
  media?: { uri?: string; url?: string; type?: string }[];
  medias?: { uri?: string; url?: string; type?: string }[];
  author?: { _id: string; username?: string; fullName?: string; avatar?: string };
  likes?: unknown[];
  comments?: unknown[];
};

type Paged<T> = {
  gymCommunities: T[];
  pagination: { currentPage: number; totalPages: number; hasNext: boolean; totalGymCommunities?: number };
};

type ListTab = 'explore' | 'mine';

const PAGE = 18;
const POST_MAX_CHARS = 2200;
const POST_MAX_IMAGES = 4;

/* ------------------------------------------------------------------ helpers */

const ago = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return '';
  }
};

const nameOf = (u?: { username?: string; fullName?: string } | null) => u?.fullName?.trim() || u?.username || 'Member';

const unwrapCommunity = (data: any): Community => (data?.data || data?.gymCommunity || data) as Community;

/**
 * Cover image for a community. Signed media URLs and managed keys render
 * directly; a Google photo token has to go through the authenticated
 * place-photo proxy, so it is fetched once with the bearer header and served
 * from an object URL (shared across cards).
 */
const placePhotoCache = new Map<string, Promise<string>>();
function usePlacePhoto(reference: string | null): string {
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

function useCommunityCover(community?: CommunityLike | null): string {
  const source = coverSourceOf(community);
  const placeRef = source?.kind === 'place-photo' ? source.reference : null;
  const fetched = usePlacePhoto(placeRef);
  if (!source) return '';
  if (source.kind === 'url') return source.url;
  if (source.kind === 'media-key') return mediaUrl(source.key);
  return fetched;
}

function Pager({
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

function CommunityCardSkeleton() {
  return (
    <div className="card p-3">
      <Skeleton className="aspect-video w-full rounded-md" />
      <div className="mt-3 space-y-2 px-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-20 rounded-xs" />
          <Skeleton className="h-6 w-16 rounded-xs" />
        </div>
      </div>
      <Skeleton className="mt-3 h-11 w-full rounded-sm" />
    </div>
  );
}

function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return null;
  return (
    <Badge tone={isModRole(role) ? 'brand' : 'neutral'}>
      {isModRole(role) ? <Shield size={12} /> : null}
      {humanize(role)}
    </Badge>
  );
}

function VisibilityBadge({ community }: { community: Community }) {
  const kind = visibilityBadge(community);
  if (!kind) return null;
  return (
    <Badge tone="warning">
      <Lock size={12} />
      {kind === 'private' ? 'Private' : 'Approval'}
    </Badge>
  );
}

function MembersBadge({ count }: { count: number }) {
  return (
    <Badge tone="neutral">
      <Users size={12} />
      <span className="tabular">{count}</span> {count === 1 ? 'member' : 'members'}
    </Badge>
  );
}

/* ------------------------------------------------------------------ card */

function CommunityCard({
  community,
  onOpen,
  action,
}: {
  community: Community;
  onOpen: () => void;
  action?: React.ReactNode;
}) {
  const cover = useCommunityCover(community);
  const members = community.stats?.totalMembers ?? 0;
  const membership = membershipOf(community);
  return (
    <article className="card flex flex-col p-3">
      <button
        type="button"
        onClick={onOpen}
        className="group -m-1 flex-1 rounded-md p-1 text-left"
        aria-label={`${community.name || 'Community'} — open`}
      >
        <CardMedia ratio="16/9">
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-text-3">
              <Users size={28} />
            </span>
          )}
        </CardMedia>
        <div className="mt-3 space-y-1 px-1">
          <p className="truncate text-md font-semibold text-text-1 group-hover:underline group-hover:underline-offset-2">
            {community.name || 'Community'}
          </p>
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-text-2">
            {community.vicinity ? <MapPin size={13} className="shrink-0 text-text-3" /> : <Globe size={13} className="shrink-0 text-text-3" />}
            <span className="truncate">{community.vicinity || community.description || 'Global community'}</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <MembersBadge count={members} />
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
      </button>
      {action ? <div className="mt-3 border-t border-line pt-3">{action}</div> : null}
    </article>
  );
}

/* ------------------------------------------------------------------ join button */

function useJoinMutation(onJoined?: (communityId: string, status: 'member' | 'pending' | 'none') => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (gymId: string) => {
      const { data } = await api.post('/gyms/community/join', { gymId });
      return { gymId, ...(data as { message?: string; membership?: { status?: string } }) };
    },
    onSuccess: (data) => {
      const msg = data?.message || '';
      const status = (data.membership?.status as 'member' | 'pending' | 'none' | undefined) || 'none';
      if (/cancel/i.test(msg)) toast.info('Request withdrawn');
      else if (status === 'pending' || /request|approval|pending/i.test(msg)) toast.info('Request sent — a moderator will review it');
      else toast.success('You joined the community');
      qc.invalidateQueries({ queryKey: ['communities'] });
      qc.invalidateQueries({ queryKey: ['community', data.gymId] });
      onJoined?.(data.gymId, status);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update your membership')),
  });
}

function JoinButton({
  community,
  mutation,
  block,
  size,
}: {
  community: Community;
  mutation: ReturnType<typeof useJoinMutation>;
  block?: boolean;
  size?: 'sm' | 'md';
}) {
  const membership = membershipOf(community);
  const busy = mutation.isPending && mutation.variables === community._id;
  const label = joinLabel(community);
  return (
    <Button
      block={block}
      size={size}
      variant={membership.pending ? 'secondary' : 'primary'}
      loading={busy}
      disabled={mutation.isPending && !busy}
      onClick={() => mutation.mutate(community._id)}
      icon={membership.pending ? <X size={16} /> : <Plus size={16} />}
    >
      {label}
    </Button>
  );
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
    <div className="rounded-md border border-line bg-surface-1 p-3" role="form" aria-label={`New post in ${communityName}`}>
      <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => void addFiles(e.target.files)} />
      <div className="flex gap-3">
        <Avatar src={me?.avatar} name={me?.fullName || me?.username || 'You'} size="sm" className="mt-1 hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <Textarea
            label={`What's happening at ${communityName}?`}
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
              <Button variant="primary" size="sm" onClick={() => create.mutate()} disabled={!dirty || uploading || create.isPending} loading={create.isPending}>
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
  member: Member;
  community: Community;
  viewerId?: string;
  viewerRole: string | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | 'remove' | 'transfer'>(null);
  const name = nameOf(member.user);
  const userId = member.user?._id;
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

  const items: MenuItem[] = [];
  if (userId && !isSelf && !isFounderRow && viewerRole && isModRole(viewerRole)) {
    if (viewerIsAdmin && role === 'member') items.push({ label: 'Make moderator', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'moderator' }) });
    if (viewerIsAdmin && role === 'moderator') items.push({ label: 'Remove moderator', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'member' }) });
    if (viewerIsFounder && role !== 'admin') items.push({ label: 'Make admin', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'admin' }) });
    if (viewerIsFounder && role === 'admin') items.push({ label: 'Remove admin', icon: <Shield size={18} />, onSelect: () => setRole.mutate({ role: 'member' }) });
    if (viewerIsFounder) items.push({ label: 'Transfer ownership', description: 'They become the founder; you stay an admin.', icon: <Users size={18} />, onSelect: () => setConfirm('transfer'), divider: true });
    const canRemove = role === 'member' || (role === 'moderator' && viewerIsAdmin) || (role === 'admin' && viewerIsFounder);
    if (canRemove) items.push({ label: 'Remove from community', icon: <Trash size={18} />, danger: true, onSelect: () => setConfirm('remove'), divider: items.length > 0 });
  }

  const body = (
    <>
      <Avatar src={member.user?.avatar} name={name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-1">
          {name}
          {isSelf ? <span className="ml-1.5 text-xs font-normal text-text-3">(you)</span> : null}
        </span>
        {member.joinedAt ? <span className="block text-xs text-text-3">Joined {ago(member.joinedAt)}</span> : null}
      </span>
      {isFounderRow ? <Badge tone="brand"><Shield size={12} />Founder</Badge> : <RoleBadge role={member.role === 'member' ? null : member.role} />}
    </>
  );

  return (
    <li className="flex items-center gap-2">
      {userId ? (
        <Link to={`/u/${userId}`} viewTransition className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-sm px-1 py-2 transition-colors dur-1 hover:bg-surface-2">
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-1 py-2">{body}</div>
      )}
      {items.length ? <Menu items={items} label={`Manage ${name}`} /> : null}
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

/* ------------------------------------------------------------------ detail */

function CommunityDetail({
  communityId,
  onClose,
}: {
  communityId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState<'posts' | 'members' | 'requests'>('posts');
  const [memberPage, setMemberPage] = useState(1);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    setTab('posts');
    setMemberPage(1);
    setComposing(false);
  }, [communityId]);

  const detail = useQuery({
    queryKey: ['community', communityId],
    enabled: Boolean(communityId),
    retry: (count, error) => (error as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}`);
      return unwrapCommunity(data);
    },
  });

  const community = detail.data;
  const membership = membershipOf(community);
  const canModerate = membership.isMember && isModRole(membership.role);
  const notFound = (detail.error as { response?: { status?: number } } | null)?.response?.status === 404;

  const members = useQuery({
    queryKey: ['community', communityId, 'members', memberPage],
    enabled: Boolean(communityId) && tab === 'members' && detail.isSuccess,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/members`, {
        params: { page: memberPage, limit: 20 },
      });
      return (data.data || data) as {
        members: Member[];
        pagination?: { currentPage: number; totalPages: number; hasNext: boolean };
      };
    },
  });

  const requests = useQuery({
    queryKey: ['community', communityId, 'requests'],
    enabled: Boolean(communityId) && canModerate,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/gyms/community/${communityId}/membership-requests`, {
        params: { limit: 50 },
      });
      return (data.requests || data.data?.requests || []) as MembershipRequest[];
    },
  });

  const posts = useQuery({
    queryKey: ['community', communityId, 'posts'],
    enabled: Boolean(communityId) && tab === 'posts' && detail.isSuccess && (community?.settings?.isPublic !== false || membership.isMember),
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/posts/gym/community/posts/all/${communityId}`, {
        params: { page: 1, limit: 20 },
      });
      return (data.posts || []) as CommunityPost[];
    },
  });

  const approve = useMutation({
    mutationFn: async (requestId: string) => {
      await api.post(`/gyms/community/${communityId}/membership-requests/${requestId}/approve`);
    },
    onSuccess: () => {
      toast.success('Member approved');
      qc.invalidateQueries({ queryKey: ['community', communityId] });
      qc.invalidateQueries({ queryKey: ['communities'] });
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
      qc.invalidateQueries({ queryKey: ['communities'] });
      qc.invalidateQueries({ queryKey: ['community', communityId] });
      onClose();
    },
    onError: (e) => {
      // The founder case comes back with the step that unblocks it; keep the
      // dialog open so the Members tab is one tap away.
      toast.error(errMsg(e, 'Could not leave the community'));
      setConfirmLeave(false);
    },
  });

  const join = useJoinMutation();

  const cover = useCommunityCover(community);
  const gallery = (community?.photos || []).slice(1, 8);
  const pendingCount = requests.data?.length ?? 0;
  const isPrivateToViewer = community?.settings?.isPublic === false && !membership.isMember;
  const founderId = founderIdOf(community);
  const viewerIsFounder = Boolean(me?._id && founderId && me._id === founderId);

  const primaryAction = community ? (
    membership.isMember ? (
      <Button variant="secondary" size="sm" onClick={() => setConfirmLeave(true)}>
        Leave
      </Button>
    ) : (
      <JoinButton community={community} mutation={join} size="sm" />
    )
  ) : null;

  return (
    <Modal
      open={Boolean(communityId)}
      onClose={onClose}
      size="lg"
      title={community?.name || 'Community'}
      description={community?.vicinity || undefined}
    >
      {detail.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="aspect-video w-full rounded-md" />
          <SkeletonText lines={2} />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : null}
      {detail.isError && notFound ? (
        <EmptyState
          variant="no-results"
          title="This community is no longer available"
          message="It may have been archived by its founder, or the link was cut short. Explore the communities that are open right now."
          action={{ label: 'Explore communities', onClick: onClose }}
          secondaryAction={{ label: 'Find gyms', to: '/gyms' }}
        />
      ) : null}
      {detail.isError && !notFound ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : null}
      {community ? (
        <div className="space-y-5">
          {cover ? (
            <CardMedia ratio="16/9">
              <img src={cover} alt={`${community.name || 'Community'} cover`} className="h-full w-full object-cover" />
            </CardMedia>
          ) : null}
          {gallery.length ? (
            <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Community photos">
              {gallery.map((photo, i) => (
                <GalleryThumb key={photo.photoReference || photo.url || i} photo={photo} index={i + 2} />
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              {community.description ? (
                <p className="prose-measure text-base text-text-1">{community.description}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <MembersBadge count={community.stats?.totalMembers ?? 0} />
                {typeof community.stats?.totalPosts === 'number' ? (
                  <Badge tone="neutral">
                    <span className="tabular">{community.stats.totalPosts}</span> {community.stats.totalPosts === 1 ? 'post' : 'posts'}
                  </Badge>
                ) : null}
                {community.category && community.category !== 'gym' ? <Badge tone="neutral">{humanize(community.category)}</Badge> : null}
                <VisibilityBadge community={community} />
                {membership.isMember ? <RoleBadge role={viewerIsFounder ? 'founder' : membership.role} /> : null}
              </div>
              {community.founder?._id ? (
                <p className="text-xs text-text-3">
                  Founded {ago(community.foundedAt) || 'a while ago'} by{' '}
                  <Link to={`/u/${community.founder._id}`} viewTransition className="font-semibold text-text-2 underline-offset-2 hover:underline">
                    {nameOf(community.founder)}
                  </Link>
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">{primaryAction}</div>
          </div>

          {membership.pending ? (
            <Callout tone="info" title="Your request is pending" icon={<Clock size={18} />}>
              A moderator reviews new members. You will get a notification either way; cancel the request above if you change your mind.
            </Callout>
          ) : null}

          {isPrivateToViewer ? (
            <Callout tone="brand" title="This community is private" icon={<Lock size={18} />}>
              Posts and the member list open up once a moderator approves your request.
            </Callout>
          ) : (
            <>
              <Tabs
                aria-label="Community sections"
                tabs={[
                  { value: 'posts', label: 'Posts' },
                  { value: 'members', label: 'Members', count: community.stats?.totalMembers },
                  ...(canModerate ? [{ value: 'requests', label: 'Requests', count: pendingCount || undefined }] : []),
                ]}
                value={tab}
                onChange={(k) => setTab(k as typeof tab)}
              />

              {tab === 'posts' ? (
                <div className="space-y-3">
                  {membership.isMember ? (
                    composing ? (
                      <CommunityComposer
                        communityId={community._id}
                        communityName={community.name || 'this community'}
                        onPosted={() => setComposing(false)}
                        onCancel={() => setComposing(false)}
                      />
                    ) : (
                      <Button variant="primary" block icon={<Plus size={18} />} onClick={() => setComposing(true)}>
                        Post to this community
                      </Button>
                    )
                  ) : null}
                  {posts.isLoading ? (
                    <div className="space-y-3" aria-busy="true">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-md bg-surface-2 p-3">
                          <SkeletonRow className="py-0" />
                          <SkeletonText lines={2} className="mt-3" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {posts.isError ? <ErrorState error={posts.error} onRetry={() => posts.refetch()} /> : null}
                  {posts.isSuccess && (posts.data?.length || 0) === 0 && !composing ? (
                    membership.isMember ? (
                      <EmptyState
                        size="sm"
                        icon={<MessageCircle size={24} />}
                        title="No posts yet"
                        message="Be the first: share a session, a PR or a meetup and it shows up here and on your feed."
                        action={{ label: 'Write the first post', onClick: () => setComposing(true), icon: <Plus size={16} /> }}
                      />
                    ) : (
                      <EmptyState
                        size="sm"
                        icon={<MessageCircle size={24} />}
                        title="No posts yet"
                        message="Members have not posted here yet. Join to post and to hear about sessions first."
                        action={<JoinButton community={community} mutation={join} />}
                      />
                    )
                  ) : null}
                  {(posts.data || []).map((p) => {
                    const media = p.media?.[0] || p.medias?.[0];
                    const src = mediaUrl(media?.uri || media?.url || '');
                    const author = p.author;
                    return (
                      <article key={p._id} className="rounded-md bg-surface-2 p-3">
                        <div className="flex items-center gap-2.5">
                          {author?._id ? (
                            <Link to={`/u/${author._id}`} viewTransition className="flex min-w-0 items-center gap-2.5 rounded-sm">
                              <Avatar src={author.avatar} name={nameOf(author)} size="sm" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-text-1">{nameOf(author)}</span>
                                <span className="block text-xs text-text-3">{ago(p.createdAt)}</span>
                              </span>
                            </Link>
                          ) : (
                            <>
                              <Avatar name="Member" size="sm" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-text-1">Member</span>
                                <span className="block text-xs text-text-3">{ago(p.createdAt)}</span>
                              </span>
                            </>
                          )}
                        </div>
                        <Link to={`/p/${p._id}`} viewTransition className="mt-2 block rounded-sm">
                          {p.content ? <p className="prose-measure whitespace-pre-wrap text-base text-text-1">{p.content}</p> : null}
                          {src ? (
                            <CardMedia className="mt-2 max-h-72">
                              <img src={src} alt="" loading="lazy" className="max-h-72 w-full object-cover" />
                            </CardMedia>
                          ) : null}
                        </Link>
                        <div className="mt-2 flex items-center gap-4 text-xs text-text-2">
                          <span className="inline-flex items-center gap-1">
                            <Heart size={14} />
                            <span className="tabular">{p.likes?.length ?? 0}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle size={14} />
                            <span className="tabular">{p.comments?.length ?? 0}</span>
                          </span>
                          <Link to={`/p/${p._id}`} viewTransition className="ml-auto font-semibold text-brand-text underline-offset-2 hover:underline">
                            Open post
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {tab === 'members' ? (
                <div className="space-y-2">
                  {members.isLoading ? (
                    <div aria-busy="true">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <SkeletonRow key={i} />
                      ))}
                    </div>
                  ) : null}
                  {members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} /> : null}
                  {members.isSuccess && (members.data?.members?.length || 0) === 0 ? (
                    <EmptyState size="sm" icon={<Users size={24} />} title="No members to show" message="This community has no visible members yet." />
                  ) : null}
                  {(members.data?.members?.length || 0) > 0 ? (
                    <ul className="divide-y divide-line">
                      {(members.data?.members || []).map((m, i) => (
                        <MemberRow
                          key={m._id || m.user?._id || i}
                          member={m}
                          community={community}
                          viewerId={me?._id}
                          viewerRole={membership.role}
                          onChanged={() => {
                            qc.invalidateQueries({ queryKey: ['community', communityId] });
                            qc.invalidateQueries({ queryKey: ['communities'] });
                          }}
                        />
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
                </div>
              ) : null}

              {tab === 'requests' ? (
                <div className="space-y-2">
                  {requests.isLoading ? (
                    <div aria-busy="true">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <SkeletonRow key={i} />
                      ))}
                    </div>
                  ) : null}
                  {requests.isError ? (
                    <ErrorState
                      error={requests.error}
                      title="Requests are unavailable"
                      message={errMsg(requests.error, 'Only moderators can review membership requests.')}
                      onRetry={() => requests.refetch()}
                    />
                  ) : null}
                  {requests.isSuccess && pendingCount === 0 ? (
                    <EmptyState
                      size="sm"
                      icon={<Check size={24} />}
                      title="No pending requests"
                      message="New requests to join appear here for you to approve or decline."
                    />
                  ) : null}
                  {pendingCount > 0 ? (
                    <ul className="divide-y divide-line">
                      {(requests.data || []).map((r) => {
                        const name = nameOf(r.user);
                        return (
                          <li key={r._id} className="flex flex-wrap items-center gap-3 py-2">
                            <Avatar src={r.user?.avatar} name={name} size="md" />
                            <div className="min-w-0 flex-1">
                              {r.user?._id ? (
                                <Link to={`/u/${r.user._id}`} viewTransition className="block truncate text-sm font-semibold text-text-1 hover:underline">
                                  {name}
                                </Link>
                              ) : (
                                <p className="truncate text-sm font-semibold text-text-1">{name}</p>
                              )}
                              {r.requestedAt ? <p className="text-xs text-text-3">Requested {ago(r.requestedAt)}</p> : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                icon={<Check size={16} />}
                                loading={approve.isPending && approve.variables === r._id}
                                disabled={approve.isPending || deny.isPending}
                                onClick={() => approve.mutate(r._id)}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<X size={16} />}
                                loading={deny.isPending && deny.variables === r._id}
                                disabled={approve.isPending || deny.isPending}
                                onClick={() => deny.mutate(r._id)}
                              >
                                Decline
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
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
    </Modal>
  );
}

function GalleryThumb({ photo, index }: { photo: { photoReference?: string; url?: string }; index: number }) {
  const src = useCommunityCover({ photos: [photo] });
  if (!src) return null;
  return (
    <li className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-surface-2">
      <img src={src} alt={`Community photo ${index}`} loading="lazy" className="h-full w-full object-cover" />
    </li>
  );
}

/* ------------------------------------------------------------------ create */

type LocationChoice = 'current' | 'place' | 'global';

function CreateCommunityModal({
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
    setLocationChoice(preset?.location ? 'place' : 'global');
    setCoords(null);
    setLocateError(null);
    setCover(null);
    setTouched(false);
  }, [open, preset]);

  const nameError = touched ? communityNameError(name) : null;
  const membersError = maxMembersError(maxMembers);
  const canSubmit = !communityNameError(name) && !membersError && !uploading && !(locationChoice === 'current' && !coords);

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
          : locationChoice === 'place' && preset?.location
            ? preset.location
            : undefined;
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        settings: {
          isPublic: visibility === 'public',
          requireApproval: visibility === 'private' ? true : requireApproval,
          maxMembers: Number(maxMembers),
        },
        ...(location ? { location } : {}),
        ...(locationChoice === 'place' && preset?.placeId ? { placeId: preset.placeId } : {}),
        ...(locationChoice === 'place' && preset?.vicinity ? { vicinity: preset.vicinity } : {}),
        ...(cover ? { photos: [{ photoReference: cover.key, ...(cover.width ? { width: cover.width } : {}), ...(cover.height ? { height: cover.height } : {}) }] } : {}),
      };
      const { data } = await api.post('/gyms/community/join', body);
      return unwrapCommunity(data);
    },
    onSuccess: (community) => {
      toast.success(`${community.name || 'Your community'} is live`);
      qc.invalidateQueries({ queryKey: ['communities'] });
      onCreated(community);
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
      title="Start a community"
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
            { value: 'private', label: 'Private', description: 'Hidden from Explore; people request to join and moderators approve.' },
          ]}
        />
        {visibility === 'public' ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-text-1">Approve new members</p>
              <p className="text-xs text-text-2">Requests wait for a moderator instead of joining instantly.</p>
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
          containerClassName="max-w-[12rem]"
        />

        <RadioGroup
          label="Location"
          value={locationChoice}
          onChange={(v) => setLocationChoice(v as LocationChoice)}
          options={[
            ...(preset?.location
              ? [{ value: 'place', label: preset.name ? `At ${preset.name}` : 'At the selected place', description: preset.vicinity || 'From the place you picked on the Gyms page.' }]
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
  const [tab, setTab] = useState<ListTab>('explore');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 400);
  const location = useLocation();
  const navigate = useNavigate();
  // Share links from the app land as /communities?community=<id>: the detail
  // opens for it and the parameter is dropped when it closes.
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(() => {
    const id = params.get('community');
    return id && isObjectId(id) ? id : null;
  });
  useEffect(() => {
    const id = params.get('community');
    if (id && isObjectId(id)) setOpenId(id);
  }, [params]);
  const openCommunity = useCallback(
    (id: string) => {
      setOpenId(id);
      const next = new URLSearchParams(params);
      next.set('community', id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const closeCommunity = useCallback(() => {
    setOpenId(null);
    if (params.has('community')) {
      const next = new URLSearchParams(params);
      next.delete('community');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  // "Start a community here" from the Gyms page arrives with a preset in
  // router state; the form opens with it and the state is cleared so a reload
  // does not reopen the form.
  const preset = (location.state as { startCommunity?: CommunityPreset } | null)?.startCommunity || null;
  const [creating, setCreating] = useState<boolean>(() => Boolean(preset));
  useEffect(() => {
    if (preset) {
      setCreating(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  const [presetForForm, setPresetForForm] = useState<CommunityPreset | null>(preset);
  useEffect(() => {
    if (preset) setPresetForForm(preset);
  }, [preset]);

  const changeTab = (next: ListTab) => {
    setTab(next);
    setPage(1);
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
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

  const startAction = (
    <Button variant="primary" icon={<Plus size={18} />} onClick={() => { setPresetForForm(null); setCreating(true); }}>
      Start a community
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communities"
        subtitle="Join the crews training at your gym and follow what they post."
        actions={startAction}
        mobileActions={
          <IconButton label="Start a community" variant="primary" onClick={() => { setPresetForForm(null); setCreating(true); }}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <Tabs
        variant="segmented"
        aria-label="Community lists"
        tabs={[
          { value: 'explore', label: 'Explore' },
          { value: 'mine', label: 'My communities' },
        ]}
        value={tab}
        onChange={(k) => changeTab(k as ListTab)}
      />

      <SearchField
        label={tab === 'mine' ? 'Search my communities' : 'Search communities'}
        hideLabel
        placeholder={tab === 'mine' ? 'Search your communities' : 'Search by gym or community name'}
        value={search}
        onChange={(e) => changeSearch(e.target.value)}
      />

      {active.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading communities">
          {Array.from({ length: 6 }).map((_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
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
              icon={<Globe size={26} />}
              title="You have not joined a community yet"
              message="Communities are built around gyms and crews. Join one that is already going, or start your own in a minute."
              action={{ label: 'Explore communities', onClick: () => changeTab('explore') }}
              secondaryAction={{ label: 'Start a community', onClick: () => { setPresetForForm(null); setCreating(true); }, icon: <Plus size={16} /> }}
            />
          )
        ) : debounced ? (
          <EmptyState
            variant="no-results"
            title={`No communities match “${debounced}”`}
            message="Check the spelling, or start a community with that name — you become its first admin."
            action={{ label: 'Start a community', onClick: () => { setPresetForForm({ name: debounced }); setCreating(true); }, icon: <Plus size={16} /> }}
            secondaryAction={{ label: 'Clear search', onClick: () => changeSearch('') }}
          />
        ) : mineCount.isSuccess && mineCount.data > 0 ? (
          <EmptyState
            icon={<Check size={26} />}
            title="You have joined every community we could find"
            message={`You are in ${pluralize(mineCount.data, 'community', 'communities')}. Start a new one for a gym that has none yet, or invite friends to yours.`}
            action={{ label: 'Go to My communities', onClick: () => changeTab('mine') }}
            secondaryAction={{ label: 'Start a community', onClick: () => { setPresetForForm(null); setCreating(true); }, icon: <Plus size={16} /> }}
          />
        ) : mineCount.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading communities">
            {Array.from({ length: 3 }).map((_, i) => (
              <CommunityCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Globe size={26} />}
            title="No communities yet"
            message="Nobody has started one around a gym near you. Be the first: it takes a name and a minute, and you become its admin."
            action={{ label: 'Start a community', onClick: () => { setPresetForForm(null); setCreating(true); }, icon: <Plus size={16} /> }}
            secondaryAction={{ label: 'Find gyms', to: '/gyms' }}
          />
        )
      ) : null}

      {communities.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {communities.map((c) => {
              const membership = membershipOf(c);
              return (
                <CommunityCard
                  key={c._id}
                  community={c}
                  onOpen={() => openCommunity(c._id)}
                  action={
                    !membership.isMember ? (
                      <JoinButton community={c} mutation={join} block />
                    ) : (
                      <Button block variant="secondary" onClick={() => openCommunity(c._id)}>
                        Open
                      </Button>
                    )
                  }
                />
              );
            })}
          </div>
          <Pager
            page={pagination?.currentPage ?? page}
            totalPages={pagination?.totalPages}
            hasNext={Boolean(pagination?.hasNext)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </>
      ) : null}

      <CommunityDetail communityId={openId} onClose={closeCommunity} />
      <CreateCommunityModal
        open={creating}
        preset={presetForForm}
        onClose={() => setCreating(false)}
        onCreated={(community) => {
          setCreating(false);
          if (community?._id) {
            setTab('mine');
            setPage(1);
            openCommunity(community._id);
          }
        }}
      />
    </div>
  );
}

// Referenced by tests: canonical community link used by cards and share links.
export { communityPath };
