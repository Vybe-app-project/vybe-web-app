import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, uploadImage } from '../lib/hooks';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardMedia,
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
  Tabs,
  Textarea,
  cx,
  useToast,
} from './ui';
import { CalendarDays, ChevronLeft, ChevronRight, Eye, Image as ImageIcon, Play, Plus, Radio, Users, X } from './icons';
import LiveRoom from './LiveRoom';
import { CATEGORY_OPTIONS, at, categoryLabel, hostOf, hostName, viewersOf, type Stream } from './liveTypes';

/* ------------------------------------------------------------------ types */

/** GET /api/capabilities — the server's honest report of what is configured. */
type ServerCapabilities = {
  livestreamRelay?: boolean;
  turnRelay?: boolean;
  [k: string]: unknown;
};

type ListTab = 'live' | 'featured' | 'scheduled' | 'mine';

const PAGE = 18;

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

/* ------------------------------------------------------------------ pieces */

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

function StreamCard({ stream, onOpen, mine }: { stream: Stream; onOpen: () => void; mine: boolean }) {
  const thumb = mediaUrl(stream.thumbnail);
  const host = hostOf(stream);
  const verb = mine ? (stream.status === 'live' ? 'manage your broadcast' : stream.status === 'scheduled' ? 'set up' : 'open') : stream.status === 'live' ? 'watch' : 'open';
  return (
    <button type="button" onClick={onOpen} className="card card-interactive w-full p-3 text-left" aria-label={`${stream.title} — ${verb}`}>
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
          <span className="min-w-0 truncate text-xs text-text-2">{mine ? 'You' : hostName(stream)}</span>
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

function CreateStreamModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** `instant` is true when the host wants to go live now rather than at a scheduled time. */
  onCreated: (id: string | undefined, instant: boolean) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [visibility, setVisibility] = useState('public');
  const [scheduledAt, setScheduledAt] = useState('');
  /** Owned media key from the upload endpoint; the server verifies ownership on create. */
  const [thumbnail, setThumbnail] = useState('');
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [tags, setTags] = useState('');

  const clearThumbnail = useCallback(() => {
    setThumbnail('');
    setThumbnailPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setTitleTouched(false);
      setDescription('');
      setCategory('general');
      setVisibility('public');
      setScheduledAt('');
      clearThumbnail();
      setTags('');
    }
  }, [open, clearThumbnail]);

  const pickThumbnail = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('Use a JPEG, PNG, WebP or HEIC image for the thumbnail.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('The thumbnail must be 10 MB or smaller.');
      return;
    }
    setUploadingThumbnail(true);
    try {
      // The same owned-media upload post photos use; the server accepts that
      // purpose for stream thumbnails and re-verifies ownership on create.
      const uploaded = await uploadImage(file, 'posts');
      setThumbnail(uploaded.key);
      setThumbnailPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
    } catch (e) {
      toast.error(errMsg(e, 'Could not upload the thumbnail'));
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const parsedTags = tags
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  const titleError = titleTouched && title.trim().length < 3 ? 'Give the stream a title of at least 3 characters.' : null;
  const tagsError = parsedTags.length > 10 ? 'Use at most 10 tags.' : parsedTags.some((t) => t.length > 30) ? 'Each tag must be 30 characters or fewer.' : null;
  const scheduleError = scheduledAt && Number.isNaN(new Date(scheduledAt).getTime()) ? 'Pick a valid date and time.' : null;
  const canSubmit = title.trim().length >= 3 && !tagsError && !scheduleError && !uploadingThumbnail;

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        category,
        settings: { visibility, allowComments: true, allowGifts: true },
      };
      if (description.trim()) payload.description = description.trim();
      if (thumbnail.trim()) payload.thumbnail = thumbnail.trim();
      if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
      if (parsedTags.length) payload.tags = parsedTags;
      const { data } = await api.post('/livestreams', payload);
      return (data?.stream || data?.data || data) as Partial<Stream>;
    },
    onSuccess: (data) => {
      toast.success(scheduledAt ? 'Stream scheduled' : 'Stream created — set up your camera next');
      qc.invalidateQueries({ queryKey: ['livestreams'] });
      onClose();
      onCreated(data?._id, !scheduledAt);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not create the stream')),
  });

  const minSchedule = format(new Date(), "yyyy-MM-dd'T'HH:mm");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={scheduledAt ? 'Schedule a stream' : 'Go live'}
      description="Name the session and choose who can watch. Your camera is set up on the next screen; nothing is captured until you enable it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()} icon={scheduledAt ? <CalendarDays size={18} /> : <Radio size={18} />}>
            {scheduledAt ? 'Schedule stream' : 'Continue to camera setup'}
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
          <Select
            label="Audience"
            options={[
              { value: 'public', label: 'Everyone', description: 'Anyone on Vybe can join' },
              { value: 'followers', label: 'Followers', description: 'Only people who follow you' },
            ]}
            value={visibility}
            onChange={setVisibility}
          />
        </div>
        <DateField
          type="datetime-local"
          label="Schedule for"
          hint="Leave empty to go live as soon as your camera is ready."
          min={minSchedule}
          value={scheduledAt}
          error={scheduleError}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
        <div>
          <span id="stream-thumbnail-label" className="type-label mb-1.5 block text-text-2">
            Thumbnail
          </span>
          <div className="flex flex-wrap items-center gap-3" role="group" aria-labelledby="stream-thumbnail-label">
            {thumbnailPreview ? (
              <img src={thumbnailPreview} alt="Thumbnail preview" className="h-14 w-24 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-3" aria-hidden="true">
                <ImageIcon size={22} />
              </span>
            )}
            <Button variant="secondary" size="sm" loading={uploadingThumbnail} disabled={create.isPending} onClick={() => fileRef.current?.click()} icon={<ImageIcon size={16} />}>
              {thumbnail ? 'Replace image' : 'Add image'}
            </Button>
            {thumbnail ? (
              <Button variant="ghost" size="sm" disabled={uploadingThumbnail || create.isPending} onClick={clearThumbnail} icon={<X size={16} />}>
                Remove
              </Button>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-text-3">Optional. Shown on your stream’s card. JPEG, PNG, WebP or HEIC up to 10 MB.</p>
          <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} hidden onChange={(e) => void pickThumbnail(e.target.files?.[0])} />
        </div>
        <Input
          label="Tags"
          hint="Optional. Up to 10, separated by spaces or commas."
          placeholder="legday strength pr"
          value={tags}
          error={tagsError}
          onChange={(e) => setTags(e.target.value)}
        />
        <button type="submit" className="sr-only">
          {scheduledAt ? 'Schedule stream' : 'Continue to camera setup'}
        </button>
      </form>
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

  const openStream = useCallback(
    (id: string, options?: { instant?: boolean }) =>
      // History state, not a query flag: the room uses it to discard a stream
      // created for an immediate broadcast if the host leaves without starting.
      navigate(`/live/${id}`, { viewTransition: true, state: options?.instant ? { instant: true } : undefined }),
    [navigate],
  );

  const streams = useQuery({
    queryKey: ['livestreams', tab, page],
    enabled: enabled && !streamId,
    // Live counts move; keep the grid fresh without hammering the API.
    refetchInterval: tab === 'live' ? 30_000 : false,
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
        pagination?: { page?: number; pages?: number; totalPages?: number; hasNextPage?: boolean; hasNext?: boolean; total?: number };
      };
    },
  });

  const list = streams.data?.streams || [];
  const pageInfo = streams.data?.pagination;
  const totalPages = pageInfo?.pages ?? pageInfo?.totalPages;
  const hasNext = pageInfo?.hasNextPage ?? pageInfo?.hasNext ?? (typeof totalPages === 'number' ? page < totalPages : list.length === PAGE);

  const header = (
    <PageHeader
      title="Live"
      subtitle="Train with the community in real time."
      actions={
        enabled ? (
          <Button variant="primary" icon={<Radio size={18} />} onClick={() => setCreateOpen(true)}>
            Go live
          </Button>
        ) : undefined
      }
      mobileActions={
        enabled ? (
          <IconButton label="Go live" onClick={() => setCreateOpen(true)}>
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

  if (streamId) return <LiveRoom streamId={streamId} />;

  const emptyCopy: Record<ListTab, { title: string; message: string }> = {
    live: { title: 'Nobody is live right now', message: 'Check what is scheduled, or go live yourself.' },
    featured: { title: 'No featured streams yet', message: 'Popular and staff-picked streams show up here once people start broadcasting.' },
    scheduled: { title: 'Nothing on the schedule', message: 'Set a time and let your followers know when you will be on.' },
    mine: { title: 'You have not streamed yet', message: 'Go live from your camera and chat with viewers as you train.' },
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
            label: tab === 'scheduled' ? 'Schedule a stream' : 'Go live',
            onClick: () => setCreateOpen(true),
            icon: <Radio size={18} />,
          }}
          secondaryAction={tab === 'live' ? { label: 'See the schedule', onClick: () => setTab('scheduled') } : undefined}
        />
      ) : null}

      {list.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <StreamCard key={s._id} stream={s} mine={tab === 'mine'} onOpen={() => openStream(s._id)} />
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
        onCreated={(id, instant) => {
          if (id) openStream(id, { instant });
          else setTab('mine');
        }}
      />
    </div>
  );
}
