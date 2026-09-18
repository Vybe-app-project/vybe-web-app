import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardMedia,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  Tabs,
  Textarea,
  cx,
  usePulse,
  useToast,
} from './ui';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Play,
  Plus,
  Radio,
  Send,
  Users,
} from './icons';

/* ------------------------------------------------------------------ types */

const CATEGORY_OPTIONS = [
  { value: 'workout', label: 'Workout' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'strength', label: 'Strength' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'motivation', label: 'Motivation' },
  { value: 'q&a', label: 'Q&A' },
  { value: 'general', label: 'General' },
];
const categoryLabel = (v?: string) => CATEGORY_OPTIONS.find((o) => o.value === v)?.label || (v ? v.charAt(0).toUpperCase() + v.slice(1) : '');

type StreamUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

type StreamStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

type Stream = {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  status?: StreamStatus;
  thumbnail?: string;
  host?: StreamUser | string;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  viewerCount?: number;
  currentViewers?: number;
  viewers?: unknown[];
  peakViewers?: number;
  likeCount?: number;
  likes?: unknown[];
  isLiked?: boolean;
  hasLiked?: boolean;
  isHost?: boolean;
  tags?: string[];
  settings?: { visibility?: string; allowComments?: boolean; chatEnabled?: boolean; maxViewers?: number };
};

type StreamComment = {
  _id: string;
  text: string;
  createdAt?: string;
  user?: StreamUser;
};

/** GET /api/capabilities — the server's honest report of what is configured. */
type ServerCapabilities = {
  livestreamRelay?: boolean;
  turnRelay?: boolean;
  [k: string]: unknown;
};

type ListTab = 'live' | 'featured' | 'scheduled' | 'mine';

const PAGE = 18;
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

const at = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, "EEE d MMM 'at' h:mm a");
};

const hostOf = (s?: Stream): StreamUser | null => (s && s.host && typeof s.host === 'object' ? s.host : null);
const hostName = (s?: Stream) => {
  const h = hostOf(s);
  return h?.fullName?.trim() || h?.username || 'Host';
};
const viewersOf = (s: Stream) => s.viewerCount ?? s.currentViewers ?? s.viewers?.length ?? 0;
const likesOf = (s: Stream) => s.likeCount ?? s.likes?.length ?? 0;
const chatAllowed = (s?: Stream) => s?.settings?.allowComments !== false && s?.settings?.chatEnabled !== false;

function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get('/capabilities');
      return (data?.capabilities || {}) as ServerCapabilities;
    },
  });
}

function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx('relative inline-flex h-2 w-2', className)} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
    </span>
  );
}

function StatusPill({ stream, className }: { stream: Stream; className?: string }) {
  const base = 'inline-flex h-6 items-center gap-1.5 rounded-xs px-2 text-2xs font-semibold backdrop-blur';
  if (stream.status === 'live') {
    return (
      <span className={cx(base, 'bg-surface-1/90 text-danger', className)}>
        <LiveDot />
        Live
      </span>
    );
  }
  if (stream.status === 'scheduled') {
    return (
      <span className={cx(base, 'bg-surface-1/90 text-text-1', className)}>
        <CalendarDays size={13} className="text-text-2" />
        {at(stream.scheduledAt) || 'Scheduled'}
      </span>
    );
  }
  return (
    <span className={cx(base, 'bg-surface-1/90 text-text-2', className)}>
      {stream.status === 'cancelled' ? 'Cancelled' : 'Ended'}
    </span>
  );
}

