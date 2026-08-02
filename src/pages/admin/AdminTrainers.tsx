import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { adminApi, errMsg } from '../../lib/api';
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
  Award,
  Check,
  X,
  Mail,
  Download,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons';

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
  const [error, setError] = useState<string | null>(null);

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
          ? `Approved ${application.username ? `@${application.username}` : 'the applicant'} as a trainer.`
          : 'Application rejected.',
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
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={approving ? 'primary' : 'ghost'}
            loading={mutation.isPending}
            onClick={() => { setError(null); mutation.mutate(); }}
            className={approving ? undefined : 'border-red-500/40 bg-red-500/15 text-red-300'}
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
            <p className="truncate text-sm font-bold text-slate-100">
              {application.fullName || application.username || 'Applicant'}
            </p>
            <p className="truncate font-mono text-[12px] text-slate-500">{application.email || '—'}</p>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-slate-400">
          {approving
            ? 'Approving grants the trainer badge and unlocks coaching features on this account.'
            : 'Rejecting closes the application. The applicant may reapply later.'}
        </p>

        <Textarea
          label="Decision note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Shared context for the audit trail…"
          hint={`${note.length}/1000`}
          className="border-slate-800 bg-slate-900/70 text-slate-100"
        />

        {error ? (
          <p role="alert" className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Trainer applications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Verify credentials before granting coaching privileges.
          </p>
        </div>
        <Badge tone="neutral">{total.toLocaleString()} applications</Badge>
      </div>

      <Tabs tabs={TABS} active={status} onChange={(k) => { setStatus(k); setPage(1); }} />

      {query.isError ? (
        <ErrorState
          error={query.error}
          retry={() => void query.refetch()}
          title="Could not load applications"
        />
      ) : query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-3 flex-1" />
              </div>
              <Skeleton className="mt-3 h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-slate-800 bg-slate-950/60">
          <EmptyState
            icon={<Award size={22} />}
            title={status === 'pending' ? 'No pending applications' : 'Nothing here'}
            message={
              status === 'pending'
                ? 'New trainer applications will appear here for review.'
                : `No ${status} applications.`
            }
          />
        </Card>
      ) : (
        <div className={cx('space-y-3', query.isFetching && 'opacity-60')}>
          {rows.map((row) => {
            const app = row.application ?? {};
            const fields = Array.isArray(app.fields) ? app.fields : [];
            const credentials = Array.isArray(app.credentialUrls) ? app.credentialUrls : [];
            const isPending = app.status === 'pending';
            return (
              <Card key={row._id} className="border-slate-800 bg-slate-950/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={row.avatar} name={row.fullName || row.username} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-100">
                        {row.fullName || row.username || 'Applicant'}
                      </p>
                      <p className="truncate text-[12px] text-slate-500">
                        {row.username ? `@${row.username}` : ''}
                      </p>
                      <a
                        href={row.email ? `mailto:${row.email}` : undefined}
                        className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[11px] break-all text-slate-500 hover:text-slate-300"
                      >
                        <Mail size={11} /> {row.email || '—'}
                      </a>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.isVerified ? <Badge tone="success">Verified</Badge> : null}
                    {row.isTrainer ? <Badge tone="brand">Trainer</Badge> : null}
                    <Badge
                      tone={
                        app.status === 'approved'
                          ? 'success'
                          : app.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {app.status ?? 'none'}
                    </Badge>
                  </div>
                </div>

                {fields.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {fields.map((f) => (
                      <Badge key={f} tone="info">{f}</Badge>
                    ))}
                  </div>
                ) : null}

                {app.experienceSummary ? (
                  <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-slate-300">
                    {app.experienceSummary}
                  </p>
                ) : (
                  <p className="mt-3 text-[12px] text-slate-600 italic">
                    No experience summary provided.
                  </p>
                )}

                {credentials.length > 0 ? (
                  <div className="mt-3">
                    <p className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                      Credentials
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {credentials.map((url, i) => (
                        <li key={`${url}-${i}`}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1.5 font-mono text-[12px] break-all text-cyan-300 hover:underline"
                          >
                            <Download size={12} /> {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {app.decisionNote ? (
                  <p className="mt-3 text-[12px] text-slate-500 italic">
                    Decision note: “{app.decisionNote}”
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                  <p className="font-mono text-[11px] text-slate-500">
                    {app.submittedAt
                      ? `Submitted ${format(new Date(app.submittedAt), 'MMM d, yyyy')}`
                      : 'Submission date unknown'}
                    {app.reviewedAt
                      ? ` · reviewed ${format(new Date(app.reviewedAt), 'MMM d, yyyy')}`
                      : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X size={14} />}
                      className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      onClick={() => setTarget({ application: row, decision: 'reject' })}
                      disabled={!isPending && app.status === 'rejected'}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Check size={14} />}
                      onClick={() => setTarget({ application: row, decision: 'approve' })}
                      disabled={!isPending && app.status === 'approved'}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-slate-500">
            Page {page} of {totalPages} · {total.toLocaleString()} applications
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
