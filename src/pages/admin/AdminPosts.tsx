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
  IconButton,
  Input,
  Select,
  Skeleton,
  cx,
  humanize,
  useToast,
} from '../../components/ui';
import { FileText, Trash, Play, Image as ImageIcon, X, Search } from '../../components/icons';
import { AdminPageHeader, Pager } from './AdminLayout';

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
const PAGE_SIZE_OPTIONS = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} rows` }));

function Thumb({ media }: { media?: Media }) {
  const [broken, setBroken] = useState(false);
  const src = media?.thumbnail || media?.url;

  if (!src || broken) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-3">
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
      success('Post deleted');
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
      <AdminPageHeader
        title="Posts"
        subtitle="Review published content and take down posts that break policy."
        meta={<Badge tone="neutral"><span className="tabular">{total.toLocaleString()}</span> posts</Badge>}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Filter posts"
              hideLabel
              role="searchbox"
              inputMode="search"
              autoComplete="off"
              leading={<Search size={18} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter by caption, category or author"
              trailing={
                searchInput ? (
                  <IconButton label="Clear filter" size={40} onClick={() => setSearchInput('')}>
                    <X size={18} />
                  </IconButton>
                ) : undefined
              }
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
            variant={search ? 'no-results' : 'first-run'}
            icon={search ? undefined : <FileText size={24} />}
            title={search ? 'No matching posts' : 'No posts yet'}
            message={
              search
                ? `Nothing matched “${searchInput.trim()}”. Try a caption fragment, a category or an author.`
                : 'Published posts appear here as members share them.'
            }
            action={search ? { label: 'Clear filter', onClick: () => setSearchInput(''), variant: 'secondary' } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[820px]">
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
                {rows.map((p) => {
                  const medias = Array.isArray(p.medias) ? p.medias : [];
                  const authorName =
                    p.author?.name || p.author?.fullName || p.author?.username || 'Unknown';
                  const likes = Array.isArray(p.likes) ? p.likes.length : 0;
                  const comments = Array.isArray(p.comments) ? p.comments.length : 0;
                  return (
                    <tr key={p._id}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Thumb media={medias[0]} />
                          {medias.length > 1 ? (
                            <span className="tabular text-xs text-text-2">+{medias.length - 1}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[320px]">
                        <p className="line-clamp-2 text-text-1">
                          {p.content?.trim() || <span className="text-text-3 italic">No caption</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {p.category ? <Badge tone="info">{humanize(p.category)}</Badge> : null}
                          {p.isPublic === false ? <Badge tone="neutral">Private</Badge> : null}
                          {p.isDeleted ? <Badge tone="danger">Soft-deleted</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar src={p.author?.avatar} name={authorName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text-1">{authorName}</p>
                            {p.author?.email ? (
                              <p className="truncate text-xs text-text-2">{p.author.email}</p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap text-xs text-text-2">
                        <div>{likes.toLocaleString()} likes</div>
                        <div>{comments.toLocaleString()} comments</div>
                        {typeof p.views === 'number' ? <div>{p.views.toLocaleString()} views</div> : null}
                      </td>
                      <td className="tabular whitespace-nowrap text-text-2">
                        {p.createdAt ? format(new Date(p.createdAt), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<Trash size={16} />}
                          onClick={() => setPending(p)}
                          disabled={remove.isPending}
                          aria-label={`Delete post by ${authorName}`}
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
          <Pager
            className="border-t border-line px-4 py-3"
            page={safePage}
            totalPages={totalPages}
            canPrev={safePage > 1}
            canNext={safePage < totalPages}
            onPrev={() => setPage((n) => Math.max(1, n - 1))}
            onNext={() => setPage((n) => Math.min(totalPages, n + 1))}
            label={`${((safePage - 1) * pageSize + 1).toLocaleString()}–${Math.min(safePage * pageSize, total).toLocaleString()} of ${total.toLocaleString()}`}
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
              <strong className="text-text-1">
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
