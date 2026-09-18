import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { adminApi, errMsg } from '../../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
  cx,
  plural,
  useIsCompact,
  useToast,
} from '../../components/ui';
import { Users, Trash, Check, X, Search, Shield, Refresh } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp } from './AdminLayout';

type Suspension = {
  active?: boolean;
  reason?: string;
  suspendedAt?: string | null;
  restoredAt?: string | null;
};

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
  lastLogin?: string | null;
  /** utils/publicUser ADMIN_USER_LIST_FIELDS: moderation state travels with the row. */
  moderationSuspension?: Suspension | null;
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

const displayName = (u: AdminUser) => (u.username ? `@${u.username}` : u.email || 'user');
const isSuspended = (u: AdminUser) => u.moderationSuspension?.active === true;

/* ------------------------------------------------------------ status badges */

function StatusBadges({ user: u }: { user: AdminUser }) {
  const suspended = isSuspended(u);
  const reason = u.moderationSuspension?.reason?.trim();
  return (
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
      ) : suspended ? (
        <Badge tone="danger" title={reason ? `Reason: ${reason}` : 'Suspended by moderation'}>
          <Shield size={12} /> Suspended
          {reason ? <span className="sr-only">. Reason: {reason}</span> : null}
        </Badge>
      ) : u.isActive === false ? (
        <Badge tone="danger">Inactive</Badge>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ suspend modal */

function SuspendModal({
  user,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  user: AdminUser;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = note.trim().length < 5;
  return (
    <Modal
      open
      onClose={() => { if (!busy) onCancel(); }}
      title="Suspend account"
      description="The member is signed out everywhere and cannot sign in until restored. This is recorded in the audit log."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Shield size={16} />}
            loading={busy}
            onClick={() => {
              setTouched(true);
              if (tooShort) return;
              onConfirm(note.trim().slice(0, 1000));
            }}
          >
            Suspend account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar src={user.avatar} name={user.fullName || user.username} size="md" />
          <div className="min-w-0">
            <p className="truncate text-md font-semibold text-text-1">{user.fullName || displayName(user)}</p>
            <p className="truncate text-xs text-text-2">{u2(user)}</p>
          </div>
        </div>
        <Textarea
          label="Reason (required)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={1000}
          rows={3}
          placeholder="What policy was broken and how it was confirmed"
          hint={`${note.length}/1000 · at least 5 characters`}
          error={touched && tooShort ? 'Give a short reason (at least 5 characters).' : undefined}
        />
        {error ? <Callout tone="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}

const u2 = (u: AdminUser) => [u.username ? `@${u.username}` : null, u.email].filter(Boolean).join(' · ');

/* ---------------------------------------------------------------- page */

export default function AdminUsers() {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();
  const compact = useIsCompact();
  const [searchParams, setSearchParams] = useSearchParams();

  // `?search=` lets other pages (Support's Member badge) deep-link a member.
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const [search, setSearch] = useState((searchParams.get('search') ?? '').trim().slice(0, 100));
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [pending, setPending] = useState<AdminUser | null>(null);
  const [suspending, setSuspending] = useState<AdminUser | null>(null);
  const [restoring, setRestoring] = useState<AdminUser | null>(null);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  // Debounce so we do not hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      // The API rejects search strings longer than 100 chars.
      const next = searchInput.trim().slice(0, 100);
      setSearch(next);
      setPage(1);
      setSearchParams(next ? { search: next } : {}, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, setSearchParams]);

  const queryKey = ['admin', 'users', page, limit, search] as const;

  const query = useQuery<UsersResponse>({
    queryKey,
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

  /**
   * PATCH /admin/users/:id/suspension. The row flips immediately and is
   * rolled back if the server disagrees (409 already suspended, 404, …), so
   * moderation feels instant without ever showing a state the API rejected.
   */
  const suspension = useMutation({
    mutationFn: async ({ user, action, note }: { user: AdminUser; action: 'suspend' | 'restore'; note?: string }) => {
      const body: { action: 'suspend' | 'restore'; note?: string } = { action };
      if (note) body.note = note;
      const { data } = await adminApi.patch(`/admin/users/${user._id}/suspension`, body);
      return data;
    },
    onMutate: async ({ user, action, note }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<UsersResponse>(queryKey);
      qc.setQueryData<UsersResponse>(queryKey, (current) =>
        current
          ? {
              ...current,
              users: current.users.map((u) =>
                u._id === user._id
                  ? {
                      ...u,
                      isActive: action === 'restore',
                      moderationSuspension: {
                        ...(u.moderationSuspension ?? {}),
                        active: action === 'suspend',
                        reason: action === 'suspend' ? note : u.moderationSuspension?.reason,
                      },
                    }
                  : u,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (e, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      const msg = errMsg(e, vars.action === 'suspend' ? 'Could not suspend this account.' : 'Could not restore this account.');
      if (vars.action === 'suspend') setSuspendError(msg);
      else toastError(e, msg);
    },
    onSuccess: (_d, vars) => {
      success(vars.action === 'suspend' ? `Suspended ${displayName(vars.user)}` : `Restored ${displayName(vars.user)}`);
      setSuspending(null);
      setRestoring(null);
      setSuspendError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
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

  const rowBusy = (u: AdminUser) =>
    (suspension.isPending && suspension.variables?.user._id === u._id) ||
    (remove.isPending && pending?._id === u._id);

  function RowActions({ user: u }: { user: AdminUser }) {
    const suspended = isSuspended(u);
    const busy = rowBusy(u);
    return (
      <>
        {u.isDeleted ? null : suspended ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Refresh size={16} />}
            onClick={() => setRestoring(u)}
            disabled={busy}
            aria-label={`Restore ${displayName(u)}`}
          >
            Restore
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={<Shield size={16} />}
            onClick={() => { setSuspendError(null); setSuspending(u); }}
            disabled={busy || u.isAdmin === true}
            title={u.isAdmin ? 'Administrator accounts cannot be suspended here' : undefined}
            aria-label={`Suspend ${displayName(u)}`}
          >
            Suspend
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          icon={<Trash size={16} />}
          onClick={() => setPending(u)}
          disabled={busy}
          aria-label={`Delete ${u.username ? `@${u.username}` : u.email || 'user'}`}
        >
          Delete
        </Button>
      </>
    );
  }

  const rowsBody = compact ? (
    <ul className={cx('admin-cards', query.isFetching && 'admin-fetching')} aria-label="Users">
      {users.map((u) => (
        <li key={u._id}>
          <div className="flex items-start gap-3">
            <Avatar src={u.avatar} name={u.fullName || u.username} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-text-1">
                {u.username ? `@${u.username}` : 'No username'}
              </p>
              <p className="truncate text-xs text-text-2">{u.fullName || '—'}</p>
              <p className="truncate text-xs break-all text-text-2">{u.email || '—'}</p>
            </div>
          </div>
          <div className="mt-2"><StatusBadges user={u} /></div>
          <p className="mt-2 text-xs text-text-2">
            Joined <Stamp iso={u.createdAt} dateOnly />
            {u.lastLogin ? <> · Last active <Stamp iso={u.lastLogin} dateOnly /></> : null}
          </p>
          <div className="admin-card-actions"><RowActions user={u} /></div>
        </li>
      ))}
    </ul>
  ) : (
    <div className="overflow-x-auto">
      <table className="admin-table admin-table--actions min-w-[860px]">
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
              <td><StatusBadges user={u} /></td>
              <td className="whitespace-nowrap text-text-2">
                <Stamp iso={u.createdAt} dateOnly />
                {u.lastLogin ? (
                  <p className="text-xs text-text-3">Last active <Stamp iso={u.lastLogin} dateOnly /></p>
                ) : null}
              </td>
              <td className="text-right">
                <div className="inline-flex items-center gap-1.5">
                  <RowActions user={u} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Users"
        subtitle="Search the member directory, suspend or restore accounts, and remove accounts along with the data they own."
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
          rowsBody
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

      <ConfirmDialog
        open={!!restoring}
        title="Restore account"
        confirmLabel="Restore access"
        loading={suspension.isPending}
        message={
          restoring ? (
            <>
              <strong className="text-text-1">{displayName(restoring)}</strong> can sign in again
              immediately. The suspension and this restore both stay in the audit log.
              {restoring.moderationSuspension?.reason ? (
                <> Suspended for: “{restoring.moderationSuspension.reason}”.</>
              ) : null}
            </>
          ) : undefined
        }
        onCancel={() => { if (!suspension.isPending) setRestoring(null); }}
        onConfirm={() => { if (restoring) suspension.mutate({ user: restoring, action: 'restore' }); }}
      />

      {suspending ? (
        <SuspendModal
          key={suspending._id}
          user={suspending}
          busy={suspension.isPending}
          error={suspendError}
          onCancel={() => { if (!suspension.isPending) { setSuspending(null); setSuspendError(null); } }}
          onConfirm={(note) => suspension.mutate({ user: suspending, action: 'suspend', note })}
        />
      ) : null}

      <p className="sr-only" role="status">
        {query.isFetching ? 'Loading users' : `${plural(users.length, 'user')} shown`}
      </p>
    </div>
  );
}
