import { DataExport } from './DataExport';
import { DeleteAccount } from './DeleteAccount';
import { PendingDeletionBanner } from './PendingDeletionBanner';
import { useDeletionStatus } from './shared';

/**
 * The single Settings mount for the data lifecycle: the pending-deletion
 * banner (when the account is in its grace period), "Download your data" and
 * "Delete account". Settings.tsx renders this once at the end of the page.
 */
export function DataLifecycleSection() {
  const status = useDeletionStatus();
  const pending = status.data?.pendingDeletion === true;
  return (
    <>
      {pending ? <PendingDeletionBanner scheduledFor={status.data?.deletion?.scheduledFor} /> : null}
      <DataExport />
      <DeleteAccount />
    </>
  );
}
