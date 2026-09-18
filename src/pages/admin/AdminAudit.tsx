import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { adminApi } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  cx,
  fmtStamp,
  humanize,
} from '../../components/ui';
import { List, X, Refresh, Eye, Lock } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp } from './AdminLayout';

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
  /** Distinct targetType values actually recorded; drives the filter options. */
  targetTypes?: string[];
};

const LIMIT_OPTIONS = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} rows` }));

/** Server-side pattern: /^[A-Za-z][A-Za-z0-9_]{2,79}$/ */
const ACTION_RE = /^[A-Za-z][A-Za-z0-9_]{2,79}$/;

// Options come from the API's distinct targetTypes (see below). A hard-coded
// list used to offer "Support" while the backend records `support_message`,
// so the filter returned nothing, and left out workout / workout_plan.
const ALL_TYPES = { value: '', label: 'All types' };

function toneForAction(action?: string): 'danger' | 'warning' | 'success' | 'info' | 'neutral' {
  const a = (action || '').toUpperCase();
  if (a.includes('DELETE') || a.includes('REMOVE') || a.includes('SUSPEND')) return 'danger';
  if (a.includes('CREATE') || a.includes('ADD') || a.includes('APPROVE') || a.includes('RESTORE'))
    return 'success';
  if (a.includes('UPDATE') || a.includes('CHANGE') || a.includes('PASSWORD')) return 'warning';
  if (a.includes('LOGIN') || a.includes('REVIEW')) return 'info';
  return 'neutral';
}

/** Action codes are machine strings, so they keep their mono treatment. */
function ActionBadge({ action }: { action?: string }) {
  return (
    <Badge tone={toneForAction(action)} className="admin-code normal-case">
      {action || 'UNKNOWN'}
    </Badge>
  );
}

const stamp = (iso?: string) => fmtStamp(iso, { seconds: true });

/** Drop empty strings / nulls so a block never shows `requestId: ""`. */
function compactObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== '' && v !== null && v !== undefined,
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

function EntryModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const blocks: Array<[string, Record<string, unknown> | null]> = [
    ['Target snapshot', compactObject(entry.targetSnapshot)],
    ['Metadata', compactObject(entry.metadata)],
    ['Request', compactObject(entry.request)],
  ];
  const facts: Array<[string, string, boolean]> = [
    ['Actor', entry.actorSnapshot?.fullName || entry.actorSnapshot?.email || '—', false],
    ['Actor email', entry.actorSnapshot?.email || '—', false],
    ['Actor model', entry.actorModel || '—', false],
    ['Target ID', entry.targetId || '—', true],
    ['Timestamp', stamp(entry.createdAt), false],
    ['UTC', entry.createdAt ? fmtStamp(entry.createdAt, { seconds: true, timeZone: 'UTC' }) : '—', false],
    ['Entry ID', entry._id, true],
  ];
  return (
    <Modal open onClose={onClose} title="Audit entry" size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={entry.action} />
          {entry.targetType ? <Badge tone="neutral">{humanize(entry.targetType)}</Badge> : null}
          {entry.actorSnapshot?.role ? (
            <Badge tone="info">{humanize(entry.actorSnapshot.role)}</Badge>
          ) : null}
        </div>

        <dl className="grid gap-2 sm:grid-cols-2">
          {facts.map(([label, value, mono]) => (
            <div key={label} className="admin-kv">
              <dt>{label}</dt>
              <dd className={cx(mono ? 'admin-code' : 'tabular')}>{value}</dd>
            </div>
          ))}
        </dl>

        {blocks.map(([label, value]) =>
          value ? (
            <div key={label}>
              <p className="type-label mb-1.5 text-text-2">{label}</p>
              <pre className="admin-pre">{JSON.stringify(value, null, 2)}</pre>
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
        targetTypes: Array.isArray(data?.targetTypes) ? data.targetTypes.filter((t: unknown) => typeof t === 'string') : [],
      };
    },
    placeholderData: keepPreviousData,
    // A 403 is a stable answer (role), not a transient failure.
    retry: (count, e) => (e as AxiosError)?.response?.status !== 403 && count < 2,
  });

  const forbidden = query.isError && (query.error as AxiosError)?.response?.status === 403;

  const entries = query.data?.entries ?? [];
  const targetTypeOptions = useMemo(() => {
    const known = new Set(query.data?.targetTypes ?? []);
    if (targetType) known.add(targetType);
    return [ALL_TYPES, ...[...known].sort().map((t) => ({ value: t, label: humanize(t) }))];
  }, [query.data?.targetTypes, targetType]);
  const p = query.data?.pagination;
  const total = p?.total ?? entries.length;
  const totalPages = Math.max(1, p?.pages ?? 1);
  const hasFilters = Boolean(action || targetType);

  const rangeLabel = useMemo(() => {
    if (!total) return 'No entries';
    const from = (page - 1) * limit + 1;
    return `${from.toLocaleString()}–${Math.min(page * limit, total).toLocaleString()} of ${total.toLocaleString()}`;
  }, [page, limit, total]);

  const clearFilters = () => { setActionInput(''); setTargetType(''); setPage(1); };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Audit log"
        subtitle="Immutable record of privileged staff actions. Super admin access only."
        actions={
          <IconButton
            label="Refresh audit log"
            variant="secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <Refresh size={18} className={cx(query.isFetching && 'animate-spin')} />
          </IconButton>
        }
      />

      {forbidden ? null : (
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Action code"
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              placeholder="e.g. USER_ACCOUNT_DELETED"
              maxLength={80}
              autoCapitalize="characters"
              spellCheck={false}
              error={actionInvalid ? 'Letters, digits and underscores only (3–80 characters).' : null}
              className="admin-code"
            />
          </div>
          <div className="min-w-[180px]">
            <Select
              label="Target type"
              options={targetTypeOptions}
              value={targetType}
              onChange={(v) => { setTargetType(v); setPage(1); }}
            />
          </div>
          <div className="w-32">
            <Select
              label="Rows"
              options={LIMIT_OPTIONS}
              value={String(limit)}
              onChange={(v) => { setLimit(Number(v)); setPage(1); }}
            />
          </div>
          {hasFilters ? (
            <Button variant="ghost" icon={<X size={16} />} onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </Card>
      )}

      <Card padded={false} className="overflow-hidden">
        {forbidden ? (
          // Not an error to retry: the signed-in role simply cannot read it.
          <EmptyState
            variant="no-results"
            icon={<Lock size={24} />}
            title="Super admin access only"
            message="The audit log is limited to super administrators. Ask a super admin if you need an entry reviewed."
            action={{ label: 'Back to dashboard', to: '/admin', variant: 'secondary' }}
          />
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load the audit log"
          />
        ) : query.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading audit entries">
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
            variant={hasFilters ? 'no-results' : 'first-run'}
            icon={hasFilters ? undefined : <List size={24} />}
            title={hasFilters ? 'No matching entries' : 'No audit entries yet'}
            message={
              hasFilters
                ? 'Widen the action or target-type filter to see more.'
                : 'Privileged staff actions are recorded here as they happen.'
            }
            action={hasFilters ? { label: 'Clear filters', onClick: clearFilters, variant: 'secondary' } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="admin-table admin-table--actions min-w-[880px]">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Target</th>
                  <th scope="col" className="text-right"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody className={cx(query.isFetching && 'admin-fetching')}>
                {entries.map((e) => (
                  <tr key={e._id}>
                    <td className="whitespace-nowrap text-text-2">
                      <Stamp iso={e.createdAt} seconds />
                    </td>
                    <td><ActionBadge action={e.action} /></td>
                    <td>
                      <p className="truncate font-semibold text-text-1">
                        {e.actorSnapshot?.fullName || e.actorSnapshot?.email || '—'}
                      </p>
                      <p className="truncate text-xs text-text-2">
                        {e.actorSnapshot?.email || e.actorModel || ''}
                      </p>
                    </td>
                    <td>
                      <p className="text-text-1">{e.targetType ? humanize(e.targetType) : '—'}</p>
                      {e.targetId ? <p className="admin-code truncate text-text-3">{e.targetId}</p> : null}
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye size={16} />}
                        onClick={() => setSelected(e)}
                        aria-label={`Details for ${e.action || 'entry'} at ${stamp(e.createdAt)}`}
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
          <Pager
            className="border-t border-line px-4 py-3"
            page={page}
            totalPages={totalPages}
            canPrev={page > 1}
            canNext={page < totalPages}
            busy={query.isFetching}
            onPrev={() => setPage((n) => Math.max(1, n - 1))}
            onNext={() => setPage((n) => Math.min(totalPages, n + 1))}
            label={rangeLabel}
          />
        ) : null}
      </Card>

      {selected ? <EntryModal entry={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
