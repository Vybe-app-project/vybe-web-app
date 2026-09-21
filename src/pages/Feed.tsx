import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useHomeGym } from '../lib/homeGym';
import { FEED_PAGE_SIZE, dedupeById, nextFeedPageParam, type FeedPageParam } from '../lib/feedLogic';
// P8a: the feed modes. Following (`mode=latest`) is the default and stays
// the default; For you is the ranker behind `feedForYou`.
import {
  FEED_MODE_LABELS,
  HOME_FEED_MODES,
  feedModeParams,
  isFeatureDisabled,
  readFeedMode,
  useFeedForYou,
  writeFeedMode,
  type FeedMode,
  type FeedResponse,
} from '../lib/feedControls';
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  MAX_POST_MEDIA,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  captureVideoPoster,
  displayName,
  extractHashtags,
  uploadContentType,
  uploadImage,
  uploadPresigned,
  useInfiniteScroll,
  type PagedPosts,
  type Post,
  type UploadedMedia,
} from '../lib/hooks';
import {
  Avatar,
  AvatarStack,
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  SegmentedControl,
  Spinner,
  Textarea,
  cx,
  prefersReducedMotion,
  useIsTouch,
  useOnline,
  useToast,
} from './ui';
import { ArrowUp, Image as ImageIcon, Refresh, UserPlus, Video as VideoIcon, X } from './icons';
import { GymHeader } from '../components/GymHeader';
import PostCard, { PostCardSkeleton, isAuthorHidden, useHiddenAuthors } from './PostCard';
import { StoryTray } from './StoryTray';
import FirstWeekCard from './FirstWeekCard';
import RhythmCard from './RhythmCard';

const MAX_CHARS = 2000;

type Attachment = UploadedMedia & { preview: string; thumbnail?: string };

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