function Pager({
  page,
  totalPages,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages?: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
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

function StreamCardSkeleton() {
  return (
    <div className="card p-3">
      <Skeleton className="aspect-video w-full rounded-md" />
      <div className="mt-3 space-y-2 px-1">
        <Skeleton className="h-4 w-3/4" />
        <SkeletonRow className="py-0" />
      </div>
    </div>
  );
}

function StreamGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading streams">
      {Array.from({ length: count }).map((_, i) => (
        <StreamCardSkeleton key={i} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ card */

function StreamCard({ stream, onOpen }: { stream: Stream; onOpen: () => void }) {
  const thumb = mediaUrl(stream.thumbnail);
  const host = hostOf(stream);
  return (
    <button type="button" onClick={onOpen} className="card card-interactive w-full p-3 text-left" aria-label={`${stream.title} — open`}>
      <CardMedia ratio="16/9" className="relative">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-text-3">
            <Play size={30} />
          </span>
        )}
        <StatusPill stream={stream} className="absolute left-2 top-2" />
        {stream.status === 'live' ? (
          <span className="absolute bottom-2 right-2 inline-flex h-6 items-center gap-1 rounded-xs bg-surface-1/90 px-2 text-2xs font-semibold text-text-1 backdrop-blur">
            <Eye size={13} className="text-text-2" />
            <span className="tabular">{viewersOf(stream)}</span>
          </span>
        ) : null}
      </CardMedia>
      <div className="mt-3 space-y-2 px-1 pb-1">
        <p className="line-clamp-2 text-md font-semibold leading-snug text-text-1">{stream.title}</p>
        <div className="flex items-center gap-2">
          <Avatar src={host?.avatar} name={hostName(stream)} size="xs" />
          <span className="min-w-0 truncate text-xs text-text-2">{hostName(stream)}</span>
          {stream.category ? (
            <Badge tone="neutral" size="sm" className="ml-auto shrink-0">
              {categoryLabel(stream.category)}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ create */

function CreateStreamModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id?: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [scheduledAt, setScheduledAt] = useState('');
  const [thumbnail, setThumbnail] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (!open) {
      setTitle('');
      setTitleTouched(false);
      setDescription('');
      setCategory('general');
      setScheduledAt('');
      setThumbnail('');
      setTags('');
    }
  }, [open]);

  const parsedTags = tags
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  const titleError = titleTouched && title.trim().length < 3 ? 'Give the stream a title of at least 3 characters.' : null;
  const tagsError = parsedTags.length > 10 ? 'Use at most 10 tags.' : parsedTags.some((t) => t.length > 30) ? 'Each tag must be 30 characters or fewer.' : null;
  const scheduleError = scheduledAt && Number.isNaN(new Date(scheduledAt).getTime()) ? 'Pick a valid date and time.' : null;
  const canSubmit = title.trim().length >= 3 && !tagsError && !scheduleError;

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { title: title.trim(), category };
      if (description.trim()) payload.description = description.trim();
      if (thumbnail.trim()) payload.thumbnail = thumbnail.trim();
      if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
      if (parsedTags.length) payload.tags = parsedTags;
      const { data } = await api.post('/livestreams', payload);
      return (data?.stream || data?.data || data) as Partial<Stream>;
    },
    onSuccess: (data) => {
      toast.success(scheduledAt ? 'Stream scheduled' : 'Stream created');
      qc.invalidateQueries({ queryKey: ['livestreams'] });
      onClose();
      onCreated(data?._id);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create the stream')),
  });

  const minSchedule = format(new Date(), "yyyy-MM-dd'T'HH:mm");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New stream"
      description="Set it up now and go live when you are ready, or schedule it for later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>
            {scheduledAt ? 'Schedule stream' : 'Create stream'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTitleTouched(true);
          if (canSubmit) create.mutate();
        }}
      >
        <Input
          label="Title"
          placeholder="Push day with the 6am crew"
          value={title}
          maxLength={100}
          required
          error={titleError}
          onBlur={() => setTitleTouched(true)}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Description"
          hint="Optional. What will people get from tuning in?"
          rows={3}
          autoGrow
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
          <DateField
            type="datetime-local"
            label="Schedule for"
            hint="Leave empty to go live whenever you are ready."
            min={minSchedule}
            value={scheduledAt}
            error={scheduleError}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>
        <Input
          label="Thumbnail"
          hint="Optional. An image URL or an uploaded media key."
          placeholder="https://"
          inputMode="url"
          value={thumbnail}
          onChange={(e) => setThumbnail(e.target.value)}
        />
        <Input
          label="Tags"
          hint="Optional. Up to 10, separated by spaces or commas."
          placeholder="legday strength pr"
          value={tags}
          error={tagsError}
          onChange={(e) => setTags(e.target.value)}
        />
        <button type="submit" className="sr-only">
          Create stream
        </button>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ watch */

function WatchModal({ streamId, onClose }: { streamId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<'end' | 'cancel' | null>(null);
  const joinedRef = useRef(false);
  const heart = usePulse();

  useEffect(() => {
    setComment('');
    setConfirm(null);
    joinedRef.current = false;
  }, [streamId]);

  const detail = useQuery({
    queryKey: ['livestream', streamId],
    enabled: Boolean(streamId),
    refetchInterval: (q) => (q.state.data?.status === 'live' ? 15000 : false),
    queryFn: async () => {
      const { data } = await api.get(`/livestreams/${streamId}`);
      return (data.stream || data.data || data) as Stream;
    },
  });

  const stream = detail.data;
  const host = hostOf(stream);
  const isHost = Boolean(
    stream?.isHost || (me?._id && (host?._id === me._id || (typeof stream?.host === 'string' && stream.host === me._id))),
  );
  const isLive = stream?.status === 'live';
  const liked = Boolean(stream?.isLiked ?? stream?.hasLiked);

  const comments = useQuery({
    queryKey: ['livestream', streamId, 'comments'],
    enabled: Boolean(streamId) && Boolean(stream) && stream?.status !== 'cancelled',
    refetchInterval: isLive ? 8000 : false,
    queryFn: async () => {
      const { data } = await api.get(`/livestreams/${streamId}/comments`, { params: { page: 1, limit: 50 } });
      return (data.comments || []) as StreamComment[];
    },
  });

  const invalidateLists = () => qc.invalidateQueries({ queryKey: ['livestreams'] });

  const like = useMutation({
    mutationFn: async () => {
      await api.post(`/livestreams/${streamId}/like`);
    },
    onMutate: () => heart.pulse(),
    onSuccess: () => detail.refetch(),
    onError: (e) => toast.error(errMsg(e, 'Could not react to the stream')),
  });

  const start = useMutation({
    mutationFn: async () => {
      await api.put(`/livestreams/${streamId}/start`);
    },
    onSuccess: () => {
      toast.success('You are live');
      detail.refetch();
      invalidateLists();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not start the stream')),
  });

  const end = useMutation({
    mutationFn: async () => {
      await api.put(`/livestreams/${streamId}/end`);
    },
    onSuccess: () => {
      toast.success('Stream ended');
      setConfirm(null);
      detail.refetch();
      invalidateLists();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not end the stream'));
      setConfirm(null);
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      await api.put(`/livestreams/${streamId}/cancel`);
    },
    onSuccess: () => {
      toast.success('Stream cancelled');
      setConfirm(null);
      detail.refetch();
      invalidateLists();
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not cancel the stream'));
      setConfirm(null);
    },
  });

  const addComment = useMutation({
    mutationFn: async (text: string) => {
      await api.post(`/livestreams/${streamId}/comments`, { text });
    },
    onSuccess: () => {
      setComment('');
      comments.refetch();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not send your message')),
  });

  // Register as a viewer while the stream is live; leave when the modal closes.
  useEffect(() => {
    if (!streamId || !isLive || isHost || joinedRef.current) return;
    joinedRef.current = true;
    api.post(`/livestreams/${streamId}/join`).then(() => detail.refetch()).catch(() => {
      joinedRef.current = false;
    });
  }, [streamId, isLive, isHost, detail]);

  useEffect(
    () => () => {
      if (joinedRef.current && streamId) {
        api.post(`/livestreams/${streamId}/leave`).catch(() => undefined);
        joinedRef.current = false;
      }
    },
    [streamId],
  );

  const thumb = stream ? mediaUrl(stream.thumbnail) : '';
  const commentList = comments.data || [];

  return (
    <Modal open={Boolean(streamId)} onClose={onClose} size="lg" title={stream?.title || 'Live'} description={stream ? `Hosted by ${hostName(stream)}` : undefined}>
      {detail.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="aspect-video w-full rounded-md" />
          <SkeletonRow />
          <SkeletonText lines={2} />
        </div>
      ) : null}
      {detail.isError ? (
        <ErrorState
          error={detail.error}
          title="This stream could not be loaded"
          message={errMsg(detail.error, 'It may have been removed, or you may not have access to it.')}
          onRetry={() => detail.refetch()}
        />
      ) : null}
      {stream ? (
        <div className="space-y-5">
          <CardMedia ratio="16/9" className="relative bg-surface-3">
            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover opacity-60" /> : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
              {isLive ? (
                <>
                  <span className="inline-flex items-center gap-2 rounded-xs bg-surface-1/90 px-2.5 py-1 text-sm font-semibold text-danger backdrop-blur">
                    <LiveDot />
                    Live now
                  </span>
                  <span className="text-sm text-text-1">
                    <span className="tabular font-semibold">{viewersOf(stream)}</span> watching
                  </span>
                </>
              ) : stream.status === 'scheduled' ? (
                <>
                  <CalendarDays size={28} className="text-text-2" />
                  <span className="text-sm font-semibold text-text-1">Starts {at(stream.scheduledAt) || 'soon'}</span>
                </>
              ) : (
                <span className="text-sm font-semibold text-text-2">
                  {stream.status === 'cancelled' ? 'This stream was cancelled' : `Ended ${ago(stream.endedAt) || ''}`.trim()}
                </span>
              )}
            </div>
          </CardMedia>
          {isLive ? (
            <p className="text-xs text-text-3">Video playback in the browser is not available yet. Chat and reactions work here.</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {host?._id ? (
              <Link to={`/u/${host._id}`} viewTransition className="flex min-w-0 items-center gap-2.5 rounded-sm">
                <Avatar src={host.avatar} name={hostName(stream)} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-1">{hostName(stream)}</span>
                  <span className="flex items-center gap-3 text-xs text-text-2">
                    <span className="inline-flex items-center gap-1">
                      <Eye size={13} />
                      <span className="tabular">{viewersOf(stream)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Heart size={13} />
                      <span className="tabular">{likesOf(stream)}</span>
                    </span>
                  </span>
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-2.5">
                <Avatar name={hostName(stream)} size="md" />
                <span className="text-sm font-semibold text-text-1">{hostName(stream)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              {!isHost && isLive ? (
                <Button
                  variant={liked ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={liked}
                  disabled={like.isPending}
                  onClick={() => like.mutate()}
                  icon={<Heart size={18} filled={liked} className={heart.className} />}
                >
                  {liked ? 'Liked' : 'Like'}
                </Button>
              ) : null}
              {isHost && stream.status === 'scheduled' ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setConfirm('cancel')}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" loading={start.isPending} onClick={() => start.mutate()} icon={<Radio size={18} />}>
                    Go live
                  </Button>
                </>
              ) : null}
              {isHost && isLive ? (
                <Button variant="danger" size="sm" onClick={() => setConfirm('end')}>
                  End stream
                </Button>
              ) : null}
            </div>
          </div>

          {stream.description ? <p className="prose-measure whitespace-pre-wrap text-base text-text-1">{stream.description}</p> : null}
          {stream.tags?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {stream.tags.map((t) => (
                <Badge key={t} tone="brand">
                  #{t}
                </Badge>
              ))}
            </div>
          ) : null}

          {stream.status !== 'cancelled' ? (
            <section className="space-y-3" aria-label="Live chat">
              <h3 className="type-heading text-lg text-text-1">Live chat</h3>
              {comments.isLoading ? (
                <div aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))}
                </div>
              ) : null}
              {comments.isError ? <ErrorState error={comments.error} onRetry={() => comments.refetch()} /> : null}
              {comments.isSuccess && commentList.length === 0 ? (
                <p className="rounded-md bg-surface-2 px-3 py-4 text-center text-sm text-text-2">
                  {isLive ? 'No messages yet. Say hi to the host.' : stream.status === 'scheduled' ? 'Chat opens when the stream goes live.' : 'Nobody chatted during this stream.'}
                </p>
              ) : null}
              {commentList.length > 0 ? (
                <ul className="max-h-64 space-y-2.5 overflow-y-auto overscroll-contain pr-1" aria-live="polite">
                  {commentList.map((c) => {
                    const name = c.user?.fullName?.trim() || c.user?.username || 'Viewer';
                    return (
                      <li key={c._id} className="flex gap-2">
                        <Avatar src={c.user?.avatar} name={name} size="xs" />
                        <div className="min-w-0">
                          <p className="text-xs">
                            <span className="font-semibold text-text-1">{name}</span>{' '}
                            <span className="text-text-3">{ago(c.createdAt)}</span>
                          </p>
                          <p className="break-words text-sm text-text-1">{c.text}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {isLive ? (
                chatAllowed(stream) ? (
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = comment.trim();
                      if (text) addComment.mutate(text);
                    }}
                  >
                    <Input
                      label="Message"
                      hideLabel
                      placeholder="Say something"
                      maxLength={300}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      containerClassName="flex-1"
                    />
                    <IconButton type="submit" label="Send" variant="primary" disabled={!comment.trim() || addComment.isPending}>
                      <Send size={20} />
                    </IconButton>
                  </form>
                ) : (
                  <Callout tone="info">The host has turned chat off for this stream.</Callout>
                )
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === 'end'}
        title="End the stream?"
        description="Viewers are disconnected and the stream closes for good."
        confirmLabel="End stream"
        destructive
        loading={end.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => end.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel this stream?"
        description="It is removed from the schedule. You can create a new one at any time."
        confirmLabel="Cancel stream"
        destructive
        loading={cancel.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => cancel.mutate()}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ disabled state */

function LiveUnavailable({ streamId }: { streamId?: string }) {
  return (
    <div className="space-y-4">
      {streamId ? (
        <Callout tone="info" title="This stream cannot be opened">
          You followed a link to a stream, but live video is switched off on this server.
        </Callout>
      ) : null}
      <Card className="flex flex-col items-center gap-5 py-12 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand-text">
          <Radio size={32} />
        </span>
        <div className="max-w-md space-y-2">
          <h2 className="type-heading text-xl text-text-1">Live video is not enabled here</h2>
          <p className="text-base leading-relaxed text-text-2">
            This Vybe server runs without a live video relay, so streams cannot be hosted or watched right now. It is a server setting, not something on your device, and the rest of the app is unaffected.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ButtonLink to="/stories" variant="primary" icon={<Play size={18} />}>
            Watch stories
          </ButtonLink>
          <ButtonLink to="/discover" variant="secondary">
            Explore the community
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function Livestreams() {
  const navigate = useNavigate();
  const { streamId } = useParams<{ streamId?: string }>();
  const [tab, setTab] = useState<ListTab>('live');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => setPage(1), [tab]);

  const capabilities = useCapabilities();
  const enabled = capabilities.data?.livestreamRelay === true;

  const openStream = useCallback((id: string) => navigate(`/live/${id}`, { viewTransition: true }), [navigate]);
  const closeStream = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/live', { replace: true, viewTransition: true });
  }, [navigate]);

  const streams = useQuery({
    queryKey: ['livestreams', tab, page],
    enabled,
    queryFn: async () => {
      // One literal path per tab so the contract audit can resolve each endpoint statically.
      const params = { page, limit: PAGE };
      const { data } =
        tab === 'featured' ? await api.get('/livestreams/featured', { params })
        : tab === 'scheduled' ? await api.get('/livestreams/scheduled', { params })
        : tab === 'mine' ? await api.get('/livestreams/mine', { params })
        : await api.get('/livestreams', { params });
      return data as {
        streams: Stream[];
        pagination?: { page?: number; pages?: number; totalPages?: number; hasNext?: boolean; total?: number };
      };
    },
  });

  const list = streams.data?.streams || [];
  const pageInfo = streams.data?.pagination;
  const totalPages = pageInfo?.pages ?? pageInfo?.totalPages;
  const hasNext = pageInfo?.hasNext ?? (typeof totalPages === 'number' ? page < totalPages : list.length === PAGE);

  const header = (
    <PageHeader
      title="Live"
      subtitle="Train with the community in real time."
      back={streamId ? '/live' : undefined}
      actions={
        enabled ? (
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreateOpen(true)}>
            New stream
          </Button>
        ) : undefined
      }
      mobileActions={
        enabled ? (
          <IconButton label="New stream" onClick={() => setCreateOpen(true)}>
            <Plus size={22} />
          </IconButton>
        ) : null
      }
    />
  );

  if (capabilities.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-11 w-full max-w-md rounded-sm" />
        <StreamGridSkeleton />
      </div>
    );
  }

  if (capabilities.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          error={capabilities.error}
          title="Could not check live video availability"
          message={errMsg(capabilities.error, 'The server did not answer. Try again in a moment.')}
          onRetry={() => capabilities.refetch()}
        />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="space-y-6">
        {header}
        <LiveUnavailable streamId={streamId} />
      </div>
    );
  }

  const emptyCopy: Record<ListTab, { title: string; message: string }> = {
    live: { title: 'Nobody is live right now', message: 'Check what is scheduled, or start a stream of your own.' },
    featured: { title: 'No featured streams yet', message: 'Popular and staff-picked streams show up here once people start broadcasting.' },
    scheduled: { title: 'Nothing on the schedule', message: 'Set a time and let your followers know when you will be on.' },
    mine: { title: 'You have not streamed yet', message: 'Create a stream, go live when you are ready and chat with viewers as you train.' },
  };

  return (
    <div className="space-y-6">
      {header}

      <Tabs
        aria-label="Stream lists"
        tabs={[
          { value: 'live', label: 'Live now', icon: <Radio size={16} /> },
          { value: 'featured', label: 'Featured' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'mine', label: 'My streams' },
        ]}
        value={tab}
        onChange={(k) => setTab(k as ListTab)}
      />

      {streams.isLoading ? <StreamGridSkeleton /> : null}
      {streams.isError ? <ErrorState error={streams.error} onRetry={() => streams.refetch()} /> : null}

      {streams.isSuccess && list.length === 0 ? (
        <EmptyState
          icon={tab === 'live' ? <Radio size={26} /> : tab === 'scheduled' ? <CalendarDays size={26} /> : <Users size={26} />}
          title={emptyCopy[tab].title}
          message={emptyCopy[tab].message}
          action={{
            label: tab === 'scheduled' ? 'Schedule a stream' : tab === 'mine' ? 'Create your first stream' : 'Start a stream',
            onClick: () => setCreateOpen(true),
            icon: <Plus size={18} />,
          }}
          secondaryAction={tab === 'live' ? { label: 'See the schedule', onClick: () => setTab('scheduled') } : undefined}
        />
      ) : null}

      {list.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <StreamCard key={s._id} stream={s} onOpen={() => openStream(s._id)} />
            ))}
          </div>
          <Pager
            page={page}
            totalPages={totalPages}
            hasNext={Boolean(hasNext)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </>
      ) : null}

      <CreateStreamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          if (id) openStream(id);
          else setTab('mine');
        }}
      />
      <WatchModal streamId={streamId ?? null} onClose={closeStream} />
    </div>
  );
}
