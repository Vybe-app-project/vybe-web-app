import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../lib/api';
import { PENDING_DELETION_BODY, pendingDeletionTitle } from '../../lib/accountLifecycle';
import { cancelScheduledDeletion } from '../../lib/lifecycleApi';
import { Button, Callout, useToast } from '../ui';
import { DELETION_STATUS_KEY } from './shared';

/**
 * "Your account is scheduled for deletion on <date>." with the one action
 * that undoes it (POST /users/me/deletion/cancel, "Keep my account" on the
 * API). Shown at the top of Settings and, for a pending account, on the
 * sign-in page instead of the form. Warning tone renders role="alert". The
 * buttons sit under the text rather than in the Callout's side column, so
 * the sentence keeps its width on a phone.
 */
export function PendingDeletionBanner({
  scheduledFor,
  onKept,
  secondaryAction,
}: {
  scheduledFor: string | null | undefined;
  onKept?: () => void | Promise<void>;
  secondaryAction?: ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const keep = useMutation({
    mutationFn: cancelScheduledDeletion,
    onSuccess: async (data) => {
      toast.success(data.message || 'Your account is staying. Nothing was removed.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: DELETION_STATUS_KEY }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ]);
      await onKept?.();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not cancel the deletion. Try again.')),
  });

  return (
    <Callout tone="warning" title={pendingDeletionTitle(scheduledFor)}>
      <p>{PENDING_DELETION_BODY}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={keep.isPending} onClick={() => keep.mutate()}>
          Cancel deletion
        </Button>
        {secondaryAction}
      </div>
    </Callout>
  );
}
