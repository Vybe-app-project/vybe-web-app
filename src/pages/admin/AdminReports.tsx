import { useMemo, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { adminApi, errMsg, mediaUrl } from '../../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Tabs,
  Textarea,
  cx,
  ensureSentence,
  fmtStamp,
  humanize,
  plural,
  useToast,
} from '../../components/ui';
import { Flag, Check, Trash, Shield } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp } from './AdminLayout';

/* --------------------------------------------------------------- types */

type ModerationAction =
  | 'mark_reviewed'
  | 'dismiss'
  | 'remove_content'
  | 'suspend_user'
  | 'restore_user';

type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';

/**
 * What reportController.targetPreview() sends. `title` is the headline
 * (username for accounts, "<Category> post" for posts, the meal or workout
 * title otherwise), `body` the text (display name, caption, description),
 * `imageUrl` the first image already signed. When the target is gone the
 * API replays the snapshot stored at report time with `removed: true`.
 */
type TargetPreview = {
  id?: string | null;
  type?: string;
  exists?: boolean;
  removed?: boolean;
  title?: string;
  body?: string;
  imageUrl?: string | null;
  ownerId?: string;
  visibility?: 'public' | 'private';
  createdAt?: string | null;
};

type ReportOwner = {
  _id?: string;
  username?: string;
  fullName?: string;
  avatar?: string;
  email?: string;
  /** publicOwner(): true while moderation has the account suspended. */
  suspended?: boolean;
  suspensionReason?: string;
  suspendedAt?: string | null;
  available?: boolean;
};

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
  targetOwner?: ReportOwner | null;
  targetPreview?: TargetPreview | null;
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
  successMessage: string;
  requiresNote: boolean;
  destructive: boolean;
}> = [
  {
    value: 'mark_reviewed',
    label: 'Mark reviewed',
    description: 'Acknowledge the report without enforcement. A note is optional.',
    successMessage: 'Marked as reviewed',
    requiresNote: false,
    destructive: false,
  },
  {
    value: 'dismiss',
    label: 'Dismiss',
    description: 'Close the report as not actionable. A note is optional.',
    successMessage: 'Report dismissed',
    requiresNote: false,
    destructive: false,
  },
  {
    value: 'remove_content',
    label: 'Remove content',
    description: 'Take down the reported content. A short reason is required.',
    successMessage: 'Content removed',
    requiresNote: true,
    destructive: true,
  },
  {
    value: 'suspend_user',
    label: 'Suspend account',
    description: 'Suspend the owner of the reported content. A short reason is required.',
    successMessage: 'Account suspended',
    requiresNote: true,
    destructive: true,
  },
  {
    value: 'restore_user',
    label: 'Restore account',
    description: 'Lift a suspension previously applied to this account.',
    successMessage: 'Account restored',
    requiresNote: false,
    destructive: false,
  },
];

/**
 * Why an action cannot apply to this report right now. The server answers
 * 409 for each of these; saying so up front saves the round trip and the
 * "conflict" callout for a state the moderator can already see.
 */
function unavailableReason(action: ModerationAction, report: Report): string | null {
  const preview = report.targetPreview;
  const owner = report.targetOwner;
  const gone = preview?.removed === true || preview?.exists === false;
  if (report.status === 'actioned' && report.moderationAction === action) return 'Already applied';
  if (action === 'remove_content') {
    if (report.targetType === 'user') return 'Not available for account reports';
    if (gone) return 'Content already removed';
  }
  if (action === 'suspend_user' && owner?.suspended) return 'Owner is already suspended';
  if (action === 'restore_user' && owner && !owner.suspended) return 'Owner is not suspended';
  return null;
}

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

