import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminApi } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  cx,
} from '../../components/ui';
import {
  List,
  Filter,
  X,
  Refresh,
  Eye,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons';

type AuditEntry = {
  _id: string;
  action?: string;
  actorModel?: 'Admin' | 'User';
  actorSnapshot?: { fullName?: string; email?: string; role?: string };
  targetType?: string;
  targetId?: string;
  targetSnapshot?: Record<string, any>;
  metadata?: Record<string, any>;
  request?: { requestId?: string; ip?: string; userAgent?: string };
  createdAt?: string;
};

type AuditResponse = {
  entries: AuditEntry[];
  pagination?: { page: number; limit: number; total: number; pages: number };
};

const LIMIT_OPTIONS = [25, 50, 100];

/** Server-side pattern: /^[A-Za-z][A-Za-z0-9_]{2,79}$/ */
const ACTION_RE = /^[A-Za-z][A-Za-z0-9_]{2,79}$/;

const TARGET_TYPE_OPTIONS = ['', 'user', 'post', 'admin', 'report', 'comment', 'support'];

function toneForAction(action?: string): 'danger' | 'warning' | 'success' | 'info' | 'neutral' {
  const a = (action || '').toUpperCase();
  if (a.includes('DELETE') || a.includes('REMOVE') || a.includes('SUSPEND')) return 'danger';
  if (a.includes('CREATE') || a.includes('ADD') || a.includes('APPROVE') || a.includes('RESTORE'))
    return 'success';
  if (a.includes('UPDATE') || a.includes('CHANGE') || a.includes('PASSWORD')) return 'warning';
  if (a.includes('LOGIN') || a.includes('REVIEW')) return 'info';
  return 'neutral';
}

function EntryModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const blocks: Array<[string, unknown]> = [
    ['Target snapshot', entry.targetSnapshot],
    ['Metadata', entry.metadata],
    ['Request', entry.request],
  ];
  return (
    <Modal open onClose={onClose} title="Audit entry" size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneForAction(entry.action)}>{entry.action || 'UNKNOWN'}</Badge>
          {entry.targetType ? <Badge tone="neutral">{entry.targetType}</Badge> : null}
          {entry.actorSnapshot?.role ? (
            <Badge tone="info">{entry.actorSnapshot.role.replace(/_/g, ' ')}</Badge>
          ) : null}
        </div>

        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ['Actor', entry.actorSnapshot?.fullName || entry.actorSnapshot?.email || '—'],
            ['Actor email', entry.actorSnapshot?.email || '—'],
            ['Actor model', entry.actorModel || '—'],
            ['Target id', entry.targetId || '—'],
            [
              'Timestamp',
              entry.createdAt ? format(new Date(entry.createdAt), 'MMM d, yyyy HH:mm:ss') : '—',
            ],
            ['Entry id', entry._id],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
              <dt className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                {label}
              </dt>
              <dd className="mt-1 font-mono text-[12px] break-all text-slate-200">{String(value)}</dd>
            </div>
          ))}
        </dl>

        {blocks.map(([label, value]) =>
          value && typeof value === 'object' && Object.keys(value as object).length > 0 ? (
            <div key={label}>
              <p className="mb-1.5 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                {label}
              </p>
              <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-slate-300">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          ) : null,
        )}
      </div>
    </Modal>
  );
}

export default function AdminAudit() {
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  // Debounce the free-text action filter; it is validated server-side.
  useEffect(() => {
    const t = setTimeout(() => {
      setAction(actionInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [actionInput]);

  const actionInvalid = action.length > 0 && !ACTION_RE.test(action);

  const query = useQuery<AuditResponse>({
    queryKey: ['admin', 'audit', page, limit, action, targetType],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit };
      if (action && !actionInvalid) params.action = action;
      if (targetType) params.targetType = targetType;
      const { data } = await adminApi.get('/admins/audit-log', { params });
      return {
        entries: Array.isArray(data?.entries) ? data.entries : [],
        pagination: data?.pagination,
      };
    },
    placeholderData: keepPreviousData,
  });

  const entries = query.data?.entries ?? [];
  const p = query.data?.pagination;
  const total = p?.total ?? entries.length;
  const totalPages = Math.max(1, p?.pages ?? 1);
  const hasFilters = Boolean(action || targetType);

  const rangeLabel = useMemo(() => {
    if (!total) return 'No entries';
    const from = (page - 1) * limit + 1;
    return `${from.toLocaleString()}–${Math.min(page * limit, total).toLocaleString()} of ${total.toLocaleString()}`;
  }, [page, limit, total]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Audit log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Immutable record of privileged staff actions. SUPER_ADMIN access only.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Refresh size={14} />}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>

      <Card className="border-slate-800 bg-slate-950/60">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              label="Action"
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              placeholder="e.g. USER_ACCOUNT_DELETED"
              maxLength={80}
              error={actionInvalid ? 'Letters, digits and underscores only (3–80 chars).' : null}
              className="border-slate-800 bg-slate-900/70 font-mono text-slate-100"
            />
          </div>
          <div className="min-w-[180px]">
            <label
              htmlFor="audit-target-type"
              className="mb-1.5 block text-xs font-semibold text-slate-400"
            >
              Target type
            </label>
            <select
              id="audit-target-type"
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
              className="input-base border-slate-800 bg-slate-900/70 text-slate-100"
            >
              {TARGET_TYPE_OPTIONS.map((t) => (
                <option key={t || 'all'} value={t}>{t || 'All types'}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[110px]">
            <label htmlFor="audit-limit" className="mb-1.5 block text-xs font-semibold text-slate-400">
              Rows
            </label>
            <select
              id="audit-limit"
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              className="input-base border-slate-800 bg-slate-900/70 text-slate-100"
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              icon={<X size={14} />}
              onClick={() => { setActionInput(''); setTargetType(''); setPage(1); }}
            >
              Clear
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 pb-2.5 text-xs text-slate-600">
              <Filter size={13} /> No filters applied
            </span>
          )}
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden border-slate-800 bg-slate-950/60">
        {query.isError ? (
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load the audit log"
          />
        ) : query.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<List size={22} />}
            title={hasFilters ? 'No matching entries' : 'No audit entries yet'}
            message={
              hasFilters
                ? 'Adjust the action or target-type filter to widen the search.'
                : 'Privileged staff actions will be recorded here.'
            }
            action={
              hasFilters ? (
                <Button variant="ghost" onClick={() => { setActionInput(''); setTargetType(''); }}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Actor</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className={cx('divide-y divide-slate-800/70', query.isFetching && 'opacity-60')}>
                {entries.map((e) => (
                  <tr key={e._id} className="transition-colors hover:bg-slate-900/40">
                    <td className="px-4 py-3 font-mono text-[12px] whitespace-nowrap text-slate-500">
                      {e.createdAt ? format(new Date(e.createdAt), 'MMM d, yyyy HH:mm:ss') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={toneForAction(e.action)}>{e.action || 'UNKNOWN'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="truncate font-semibold text-slate-200">
                        {e.actorSnapshot?.fullName || e.actorSnapshot?.email || '—'}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-500">
                        {e.actorSnapshot?.email || e.actorModel || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-300">{e.targetType || '—'}</p>
                      <p className="truncate font-mono text-[11px] text-slate-600">
                        {e.targetId || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye size={14} />}
                        onClick={() => setSelected(e)}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
            <p className="font-mono text-[11px] text-slate-500">{rangeLabel}</p>
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
              <span className="font-mono text-xs text-slate-400">
                {page} / {totalPages}
              </span>
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
      </Card>

      {selected ? <EntryModal entry={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
