import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { Play, Users } from './icons';

const CATEGORIES = [
  'workout',
  'yoga',
  'cardio',
  'strength',
  'nutrition',
  'motivation',
  'q&a',
  'general',
] as const;

type StreamUser = {
  _id: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  isVerified?: boolean;
};

type Stream = {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
  thumbnail?: string;
  host?: StreamUser;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  viewerCount?: number;
  likeCount?: number;
  hasLiked?: boolean;
  isHost?: boolean;
  tags?: string[];
  settings?: { visibility?: string; chatEnabled?: boolean };
};

type StreamComment = {
  _id: string;
  text: string;
  createdAt?: string;
  user?: StreamUser;
};

type Capabilities = {
  enabled?: boolean;
  livestreamEnabled?: boolean;
  chatEnabled?: boolean;
  provider?: string | null;
  [k: string]: unknown;
};

const PAGE = 20;

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
  return Number.isNaN(d.getTime()) ? '' : format(d, 'PPp');
};

function StreamCard({ stream, onOpen }: { stream: Stream; onOpen: () => void }) {
  const thumb = mediaUrl(stream.thumbnail);
  return (
    <button type="button" onClick={onOpen} className="card overflow-hidden text-left">
      <div className="relative h-32 w-full bg-[var(--color-surface-2)]">
        {thumb ? (
          <img src={thumb} alt={stream.title} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
            <Play />
          </span>
        )}
        {stream.status === 'live' && (
          <span className="absolute left-2 top-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
            LIVE
          </span>
        )}
        {stream.status === 'scheduled' && (
          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white">
            {at(stream.scheduledAt)}
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-sm font-semibold">{stream.title}</p>
        <div className="flex items-center gap-2">
          <Avatar
            src={mediaUrl(stream.host?.avatar)}
            name={stream.host?.fullName || stream.host?.username}
            size={22}
          />
          <span className="truncate text-xs text-[var(--color-muted)]">
            {stream.host?.fullName || stream.host?.username || 'Host'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {stream.category && <Badge>{stream.category}</Badge>}
          <Badge>{stream.viewerCount ?? 0} viewers</Badge>
        </div>
      </div>
    </button>
  );
}

function CreateStreamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('general');
  const [scheduledAt, setScheduledAt] = useState('');
  const [thumbnail, setThumbnail] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setCategory('general');
      setScheduledAt('');
      setThumbnail('');
      setTags('');
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        category,
      };
      if (description.trim()) payload.description = description.trim();
      if (thumbnail.trim()) payload.thumbnail = thumbnail.trim();
      if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
      const parsedTags = tags
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').trim())
        .filter(Boolean);
      if (parsedTags.length) payload.tags = parsedTags;
      const { data } = await api.post('/livestreams', payload);
      return data;
    },
    onSuccess: () => {
      toast.success('Stream created');
      qc.invalidateQueries({ queryKey: ['livestreams'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create the stream')),
  });

  return (
    <Modal open={open} onClose={onClose} title="Create a livestream">
      <div className="space-y-4">
        <Input
          placeholder="Title"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          rows={3}
          placeholder="Description (optional)"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-[var(--color-muted)]">
            Category
            <select
              className="input-base"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--color-muted)]">
            Schedule (optional)
            <input
              type="datetime-local"
              className="input-base"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
        </div>
        <Input
          placeholder="Thumbnail URL or media key (optional)"
          value={thumbnail}
          onChange={(e) => setThumbnail(e.target.value)}
        />
        <Input
          placeholder="Tags (space separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={title.trim().length < 3 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner size={16} /> : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function WatchModal({
  streamId,
  onClose,
  chatEnabled,
}: {
  streamId: string | null;
  onClose: () => void;
  chatEnabled: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [comment, setComment] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    setComment('');
    setJoined(false);
  }, [streamId]);

  const detail = useQuery({
    queryKey: ['livestream', streamId],
    enabled: Boolean(streamId),
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await api.get(`/livestreams/${streamId}`);
      return (data.stream || data.data || data) as Stream;
    },
  });

  const comments = useQuery({
    queryKey: ['livestream', streamId, 'comments'],
    enabled: Boolean(streamId),
    refetchInterval: 8000,
    queryFn: async () => {
      const { data } = await api.get(`/livestreams/${streamId}/comments`, {
        params: { page: 1, limit: 50 },
      });
      return (data.comments || []) as StreamComment[];
    },
  });

  const join = useMutation({
    mutationFn: async () => {
      await api.post(`/livestreams/${streamId}/join`);
    },
    onSuccess: () => {
      setJoined(true);
      detail.refetch();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not join the stream')),
  });

  const leave = useMutation({
    mutationFn: async () => {
      await api.post(`/livestreams/${streamId}/leave`);
    },
    onSuccess: () => {
      setJoined(false);
      detail.refetch();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not leave the stream')),
  });

  const like = useMutation({
    mutationFn: async () => {
      await api.post(`/livestreams/${streamId}/like`);
    },
    onSuccess: () => detail.refetch(),
    onError: (e) => toast.error(errMsg(e, 'Could not like the stream')),
  });

  const start = useMutation({
    mutationFn: async () => {
      await api.put(`/livestreams/${streamId}/start`);
    },
    onSuccess: () => {
      toast.success('You are live');
      detail.refetch();
      qc.invalidateQueries({ queryKey: ['livestreams'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not start the stream')),
  });

  const end = useMutation({
    mutationFn: async () => {
      await api.put(`/livestreams/${streamId}/end`);
    },
    onSuccess: () => {
      toast.success('Stream ended');
      setConfirmEnd(false);
      detail.refetch();
      qc.invalidateQueries({ queryKey: ['livestreams'] });
    },
    onError: (e) => {
      toast.error(errMsg(e, 'Could not end the stream'));
      setConfirmEnd(false);
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
    onError: (e) => toast.error(errMsg(e, 'Could not send the comment')),
  });

  const stream = detail.data;
  const isHost = Boolean(stream?.isHost || (stream?.host?._id && stream.host._id === me?._id));

  // Register as a viewer once the stream is live and the viewer is not the host.
  useEffect(() => {
    if (!streamId || !stream || isHost || joined) return;
    if (stream.status === 'live') join.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, stream?.status, isHost]);

  useEffect(
    () => () => {
      if (joined && streamId) leave.mutate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamId],
  );

  return (
    <Modal open={Boolean(streamId)} onClose={onClose} title={stream?.title || 'Livestream'}>
      {detail.isLoading && <Skeleton className="h-48 w-full" />}
      {detail.isError && (
        <ErrorState message={errMsg(detail.error)} onRetry={() => detail.refetch()} />
      )}
      {stream && (
        <div className="space-y-4">
          <div className="relative h-56 w-full overflow-hidden rounded-xl bg-black">
            {mediaUrl(stream.thumbnail) ? (
              <img
                src={mediaUrl(stream.thumbnail)}
                alt={stream.title}
                className="h-full w-full object-cover opacity-70"
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs uppercase tracking-wide text-white">
                {stream.status}
              </span>
              {stream.status === 'scheduled' && (
                <p className="text-sm text-white">Starts {at(stream.scheduledAt)}</p>
              )}
              {stream.status === 'ended' && (
                <p className="text-sm text-white">Ended {ago(stream.endedAt)}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Avatar
                src={mediaUrl(stream.host?.avatar)}
                name={stream.host?.fullName || stream.host?.username}
                size={36}
              />
              <div>
                <p className="text-sm font-medium">
                  {stream.host?.fullName || stream.host?.username}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {stream.viewerCount ?? 0} viewers · {stream.likeCount ?? 0} likes
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {!isHost && stream.status === 'live' && (
                <Button variant="ghost" disabled={like.isPending} onClick={() => like.mutate()}>
                  {stream.hasLiked ? 'Liked' : 'Like'}
                </Button>
              )}
              {isHost && stream.status === 'scheduled' && (
                <Button disabled={start.isPending} onClick={() => start.mutate()}>
                  {start.isPending ? <Spinner size={16} /> : 'Go live'}
                </Button>
              )}
              {isHost && stream.status === 'live' && (
                <Button variant="ghost" onClick={() => setConfirmEnd(true)}>
                  End stream
                </Button>
              )}
            </div>
          </div>

          {stream.description && <p className="text-sm">{stream.description}</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Live chat</h3>
            {comments.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            {comments.isError && (
              <ErrorState message={errMsg(comments.error)} onRetry={() => comments.refetch()} />
            )}
            {comments.isSuccess && (comments.data?.length || 0) === 0 && (
              <EmptyState title="No comments yet" description="Start the conversation." />
            )}
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {(comments.data || []).map((c) => (
                <li key={c._id} className="flex gap-2">
                  <Avatar
                    src={mediaUrl(c.user?.avatar)}
                    name={c.user?.fullName || c.user?.username}
                    size={26}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {c.user?.fullName || c.user?.username || 'Viewer'}{' '}
                      <span className="font-normal text-[var(--color-muted)]">
                        {ago(c.createdAt)}
                      </span>
                    </p>
                    <p className="break-words text-sm">{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            {chatEnabled && stream.status === 'live' && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = comment.trim();
                  if (text) addComment.mutate(text);
                }}
              >
                <Input
                  placeholder="Say something…"
                  maxLength={300}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <Button type="submit" disabled={!comment.trim() || addComment.isPending}>
                  {addComment.isPending ? <Spinner size={16} /> : 'Send'}
                </Button>
              </form>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmEnd}
        title="End livestream"
        description="Viewers will be disconnected and the stream will be closed."
        confirmLabel="End stream"
        destructive
        loading={end.isPending}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => end.mutate()}
      />
    </Modal>
  );
}

export default function Livestreams() {
  const [tab, setTab] = useState('live');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);

  useEffect(() => setPage(1), [tab]);

  const capabilities = useQuery({
    queryKey: ['livestreams', 'capabilities'],
    queryFn: async () => {
      const { data } = await api.get('/livestreams/capabilities');
      return (data.capabilities || {}) as Capabilities;
    },
  });

  const enabled = useMemo(() => {
    const c = capabilities.data;
    if (!c) return true;
    if (typeof c.enabled === 'boolean') return c.enabled;
    if (typeof c.livestreamEnabled === 'boolean') return c.livestreamEnabled;
    return true;
  }, [capabilities.data]);

  const chatEnabled = capabilities.data?.chatEnabled !== false;

  const path =
    tab === 'live'
      ? '/livestreams'
      : tab === 'featured'
        ? '/livestreams/featured'
        : tab === 'scheduled'
          ? '/livestreams/scheduled'
          : '/livestreams/mine';

  const streams = useQuery({
    queryKey: ['livestreams', tab, page],
    enabled,
    queryFn: async () => {
      const { data } = await api.get(path, { params: { page, limit: PAGE } });
      return data as {
        streams: Stream[];
        pagination?: { page?: number; pages?: number; totalPages?: number; hasNext?: boolean };
      };
    },
  });

  const list = streams.data?.streams || [];
  const pageInfo = streams.data?.pagination;
  const totalPages = pageInfo?.pages ?? pageInfo?.totalPages ?? 1;
  const hasNext = pageInfo?.hasNext ?? page < totalPages;

  if (capabilities.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card className="p-8">
          <EmptyState
            icon={<Play />}
            title="Livestreams are unavailable"
            description="Live video is currently disabled on this deployment. Check back later."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Livestreams</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Train with the community in real time.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create stream</Button>
      </header>

      <Tabs
        tabs={[
          { value: 'live', label: 'Live now' },
          { value: 'featured', label: 'Featured' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'mine', label: 'My streams' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {streams.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      )}

      {streams.isError && (
        <ErrorState message={errMsg(streams.error)} onRetry={() => streams.refetch()} />
      )}

      {streams.isSuccess && list.length === 0 && (
        <Card className="p-6">
          <EmptyState
            icon={<Users />}
            title="Nothing here yet"
            description={
              tab === 'mine'
                ? 'Create your first stream to get started.'
                : 'No streams in this section right now.'
            }
          />
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <StreamCard key={s._id} stream={s} onOpen={() => setWatchId(s._id)} />
        ))}
      </div>

      {list.length > 0 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-[var(--color-muted)]">
            Page {page} of {totalPages}
          </span>
          <Button variant="ghost" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <CreateStreamModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <WatchModal
        streamId={watchId}
        chatEnabled={chatEnabled}
        onClose={() => setWatchId(null)}
      />
    </div>
  );
}