function TargetPreviewCard({ report }: { report: Report }) {
  const preview = report.targetPreview ?? null;

  if (!preview) {
    return (
      <p className="text-xs text-text-3 italic">
        Target content is unavailable. It may already have been removed.
      </p>
    );
  }

  const gone = preview.removed === true || preview.exists === false;
  const isUser = (preview.type ?? report.targetType) === 'user';
  const title = (preview.title ?? '').trim();
  const body = (preview.body ?? '').trim();
  const image = preview.imageUrl ? String(preview.imageUrl) : '';

  return (
    <div
      className={cx(
        'admin-preview flex gap-3 rounded-sm border p-2.5',
        gone ? 'border-line-strong bg-surface-1' : 'border-line bg-surface-2',
      )}
      data-removed={gone ? 'true' : undefined}
    >
      {isUser ? (
        <Avatar src={image || undefined} name={body || title} size="md" />
      ) : image ? (
        <img
          src={mediaUrl(image)}
          alt=""
          loading="lazy"
          className={cx(
            'h-14 w-14 shrink-0 rounded-xs border border-line object-cover',
            gone && 'opacity-60 grayscale',
          )}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {title ? (
            <p className="type-label truncate text-text-2">{isUser ? `@${title}` : title}</p>
          ) : null}
          {gone ? (
            <Badge tone="neutral" size="sm">Content removed</Badge>
          ) : preview.visibility === 'private' ? (
            <Badge tone="neutral" size="sm">Private</Badge>
          ) : null}
        </div>
        {gone ? (
          <p className="mt-0.5 text-sm text-text-2">
            Content no longer available.{body ? ' Snapshot from the time of the report:' : ''}
          </p>
        ) : null}
        {body ? (
          <p
            className={cx(
              'line-clamp-3 text-sm leading-relaxed',
              gone ? 'text-text-3 italic' : 'text-text-1',
            )}
          >
            {body}
          </p>
        ) : !gone ? (
          <p className="text-sm text-text-3 italic">{isUser ? 'No display name' : 'No caption'}</p>
        ) : null}
      </div>
    </div>
  );
}

function Party({
  label,
  person,
}: {
  label: string;
  person?: { username?: string; fullName?: string; avatar?: string } | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={person?.avatar} name={person?.fullName || person?.username} size="sm" />
      <div className="min-w-0">
        <p className="type-label text-text-2">{label}</p>
        <p className="truncate text-sm text-text-1">
          {person?.username ? `@${person.username}` : person?.fullName || '—'}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- action modal */

function ActionModal({ report, onClose }: { report: Report; onClose: () => void }) {
  const qc = useQueryClient();
  const { success } = useToast();
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const chosen = ACTIONS.find((a) => a.value === action) ?? null;
  const noteRequired = chosen?.requiresNote ?? false;

  const refreshQueue = () => void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });

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
      success(chosen?.successMessage ?? 'Report updated');
      refreshQueue();
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
      description="Pick one action. Destructive actions need a written reason and are recorded in the audit log."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={chosen?.destructive ? 'danger' : 'primary'}
            loading={mutation.isPending}
            onClick={submit}
          >
            {chosen ? `Apply: ${chosen.label}` : 'Apply action'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-sm border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">{humanize(report.reason) || 'Unspecified'}</Badge>
            <Badge tone="neutral">{humanize(report.targetType) || 'Unknown target'}</Badge>
            {report.status ? (
              <Badge tone={STATUS_TONE[report.status] ?? 'neutral'}>{humanize(report.status)}</Badge>
            ) : null}
          </div>
          {report.detail ? (
            <p className="mt-2 text-sm leading-relaxed text-text-1">{report.detail}</p>
          ) : null}
          <p className="mt-2 text-xs text-text-2">
            Reported by{' '}
            {report.reporter?.username
              ? `@${report.reporter.username}`
              : report.reporter?.fullName || 'a member'}
            {report.createdAt ? ` on ${fmtStamp(report.createdAt)}` : ''}
          </p>
        </div>

        <fieldset>
          <legend className="type-label mb-2 text-text-2">Enforcement action</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.map((a) => {
              const active = action === a.value;
              const unavailable = unavailableReason(a.value, report);
              return (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={active}
                  aria-disabled={unavailable ? true : undefined}
                  disabled={Boolean(unavailable)}
                  data-tone={a.destructive ? 'danger' : 'brand'}
                  title={unavailable ?? undefined}
                  onClick={() => { setAction(a.value); setFormError(null); }}
                  className={cx('admin-option', unavailable && 'cursor-not-allowed opacity-60')}
                >
                  <span
                    className={cx(
                      'flex items-center gap-1.5 text-sm font-semibold',
                      active ? (a.destructive ? 'text-danger' : 'text-brand-text') : 'text-text-1',
                    )}
                  >
                    {a.destructive ? <Trash size={16} /> : <Check size={16} />}
                    {a.label}
                    {unavailable ? (
                      <Badge tone="neutral" size="sm" className="ml-auto">{unavailable}</Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-2">{a.description}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <Textarea
          label={noteRequired ? 'Moderation note (required)' : 'Moderation note (optional)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder={
            noteRequired
              ? 'Explain why this enforcement is being applied'
              : 'Optional context for the audit log'
          }
          hint={`${note.length}/1000`}
        />

        {conflict ? (
          <Callout
            tone="warning"
            title="Moderation conflict"
            action={
              <Button size="sm" variant="secondary" onClick={() => { refreshQueue(); onClose(); }}>
                Refresh queue
              </Button>
            }
          >
            <p>{ensureSentence(conflict)}</p>
            <p className="mt-1">
              Refresh the queue and confirm the current state before retrying. Your change was not applied.
            </p>
          </Callout>
        ) : null}

        {formError ? <Callout tone="danger">{formError}</Callout> : null}
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

  const tabs = useMemo(() => STATUS_TABS.map((t) => ({ key: t.key, label: t.label })), []);

  // The count badge names what is counted: "3 pending" on the queue, "12
  // reports" on All, "4 dismissed" on a status tab, rather than "N in queue"
  // for every tab.
  const countLabel =
    status === 'pending'
      ? `${total.toLocaleString()} pending`
      : status === 'all'
        ? plural(total, 'report')
        : `${total.toLocaleString()} ${humanize(status).toLowerCase()}`;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Reports"
        subtitle="Every decision needs a concrete enforcement action; destructive actions also need a written reason."
        meta={<Badge tone="neutral"><span className="tabular">{countLabel}</span></Badge>}
      />

      <Tabs
        aria-label="Report status"
        tabs={tabs}
        active={status}
        onChange={(k) => { setStatus(k); setPage(1); }}
      />

      {query.isError ? (
        <Card>
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load reports"
          />
        </Card>
      ) : query.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading reports">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-3 h-14 w-full" />
              <Skeleton className="mt-3 h-3 w-56" />
            </Card>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState
            variant={status === 'pending' ? 'first-run' : 'no-results'}
            icon={status === 'pending' ? <Flag size={24} /> : undefined}
            title={status === 'pending' ? 'The queue is clear' : 'No reports here'}
            message={
              status === 'pending'
                ? 'Nothing is waiting for moderation. New member reports land here first.'
                : `No reports with the status “${humanize(status).toLowerCase()}”.`
            }
            action={
              status !== 'pending'
                ? { label: 'Show pending', onClick: () => { setStatus('pending'); setPage(1); }, variant: 'secondary' }
                : undefined
            }
          />
        </Card>
      ) : (
        <div className={cx('space-y-3', query.isFetching && 'admin-fetching')}>
          {reports.map((r) => {
            const owner = r.targetOwner;
            const suspended = owner?.suspended === true;
            const gone = r.targetPreview?.removed === true || r.targetPreview?.exists === false;
            return (
              <Card key={r._id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{humanize(r.reason) || 'Unspecified'}</Badge>
                    <Badge tone="neutral">{humanize(r.targetType) || 'Unknown'}</Badge>
                    {r.status ? (
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{humanize(r.status)}</Badge>
                    ) : null}
                    {suspended ? (
                      <Badge
                        tone="warning"
                        title={owner?.suspensionReason ? `Reason: ${owner.suspensionReason}` : undefined}
                      >
                        Owner suspended
                      </Badge>
                    ) : null}
                    {gone ? <Badge tone="neutral">Content removed</Badge> : null}
                  </div>
                  <Stamp iso={r.createdAt} className="text-xs text-text-2" />
                </div>

                {r.detail ? (
                  <p className="mt-3 text-sm leading-relaxed text-text-1">{r.detail}</p>
                ) : null}

                <div className="mt-3">
                  <TargetPreviewCard report={r} />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Party label="Reporter" person={r.reporter} />
                  <Party label="Content owner" person={owner} />
                </div>

                {r.moderationAction || r.moderationNote ? (
                  <div className="mt-3 rounded-sm border border-line bg-surface-2 px-3 py-2">
                    <p className="type-label flex items-center gap-1.5 text-text-2">
                      <Shield size={14} /> Prior decision
                    </p>
                    <p className="mt-1 text-xs text-text-1">
                      {r.moderationAction ? humanize(r.moderationAction) : 'Not recorded'}
                      {r.reviewedBy?.fullName ? ` by ${r.reviewedBy.fullName}` : ''}
                      {r.reviewedAt ? ` on ${fmtStamp(r.reviewedAt)}` : ''}
                    </p>
                    {r.moderationNote ? (
                      <p className="mt-1 text-xs text-text-2 italic">“{r.moderationNote}”</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end">
                  <Button variant="primary" icon={<Shield size={16} />} onClick={() => setActive(r)}>
                    Take action
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {reports.length > 0 ? (
        <Pager
          page={page}
          totalPages={totalPages}
          canPrev={page > 1}
          canNext={Boolean(query.data?.hasNextPage)}
          busy={query.isFetching}
          onPrev={() => setPage((n) => Math.max(1, n - 1))}
          onNext={() => setPage((n) => n + 1)}
          label={plural(total, 'report')}
        />
      ) : null}

      {active ? (
        <ActionModal key={active._id} report={active} onClose={() => setActive(null)} />
      ) : null}
    </div>
  );
}
