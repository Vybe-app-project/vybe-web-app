import { useMemo, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { format } from 'date-fns';
import type { AxiosError } from 'axios';
import { adminApi, errMsg, mediaUrl } from '../../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Tabs,
  Textarea,
  cx,
  useToast,
} from '../../components/ui';
import {
  Flag,
  Check,
  Trash,
  Alert,
  Shield,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons';

/* --------------------------------------------------------------- types */

type ModerationAction =
  | 'mark_reviewed'
  | 'dismiss'
  | 'remove_content'
  | 'suspend_user'
  | 'restore_user';

type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';

type Report = {
  _id: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  detail?: string;
  status?: ReportStatus;
  createdAt?: string;
  reviewedAt?: string | null;
  moderationAction?: ModerationAction;
  moderationNote?: string;
  reviewedBy?: { fullName?: string; email?: string } | null;
  reporter?: { username?: string; fullName?: string; avatar?: string; email?: string } | null;
  targetOwner?: {
    _id?: string;
    username?: string;
    fullName?: string;
    avatar?: string;
    email?: string;
    isActive?: boolean;
    isDeleted?: boolean;
    moderationSuspension?: { active?: boolean; reason?: string } | null;
  } | null;
  targetPreview?: Record<string, any> | null;
};

type ReportsResponse = {
  reports: Report[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

/** Every action the backend accepts, with its client-side requirements. */
const ACTIONS: Array<{
  value: ModerationAction;
  label: string;
  description: string;
  requiresNote: boolean;
  destructive: boolean;
}> = [
  {
    value: 'mark_reviewed',
    label: 'Mark reviewed',
    description: 'Acknowledge the report without enforcement. The note is optional.',
    requiresNote: false,
    destructive: false,
  },
  {
    value: 'dismiss',
    label: 'Dismiss',
    description: 'Close the report as not actionable. The note is optional.',
    requiresNote: false,
    destructive: false,
  },
  {
    value: 'remove_content',
    label: 'Remove content',
    description: 'Take down the reported content. A short reason is required.',
    requiresNote: true,
    destructive: true,
  },
  {
    value: 'suspend_user',
    label: 'Suspend account',
    description: 'Suspend the owner of the reported content. A short reason is required.',
    requiresNote: true,
    destructive: true,
  },
  {
    value: 'restore_user',
    label: 'Restore account',
    description: 'Lift a suspension previously applied to this account.',
    requiresNote: false,
    destructive: false,
  },
];

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

const STATUS_TONE: Record<ReportStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  pending: 'warning',
  reviewed: 'info',
  actioned: 'success',
  dismissed: 'neutral',
};

const LIMIT = 20;

/* --------------------------------------------------------- preview cell */

function TargetPreview({ report }: { report: Report }) {
  const preview = report.targetPreview ?? null;
  const text =
    preview?.content ??
    preview?.text ??
    preview?.caption ??
    preview?.message ??
    preview?.bio ??
    '';
  const image =
    preview?.thumbnail ??
    preview?.url ??
    (Array.isArray(preview?.medias) ? preview?.medias[0]?.thumbnail || preview?.medias[0]?.url : null);

  if (!preview) {
    return (
      <p className="text-[12px] text-slate-600 italic">
        Target content is unavailable (it may already be removed).
      </p>
    );
  }

  return (
    <div className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
      {image ? (
        <img
          src={mediaUrl(String(image))}
          alt=""
          loading="lazy"
          className="h-14 w-14 shrink-0 rounded-lg border border-slate-800 object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 text-[13px] leading-relaxed text-slate-300">
          {String(text).trim() || (
            <span className="text-slate-600 italic">No text content</span>
          )}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- action modal */

function ActionModal({
  report,
  onClose,
}: {
  report: Report;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success } = useToast();
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const chosen = ACTIONS.find((a) => a.value === action) ?? null;
  const noteRequired = chosen?.requiresNote ?? false;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('Choose a moderation action');
      // The API rejects a bare {status}. It needs a concrete `action`, plus a
      // `note` for destructive enforcement.
      const body: { action: ModerationAction; note?: string } = { action };
      const trimmed = note.trim();
      if (trimmed) body.note = trimmed.slice(0, 1000);
      const { data } = await adminApi.patch(`/admin/reports/${report._id}`, body);
      return data;
    },
    onSuccess: () => {
      success(`Report ${chosen?.label.toLowerCase() ?? 'updated'}.`);
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
      onClose();
    },
    onError: (e) => {
      const status = (e as AxiosError)?.response?.status;
      const msg = errMsg(e, 'Could not apply this moderation action.');
      if (status === 409) {
        setConflict(msg);
        setFormError(null);
      } else {
        setConflict(null);
        setFormError(msg);
      }
    },
  });

  function submit() {
    setFormError(null);
    setConflict(null);
    if (!action) {
      setFormError('Select an enforcement action first.');
      return;
    }
    if (noteRequired && note.trim().length < 5) {
      setFormError('A short reason (at least 5 characters) is required for this action.');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      open
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Enforce moderation decision"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={chosen?.destructive ? 'ghost' : 'primary'}
            loading={mutation.isPending}
            onClick={submit}
            className={
              chosen?.destructive
                ? 'border-red-500/40 bg-red-500/15 text-red-300'
                : undefined
            }
          >
            {chosen ? `Apply: ${chosen.label}` : 'Apply action'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone="danger">{report.reason || 'unspecified'}</Badge>
            <Badge tone="neutral">{report.targetType || 'unknown target'}</Badge>
            {report.status ? (
              <Badge tone={STATUS_TONE[report.status] ?? 'neutral'}>{report.status}</Badge>
            ) : null}
          </div>
          {report.detail ? (
            <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{report.detail}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-slate-500">
            Reported by{' '}
            {report.reporter?.username
              ? `@${report.reporter.username}`
              : report.reporter?.fullName || 'a member'}
            {report.createdAt
              ? ` · ${format(new Date(report.createdAt), 'MMM d, yyyy HH:mm')}`
              : ''}
          </p>
        </div>

        <div>
          <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Enforcement action
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.map((a) => {
              const active = action === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => { setAction(a.value); setFormError(null); }}
                  className={cx(
                    'rounded-xl border p-3 text-left transition-colors',
                    active
                      ? a.destructive
                        ? 'border-red-500/50 bg-red-500/10'
                        : 'border-amber-500/50 bg-amber-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700',
                  )}
                >
                  <span
                    className={cx(
                      'flex items-center gap-1.5 text-sm font-bold',
                      active ? (a.destructive ? 'text-red-200' : 'text-amber-200') : 'text-slate-200',
                    )}
                  >
                    {a.destructive ? <Trash size={14} /> : <Check size={14} />}
                    {a.label}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                    {a.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Textarea
          label={noteRequired ? 'Moderation note (required)' : 'Moderation note (optional)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder={
            noteRequired
              ? 'Explain why this enforcement is being applied…'
              : 'Optional context for the audit log…'
          }
          hint={`${note.length}/1000`}
          className="border-slate-800 bg-slate-900/70 text-slate-100"
        />

        {conflict ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <Alert size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-200">Moderation conflict</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-amber-200/80">
                {conflict} Refresh the queue and confirm the current state before retrying — your
                change was not applied.
              </p>
            </div>
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- page */

export default function AdminReports() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Report | null>(null);

  const query = useQuery<ReportsResponse>({
    queryKey: ['admin', 'reports', status, page],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (status !== 'all') params.status = status;
      const { data } = await adminApi.get('/admin/reports', { params });
      return {
        reports: Array.isArray(data?.reports) ? data.reports : [],
        total: Number(data?.total) || 0,
        page: Number(data?.page) || page,
        hasNextPage: Boolean(data?.hasNextPage),
      };
    },
    placeholderData: keepPreviousData,
  });

  const reports = query.data?.reports ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const tabs = useMemo(
    () => STATUS_TABS.map((t) => ({ key: t.key, label: t.label })),
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every decision requires a concrete enforcement action; destructive actions also require
            a written reason.
          </p>
        </div>
        <Badge tone="neutral">{total.toLocaleString()} in queue</Badge>
      </div>

      <Tabs
        tabs={tabs}
        active={status}
        onChange={(k) => { setStatus(k); setPage(1); }}
      />

      {query.isError ? (
        <ErrorState
          error={query.error}
          retry={() => void query.refetch()}
          title="Could not load reports"
        />
      ) : query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-slate-800 bg-slate-950/60">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-3 h-14 w-full" />
              <Skeleton className="mt-3 h-3 w-56" />
            </Card>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card className="border-slate-800 bg-slate-950/60">
          <EmptyState
            icon={<Flag size={22} />}
            title={status === 'pending' ? 'Queue is clear' : 'No reports here'}
            message={
              status === 'pending'
                ? 'There are no pending reports awaiting moderation.'
                : `No reports with status “${status}”.`
            }
          />
        </Card>
      ) : (
        <div className={cx('space-y-3', query.isFetching && 'opacity-60')}>
          {reports.map((r) => {
            const owner = r.targetOwner;
            const suspended = Boolean(owner?.moderationSuspension?.active);
            return (
              <Card key={r._id} className="border-slate-800 bg-slate-950/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{r.reason || 'unspecified'}</Badge>
                    <Badge tone="neutral">{r.targetType || 'unknown'}</Badge>
                    {r.status ? (
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                    ) : null}
                    {suspended ? <Badge tone="warning">Owner suspended</Badge> : null}
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">
                    {r.createdAt ? format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') : '—'}
                  </span>
                </div>

                {r.detail ? (
                  <p className="mt-3 text-[13px] leading-relaxed text-slate-300">{r.detail}</p>
                ) : null}

                <div className="mt-3">
                  <TargetPreview report={r} />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      src={r.reporter?.avatar}
                      name={r.reporter?.fullName || r.reporter?.username}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                        Reporter
                      </p>
                      <p className="truncate text-[13px] text-slate-200">
                        {r.reporter?.username ? `@${r.reporter.username}` : r.reporter?.fullName || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      src={owner?.avatar}
                      name={owner?.fullName || owner?.username}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                        Content owner
                      </p>
                      <p className="truncate text-[13px] text-slate-200">
                        {owner?.username ? `@${owner.username}` : owner?.fullName || '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {r.moderationAction || r.moderationNote ? (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                    <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                      <Shield size={12} /> Prior decision
                    </p>
                    <p className="mt-1 text-[12px] text-slate-300">
                      {r.moderationAction ? r.moderationAction.replace(/_/g, ' ') : 'n/a'}
                      {r.reviewedBy?.fullName ? ` · by ${r.reviewedBy.fullName}` : ''}
                      {r.reviewedAt
                        ? ` · ${format(new Date(r.reviewedAt), 'MMM d, yyyy HH:mm')}`
                        : ''}
                    </p>
                    {r.moderationNote ? (
                      <p className="mt-1 text-[12px] text-slate-500 italic">“{r.moderationNote}”</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end">
                  <Button variant="primary" size="sm" onClick={() => setActive(r)}>
                    Take action
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {reports.length > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-slate-500">
            Page {page} of {totalPages} · {total.toLocaleString()} reports
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
              disabled={!query.data?.hasNextPage || query.isFetching}
              onClick={() => setPage((n) => n + 1)}
            >
              Next <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      ) : null}

      {active ? (
        <ActionModal
          key={active._id}
          report={active}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}