function Composer({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const photoRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  const [content, setContent] = useState('');
  const [medias, setMedias] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty = content.trim().length > 0 || medias.length > 0;

  const reset = useCallback(() => {
    setContent('');
    setMedias((prev) => {
      prev.forEach((m) => URL.revokeObjectURL(m.preview));
      return [];
    });
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      const text = content.trim();
      const { data } = await api.post('/posts/create', {
        content: text,
        medias: medias.map((m) => ({ type: m.type, key: m.key, url: m.url, ...(m.thumbnail ? { thumbnail: m.thumbnail } : {}) })),
        hashtags: extractHashtags(text),
        isPublic: true,
      });
      return data;
    },
    onSuccess: () => {
      reset();
      onClose();
      toast.success('Post shared');
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['trending-hashtags'] });
    },
    onError: (e) => toast.error(e, 'Could not share your post.'),
  });

  /**
   * Photos go through the multipart /upload/image route; video uses the
   * presigned flow (like stories) and gets a first-frame poster captured in
   * the browser so the card shows a picture before play.
   */
  async function addFiles(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const room = MAX_POST_MEDIA - medias.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_POST_MEDIA} photos or videos per post.`);
      return;
    }
    const selected = list.slice(0, room);
    if (list.length > room) toast.info(`Only the first ${room} ${room === 1 ? 'file was' : 'files were'} added — ${MAX_POST_MEDIA} per post.`);

    onOpen();
    setUploading(true);
    try {
      for (const file of selected) {
        const contentType = uploadContentType(file);
        if (!contentType) {
          toast.error(`${file.name}: use a JPEG, PNG, WebP or HEIC photo, or an MP4 or MOV video.`);
          continue;
        }
        const isVideo = ACCEPTED_VIDEO_TYPES.includes(contentType);
        if (file.size > (isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES)) {
          toast.error(`${file.name} is over ${isVideo ? '50' : '10'} MB.`);
          continue;
        }
        if (isVideo) {
          const [uploaded, poster] = await Promise.all([uploadPresigned(file, contentType, 'media'), captureVideoPoster(file)]);
          let thumbnail: string | undefined;
          if (poster) {
            try {
              thumbnail = (await uploadPresigned(poster, 'image/jpeg', 'media')).key;
            } catch {
              // No poster is fine; the card falls back to the browser's first frame.
            }
          }
          setMedias((prev) => [...prev, { type: 'video', key: uploaded.key, url: uploaded.key, size: file.size, thumbnail, preview: URL.createObjectURL(file) }]);
        } else {
          const uploaded = await uploadImage(file, 'posts');
          setMedias((prev) => [...prev, { ...uploaded, preview: URL.createObjectURL(file) }]);
        }
      }
    } catch (e) {
      toast.error(e, 'Upload failed.');
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = '';
      if (videoRef.current) videoRef.current.value = '';
    }
  }

  function removeMedia(index: number) {
    setMedias((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  }

  function cancel() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  const canPost = dirty && !create.isPending && !uploading;
  const remaining = MAX_CHARS - content.length;
  const full = medias.length >= MAX_POST_MEDIA;

  const fileInputs = (
    <>
      <input ref={photoRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => void addFiles(e.target.files)} />
      <input ref={videoRef} type="file" accept={ACCEPTED_VIDEO_TYPES.join(',')} hidden onChange={(e) => void addFiles(e.target.files)} />
    </>
  );

  /* Closed: one quiet row like a comment field — avatar, the prompt in the
     placeholder colour, the media icons — not a bordered box on the white page. */
  if (!open) {
    return (
      <div className="flex min-h-12 items-center gap-3 pt-1">
        {fileInputs}
        <Avatar src={me?.avatar} name={displayName(me)} size={32} />
        <button type="button" onClick={onOpen} className="pressable t-body flex min-h-11 min-w-0 flex-1 items-center rounded-sm text-left text-text-2">
          <span className="truncate">Share a session, a win or a meal…</span>
        </button>
        <IconButton label="Add a photo" size={40} onClick={() => photoRef.current?.click()}>
          <ImageIcon size={24} />
        </IconButton>
        {/* IconButton sets its own display, so `hidden` on it cannot win; the wrapper hides it on phones. */}
        <span className="hidden sm:contents">
          <IconButton label="Add a video" size={40} onClick={() => videoRef.current?.click()}>
            <VideoIcon size={24} />
          </IconButton>
        </span>
      </div>
    );
  }

  return (
    <div aria-label="New post" role="form" className="pt-3">
      {fileInputs}
      <div className="flex gap-3">
        <Avatar src={me?.avatar} name={displayName(me)} size="md" className="mt-0.5 hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <Textarea
            label="What do you want to share?"
            hideLabel
            autoFocus
            autoGrow
            rows={3}
            maxRows={12}
            maxLength={MAX_CHARS}
            placeholder="Share a session, a win or a meal… #hashtags become links"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={onPaste}
            disabled={create.isPending}
          />

          {medias.length > 0 || uploading ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
              {medias.map((m, i) => (
                <li key={m.preview} className="relative h-22 w-22 overflow-hidden rounded-md bg-surface-2">
                  {m.type === 'video' ? (
                    <video src={m.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label={`Video ${i + 1}`} />
                  ) : (
                    <img src={m.preview} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                  )}
                  {m.type === 'video' ? (
                    <span className="absolute bottom-1 left-1 grid h-6 w-6 place-items-center rounded-full bg-scrim text-[var(--navy-50)]" aria-hidden="true">
                      <VideoIcon size={14} />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${m.type === 'video' ? 'video' : 'photo'} ${i + 1}`}
                    onClick={() => removeMedia(i)}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-scrim text-[var(--navy-50)] before:absolute before:-inset-2 before:content-[''] hover:bg-danger"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
              {uploading ? (
                <li className="grid h-22 w-22 place-items-center rounded-md bg-surface-2 text-text-2" aria-label="Uploading">
                  <Spinner size={20} />
                </li>
              ) : null}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              icon={<ImageIcon size={20} />}
              onClick={() => photoRef.current?.click()}
              disabled={uploading || full || create.isPending}
            >
              Photo
            </Button>
            <Button
              variant="ghost"
              icon={<VideoIcon size={20} />}
              onClick={() => videoRef.current?.click()}
              disabled={uploading || full || create.isPending}
            >
              Video
            </Button>
            {medias.length ? (
              <span className="tabular text-xs text-text-3" aria-live="polite">
                {medias.length}/{MAX_POST_MEDIA}
              </span>
            ) : null}
            {content.length > 0 ? (
              <span
                className={cx('tabular text-xs', remaining < 100 ? 'text-warning-text' : 'text-text-3')}
                aria-live="polite"
              >
                {remaining} left
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={cancel} disabled={create.isPending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => create.mutate()} disabled={!canPost} loading={create.isPending}>
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this post?"
        message="Your text and attachments will be removed."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          reset();
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pull to refresh (touch)                                             */
/* ------------------------------------------------------------------ */

const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
const PULL_DAMPING = 0.5;

function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled: boolean) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let tracking = false;

    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || window.scrollY > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pullRef.current) set(0);
        setDragging(false);
        return;
      }
      setDragging(true);
      set(Math.min(PULL_MAX, dy * PULL_DAMPING));
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      startY = null;
      setDragging(false);
      if (pullRef.current >= PULL_THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        set(PULL_THRESHOLD * 0.75);
        Promise.resolve(cb.current()).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          set(0);
        });
      } else {
        set(0);
      }
    };

    // Our indicator replaces the browser's own pull gesture while the feed is mounted.
    const previous = document.body.style.overscrollBehaviorY;
    document.body.style.overscrollBehaviorY = 'contain';
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.body.style.overscrollBehaviorY = previous;
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  return { pull, dragging, refreshing };
}

