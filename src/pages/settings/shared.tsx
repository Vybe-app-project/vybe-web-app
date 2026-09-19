import { useQuery } from '@tanstack/react-query';
import { getDeletionStatus } from '../../lib/lifecycleApi';
import type { DeletionStatus } from '../../lib/accountLifecycle';

/** The Settings card frame, the same one Settings.tsx and SettingsPreferences.tsx use, so the page reads as one. */
export { SettingsCard } from '../SettingsPieces';

export const DELETION_STATUS_KEY = ['deletion-status'] as const;

/**
 * GET /users/me/deletion, shared by the pending banner, the export card (for
 * the re-auth methods) and the delete card. One key, so the page fetches it once.
 */
export function useDeletionStatus(enabled = true) {
  return useQuery<DeletionStatus>({
    queryKey: DELETION_STATUS_KEY,
    queryFn: getDeletionStatus,
    enabled,
    staleTime: 60_000,
  });
}
