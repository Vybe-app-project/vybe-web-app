import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  compactNumber,
  displayName,
  extractHashtags,
  uploadImage,
  useInfiniteScroll,
  type PagedPosts,
  type UploadedMedia,
} from '../lib/hooks';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Spinner,
  Textarea,
  useToast,
} from './ui';
import { Image as ImageIcon, Plus, X } from './icons';
import PostCard, { PostCardSkeleton } from './PostCard';

const PAGE_SIZE = 10;

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

function Composer() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [content, setContent] = useState('');
  const [medias, setMedias] = useState<UploadedMedia[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const text = content.trim();
      const { data } = await api.post('/posts/create', {
        content: text,
        medias: medias.map((m) => ({ type: m.type, key: m.key, url: m.url })),
        hashtags: extractHashtags(text),
        isPublic: true,
      });
      return data;
    },
    onSuccess: () => {
      setContent('');
      setMedias([]);
      previews.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      toast.success('Post shared');
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['trending-hashtags'] });
    },
    onError: (e) => toast.error(errMsg(e, 'Could not share your post.')),
  });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, 4 - medias.length);
    if (!selected.length) {
      toast.error('You can attach up to 4 images per post.');
      return;
    }

    setUploading(true);
    try {
      for (const file of selected) {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`${file.name}: unsupported image format.`);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`${file.name} is larger than 10 MB.`);
          continue;
        }
        const uploaded = await uploadImage(file, 'posts');
        setMedias((prev) => [...prev, uploaded]);
        setPreviews((prev) => [...prev, URL.createObjectURL(file)]);
      }
    } catch (e) {
      toast.error(errMsg(e, 'Image upload failed.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeMedia(index: number) {
    setMedias((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
  }

  const canPost = (content.trim().length > 0 || medias.length > 0) && !create.isPending && !uploading;

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <Avatar src={me?.avatar} name={displayName(me)} size={40} />
        <div className="min-w-0 flex-1">
          <Textarea
            placeholder="Share a workout, a win, or a meal… use #hashtags"
            rows={3}
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={create.isPending}
          />

          {(previews.length > 0 || uploading) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={src} className="relative h-20 w-20 overflow-hidden rounded-lg">
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => removeMedia(i)}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {uploading && (
                <div className="grid h-20 w-20 place-items-center rounded-lg bg-[var(--color-surface-2)]">
                  <Spinner size={18} />
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => onFiles(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || medias.length >= 4 || create.isPending}
            >
              <ImageIcon className="h-4 w-4" />
              Photo
            </button>
            <span className="text-xs text-[var(--color-muted)]">
              {content.trim().length}/2000
            </span>
            <Button
              variant="primary"
              className="ml-auto"
              onClick={() => create.mutate()}
              disabled={!canPost}
              loading={create.isPending}
            >
              <Plus className="h-4 w-4" />
              Post
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Trending hashtags strip                                             */
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
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
    );
  }

  if (!data?.length) return null;

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {data.map((tag) => (
        <Link
          key={tag._id}
          to={`/search?q=${encodeURIComponent(`#${tag._id}`)}`}
          className="shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--color-brand)]"
        >
          #{tag._id}
          <span className="ml-1.5 text-[var(--color-muted)]">
            {compactNumber(tag.count)}
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

export default function Feed() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['feed'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/posts/feed', {
        params: { page: pageParam, limit: PAGE_SIZE },
      });
      return data as PagedPosts;
    },
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, !!hasNextPage);

  const posts = data?.pages.flatMap((p) => p.posts || []) ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Your feed</h1>
        <Button variant="ghost" onClick={() => refetch()} loading={isRefetching}>
          Refresh
        </Button>
      </header>

      <Composer />
      <TrendingHashtags />

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <PostCardSkeleton key={i} />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <ErrorState
          title="We couldn't load your feed"
          message={errMsg(error, 'Please check your connection and try again.')}
          action={<Button variant="primary" onClick={() => refetch()}>Try again</Button>}
        />
      )}

      {!isLoading && !isError && posts.length === 0 && (
        <EmptyState
          title="Your feed is quiet"
          message="Follow other athletes or share your first post to get things moving."
          action={
            <Link to="/discover">
              <Button variant="primary">Discover people</Button>
            </Link>
          }
        />
      )}

      {posts.map((post) => (
        <PostCard key={post._id} post={post} invalidate={[['feed']]} />
      ))}

      {hasNextPage && (
        <div ref={sentinelRef} className="py-6 text-center">
          {isFetchingNextPage ? (
            <Spinner />
          ) : (
            <Button variant="ghost" onClick={() => fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      )}

      {!hasNextPage && posts.length > 0 && (
        <p className="py-6 text-center text-xs text-[var(--color-muted)]">
          You&apos;re all caught up.
        </p>
      )}
    </div>
  );
}
