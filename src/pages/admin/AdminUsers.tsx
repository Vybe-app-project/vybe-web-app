import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminApi } from '../../lib/api';
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
  Users,
  Search,
  Trash,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons';

type AdminUser = {
  _id: string;
  username?: string;
  fullName?: string;
  email?: string;
  avatar?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  isDeleted?: boolean;
  isVerified?: boolean;
  isPremium?: boolean;
  createdAt?: string;
};

type UsersResponse = {
  users: AdminUser[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
};

/** Validators cap these; keep the client inside the same bounds. */
const MIN_PAGE = 1;
const MAX_PAGE = 100000;
const LIMIT_OPTIONS = [25, 50, 100];

export default function AdminUsers() {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [pending, setPending] = useState<AdminUser | null>(null);

  // Debounce so we do not hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      // The API rejects search strings longer than 100 chars.
      setSearch(searchInput.trim().slice(0, 100));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useQuery<UsersResponse>({
    queryKey: ['admin', 'users', page, limit, search],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit };
      if (search) params.search = search;
      const { data } = await adminApi.get('/admin/users', { params });
      return { users: Array.isArray(data?.users) ? data.users : [], pagination: data?.pagination };
    },
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      await adminApi.delete(`/admin/users/${userId}`);
    },
    onSuccess: (_d, userId) => {
      const label = pending?.username || pending?.email || userId;
      success(`Deleted ${label} and all owned data.`);
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'analytics'] });
    },
    onError: (e) => toastError(e, 'Could not delete this user.'),
  });

  const users = query.data?.users ?? [];
  const p = query.data?.pagination;
  const totalPages = Math.max(1, p?.pages ?? 1);
  const total = p?.total ?? users.length;

  const canPrev = page > MIN_PAGE;
  const canNext = p?.hasNextPage ?? page < totalPages;

  const rangeLabel = useMemo(() => {
    if (!total) return 'No users';
    const from = (page - 1) * limit + 1;
    const to = Math.min(page * limit, total);
    return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;
  }, [page, limit, total]);

  const go = (next: number) =>
    setPage(Math.min(Math.max(next, MIN_PAGE), Math.min(MAX_PAGE, totalPages)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Search the member directory and remove accounts along with their owned data.
          </p>
        </div>
        <Badge tone="neutral">{total.toLocaleString()} total</Badge>
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
              placeholder="Search username, name or email"
              aria-label="Search users"
              maxLength={100}
              className="border-slate-800 bg-slate-900/70 pl-9 text-slate-100"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 hover:text-slate-200"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            Rows
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="input-base w-auto border-slate-800 bg-slate-900/70 py-2 text-sm text-slate-100"
            >
              {LIMIT_OPTIONS.map((n) => (
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
            title="Could not load users"
          />
        ) : query.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title={search ? 'No matching users' : 'No users yet'}
            message={
              search
                ? `Nothing matched “${search}”. Try a different username, name or email.`
                : 'Members will appear here once they register.'
            }
            action={
              search ? (
                <Button variant="ghost" onClick={() => setSearchInput('')}>Clear search</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className={cx('divide-y divide-slate-800/70', query.isFetching && 'opacity-60')}>
                {users.map((u) => (
                  <tr key={u._id} className="transition-colors hover:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={u.avatar} name={u.fullName || u.username} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-100">
                            {u.username ? `@${u.username}` : '(no username)'}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {u.fullName || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12px] break-all text-slate-400">
                        {u.email || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {u.isVerified ? (
                          <Badge tone="success">
                            <Check size={12} /> Verified
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Unverified</Badge>
                        )}
                        {u.isAdmin ? <Badge tone="warning">Admin</Badge> : null}
                        {u.isPremium ? <Badge tone="brand">Premium</Badge> : null}
                        {u.isDeleted ? (
                          <Badge tone="danger">Deleted</Badge>
                        ) : u.isActive === false ? (
                          <Badge tone="danger">Inactive</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap text-slate-500">
                      {u.createdAt ? format(new Date(u.createdAt), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash size={14} />}
                        className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        onClick={() => setPending(u)}
                        disabled={remove.isPending}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {users.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
            <p className="font-mono text-[11px] text-slate-500">{rangeLabel}</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronLeft size={14} />}
                disabled={!canPrev || query.isFetching}
                onClick={() => go(page - 1)}
              >
                Prev
              </Button>
              <span className="font-mono text-xs text-slate-400">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canNext || query.isFetching}
                onClick={() => go(page + 1)}
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
        title="Delete user account"
        confirmLabel="Delete permanently"
        loading={remove.isPending}
        message={
          pending ? (
            <>
              This permanently deletes{' '}
              <strong className="text-slate-100">
                {pending.username ? `@${pending.username}` : pending.email}
              </strong>{' '}
              and every post, workout, meal and message they own. This cannot be undone and is
              recorded in the audit log.
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

      <p className="sr-only" role="status">
        {query.isFetching ? 'Loading users…' : `${users.length} users shown`}
      </p>
    </div>
  );
}
