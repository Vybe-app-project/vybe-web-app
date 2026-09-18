import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, mediaUrl } from '../../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Select,
  Skeleton,
  cx,
  humanize,
  plural,
  useIsCompact,
  useToast,
} from '../../components/ui';
import { FileText, Trash, Play, Image as ImageIcon, AlignLeft, X, Search } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp } from './AdminLayout';

type Media = { type?: 'image' | 'video'; url?: string; thumbnail?: string };

type PostStatus = 'active' | 'deleted' | 'all';

/**
 * GET /admin/posts row (controllers/adminController.js POST_LIST_PROJECTION):
 * the author is resolved server-side and engagement arrives as counters.
 * `likes`/`comments` arrays are kept optional for older API builds.
 */
type AdminPost = {
  _id: string;
  content?: string;
  medias?: Media[];
  category?: string;
  isPublic?: boolean;
  isDeleted?: boolean;
  views?: number;
  likeCount?: number;
  commentCount?: number;
  saveCount?: number;
  likes?: unknown[];
  comments?: unknown[];
  createdAt?: string;
  author?: {
    _id?: string;
    name?: string;
    fullName?: string;
    username?: string;
    email?: string;
    avatar?: string;
  } | null;
};

type PostsResponse = {
  posts: AdminPost[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    status?: PostStatus;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
};

const PAGE_SIZE_OPTIONS = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} rows` }));
const STATUS_OPTIONS: Array<{ value: PostStatus; label: string; description: string }> = [
  { value: 'active', label: 'Published', description: 'Live posts, the same set the dashboard counts.' },
  { value: 'deleted', label: 'Removed', description: 'Soft-deleted by moderation or their author.' },
  { value: 'all', label: 'All posts', description: 'Published and removed together.' },
];

/** Display name first, then handle, then email; never the bare word "Unknown" when any of those exist. */
function authorLabel(p: AdminPost): { primary: string; secondary?: string } {
  const a = p.author;
  if (!a) return { primary: 'Unknown author' };
  const handle = a.username ? `@${a.username}` : undefined;
  const primary = a.fullName || a.name || handle || a.email || 'Unknown author';
  const secondary = primary !== handle ? handle || a.email : a.email;
  return { primary, secondary };
}

const count = (n: number | undefined, arr: unknown[] | undefined) =>
  typeof n === 'number' ? n : Array.isArray(arr) ? arr.length : 0;

function Thumb({ media, textOnly }: { media?: Media; textOnly: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = media?.thumbnail || media?.url;

  // A caption-only post is not a missing image; give it a text glyph and keep
  // the image glyph for a media post whose file did not load.
  if (textOnly) {
    return (
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-3"
        role="img"
        aria-label="Text-only post"
        title="Text-only post"
      >
        <AlignLeft size={16} />
      </div>
    );
  }
  if (!src || broken) {
    return (
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-3"
        role="img"
        aria-label={media?.type === 'video' ? 'Video unavailable' : 'Image unavailable'}
        title={media?.type === 'video' ? 'Video unavailable' : 'Image unavailable'}
      >
        {media?.type === 'video' ? <Play size={16} /> : <ImageIcon size={16} />}
      </div>
    );
  }
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm border border-line bg-surface-2">
      <img
        src={mediaUrl(src)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
      {media?.type === 'video' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-scrim text-text-1">
          <Play size={14} />
        </span>
      ) : null}
    </div>
  );
}

function Engagement({ post: p }: { post: AdminPost }) {
  return (
    <div className="tabular whitespace-nowrap text-xs text-text-2">
      <div>{plural(count(p.likeCount, p.likes), 'like')}</div>
      <div>{plural(count(p.commentCount, p.comments), 'comment')}</div>
      {typeof p.views === 'number' ? <div>{plural(p.views, 'view')}</div> : null}
    </div>
  );
}

export default function AdminPosts() {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();
  const compact = useIsCompact();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PostStatus>('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pending, setPending] = useState<AdminPost | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      // The API caps search at 100 characters.
      setSearch(searchInput.trim().slice(0, 100));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Server-side page/limit/search/status, like /admin/users. The previous
  // build downloaded the whole collection and paged it in the browser.
  const query = useQuery<PostsResponse>({
    queryKey: ['admin', 'posts', page, pageSize, search, status],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: pageSize, status };
      if (search) params.search = search;
      const { data } = await adminApi.get('/admin/posts', { params });
      return { posts: Array.isArray(data?.posts) ? data.posts : [], pagination: data?.pagination };
    },
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: async (postId: string) => {
      await adminApi.delete(`/admin/posts/${postId}`);
    },
    onSuccess: () => {
      success('Post deleted');
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'analytics'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'more-analytics'] });
    },
    onError: (e) => toastError(e, 'Could not delete this post.'),
  });

  const rows = query.data?.posts ?? [];
  const p = query.data?.pagination;
  const total = p?.total ?? rows.length;
  const totalPages = Math.max(1, p?.pages ?? 1);
  const canNext = p?.hasNextPage ?? page < totalPages;

  const rangeLabel = useMemo(() => {
    if (!total) return 'No posts';
    const from = (page - 1) * pageSize + 1;
    return `${from.toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()} of ${total.toLocaleString()}`;
  }, [page, pageSize, total]);

  const clearFilters = () => { setSearchInput(''); setStatus('active'); setPage(1); };
  const filtered = Boolean(search) || status !== 'active';

  const deleteButton = (post: AdminPost, authorName: string) => (
    <Button
      size="sm"
      variant="danger"
      icon={<Trash size={16} />}
      onClick={() => setPending(post)}
      disabled={remove.isPending}
      aria-label={`Delete post by ${authorName}`}
    >
      Delete
    </Button>
  );

  const body = compact ? (
    <ul className={cx('admin-cards', query.isFetching && 'admin-fetching')} aria-label="Posts">
      {rows.map((post) => {
        const medias = Array.isArray(post.medias) ? post.medias : [];
        const author = authorLabel(post);
        return (
          <li key={post._id}>
            <div className="flex items-start gap-3">
              <Thumb media={medias[0]} textOnly={medias.length === 0} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm text-text-1">
                  {post.content?.trim() || <span className="text-text-3 italic">No caption</span>}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {post.category ? <Badge tone="info">{humanize(post.category)}</Badge> : null}
                  {post.isPublic === false ? <Badge tone="neutral">Private</Badge> : null}
                  {post.isDeleted ? <Badge tone="danger">Soft-deleted</Badge> : null}
                  {medias.length > 1 ? <Badge tone="neutral">+{medias.length - 1} more</Badge> : null}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <Avatar src={post.author?.avatar} name={author.primary} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-1">{author.primary}</p>
                {author.secondary ? <p className="truncate text-xs text-text-2">{author.secondary}</p> : null}
              </div>
              <Engagement post={post} />
            </div>
            <p className="mt-2 text-xs text-text-2">Posted <Stamp iso={post.createdAt} dateOnly /></p>
            <div className="admin-card-actions">{deleteButton(post, author.primary)}</div>
          </li>
        );
      })}
    </ul>
  ) : (
    <div className="overflow-x-auto">
      <table className="admin-table admin-table--actions min-w-[820px]">
        <thead>
          <tr>
            <th scope="col">Media</th>
            <th scope="col">Content</th>
            <th scope="col">Author</th>
            <th scope="col">Engagement</th>
            <th scope="col">Created</th>
            <th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody className={cx(query.isFetching && 'admin-fetching')}>
          {rows.map((post) => {
            const medias = Array.isArray(post.medias) ? post.medias : [];
            const author = authorLabel(post);
            return (
              <tr key={post._id}>
                <td>
                  <div className="flex items-center gap-1.5">
                    <Thumb media={medias[0]} textOnly={medias.length === 0} />
                    {medias.length > 1 ? (
                      <span className="tabular text-xs text-text-2">+{medias.length - 1}</span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-[320px]">
                  <p className="line-clamp-2 text-text-1">
                    {post.content?.trim() || <span className="text-text-3 italic">No caption</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {post.category ? <Badge tone="info">{humanize(post.category)}</Badge> : null}
                    {post.isPublic === false ? <Badge tone="neutral">Private</Badge> : null}
                    {post.isDeleted ? <Badge tone="danger">Soft-deleted</Badge> : null}
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-2.5">
                    <Avatar src={post.author?.avatar} name={author.primary} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-text-1">{author.primary}</p>
                      {author.secondary ? (
                        <p className="truncate text-xs text-text-2">{author.secondary}</p>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td><Engagement post={post} /></td>
                <td className="whitespace-nowrap text-text-2"><Stamp iso={post.createdAt} dateOnly /></td>
                <td className="text-right">{deleteButton(post, author.primary)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Posts"
        subtitle="Review published content and take down posts that break policy."
        meta={<Badge tone="neutral"><span className="tabular">{plural(total, 'post')}</span></Badge>}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Search posts"
              hideLabel
              role="searchbox"
              inputMode="search"
              autoComplete="off"
              leading={<Search size={18} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search caption, category, hashtag or author"
              maxLength={100}
              trailing={
                searchInput ? (
                  <IconButton label="Clear search" size={40} onClick={() => setSearchInput('')}>
                    <X size={18} />
                  </IconButton>
                ) : undefined
              }
            />
          </div>
          <div className="w-44">
            <Select
              label="Visibility"
              hideLabel
              options={STATUS_OPTIONS}
              value={status}
              onChange={(v) => { setStatus(v as PostStatus); setPage(1); }}
            />
          </div>
          <div className="w-36">
            <Select
              label="Rows per page"
              hideLabel
              options={PAGE_SIZE_OPTIONS}
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
            />
          </div>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        {query.isError ? (
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load posts"
          />
        ) : query.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading posts">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-sm" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            variant={filtered ? 'no-results' : 'first-run'}
            icon={filtered ? undefined : <FileText size={24} />}
            title={filtered ? 'No matching posts' : 'No posts yet'}
            message={
              search
                ? `Nothing matched “${search}”. Try a caption fragment, a category, a hashtag or an author.`
                : status === 'deleted'
                  ? 'No posts have been removed.'
                  : 'Published posts appear here as members share them.'
            }
            action={filtered ? { label: 'Clear filters', onClick: clearFilters, variant: 'secondary' } : undefined}
          />
        ) : (
          body
        )}

        {rows.length > 0 ? (
          <Pager
            className="border-t border-line px-4 py-3"
            page={page}
            totalPages={totalPages}
            canPrev={page > 1}
            canNext={canNext}
            busy={query.isFetching}
            onPrev={() => setPage((n) => Math.max(1, n - 1))}
            onNext={() => setPage((n) => Math.min(totalPages, n + 1))}
            label={rangeLabel}
          />
        ) : null}
      </Card>

      <ConfirmDialog
        open={!!pending}
        destructive
        title="Delete post"
        confirmLabel="Delete post"
        loading={remove.isPending}
        message={
          pending ? (
            <>
              This permanently removes the post
              {pending.content?.trim() ? <> “{pending.content.trim().slice(0, 120)}”</> : null}{' '}
              by{' '}
              <strong className="text-text-1">{authorLabel(pending).primary}</strong>
              . The action is recorded in the audit log.
            </>
          ) : undefined
        }
        onCancel={() => {
          if (!remove.isPending) setPending(null);
        }}
        onConfirm={() => {
          if (pending) remove.mutate(pending._id);
        }}
      />
    </div>
  );
}
