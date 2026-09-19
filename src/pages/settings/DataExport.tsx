import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  exportStateLabel,
  exportWindowCopy,
  formatArchiveSize,
  formatDateOnly,
  formatDeletionDate,
  formatShortDate,
  httpCodeOf,
  isExportActive,
  isExportBlocking,
  type ExportDownload,
  type ExportJob,
  type ExportList,
} from '../../lib/accountLifecycle';
import { Badge, Button, ErrorState, Skeleton, useToast } from '../ui';
import { Download } from '../icons';
import { SettingsCard, useDeletionStatus } from './shared';
import { useReauthGate } from './useReauthGate';

export const DATA_EXPORTS_KEY = ['data-exports'] as const;
const POLL_MS = 10_000;

const ARCHIVE_CONTENTS = 'A ZIP of your account, posts, messages you sent, workouts, meals, health entries and photos.';

type RowBusy = 'download' | 'remove' | null;

function jobDetail(job: ExportJob): string {
  const state = exportStateLabel(job);
  switch (state.label) {
    case 'Ready': {
      const parts = [`Available until ${formatDeletionDate(job.expiresAt)}`];
      if (job.archiveBytes) parts.push(formatArchiveSize(job.archiveBytes));
      if (job.downloadCount > 0) parts.push(job.downloadCount === 1 ? 'Downloaded once' : `Downloaded ${job.downloadCount} times`);
      return parts.join(' · ');
    }
    case 'Queued':
      return 'Waiting to start. You will get a notification when it is ready.';
    case 'Building':
      return 'Being prepared now.';
    case 'Failed':
      return state.detail ?? '';
    case 'Expired':
      return job.expiresAt ? `Expired ${formatDateOnly(job.expiresAt)}.` : 'This copy is no longer available.';
    case 'Cancelled':
      return 'Cancelled.';
    default:
      return '';
  }
}

