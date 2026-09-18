import { useEffect } from 'react';
import { useAuth } from './auth';
import { tokenStore } from './api';
import { bindWorkoutDraftAccount, reportWorkoutDraftStorageIssue } from './workoutDrafts';

/** Runs outside the logger too, so logout/deletion/account switches purge drafts. */
export function WorkoutDraftLifecycle() {
  const { user, verifiedToken, loading, bootstrapError } = useAuth();
  useEffect(() => {
    if (loading || bootstrapError) return;
    const token = tokenStore.get();
    // Credential changes revoke synchronously and schedule purge through tokenStore. A fresh
    // signed-out tab must not revoke a different tab's session-only draft.
    if (!user || !token) return;
    if (!verifiedToken || verifiedToken !== token) return;
    void bindWorkoutDraftAccount(user._id, verifiedToken).catch(() => {
      reportWorkoutDraftStorageIssue('Workout storage could not be opened or purged. Open Workout log to retry; no draft will be sent automatically.');
    });
  }, [user?._id, verifiedToken, loading, bootstrapError]);
  return null;
}