/**
 * The refresh disc: a 36 px circle that rides down on `translateY` with the
 * pull and fades in with it. The wrapper is 0 px tall, so the page under it
 * never changes height — the one thing that used to animate on this screen.
 */
function PullIndicator({ pull, dragging, refreshing }: { pull: number; dragging: boolean; refreshing: boolean }) {
  const active = pull > 0 || refreshing;
  const progress = Math.min(1, pull / PULL_THRESHOLD);
  const ready = progress >= 1 || refreshing;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none relative z-30 h-0">
      <div
        aria-hidden="true"
        className={cx(
          'absolute left-1/2 top-0 grid h-9 w-9 place-items-center rounded-full bg-surface-1 shadow-2',
          dragging ? 'transition-none' : 'transition-[transform,opacity,color] dur-2 ease-out',
          ready ? 'text-brand' : 'text-text-2',
        )}
        style={{ transform: `translate(-50%, ${active ? pull - 44 : -56}px)`, opacity: active ? 0.35 + progress * 0.65 : 0 }}
      >
        {refreshing ? <Spinner size={18} /> : <Refresh size={18} style={{ transform: `rotate(${progress * 270}deg)` }} />}
      </div>
      <span className="sr-only">{active ? (refreshing ? 'Refreshing your feed' : ready ? 'Release to refresh' : 'Pull to refresh') : ''}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "New posts" pill                                                    */
/* ------------------------------------------------------------------ */

function NewPostsPill({ fresh, onShow, busy }: { fresh: Post[]; onShow: () => void; busy: boolean }) {
  if (!fresh.length) return null;
  const seen = new Set<string>();
  const authors = fresh
    .map((p) => p.author)
    .filter((a): a is NonNullable<Post['author']> => !!a && !seen.has(a._id) && !!seen.add(a._id))
    .map((a) => ({ src: a.avatar, name: displayName(a) }));
  return (
    <div className="pointer-events-none sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 flex justify-center lg:top-[4.5rem]">
      <button
        type="button"
        onClick={onShow}
        disabled={busy}
        className="btn btn-primary anim-pop-in pointer-events-auto h-11 rounded-full pl-2 pr-4 shadow-2"
      >
        {authors.length ? <AvatarStack users={authors} size="xs" max={3} /> : null}
        <span className="tabular">{fresh.length === 1 ? '1 new post' : `${fresh.length} new posts`}</span>
        {busy ? <Spinner size={16} /> : <ArrowUp size={18} />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

export default function Feed() {
  const qc = useQueryClient();
  const online = useOnline();
  const touch = useIsTouch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composerOpen, setComposerOpen] = useState(false);
  const [showingNew, setShowingNew] = useState(false);
  // P8a: Following | For you. Remembered, but Following is what a new
  // account and a browser that refuses storage both get.
  const forYouOffered = useFeedForYou();
  const [mode, setMode] = useState<FeedMode>(readFeedMode);
  const toast = useToast();
  const hidden = useHiddenAuthors((s) => s.ids);
  const unhide = useHiddenAuthors((s) => s.unhide);
  // The viewer's gym: the shell's one read, drawn here as the compact header
  // at the top of the feed; it also names the stories row and the empty state.
  const home = useHomeGym();
  const gymName = home.gym?.name ?? '';

  // Deep link contract: /?compose=1 (Log sheet, manifest shortcut, /create)
  // opens the composer once. `?share=<logId>` rides along from a logged
  // session's "Share to feed"; the composer cannot attach a workout yet
  // (POST /posts/create takes content and media only), so the id is dropped
  // with `compose` rather than left in the URL saying nothing.
  const compose = searchParams.get('compose') === '1';
  useEffect(() => {
    if (!compose) return;
    setComposerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('compose');
    next.delete('share');
    setSearchParams(next, { replace: true });
  }, [compose, searchParams, setSearchParams]);

  // Page 1 by number, later pages by the token the previous answer gave —
  // `?before=` for Following, `?cursor=` for For you — so a post published
  // mid-scroll never shifts the window and repeats a card. The key carries
  // the mode, and `['feed']` is still its prefix, so every existing
  // invalidation (a like, a comment, a delete) reaches both.
  const feed = useInfiniteQuery<FeedResponse, Error, { pages: FeedResponse[]; pageParams: FeedPageParam[] }, string[], FeedPageParam>({
    queryKey: ['feed', mode],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/posts/feed', { params: feedModeParams(mode, pageParam, FEED_PAGE_SIZE) });
      return data as FeedResponse;
    },
    getNextPageParam: (last, all) => nextFeedPageParam(last, all.length),
    // A flag that went off for this caller cannot succeed on retry.
    retry: (count, err) => !isFeatureDisabled(err) && count < 2,
  });

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = feed;

  const allPosts = useMemo(() => dedupeById(data?.pages.flatMap((p) => p.posts || []) ?? []), [data]);
  const posts = useMemo(() => allPosts.filter((p) => !isAuthorHidden(hidden, p)), [allPosts, hidden]);
  const hiddenCount = allPosts.length - posts.length;

  // Quiet poll of the first page: surfaces a "New posts" pill instead of a Refresh button.
  // Only Following polls. A ranked list has no "newest" to be behind, and a
  // pill that appears because the ranking moved is engagement bait.
  const peek = useQuery({
    queryKey: ['feed', 'peek'],
    enabled: mode === 'latest' && allPosts.length > 0 && online,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await api.get('/posts/feed', { params: { page: 1, limit: FEED_PAGE_SIZE } });
      return data as PagedPosts;
    },
  });

  const fresh = useMemo(() => {
    const candidates = peek.data?.posts || [];
    if (!candidates.length || !allPosts.length) return [];
    const known = new Set(allPosts.map((p) => p._id));
    const newest = Math.max(...allPosts.map((p) => new Date(p.createdAt).getTime() || 0));
    return candidates.filter(
      (p) => !known.has(p._id) && (new Date(p.createdAt).getTime() || 0) > newest && !isAuthorHidden(hidden, p),
    );
  }, [peek.data, allPosts, hidden]);

  const refreshFeed = useCallback(() => qc.invalidateQueries({ queryKey: ['feed'] }), [qc]);

  /**
   * The server has the last word on the mode, twice over. It answers `404
   * FEATURE_DISABLED` when the flag went off for this caller mid-session,
   * and it answers **Latest with `modeUnavailable: 'age'`** for a known
   * minor who asked for For you (D-91). Both drop the preference rather
   * than leaving someone on a segment that is not what they are reading.
   */
  const served = data?.pages[0]?.mode;
  const ageLimited = data?.pages[0]?.modeUnavailable === 'age';
  const refused = mode !== 'latest' && (isError && isFeatureDisabled(error));
  useEffect(() => {
    if (mode === 'latest') return;
    if (refused || ageLimited) {
      setMode('latest');
      writeFeedMode('latest');
      if (ageLimited) toast.info('For you is not available on your account. This is Following.');
    }
  }, [mode, refused, ageLimited, toast]);

  const pickMode = (next: FeedMode) => {
    if (next === mode) return;
    setMode(next);
    writeFeedMode(next);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  /** What the pill shows as active: the mode the answer came back in. */
  const activeMode: FeedMode = served === 'foryou' || served === 'latest' ? served : mode;

  const showNew = async () => {
    setShowingNew(true);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    try {
      await refreshFeed();
    } finally {
      setShowingNew(false);
    }
  };

  const pullState = usePullToRefresh(refreshFeed, touch && !isLoading);

  const sentinelRef = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, !!hasNextPage);

  const openComposer = () => {
    setComposerOpen(true);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div>
      <PageHeader title="Home" />

      {/* The gym as Instagram draws an account: one 72 px row flush under the
          top bar and bled to the viewport (the shell insets <main> by a gutter
          and pads its top 16/24 px). No gym: the 48 px "Find your gym" row —
          the one place Home says it. Both states are the header's own. */}
      <GymHeader variant="compact" gym={home.gym} member={home.member} loading={home.loading} className="-mx-gutter -mt-4 lg:-mt-6" />
      <PullIndicator {...pullState} />
      <NewPostsPill fresh={fresh} onShow={() => void showNew()} busy={showingNew} />

      {/* One region under a hairline: the stories row, the mode pill, the
          composer docked beneath. Nothing boxed on the white page. The pill
          is absent entirely while `feedForYou` is off, so a deployment
          without the ranker shows exactly what it always showed. */}
      <div className="feed-rule pb-3">
        <StoryTray variant="home" label={gymName ? `At ${gymName}` : undefined} />
        {forYouOffered ? (
          <SegmentedControl
            aria-label="Feed"
            className="mt-3 max-w-64"
            active={activeMode}
            onChange={(k) => pickMode(k as FeedMode)}
            tabs={HOME_FEED_MODES.map((key) => ({ key, label: FEED_MODE_LABELS[key] }))}
          />
        ) : null}
        <Composer open={composerOpen} onOpen={() => setComposerOpen(true)} onClose={() => setComposerOpen(false)} />
      </div>
      <FirstWeekCard className="my-4" />
      {/* The Get started card owns the first week; the rhythm card takes the
          same slot once that window has passed, so only one is ever here. */}
      <RhythmCard className="my-4" />

      {isLoading ? (
        <div aria-busy="true" aria-label="Loading your feed">
          {Array.from({ length: 3 }).map((_, i) => (
            <PostCardSkeleton key={i} media={i !== 1} />
          ))}
        </div>
      ) : null}

      {isError && !isLoading ? (
        <ErrorState error={error} title="We couldn’t load your feed" onRetry={() => refetch()} />
      ) : null}

      {!isLoading && !isError && allPosts.length === 0 ? (
        activeMode === 'foryou' ? (
          /* For you ranks the graph; with no graph there is nothing to rank,
             and the honest next step is Following, not an infinite list of
             strangers. */
          <EmptyState
            family="social"
            title="Nothing for you yet"
            message="For you ranks the people you train near and follow. Follow a few and it fills in — Following is the whole feed meanwhile."
            action={{ label: 'Back to Following', onClick: () => pickMode('latest'), variant: 'secondary' }}
            secondaryAction={{ label: 'Find people', to: '/discover', icon: <UserPlus size={18} /> }}
          />
        ) : (
          <EmptyState
            family="social"
            title="Your feed is quiet"
            message={
              gymName
                ? `Follow the people who train at ${gymName} and their sessions show up here.`
                : 'Follow a few athletes and their sessions will show up here.'
            }
            action={{ label: 'Find people to follow', to: '/discover', icon: <UserPlus size={18} /> }}
            secondaryAction={{ label: 'Share your first post', onClick: openComposer }}
          />
        )
      ) : null}

      {!isLoading && !isError && allPosts.length > 0 && posts.length === 0 ? (
        <EmptyState
          variant="no-results"
          title="Everything here is from people you muted"
          message="Unmute them to see their posts again, or find more people to follow."
          action={{ label: 'Unmute everyone', onClick: () => Object.keys(hidden).forEach(unhide), variant: 'secondary' }}
          secondaryAction={{ label: 'Find people', to: '/discover' }}
        />
      ) : null}

      {posts.length ? (
        <div>
          {/* Items past the first screen skip layout and paint until they near the viewport. */}
          {posts.map((post, i) => (
            <PostCard key={post._id} post={post} invalidate={[['feed']]} className={i >= 3 ? 'cv-auto' : undefined} />
          ))}
        </div>
      ) : null}

      {hasNextPage ? (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {isFetchingNextPage ? (
            <Spinner className="text-text-2" />
          ) : (
            <Button variant="ghost" onClick={() => fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      ) : null}

      {!hasNextPage && posts.length > 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="t-body font-semibold text-text-1">
            {activeMode === 'foryou' ? 'That’s everything ranked for you.' : 'You’re all caught up.'}
          </p>
          {hiddenCount > 0 ? (
            <p className="t-meta">
              {hiddenCount} {hiddenCount === 1 ? 'post' : 'posts'} hidden from people you muted.{' '}
              <button type="button" onClick={() => Object.keys(hidden).forEach(unhide)} className="font-semibold text-brand-text hover:underline">
                Unmute everyone
              </button>
            </p>
          ) : null}
          <ButtonLink to="/discover" variant="ghost">
            Explore more athletes
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
