import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { FEED_PAGE_SIZE, dedupeById, feedPageParams, nextFeedPageParam, type FeedPageParam } from '../lib/feedLogic';
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
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Skeleton,
  Spinner,
  Textarea,
  cx,
  formatStat,
  prefersReducedMotion,
  useIsTouch,
  useOnline,
  useToast,
} from './ui';
import { ArrowUp, Image as ImageIcon, Refresh, UserPlus, Video as VideoIcon, X } from './icons';
import PostCard, { PostCardSkeleton, isAuthorHidden, useHiddenAuthors } from './PostCard';
import { StoryTray } from './StoryTray';

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

  if (!open) {
    return (
      <Card className="flex items-center gap-3">
        {fileInputs}
        <Avatar src={me?.avatar} name={displayName(me)} size="md" />
        <button
          type="button"
          onClick={onOpen}
          className="input-base flex min-w-0 flex-1 items-center text-left text-text-3 hover:border-text-3"
        >
          <span className="truncate">Share a session, a win or a meal…</span>
        </button>
        <IconButton label="Add a photo" variant="secondary" onClick={() => photoRef.current?.click()}>
          <ImageIcon size={22} />
        </IconButton>
        <IconButton label="Add a video" variant="secondary" onClick={() => videoRef.current?.click()} className="hidden sm:inline-flex">
          <VideoIcon size={22} />
        </IconButton>
      </Card>
    );
  }

  return (
    <Card aria-label="New post" role="form">
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
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Trending hashtags strip (phones/tablets; the desktop rail has them) */
/* ------------------------------------------------------------------ */

function TrendingHashtags() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['trending-hashtags'],
    queryFn: async () => {
      const { data } = await api.get('/posts/trending-hashtags');
      return (data.hashtags || []) as { _id: string; count: number }[];
    },
    staleTime: 5 * 60_000,
  });

  if (isError) return null;

  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-hidden lg:hidden" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-xs" />
        ))}
      </div>
    );
  }

  if (!data?.length) return null;

  return (
    <nav aria-label="Trending hashtags" className="-mx-4 md:-mx-6 lg:hidden">
      <div className="snap-row no-scrollbar mask-fade-r flex gap-2 overflow-x-auto px-4 scroll-pl-4 md:px-6 md:scroll-pl-6">
        {data.slice(0, 12).map((tag) => (
          <Chip key={tag._id} to={`/search?q=${encodeURIComponent(`#${tag._id}`)}`} className="snap-item shrink-0">
            #{tag._id}
            <span className="tabular ml-1 font-medium text-text-3">{formatStat(tag.count, { compact: true })}</span>
          </Chip>
        ))}
      </div>
    </nav>
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

function PullIndicator({ pull, dragging, refreshing }: { pull: number; dragging: boolean; refreshing: boolean }) {
  if (pull <= 0 && !refreshing) return null;
  const progress = Math.min(1, pull / PULL_THRESHOLD);
  const ready = progress >= 1 || refreshing;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx('flex items-end justify-center overflow-hidden', !dragging && 'transition-[height] dur-2 ease-out')}
      style={{ height: pull }}
    >
      <div
        className={cx(
          'mb-2 grid h-9 w-9 place-items-center rounded-full bg-surface-1 shadow-2 transition-colors dur-1',
          ready ? 'text-brand' : 'text-text-2',
        )}
      >
        {refreshing ? (
          <Spinner size={18} />
        ) : (
          <Refresh size={18} style={{ transform: `rotate(${progress * 270}deg)`, opacity: 0.35 + progress * 0.65 }} />
        )}
      </div>
      <span className="sr-only">{refreshing ? 'Refreshing your feed' : ready ? 'Release to refresh' : 'Pull to refresh'}</span>
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

function todayLabel(): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  } catch {
    return '';
  }
}

export default function Feed() {
  const qc = useQueryClient();
  const online = useOnline();
  const touch = useIsTouch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composerOpen, setComposerOpen] = useState(false);
  const [showingNew, setShowingNew] = useState(false);
  const hidden = useHiddenAuthors((s) => s.ids);
  const unhide = useHiddenAuthors((s) => s.unhide);

  // Deep link contract: /?compose=1 (Log sheet, manifest shortcut, /create) opens the composer once.
  const compose = searchParams.get('compose') === '1';
  useEffect(() => {
    if (!compose) return;
    setComposerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('compose');
    setSearchParams(next, { replace: true });
  }, [compose, searchParams, setSearchParams]);

  // Page 1 by number, later pages by the API's keyset cursor so a post
  // published mid-scroll never shifts the window and repeats a card.
  const feed = useInfiniteQuery<PagedPosts, Error, { pages: PagedPosts[]; pageParams: FeedPageParam[] }, string[], FeedPageParam>({
    queryKey: ['feed'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/posts/feed', { params: feedPageParams(pageParam, FEED_PAGE_SIZE) });
      return data as PagedPosts;
    },
    getNextPageParam: (last, all) => nextFeedPageParam(last, all.length),
  });

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = feed;

  const allPosts = useMemo(() => dedupeById(data?.pages.flatMap((p) => p.posts || []) ?? []), [data]);
  const posts = useMemo(() => allPosts.filter((p) => !isAuthorHidden(hidden, p)), [allPosts, hidden]);
  const hiddenCount = allPosts.length - posts.length;

  // Quiet poll of the first page: surfaces a "New posts" pill instead of a Refresh button.
  const peek = useQuery({
    queryKey: ['feed', 'peek'],
    enabled: allPosts.length > 0 && online,
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
      <PageHeader title="Home" subtitle={todayLabel()} />
      <PullIndicator {...pullState} />

      <div className="space-y-4">
        <NewPostsPill fresh={fresh} onShow={() => void showNew()} busy={showingNew} />
        <StoryTray variant="home" />
        <Composer open={composerOpen} onOpen={() => setComposerOpen(true)} onClose={() => setComposerOpen(false)} />
        <TrendingHashtags />

        {isLoading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading your feed">
            {Array.from({ length: 3 }).map((_, i) => (
              <PostCardSkeleton key={i} media={i !== 1} />
            ))}
          </div>
        ) : null}

        {isError && !isLoading ? (
          <ErrorState error={error} title="We couldn’t load your feed" onRetry={() => refetch()} />
        ) : null}

        {!isLoading && !isError && allPosts.length === 0 ? (
          <EmptyState
            title="Your feed is quiet"
            message="Follow a few athletes and their sessions will show up here."
            action={{ label: 'Find people to follow', to: '/discover', icon: <UserPlus size={18} /> }}
            secondaryAction={{ label: 'Share your first post', onClick: openComposer }}
          />
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

        {posts.map((post) => (
          <PostCard key={post._id} post={post} invalidate={[['feed']]} />
        ))}

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
            <p className="text-sm font-semibold text-text-1">You’re all caught up.</p>
            {hiddenCount > 0 ? (
              <p className="text-xs text-text-3">
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
    </div>
  );
}
