import { useMemo, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { adminApi, mediaUrl } from '../../lib/api';
import { apiErrorDetails, describeAdminError } from '../../lib/apiError';
import {
  APPEAL_FILTERS,
  GUIDELINES,
  RESTORABLE_TARGETS,
  RULE_CITING_ACTIONS,
  SUSPENSION_DAYS,
  ageLabel,
  canDecideAppeal,
  durationError,
  noteError,
  ruleForReason,
  ruleLabel,
  slaState,
  type AppealFilter,
  type ReportAppeal,
  type ReportStatement,
  type SlaState,
} from '../../lib/adminReports';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  RadioGroup,
  Select,
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
import { Flag, Check, Trash, Shield, EyeOff } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp, useCurrentAdmin } from './AdminLayout';
import { AppealBlock, StatementBlock } from './adminCards';

/* --------------------------------------------------------------- types */

type ModerationAction =
  | 'mark_reviewed'
  | 'dismiss'
  | 'remove_content'
  | 'suspend_user'
  | 'restore_user'
  | 'mark_sensitive';

type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';

/**
 * What reportController.targetPreview() sends. `title` is the headline
 * (username for accounts, "<Category> post" for posts, the meal or workout
 * title otherwise), `body` the text (display name, caption, description),
 * `imageUrl` the first image already signed. When the target is gone the
 * API replays the snapshot stored at report time with `removed: true`.
 * Comments, chat lines and reviews also name their parent; live streams
 * carry their `status`.
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
  parentType?: string;
  parentId?: string;
  status?: string;
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
  updatedAt?: string;
  reviewedAt?: string | null;
  moderationAction?: ModerationAction;
  moderationNote?: string;
  reviewedBy?: { _id?: string; fullName?: string; email?: string } | null;
  reporter?: { _id?: string; username?: string; fullName?: string; avatar?: string; email?: string } | null;
  targetOwner?: ReportOwner | null;
  targetPreview?: TargetPreview | null;
  /** v2: written on remove_content / suspend_user / mark_sensitive / dismiss. */
  statement?: ReportStatement | null;
  /** v2: issuedAt + APPEAL_WINDOW_DAYS on appealable actions only. */
  appealUntil?: string | null;
  /** v2: present once the member appeals; one per report ever. */
  appeal?: ReportAppeal | null;
};

type ReportsResponse = {
  reports: Report[];
  total: number;
  page: number;
  hasNextPage: boolean;
};

type AdminIdentity = { _id?: string; role?: string } | undefined;

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
    value: 'mark_sensitive',
    label: 'Mark sensitive',
    description: 'Put a sensitivity screen over the post instead of removing it. Posts only; a short reason is required.',
    successMessage: 'Post marked sensitive',
    requiresNote: true,
    destructive: false,
  },
  {
    value: 'suspend_user',
    label: 'Suspend account',
    description: 'Suspend the owner of the reported content, for a set number of days or indefinitely. A short reason is required.',
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
  if (report.status === 'actioned' && action !== 'restore_user') return 'Report already actioned';
  if (action === 'remove_content') {
    if (report.targetType === 'user') return 'Not available for account reports';
    if (gone) return 'Content already removed';
  }
  if (action === 'mark_sensitive') {
    // The API answers 400 'Only posts can be marked sensitive' for anything else.
    if (report.targetType !== 'post') return 'Posts only';
    if (gone) return 'Content already removed';
  }
  if (action === 'suspend_user' && owner?.suspended) return 'Owner is already suspended';
  if (action === 'restore_user' && owner && !owner.suspended) return 'Owner is not suspended';
  return null;
}

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'appeals', label: 'Appeals' },
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

const APPEAL_TONE: Record<string, 'warning' | 'neutral' | 'success'> = {
  open: 'warning',
  upheld: 'neutral',
  reversed: 'success',
};

const SLA_TONE: Record<SlaState, 'neutral' | 'warning' | 'danger'> = {
  fresh: 'neutral',
  due: 'warning',
  overdue: 'danger',
  unknown: 'neutral',
};

