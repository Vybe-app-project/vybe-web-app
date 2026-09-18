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
  IconButton,
  Input,
  Select,
  Skeleton,
  cx,
  useToast,
} from '../../components/ui';
import { Users, Trash, Check, X, Search } from '../../components/icons';
import { AdminPageHeader, Pager } from './AdminLayout';

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
const LIMIT_OPTIONS = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} rows` }));

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
      const label = pending?.username ? `@${pending.username}` : pending?.email || userId;
      success(`Deleted ${label} and all owned data`);
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
      <AdminPageHeader
        title="Users"
        subtitle="Search the member directory and remove accounts along with the data they own."
        meta={<Badge tone="neutral"><span className="tabular">{total.toLocaleString()}</span> total</Badge>}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Search users"
              hideLabel
              role="searchbox"
              inputMode="search"
              autoComplete="off"
              leading={<Search size={18} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search username, name or email"
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
          <div className="w-36">
            <Select
              label="Rows per page"
              hideLabel
              options={LIMIT_OPTIONS}
              value={String(limit)}
              onChange={(v) => {
                setLimit(Number(v));
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
            title="Could not load users"
          />
        ) : query.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading users">
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
            variant={search ? 'no-results' : 'first-run'}
            icon={search ? undefined : <Users size={24} />}
            title={search ? 'No matching users' : 'No members yet'}
            message={
              search
                ? `Nothing matched “${search}”. Try a different username, name or email.`
                : 'Members appear here as soon as they register.'
            }
            action={search ? { label: 'Clear search', onClick: () => setSearchInput(''), variant: 'secondary' } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={cx(query.isFetching && 'admin-fetching')}>
                {users.map((u) => (
                  <tr key={u._id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar src={u.avatar} name={u.fullName || u.username} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-text-1">
                            {u.username ? `@${u.username}` : 'No username'}
                          </p>
                          <p className="truncate text-xs text-text-2">{u.fullName || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="text-sm break-all text-text-2">{u.email || '—'}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {u.isVerified ? (
                          <Badge tone="success"><Check size={12} /> Verified</Badge>
                        ) : (
                          <Badge tone="neutral">Unverified</Badge>
                        )}
                        {u.isAdmin ? <Badge tone="warning">Admin</Badge> : null}
                        {u.isPremium ? <Badge tone="info">Premium</Badge> : null}
                        {u.isDeleted ? (
                          <Badge tone="danger">Deleted</Badge>
                        ) : u.isActive === false ? (
                          <Badge tone="danger">Inactive</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap text-text-2">
                      {u.createdAt ? format(new Date(u.createdAt), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash size={16} />}
                        onClick={() => setPending(u)}
                        disabled={remove.isPending}
                        aria-label={`Delete ${u.username ? `@${u.username}` : u.email || 'user'}`}
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
          <Pager
            className="border-t border-line px-4 py-3"
            page={page}
            totalPages={totalPages}
            canPrev={canPrev}
            canNext={canNext}
            busy={query.isFetching}
            onPrev={() => go(page - 1)}
            onNext={() => go(page + 1)}
            label={rangeLabel}
          />
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
              <strong className="text-text-1">
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
        {query.isFetching ? 'Loading users' : `${users.length} users shown`}
      </p>
    </div>
  );
}
