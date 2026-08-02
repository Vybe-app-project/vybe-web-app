import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminApi, mediaUrl } from '../../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  cx,
  useToast,
} from '../../components/ui';
import {
  FileText,
  Trash,
  Play,
  Image as ImageIcon,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons';

type Media = { type?: 'image' | 'video'; url?: string; thumbnail?: string };

type AdminPost = {
  _id: string;
  content?: string;
  medias?: Media[];
  category?: string;
  isPublic?: boolean;
  isDeleted?: boolean;
  views?: number;
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

/**
 * GET /admin/posts returns the full collection in one payload, so pagination
 * and filtering are applied client-side over the cached list.
 */
const PAGE_SIZE_OPTIONS = [25, 50, 100];

function Thumb({ media }: { media?: Media }) {
  const [broken, setBroken] = useState(false);
  const src = media?.thumbnail || media?.url;

  if (!src || broken) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-600">
        {media?.type === 'video' ? <Play size={16} /> : <ImageIcon size={16} />}
      </div>
    );
  }
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <img
        src={mediaUrl(src)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
      {media?.type === 'video' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
          <Play size={14} />
        </span>
      ) : null}
    </div>
  );
}

export default function AdminPosts() {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pending, setPending] = useState<AdminPost | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useQuery<AdminPost[]>({
    queryKey: ['admin', 'posts'],
    queryFn: async () => {
      const { data } = await adminApi.get('/admin/posts');
      return Array.isArray(data?.posts) ? data.posts : [];
    },
  });

  const remove = useMutation({
    mutationFn: async (postId: string) => {
      await adminApi.delete(`/admin/posts/${postId}`);
    },
    onSuccess: () => {
      success('Post deleted.');
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'analytics'] });
    },
    onError: (e) => toastError(e, 'Could not delete this post.'),
  });

  const all = query.data ?? [];

  const filtered = useMemo(() => {
    if (!search) return all;
    return all.filter((p) => {
      const author = p.author;
      return (
        p.content?.toLowerCase().includes(search) ||
        p.category?.toLowerCase().includes(search) ||
        author?.name?.toLowerCase().includes(search) ||
        author?.fullName?.toLowerCase().includes(search) ||
        author?.username?.toLowerCase().includes(search) ||
        author?.email?.toLowerCase().includes(search)
      );
    });
  }, [all, search]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Posts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review published content and take down posts that violate policy.
          </p>
        </div>
        <Badge tone="neutral">{total.toLocaleString()} posts</Badge>
      </div>

      <Card className="border-slate-800 bg-slate-950/60">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter by content, category or author"
              aria-label="Filter posts"
              className="border-slate-800 bg-slate-900/70 pl-9 text-slate-100"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear filter"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 hover:text-slate-200"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            Rows
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="input-base w-auto border-slate-800 bg-slate-900/70 py-2 text-sm text-slate-100"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden border-slate-800 bg-slate-950/60">
        {query.isError ? (
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load posts"
          />
        ) : query.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title={search ? 'No matching posts' : 'No posts yet'}
            message={
              search
                ? `Nothing matched “${searchInput.trim()}”.`
                : 'Published posts will appear here.'
            }
            action={
              search ? (
                <Button variant="ghost" onClick={() => setSearchInput('')}>Clear filter</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                  <th className="px-4 py-3 font-semibold">Media</th>
                  <th className="px-4 py-3 font-semibold">Content</th>
                  <th className="px-4 py-3 font-semibold">Author</th>
                  <th className="px-4 py-3 font-semibold">Stats</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className={cx('divide-y divide-slate-800/70', query.isFetching && 'opacity-60')}>
                {rows.map((p) => {
                  const medias = Array.isArray(p.medias) ? p.medias : [];
                  const authorName =
                    p.author?.name || p.author?.fullName || p.author?.username || 'Unknown';
                  return (
                    <tr key={p._id} className="transition-colors hover:bg-slate-900/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Thumb media={medias[0]} />
                          {medias.length > 1 ? (
                            <span className="font-mono text-[11px] text-slate-500">
                              +{medias.length - 1}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[320px] px-4 py-3">
                        <p className="line-clamp-2 text-slate-200">
                          {p.content?.trim() || (
                            <span className="text-slate-600 italic">No caption</span>
                          )}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {p.category ? <Badge tone="info">{p.category}</Badge> : null}
                          {p.isPublic === false ? <Badge tone="neutral">Private</Badge> : null}
                          {p.isDeleted ? <Badge tone="danger">Soft-deleted</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar src={p.author?.avatar} name={authorName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-100">{authorName}</p>
                            {p.author?.email ? (
                              <p className="truncate text-[11px] text-slate-500">
                                {p.author.email}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap text-slate-500">
                        <div>{Array.isArray(p.likes) ? p.likes.length : 0} likes</div>
                        <div>{Array.isArray(p.comments) ? p.comments.length : 0} comments</div>
                        {typeof p.views === 'number' ? <div>{p.views} views</div> : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap text-slate-500">
                        {p.createdAt ? format(new Date(p.createdAt), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash size={14} />}
                          className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                          onClick={() => setPending(p)}
                          disabled={remove.isPending}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
            <p className="font-mono text-[11px] text-slate-500">
              {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, total)} of{' '}
              {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronLeft size={14} />}
                disabled={safePage <= 1}
                onClick={() => setPage((n) => Math.max(1, n - 1))}
              >
                Prev
              </Button>
              <span className="font-mono text-xs text-slate-400">
                {safePage} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={safePage >= totalPages}
                onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
              >
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </div>
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
              {pending.content?.trim() ? (
                <> “{pending.content.trim().slice(0, 120)}”</>
              ) : null}{' '}
              by{' '}
              <strong className="text-slate-100">
                {pending.author?.name || pending.author?.username || 'this author'}
              </strong>
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