/** The `?appeal=` values GET /admin/reports accepts, as the All tab offers them. */
const APPEAL_FILTER_LABELS: Record<AppealFilter, string> = {
  open: 'Open appeals',
  upheld: 'Upheld appeals',
  reversed: 'Reversed appeals',
  any: 'Has an appeal',
  none: 'No appeal',
};
const NO_APPEAL_FILTER = 'all';

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
          {preview.parentType ? (
            <Badge tone="neutral" size="sm">On a {humanize(preview.parentType).toLowerCase()}</Badge>
          ) : null}
          {preview.status && (preview.type ?? report.targetType) === 'livestream' ? (
            <Badge tone="info" size="sm">{humanize(preview.status)}</Badge>
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

/** The report's own facts, shared by both dialogs. */
function ReportSummary({ report }: { report: Report }) {
  return (
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
  );
}

/** A refresh-and-close callout for a 409: the queue moved under the moderator. */
function ConflictCallout({ conflict, onRefresh }: { conflict: string; onRefresh: () => void }) {
  return (
    <Callout
      tone="warning"
      title="Moderation conflict"
      action={
        <Button size="sm" variant="secondary" onClick={onRefresh}>
          Refresh queue
        </Button>
      }
    >
      <p>{ensureSentence(conflict)}</p>
      <p className="mt-1">
        Refresh the queue and confirm the current state before retrying. Your change was not applied.
      </p>
    </Callout>
  );
}

/* ---------------------------------------------------------- action modal */

const RULE_OPTIONS = GUIDELINES.map((g) => ({ value: g.code, label: ruleLabel(g), description: g.summary }));

function ActionModal({ report, onClose }: { report: Report; onClose: () => void }) {
  const qc = useQueryClient();
  const { success } = useToast();
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [note, setNote] = useState('');
  // The API cites the rule the report reason alleges when none is sent; the
  // picker starts there so a moderator only changes it when the finding differs.
  const [rule, setRule] = useState<string>(() => ruleForReason(report.reason).code);
  const [duration, setDuration] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const chosen = ACTIONS.find((a) => a.value === action) ?? null;
  const noteRequired = chosen?.requiresNote ?? false;
  const citesRule = action ? (RULE_CITING_ACTIONS as readonly string[]).includes(action) : false;
  const timed = action === 'suspend_user';

  const refreshQueue = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'queue'] });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('Choose a moderation action');
      // routes/admin.js accepts exactly action | status | note | rule |
      // durationDays; any other key is a 400. A bare {status} is rejected,
      // so the body always carries a concrete `action`.
      const body: { action: ModerationAction; note?: string; rule?: string; durationDays?: number } = { action };
      const trimmed = note.trim();
      if (trimmed) body.note = trimmed.slice(0, 1000);
      if (citesRule && rule) body.rule = rule;
      if (timed && duration.trim() !== '') body.durationDays = Number(duration.trim());
      const { data } = await adminApi.patch(`/admin/reports/${report._id}`, body);
      return data;
    },
    onSuccess: () => {
      success(chosen?.successMessage ?? 'Report updated');
      refreshQueue();
      onClose();
    },
    onError: (e) => {
      const status = apiErrorDetails(e).status;
      const msg = describeAdminError(e, 'Could not apply this moderation action.');
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
    const noteProblem = noteError(note, noteRequired);
    if (noteProblem) {
      setFormError(noteProblem);
      return;
    }
    if (timed) {
      const durationProblem = durationError(duration);
      if (durationProblem) {
        setFormError(durationProblem);
        return;
      }
    }
    mutation.mutate();
  }

  return (
    <Modal
      open
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Enforce moderation decision"
      description="Pick one action. Destructive actions need a written reason and are recorded in the audit log; the member receives a statement citing the guideline."
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
        <ReportSummary report={report} />

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
                    {a.destructive ? <Trash size={16} /> : a.value === 'mark_sensitive' ? <EyeOff size={16} /> : <Check size={16} />}
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

        {citesRule ? (
          <Select
            label="Guideline cited"
            value={rule}
            onChange={setRule}
            options={RULE_OPTIONS}
            hint={`The statement sent to the member names this rule. The report reason alleges ${ruleLabel(ruleForReason(report.reason))}.`}
          />
        ) : null}

        {timed ? (
          <Input
            label="Suspension length in days"
            type="number"
            inputMode="numeric"
            min={SUSPENSION_DAYS.min}
            max={SUSPENSION_DAYS.max}
            step={1}
            value={duration}
            onChange={(e) => { setDuration(e.target.value); setFormError(null); }}
            placeholder="Indefinite"
            hint={`Leave empty for indefinite; otherwise a whole number from ${SUSPENSION_DAYS.min} to ${SUSPENSION_DAYS.max}.`}
          />
        ) : null}

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

        {conflict ? <ConflictCallout conflict={conflict} onRefresh={() => { refreshQueue(); onClose(); }} /> : null}

        {formError ? <Callout tone="danger">{formError}</Callout> : null}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- appeal modal */

type AppealDecision = 'upheld' | 'reversed';

function AppealModal({ report, me, onClose }: { report: Report; me: AdminIdentity; onClose: () => void }) {
  const qc = useQueryClient();
  const { success } = useToast();
  const [decision, setDecision] = useState<AppealDecision | null>(null);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [reviewerConflict, setReviewerConflict] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const gate = canDecideAppeal(report, me);
  const restorable = (RESTORABLE_TARGETS as readonly string[]).includes(report.targetType ?? '');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'queue'] });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error('Choose a decision');
      // Exactly { decision, note }; any other key is a 400.
      const { data } = await adminApi.patch(`/admin/reports/${report._id}/appeal`, {
        decision,
        note: note.trim().slice(0, 1000),
      });
      return data;
    },
    onSuccess: () => {
      success(decision === 'reversed' ? 'Appeal reversed' : 'Appeal upheld');
      refresh();
      onClose();
    },
    onError: (e) => {
      const d = apiErrorDetails(e, 'Could not decide this appeal.');
      setConflict(null);
      setReviewerConflict(false);
      setFormError(null);
      if (d.status === 403 && d.code === 'APPEAL_REVIEWER_CONFLICT') setReviewerConflict(true);
      else if (d.status === 409) setConflict(describeAdminError(e, 'Could not decide this appeal.'));
      else setFormError(describeAdminError(e, 'Could not decide this appeal.'));
    },
  });

  function submit() {
    setFormError(null);
    setConflict(null);
    if (!decision) {
      setFormError('Choose whether the decision stands or is reversed.');
      return;
    }
    const problem = noteError(note, true);
    if (problem) {
      setFormError(problem);
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      open
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title="Decide appeal"
      description="The member is told the outcome and the linked support ticket is resolved by the API."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!gate.ok}
            title={gate.reason ?? undefined}
            onClick={submit}
          >
            {decision === 'reversed' ? 'Apply: Reverse decision' : decision === 'upheld' ? 'Apply: Keep decision' : 'Apply decision'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ReportSummary report={report} />
        <StatementBlock statement={report.statement} />
        <AppealBlock appeal={report.appeal} appealUntil={report.appealUntil} targetType={report.targetType} />

        {!gate.ok ? (
          <Callout tone="info" title={gate.reason ?? 'This appeal cannot be decided here'}>
            {gate.reason === 'You took the original action'
              ? 'Another administrator has to decide this appeal. A super admin may override.'
              : 'Refresh the queue to see the current state of this report.'}
          </Callout>
        ) : null}

        <RadioGroup
          label="Decision"
          value={decision}
          onChange={(v) => { setDecision(v === 'reversed' ? 'reversed' : 'upheld'); setFormError(null); }}
          options={[
            {
              value: 'upheld',
              label: 'Keep the decision',
              description: 'The enforcement stands. The member is told the appeal was reviewed and upheld.',
            },
            {
              value: 'reversed',
              label: 'Reverse the decision',
              description: restorable
                ? 'The post, live stream, community or account comes back, a sensitivity screen is cleared, and any strike is removed.'
                : 'Meals, workouts, plans, comments, chat lines and reviews were deleted outright and cannot come back. The record is corrected and the member is told.',
            },
          ]}
        />

        <Textarea
          label="Decision note (required)"
          value={note}
          onChange={(e) => { setNote(e.target.value); setFormError(null); }}
          maxLength={1000}
          rows={3}
          placeholder="Why the decision stands, or why it was wrong"
          hint={`${note.length}/1000. At least 5 characters.`}
        />

        {reviewerConflict ? (
          <Callout tone="warning" title="Another administrator has to decide this appeal.">
            You took the original action on this report. Reviewer independence is enforced by the API; a super admin may override.
          </Callout>
        ) : null}

        {conflict ? <ConflictCallout conflict={conflict} onRefresh={() => { refresh(); onClose(); }} /> : null}

        {formError ? <Callout tone="danger">{formError}</Callout> : null}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- page */

export default function AdminReports() {
  const [status, setStatus] = useState('pending');
  const [appealFilter, setAppealFilter] = useState<string>(NO_APPEAL_FILTER);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Report | null>(null);
  const [appealing, setAppealing] = useState<Report | null>(null);
  const me = useCurrentAdmin().data;

  // The appeal filter applies on the All tab only; the Appeals tab is the open queue.
  const effectiveAppeal = status === 'all' && appealFilter !== NO_APPEAL_FILTER ? appealFilter : '';

  const query = useQuery<ReportsResponse>({
    queryKey: ['admin', 'reports', status, effectiveAppeal, page],
    queryFn: async () => {
      const params: Record<string, string | number> =
        status === 'appeals' ? { page, limit: LIMIT, appeal: 'open' } : { page, limit: LIMIT };
      if (status !== 'appeals' && status !== 'all') params.status = status;
      if (effectiveAppeal) params.appeal = effectiveAppeal;
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
  const now = Date.now();

  const tabs = useMemo(() => STATUS_TABS.map((t) => ({ key: t.key, label: t.label })), []);
  const appealFilterOptions = useMemo(
    () => [
      { value: NO_APPEAL_FILTER, label: 'Any appeal state' },
      ...APPEAL_FILTERS.map((f) => ({ value: f, label: APPEAL_FILTER_LABELS[f] })),
    ],
    [],
  );

  // The count badge names what is counted: "3 pending" on the queue, "2 open
  // appeals" on Appeals, "12 reports" on All, "4 dismissed" on a status tab,
  // rather than "N in queue" for every tab.
  const countLabel =
    status === 'pending'
      ? `${total.toLocaleString()} pending`
      : status === 'appeals'
        ? plural(total, 'open appeal')
        : status === 'all'
          ? plural(total, 'report')
          : `${total.toLocaleString()} ${humanize(status).toLowerCase()}`;

  const queueTab = status === 'pending' || status === 'appeals';

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Reports"
        subtitle="Every decision needs a concrete enforcement action; destructive actions also need a written reason and cite a guideline. Members can appeal for 30 days."
        meta={<Badge tone="neutral"><span className="tabular">{countLabel}</span></Badge>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          aria-label="Report status"
          tabs={tabs}
          active={status}
          onChange={(k) => { setStatus(k); setPage(1); }}
        />
        {status === 'all' ? (
          <Select
            label="Appeal filter"
            hideLabel
            aria-label="Appeal filter"
            value={appealFilter}
            onChange={(v) => { setAppealFilter(v); setPage(1); }}
            options={appealFilterOptions}
            containerClassName="w-full sm:w-56"
          />
        ) : null}
      </div>

      {query.isError ? (
        <Card>
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load reports"
            message={describeAdminError(query.error, 'Try again in a moment.')}
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
            variant={queueTab ? 'first-run' : 'no-results'}
            icon={queueTab ? <Flag size={24} /> : undefined}
            title={status === 'pending' ? 'The queue is clear' : status === 'appeals' ? 'No open appeals' : 'No reports here'}
            message={
              status === 'pending'
                ? 'Nothing is waiting for moderation. New member reports land here first.'
                : status === 'appeals'
                  ? 'Members can appeal an enforced decision for 30 days. Open appeals land here, oldest first.'
                  : effectiveAppeal
                    ? `No reports match the appeal filter “${APPEAL_FILTER_LABELS[effectiveAppeal as AppealFilter]?.toLowerCase() ?? effectiveAppeal}”.`
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
            const appealStatus = typeof r.appeal?.status === 'string' ? r.appeal.status : null;
            const appealOpen = appealStatus === 'open';
            // SLA ageing: an open appeal ages from when it was opened; a
            // pending report from when it was filed. Decided rows carry none.
            const sla = appealOpen
              ? slaState(r.appeal?.openedAt, now, 'appeal')
              : r.status === 'pending'
                ? slaState(r.createdAt, now, 'report')
                : null;
            const decide = appealOpen ? canDecideAppeal(r, me) : null;
            return (
              <Card key={r._id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{humanize(r.reason) || 'Unspecified'}</Badge>
                    <Badge tone="neutral">{humanize(r.targetType) || 'Unknown'}</Badge>
                    {r.status ? (
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{humanize(r.status)}</Badge>
                    ) : null}
                    {appealStatus ? (
                      <Badge tone={APPEAL_TONE[appealStatus] ?? 'neutral'}>Appeal {humanize(appealStatus).toLowerCase()}</Badge>
                    ) : null}
                    {sla && sla.state !== 'unknown' ? (
                      <Badge tone={SLA_TONE[sla.state]} title={sla.state === 'overdue' ? 'Past the response target' : sla.state === 'due' ? 'Response target reached' : undefined}>
                        {ageLabel(sla.ageMs)}
                      </Badge>
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

                {r.statement ? (
                  <div className="mt-3">
                    <StatementBlock statement={r.statement} />
                  </div>
                ) : null}

                {r.appeal || r.appealUntil ? (
                  <div className="mt-3">
                    <AppealBlock appeal={r.appeal} appealUntil={r.appealUntil} targetType={r.targetType} now={now} />
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  {decide && !decide.ok && decide.reason ? (
                    <span className="text-xs text-text-2">{decide.reason}</span>
                  ) : null}
                  {appealOpen ? (
                    <Button
                      variant="primary"
                      icon={<Check size={16} />}
                      disabled={decide ? !decide.ok : false}
                      title={decide?.reason ?? undefined}
                      onClick={() => setAppealing(r)}
                    >
                      Decide appeal
                    </Button>
                  ) : null}
                  <Button variant={appealOpen ? 'secondary' : 'primary'} icon={<Shield size={16} />} onClick={() => setActive(r)}>
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

      {appealing ? (
        <AppealModal key={`appeal-${appealing._id}`} report={appealing} me={me} onClose={() => setAppealing(null)} />
      ) : null}
    </div>
  );
}
