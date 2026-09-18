import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, errMsg } from '../../lib/api';
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
  humanize,
  plural,
  useToast,
} from '../../components/ui';
import { Award, Check, X, Mail, ExternalLink } from '../../components/icons';
import { AdminPageHeader, Pager, Stamp } from './AdminLayout';

/** The server requires this many characters of reason to reject (trainerController). */
const REJECT_NOTE_MIN = 5;

type ApplicationStatus = 'pending' | 'approved' | 'rejected';

type TrainerApplication = {
  _id: string;
  username?: string;
  fullName?: string;
  email?: string;
  avatar?: string;
  isVerified?: boolean;
  isTrainer?: boolean;
  application?: {
    status?: ApplicationStatus | 'none';
    fields?: string[];
    experienceSummary?: string;
    credentialUrls?: string[];
    submittedAt?: string;
    reviewedAt?: string;
    decisionNote?: string;
  };
};

type ApplicationsResponse = {
  applications: TrainerApplication[];
  pagination?: { page: number; limit: number; total: number; pages: number };
};

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const LIMIT = 25;

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
};

/** Only http(s) credential links are rendered as anchors; anything else is shown as text. */
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

function DecisionModal({
  application,
  decision,
  onClose,
}: {
  application: TrainerApplication;
  decision: 'approve' | 'reject';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success } = useToast();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rejecting = decision === 'reject';
  // The API refuses a rejection without a short reason (400). Say so in the
  // label and validate before the round trip instead of after it.
  const noteTooShort = rejecting && note.trim().length < REJECT_NOTE_MIN;

  const mutation = useMutation({
    mutationFn: async () => {
      const body: { decision: 'approve' | 'reject'; decisionNote?: string } = { decision };
      const trimmed = note.trim();
      if (trimmed) body.decisionNote = trimmed.slice(0, 1000);
      await adminApi.patch(`/admin/trainer-applications/${application._id}`, body);
    },
    onSuccess: () => {
      success(
        decision === 'approve'
          ? `Approved ${application.username ? `@${application.username}` : 'the applicant'} as a trainer`
          : 'Application rejected',
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'trainer-applications'] });
      onClose();
    },
    onError: (e) => setError(errMsg(e, 'Could not record this decision.')),
  });

  const approving = decision === 'approve';

  return (
    <Modal
      open
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={approving ? 'Approve trainer application' : 'Reject trainer application'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={approving ? 'primary' : 'danger'}
            icon={approving ? <Check size={16} /> : <X size={16} />}
            loading={mutation.isPending}
            onClick={() => {
              setError(null);
              setTouched(true);
              if (noteTooShort) return;
              mutation.mutate();
            }}
          >
            {approving ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar src={application.avatar} name={application.fullName || application.username} size="md" />
          <div className="min-w-0">
            <p className="truncate text-md font-semibold text-text-1">
              {application.fullName || application.username || 'Applicant'}
            </p>
            <p className="truncate text-xs text-text-2">{application.email || 'No email on file'}</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-text-2">
          {approving
            ? 'Approving grants the trainer badge and unlocks coaching features on this account.'
            : 'Rejecting closes the application. The applicant can apply again later.'}
        </p>

        <Textarea
          label={rejecting ? 'Decision note (required)' : 'Decision note (optional)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={1000}
          rows={3}
          placeholder={rejecting ? 'Tell the applicant why (this is shared with them and kept in the audit trail)' : 'Shared context for the audit trail'}
          hint={rejecting ? `${note.length}/1000 · at least ${REJECT_NOTE_MIN} characters` : `${note.length}/1000`}
          error={touched && noteTooShort ? `Give the applicant a short reason (at least ${REJECT_NOTE_MIN} characters).` : undefined}
        />

        {error ? <Callout tone="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}

export default function AdminTrainers() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<{
    application: TrainerApplication;
    decision: 'approve' | 'reject';
  } | null>(null);

  const query = useQuery<ApplicationsResponse>({
    queryKey: ['admin', 'trainer-applications', status, page],
    queryFn: async () => {
      const { data } = await adminApi.get('/admin/trainer-applications', {
        params: { status, page, limit: LIMIT },
      });
      return {
        applications: Array.isArray(data?.applications) ? data.applications : [],
        pagination: data?.pagination,
      };
    },
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.applications ?? [];
  const p = query.data?.pagination;
  const total = p?.total ?? rows.length;
  const totalPages = Math.max(1, p?.pages ?? 1);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Trainer applications"
        subtitle="Verify credentials before granting coaching privileges."
        meta={<Badge tone="neutral"><span className="tabular">{plural(total, 'application')}</span></Badge>}
      />

      <Tabs
        aria-label="Application status"
        tabs={TABS}
        active={status}
        onChange={(k) => { setStatus(k); setPage(1); }}
      />

      {query.isError ? (
        <Card>
          <ErrorState
            error={query.error}
            retry={() => void query.refetch()}
            title="Could not load applications"
          />
        </Card>
      ) : query.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading applications">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-3 flex-1" />
              </div>
              <Skeleton className="mt-3 h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            variant={status === 'pending' ? 'first-run' : 'no-results'}
            icon={status === 'pending' ? <Award size={24} /> : undefined}
            title={status === 'pending' ? 'No applications waiting' : `No ${status} applications`}
            message={
              status === 'pending'
                ? 'New trainer applications appear here for review as members submit them.'
                : 'Decisions you record show up under their status tab.'
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
          {rows.map((row) => {
            const app = row.application ?? {};
            const fields = Array.isArray(app.fields) ? app.fields : [];
            const credentials = Array.isArray(app.credentialUrls) ? app.credentialUrls : [];
            const isPending = app.status === 'pending';
            const name = row.fullName || row.username || 'Applicant';
            return (
              <Card key={row._id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={row.avatar} name={row.fullName || row.username} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-md font-semibold text-text-1">{name}</p>
                      <p className="truncate text-xs text-text-2">
                        {row.username ? `@${row.username}` : 'No username'}
                      </p>
                      {row.email ? (
                        <a
                          href={`mailto:${row.email}`}
                          className="mt-0.5 inline-flex min-h-6 items-center gap-1.5 text-xs break-all text-text-2 underline decoration-line-strong underline-offset-3 hover:text-text-1 hover:decoration-current"
                        >
                          <Mail size={14} /> {row.email}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.isVerified ? <Badge tone="success">Verified</Badge> : null}
                    {row.isTrainer ? <Badge tone="info">Trainer</Badge> : null}
                    <Badge tone={STATUS_TONE[app.status ?? ''] ?? 'neutral'} dot>
                      {app.status ? humanize(app.status) : 'No application'}
                    </Badge>
                  </div>
                </div>

                {fields.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {fields.map((f) => (
                      <Badge key={f} tone="neutral">{humanize(f)}</Badge>
                    ))}
                  </div>
                ) : null}

                {app.experienceSummary ? (
                  <p className="prose-measure mt-3 rounded-sm border border-line bg-surface-2 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-text-1">
                    {app.experienceSummary}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-text-3 italic">No experience summary provided.</p>
                )}

                {credentials.length > 0 ? (
                  <div className="mt-3">
                    <p className="type-label text-text-2">Credentials</p>
                    <ul className="mt-1.5 space-y-1">
                      {credentials.map((url, i) => (
                        <li key={`${url}-${i}`}>
                          {isHttpUrl(url) ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex min-h-6 items-center gap-1.5 text-xs break-all text-brand-text underline decoration-line-strong underline-offset-3 hover:decoration-current"
                            >
                              <ExternalLink size={14} className="shrink-0" /> {url}
                            </a>
                          ) : (
                            <span className="admin-code text-text-2">{url}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {app.decisionNote ? (
                  <p className="mt-3 text-xs text-text-2 italic">Decision note: “{app.decisionNote}”</p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <p className="tabular text-xs text-text-2">
                    {app.submittedAt ? <>Submitted <Stamp iso={app.submittedAt} dateOnly /></> : 'Submission date unknown'}
                    {app.reviewedAt ? <>, reviewed <Stamp iso={app.reviewedAt} dateOnly /></> : null}
                  </p>
                  {isPending ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<X size={16} />}
                        onClick={() => setTarget({ application: row, decision: 'reject' })}
                        disabled={!isPending}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Check size={16} />}
                        onClick={() => setTarget({ application: row, decision: 'approve' })}
                        disabled={!isPending}
                      >
                        Approve
                      </Button>
                    </div>
                  ) : (
                    // A decision is final on the server (409 "not pending"), so
                    // the buttons are not offered; the applicant can re-apply.
                    <p className="text-xs text-text-2">
                      Decision recorded{app.status === 'rejected' ? '; the member can apply again.' : '.'}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {rows.length > 0 ? (
        <Pager
          page={page}
          totalPages={totalPages}
          canPrev={page > 1}
          canNext={page < totalPages}
          busy={query.isFetching}
          onPrev={() => setPage((n) => Math.max(1, n - 1))}
          onNext={() => setPage((n) => Math.min(totalPages, n + 1))}
          label={plural(total, 'application')}
        />
      ) : null}

      {target ? (
        <DecisionModal
          key={`${target.application._id}-${target.decision}`}
          application={target.application}
          decision={target.decision}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  );
}
