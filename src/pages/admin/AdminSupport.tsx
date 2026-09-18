import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { adminApi } from '../../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  cx,
  plural,
  useToast,
} from '../../components/ui';
import { LifeBuoy, Check, Refresh, Trash, Mail } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp } from './AdminLayout';

type SupportStatus = 'open' | 'resolved';

type SupportMessage = {
  _id: string;
  userId?: string | null;
  fullName?: string;
  email?: string;
  message?: string;
  status?: SupportStatus;
  createdAt?: string;
  resolvedAt?: string | null;
  /** The account this message belongs to (by session, or by registered email), when there is one. */
  member?: { _id?: string; username?: string; fullName?: string; avatar?: string } | null;
};

type SupportResponse = {
  messages: SupportMessage[];
  pagination?: { page: number; limit: number; total: number; pages: number };
};

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

const LIMIT = 25;

export default function AdminSupport() {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();

  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<SupportMessage | null>(null);

  const query = useQuery<SupportResponse>({
    queryKey: ['admin', 'support', status, page],
    queryFn: async () => {
      const { data } = await adminApi.get('/admin/support', {
        params: { status, page, limit: LIMIT },
      });
      return {
        messages: Array.isArray(data?.messages) ? data.messages : [],
        pagination: data?.pagination,
      };
    },
    placeholderData: keepPreviousData,
  });

  const setStatusMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: SupportStatus }) => {
      await adminApi.patch(`/admin/support/${id}`, { status: next });
      return next;
    },
    onSuccess: (next) => {
      success(next === 'resolved' ? 'Message marked resolved' : 'Message reopened');
      void qc.invalidateQueries({ queryKey: ['admin', 'support'] });
    },
    onError: (e) => toastError(e, 'Could not update this message.'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await adminApi.delete(`/admin/support/${id}`);
    },
    onSuccess: () => {
      success('Support message deleted');
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'support'] });
    },
    onError: (e) => toastError(e, 'Could not delete this message.'),
  });

  const messages = query.data?.messages ?? [];
  const p = query.data?.pagination;
  const total = p?.total ?? messages.length;
  const totalPages = Math.max(1, p?.pages ?? 1);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Support inbox"
        subtitle="Contact-form submissions from members and visitors. Reply by email, then mark the thread resolved."
        meta={<Badge tone="neutral"><span className="tabular">{plural(total, 'message')}</span></Badge>}
      />

      <Tabs
        aria-label="Message status"
        tabs={TABS}
        active={status}
        onChange={(k) => { setStatus(k); setPage(1); }}
      />

      {query.isError ? (
        <Card>
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load support messages"
          />
        </Card>
      ) : query.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading messages">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-48" />
              <Skeleton className="mt-3 h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <Card>
          <EmptyState
            variant={status === 'open' ? 'first-run' : 'no-results'}
            icon={status === 'open' ? <LifeBuoy size={24} /> : undefined}
            title={status === 'open' ? 'Inbox zero' : 'Nothing here'}
            message={
              status === 'open'
                ? 'No open support messages. New submissions from the contact form land here.'
                : `No ${status === 'all' ? '' : status + ' '}messages yet.`
            }
            action={
              status !== 'open'
                ? { label: 'Show open', onClick: () => { setStatus('open'); setPage(1); }, variant: 'secondary' }
                : undefined
            }
          />
        </Card>
      ) : (
        <div className={cx('space-y-3', query.isFetching && 'admin-fetching')}>
          {messages.map((m) => {
            const resolved = m.status === 'resolved';
            const busy =
              (setStatusMutation.isPending && setStatusMutation.variables?.id === m._id) ||
              (remove.isPending && pendingDelete?._id === m._id);
            return (
              <Card key={m._id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-md font-semibold text-text-1">
                      {m.fullName || 'Anonymous'}
                    </p>
                    {m.email ? (
                      <a
                        href={`mailto:${m.email}`}
                        className="mt-0.5 inline-flex min-h-6 items-center gap-1.5 text-xs break-all text-text-2 underline decoration-line-strong underline-offset-3 hover:text-text-1 hover:decoration-current"
                      >
                        <Mail size={14} /> {m.email}
                      </a>
                    ) : (
                      <p className="mt-0.5 text-xs text-text-3">No reply address</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={resolved ? 'success' : 'warning'} dot>
                      {resolved ? 'Resolved' : 'Open'}
                    </Badge>
                    {m.member || m.userId ? (
                      <Link
                        to={`/admin/users?search=${encodeURIComponent(m.member?.username || m.email || '')}`}
                        className="inline-flex min-h-6 items-center rounded-xs focus-visible:outline-2"
                        aria-label={`Open member ${m.member?.username ? `@${m.member.username}` : m.email || ''} in Users`}
                      >
                        <Badge tone="info" className="gap-1.5">
                          <Avatar src={m.member?.avatar} name={m.member?.fullName || m.member?.username || m.fullName} size={16} />
                          Member{m.member?.username ? ` · @${m.member.username}` : ''}
                        </Badge>
                      </Link>
                    ) : (
                      <Badge tone="neutral">Guest</Badge>
                    )}
                  </div>
                </div>

                <p className="prose-measure mt-3 text-sm leading-relaxed whitespace-pre-wrap text-text-1">
                  {m.message?.trim() || <span className="text-text-3 italic">Empty message</span>}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <p className="tabular text-xs text-text-2">
                    {m.createdAt ? (
                      <>
                        <Stamp iso={m.createdAt} />
                        {' '}({formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })})
                      </>
                    ) : (
                      'Received date unknown'
                    )}
                    {resolved && m.resolvedAt ? <>, resolved <Stamp iso={m.resolvedAt} dateOnly /></> : null}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={resolved ? <Refresh size={16} /> : <Check size={16} />}
                      disabled={busy}
                      onClick={() =>
                        setStatusMutation.mutate({
                          id: m._id,
                          next: resolved ? 'open' : 'resolved',
                        })
                      }
                    >
                      {resolved ? 'Reopen' : 'Mark resolved'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash size={16} />}
                      disabled={busy}
                      onClick={() => setPendingDelete(m)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {messages.length > 0 ? (
        <Pager
          page={page}
          totalPages={totalPages}
          canPrev={page > 1}
          canNext={page < totalPages}
          busy={query.isFetching}
          onPrev={() => setPage((n) => Math.max(1, n - 1))}
          onNext={() => setPage((n) => Math.min(totalPages, n + 1))}
          label={plural(total, 'message')}
        />
      ) : null}

      <ConfirmDialog
        open={!!pendingDelete}
        destructive
        title="Delete support message"
        confirmLabel="Delete message"
        loading={remove.isPending}
        message={
          pendingDelete ? (
            <>
              Permanently delete the message from{' '}
              <strong className="text-text-1">
                {pendingDelete.fullName || pendingDelete.email || 'this sender'}
              </strong>
              ? This cannot be undone.
            </>
          ) : undefined
        }
        onCancel={() => { if (!remove.isPending) setPendingDelete(null); }}
        onConfirm={() => { if (pendingDelete) remove.mutate(pendingDelete._id); }}
      />
    </div>
  );
}
