import { useState } from 'react';
import type { AxiosResponse } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  formatDeletionDate,
  httpCodeOf,
  httpStatusOf,
  lifecycleNotice,
  type DeletionOutcome,
} from '../../lib/accountLifecycle';
import { Button, ConfirmDialog, ErrorState, Input, Skeleton } from '../ui';
import { DELETION_STATUS_KEY, SettingsCard, useDeletionStatus } from './shared';
import { useReauthGate } from './useReauthGate';

export const DELETE_PHRASE = 'DELETE MY ACCOUNT';

type Mode = 'now' | 'scheduled';

const CONFIRM_COPY: Record<Mode, { title: string; message: (graceDays: number) => string; confirmLabel: string }> = {
  now: {
    title: 'Delete your account now?',
    message: () => 'Everything you posted, logged and saved on Vybe is removed straight away. This cannot be undone.',
    confirmLabel: 'Delete account',
  },
  scheduled: {
    title: 'Schedule your account for deletion?',
    message: (graceDays) =>
      `Your account is locked now and removed after ${graceDays} days. Sign in before then and choose Cancel deletion to keep it.`,
    confirmLabel: 'Schedule deletion',
  },
};

/**
 * Settings > Delete account. Two paths, both behind "Confirm it is you"
 * (X-Reauth): delete now, gated by the typed phrase, and a scheduled deletion
 * with the API's grace period. Either answer signs the member out with a
 * notice for the sign-in page; a pending account sees the banner instead.
 */
export function DeleteAccount() {
  const qc = useQueryClient();
  const email = useAuth((s) => s.user?.email);
  const status = useDeletionStatus();
  const methods = status.data?.reauth;
  const graceDays = status.data?.graceDays ?? 14;
  const backupRetentionDays = status.data?.backupRetentionDays ?? 14;
  const gate = useReauthGate({ methods, email });
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState<Mode | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const deleteMe = (mode: Mode, token: string | null): Promise<AxiosResponse<DeletionOutcome>> =>
    api.delete('/users/me', {
      headers: token ? { 'X-Reauth': token } : {},
      data: { mode },
      // Inline deletion is synchronous on the API; a large account can take
      // longer than the 30 s default.
      timeout: 120_000,
    });

  async function proceed(mode: Mode) {
    setConfirming(null);
    setFailure(null);
    setBusy(mode);
    try {
      const res = await gate.withReauth((token) => deleteMe(mode, token), {
        purpose: 'delete',
        // A passwordless account with no email delivery may schedule without re-auth.
        waive: mode === 'scheduled' && methods?.scheduledWithoutReauth === true,
      });
      if (!res) return; // cancelled in the re-auth dialog
      const outcome = res.data;
      if (outcome.state === 'scheduled') {
        lifecycleNotice.set({ kind: 'scheduled', scheduledFor: outcome.scheduledFor, graceDays: outcome.graceDays });
      } else {
        lifecycleNotice.set({
          kind: 'deleted',
          completedAt: outcome.state === 'deleted' ? outcome.completedAt : new Date().toISOString(),
          backupsPurgeBy: outcome.state === 'deleted' ? outcome.backupsPurgeBy : null,
        });
      }
      // The token is dead (deleted) or refused everywhere else (scheduled);
      // leave before a background query 401s into a misleading "session expired".
      await qc.cancelQueries().catch(() => undefined);
      useAuth.getState().logout();
    } catch (e) {
      if (httpStatusOf(e) === 409 && httpCodeOf(e) === 'DELETION_ALREADY_SCHEDULED') {
        await qc.invalidateQueries({ queryKey: DELETION_STATUS_KEY });
        return;
      }
      setFailure(errMsg(e, 'Could not delete your account.'));
    } finally {
      setBusy(null);
    }
  }

  if (status.isLoading && !status.data) {
    return (
      <SettingsCard id="delete" title="Delete account" titleClassName="text-danger" className="border-danger/40">
        <div className="space-y-3">
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
        </div>
      </SettingsCard>
    );
  }

  if (status.isError && !status.data) {
    return (
      <SettingsCard id="delete" title="Delete account" titleClassName="text-danger" className="border-danger/40">
        <ErrorState title="Could not load your account status" error={status.error} retry={() => void status.refetch()} />
      </SettingsCard>
    );
  }

  if (status.data?.pendingDeletion) {
    return (
      <SettingsCard
        id="delete"
        title="Delete account"
        titleClassName="text-danger"
        className="border-danger/40"
        description={`Your account is scheduled for deletion on ${formatDeletionDate(status.data.deletion?.scheduledFor)}. Use Cancel deletion above to keep it.`}
      >
        <p className="text-sm text-text-2">Nothing is removed until then.</p>
      </SettingsCard>
    );
  }

  const ready = phrase === DELETE_PHRASE;
  const confirmCopy = confirming ? CONFIRM_COPY[confirming] : null;

  return (
    <SettingsCard
      id="delete"
      title="Delete account"
      titleClassName="text-danger"
      className="border-danger/40"
      description="This permanently deletes your profile, posts, comments, workouts and meals. It cannot be undone."
    >
      <div className="space-y-6">
        <section aria-labelledby="delete-now-title" className="space-y-3">
          <div>
            <h3 id="delete-now-title" className="text-sm font-semibold text-text-1">
              Delete now
            </h3>
            <p className="text-xs text-text-2">
              Everything is removed straight away. Copies in backups are overwritten within {backupRetentionDays} days.
            </p>
          </div>
          <Input
            id="del-phrase"
            label={`Type ${DELETE_PHRASE} to confirm`}
            hint="Case-sensitive. The button unlocks once the phrase matches."
            value={phrase}
            placeholder={DELETE_PHRASE}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy !== null}
            onChange={(e) => setPhrase(e.target.value)}
          />
          <div className="flex justify-end">
            <Button variant="danger" disabled={!ready || busy !== null} loading={busy === 'now'} onClick={() => setConfirming('now')}>
              Permanently delete my account
            </Button>
          </div>
        </section>

        <section aria-labelledby="delete-later-title" className="space-y-3 border-t border-line pt-4">
          <div>
            <h3 id="delete-later-title" className="text-sm font-semibold text-text-1">
              Schedule deletion
            </h3>
            <p className="text-xs text-text-2">
              Your account is locked now and removed after {graceDays} days. Sign in before then to keep it.
            </p>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" disabled={busy !== null} loading={busy === 'scheduled'} onClick={() => setConfirming('scheduled')}>
              Schedule deletion
            </Button>
          </div>
        </section>

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirmCopy?.title}
        message={confirmCopy?.message(graceDays)}
        confirmLabel={confirmCopy?.confirmLabel}
        cancelLabel="Keep my account"
        destructive
        loading={busy !== null}
        onConfirm={() => confirming && void proceed(confirming)}
        onCancel={() => setConfirming(null)}
      />
      {gate.dialog}
    </SettingsCard>
  );
}
