import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { adminApi } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  cx,
  useToast,
} from '../../components/ui';
import {
  LifeBuoy,
  Check,
  Refresh,
  Trash,
  Mail,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons';

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
      success(next === 'resolved' ? 'Message marked resolved.' : 'Message reopened.');
      void qc.invalidateQueries({ queryKey: ['admin', 'support'] });
    },
    onError: (e) => toastError(e, 'Could not update this message.'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await adminApi.delete(`/admin/support/${id}`);
    },
    onSuccess: () => {
      success('Support message deleted.');
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Support inbox</h1>
          <p className="mt-1 text-sm text-slate-500">
            Contact-form submissions from members and visitors.
          </p>
        </div>
        <Badge tone="neutral">{total.toLocaleString()} messages</Badge>
      </div>

      <Tabs tabs={TABS} active={status} onChange={(k) => { setStatus(k); setPage(1); }} />

      {query.isError ? (
        <ErrorState
          error={query.error}
          retry={() => void query.refetch()}
          title="Could not load support messages"
        />
      ) : query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-slate-800 bg-slate-950/60">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="mt-3 h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <Card className="border-slate-800 bg-slate-950/60">
          <EmptyState
            icon={<LifeBuoy size={22} />}
            title={status === 'open' ? 'Inbox zero' : 'Nothing here'}
            message={
              status === 'open'
                ? 'There are no open support messages right now.'
                : `No messages with status “${status}”.`
            }
          />
        </Card>
      ) : (
        <div className={cx('space-y-3', query.isFetching && 'opacity-60')}>
          {messages.map((m) => {
            const resolved = m.status === 'resolved';
            const busy =
              (setStatusMutation.isPending && setStatusMutation.variables?.id === m._id) ||
              (remove.isPending && pendingDelete?._id === m._id);
            return (
              <Card key={m._id} className="border-slate-800 bg-slate-950/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-100">
                      {m.fullName || 'Anonymous'}
                    </p>
                    <a
                      href={m.email ? `mailto:${m.email}` : undefined}
                      className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[12px] break-all text-slate-500 hover:text-slate-300"
                    >
                      <Mail size={12} /> {m.email || '—'}
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={resolved ? 'success' : 'warning'}>
                      {resolved ? 'Resolved' : 'Open'}
                    </Badge>
                    {m.userId ? <Badge tone="info">Member</Badge> : <Badge tone="neutral">Guest</Badge>}
                  </div>
                </div>

                <p className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap text-slate-300">
                  {m.message?.trim() || <span className="text-slate-600 italic">Empty message</span>}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                  <p className="font-mono text-[11px] text-slate-500">
                    {m.createdAt
                      ? `${format(new Date(m.createdAt), 'MMM d, yyyy HH:mm')} · ${formatDistanceToNow(
                          new Date(m.createdAt),
                          { addSuffix: true },
                        )}`
                      : '—'}
                    {resolved && m.resolvedAt
                      ? ` · resolved ${format(new Date(m.resolvedAt), 'MMM d, yyyy')}`
                      : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={resolved ? <Refresh size={14} /> : <Check size={14} />}
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
                      variant="ghost"
                      icon={<Trash size={14} />}
                      className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
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
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-slate-500">
            Page {page} of {totalPages} · {total.toLocaleString()} messages
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<ChevronLeft size={14} />}
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((n) => Math.max(1, n - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages || query.isFetching}
              onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
            >
              Next <ChevronRight size={14} />
            </Button>
          </div>
        </div>
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
              <strong className="text-slate-100">
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