/** One export in the list. Presentational, so it renders under react-dom/server for tests. */
export function ExportJobRow({
  job,
  onDownload,
  onRemove,
  busy = null,
  disabled = false,
}: {
  job: ExportJob;
  onDownload?: (job: ExportJob) => void;
  onRemove?: (job: ExportJob) => void;
  busy?: RowBusy;
  disabled?: boolean;
}) {
  const state = exportStateLabel(job);
  const requested = formatShortDate(job.requestedAt);
  const active = isExportActive(job);
  const removable = active || state.label === 'Ready';
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          <span className="text-sm font-semibold text-text-1">Requested {requested}</span>
        </div>
        <p className={state.tone === 'danger' ? 'mt-1 text-xs text-danger-text' : 'mt-1 text-xs text-text-2'}>{jobDetail(job)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {state.label === 'Ready' && onDownload ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={16} />}
            aria-label={`Download the copy requested ${requested}`}
            loading={busy === 'download'}
            disabled={disabled}
            onClick={() => onDownload(job)}
          >
            Download
          </Button>
        ) : null}
        {removable && onRemove ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${active ? 'Cancel' : 'Delete'} the copy requested ${requested}`}
            loading={busy === 'remove'}
            disabled={disabled}
            onClick={() => onRemove(job)}
          >
            {active ? 'Cancel' : 'Delete copy'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Settings > Download your data. Lists the member's export jobs (last five,
 * newest first), polls while one is queued or building, and puts "Confirm it
 * is you" (X-Reauth) in front of requesting a copy and minting a download
 * link. The API is the only truth for state; the window rule is explained
 * from its policy. Nothing is offered until GET /users/me/deletion has
 * answered too: it carries the re-auth methods, and without them the dialog
 * could only guess which proof to ask for.
 */
export function DataExport() {
  const toast = useToast();
  const qc = useQueryClient();
  const email = useAuth((s) => s.user?.email);
  const status = useDeletionStatus();
  const gate = useReauthGate({ methods: status.data?.reauth, email });
  const [requesting, setRequesting] = useState(false);
  const [rowBusy, setRowBusy] = useState<{ id: string; kind: RowBusy } | null>(null);

  const list = useQuery<ExportList>({
    queryKey: DATA_EXPORTS_KEY,
    queryFn: async () => (await api.get<ExportList>('/users/me/exports')).data,
    refetchInterval: (query) => (query.state.data?.jobs.some(isExportActive) ? POLL_MS : false),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: DATA_EXPORTS_KEY });
  const jobs = list.data?.jobs ?? [];
  const policy = list.data?.policy;
  const windowCopy = policy ? exportWindowCopy(policy) : null;
  const blocking = jobs.find((job) => isExportBlocking(job));
  const blockedReason =
    windowCopy?.next ?? (blocking ? `Your current copy is ${exportStateLabel(blocking).label.toLowerCase()}. Request another once it has expired or been deleted.` : null);
  const anyBusy = requesting || rowBusy !== null;
  const loading = (list.isLoading && !list.data) || (status.isLoading && !status.data);
  const failed =
    list.isError && !list.data
      ? { title: 'Could not load your exports', error: list.error, retry: () => void list.refetch() }
      : status.isError && !status.data
        ? { title: 'Could not load your account status', error: status.error, retry: () => void status.refetch() }
        : null;

  async function request() {
    setRequesting(true);
    try {
      const res = await gate.withReauth(
        (token) => api.post('/users/me/exports', {}, { headers: token ? { 'X-Reauth': token } : {} }),
        { purpose: 'export', waive: policy?.reauthRequired === false },
      );
      if (!res) return;
      toast.success('We are preparing your data. You will get a notification when it is ready.');
    } catch (e) {
      const code = httpCodeOf(e);
      if (code === 'EXPORT_LIMIT') {
        const retryAt = (e as { response?: { data?: { retryAt?: string } } }).response?.data?.retryAt;
        toast.info(`You can request another copy on ${formatDateOnly(retryAt)}.`);
      } else if (code === 'EXPORT_IN_PROGRESS') {
        toast.info('A copy is already being prepared or is ready to download.');
      } else {
        toast.error(errMsg(e, 'Could not request your data.'));
      }
    } finally {
      await refresh();
      setRequesting(false);
    }
  }

  async function download(job: ExportJob) {
    setRowBusy({ id: job.id, kind: 'download' });
    try {
      // The link lives a few minutes and is minted per tap; nothing is stored.
      const res = await gate.withReauth(
        (token) => api.get<ExportDownload>(`/users/me/exports/${job.id}/download`, { headers: token ? { 'X-Reauth': token } : {} }),
        { purpose: 'download', waive: policy?.reauthRequired === false },
      );
      if (!res) return;
      window.location.assign(res.data.download.url);
      await refresh();
    } catch (e) {
      const code = httpCodeOf(e);
      if (code === 'EXPORT_EXPIRED' || code === 'EXPORT_NOT_READY') {
        toast.info(errMsg(e, 'This copy is not available to download.'));
        await refresh();
      } else {
        toast.error(errMsg(e, 'Could not prepare the download.'));
      }
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(job: ExportJob) {
    setRowBusy({ id: job.id, kind: 'remove' });
    const active = isExportActive(job);
    try {
      await api.delete(`/users/me/exports/${job.id}`);
      toast.success(active ? 'Export cancelled.' : 'Copy deleted.');
    } catch (e) {
      if (httpCodeOf(e) === 'EXPORT_FINISHED') toast.info(errMsg(e, 'This export has already finished.'));
      else toast.error(errMsg(e, active ? 'Could not cancel the export.' : 'Could not delete the copy.'));
    } finally {
      await refresh();
      setRowBusy(null);
    }
  }

  return (
    <SettingsCard id="data" title="Download your data" description={ARCHIVE_CONTENTS}>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
        </div>
      ) : failed ? (
        <ErrorState title={failed.title} error={failed.error} retry={failed.retry} />
      ) : (
        <div className="space-y-4">
          {windowCopy ? <p className="text-xs text-text-2">{windowCopy.rule}</p> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p id="data-export-request-hint" className="text-sm text-text-2">
              {blockedReason ?? 'Request a copy and we will email you when it is ready.'}
            </p>
            <Button
              id="data-export-request"
              variant="primary"
              aria-describedby="data-export-request-hint"
              disabled={!!blockedReason || anyBusy}
              loading={requesting}
              onClick={() => void request()}
            >
              Request a copy
            </Button>
          </div>

          {jobs.length === 0 ? (
            <p className="text-sm text-text-3">You have not requested a copy yet.</p>
          ) : (
            <ul aria-label="Your data exports" className="divide-y divide-line">
              {jobs.map((job) => (
                <ExportJobRow
                  key={job.id}
                  job={job}
                  busy={rowBusy?.id === job.id ? rowBusy.kind : null}
                  disabled={anyBusy && rowBusy?.id !== job.id}
                  onDownload={(j) => void download(j)}
                  onRemove={(j) => void remove(j)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {gate.dialog}
    </SettingsCard>
  );
}
